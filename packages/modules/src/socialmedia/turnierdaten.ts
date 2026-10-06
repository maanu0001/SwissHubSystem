import { prisma } from '@swisshub/database';

/**
 * Turnierdaten fuer den Post Creator (§45).
 *
 * ## Warum gelesen und nicht gespeichert
 *
 * Weil es die Turnierlogik schon gibt. Ein Post speichert die **Kennung** des
 * Turniers, nie seine Paarungen; der Baum entsteht beim Zeichnen aus dem
 * Turnier selbst. Die Alternative waere eine Kopie der Paarungen im Post - und
 * damit ein Bild, das nach dem naechsten Spiel noch den alten Stand zeigt,
 * obwohl beides «aus dem Turnier» heisst.
 *
 * Es ist ausserdem die Antwort auf «keine zweite Turnierlogik»: diese Datei
 * rechnet nichts. Sie fragt die Tabellen ab, die das Turniermodul fuehrt, und
 * bringt sie in die Form, die eine Grafik braucht - eine Runde ist eine
 * Spalte, ein Match sind zwei Zeilen.
 *
 * ## Was sie nicht tut
 *
 * Sie schreibt nicht, sie setzt keinen Sieger, sie erzeugt keine Paarung. Wer
 * den Baum aendern will, tut das im Turniermodul.
 */

export interface BaumTeilnehmer {
  name: string;
  /** Hat diese Seite das Match gewonnen? `null`: noch nicht entschieden. */
  sieger: boolean | null;
  punkte: number | null;
}

export interface BaumMatch {
  nummer: number;
  a: BaumTeilnehmer;
  b: BaumTeilnehmer;
  entschieden: boolean;
}

export interface BaumRunde {
  runde: number;
  /** «Viertelfinal», «Halbfinal», «Final» - aus der Zahl der Matches. */
  label: string;
  matches: BaumMatch[];
}

export interface TurnierBaum {
  tournamentId: string;
  name: string;
  spiel: string;
  runden: BaumRunde[];
  /** Der Gesamtsieger, wenn das Turnier durch ist. */
  sieger: string | null;
}

/** Wie eine Runde heisst, wenn sie `matches` Begegnungen hat. */
function rundenLabel(matches: number, runde: number): string {
  if (matches === 1) return 'Final';
  if (matches === 2) return 'Halbfinal';
  if (matches === 4) return 'Viertelfinal';
  if (matches === 8) return 'Achtelfinal';
  return `Runde ${runde}`;
}

/** Der Anzeigename einer Seite - Team zuerst, dann Discord-Name. */
function teilnehmerName(
  teilnehmer: { username: string | null; team: { name: string } | null } | null,
): string {
  if (!teilnehmer) {
    // Noch offen - und ausdruecklich nicht «Unbekannt»: eine leere Klammer im
    // Baum heisst «wird noch ermittelt», und so sieht sie auch aus.
    return '';
  }
  return teilnehmer.team?.name ?? teilnehmer.username ?? '';
}

/**
 * Der Baum eines Turniers - oder `null`.
 *
 * `null` bei einem Turnier, das es nicht gibt oder das noch keine Paarungen
 * hat. Ein leerer Baum waere eine Grafik mit leeren Klammern, und die sieht
 * aus wie ein Fehler im Export.
 */
export async function ladeTurnierBaum(tournamentId: string, guildId: string): Promise<TurnierBaum | null> {
  const turnier = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, guildId: true, name: true, gameName: true, status: true },
  });
  if (!turnier || turnier.guildId !== guildId) {
    return null;
  }

  const matches = await prisma.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: 'asc' }, { position: 'asc' }],
    select: {
      matchNumber: true,
      round: true,
      status: true,
      scoreA: true,
      scoreB: true,
      winnerId: true,
      participantAId: true,
      participantBId: true,
      participantA: { select: { username: true, team: { select: { name: true } } } },
      participantB: { select: { username: true, team: { select: { name: true } } } },
    },
  });
  if (matches.length === 0) {
    return null;
  }

  const nachRunde = new Map<number, BaumRunde>();
  for (const match of matches) {
    const entschieden = match.status === 'COMPLETED';
    const eintrag: BaumMatch = {
      nummer: match.matchNumber,
      a: {
        name: teilnehmerName(match.participantA),
        sieger: entschieden ? match.winnerId === match.participantAId : null,
        punkte: entschieden ? match.scoreA : null,
      },
      b: {
        name: teilnehmerName(match.participantB),
        sieger: entschieden ? match.winnerId === match.participantBId : null,
        punkte: entschieden ? match.scoreB : null,
      },
      entschieden,
    };
    const runde = nachRunde.get(match.round);
    if (runde) {
      runde.matches.push(eintrag);
    } else {
      nachRunde.set(match.round, { runde: match.round, label: '', matches: [eintrag] });
    }
  }

  const runden = [...nachRunde.values()].sort((links, rechts) => links.runde - rechts.runde);
  for (const runde of runden) {
    runde.label = rundenLabel(runde.matches.length, runde.runde);
  }

  /*
   * Der Gesamtsieger - nur, wenn es ihn gibt.
   *
   * Platzierung 1 ist die Aussage des Turniermoduls darueber, wer gewonnen
   * hat. Ihn aus dem letzten Match zu erraten waere eine zweite Logik, und
   * bei Double Elimination waere sie falsch.
   */
  const ersteter = await prisma.tournamentParticipant.findFirst({
    where: { tournamentId, placement: 1 },
    select: { username: true, team: { select: { name: true } } },
  });

  return {
    tournamentId: turnier.id,
    name: turnier.name,
    spiel: turnier.gameName,
    runden,
    sieger: ersteter ? teilnehmerName(ersteter) : null,
  };
}

export interface TurnierWahl {
  id: string;
  name: string;
  spiel: string;
  status: string;
  startetAm: Date | null;
}

/** Die Turniere, die zur Auswahl stehen - das Neueste oben. */
export async function ladeTurnierWahl(guildId: string, limit = 25): Promise<TurnierWahl[]> {
  const zeilen = await prisma.tournament.findMany({
    where: { guildId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: { id: true, name: true, gameName: true, status: true, startsAt: true },
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    name: zeile.name,
    spiel: zeile.gameName,
    status: zeile.status,
    startetAm: zeile.startsAt,
  }));
}

/**
 * Vorschlaege aus einem Turnier - fuer die Felder, die es fuellen kann.
 *
 * Ausdruecklich **Vorschlaege**: sie werden in den Editor geschrieben, nicht
 * an den Post gebunden. Wer den Titel danach aendert, behaelt seine Aenderung;
 * ein Feld, das sich beim naechsten Oeffnen wieder selbst ueberschreibt,
 * waere ein Feld, dem man nicht trauen kann.
 */
export async function turnierVorschlag(
  tournamentId: string,
  guildId: string,
): Promise<{ titel: string; untertitel: string; datum: string | null; sieger: string | null } | null> {
  const turnier = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { guildId: true, name: true, gameName: true, startsAt: true },
  });
  if (!turnier || turnier.guildId !== guildId) {
    return null;
  }
  const ersteter = await prisma.tournamentParticipant.findFirst({
    where: { tournamentId, placement: 1 },
    select: { username: true, team: { select: { name: true } } },
  });
  return {
    titel: turnier.name,
    untertitel: turnier.gameName,
    datum: turnier.startsAt ? turnier.startsAt.toISOString().slice(0, 10) : null,
    sieger: ersteter ? teilnehmerName(ersteter) : null,
  };
}
