import { randomBytes } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  prisma,
  safeRecordAudit,
  type Prisma,
  type SpielwahlStatus,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, forbidden, notFound, policyViolation } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { SPIELWAHL_MODULE_ID, type SpielwahlSettings } from './config';
import { BEITRITT_MOEGLICH, OFFENE_ZUSTAENDE, darfWechseln, grenzenFuer } from './zustand';
import type { SessionEinstellungen } from './schemas';

const log = createLogger('spielwahl:session');

export interface Handelnder {
  discordId: string;
  username: string;
}

/**
 * Die Orchestrierung einer Runde.
 *
 * ## Was hier steht und was nicht
 *
 * Hier steht, wie eine Runde entsteht, wer dazukommt, wer sie fuehrt und wie
 * sie endet. **Nicht** hier steht, wie entschieden wird - das machen die drei
 * Modi in `modi/`, und sie wissen nichts voneinander.
 *
 * ## Die Revision
 *
 * Jede Aenderung erhoeht `revision`. Sie ist kein Zeitstempel und keine
 * Versionsnummer zum Anzeigen, sondern die Antwort auf eine einzige Frage:
 * ist diese Nachricht neuer als das, was ich schon habe? Ein Client, der eine
 * Nachricht mit kleinerer Revision bekommt - weil zwei Wege sich ueberholt
 * haben -, wirft sie weg.
 *
 * Erhoeht wird **innerhalb** derselben Transaktion wie die Aenderung. Sonst
 * gaebe es einen Moment, in dem der Zustand neu und die Revision alt ist, und
 * genau in diesem Moment liest ein Strom.
 */

/**
 * Die Session sperren, bis die Transaktion durch ist.
 *
 * ## Wofuer
 *
 * Fuer jede Grenze, die sich **zaehlen** laesst: die Teilnehmerzahl, das
 * Vorschlagskontingent, die Stimmen je Person. Eine Bedingung auf einer
 * Spalte faengt sie nicht - `count()` sieht in PostgreSQL unter `READ
 * COMMITTED` den Stand vor den gleichzeitigen Einfuegungen, und zehn
 * parallele Beitritte lesen deshalb alle dieselbe Neun.
 *
 * Genau das ist im Test passiert: Hoechstzahl drei, elf Leute drin.
 *
 * ## Warum eine Zeilensperre und keine hoehere Isolationsstufe
 *
 * `SERIALIZABLE` wuerde es auch loesen - um den Preis, dass gleichzeitige
 * Vorgaenge mit einem Serialisierungsfehler abbrechen und der Aufrufer sie
 * wiederholen muss. Eine Sperre auf genau der Zeile, um die es geht, stellt
 * sie stattdessen hintereinander. Sie ist kurz: was danach folgt, sind zwei
 * Abfragen und ein `INSERT`.
 *
 * Dasselbe Muster wie beim Stimmenkonto von Clip of the Week.
 */
export async function sperre(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "SpielwahlSession" WHERE "id" = ${sessionId} FOR UPDATE`;
}

/** Erhoeht die Revision - immer zusammen mit der Aenderung, nie danach. */
export async function beruehre(
  tx: Prisma.TransactionClient,
  sessionId: string,
  daten: Prisma.SpielwahlSessionUpdateInput = {},
): Promise<number> {
  const session = await tx.spielwahlSession.update({
    where: { id: sessionId },
    data: { ...daten, revision: { increment: 1 } },
    select: { revision: true },
  });
  return session.revision;
}

function einladungsWert(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Normalisiert einen Titel fuer den Vergleich.
 *
 * «Counter-Strike 2», «counter strike 2» und «Counter‑Strike  2» sind
 * dasselbe Spiel. Entfernt werden Gross-/Kleinschreibung, Zeichen darueber,
 * doppelte Leerzeichen und alles, was kein Buchstabe oder keine Ziffer ist -
 * uebrig bleibt der Kern des Titels.
 */
export function namensKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function einstellungen(): Promise<SpielwahlSettings> {
  return getModuleSettings<SpielwahlSettings>(SPIELWAHL_MODULE_ID);
}

// ---------------------------------------------------------------------------
// Eroeffnen
// ---------------------------------------------------------------------------

export interface EroeffnenEingabe {
  guildId: string;
  host: Handelnder;
  optionen?: SessionEinstellungen;
}

/**
 * Eine Runde eroeffnen.
 *
 * Der Schnellstart ruft dieselbe Funktion ohne Optionen auf. Es gibt keinen
 * zweiten, einfacheren Weg - sonst haette der Schnellstart eigene Vorgaben,
 * und die waeren irgendwann andere als die im Formular.
 */
export async function eroeffne(eingabe: EroeffnenEingabe): Promise<{ id: string; inviteToken: string }> {
  const vorgabe = await einstellungen();

  const offene = await prisma.spielwahlSession.count({
    where: {
      guildId: eingabe.guildId,
      hostDiscordId: eingabe.host.discordId,
      status: { in: OFFENE_ZUSTAENDE },
      expiresAt: { gt: new Date() },
    },
  });
  if (offene >= vorgabe.offeneProPerson) {
    throw policyViolation(
      `Du hast bereits ${offene} offene Runden. Schliess eine davon, bevor du eine neue eröffnest.`,
    );
  }

  const optionen = eingabe.optionen ?? {};
  const maxTeilnehmer = Math.min(
    optionen.maxTeilnehmer ?? vorgabe.maxTeilnehmerGrenze,
    vorgabe.maxTeilnehmerGrenze,
  );

  const session = await prisma.$transaction(async (tx) => {
    const angelegt = await tx.spielwahlSession.create({
      data: {
        guildId: eingabe.guildId,
        inviteToken: einladungsWert(),
        hostDiscordId: eingabe.host.discordId,
        modus: optionen.modus ?? 'ROULETTE',
        vorschlaegeProPerson: optionen.vorschlaegeProPerson ?? vorgabe.vorschlaegeProPerson,
        maxTeilnehmer,
        freieVorschlaege: (optionen.freieVorschlaege ?? vorgabe.freieVorschlaege) && vorgabe.freieVorschlaege,
        abstimmdauerSek: optionen.abstimmdauerSek ?? vorgabe.abstimmdauerSek,
        stimmenProPerson: optionen.stimmenProPerson ?? 1,
        geheimeStimmen: optionen.geheimeStimmen ?? true,
        gleichstand: optionen.gleichstand ?? 'STICHWAHL',
        rouletteGewichtet: optionen.rouletteGewichtet ?? false,
        beitrittWaehrendRunde: optionen.beitrittWaehrendRunde ?? true,
        nachlosenErlaubt: optionen.nachlosenErlaubt ?? true,
        expiresAt: new Date(Date.now() + vorgabe.verfallStunden * 3600_000),
      },
      select: { id: true, inviteToken: true },
    });

    await tx.spielwahlParticipant.create({
      data: { sessionId: angelegt.id, discordId: eingabe.host.discordId, rolle: 'HOST' },
    });

    return angelegt;
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELWAHL_SESSION_CREATED,
    module: SPIELWAHL_MODULE_ID,
    actorDiscordId: eingabe.host.discordId,
    actorUsername: eingabe.host.username,
    success: true,
    metadata: { sessionId: session.id, modus: optionen.modus ?? 'ROULETTE' },
  });

  log.info('Runde eröffnet', { sessionId: session.id, guildId: eingabe.guildId });
  return session;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Eine Session ueber ihren Einladungswert.
 *
 * Die Guild gehoert zur Abfrage und nicht zur Pruefung danach: eine Session
 * einer fremden Guild soll sich nicht einmal laden lassen, auch nicht, um
 * anschliessend abgelehnt zu werden.
 */
export async function findeUeberEinladung(guildId: string, inviteToken: string) {
  return prisma.spielwahlSession.findFirst({ where: { guildId, inviteToken } });
}

export async function finde(guildId: string, sessionId: string) {
  return prisma.spielwahlSession.findFirst({ where: { guildId, id: sessionId } });
}

/** Die Rolle einer Person in dieser Session - `null`, wenn sie nicht dabei ist. */
export async function rolleVon(sessionId: string, discordId: string) {
  const teilnehmer = await prisma.spielwahlParticipant.findUnique({
    where: { sessionId_discordId: { sessionId, discordId } },
    select: { rolle: true, leftAt: true },
  });
  if (!teilnehmer || teilnehmer.leftAt) {
    return null;
  }
  return teilnehmer.rolle;
}

/**
 * Darf diese Person die Runde fuehren?
 *
 * Host und Co-Host - und niemand sonst. Ausdruecklich **nicht** jemand mit
 * `spielwahl.manage`: dieses Recht schliesst eine entgleiste Runde, es fuehrt
 * sie nicht. Wer moderieren muss, soll beenden und nicht mitspielen.
 */
export async function fuehrt(sessionId: string, discordId: string): Promise<boolean> {
  const rolle = await rolleVon(sessionId, discordId);
  return rolle === 'HOST' || rolle === 'COHOST';
}

export async function verlangeFuehrung(sessionId: string, discordId: string): Promise<void> {
  if (!(await fuehrt(sessionId, discordId))) {
    throw forbidden('spielwahl: keine Führungsrolle', 'Das darf nur der Host dieser Runde.');
  }
}

export async function verlangeTeilnahme(sessionId: string, discordId: string): Promise<void> {
  if (!(await rolleVon(sessionId, discordId))) {
    throw forbidden('spielwahl: nicht beigetreten', 'Du bist in dieser Runde nicht dabei.');
  }
}

// ---------------------------------------------------------------------------
// Beitreten und verlassen
// ---------------------------------------------------------------------------

/**
 * Beitreten.
 *
 * Idempotent: wer schon dabei ist, bleibt dabei, und sein Lebenszeichen wird
 * erneuert. Wer frueher gegangen ist, kommt zurueck - mit der Rolle, die er
 * hatte, ausser er war Host; die Hostrolle ist inzwischen woanders.
 */
export async function tritteBei(
  sessionId: string,
  discordId: string,
): Promise<'neu' | 'zurueck' | 'schon-dabei'> {
  return prisma.$transaction(async (tx) => {
    await sperre(tx, sessionId);
    const session = await tx.spielwahlSession.findUnique({
      where: { id: sessionId },
      select: { status: true, maxTeilnehmer: true, beitrittWaehrendRunde: true, expiresAt: true },
    });
    if (!session) {
      throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht mehr.');
    }
    if (session.expiresAt < new Date() || !BEITRITT_MOEGLICH.includes(session.status)) {
      throw conflict('Diese Runde nimmt niemanden mehr auf.');
    }

    const vorhanden = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId } },
      select: { id: true, leftAt: true, rolle: true },
    });

    if (vorhanden && !vorhanden.leftAt) {
      await tx.spielwahlParticipant.update({
        where: { id: vorhanden.id },
        data: { lastSeenAt: new Date() },
      });
      return 'schon-dabei';
    }

    if (session.status === 'ENTSCHEIDUNG' && !session.beitrittWaehrendRunde) {
      throw conflict('Während einer laufenden Runde kommt niemand dazu. Warte auf das Ergebnis.');
    }

    const dabei = await tx.spielwahlParticipant.count({ where: { sessionId, leftAt: null } });
    if (dabei >= session.maxTeilnehmer) {
      throw conflict(`Diese Runde ist voll (${session.maxTeilnehmer} Plätze).`);
    }

    if (vorhanden) {
      await tx.spielwahlParticipant.update({
        where: { id: vorhanden.id },
        data: {
          leftAt: null,
          lastSeenAt: new Date(),
          rolle: vorhanden.rolle === 'HOST' ? 'GAST' : vorhanden.rolle,
        },
      });
      await beruehre(tx, sessionId);
      return 'zurueck';
    }

    await tx.spielwahlParticipant.create({ data: { sessionId, discordId, rolle: 'GAST' } });
    await beruehre(tx, sessionId);
    return 'neu';
  });
}

/**
 * Verlassen.
 *
 * Geht der Host, wandert die Fuehrung weiter - an einen Co-Host, sonst an
 * den, der am laengsten dabei und noch anwesend ist. Eine Runde ohne Host
 * waere eine Runde, die niemand mehr starten kann.
 */
export async function verlasse(sessionId: string, discordId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const teilnehmer = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId } },
      select: { id: true, rolle: true, leftAt: true },
    });
    if (!teilnehmer || teilnehmer.leftAt) {
      return;
    }

    await tx.spielwahlParticipant.update({
      where: { id: teilnehmer.id },
      data: { leftAt: new Date() },
    });

    if (teilnehmer.rolle === 'HOST') {
      await uebergibFuehrung(tx, sessionId);
    }
    await beruehre(tx, sessionId);
  });
}

/**
 * Die Fuehrung an den naechsten weitergeben.
 *
 * Reihenfolge: ein Co-Host zuerst, danach der aelteste anwesende Gast. Ist
 * niemand mehr da, wird die Runde abgebrochen - eine verwaiste Session waere
 * ein Einladungslink ins Nichts.
 */
async function uebergibFuehrung(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  const naechster = await tx.spielwahlParticipant.findFirst({
    where: { sessionId, leftAt: null },
    orderBy: [{ rolle: 'asc' }, { joinedAt: 'asc' }],
  });

  if (!naechster) {
    await tx.spielwahlSession.update({
      where: { id: sessionId },
      data: { status: 'ABGEBROCHEN', closedAt: new Date() },
    });
    return;
  }

  await tx.spielwahlParticipant.update({ where: { id: naechster.id }, data: { rolle: 'HOST' } });
  await tx.spielwahlSession.update({
    where: { id: sessionId },
    data: { hostDiscordId: naechster.discordId },
  });
}

/**
 * Jemanden entfernen.
 *
 * Nur die Fuehrung, und nicht sich selbst - dafuer gibt es «verlassen». Die
 * Zeile bleibt mit `leftAt` stehen: abgegebene Stimmen sollen ihren Absender
 * behalten, sonst waere eine Abstimmung nachtraeglich veraenderbar, indem man
 * Waehler entfernt.
 */
export async function entferne(sessionId: string, ziel: string, handelnder: Handelnder): Promise<void> {
  if (ziel === handelnder.discordId) {
    throw conflict('Dich selbst entfernst du über «Runde verlassen».');
  }
  await verlangeFuehrung(sessionId, handelnder.discordId);

  await prisma.$transaction(async (tx) => {
    const teilnehmer = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId: ziel } },
      select: { id: true, rolle: true, leftAt: true },
    });
    if (!teilnehmer || teilnehmer.leftAt) {
      return;
    }
    if (teilnehmer.rolle === 'HOST') {
      throw conflict('Den Host entfernt niemand.');
    }
    await tx.spielwahlParticipant.update({ where: { id: teilnehmer.id }, data: { leftAt: new Date() } });
    await beruehre(tx, sessionId);
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELWAHL_PARTICIPANT_REMOVED,
    module: SPIELWAHL_MODULE_ID,
    actorDiscordId: handelnder.discordId,
    actorUsername: handelnder.username,
    targetDiscordId: ziel,
    success: true,
    metadata: { sessionId },
  });
}

/** Zum Co-Host machen oder es wieder zuruecknehmen. Nur der Host selbst. */
export async function setzeCoHost(
  sessionId: string,
  ziel: string,
  anHeften: boolean,
  handelnder: Handelnder,
): Promise<void> {
  const rolle = await rolleVon(sessionId, handelnder.discordId);
  if (rolle !== 'HOST') {
    throw forbidden('spielwahl: nur der Host', 'Co-Hosts ernennt der Host.');
  }

  await prisma.$transaction(async (tx) => {
    const teilnehmer = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId: ziel } },
      select: { id: true, rolle: true, leftAt: true },
    });
    if (!teilnehmer || teilnehmer.leftAt || teilnehmer.rolle === 'HOST') {
      return;
    }
    await tx.spielwahlParticipant.update({
      where: { id: teilnehmer.id },
      data: { rolle: anHeften ? 'COHOST' : 'GAST' },
    });
    await beruehre(tx, sessionId);
  });
}

/**
 * Die Fuehrung ausdruecklich uebergeben.
 *
 * Der Weg fuer «ich muss weg, mach du weiter» - im Unterschied zum
 * selbsttaetigen Weiterreichen beim Verlassen ist das eine Entscheidung, und
 * sie steht im Protokoll.
 */
export async function uebergib(sessionId: string, ziel: string, handelnder: Handelnder): Promise<void> {
  const rolle = await rolleVon(sessionId, handelnder.discordId);
  if (rolle !== 'HOST') {
    throw forbidden('spielwahl: nur der Host', 'Die Führung übergibt der Host.');
  }

  await prisma.$transaction(async (tx) => {
    const neu = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId: ziel } },
      select: { id: true, leftAt: true },
    });
    if (!neu || neu.leftAt) {
      throw conflict('Diese Person ist nicht mehr dabei.');
    }
    await tx.spielwahlParticipant.updateMany({
      where: { sessionId, discordId: handelnder.discordId },
      data: { rolle: 'GAST' },
    });
    await tx.spielwahlParticipant.update({ where: { id: neu.id }, data: { rolle: 'HOST' } });
    await beruehre(tx, sessionId, { hostDiscordId: ziel });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELWAHL_HOST_TRANSFERRED,
    module: SPIELWAHL_MODULE_ID,
    actorDiscordId: handelnder.discordId,
    actorUsername: handelnder.username,
    targetDiscordId: ziel,
    success: true,
    metadata: { sessionId },
  });
}

/** Lebenszeichen. Sagt nur, dass jemand noch zusieht. */
export async function melde(sessionId: string, discordId: string): Promise<void> {
  await prisma.spielwahlParticipant.updateMany({
    where: { sessionId, discordId, leftAt: null },
    data: { lastSeenAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Zustandswechsel
// ---------------------------------------------------------------------------

/**
 * Den Zustand weiterschalten.
 *
 * Die Bedingung sitzt **im** Schreibvorgang (`updateMany` mit `status`), nicht
 * davor. Zwei gleichzeitige Aufrufe treffen damit dieselbe Zeile, und genau
 * einer trifft sie in dem Zustand, den er erwartet hat; der andere bekommt
 * `count: 0` und weiss, dass er zu spaet war.
 */
export async function wechsle(
  sessionId: string,
  von: SpielwahlStatus[],
  nach: SpielwahlStatus,
  daten: Prisma.SpielwahlSessionUncheckedUpdateManyInput = {},
): Promise<boolean> {
  const erlaubt = von.filter((zustand) => darfWechseln(zustand, nach));
  if (erlaubt.length === 0) {
    return false;
  }
  const ergebnis = await prisma.spielwahlSession.updateMany({
    where: { id: sessionId, status: { in: erlaubt } },
    data: { ...daten, status: nach, revision: { increment: 1 } },
  });
  return ergebnis.count === 1;
}

/**
 * Die Einstellungen einer laufenden Runde aendern.
 *
 * Nur, solange nicht entschieden wird. Den Modus mitten in einer Abstimmung
 * zu wechseln waere kein Fehler des Aufrufers, sondern eine Luecke: die
 * Regeln stuenden dann nach dem Abstimmen anders da als davor.
 *
 * `maxTeilnehmer` wird an der Servergrenze abgeschnitten - eine Session darf
 * unter der Grenze bleiben, nicht darueber.
 */
export async function aendereEinstellungen(sessionId: string, optionen: SessionEinstellungen): Promise<void> {
  const vorgabe = await einstellungen();

  const daten: Prisma.SpielwahlSessionUncheckedUpdateInput = {};
  if (optionen.modus !== undefined) daten.modus = optionen.modus;
  if (optionen.vorschlaegeProPerson !== undefined) daten.vorschlaegeProPerson = optionen.vorschlaegeProPerson;
  if (optionen.maxTeilnehmer !== undefined) {
    daten.maxTeilnehmer = Math.min(optionen.maxTeilnehmer, vorgabe.maxTeilnehmerGrenze);
  }
  if (optionen.freieVorschlaege !== undefined) {
    daten.freieVorschlaege = optionen.freieVorschlaege && vorgabe.freieVorschlaege;
  }
  if (optionen.abstimmdauerSek !== undefined) daten.abstimmdauerSek = optionen.abstimmdauerSek;
  if (optionen.stimmenProPerson !== undefined) daten.stimmenProPerson = optionen.stimmenProPerson;
  if (optionen.geheimeStimmen !== undefined) daten.geheimeStimmen = optionen.geheimeStimmen;
  if (optionen.gleichstand !== undefined) daten.gleichstand = optionen.gleichstand;
  if (optionen.rouletteGewichtet !== undefined) daten.rouletteGewichtet = optionen.rouletteGewichtet;
  if (optionen.beitrittWaehrendRunde !== undefined)
    daten.beitrittWaehrendRunde = optionen.beitrittWaehrendRunde;
  if (optionen.nachlosenErlaubt !== undefined) daten.nachlosenErlaubt = optionen.nachlosenErlaubt;

  if (Object.keys(daten).length === 0) {
    return;
  }

  const ergebnis = await prisma.spielwahlSession.updateMany({
    where: { id: sessionId, status: { in: ['LOBBY', 'BEREIT'] } },
    data: { ...daten, revision: { increment: 1 } },
  });
  if (ergebnis.count !== 1) {
    throw conflict('Während einer laufenden Entscheidung ändern sich die Regeln nicht mehr.');
  }
}

/**
 * Die Vorschlagsphase schliessen.
 *
 * Mit der Pruefung, ob ueberhaupt genug zur Auswahl steht - ein Roulette mit
 * einem Los ist kein Roulette, sondern eine Ansage.
 */
export async function schliesseVorschlaege(sessionId: string, handelnder: Handelnder): Promise<void> {
  await verlangeFuehrung(sessionId, handelnder.discordId);

  const session = await prisma.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { modus: true },
  });
  if (!session) {
    throw notFound('spielwahl: Session unbekannt');
  }

  const anzahl = await prisma.spielwahlCandidate.count({ where: { sessionId } });
  const grenzen = grenzenFuer(session.modus);
  if (anzahl < grenzen.min) {
    throw conflict(
      `Für ${session.modus === 'ELIMINATION' ? 'ein Duell' : 'eine Auswahl'} braucht es mindestens ${grenzen.min} Spiele.`,
    );
  }

  if (!(await wechsle(sessionId, ['LOBBY'], 'BEREIT'))) {
    throw conflict('Die Vorschlagsphase ist nicht mehr offen.');
  }
}

/**
 * Die Vorschlagsphase wieder oeffnen - «wir haben jemanden vergessen».
 *
 * Damit faengt die Auswahl neu an, und deshalb steht auch das einmalige
 * Nachlosen wieder zur Verfuegung: die Beschraenkung gilt einem Ergebnis,
 * nicht einem Abend. Wer die Liste umbaut, lost nicht dasselbe noch einmal.
 */
export async function oeffneVorschlaege(sessionId: string, handelnder: Handelnder): Promise<void> {
  await verlangeFuehrung(sessionId, handelnder.discordId);
  if (
    !(await wechsle(sessionId, ['BEREIT', 'ERGEBNIS'], 'LOBBY', { currentRoundId: null, nachgelostAm: null }))
  ) {
    throw conflict('Von hier aus lassen sich die Vorschläge nicht mehr öffnen.');
  }
}

/** Das Ergebnis annehmen. Damit ist die Runde vorbei. */
export async function nimmAn(sessionId: string, handelnder: Handelnder): Promise<void> {
  await verlangeFuehrung(sessionId, handelnder.discordId);

  const session = await prisma.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { currentRoundId: true, currentRound: { select: { gewinnerCandidateId: true } } },
  });
  const gewinner = session?.currentRound?.gewinnerCandidateId ?? null;
  if (!gewinner) {
    throw conflict('Es steht noch kein Ergebnis fest.');
  }

  if (
    !(await wechsle(sessionId, ['ERGEBNIS'], 'ABGESCHLOSSEN', {
      ergebnisCandidateId: gewinner,
      ergebnisAm: new Date(),
      closedAt: new Date(),
    }))
  ) {
    throw conflict('Diese Runde ist nicht mehr offen.');
  }
}

/**
 * Die Runde schliessen.
 *
 * Der Host darf es immer, ein Moderator mit `spielwahl.manage` auch bei
 * fremden Runden - das Recht wird eine Ebene darueber geprueft und hier
 * ausdruecklich hereingereicht, damit an dieser Stelle sichtbar bleibt, dass
 * es zwei Wege gibt.
 */
export async function schliesse(
  sessionId: string,
  handelnder: Handelnder,
  optionen: { alsModeration?: boolean } = {},
): Promise<void> {
  if (!optionen.alsModeration) {
    await verlangeFuehrung(sessionId, handelnder.discordId);
  }

  const geschlossen = await wechsle(sessionId, OFFENE_ZUSTAENDE, 'ABGEBROCHEN', { closedAt: new Date() });
  if (!geschlossen) {
    return;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELWAHL_SESSION_CLOSED,
    module: SPIELWAHL_MODULE_ID,
    actorDiscordId: handelnder.discordId,
    actorUsername: handelnder.username,
    success: true,
    metadata: { sessionId, alsModeration: optionen.alsModeration === true },
  });
}

/**
 * Verfallene Runden aufraeumen.
 *
 * Nicht loeschen, sondern schliessen: der Verlauf einer Gruppe («letzten
 * Freitag kam Deep Rock heraus») soll bleiben. Was endet, ist die
 * Erreichbarkeit ueber den Einladungslink.
 */
export async function raeumeAuf(jetzt = new Date()): Promise<number> {
  const ergebnis = await prisma.spielwahlSession.updateMany({
    where: { status: { in: OFFENE_ZUSTAENDE }, expiresAt: { lt: jetzt } },
    data: { status: 'ABGEBROCHEN', closedAt: jetzt, revision: { increment: 1 } },
  });
  if (ergebnis.count > 0) {
    log.info('Verfallene Runden geschlossen', { anzahl: ergebnis.count });
  }
  return ergebnis.count;
}
