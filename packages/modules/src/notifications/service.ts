import { prisma } from '@swisshub/database';
import type { Notification } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { hasPermission, loadRoleConfiguration, resolvePermissions } from '@swisshub/permissions';
import { bootstrapConfig } from '@swisshub/config';
import { istInterneRoute } from '@swisshub/shared';
import { isModuleEnabled } from '../module-state';
import { BENACHRICHTIGUNGSREGELN, GEMELDETE_EREIGNISSE } from './regeln';
import type { Benachrichtigungsregel, Empfaengerkreis } from './types';

const logger = createLogger('notifications');

/**
 * Benachrichtigungen erzeugen, lesen und aufräumen.
 *
 * ## Woher sie kommen
 *
 * Aus `meldeEreignis` - dem einen Weg, auf dem ein Modul meldet, dass etwas
 * geschehen ist. Dort hängt bereits die Automation Engine; die Glocke hängt
 * daneben. Ein zweiter Satz Discord-Listener wäre ein zweites System mit
 * einer zweiten Vorstellung davon, was «ein neues Ticket» ist.
 *
 * ## Wer sie bekommt
 *
 * Wer die Sache sehen darf - entschieden von der bestehenden Permission
 * Engine, mit denselben Rollen und denselben ausdrücklichen Ausnahmen wie
 * überall sonst. **Geprüft wird beim Erstellen und erneut beim Öffnen des
 * Deep Links.** Beides ist nötig: die erste Prüfung verhindert, dass eine
 * Meldung über ein Ticket überhaupt bei jemandem landet, der keine Tickets
 * sehen darf; die zweite verhindert, dass eine alte Meldung nach einem
 * Rollenentzug noch eine Tür öffnet.
 *
 * ## Wie viele
 *
 * Der Empfängerkreis sind angemeldete Benutzer mit zwischengespeicherter
 * Discord-Identität - also Leute, die das Dashboard tatsächlich benutzen.
 * Wer sich nie angemeldet hat, hat keine Glocke, in die etwas fallen könnte.
 */

/** Wie viele Empfänger eine einzelne Meldung höchstens erreicht. */
const HOECHSTENS_EMPFAENGER = 200;

/** Wie viele Meldungen die Glocke auf einmal zeigt. */
export const GLOCKE_SEITENGROESSE = 20;

export interface MeldungsEreignis {
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  actorId?: string | null;
  subjectId?: string | null;
  entityId?: string | null;
}

/**
 * Ein Ereignis in Benachrichtigungen umsetzen.
 *
 * **Wirft nie.** Das Modul, das gemeldet hat, ist mit seiner Arbeit fertig -
 * ein Ticket soll nicht scheitern, weil eine Glocke nicht klingelt.
 */
export async function verteileBenachrichtigungen(ereignis: MeldungsEreignis): Promise<number> {
  // Die billigste Frage zuerst: für die allermeisten Ereignisse gibt es
  // keine Regel, und dann passiert hier gar nichts - keine Abfrage, kein
  // Rollenabgleich.
  if (!GEMELDETE_EREIGNISSE.has(ereignis.type)) {
    return 0;
  }

  let erzeugt = 0;
  for (const regel of BENACHRICHTIGUNGSREGELN) {
    if (regel.eventType !== ereignis.type) {
      continue;
    }
    try {
      erzeugt += await wendeRegelAn(regel, ereignis);
    } catch (error) {
      logger.warn('Benachrichtigung konnte nicht erzeugt werden', {
        eventType: ereignis.type,
        kind: regel.kind,
        error,
      });
    }
  }
  return erzeugt;
}

async function wendeRegelAn(regel: Benachrichtigungsregel, ereignis: MeldungsEreignis): Promise<number> {
  const inhalt = regel.bauen({
    payload: ereignis.payload,
    actorId: ereignis.actorId ?? null,
    subjectId: ereignis.subjectId ?? null,
    entityId: ereignis.entityId ?? null,
  });
  if (!inhalt) {
    return 0;
  }

  // Eine gespeicherte Adresse mit Schema wäre eine offene Weiterleitung mit
  // Ablagefach. Was nicht intern ist, wird gar nicht erst hingeschrieben.
  const route = inhalt.route && istInterneRoute(inhalt.route) ? inhalt.route : null;

  const empfaenger = await ermittleEmpfaenger(regel.empfaenger, ereignis.payload);
  if (empfaenger.length === 0) {
    return 0;
  }

  let erzeugt = 0;
  for (const discordId of empfaenger) {
    // Niemand bekommt eine Meldung über die eigene Tat. Sie wäre keine
    // Nachricht, sondern eine Quittung - und die steht im Audit Log.
    if (ereignis.actorId && ereignis.actorId === discordId) {
      continue;
    }
    const angelegt = await legeAn({
      recipientDiscordId: discordId,
      kind: regel.kind,
      title: inhalt.titel,
      body: inhalt.text ?? null,
      route,
      actorDiscordId: ereignis.actorId ?? null,
      entityId: ereignis.entityId ?? null,
      dedupeKey: `${ereignis.eventId}:${discordId}:${regel.kind}`,
      groupKey: inhalt.gruppe ? `${inhalt.gruppe}` : null,
    });
    if (angelegt) {
      erzeugt += 1;
    }
  }
  return erzeugt;
}

interface AnlageEingabe {
  recipientDiscordId: string;
  kind: string;
  title: string;
  body: string | null;
  route: string | null;
  actorDiscordId: string | null;
  entityId: string | null;
  dedupeKey: string;
  groupKey: string | null;
}

/**
 * Eine Meldung anlegen - oder eine bestehende hochzählen.
 *
 * Zwei Riegel gegen Doppel, und sie greifen an verschiedenen Stellen:
 *
 * 1. **`dedupeKey`.** Ereigniskennung, Empfänger und Art. Wird dasselbe
 *    Ereignis zweimal zugestellt - nach einem Neustart, bei einer
 *    Wiederholung -, scheitert der zweite Einfügeversuch am eindeutigen
 *    Index, und das ist die richtige Antwort.
 * 2. **`groupKey`.** Verschiedene Ereignisse derselben Sache. Fünf
 *    gescheiterte Läufe derselben Automation sind eine Meldung mit einer
 *    Zahl. Die Gruppe wird dabei wieder auf ungelesen gesetzt: es ist wieder
 *    etwas passiert.
 */
async function legeAn(eingabe: AnlageEingabe): Promise<boolean> {
  if (eingabe.groupKey) {
    const bestehend = await prisma.notification.findFirst({
      where: { recipientDiscordId: eingabe.recipientDiscordId, groupKey: eingabe.groupKey },
      orderBy: { createdAt: 'desc' },
    });
    if (bestehend) {
      const aktualisiert = await prisma.notification.updateMany({
        // `dedupeKey` in der Bedingung: hat dieses Ereignis die Gruppe schon
        // hochgezählt, zählt es nicht ein zweites Mal.
        where: { id: bestehend.id, dedupeKey: { not: eingabe.dedupeKey } },
        data: {
          count: { increment: 1 },
          readAt: null,
          title: eingabe.title,
          body: eingabe.body,
          route: eingabe.route,
          dedupeKey: eingabe.dedupeKey,
          actorDiscordId: eingabe.actorDiscordId,
        },
      });
      return aktualisiert.count > 0;
    }
  }

  /*
   * Erst fragen, dann schreiben.
   *
   * Der eindeutige Index ist die Zusicherung - aber er meldet sich als
   * Ausnahme, und die schreibt der Datenbank-Logger als Fehler ins Protokoll.
   * Eine wiederholte Zustellung ist kein Fehler, sondern der gewöhnliche
   * Fall; sie soll nicht jedes Mal wie einer aussehen.
   *
   * Der `catch` bleibt trotzdem: zwischen Frage und Schreiben kann eine
   * zweite Instanz dieselbe Zeile anlegen. Dann greift der Index, und das ist
   * genau seine Aufgabe.
   */
  const vorhanden = await prisma.notification.findUnique({
    where: { dedupeKey: eingabe.dedupeKey },
    select: { id: true },
  });
  if (vorhanden) {
    return false;
  }

  try {
    await prisma.notification.create({ data: eingabe });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wer diese Meldung bekommt.
 *
 * Bei einer Berechtigung: alle angemeldeten Benutzer, deren Discord-Rollen
 * sie nach der Permission Engine einschliessen. Gerechnet wird mit
 * `resolvePermissions` und `hasPermission` - derselben Funktion, die auch die
 * Seite prüft, auf die der Deep Link zeigt. Eine zweite Rechteberechnung gäbe
 * es hier nicht, und damit auch keine zweite Meinung darüber, was `admin.full`
 * und eine ausdrückliche Ausnahme bedeuten.
 */
async function ermittleEmpfaenger(
  kreis: Empfaengerkreis,
  payload: Record<string, unknown>,
): Promise<string[]> {
  if (kreis.art === 'person') {
    const discordId = kreis.discordId(payload);
    return discordId ? [discordId] : [];
  }

  if (kreis.moduleId && !(await isModuleEnabled(kreis.moduleId))) {
    // Ein abgeschaltetes Modul hat keine Seite, auf die der Deep Link führen
    // könnte. Eine Meldung darüber wäre ein Weg ins Leere.
    return [];
  }

  const [konfiguration, benutzer] = await Promise.all([
    loadRoleConfiguration(),
    prisma.user.findMany({
      where: { isBlocked: false, identityCache: { isMember: true } },
      select: { discordId: true, identityCache: { select: { roleIds: true } } },
      orderBy: { lastLoginAt: 'desc' },
      take: HOECHSTENS_EMPFAENGER,
    }),
  ]);

  const empfaenger: string[] = [];
  for (const eintrag of benutzer) {
    const aufloesung = resolvePermissions(
      {
        discordId: eintrag.discordId,
        roleIds: eintrag.identityCache?.roleIds ?? [],
        isOwner: bootstrapConfig.ownerDiscordId === eintrag.discordId,
      },
      konfiguration.mappings,
    );
    if (hasPermission(aufloesung, kreis.permission)) {
      empfaenger.push(eintrag.discordId);
    }
  }
  return empfaenger;
}

// --- Lesen ------------------------------------------------------------------

export interface GlockenAnsicht {
  eintraege: Notification[];
  ungelesen: number;
}

/**
 * Was in der Glocke steht.
 *
 * Ungelesene zuerst, danach nach Alter. Die Zahl oben zählt ausschliesslich
 * ungelesene Meldungen dieser Person - eine Zahl, die etwas anderes zählt als
 * die Liste darunter zeigt, ist eine Zahl, der man nicht mehr glaubt.
 */
export async function glocke(
  recipientDiscordId: string,
  limit = GLOCKE_SEITENGROESSE,
): Promise<GlockenAnsicht> {
  const [eintraege, ungelesen] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientDiscordId },
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: limit,
    }),
    zaehleUngelesene(recipientDiscordId),
  ]);
  return { eintraege, ungelesen };
}

export async function zaehleUngelesene(recipientDiscordId: string): Promise<number> {
  return prisma.notification.count({ where: { recipientDiscordId, readAt: null } });
}

// --- Schreiben --------------------------------------------------------------

/**
 * Eine Meldung als gelesen markieren.
 *
 * Die Kennung allein genügt nicht: ohne den Empfänger in der Bedingung
 * könnte jemand fremde Meldungen als gelesen markieren - und durch die
 * Antwort erfahren, dass es sie gibt. `updateMany` und die Zahl der
 * geänderten Zeilen sind hier keine Umständlichkeit, sondern die Prüfung.
 */
export async function markiereGelesen(recipientDiscordId: string, id: string): Promise<boolean> {
  const ergebnis = await prisma.notification.updateMany({
    where: { id, recipientDiscordId, readAt: null },
    data: { readAt: new Date() },
  });
  return ergebnis.count > 0;
}

/** Alles als gelesen markieren. Gibt zurück, wie viele es betraf. */
export async function markiereAlleGelesen(recipientDiscordId: string): Promise<number> {
  const ergebnis = await prisma.notification.updateMany({
    where: { recipientDiscordId, readAt: null },
    data: { readAt: new Date() },
  });
  return ergebnis.count;
}

// --- Aufbewahrung -----------------------------------------------------------

/** Wie lange eine Meldung stehen bleibt, wenn niemand etwas anderes sagt. */
export const AUFBEWAHRUNG_TAGE = 30;

/**
 * Alte Meldungen entfernen (§34).
 *
 * Gelesene nach der Frist, ungelesene erst nach der doppelten: eine Meldung,
 * die niemand angesehen hat, ist der schlechtere Kandidat zum Wegräumen. Der
 * Lauf hängt im bestehenden Job-Runner des Bots - es gibt keinen zweiten
 * Zeitplaner und kein `setTimeout` über Wochen.
 */
export async function raeumeBenachrichtigungen(
  tage = AUFBEWAHRUNG_TAGE,
  jetzt = new Date(),
): Promise<number> {
  const grenze = new Date(jetzt.getTime() - tage * 86_400_000);
  const harteGrenze = new Date(jetzt.getTime() - tage * 2 * 86_400_000);
  const ergebnis = await prisma.notification.deleteMany({
    where: {
      OR: [
        { readAt: { not: null }, createdAt: { lt: grenze } },
        { readAt: null, createdAt: { lt: harteGrenze } },
      ],
    },
  });
  return ergebnis.count;
}
