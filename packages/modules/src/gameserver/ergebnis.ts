/**
 * Vom Serverresultat zum Turnierresultat.
 *
 * ## Die wichtigste Zeile dieser Datei
 *
 * `overrideResult(...)` - die Funktion des **bestehenden** Turniermoduls.
 * Der Gameserver rechnet kein Bracket, schreibt keinen Sieger weiter und
 * fuehrt keine zweite Resultattabelle. Er liefert Zahlen; was daraus wird,
 * entscheidet dieselbe Funktion, die es auch entscheidet, wenn ein
 * Teamcaptain das Resultat von Hand meldet - samt Zeilensperre, samt
 * Weiterschieben, samt Ereignisprotokoll.
 *
 * ## Wann nichts geschrieben wird
 *
 * Wenn der Adapter `eindeutig: false` meldet. Dann steht das Resultat in
 * `rawResult`, die Zuordnung geht auf `RESULT_REVIEW`, und ein Mensch sieht
 * sich an, was der Server gesagt hat. Ein Bracket, das auf eine Vermutung
 * hin weiterrueckt, ist schlimmer als eines, das eine Stunde wartet: das
 * eine kostet Zeit, das andere kostet das Turnier.
 */
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { TOURNAMENTS_MODULE_ID } from '../tournaments/config';
import { overrideResult } from '../tournaments/matches';
import { gameAdapter, type AdapterErgebnis } from './adapter';

const log = createLogger('gameserver:ergebnis');

export interface UebernahmeErgebnis {
  uebernommen: boolean;
  /** Wartet auf einen Menschen? */
  pruefung: boolean;
  grund?: string;
}

/**
 * Das Resultat eines Servers ins Turnier uebernehmen.
 *
 * `roh` ist, was der Server gemeldet hat - ungedeutet. Der Adapter macht
 * daraus ein Ergebnis oder sagt, dass er es nicht kann.
 */
export async function uebernimmErgebnis(assignmentId: string, roh: unknown): Promise<UebernahmeErgebnis> {
  const zuordnung = await prisma.matchServerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      match: { select: { id: true, matchNumber: true, bestOf: true, status: true, tournamentId: true } },
      profile: { select: { game: true } },
    },
  });

  if (!zuordnung) {
    return { uebernommen: false, pruefung: false, grund: 'Diese Zuordnung gibt es nicht.' };
  }

  // Das Rohe zuerst festhalten - vor jeder Deutung. Geht danach etwas
  // schief, laesst sich nachsehen, was der Server tatsaechlich sagte.
  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { rawResult: roh as never, phase: 'RESULT_PROCESSING' },
  });

  if (zuordnung.match.status === 'COMPLETED' || zuordnung.match.status === 'FORFEIT') {
    /*
     * Das Resultat steht schon. Kein Fehler: ein zweiter Bericht desselben
     * Servers, ein Retry, ein Neustart mitten in der Uebernahme. Es wird
     * nichts ueberschrieben - wer zuerst da war, hat recht.
     */
    await setzePhase(assignmentId, 'ARCHIVING');
    return { uebernommen: false, pruefung: false, grund: 'Das Resultat stand bereits fest.' };
  }

  const adapter = zuordnung.profile ? gameAdapter(zuordnung.profile.game) : undefined;
  if (!adapter) {
    return zurPruefung(
      assignmentId,
      'Für dieses Spiel gibt es keinen Adapter, der das Resultat lesen könnte.',
    );
  }

  let gelesen: AdapterErgebnis;
  try {
    gelesen = adapter.leseErgebnis(roh, zuordnung.match.bestOf);
  } catch (fehler) {
    log.warn('Resultat nicht lesbar', { assignmentId, fehler });
    return zurPruefung(assignmentId, 'Der Server hat ein Resultat gemeldet, das sich nicht lesen lässt.');
  }

  if (!gelesen.eindeutig) {
    return zurPruefung(assignmentId, gelesen.unklarGrund ?? 'Das Resultat ist nicht eindeutig.');
  }

  try {
    await overrideResult(
      zuordnung.match.id,
      {
        scoreA: gelesen.mapsA,
        scoreB: gelesen.mapsB,
        reason: 'PLAYED',
        games: gelesen.maps.map((map) => ({
          index: map.index,
          map: map.map,
          scoreA: map.scoreA,
          scoreB: map.scoreB,
        })),
      },
      `Ergebnis vom Gameserver für Match ${zuordnung.match.matchNumber}`,
      /*
       * Ein eigener Akteur, nicht ZEITSTEUERUNG. Im Ereignisprotokoll soll
       * stehen, dass der Gameserver das Resultat geliefert hat - nicht, dass
       * «das System» es getan hat. Wer hinterher fragt, woher die Zahl kam,
       * findet die Antwort dort.
       */
      { discordId: 'system', username: 'gameserver', source: 'SYSTEM' },
    );
  } catch (fehler) {
    log.warn('Resultat konnte nicht uebernommen werden', { assignmentId, fehler });
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: {
        phase: 'RESULT_ERROR',
        lastError: (fehler instanceof Error ? fehler.message : 'Unbekannter Fehler').slice(0, 2000),
      },
    });
    return { uebernommen: false, pruefung: false, grund: 'Das Resultat konnte nicht übernommen werden.' };
  }

  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { phase: 'ARCHIVING', finishedAt: new Date(), lastError: null },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_RESULT_APPLIED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetLabel: `Match ${zuordnung.match.matchNumber}`,
    success: true,
    metadata: {
      matchId: zuordnung.match.id,
      mapsA: gelesen.mapsA,
      mapsB: gelesen.mapsB,
      maps: gelesen.maps.length,
    },
  });

  return { uebernommen: true, pruefung: false };
}

async function zurPruefung(assignmentId: string, grund: string): Promise<UebernahmeErgebnis> {
  const zuordnung = await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { phase: 'RESULT_ERROR', resultReview: true, resultReviewReason: grund.slice(0, 500) },
    include: { match: { select: { matchNumber: true, tournamentId: true } } },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_RESULT_REVIEW,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetLabel: `Match ${zuordnung.match.matchNumber}`,
    success: false,
    metadata: { assignmentId, grund },
  });

  return { uebernommen: false, pruefung: true, grund };
}

async function setzePhase(assignmentId: string, phase: 'ARCHIVING'): Promise<void> {
  await prisma.matchServerAssignment.update({ where: { id: assignmentId }, data: { phase } });
}
