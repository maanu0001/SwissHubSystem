import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { conflict } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import type { DiscordGateway } from '@swisshub/discord';
import { readModuleSettings, writeModuleSettings } from '../settings/service';
import { LEVEL_MODULE_ID, type LevelSettings } from './config';
import { loadLevelContext } from './context';
import { levelFromXp } from './curve';
import { applyXp, type ApplyXpResult } from './service';
import { reconcileMilestones, syncMilestoneRoles } from './milestones';
import { logLevelReset, logXpChange } from './notifications';

const logger = createLogger('level.admin');

/**
 * Verwaltende Eingriffe ins Level-System.
 *
 * Dashboard und Slash Commands rufen dieselben Funktionen auf. Dadurch gibt
 * es eine Protokollierung, eine Prüfung und einen Weg, auf dem sich XP ändern
 * kann - beim Vorgänger existierte das nur als Discord-Nachricht in einem
 * Log-Channel.
 */

export interface LevelActor {
  discordId: string;
  username: string;
}

export interface AdjustXpInput {
  target: { discordId: string; username?: string | null; displayName?: string | null };
  /** Positiv = vergeben, negativ = entziehen. */
  amount: number;
  reason?: string | null;
}

export interface AdjustXpResult extends ApplyXpResult {
  /** Rollen, die durch die Änderung dazukamen bzw. wegfielen. */
  rolesAdded: string[];
  rolesRemoved: string[];
}

/** Vergibt oder entzieht XP von Hand. */
export async function adjustXp(
  actor: LevelActor,
  input: AdjustXpInput,
  options: { syncRoles?: boolean } = {},
): Promise<AdjustXpResult> {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw conflict('Bitte eine Anzahl XP ungleich null angeben.');
  }

  const context = await loadLevelContext();

  const result = await applyXp(
    {
      discordId: input.target.discordId,
      username: input.target.username ?? null,
      displayName: input.target.displayName ?? null,
      delta: amount,
      source: 'ADMIN',
      reason: input.reason ?? (amount > 0 ? 'XP vergeben' : 'XP entzogen'),
      actorDiscordId: actor.discordId,
    },
    {
      // Vor einer Handbuchung den fälligen Abzug nachholen, damit der
      // angezeigte Ausgangswert stimmt.
      applyDecayFirst: context.settings.decayEnabled,
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    },
  );

  let rolesAdded: string[] = [];
  let rolesRemoved: string[] = [];
  if (options.syncRoles !== false) {
    const sync = await syncMilestoneRoles(input.target.discordId, result.xpAfter, {
      gateway: context.gateway,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
      reason: `Level ${result.levelAfter}`,
    }).catch(() => null);
    rolesAdded = sync?.added ?? [];
    rolesRemoved = sync?.removed ?? [];
  }

  // Zusätzlich zum Audit-Log ins Discord-Protokoll - das Team sieht die
  // Änderung dort, ohne das Dashboard zu öffnen.
  await logXpChange(context, {
    discordId: input.target.discordId,
    delta: result.delta,
    xpAfter: result.xpAfter,
    levelAfter: result.levelAfter,
    source: 'ADMIN',
    reason: input.reason ?? null,
    actorDiscordId: actor.discordId,
  });

  await safeRecordAudit({
    action: amount > 0 ? AUDIT_ACTIONS.LEVEL_XP_GRANTED : AUDIT_ACTIONS.LEVEL_XP_REVOKED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: input.target.discordId,
    success: true,
    metadata: {
      amount,
      applied: result.delta,
      xpBefore: result.xpBefore,
      xpAfter: result.xpAfter,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      decayed: result.decayed,
      reason: input.reason ?? null,
    },
  });

  return { ...result, rolesAdded, rolesRemoved };
}

/**
 * Ändert einzelne Einstellungen, ohne die übrigen anzufassen.
 *
 * Die Admin-Befehle des alten Bots setzten je einen Wert. Damit sie das
 * weiterhin können, ohne die restliche Konfiguration zu überschreiben, wird
 * hier gelesen, zusammengeführt und wieder validiert geschrieben.
 */
export async function updateLevelSettings(
  actor: LevelActor,
  patch: Partial<LevelSettings>,
): Promise<LevelSettings> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  const result = await writeModuleSettings<LevelSettings>(LEVEL_MODULE_ID, { ...current, ...patch }, actor);
  return result.settings;
}

/** Fügt einen Channel zur Liste ohne XP hinzu. Gibt `false` zurück, wenn er schon drin war. */
export async function addNoXpChannel(actor: LevelActor, channelId: string): Promise<boolean> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  if (current.noXpChannelIds.includes(channelId)) {
    return false;
  }
  await updateLevelSettings(actor, { noXpChannelIds: [...current.noXpChannelIds, channelId] });
  return true;
}

/** Entfernt einen Channel aus der Liste ohne XP. */
export async function removeNoXpChannel(actor: LevelActor, channelId: string): Promise<boolean> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  if (!current.noXpChannelIds.includes(channelId)) {
    return false;
  }
  await updateLevelSettings(actor, {
    noXpChannelIds: current.noXpChannelIds.filter((entry) => entry !== channelId),
  });
  return true;
}

/** Aktuelle Einstellungen des Level-Systems. */
export async function readLevelSettings(): Promise<LevelSettings> {
  return readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
}

// --- Alle XP zurücksetzen ---------------------------------------------------

/**
 * Wie viele Profile eine Transaktion umfasst.
 *
 * Derselbe Wert wie bei der Übernahme der Altdaten und aus demselben Grund:
 * gross genug, dass der Aufwand je Transaktion nicht ins Gewicht fällt, klein
 * genug, dass keine Transaktion minutenlang Zeilen sperrt.
 */
const RESET_CHUNK_SIZE = 100;

/**
 * Für wie viele Mitglieder die Meilenstein-Rollen in einem Zug abgeglichen
 * werden.
 *
 * Der Abgleich ist mindestens eine Discord-Anfrage je Person. Die Grenze ist
 * dieselbe, die `reconcileMilestones` ohnehin setzt; was darüber hinausgeht,
 * wird nicht stillschweigend übergangen, sondern gemeldet.
 */
const RESET_ROLLEN_GRENZE = 2000;

/** Wie viele Profile derzeit XP tragen - die Zahl, über die entschieden wird. */
export async function countLevelProfilesWithXp(): Promise<number> {
  return prisma.levelProfile.count({ where: { xp: { gt: 0 } } });
}

export interface ResetAllLevelsOptions {
  actor: LevelActor;
  gateway?: DiscordGateway;
  /**
   * Schlüssel der Bestätigung. Er landet im Journal, damit ein zweiter Versuch
   * derselben Bestätigung keine zweiten Buchungen schreibt.
   */
  idempotencyKey: string;
  reason?: string;
  metadata?: { ipHash?: string | null; userAgent?: string | null };
}

export interface ResetAllLevelsResult {
  /** Profile mit XP, als der Vorgang begann. */
  gefunden: number;
  /** Profile, deren Stand tatsächlich auf null gesetzt wurde. */
  zurueckgesetzt: number;
  /** Summe der entzogenen XP. */
  entzogeneXp: number;
  /** Meilenstein-Rollen, die daraufhin entzogen wurden. */
  rollenEntzogen: number;
  warnings: string[];
}

/**
 * Setzt den XP-Stand aller Mitglieder auf null.
 *
 * Das Level steht nicht in der Datenbank - es folgt aus den XP. Wer auf null
 * gesetzt wird, steht damit wieder ganz am Anfang der Kurve; eine zweite
 * Spalte, die man vergessen könnte, gibt es nicht. Der Anfang ist Level 1,
 * nicht Level 0: `levelFromXp(0)` ist 1, und das Journal muss dasselbe sagen
 * wie die Levelkarte.
 *
 * Drei Dinge passieren, und die Reihenfolge ist Absicht:
 *
 * 1. **Buchen.** Jede Null-Setzung ist eine gewöhnliche XP-Buchung im Journal -
 *    `XpTransaction` mit `xpBefore`, `delta` und Grund. Ein `updateMany` ohne
 *    Journal wäre die einzige Stelle im Level-System, an der XP spurlos
 *    verschwände; genau dort fehlte dann die Antwort auf "wo sind meine XP
 *    hin?". Geschrieben wird in Stapeln, und jeder Stapel sperrt seine Zeilen
 *    (`FOR UPDATE`), damit eine gleichzeitige Buchung des Bots nicht zwischen
 *    Lesen und Schreiben rutscht.
 * 2. **Rollen abgleichen.** Alle stehen wieder auf Level 1, also muss jede
 *    Meilenstein-Rolle weg. Das erledigt `reconcileMilestones` - dieselbe
 *    Funktion wie der Knopf unter «Meilenstein-Rollen». Ohne sie behielten die
 *    Mitglieder ihre «Level 50»-Rolle bei null XP, und Discord widerspräche der
 *    Datenbank. Sind keine Meilenstein-Rollen eingerichtet, kostet der Schritt
 *    keine einzige Anfrage.
 * 3. **Protokollieren.** Eine Nachricht im XP-Protokoll und ein Eintrag im
 *    Audit Log - nicht eine Meldung je Person.
 *
 * Was **nicht** angefasst wird: Nachrichten- und Voice-Zähler, die
 * Levelkarten, die Spiel-Statistiken und das Journal selbst. Zurückgesetzt
 * wird der Punktestand, nicht die Geschichte.
 */
export async function resetAllLevels(options: ResetAllLevelsOptions): Promise<ResetAllLevelsResult> {
  const context = await loadLevelContext(options.gateway);
  const maxLevelTotalXp = context.settings.maxLevelTotalXp;
  const grund = options.reason ?? 'Alle XP zurückgesetzt';

  const betroffen = await prisma.levelProfile.findMany({
    where: { xp: { gt: 0 } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const ergebnis: ResetAllLevelsResult = {
    gefunden: betroffen.length,
    zurueckgesetzt: 0,
    entzogeneXp: 0,
    rollenEntzogen: 0,
    warnings: [],
  };

  if (betroffen.length === 0) {
    return ergebnis;
  }

  for (let start = 0; start < betroffen.length; start += RESET_CHUNK_SIZE) {
    const ids = betroffen.slice(start, start + RESET_CHUNK_SIZE).map((profile) => profile.id);
    const stapel = await resetProfileChunk(ids, {
      actorDiscordId: options.actor.discordId,
      idempotencyKey: options.idempotencyKey,
      maxLevelTotalXp,
      reason: grund,
    });
    ergebnis.zurueckgesetzt += stapel.zurueckgesetzt;
    ergebnis.entzogeneXp += stapel.entzogeneXp;
  }

  const abgleich = await reconcileMilestones({
    gateway: context.gateway,
    maxLevelTotalXp,
    limit: RESET_ROLLEN_GRENZE,
  }).catch((error: unknown) => {
    ergebnis.warnings.push(
      'Die Meilenstein-Rollen konnten nicht abgeglichen werden. Bitte den Abgleich unter «Meilenstein-Rollen» ausführen.',
    );
    logger.warn('Rollenabgleich nach dem Zurücksetzen fehlgeschlagen', { error });
    return null;
  });

  if (abgleich) {
    ergebnis.rollenEntzogen = abgleich.rolesRemoved;
    if (abgleich.failed > 0) {
      ergebnis.warnings.push(
        `${abgleich.failed} Meilenstein-Rollen konnten nicht entzogen werden - vermutlich steht die Rolle über dem Bot.`,
      );
    }
    if (ergebnis.gefunden > RESET_ROLLEN_GRENZE) {
      ergebnis.warnings.push(
        `Der Rollenabgleich umfasst ${RESET_ROLLEN_GRENZE} Mitglieder. Bitte ihn unter «Meilenstein-Rollen» erneut ausführen, bis er nichts mehr ändert.`,
      );
    }
  }

  await logLevelReset(context, {
    betroffen: ergebnis.zurueckgesetzt,
    entzogeneXp: ergebnis.entzogeneXp,
    actorDiscordId: options.actor.discordId,
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_RESET,
    module: LEVEL_MODULE_ID,
    actorDiscordId: options.actor.discordId,
    actorUsername: options.actor.username,
    targetLabel: `${ergebnis.zurueckgesetzt} XP-Stände`,
    success: ergebnis.warnings.length === 0,
    metadata: {
      gefunden: ergebnis.gefunden,
      zurueckgesetzt: ergebnis.zurueckgesetzt,
      entzogeneXp: ergebnis.entzogeneXp,
      rollenEntzogen: ergebnis.rollenEntzogen,
      warnings: ergebnis.warnings,
    },
    ipHash: options.metadata?.ipHash,
    userAgent: options.metadata?.userAgent,
  });

  logger.info('Alle XP-Stände zurückgesetzt', {
    gefunden: ergebnis.gefunden,
    zurueckgesetzt: ergebnis.zurueckgesetzt,
    entzogeneXp: ergebnis.entzogeneXp,
    rollenEntzogen: ergebnis.rollenEntzogen,
  });

  return ergebnis;
}

/**
 * Ein Stapel Profile in einer Transaktion.
 *
 * Gelesen wird erst hinter der Sperre: der Stand, der ins Journal kommt, ist
 * damit derselbe, der gleich überschrieben wird. Ein Profil, das inzwischen
 * ohnehin auf null steht, fällt hier heraus - es gibt nichts zu buchen.
 */
async function resetProfileChunk(
  ids: readonly string[],
  options: {
    actorDiscordId: string;
    idempotencyKey: string;
    maxLevelTotalXp: number;
    reason: string;
  },
): Promise<{ zurueckgesetzt: number; entzogeneXp: number }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT "id" FROM "LevelProfile" WHERE "id" = ANY(${[...ids]}::text[]) FOR UPDATE
      `;

      const profile = await tx.levelProfile.findMany({
        where: { id: { in: [...ids] }, xp: { gt: 0 } },
        select: { id: true, discordId: true, xp: true },
      });

      if (profile.length === 0) {
        return { zurueckgesetzt: 0, entzogeneXp: 0 };
      }

      await tx.xpTransaction.createMany({
        data: profile.map((eintrag) => ({
          profileId: eintrag.id,
          discordId: eintrag.discordId,
          source: 'ADMIN' as const,
          delta: -eintrag.xp,
          requestedDelta: -eintrag.xp,
          xpBefore: eintrag.xp,
          xpAfter: 0,
          levelBefore: levelFromXp(eintrag.xp, options.maxLevelTotalXp),
          // Nicht 0: die Kurve beginnt bei Level 1, und null XP sind Level 1.
          levelAfter: levelFromXp(0, options.maxLevelTotalXp),
          reason: options.reason,
          actorDiscordId: options.actorDiscordId,
          // Derselbe Knopf, zweimal abgeschickt, bucht nicht zweimal.
          idempotencyKey: `level-reset:${options.idempotencyKey}:${eintrag.discordId}`,
        })),
        skipDuplicates: true,
      });

      const aktualisiert = await tx.levelProfile.updateMany({
        where: { id: { in: profile.map((eintrag) => eintrag.id) } },
        data: { xp: 0 },
      });

      return {
        zurueckgesetzt: aktualisiert.count,
        entzogeneXp: profile.reduce((summe, eintrag) => summe + eintrag.xp, 0),
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}
