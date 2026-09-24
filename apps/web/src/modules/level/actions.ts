'use server';

import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const logger = createLogger('level:actions');

const MODULE_ID = level.LEVEL_MODULE_ID;
const PERMISSIONS = level.LEVEL_PERMISSIONS;

/**
 * Server Actions des Level-Systems.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`. Die Fachlogik liegt vollständig im
 * Modul - dieselben Funktionen, die auch der Slash Command aufruft.
 */

function revalidateLevel(): void {
  revalidatePath('/level');
  revalidatePath('/level/mitglieder');
  revalidatePath('/level/rangliste');
  revalidatePath('/level/statistiken');
  revalidatePath('/dashboard');
}

export const adjustXpAction = defineAction(
  {
    name: 'level.xp.adjust',
    module: MODULE_ID,
    permission: PERMISSIONS.membersManage,
    schema: level.adjustXpSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await level.adjustXp(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      {
        target: { discordId: input.discordId },
        amount: input.amount,
        reason: input.reason ?? null,
      },
    );

    revalidateLevel();
    return {
      xpBefore: result.xpBefore,
      xpAfter: result.xpAfter,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      applied: result.delta,
      decayed: result.decayed,
      rolesAdded: result.rolesAdded,
      rolesRemoved: result.rolesRemoved,
    };
  },
);

export const upsertMilestoneAction = defineAction(
  {
    name: 'level.milestones.upsert',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.milestoneSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const milestone = await level.upsertMilestone(input);
    revalidatePath('/level/rollen');
    return { level: milestone.level, roleId: milestone.roleId, enabled: milestone.enabled };
  },
);

export const deleteMilestoneAction = defineAction(
  {
    name: 'level.milestones.delete',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.milestoneDeleteSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await level.deleteMilestone(input.level);
    revalidatePath('/level/rollen');
    return { level: input.level };
  },
);

/**
 * Gleicht die Level-Rollen aller Mitglieder ab.
 *
 * Eigenes Rate Limit, weil ein Durchgang je Mitglied Discord anfragt.
 */
export const reconcileMilestonesAction = defineAction(
  {
    name: 'level.milestones.reconcile',
    module: MODULE_ID,
    permission: PERMISSIONS.rolesManage,
    schema: level.reconcileSchema,
    rateLimit: 'reconciliation',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const settings = await level.readLevelSettings();
    const result = await level.reconcileMilestones({
      limit: input.limit,
      maxLevelTotalXp: settings.maxLevelTotalXp,
    });
    revalidatePath('/level/rollen');
    return result;
  },
);

/** Führt den Inaktivitäts-Abzug sofort aus, statt auf den Zeitplan zu warten. */
export const runDecayAction = defineAction(
  {
    name: 'level.decay.run',
    module: MODULE_ID,
    permission: PERMISSIONS.decayManage,
    schema: level.runDecaySchema,
    rateLimit: 'reconciliation',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const result = await level.runDecaySweep({ limit: input.limit });
    revalidatePath('/level/inaktivitaet');
    revalidateLevel();
    return result;
  },
);

/** Bricht eine laufende Partie ab und gibt die Einsätze zurück. */
export const cancelGameAction = defineAction(
  {
    name: 'level.games.cancel',
    module: MODULE_ID,
    permission: PERMISSIONS.gamesManage,
    schema: level.cancelGameSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const match = await level.closeGame(
      input.matchId,
      'CANCELLED',
      input.reason ?? 'Vom Dashboard abgebrochen',
    );
    revalidatePath('/level/spiele');
    revalidateLevel();
    return { matchId: match.id, status: match.status };
  },
);

export const confirmLevelImportAction = defineAction(
  {
    name: 'level.import.confirm',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: level.importConfirmSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const result = await level.executeLevelImport(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.importId,
      { legacyBotStopped: input.legacyBotStopped, importSettings: input.importSettings },
    );
    revalidatePath('/level/import');
    revalidateLevel();
    return result;
  },
);

export const discardLevelImportAction = defineAction(
  {
    name: 'level.import.discard',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: level.importDiscardSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await level.discardLevelImport(
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.importId,
    );
    revalidatePath('/level/import');
    return { importId: input.importId };
  },
);

/**
 * Alle XP-Stände auf null setzen.
 *
 * Eine eigene Berechtigung, nicht `membersManage`: wer einer Person XP gibt
 * oder nimmt, soll nicht nebenbei den Stand des ganzen Servers löschen
 * können. Das eigene Rate Limit ist streng - diese Aktion fasst in einem Zug
 * jedes Profil auf dem Server an.
 */
export const resetLevelsAction = defineAction(
  {
    name: 'level.reset',
    module: MODULE_ID,
    permission: PERMISSIONS.reset,
    schema: level.resetLevelsSchema,
    rateLimit: 'levelReset',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    /*
     * Der Bestand muss der sein, der bestaetigt wurde.
     *
     * Zwischen dem Aufbau der Seite und dem Klick koennen Minuten liegen, und
     * im Level-System vergeht keine Minute ohne Bewegung: jede Nachricht und
     * jede Minute im Voice bucht XP. Weicht die Zahl ab, stand im Dialog eine
     * andere - dann lieber abbrechen und den frischen Stand zeigen.
     */
    const aktuell = await level.countLevelProfilesWithXp();
    if (aktuell !== input.erwartet) {
      throw new AppError('CONFLICT', {
        userMessage:
          aktuell === 0
            ? 'Es gibt derzeit keine XP-Stände mehr, die zurückzusetzen wären.'
            : `Der Bestand hat sich geändert: es sind jetzt ${aktuell} Mitglieder mit XP statt ${input.erwartet}. Bitte die Seite neu laden und erneut prüfen.`,
      });
    }

    const ergebnis = await level.resetAllLevels({
      idempotencyKey: input.idempotencyKey,
      metadata,
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
    });

    logger.info('Alle XP-Stände zurückgesetzt', {
      actor: ctx.user.discordId,
      ...ergebnis,
      warnings: ergebnis.warnings.length,
    });

    revalidateLevel();
    revalidatePath('/level/rollen');

    return ergebnis;
  },
);

/**
 * Die Textfarbe der eigenen Levelkarte.
 *
 * Server Action und nicht Route Handler: hier wird keine Datei uebertragen,
 * sondern eine Zeichenkette - und `defineAction` bringt Anmeldung,
 * Mitgliedschaft, CSRF, Ratengrenze, Eingabepruefung und Berechtigung ohne
 * eine zweite Umsetzung derselben Kette mit.
 *
 * Ausdruecklich nur die eigene Karte: ein Ziel aus der Eingabe gibt es
 * nicht. `farbe: null` setzt auf die Standardfarbe zurueck.
 *
 * Die Berechtigung prueft der Dienst noch einmal selbst - er wird auch von
 * anderen Stellen aufgerufen und darf sich nicht darauf verlassen, dass
 * jemand vorher nachgesehen hat.
 */
export const setCustomCardTextColorAction = defineAction(
  {
    name: 'level.customCard.textColor',
    module: MODULE_ID,
    permission: PERMISSIONS.cardCustom,
    schema: level.customCardTextColorSchema,
    rateLimit: 'levelWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    /*
     * Ohne `assertModuleEnabled`, und zwar mit Absicht.
     *
     * Die Farbe sitzt im selben Bereich wie das eigene Kartenbild, unter
     * derselben Berechtigung - und dessen Route fragt das Modul ebenfalls
     * nicht. Beides unterschiedlich zu behandeln hiesse: ein ausgeschaltetes
     * Levelmodul, in dem sich das Bild noch tauschen laesst, die Farbe
     * daneben aber mit einer Fehlermeldung antwortet.
     *
     * Was bleibt, ist der Riegel, auf den es ankommt: `level.card.custom`.
     */
    const ergebnis = await level.setCustomCardTextColor(
      { discordId: ctx.user.discordId, can: (permission: string) => can(ctx, permission) },
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.farbe,
    );

    revalidateLevel();
    revalidatePath('/mitglieder');
    return ergebnis;
  },
);
