import { randomBytes } from 'node:crypto';
import { prisma, type Prisma, type SpielwahlRound, type SpielwahlSession } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { quelleAusSeed } from '../zufall';
import { modus } from './modi';
import { beruehre, sperre, verlangeFuehrung, verlangeTeilnahme, type Handelnder } from './session';
import { grenzenFuer } from './zustand';

const log = createLogger('spielwahl:runde');

/**
 * Der Lauf einer Entscheidungsrunde.
 *
 * ## Die drei Stellen, an denen es schiefgehen kann
 *
 *   1. **Zwei Starts.** Der Host klickt zweimal, oder Host und Co-Host
 *      gleichzeitig. Verhindert durch die Bedingung im Schreibvorgang: die
 *      Session wechselt nur aus `BEREIT` nach `ENTSCHEIDUNG`, und das gelingt
 *      genau einem.
 *   2. **Zwei Finalisierungen.** Der Timer laeuft ab, waehrend drei Browser
 *      und der Bot gleichzeitig nachsehen. Verhindert durch dieselbe
 *      Bedingung auf der Runde: `LAEUFT` -> `FERTIG` gelingt einmal.
 *   3. **Eine Stimme nach Schluss.** Verhindert in der Transaktion, die die
 *      Stimme schreibt: sie liest die Runde mit und prueft `endsAt` gegen die
 *      Serverzeit.
 *
 * Alle drei Male ist die Bedingung **im** Schreibvorgang und nicht davor. Ein
 * `if` davor ist bei gleichzeitigen Aufrufen kein Riegel, sondern eine
 * Empfehlung.
 */

export interface RundenAnsicht {
  id: string;
  nummer: number;
  modus: SpielwahlRound['modus'];
  status: SpielwahlRound['status'];
  kandidaten: string[];
  seed: string;
  losPunkt: number | null;
  losGesamt: number | null;
  baum: unknown;
  duellIndex: number;
  startedAt: string;
  endsAt: string | null;
  gewinnerCandidateId: string | null;
  entscheidungsart: string | null;
}

/** Wer gerade dabei ist. */
async function anwesendeVon(tx: Prisma.TransactionClient, sessionId: string): Promise<string[]> {
  const zeilen = await tx.spielwahlParticipant.findMany({
    where: { sessionId, leftAt: null },
    select: { discordId: true },
  });
  return zeilen.map((zeile) => zeile.discordId);
}

/**
 * Eine Runde starten.
 *
 * Die Kandidaten werden dabei **eingefroren**: wer danach etwas vorschlaegt,
 * aendert die laufende Runde nicht mehr. Ohne das koennte jemand waehrend
 * einer Abstimmung einen Titel nachschieben, und die Rangfolge waere von
 * einem Moment auf den anderen eine andere.
 */
export async function starte(
  sessionId: string,
  handelnder: Handelnder,
  optionen: { nurUnter?: string[] } = {},
): Promise<string> {
  await verlangeFuehrung(sessionId, handelnder.discordId);
  return starteIntern(sessionId, optionen);
}

async function starteIntern(sessionId: string, optionen: { nurUnter?: string[] } = {}): Promise<string> {
  const jetzt = new Date();

  return prisma.$transaction(async (tx) => {
    const session = await tx.spielwahlSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht mehr.');
    }

    const kandidaten =
      optionen.nurUnter ??
      (
        await tx.spielwahlCandidate.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      ).map((zeile) => zeile.id);

    const grenzen = grenzenFuer(session.modus);
    if (kandidaten.length < grenzen.min) {
      throw conflict(`Dafür braucht es mindestens ${grenzen.min} Spiele.`);
    }
    if (kandidaten.length > grenzen.max) {
      throw conflict(
        `${grenzen.max} Spiele sind das Maximum für diesen Modus - sonst dauert die Entscheidung länger als das Spielen.`,
      );
    }

    /*
     * Der Platz wird belegt, bevor gerechnet wird. Gelingt der Wechsel nicht,
     * war jemand schneller - und dieser Aufruf hat nichts angelegt.
     */
    const belegt = await tx.spielwahlSession.updateMany({
      where: { id: sessionId, status: { in: ['BEREIT'] } },
      data: { status: 'ENTSCHEIDUNG' },
    });
    if (belegt.count !== 1) {
      throw conflict('Die Runde läuft bereits oder ist nicht startbereit.');
    }

    const letzte = await tx.spielwahlRound.findFirst({
      where: { sessionId },
      orderBy: { nummer: 'desc' },
      select: { nummer: true },
    });
    const nummer = (letzte?.nummer ?? 0) + 1;

    const seed = randomBytes(16).toString('hex');
    const anwesende = await anwesendeVon(tx, sessionId);

    const engine = modus(session.modus);
    const { daten } = await engine.starte({ tx, session, kandidaten, anwesende, jetzt }, quelleAusSeed(seed));

    const runde = await tx.spielwahlRound.create({
      data: {
        sessionId,
        nummer,
        modus: session.modus,
        kandidaten,
        seed,
        startedAt: jetzt,
        ...daten,
      },
      select: { id: true },
    });

    await beruehre(tx, sessionId, { currentRound: { connect: { id: runde.id } } });
    log.info('Runde gestartet', { sessionId, rundenId: runde.id, modus: session.modus, nummer });
    return runde.id;
  });
}

/**
 * Eine Stimme abgeben.
 *
 * Alles in einer Transaktion: Runde lesen, Zulaessigkeit pruefen, schreiben.
 * Zwei gleichzeitige Stimmen derselben Person treffen dieselbe Zeile, und die
 * Eindeutigkeit der Tabelle entscheidet, welche steht.
 */
export async function stimme(
  sessionId: string,
  discordId: string,
  candidateId: string,
  duell: number,
): Promise<void> {
  await verlangeTeilnahme(sessionId, discordId);
  const jetzt = new Date();

  await prisma.$transaction(async (tx) => {
    /*
     * Die Sperre sitzt vor dem Zaehlen der eigenen Stimmen.
     *
     * Die Eindeutigkeit der Tabelle verhindert, dass dieselbe Stimme zweimal
     * steht - nicht, dass jemand mit einer verbleibenden Stimme gleichzeitig
     * zwei verschiedene Titel waehlt. Dafuer braucht es die Reihenfolge.
     */
    await sperre(tx, sessionId);
    const session = await tx.spielwahlSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'ENTSCHEIDUNG' || !session.currentRoundId) {
      throw conflict('Gerade läuft keine Abstimmung.');
    }
    const runde = await tx.spielwahlRound.findUnique({ where: { id: session.currentRoundId } });
    if (!runde || runde.status !== 'LAEUFT') {
      throw conflict('Diese Runde ist vorbei.');
    }

    const engine = modus(runde.modus);
    if (!engine.stimme) {
      throw conflict('In diesem Modus wird nicht abgestimmt.');
    }
    await engine.stimme({ tx, session, runde, discordId, candidateId, duell, jetzt });
    await beruehre(tx, sessionId);
  });

  /*
   * Gleich nachsehen, ob das die letzte fehlende Stimme war.
   *
   * Die Alternative waere, auf den naechsten Takt des Live-Stroms zu warten -
   * und damit bis zu zwei Sekunden auf einen Bildschirm zu schauen, auf dem
   * alle laengst gewaehlt haben. Ausserhalb der Transaktion, damit die
   * Stimme auch dann steht, wenn die Pruefung scheitert; sie ist
   * wiederholbar und wird ohnehin von mehreren Seiten aufgerufen.
   */
  await pruefe(sessionId, jetzt);
}

/**
 * Nachsehen, ob die laufende Runde enden kann.
 *
 * **Darf beliebig oft aufgerufen werden**, von beliebig vielen Seiten
 * gleichzeitig: jeder Live-Strom tut es bei jedem Takt, der Bot tut es
 * regelmaessig, und der Host tut es, wenn er «jetzt auswerten» drueckt. Genau
 * einer dieser Aufrufe schliesst die Runde tatsaechlich ab; die uebrigen
 * sehen, dass es schon geschehen ist, und tun nichts.
 */
export async function pruefe(sessionId: string, jetzt = new Date()): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const session = await tx.spielwahlSession.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== 'ENTSCHEIDUNG' || !session.currentRoundId) {
        return false;
      }
      const runde = await tx.spielwahlRound.findUnique({ where: { id: session.currentRoundId } });
      if (!runde || runde.status !== 'LAEUFT') {
        return false;
      }

      const anwesende = await anwesendeVon(tx, sessionId);
      const engine = modus(runde.modus);
      const ausgang = await engine.pruefe(
        { tx, session, kandidaten: runde.kandidaten, anwesende, jetzt },
        runde,
        quelleAusSeed(runde.seed),
      );

      if (ausgang.weiter) {
        if (!ausgang.daten) {
          return false;
        }
        // Zwischenschritt - etwa das naechste Duell. Die Runde laeuft weiter.
        await tx.spielwahlRound.update({ where: { id: runde.id }, data: ausgang.daten });
        await beruehre(tx, sessionId);
        return true;
      }

      if (ausgang.stichwahlUnter && ausgang.stichwahlUnter.length > 1) {
        return stichwahl(tx, session, runde, ausgang.stichwahlUnter, jetzt);
      }

      /*
       * Der Abschluss. Die Bedingung `status: 'LAEUFT'` ist der Riegel: von
       * fuenf gleichzeitigen Pruefungen kommt genau eine hier durch.
       */
      const geschlossen = await tx.spielwahlRound.updateMany({
        where: { id: runde.id, status: 'LAEUFT' },
        data: {
          ...ausgang.daten,
          status: 'FERTIG',
          finishedAt: jetzt,
          gewinnerCandidateId: ausgang.gewinnerCandidateId,
          entscheidungsart: ausgang.entscheidungsart ?? runde.entscheidungsart,
        },
      });
      if (geschlossen.count !== 1) {
        return false;
      }

      await tx.spielwahlSession.updateMany({
        where: { id: sessionId, status: 'ENTSCHEIDUNG' },
        data: { status: 'ERGEBNIS', revision: { increment: 1 } },
      });
      log.info('Runde entschieden', {
        sessionId,
        rundenId: runde.id,
        gewinner: ausgang.gewinnerCandidateId,
        art: ausgang.entscheidungsart,
      });
      return true;
    });
  } catch (error) {
    log.warn('Prüfung der Runde gestört', {
      sessionId,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    return false;
  }
}

/**
 * Aus einer Abstimmung wird eine Stichwahl.
 *
 * Die alte Runde endet ohne Sieger und mit dem Vermerk, warum; die neue
 * beginnt sofort, mit denselben Regeln und weniger Kandidaten. Beides in
 * derselben Transaktion - ein Zwischenzustand, in dem die alte Runde vorbei
 * und die neue noch nicht da ist, waere genau der Moment, in dem ein Strom
 * «keine Runde» meldet.
 */
async function stichwahl(
  tx: Prisma.TransactionClient,
  session: SpielwahlSession,
  runde: SpielwahlRound,
  kandidaten: string[],
  jetzt: Date,
): Promise<boolean> {
  const geschlossen = await tx.spielwahlRound.updateMany({
    where: { id: runde.id, status: 'LAEUFT' },
    data: { status: 'FERTIG', finishedAt: jetzt, entscheidungsart: 'stichwahl' },
  });
  if (geschlossen.count !== 1) {
    return false;
  }

  const seed = randomBytes(16).toString('hex');
  const anwesende = await anwesendeVon(tx, session.id);
  const engine = modus(session.modus);
  const { daten } = await engine.starte({ tx, session, kandidaten, anwesende, jetzt }, quelleAusSeed(seed));

  const neue = await tx.spielwahlRound.create({
    data: {
      sessionId: session.id,
      nummer: runde.nummer + 1,
      modus: session.modus,
      kandidaten,
      seed,
      startedAt: jetzt,
      ...daten,
    },
    select: { id: true },
  });

  await beruehre(tx, session.id, { currentRound: { connect: { id: neue.id } } });
  log.info('Stichwahl eröffnet', { sessionId: session.id, kandidaten: kandidaten.length });
  return true;
}

/**
 * Noch einmal auslosen - genau einmal.
 *
 * Das Zugestaendnis an die Gruppe, die das Ergebnis nicht will. Es ist
 * **einmalig**: waere es unbegrenzt, waere es keine Auslosung mehr, sondern
 * ein Weiterdrehen, bis das Richtige kommt. Wer sich mit dem zweiten
 * Ergebnis auch nicht anfreundet, oeffnet die Vorschlaege neu - und das
 * sehen alle.
 */
export async function loseNeu(sessionId: string, handelnder: Handelnder): Promise<string> {
  await verlangeFuehrung(sessionId, handelnder.discordId);

  const belegt = await prisma.spielwahlSession.updateMany({
    where: { id: sessionId, status: 'ERGEBNIS', nachlosenErlaubt: true, nachgelostAm: null },
    data: { nachgelostAm: new Date(), status: 'BEREIT', revision: { increment: 1 } },
  });
  if (belegt.count !== 1) {
    throw conflict('Einmal neu auslosen - und das ist schon geschehen.');
  }

  const letzte = await prisma.spielwahlRound.findFirst({
    where: { sessionId },
    orderBy: { nummer: 'desc' },
    select: { kandidaten: true },
  });

  return starteIntern(sessionId, { nurUnter: letzte?.kandidaten });
}

/** Noch eine Runde mit denselben Kandidaten - ohne die Vorschlaege zu oeffnen. */
export async function nochEine(sessionId: string, handelnder: Handelnder): Promise<void> {
  await verlangeFuehrung(sessionId, handelnder.discordId);
  const ergebnis = await prisma.spielwahlSession.updateMany({
    where: { id: sessionId, status: 'ERGEBNIS' },
    data: { status: 'BEREIT', currentRoundId: null, revision: { increment: 1 } },
  });
  if (ergebnis.count !== 1) {
    throw conflict('Von hier aus lässt sich keine neue Runde starten.');
  }
}

/**
 * Alle laufenden Runden, deren Zeit abgelaufen ist.
 *
 * Der Rueckhalt fuer den Fall, dass niemand zusieht: schliesst der letzte
 * Browser die Seite, bevor der Timer ablaeuft, bliebe die Runde sonst fuer
 * immer in `LAEUFT`. Der Bot geht sie regelmaessig durch.
 */
export async function faelligeRunden(jetzt = new Date(), limit = 50): Promise<string[]> {
  const runden = await prisma.spielwahlRound.findMany({
    where: { status: 'LAEUFT', endsAt: { lte: jetzt } },
    orderBy: { endsAt: 'asc' },
    take: limit,
    select: { sessionId: true },
  });
  return [...new Set(runden.map((runde) => runde.sessionId))];
}
