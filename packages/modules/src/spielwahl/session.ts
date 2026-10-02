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
import { GAST_PRAEFIX, gastNameSchema, istGastKennung } from './gast';
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
 * Darf hier und jetzt ohne Konto eine Runde eroeffnet werden?
 *
 * **Das Gegenstueck zu `verlangeGastZugang`** - und aus demselben Grund eine
 * eigene Funktion: eine oeffentliche Aktion hat keine Anmeldung, keine
 * Mitgliedschaft und keine Berechtigung, also braucht sie genau eine
 * Pruefung, die an deren Stelle tritt. `verlangeGastZugang` prueft den Zugang
 * zu **einer Runde**; beim Eroeffnen gibt es noch keine, und geprueft wird
 * stattdessen das Recht, eine anzulegen.
 *
 * Zwei Dinge, und keines davon haengt am Besucher:
 *
 *  1. **Die Servereinstellung `gaesteErlaubt`.** Derselbe Schalter, der ueber
 *     das Mitstimmen entscheidet. Steht er aus, gibt es ohne Konto nichts.
 *  2. **`gastRundenGrenze`.** Die absolute Obergrenze gleichzeitig offener
 *     Gastrunden. Gezaehlt wird ueber das Praefix und nicht ueber eine Liste
 *     von Kennungen: `startsWith('gast:')` trifft genau die Gastkennungen,
 *     weil eine Discord-Kennung eine Ziffernfolge ist. Guildweit, wie alles
 *     in diesem Modul - eine zweite Guild soll die Grenze der ersten nicht
 *     verbrauchen.
 *
 * Warum nicht die Kennung des Besuchers? Weil sie in seinem Cookie steht und
 * er sie loeschen kann. Eine Grenze, die er zuruecksetzen kann, ist keine -
 * siehe `config.ts` zu `gastRundenGrenze`.
 */
export async function verlangeGastEroeffnung(guildId: string): Promise<void> {
  const vorgabe = await einstellungen();

  if (!vorgabe.gaesteErlaubt) {
    throw forbidden(
      'spielwahl: Gastteilnahme serverseitig aus',
      'Ohne Konto geht hier gerade nichts. Melde dich an, um eine Runde zu eröffnen.',
    );
  }

  const gastrunden = await prisma.spielwahlSession.count({
    where: {
      guildId,
      hostDiscordId: { startsWith: GAST_PRAEFIX },
      status: { in: OFFENE_ZUSTAENDE },
      expiresAt: { gt: new Date() },
    },
  });
  if (gastrunden >= vorgabe.gastRundenGrenze) {
    throw policyViolation(
      vorgabe.gastRundenGrenze === 0
        ? 'Eine Runde eröffnen geht hier nur mit Konto. Tritt einer laufenden Runde bei oder melde dich an.'
        : 'Gerade laufen schon viele Runden ohne angemeldeten Host. Tritt einer davon bei - oder melde dich an, dann gilt diese Grenze nicht.',
    );
  }
}

/**
 * Eine Runde eroeffnen - mit Konto oder ohne.
 *
 * Der Schnellstart ruft dieselbe Funktion ohne Optionen auf, und ein Gast
 * ruft **dieselbe** Funktion auf wie ein Mitglied. Es gibt keinen zweiten,
 * einfacheren Weg - sonst haette der Schnellstart eigene Vorgaben, und die
 * waeren irgendwann andere als die im Formular; und ein eigener Gastpfad
 * haette eigene Grenzen, und die waeren irgendwann die laxeren.
 *
 * ## Die zwei zusaetzlichen Pruefungen fuer einen Gast
 *
 *  1. **Die Servereinstellung.** Steht `gaesteErlaubt` aus, gibt es ohne
 *     Konto gar nichts - auch keine eigene Runde. Derselbe Schalter, der
 *     ueber das Mitstimmen entscheidet.
 *  2. **`gastRundenGrenze`.** Die einzige Grenze, die nicht am Cookie haengt
 *     und die ein Besucher deshalb nicht durch Loeschen umgehen kann. Siehe
 *     `config.ts`.
 *
 * `offeneProPerson` gilt fuer beide unveraendert. Fuer ein Mitglied ist es
 * die wirksame Grenze; fuer einen Gast ist es die hoefliche, und die harte
 * steht in Punkt 2.
 */
export async function eroeffne(eingabe: EroeffnenEingabe): Promise<{ id: string; inviteToken: string }> {
  const vorgabe = await einstellungen();
  const alsGast = istGastKennung(eingabe.host.discordId);

  /*
   * Die Gastpruefung steht hier **und** in der Aktion.
   *
   * In der Aktion, weil ein Besucher eine Absage lesen soll, bevor etwas
   * passiert. Hier, weil diese Funktion auch aus dem Bot und aus Tests
   * gerufen wird und nicht darauf vertrauen darf, dass ihr Aufrufer gefragt
   * hat. Es ist dieselbe Funktion, also keine zwei Regeln.
   */
  if (alsGast) {
    await verlangeGastEroeffnung(eingabe.guildId);
  }

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
        /*
         * Zwei Schalter, beide muessen an sein - der Server erlaubt es, der
         * Host will es. Siehe `spielwahlSettingsSchema.gaesteErlaubt`.
         *
         * ## Warum die Vorgabe und nicht `false`
         *
         * Hier stand `optionen.gaesteErlaubt ?? false`, und das war der Grund,
         * warum Gaeste trotz eingeschalteter Servereinstellung nicht
         * beitreten konnten: **jede neue Runde startete gastfrei**. Der Host
         * haette einen Schalter im Regeln-Panel finden muessen, von dem er
         * nichts wusste - und wer den Einladungslink teilte, bekam von seinen
         * Gaesten zu hoeren, dass es nicht geht.
         *
         * Das war auch nicht die Regel im Haus: die Zeile darueber macht es
         * fuer `freieVorschlaege` schon richtig. `gaesteErlaubt` war der
         * Ausreisser.
         *
         * Das Veto des Admins bleibt unveraendert: `&& vorgabe.gaesteErlaubt`
         * steht weiterhin da, und steht die Servereinstellung aus, ist jede
         * Runde zu - egal was ein Host schickt. Was sich aendert, ist allein
         * die Vorgabe, wenn er **nichts** schickt.
         */
        gaesteErlaubt: (optionen.gaesteErlaubt ?? vorgabe.gaesteErlaubt) && vorgabe.gaesteErlaubt,
        nachlosenErlaubt: optionen.nachlosenErlaubt ?? true,
        expiresAt: new Date(Date.now() + vorgabe.verfallStunden * 3600_000),
      },
      select: { id: true, inviteToken: true },
    });

    await tx.spielwahlParticipant.create({
      data: {
        sessionId: angelegt.id,
        discordId: eingabe.host.discordId,
        rolle: 'HOST',
        /*
         * Der Name eines Gastes gehoert in die Zeile, weil es kein Profil
         * gibt, aus dem die Ansicht ihn spaeter holen koennte. Bei einem
         * Mitglied bleibt die Spalte leer - sonst waere sie ein zweiter Ort
         * fuer den Anzeigenamen, und der zweite Ort ist immer der veraltete.
         *
         * `gastNameSchema` prueft hier und nicht im Formular: die Zeile
         * entsteht hier.
         */
        gastName: alsGast ? gastNameSchema.parse(eingabe.host.username) : null,
      },
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

/**
 * Der `Handelnder` eines Gastes.
 *
 * Ein Gast hat kein Profil, aus dem ein `username` kommen koennte - der Name
 * steht in seiner Teilnehmerzeile, weil er ihn dort selbst eingetragen hat.
 * Gebraucht wird er fuer das Protokoll: ein Auditeintrag mit leerem Namen
 * sagt nachher niemandem, wer die Runde beendet hat.
 *
 * Die Kennung kommt **nicht** aus der Eingabe, sondern aus dem Cookie - der
 * Aufrufer gibt `besucher.kennung` weiter. Diese Funktion liest nur nach, wie
 * die Person sich genannt hat, und erfindet nichts: ist keine Zeile da, bleibt
 * es bei «Gast».
 */
export async function handelnderGast(sessionId: string, kennung: string): Promise<Handelnder> {
  const teilnehmer = await prisma.spielwahlParticipant.findUnique({
    where: { sessionId_discordId: { sessionId, discordId: kennung } },
    select: { gastName: true },
  });
  return { discordId: kennung, username: teilnehmer?.gastName ?? 'Gast' };
}

export async function verlangeTeilnahme(sessionId: string, discordId: string): Promise<void> {
  if (!(await rolleVon(sessionId, discordId))) {
    throw forbidden('spielwahl: nicht beigetreten', 'Du bist in dieser Runde nicht dabei.');
  }
}

/**
 * Der Waechter der oeffentlichen Aktionen.
 *
 * **Die eine Pruefung, die an die Stelle der Anmeldung tritt.** Jede Aktion,
 * die ein Gast aufrufen kann, ruft zuerst diese Funktion - `defineAction` mit
 * seiner Kette aus Anmeldung, Mitgliedschaft und Berechtigung steht dort
 * nicht zur Verfuegung, und eine Aktion ohne Ersatz waere ein offener
 * Endpunkt.
 *
 * Geprueft wird dreierlei:
 *
 *  1. **Die Form der Kennung.** Nur `gast:<32 Hexzeichen>`. Damit kann ein
 *     manipuliertes Cookie keine Discord-Kennung tragen und niemand als ein
 *     Mitglied handeln - eine Discord-Kennung ist eine Ziffernfolge und
 *     besteht dieses Muster nie.
 *  2. **Dass diese Runde Gaeste zulaesst.** Der Schalter steht an der
 *     Session, nicht in der Oberflaeche. Ein Link, der in einen fremden Chat
 *     geraet, oeffnet damit nichts, was der Host nicht eingeschaltet hat.
 *  3. **Dass die Runde ueberhaupt noch laeuft.** Eine abgeschlossene oder
 *     verfallene Session nimmt keine Stimmen mehr an.
 *
 * Was sie ausdruecklich **nicht** prueft: ob der Gast schon dabei ist. Das
 * macht `verlangeTeilnahme`, und zwar in den Aktionen, die es brauchen -
 * Beitreten selbst braucht es nicht.
 */
export async function verlangeGastZugang(
  sessionId: string,
  kennung: string,
): Promise<{ id: string; guildId: string; status: SpielwahlStatus }> {
  if (!istGastKennung(kennung)) {
    throw forbidden(
      `spielwahl: Kennung «${kennung.slice(0, 12)}» ist keine Gastkennung`,
      'Diese Sitzung ist abgelaufen. Lade die Seite neu.',
    );
  }

  const session = await prisma.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { id: true, guildId: true, status: true, gaesteErlaubt: true, expiresAt: true },
  });
  if (!session) {
    throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht mehr.');
  }
  if (!session.gaesteErlaubt) {
    throw forbidden(
      `spielwahl: Session ${sessionId} laesst keine Gaeste zu`,
      'Für diese Runde ist die Teilnahme ohne Konto nicht eingeschaltet.',
    );
  }
  if (session.expiresAt < new Date() || !OFFENE_ZUSTAENDE.includes(session.status)) {
    throw conflict('Diese Runde ist vorbei.');
  }

  return { id: session.id, guildId: session.guildId, status: session.status };
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
  gastName?: string | null,
): Promise<'neu' | 'zurueck' | 'schon-dabei'> {
  /*
   * Der Name eines Gastes wird hier geprueft, nicht in der Oberflaeche.
   *
   * Und nur bei einem Gast: einem Mitglied einen Namen mitzugeben waere ein
   * Weg, den Anzeigenamen in der Teilnehmerliste frei zu setzen - der kommt
   * aus dem Profil.
   */
  const istGast = istGastKennung(discordId);
  const name = istGast && gastName ? gastNameSchema.parse(gastName) : null;

  return prisma.$transaction(async (tx) => {
    await sperre(tx, sessionId);
    const session = await tx.spielwahlSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        maxTeilnehmer: true,
        beitrittWaehrendRunde: true,
        expiresAt: true,
        gaesteErlaubt: true,
      },
    });
    if (!session) {
      throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht mehr.');
    }
    if (session.expiresAt < new Date() || !BEITRITT_MOEGLICH.includes(session.status)) {
      throw conflict('Diese Runde nimmt niemanden mehr auf.');
    }
    if (istGast && !session.gaesteErlaubt) {
      throw forbidden(
        'spielwahl: Gaeste nicht zugelassen',
        'Für diese Runde ist die Teilnahme ohne Konto nicht eingeschaltet. Melde dich an, um mitzumachen.',
      );
    }
    if (istGast && !name) {
      throw policyViolation('Bitte einen Namen angeben, unter dem du in der Liste stehst.');
    }

    const vorhanden = await tx.spielwahlParticipant.findUnique({
      where: { sessionId_discordId: { sessionId, discordId } },
      select: { id: true, leftAt: true, rolle: true },
    });

    if (vorhanden && !vorhanden.leftAt) {
      await tx.spielwahlParticipant.update({
        where: { id: vorhanden.id },
        // Ein Gast, der sich umbenennt, behaelt seinen Platz und seine
        // Stimmen - der Name ist eine Beschriftung, keine Identitaet.
        data: { lastSeenAt: new Date(), ...(name ? { gastName: name } : {}) },
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
          ...(name ? { gastName: name } : {}),
        },
      });
      await beruehre(tx, sessionId);
      return 'zurueck';
    }

    await tx.spielwahlParticipant.create({
      data: { sessionId, discordId, rolle: 'GAST', gastName: name },
    });
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
 * Reihenfolge: ein Co-Host zuerst, danach der aelteste anwesende Teilnehmer.
 * Ist niemand mehr da, wird die Runde abgebrochen - eine verwaiste Session
 * waere ein Einladungslink ins Nichts.
 *
 * ## An einen Gast nur in einer Gastrunde
 *
 * Hier stand einmal «niemals an einen Gast», und das war richtig, solange ein
 * Gast nichts durfte. Jetzt kann er eine eigene Runde eroeffnen und fuehren -
 * also kann die Fuehrung einer solchen Runde auch an ihn weiterwandern, sonst
 * waere eine Runde unter drei Leuten ohne Konto nach dem Weggang des ersten
 * abgebrochen.
 *
 * Was bleibt, ist die eine Richtung, die eine Beloerderung waere: in der Runde
 * **eines Mitglieds** wird ein Gast nicht zum Host. Der Weg dorthin waere ein
 * geteilter Einladungslink, und damit waere das Teilen eines Links ein Weg,
 * eine fremde Runde zu uebernehmen.
 *
 * Entschieden wird es nicht hier, sondern in `darfFuehrungTragen` - dieselbe
 * Funktion, die auch `setzeCoHost` und `uebergib` fragen. Drei Aufrufer, eine
 * Regel.
 *
 * Findet sich niemand, wird abgebrochen - dieselbe Antwort wie bei einer
 * leeren Runde, und aus demselben Grund: es ist niemand da, der sie fuehren
 * darf. Eine laufende Abstimmung geht dabei nicht verloren, denn `schliesse`
 * haelt fest, was bis dahin entschieden war.
 */
async function uebergibFuehrung(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  const session = await tx.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { hostDiscordId: true },
  });
  const anwesende = await tx.spielwahlParticipant.findMany({
    where: { sessionId, leftAt: null },
    orderBy: [{ rolle: 'asc' }, { joinedAt: 'asc' }],
  });
  /*
   * Ein Mitglied zuerst, auch in einer Gastrunde.
   *
   * Nicht aus Rang, sondern aus Haltbarkeit: ein Mitglied hat ein Profil, ein
   * Gast ein Cookie. Ist beides da, ist das Mitglied die stabilere Wahl - und
   * eine Gastrunde, die in Mitgliedshand uebergeht, ist der Weg, den die Regel
   * ohnehin erlaubt.
   */
  const gastHost = session !== null && istGastKennung(session.hostDiscordId);
  const naechster =
    anwesende.find((teilnehmer) => !istGastKennung(teilnehmer.discordId)) ??
    (gastHost ? anwesende[0] : undefined);

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
 * Darf diese Kennung in dieser Runde eine Fuehrungsrolle tragen?
 *
 * **Die eine Regel, die den Unterschied zwischen Gast und Mitglied noch
 * macht** - und die einzige Stelle, an der sie steht. Gefragt wird sie von
 * `uebergibFuehrung` (die Fuehrung wandert), `setzeCoHost` (jemand wird
 * ernannt) und `uebergib` (die Fuehrung wird uebergeben).
 *
 * Die Regel lautet: **ein Gast fuehrt nur eine Runde, die ein Gast eroeffnet
 * hat.** Ein Mitglied darf immer fuehren.
 *
 * ## Warum sie so und nicht strenger oder laxer ist
 *
 * Laxer - «ein Gast darf immer fuehren» - machte das Teilen eines
 * Einladungslinks zu einem Weg, eine fremde Runde zu uebernehmen: der Host
 * geht kurz weg, und der Besucher, dem er den Link geschickt hat, aendert die
 * Regeln und entfernt Leute.
 *
 * Strenger - «ein Gast fuehrt nie» - hiesse, dass eine Runde unter Leuten
 * ohne Konto beim Weggang des Eroeffners abbricht. Genau diese Runden sind
 * der Zweck der Oeffnung.
 *
 * ## Warum `hostDiscordId` und keine eigene Spalte
 *
 * Weil der Wert sich nur in die sichere Richtung aendert. Er steht beim
 * Eroeffnen fest und wandert danach ueber dieselben drei Funktionen, die
 * diese Regel befragen: eine Gastrunde kann in Mitgliedshand uebergehen und
 * ist danach eine Mitgliedsrunde, eine Mitgliedsrunde kann nie in Gasthand
 * uebergehen. Eine zusaetzliche Spalte waere ein zweiter Ort fuer dieselbe
 * Auskunft - und eine Migration fuer nichts.
 */
async function darfFuehrungTragen(
  tx: Prisma.TransactionClient,
  sessionId: string,
  kennung: string,
): Promise<boolean> {
  if (!istGastKennung(kennung)) {
    return true;
  }
  const session = await tx.spielwahlSession.findUnique({
    where: { id: sessionId },
    select: { hostDiscordId: true },
  });
  return session !== null && istGastKennung(session.hostDiscordId);
}

/** Dieselbe Frage, aber mit einer Absage statt einer Antwort. */
async function verlangeFuehrungsfaehig(
  tx: Prisma.TransactionClient,
  sessionId: string,
  kennung: string,
  rolle: string,
): Promise<void> {
  if (!(await darfFuehrungTragen(tx, sessionId, kennung))) {
    throw forbidden(
      `spielwahl: Gast ${kennung.slice(0, 12)} soll ${rolle} einer Mitgliedsrunde werden`,
      `In dieser Runde kann nur ein angemeldetes Mitglied ${rolle} sein - sie wurde mit einem Konto eröffnet.`,
    );
  }
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
    await verlangeFuehrungsfaehig(tx, sessionId, ziel, 'Co-Host');
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
    await verlangeFuehrungsfaehig(tx, sessionId, ziel, 'Host');
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
  if (optionen.gaesteErlaubt !== undefined) {
    // Wie bei `freieVorschlaege`: die Servervorgabe ist die Obergrenze, nicht
    // die Voreinstellung. Ein Host kann sie nicht uebersteuern.
    daten.gaesteErlaubt = optionen.gaesteErlaubt && vorgabe.gaesteErlaubt;

    /*
     * In einer Gastrunde ist dieser Schalter die Tuer, durch die der Host
     * selbst hereingekommen ist.
     *
     * Ausgeschaltet verliert er den Zugang zu seiner eigenen Runde -
     * `verlangeGastZugang` prueft `gaesteErlaubt`, und ein Host ohne Zugang
     * kann die Runde nicht einmal beenden. Das waere keine Einstellung,
     * sondern eine Falle, und sie waere mit einem Klick zuzuschlagen.
     *
     * Geprueft wird die Runde und nicht der Aufrufer: auch ein Mitglied als
     * Co-Host soll den Host nicht aussperren koennen. Geht die Fuehrung
     * spaeter an ein Mitglied, ist `hostDiscordId` dessen Kennung und der
     * Schalter wieder frei - dieselbe Richtung wie bei `darfFuehrungTragen`.
     */
    if (!daten.gaesteErlaubt) {
      const session = await prisma.spielwahlSession.findUnique({
        where: { id: sessionId },
        select: { hostDiscordId: true },
      });
      if (session && istGastKennung(session.hostDiscordId)) {
        throw policyViolation(
          'Diese Runde wurde ohne Konto eröffnet - die Teilnahme ohne Konto lässt sich hier nicht abschalten.',
        );
      }
    }
  }
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
