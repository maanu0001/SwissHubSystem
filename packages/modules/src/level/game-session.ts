import { prisma, type LevelGameMatch } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import {
  SSP_ROUNDS_TO_WIN,
  c4Drop,
  c4IsDraw,
  c4Winner,
  emptyC4Board,
  emptyTttBoard,
  sspRoundOutcome,
  tttIsDraw,
  tttWinner,
  type C4Board,
  type SspChoice,
  type TttBoard,
} from './game-rules';

/**
 * Spielstand laufender Partien.
 *
 * Jeder Zug läuft in einer Transaktion mit Zeilensperre. Das schliesst den
 * Fall aus, dass zwei schnelle Klicks denselben Spielstand lesen und
 * anschliessend beide darauf aufbauen - beim Vorgänger liess sich damit ein
 * Feld doppelt belegen.
 *
 * Entscheidend dabei: **innerhalb** der Transaktion wird ausschliesslich mit
 * `tx` geschrieben, nie mit dem globalen Client. Der globale Client nimmt
 * eine zweite Verbindung, und die läuft in genau die Sperre, welche die
 * Transaktion selbst gerade hält - sie wartet also auf sich. Sichtbar wurde
 * das als «Transaction already closed» nach fünf Sekunden, und im Discord
 * als generische Fehlermeldung bei jedem Zug.
 */

/**
 * Der Client *innerhalb* der Transaktion.
 *
 * Er trägt denselben Namen wie der globale und kann fast dasselbe - nur läuft
 * er auf derselben Verbindung wie die Sperre. Deshalb steht er hier als
 * eigener Typ und wird durchgereicht, statt dass jede Funktion sich den
 * globalen greift.
 */
type TransaktionsClient = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface SspState {
  kind: 'SSP';
  round: number;
  scores: Record<string, number>;
  /** Wahl der laufenden Runde, sobald beide da sind wird ausgewertet. */
  choices: Record<string, SspChoice>;
  /** Verlauf für die Anzeige. */
  history: Array<{ round: number; choices: Record<string, SspChoice>; winner: string | null }>;
}

export interface TttState {
  kind: 'TTT';
  board: TttBoard;
  turn: string;
  marks: Record<string, 'X' | 'O'>;
}

export interface C4State {
  kind: 'C4';
  board: C4Board;
  turn: string;
  pieces: Record<string, 1 | 2>;
}

export type GameState = SspState | TttState | C4State;

/** Startzustand einer Partie. Der Herausgeforderte beginnt - wie beim Vorgänger. */
export function initialState(match: LevelGameMatch): GameState | null {
  switch (match.kind) {
    case 'XP_SSP':
      return {
        kind: 'SSP',
        round: 1,
        scores: { [match.challengerDiscordId]: 0, [match.opponentDiscordId]: 0 },
        choices: {},
        history: [],
      };
    case 'XP_TTT':
      return {
        kind: 'TTT',
        board: emptyTttBoard(),
        turn: match.challengerDiscordId,
        marks: { [match.challengerDiscordId]: 'X', [match.opponentDiscordId]: 'O' },
      };
    case 'XP_4GEWINNT':
      return {
        kind: 'C4',
        board: emptyC4Board(),
        turn: match.challengerDiscordId,
        pieces: { [match.challengerDiscordId]: 1, [match.opponentDiscordId]: 2 },
      };
    default:
      // Das XP-Battle wird in einem Zug entschieden und braucht keinen Stand.
      return null;
  }
}

export interface MoveResult<TState extends GameState = GameState> {
  match: LevelGameMatch;
  state: TState;
  /** Partie beendet? */
  finished: boolean;
  winnerDiscordId: string | null;
  draw: boolean;
  /** Kurztext für die Anzeige, z.B. das Rundenergebnis. */
  detail?: string;
  /** Zug wurde entgegengenommen, aber es fehlt noch die Gegenseite. */
  waiting?: boolean;
}

/** Was ein Zug ausser dem Zug selbst mitbringt. */
export interface ZugOptionen {
  /**
   * Die Frist bis zum **nächsten** Zug, in Sekunden.
   *
   * Fehlt sie, bleibt `expiresAt` unverändert. Das ist die vorsichtige
   * Richtung für Aufrufer, die keine Einstellungen kennen - sie verlängern
   * dann nichts, statt eine geratene Frist zu setzen.
   */
  zugfristSekunden?: number;
}

/**
 * Führt einen Zug aus.
 *
 * Der Zustandsübergang passiert vollständig innerhalb der Transaktion; die
 * Abrechnung findet danach statt, damit sie nicht an einer Sperre hängt.
 *
 * ## Warum die Frist hier verlängert wird und nicht in den vier Zugfunktionen
 *
 * Weil sie dann nicht zu vergessen ist. `expiresAt` war eine Frist **ab
 * Spielbeginn**: `acceptChallenge` setzte sie einmal, und niemand fasste sie
 * wieder an. Bei Vier gewinnt waren das 120 Sekunden Gesamtspielzeit - danach
 * schloss der Aufräumjob die Partie als `TIMEOUT`, obwohl beide noch
 * abwechselnd zogen, und der nächste Klick lief in «Das Spiel lauft nüme».
 *
 * Gemeint war nie eine Gesamtspielzeit, sondern eine **Zugfrist**: wer nicht
 * mehr zieht, soll den Einsatz des anderen nicht auf Dauer binden. Die
 * Einstellung heisst «Zeitfenster», ihre Vorschläge sind 90, 120 und 240
 * Sekunden - als Frist für einen Zug sind das sinnvolle Werte, als Spielzeit
 * für eine ganze Partie nicht.
 *
 * Die Verlängerung steht deshalb **nach** dem Handler und in derselben
 * Transaktion. Beides ist Absicht: ein unerlaubter Zug wirft, die Transaktion
 * rollt zurück, und die Frist verlängert sich nicht. Nur ein angenommener Zug
 * verlängert sie - und keine künftige fünfte Spielart kann es vergessen.
 */
async function withLockedMatch<T>(
  matchId: string,
  optionen: ZugOptionen,
  handler: (tx: TransaktionsClient, match: LevelGameMatch, state: GameState) => Promise<T> | T,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "LevelGameMatch" WHERE "id" = ${matchId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw notFound('Spiel nicht gefunden', 'Das Spiel gits nümme.');
    }
    const match = await tx.levelGameMatch.findUniqueOrThrow({ where: { id: matchId } });
    if (match.status !== 'RUNNING') {
      throw conflict('Das Spiel lauft nüme.');
    }
    const state = match.state as GameState | null;
    if (!state) {
      throw conflict('Für das Spiel gits kein Spielstand.');
    }

    const ergebnis = await handler(tx, match, state);

    if (optionen.zugfristSekunden !== undefined) {
      /*
       * `updateMany` mit Statusbedingung statt `update`.
       *
       * Kostenlose Versicherung: sollte ein Handler eines Tages selbst den
       * Status setzen, verlängert diese Zeile keine Frist an einer Partie, die
       * gerade zu Ende gegangen ist.
       */
      await tx.levelGameMatch.updateMany({
        where: { id: matchId, status: 'RUNNING' },
        data: { expiresAt: new Date(Date.now() + optionen.zugfristSekunden * 1000) },
      });
    }

    return ergebnis;
  });
}

const other = (match: LevelGameMatch, discordId: string): string =>
  discordId === match.challengerDiscordId ? match.opponentDiscordId : match.challengerDiscordId;

/** Speichert den Startzustand einer angenommenen Partie. */
export async function startState(matchId: string): Promise<LevelGameMatch> {
  const match = await prisma.levelGameMatch.findUniqueOrThrow({ where: { id: matchId } });
  const state = initialState(match);
  if (!state) {
    return match;
  }
  return prisma.levelGameMatch.update({
    where: { id: matchId },
    data: { state: state as unknown as object },
  });
}

/** Eine Runde Schere-Stei-Papier. Gewertet wird, sobald beide gewählt haben. */
export async function playSsp(
  matchId: string,
  discordId: string,
  choice: SspChoice,
  optionen: ZugOptionen = {},
): Promise<MoveResult<SspState>> {
  return withLockedMatch(matchId, optionen, async (tx, match, rawState) => {
    if (rawState.kind !== 'SSP') {
      throw conflict('Falschi Spielart.');
    }
    if (discordId !== match.challengerDiscordId && discordId !== match.opponentDiscordId) {
      throw conflict('Du spielsch da nid mit.');
    }
    const state: SspState = { ...rawState, choices: { ...rawState.choices }, scores: { ...rawState.scores } };
    if (state.choices[discordId]) {
      throw conflict('Du hesch die Rundi scho gwählt.');
    }

    state.choices[discordId] = choice;
    const opponent = other(match, discordId);

    if (!state.choices[opponent]) {
      const saved = await tx.levelGameMatch.update({
        where: { id: matchId },
        data: { state: state as unknown as object },
      });
      return {
        match: saved,
        state,
        finished: false,
        winnerDiscordId: null,
        draw: false,
        waiting: true,
        detail: 'Wartet uf di anderi Wahl.',
      };
    }

    const mine = state.choices[discordId]!;
    const theirs = state.choices[opponent]!;
    const outcome = sspRoundOutcome(mine, theirs);
    const roundWinner = outcome === 0 ? null : outcome === 1 ? discordId : opponent;
    if (roundWinner) {
      state.scores[roundWinner] = (state.scores[roundWinner] ?? 0) + 1;
    }
    state.history.push({ round: state.round, choices: { ...state.choices }, winner: roundWinner });
    state.round += 1;
    state.choices = {};

    const challengerScore = state.scores[match.challengerDiscordId] ?? 0;
    const opponentScore = state.scores[match.opponentDiscordId] ?? 0;
    const winnerDiscordId =
      challengerScore >= SSP_ROUNDS_TO_WIN
        ? match.challengerDiscordId
        : opponentScore >= SSP_ROUNDS_TO_WIN
          ? match.opponentDiscordId
          : null;

    const saved = await tx.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winnerDiscordId !== null,
      winnerDiscordId,
      draw: false,
      detail: roundWinner ? undefined : 'Die Rundi isch unentschide.',
    };
  });
}

export async function playTtt(
  matchId: string,
  discordId: string,
  cell: number,
  optionen: ZugOptionen = {},
): Promise<MoveResult<TttState>> {
  return withLockedMatch(matchId, optionen, async (tx, match, rawState) => {
    if (rawState.kind !== 'TTT') {
      throw conflict('Falschi Spielart.');
    }
    if (rawState.turn !== discordId) {
      throw conflict('Du bisch nid am Zug.');
    }
    const board = [...rawState.board];
    if (board[cell] !== null) {
      throw conflict('Das Fäld isch scho bsetzt.');
    }

    board[cell] = rawState.marks[discordId] ?? 'X';
    const state: TttState = { ...rawState, board, turn: other(match, discordId) };

    const winner = tttWinner(board);
    const draw = tttIsDraw(board);
    const saved = await tx.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winner !== null || draw,
      winnerDiscordId: winner ? discordId : null,
      draw,
    };
  });
}

export async function playC4(
  matchId: string,
  discordId: string,
  column: number,
  optionen: ZugOptionen = {},
): Promise<MoveResult<C4State>> {
  return withLockedMatch(matchId, optionen, async (tx, match, rawState) => {
    if (rawState.kind !== 'C4') {
      throw conflict('Falschi Spielart.');
    }
    if (rawState.turn !== discordId) {
      throw conflict('Du bisch nid am Zug.');
    }
    const board = rawState.board.map((row) => [...row]) as C4Board;
    const piece = rawState.pieces[discordId] ?? 1;
    if (!c4Drop(board, column, piece)) {
      throw conflict('Die Spalte isch voll.');
    }

    const state: C4State = { ...rawState, board, turn: other(match, discordId) };
    const winner = c4Winner(board);
    const draw = c4IsDraw(board);
    const saved = await tx.levelGameMatch.update({
      where: { id: matchId },
      data: { state: state as unknown as object },
    });

    return {
      match: saved,
      state,
      finished: winner !== null || draw,
      winnerDiscordId: winner ? discordId : null,
      draw,
    };
  });
}
