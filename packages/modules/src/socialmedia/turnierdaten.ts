import { prisma } from '@swisshub/database';
import type { BaumPaarung, BaumRunde, PostBaum } from './posts';

/**
 * Turnierdaten fuer den Post Creator.
 *
 * ## Startbefuellung, nicht Bindung
 *
 * Diese Datei liest ein bestehendes Turnier und bringt es in die Form, die
 * ein Post speichert (`PostBaum`). Was danach damit geschieht, entscheidet
 * der Post: der Schnappschuss gehoert ihm, er ist im Editor aenderbar, und
 * ins Turnier schreibt von hier aus nichts zurueck.
 *
 * Vorher band ein Post sich an eine `tournamentId` und der Baum wurde bei
 * jedem Zeichnen frisch gelesen. Das hiess zweierlei: ohne Turniereintrag
 * liess sich der Typ gar nicht benutzen, und mit einem liess sich am Bild
 * nichts aendern - auch nicht ein zu langer Teamname. Ein Post ist aber eine
 * Aussage zu einem Zeitpunkt, kein Fenster in eine Tabelle.
 *
 * ## Was sie nicht tut
 *
 * Sie rechnet nichts. Keine zweite Turnierlogik: sie fragt die Tabellen ab,
 * die das Turniermodul fuehrt, und ordnet sie in Runden und Paarungen. Sie
 * schreibt nicht, sie setzt keinen Sieger, sie erzeugt keine Paarung.
 */

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
 * Der Baum eines Turniers als Schnappschuss - oder `null`.
 *
 * `null` bei einem Turnier, das es nicht gibt oder das noch keine Paarungen
 * hat. Ein leerer Baum waere eine Grafik mit leeren Klammern, und die sieht
 * aus wie ein Fehler im Export.
 */
export async function ladeTurnierBaum(tournamentId: string, guildId: string): Promise<PostBaum | null> {
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

  const nachRunde = new Map<number, BaumPaarung[]>();
  for (const match of matches) {
    const entschieden = match.status === 'COMPLETED';
    const sieger =
      !entschieden || !match.winnerId
        ? undefined
        : match.winnerId === match.participantAId
          ? ('a' as const)
          : match.winnerId === match.participantBId
            ? ('b' as const)
            : undefined;
    const paarung: BaumPaarung = {
      a: {
        name: teilnehmerName(match.participantA),
        ...(entschieden && match.scoreA !== null ? { punkte: match.scoreA } : {}),
      },
      b: {
        name: teilnehmerName(match.participantB),
        ...(entschieden && match.scoreB !== null ? { punkte: match.scoreB } : {}),
      },
      ...(sieger ? { sieger } : {}),
    };
    const vorhanden = nachRunde.get(match.round);
    if (vorhanden) {
      vorhanden.push(paarung);
    } else {
      nachRunde.set(match.round, [paarung]);
    }
  }

  const runden: BaumRunde[] = [...nachRunde.entries()]
    .sort((links, rechts) => links[0] - rechts[0])
    .map(([nummer, paarungen]) => ({ label: rundenLabel(paarungen.length, nummer), paarungen }));

  return { runden, tournamentId: turnier.id };
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
): Promise<{
  titel: string;
  untertitel: string;
  datum: string | null;
  sieger: string | null;
  /** Der Baum als Startbefuellung - im Editor danach frei aenderbar. */
  baum: PostBaum | null;
} | null> {
  const turnier = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { guildId: true, name: true, gameName: true, startsAt: true },
  });
  if (!turnier || turnier.guildId !== guildId) {
    return null;
  }
  const [ersteter, baum] = await Promise.all([
    prisma.tournamentParticipant.findFirst({
      where: { tournamentId, placement: 1 },
      select: { username: true, team: { select: { name: true } } },
    }),
    ladeTurnierBaum(tournamentId, guildId),
  ]);
  return {
    titel: turnier.name,
    untertitel: turnier.gameName,
    datum: turnier.startsAt ? turnier.startsAt.toISOString().slice(0, 10) : null,
    sieger: ersteter ? teilnehmerName(ersteter) : null,
    baum,
  };
}
