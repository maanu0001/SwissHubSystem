/**
 * Wie viele Maschinen laufen duerfen.
 *
 * ## Warum ueberhaupt Grenzen
 *
 * Weil das Datacenter viele erlaubt und die Rechnung trotzdem kommt. Ein
 * Fehler in der Zeitsteuerung, ein Turnier mit sechzig Matches in einer
 * Runde oder ein Retry, der nicht aufhoert, erzeugen sonst Maschinen, bis
 * jemand hinsieht - und das ist erfahrungsgemaess der Monatsabschluss.
 *
 * ## Warum die Pruefung vor dem Anbieter steht
 *
 * Die Grenze wird gegen die **Datenbank** gezogen, nicht gegen die Antwort
 * des Anbieters. Eine Maschine, die SwissHub angefordert hat, zaehlt ab dem
 * Moment der Anforderung - auch wenn der Anbieter noch nicht geantwortet
 * hat. Andersherum koennten zwanzig gleichzeitige Anforderungen alle
 * «unter der Grenze» sein, weil noch keine fertig ist.
 */
import { prisma, type GameServerGame } from '@swisshub/database';

/**
 * Zustaende, in denen eine Instanz Kapazitaet verbraucht.
 *
 * Ab der Reservierung, nicht erst ab dem laufenden Container - sonst waeren
 * zwanzig gleichzeitige Anforderungen alle «unter der Grenze», weil noch
 * keine fertig ist. Die Zustaende aus der VM-Welt zaehlen weiter mit,
 * solange es Zeilen daraus gibt.
 */
export const BELEGENDE_ZUSTAENDE = [
  'RESERVED',
  'CREATING',
  'STARTING',
  'CONFIGURING',
  'READY',
  'LIVE',
  'STOPPING',
  'STOPPED',
  'ARCHIVING',
  'PENDING',
  'PROVISIONING',
  'BOOTING',
  'AGENT_READY',
  'RUNNING',
] as const;

/** Zustaende, in denen eine Instanz gerade erst entsteht. */
export const ENTSTEHENDE_ZUSTAENDE = [
  'RESERVED',
  'CREATING',
  'STARTING',
  'CONFIGURING',
  'PENDING',
  'PROVISIONING',
  'BOOTING',
] as const;

export interface Grenzwerte {
  maxTotal: number;
  maxPerGame: number;
  maxParallelProvisioning: number;
  maxPerTournament: number;
}

export interface Belegung {
  gesamt: number;
  jeSpiel: number;
  inBereitstellung: number;
  jeTurnier: number;
}

export interface GrenzPruefung {
  erlaubt: boolean;
  /** Welche Grenze im Weg steht - im Klartext, fuer die Oberflaeche. */
  grund?: string;
  belegung: Belegung;
}

export async function zaehleBelegung(game: GameServerGame, tournamentId: string | null): Promise<Belegung> {
  const laufend = { status: { in: [...BELEGENDE_ZUSTAENDE] } };

  const [gesamt, jeSpiel, inBereitstellung, jeTurnier] = await Promise.all([
    prisma.gameServerInstance.count({ where: laufend }),
    prisma.gameServerInstance.count({ where: { ...laufend, game } }),
    prisma.gameServerInstance.count({ where: { status: { in: [...ENTSTEHENDE_ZUSTAENDE] } } }),
    tournamentId
      ? prisma.gameServerInstance.count({ where: { ...laufend, tournamentId } })
      : Promise.resolve(0),
  ]);

  return { gesamt, jeSpiel, inBereitstellung, jeTurnier };
}

/**
 * Darf noch eine Maschine dazukommen?
 *
 * Gibt einen Grund im Klartext zurueck statt nur `false`. Eine Oberflaeche,
 * die «Bereitstellung nicht moeglich» sagt, ohne zu sagen warum, erzeugt
 * genau einen Support-Fall je Vorkommnis.
 */
export async function darfProvisionieren(
  game: GameServerGame,
  tournamentId: string | null,
  grenzen: Grenzwerte,
): Promise<GrenzPruefung> {
  const belegung = await zaehleBelegung(game, tournamentId);

  if (belegung.gesamt >= grenzen.maxTotal) {
    return {
      erlaubt: false,
      grund: `Es laufen bereits ${String(belegung.gesamt)} Instanzen - die Gesamtgrenze liegt bei ${String(grenzen.maxTotal)}.`,
      belegung,
    };
  }
  if (belegung.jeSpiel >= grenzen.maxPerGame) {
    return {
      erlaubt: false,
      grund: `Für ${game} laufen bereits ${belegung.jeSpiel} Server - die Grenze liegt bei ${grenzen.maxPerGame}.`,
      belegung,
    };
  }
  if (belegung.inBereitstellung >= grenzen.maxParallelProvisioning) {
    return {
      erlaubt: false,
      grund: `Es werden gerade ${belegung.inBereitstellung} Server bereitgestellt - mehr als ${grenzen.maxParallelProvisioning} gleichzeitig sind nicht eingestellt. Der nächste Durchgang versucht es erneut.`,
      belegung,
    };
  }
  if (tournamentId && belegung.jeTurnier >= grenzen.maxPerTournament) {
    return {
      erlaubt: false,
      grund: `Dieses Turnier belegt bereits ${belegung.jeTurnier} Server - die Grenze liegt bei ${grenzen.maxPerTournament}.`,
      belegung,
    };
  }

  return { erlaubt: true, belegung };
}
