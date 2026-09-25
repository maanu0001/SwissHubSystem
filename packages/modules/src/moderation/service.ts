import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { ModerationAction, ModerationActionType, ModerationSource } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import { MODERATION_PERMISSIONS } from './permissions';
import { meldeMassnahme } from './events';
import { assertRangfolge, loadModerationPolicyContext, type ModerationPolicyContext } from './policy';

const log = createLogger('moderation');

/**
 * Das Moderation Center.
 *
 * Ban, Kick und Timeout gehen ueber Discord; Jail bleibt beim Jail-Modul, das
 * es laengst kann. Hier steht keine zweite Jail-Logik - das Moderation Center
 * ist der gemeinsame Eingang, nicht ein zweiter Motor.
 *
 * ## Reihenfolge: erst Discord, dann die Akte
 *
 * Der Eintrag entsteht erst, wenn Discord die Massnahme bestaetigt hat.
 * Andersherum stuende in der Akte ein Bann, den es auf dem Server nie gab -
 * und niemand koennte ihn aufheben, weil es nichts aufzuheben gibt.
 *
 * Ein gescheiterter Versuch verschwindet deshalb nicht, sondern wird als
 * gescheitert vermerkt: wer es versucht hat, ist so interessant wie der
 * Erfolg.
 */

export interface ModerationActor {
  discordId: string;
  username: string;
  roleIds: readonly string[];
  isOwner: boolean;
  can(permission: string): boolean;
}

export interface ModerationOptions {
  gateway?: DiscordGateway;
  /** Vorgeladener Policy-Kontext - spart Discord-Anfragen in Stapelverarbeitung. */
  policyContext?: ModerationPolicyContext;
}

/** Hoechster Discord-Timeout: 28 Tage. Das ist die API, keine Einstellung. */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 3600;

/** Die angebotenen Timeout-Dauern. */
export const TIMEOUT_PRESETS = [
  { label: '5 Minuten', seconds: 300 },
  { label: '10 Minuten', seconds: 600 },
  { label: '30 Minuten', seconds: 1800 },
  { label: '1 Stunde', seconds: 3600 },
  { label: '6 Stunden', seconds: 21_600 },
  { label: '12 Stunden', seconds: 43_200 },
  { label: '1 Tag', seconds: 86_400 },
  { label: '1 Woche', seconds: 604_800 },
] as const;

interface MassnahmeEingabe {
  actor: ModerationActor;
  targetDiscordId: string;
  reason: string;
  /** Interne Notiz - erscheint in der Akte, nicht bei Discord. */
  note?: string | null;
}

/** Pflichtangabe: eine Massnahme ohne Grund ist in einem Monat nicht mehr erklaerbar. */
function pruefeGrund(roh: string): string {
  const grund = sanitizeText(roh, 400);
  if (grund.length < 3) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Bitte einen Grund angeben - er steht später in der Akte.',
    });
  }
  return grund;
}

async function ladeZiel(discordId: string, gateway: DiscordGateway) {
  const member = await gateway.members.get(discordId).catch(() => null);
  return { discordId, member };
}

/**
 * Ziel laden und die Rangfolge pruefen - in einem Schritt, weil das eine ohne
 * das andere nie vorkommt.
 */
async function ladeUndPruefe(
  eingabe: MassnahmeEingabe,
  gateway: DiscordGateway,
  options: ModerationOptions,
  erlaubeNichtmitglied: boolean,
) {
  const [ziel, context] = await Promise.all([
    ladeZiel(eingabe.targetDiscordId, gateway),
    options.policyContext ?? loadModerationPolicyContext(gateway),
  ]);

  assertRangfolge({
    actor: {
      discordId: eingabe.actor.discordId,
      roleIds: eingabe.actor.roleIds,
      isOwner: eingabe.actor.isOwner,
    },
    targetDiscordId: eingabe.targetDiscordId,
    target: ziel.member,
    context,
    erlaubeNichtmitglied,
  });

  return ziel;
}

/**
 * Schreibt den Eintrag in die Akte und ins Audit Log.
 *
 * Beides, weil es zwei Fragen sind: die Akte beantwortet «was ist diesem
 * Mitglied widerfahren», das Audit Log «wer hat in der Anwendung was getan».
 */
async function vermerke(input: {
  type: ModerationActionType;
  actor: ModerationActor;
  target: { discordId: string; username: string };
  reason: string;
  status: 'COMPLETED' | 'FAILED';
  /** Geplantes Ende - nur bei befristeten Massnahmen. */
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  /** Verweis auf den Datensatz, der die Sache traegt - z.B. die Notiz. */
  referenceId?: string | null;
  auditAction: string;
  errorMessage?: string;
  /**
   * Woher die Massnahme kam. Ohne Angabe `WEBAPP` - das Moderation Center
   * ist der einzige Weg hier hinein, und er fuehrt ueber das Dashboard.
   */
  source?: ModerationSource;
}): Promise<ModerationAction> {
  const eintrag = await prisma.moderationAction.create({
    data: {
      type: input.type,
      module: 'moderation',
      actorDiscordId: input.actor.discordId,
      actorUsername: input.actor.username,
      targetDiscordId: input.target.discordId,
      targetUsername: input.target.username,
      reason: input.reason,
      status: input.status,
      // Nur ein tatsaechlich gesetzter Timeout laeuft - ein gescheiterter
      // Versuch bekommt kein Ablaufdatum, sonst zaehlte er als aktiv.
      expiresAt: input.status === 'COMPLETED' ? (input.expiresAt ?? null) : null,
      source: input.source ?? 'WEBAPP',
      actorType: 'HUMAN',
      referenceId: input.referenceId ?? null,
      metadata: { source: input.source ?? 'WEBAPP', ...(input.metadata ?? {}) },
    },
  });

  await safeRecordAudit({
    action: input.auditAction,
    module: 'moderation',
    actorDiscordId: input.actor.discordId,
    actorUsername: input.actor.username,
    targetDiscordId: input.target.discordId,
    targetLabel: input.target.username,
    success: input.status === 'COMPLETED',
    errorMessage: input.errorMessage ?? null,
    metadata: { reason: input.reason, ...(input.metadata ?? {}) },
  });

  // Dieselbe Meldung, die auch eine direkt in Discord verhaengte Massnahme
  // ausloest. Eine Automation, die auf Banns hoert, hoert damit auf alle.
  if (input.status === 'COMPLETED') {
    await meldeMassnahme(eintrag);
  }

  return eintrag;
}

/** Fuehrt die Discord-Seite aus und vermerkt beides - Erfolg wie Fehlschlag. */
async function fuehreAus<T>(
  input: MassnahmeEingabe & {
    type: ModerationActionType;
    auditAction: string;
    targetUsername: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
  arbeit: () => Promise<T>,
): Promise<ModerationAction> {
  const ziel = { discordId: input.targetDiscordId, username: input.targetUsername };

  try {
    await arbeit();
  } catch (error) {
    // Kein «erfolgreich», wenn Discord Nein gesagt hat. Der Versuch bleibt
    // trotzdem in der Akte - er gehoert zur Geschichte des Mitglieds.
    const meldung = error instanceof Error ? error.message : 'unbekannt';
    log.warn('Moderationsmassnahme fehlgeschlagen', { type: input.type, error: meldung });
    await vermerke({
      type: input.type,
      actor: input.actor,
      target: ziel,
      reason: input.reason,
      status: 'FAILED',
      metadata: { ...(input.metadata ?? {}), note: input.note ?? null },
      auditAction: input.auditAction,
      errorMessage: meldung,
    });
    throw new AppError('INTERNAL', {
      userMessage: 'Discord hat die Massnahme abgelehnt. Sie wurde nicht ausgeführt.',
      internalMessage: meldung,
    });
  }

  return vermerke({
    type: input.type,
    actor: input.actor,
    target: ziel,
    reason: input.reason,
    status: 'COMPLETED',
    expiresAt: input.expiresAt ?? null,
    metadata: { ...(input.metadata ?? {}), note: input.note ?? null },
    auditAction: input.auditAction,
  });
}

// --- Bann -----------------------------------------------------------------

export interface BanEingabe extends MassnahmeEingabe {
  /** Wie weit zurueck Nachrichten geloescht werden. Discord: hoechstens 7 Tage. */
  deleteMessageSeconds?: number;
}

export async function banMember(
  eingabe: BanEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.ban)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst niemanden bannen.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  // Ein Bann trifft auch jemanden, der den Server bereits verlassen hat -
  // genau dafuer ist er da.
  const ziel = await ladeUndPruefe(eingabe, gateway, options, true);

  const loeschen = Math.min(Math.max(eingabe.deleteMessageSeconds ?? 0, 0), 604_800);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'BAN',
      auditAction: AUDIT_ACTIONS.MODERATION_BAN,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
      metadata: { deleteMessageSeconds: loeschen },
    },
    () =>
      gateway.bans.add(eingabe.targetDiscordId, {
        reason: `${grund} (${eingabe.actor.username})`,
        deleteMessageSeconds: loeschen,
      }),
  );
}

export async function unbanMember(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.unban)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Banns aufheben.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  const bann = await gateway.bans.get(eingabe.targetDiscordId).catch(() => null);
  if (!bann) {
    throw new AppError('NOT_FOUND', { userMessage: 'Für diese Person besteht kein Bann.' });
  }

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'UNBAN',
      auditAction: AUDIT_ACTIONS.MODERATION_UNBAN,
      targetUsername: 'Unbekannt',
    },
    () => gateway.bans.remove(eingabe.targetDiscordId, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Kick -----------------------------------------------------------------

export async function kickMember(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.kick)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst niemanden kicken.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  // Wer nicht da ist, kann nicht entfernt werden - die Policy sagt das selbst.
  const ziel = await ladeUndPruefe(eingabe, gateway, options, false);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'KICK',
      auditAction: AUDIT_ACTIONS.MODERATION_KICK,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
    },
    () => gateway.members.kick(eingabe.targetDiscordId, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Timeout --------------------------------------------------------------

export interface TimeoutEingabe extends MassnahmeEingabe {
  seconds: number;
}

export async function timeoutMember(
  eingabe: TimeoutEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.timeout)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Timeouts setzen.' });
  }
  if (eingabe.seconds < 60 || eingabe.seconds > MAX_TIMEOUT_SECONDS) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Timeout dauert mindestens eine Minute und höchstens 28 Tage.',
    });
  }

  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeUndPruefe(eingabe, gateway, options, false);

  const bis = new Date(Date.now() + eingabe.seconds * 1000);

  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'TIMEOUT',
      auditAction: AUDIT_ACTIONS.MODERATION_TIMEOUT,
      targetUsername: ziel.member?.displayName ?? 'Unbekannt',
      expiresAt: bis,
      metadata: { seconds: eingabe.seconds },
    },
    () => gateway.members.timeout(eingabe.targetDiscordId, bis, `${grund} (${eingabe.actor.username})`),
  );
}

export async function removeTimeout(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.timeoutRemove)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Timeouts aufheben.' });
  }

  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeZiel(eingabe.targetDiscordId, gateway);
  if (!ziel.member) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Person ist nicht auf dem Server.' });
  }

  // Bewusst ohne Rangfolgepruefung: das Aufheben einer Massnahme kann niemanden
  // schlechter stellen. Wer die Berechtigung hat, darf jeden Timeout beenden -
  // sonst bliebe ein zu hoch gesetzter Timeout haengen, bis er ablaeuft.
  return fuehreAus(
    {
      ...eingabe,
      reason: grund,
      type: 'TIMEOUT_REMOVE',
      auditAction: AUDIT_ACTIONS.MODERATION_TIMEOUT_REMOVE,
      targetUsername: ziel.member.displayName,
    },
    () => gateway.members.timeout(eingabe.targetDiscordId, null, `${grund} (${eingabe.actor.username})`),
  );
}

// --- Notiz ----------------------------------------------------------------

/**
 * Eine interne Notiz in der Moderationsakte.
 *
 * Keine Massnahme - sie geht nicht an Discord und hat keine Wirkung. Sie steht
 * in der Akte, damit der naechste Moderator den Zusammenhang kennt.
 */
export async function addModerationNote(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.notesCreate)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Notizen schreiben.' });
  }
  const grund = pruefeGrund(eingabe.reason);
  const ziel = await ladeZiel(eingabe.targetDiscordId, gateway);
  const zielName = ziel.member?.displayName ?? 'Unbekannt';

  // Die Notiz gehoert in die Mitgliederakte - dort sucht man sie, und dort
  // zeigt das Profil sie an. Frueher stand sie ausschliesslich in der
  // Moderationshistorie: nicht verloren, aber am falschen Ort, und deshalb
  // fuer die Schreibenden verschwunden.
  const { schreibeNotiz } = await import('../members/notes');
  const notiz = await schreibeNotiz(
    { discordId: eingabe.actor.discordId, username: eingabe.actor.username },
    {
      targetDiscordId: eingabe.targetDiscordId,
      targetLabel: zielName,
      content: grund,
      category: 'Moderation',
    },
  );

  // Der Eintrag in der Moderationshistorie bleibt - er haelt fest, *dass*
  // notiert wurde, und verweist auf die Notiz. Der Text steht nur an einer
  // Stelle.
  return vermerke({
    type: 'NOTE',
    actor: eingabe.actor,
    target: { discordId: eingabe.targetDiscordId, username: zielName },
    reason: grund,
    status: 'COMPLETED',
    referenceId: notiz.id,
    auditAction: AUDIT_ACTIONS.MODERATION_NOTE,
  });
}

// --- Oeffentliches Profil sperren ------------------------------------------

/**
 * Das oeffentliche Profil eines Mitglieds vom Netz nehmen.
 *
 * ## Was gesperrt wird - und was nicht
 *
 * **Gesperrt** ist die oeffentliche Seite: `/u/<slug>` liefert keine
 * Profildaten mehr, auch nicht ueber einen geteilten Link, auch nicht in den
 * Vorschaudaten fuer soziale Netze. Besucher sehen eine neutrale Seite ohne
 * Namen und ohne Grund.
 *
 * **Nicht gesperrt** ist alles Uebrige. Das Mitglied bleibt intern
 * verwaltbar, seine Akte bleibt vollstaendig, und es sieht sein eigenes
 * Profil weiterhin - eine Sperre ist eine Massnahme gegen die Aussenwirkung,
 * keine Loeschung. Gespeichert bleibt jedes Feld; nichts an den Daten des
 * Mitglieds wird angefasst.
 *
 * ## Warum sie durch dieselbe Rangfolgepruefung laeuft
 *
 * Weil es eine Massnahme gegen ein Mitglied ist. Wer keinen Moderator bannen
 * darf, soll ihm auch nicht das Profil abschalten koennen - sonst waere
 * dieser Weg die Luecke in einer Regel, die ueberall sonst gilt.
 *
 * ## Befristung
 *
 * `bis` ist freiwillig. Ohne Angabe gilt die Sperre, bis jemand sie aufhebt.
 * Mit Angabe hebt der bestehende Zeitsteuerungs-Durchgang sie auf - kein
 * eigener Zeitgeber, und schon gar keiner im Arbeitsspeicher.
 */
export interface ProfilSperreEingabe extends MassnahmeEingabe {
  /** Geplantes Ende. `null` = bis jemand aufhebt. */
  bis?: Date | null;
}

export async function sperreOeffentlichesProfil(
  eingabe: ProfilSperreEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.profileLock)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine öffentlichen Profile sperren.' });
  }
  const grund = pruefeGrund(eingabe.reason);

  if (eingabe.bis && eingabe.bis.getTime() <= Date.now()) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Ende der Sperre muss in der Zukunft liegen.',
    });
  }

  /*
   * Ein Nichtmitglied darf gesperrt werden.
   *
   * Der Fall ist nicht selten: jemand faellt auf, verlaesst den Server und
   * sein Profil steht weiter im Netz. Genau dann braucht es diese Massnahme
   * am dringendsten - der Weg ueber einen Kick ist dann naemlich zu.
   */
  const ziel = await ladeUndPruefe(eingabe, gateway, options, true);
  const zielName = ziel.member?.displayName ?? 'Unbekannt';

  /*
   * `upsert`, weil nicht jedes Mitglied eine Profilzeile hat.
   *
   * Wer nie etwas eingetragen hat, hat keine - und genau den koennte man
   * sonst nicht sperren. Die angelegte Zeile ist leer bis auf die Sperre;
   * sichtbar wird dadurch nichts, denn die Voreinstellung der Sichtbarkeit
   * ist zurueckhaltend.
   */
  await prisma.memberProfile.upsert({
    where: { discordId: eingabe.targetDiscordId },
    create: {
      discordId: eingabe.targetDiscordId,
      publicLockedAt: new Date(),
      publicLockReason: grund,
      publicLockedByDiscordId: eingabe.actor.discordId,
      publicLockUntil: eingabe.bis ?? null,
    },
    update: {
      publicLockedAt: new Date(),
      publicLockReason: grund,
      publicLockedByDiscordId: eingabe.actor.discordId,
      publicLockUntil: eingabe.bis ?? null,
    },
  });

  return vermerke({
    type: 'PROFILE_LOCK',
    actor: eingabe.actor,
    target: { discordId: eingabe.targetDiscordId, username: zielName },
    reason: grund,
    status: 'COMPLETED',
    expiresAt: eingabe.bis ?? null,
    metadata: { note: eingabe.note ?? null, befristet: Boolean(eingabe.bis) },
    auditAction: AUDIT_ACTIONS.MODERATION_PROFILE_LOCK,
  });
}

/**
 * Die Sperre aufheben.
 *
 * Eigene Berechtigung, aus demselben Grund wie bei der Bann-Aufhebung: hier
 * wird die Entscheidung eines anderen zurueckgenommen.
 */
export async function entsperreOeffentlichesProfil(
  eingabe: MassnahmeEingabe,
  options: ModerationOptions = {},
): Promise<ModerationAction> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!eingabe.actor.can(MODERATION_PERMISSIONS.profileUnlock)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Profilsperren aufheben.' });
  }
  const grund = pruefeGrund(eingabe.reason);

  const { count } = await prisma.memberProfile.updateMany({
    where: { discordId: eingabe.targetDiscordId, publicLockedAt: { not: null } },
    data: { publicLockedAt: null, publicLockReason: null, publicLockUntil: null },
  });
  if (count === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieses Profil ist nicht gesperrt.',
    });
  }

  const ziel = await ladeZiel(eingabe.targetDiscordId, gateway);
  return vermerke({
    type: 'PROFILE_UNLOCK',
    actor: eingabe.actor,
    target: { discordId: eingabe.targetDiscordId, username: ziel.member?.displayName ?? 'Unbekannt' },
    reason: grund,
    status: 'COMPLETED',
    metadata: { note: eingabe.note ?? null },
    auditAction: AUDIT_ACTIONS.MODERATION_PROFILE_UNLOCK,
  });
}

/**
 * Faellige Profilsperren aufheben.
 *
 * Teil des bestehenden Zeitsteuerungs-Durchgangs, nicht eines eigenen: ein
 * zweiter Zeitgeber fuer dieselbe Art Frage waere eine zweite Stelle, die
 * nach einem Neustart vergessen werden kann.
 *
 * Handelnder ist ausdruecklich das System. Den Moderator von damals
 * einzutragen waere falsch - er hat die Sperre gesetzt, nicht aufgehoben.
 */
export async function hebeFaelligeProfilsperrenAuf(jetzt = new Date()): Promise<number> {
  const faellig = await prisma.memberProfile.findMany({
    where: { publicLockedAt: { not: null }, publicLockUntil: { not: null, lte: jetzt } },
    select: { discordId: true, publicLockReason: true },
    take: 100,
  });

  let aufgehoben = 0;
  for (const zeile of faellig) {
    /*
     * Bedingt: zwischen Lesen und Schreiben kann jemand von Hand entsperrt
     * oder die Frist verlaengert haben. Dann geschieht hier nichts.
     */
    const { count } = await prisma.memberProfile.updateMany({
      where: { discordId: zeile.discordId, publicLockUntil: { not: null, lte: jetzt } },
      data: { publicLockedAt: null, publicLockReason: null, publicLockUntil: null },
    });
    if (count === 0) {
      continue;
    }
    aufgehoben += 1;

    await prisma.moderationAction.create({
      data: {
        type: 'PROFILE_UNLOCK',
        module: 'moderation',
        actorDiscordId: 'system',
        actorUsername: 'Zeitsteuerung',
        targetDiscordId: zeile.discordId,
        targetUsername: 'Unbekannt',
        reason: 'Die Frist der Profilsperre ist abgelaufen.',
        status: 'COMPLETED',
        source: 'SYSTEM',
        actorType: 'SYSTEM',
        metadata: { source: 'SYSTEM', vorherigerGrund: zeile.publicLockReason },
      },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.MODERATION_PROFILE_UNLOCK,
      module: 'moderation',
      actorDiscordId: 'system',
      actorUsername: 'Zeitsteuerung',
      targetDiscordId: zeile.discordId,
      targetLabel: zeile.discordId,
      success: true,
      metadata: { grund: 'Frist abgelaufen' },
    });
  }

  if (aufgehoben > 0) {
    log.info('Profilsperren abgelaufen', { aufgehoben });
  }
  return aufgehoben;
}

/** Der Sperrzustand eines Mitglieds - fuer die Akte und die Masken. */
export interface ProfilSperrStand {
  gesperrt: boolean;
  seit: Date | null;
  grund: string | null;
  vonDiscordId: string | null;
  bis: Date | null;
}

export async function profilSperrStand(discordId: string): Promise<ProfilSperrStand> {
  const zeile = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: {
      publicLockedAt: true,
      publicLockReason: true,
      publicLockedByDiscordId: true,
      publicLockUntil: true,
    },
  });
  return {
    gesperrt: zeile?.publicLockedAt != null,
    seit: zeile?.publicLockedAt ?? null,
    grund: zeile?.publicLockReason ?? null,
    vonDiscordId: zeile?.publicLockedByDiscordId ?? null,
    bis: zeile?.publicLockUntil ?? null,
  };
}
