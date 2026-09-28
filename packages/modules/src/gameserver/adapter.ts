/**
 * Was ein Spiel koennen muss, damit SwissHub ein Match darauf austragen kann.
 *
 * ## Die Trennlinie
 *
 * Der Orchestrator weiss, **dass** ein Match konfiguriert, gestartet,
 * pausiert und ausgewertet wird. Er weiss nicht, **wie** - das steht im
 * Adapter. Im Orchestrator gibt es deshalb kein `if (game === 'CS2')`, und
 * ein Test haelt das fest.
 *
 * Das ist nicht Schoenheit, sondern die Bedingung dafuer, dass ein zweites
 * Spiel spaeter eine Datei ist und keine Operation am offenen Herzen: wer
 * Valorant, Rocket League oder Minecraft ergaenzen will, schreibt einen
 * Adapter und traegt ihn ein. Der Rest des Moduls bleibt unberuehrt.
 *
 * ## Warum der Adapter nichts speichert
 *
 * Jede Methode bekommt, was sie braucht, und gibt zurueck, was herauskommt.
 * Kein Adapter schreibt in die Datenbank. Sonst gaebe es zwei Stellen, die
 * den Stand eines Matches fuehren, und die waeren sich irgendwann uneinig.
 */
import type { GameServerGame } from '@swisshub/database';

/** Ein Spieler, wie ihn der Server erwartet. */
export interface AdapterSpieler {
  /** Die Kennung in der Welt des Spiels - bei CS2 eine SteamID64. */
  gameId: string;
  /** Der Anzeigename, nur fuer Menschen. */
  name: string;
  slot: 'A' | 'B';
  /** Ersatzspieler duerfen auf den Server, zaehlen aber nicht zur Aufstellung. */
  substitute: boolean;
}

/** Wer ausser den Spielern hineindarf. */
export interface AdapterGast {
  gameId: string;
  name: string;
  rolle: 'ADMIN' | 'CASTER';
}

export interface MatchKonfiguration {
  /** Die Nummer, die Teilnehmer nennen. */
  matchNumber: number;
  teamAName: string;
  teamBName: string;
  bestOf: number;
  /** Die Maps in Spielreihenfolge, wie sie aus dem Veto kamen. */
  maps: string[];
  spieler: AdapterSpieler[];
  gaeste: AdapterGast[];
  /** Das Serverpasswort fuer die Spieler. Leer heisst: keines. */
  serverPassword: string;
  /** Die Einstellungen aus dem Game Profile. */
  profil: {
    slots: number;
    overtime: boolean;
    knifeRound: boolean;
    tacticalPauses: number;
    technicalPauses: number;
    gotvEnabled: boolean;
    demoRecording: boolean;
    warmupSeconds: number;
    readyRule: string;
    adapterOptions: Record<string, unknown>;
  };
  /** Wohin der Server sein Ergebnis melden soll. */
  rueckmeldung: {
    url: string;
    /** Das Token, mit dem SwissHub die Meldung als echt erkennt. */
    token: string;
  };
}

/** Das Ergebnis einer einzelnen Map. */
export interface AdapterMapErgebnis {
  index: number;
  map: string;
  scoreA: number;
  scoreB: number;
}

export interface AdapterErgebnis {
  /** Maps in Spielreihenfolge. */
  maps: AdapterMapErgebnis[];
  /** Wie viele Maps jede Seite geholt hat. */
  mapsA: number;
  mapsB: number;
  /**
   * Ist das Ergebnis eindeutig?
   *
   * `false` heisst nicht «Fehler», sondern «ein Mensch muss draufschauen» -
   * ein abgebrochenes Match, eine fehlende Map, ein Gleichstand, den es bei
   * diesem Modus nicht geben duerfte. Der Bracket wird dann **nicht**
   * angefasst.
   */
  eindeutig: boolean;
  /** Warum nicht eindeutig. Steht im Match Room und im Protokoll. */
  unklarGrund?: string;
}

/** Eine Datei, die der Server hinterlassen hat. */
export interface AdapterDatei {
  kind: 'DEMO' | 'SERVER_LOG' | 'MATCH_DATA';
  /** Der Name auf dem Server. */
  name: string;
  sizeBytes: number;
  /** Zu welcher Map, falls zuordenbar. */
  mapIndex?: number;
}

/**
 * Was der Adapter vom Agent verlangen kann.
 *
 * Bewusst als Schnittstelle uebergeben statt vom Adapter selbst gebaut: so
 * laesst sich ein Adapter gegen einen Agent-Doppelgaenger testen, ohne eine
 * Maschine zu starten - und der Adapter kann keinen anderen Weg nach aussen
 * nehmen als diesen.
 */
export interface AgentZugriff {
  gameStart(): Promise<void>;
  gameStop(): Promise<void>;
  gameRestart(): Promise<void>;
  matchConfigure(nutzlast: Record<string, unknown>): Promise<void>;
  matchPause(): Promise<void>;
  matchUnpause(): Promise<void>;
  matchRestore(runde: number): Promise<void>;
  matchStatus(): Promise<Record<string, unknown>>;
  health(): Promise<{ ok: boolean; gameRunning: boolean; details: Record<string, unknown> }>;
  dateien(): Promise<AdapterDatei[]>;
}

export interface GameAdapter {
  readonly game: GameServerGame;
  readonly label: string;

  /**
   * In welchem Eintrag des Mitgliederprofils die Spielerkennung steht.
   *
   * Ein Schluessel aus der Socials-Registry (`steam`, `riot`, ...). Er steht
   * hier und nicht bei der Aufstellung: «wo die SteamID liegt» ist Wissen
   * ueber CS2, und Wissen ueber ein Spiel gehoert in dessen Adapter.
   *
   * Ein Strukturtest hat diese Zuordnung urspruenglich in `spieler.ts`
   * gefunden - als Karte `{ CS2: 'steam' }`. Sie war richtig und stand am
   * falschen Ort: wer Valorant ergaenzt haette, haette `spieler.ts` anfassen
   * muessen, obwohl der Adapter genau dafuer da ist.
   */
  readonly profilPlattform: string;

  /** Die Ports, die dieses Spiel von aussen braucht. */
  benoetigtePorts(profil: { gotvEnabled: boolean }): { game: number; tv: number | null };

  /** Wie viele Maps bei diesem Modus gespielt werden. */
  mapAnzahl(bestOf: number): number;

  /**
   * Der Ablauf des Vetos bei diesem Modus.
   *
   * Eine Liste von Schritten, nicht ein Algorithmus - so laesst sich der
   * Ablauf nachlesen und im Match Room anzeigen, ohne ihn nachzurechnen.
   */
  vetoAblauf(bestOf: number): VetoSchritt[];

  /** Ist diese Zeichenkette eine gueltige Spielerkennung? */
  pruefeSpielerKennung(wert: string): boolean;

  /** Die Matchkonfiguration in das, was der Server versteht. */
  baueKonfiguration(konfiguration: MatchKonfiguration): Record<string, unknown>;

  /** Den Server so weit bringen, dass er auf das Match wartet. */
  starteServer(agent: AgentZugriff, konfiguration: MatchKonfiguration): Promise<void>;

  stoppeServer(agent: AgentZugriff): Promise<void>;

  /** Laeuft der Server und ist er ansprechbar? */
  pruefeGesundheit(agent: AgentZugriff): Promise<{ ok: boolean; meldung: string }>;

  pausiere(agent: AgentZugriff): Promise<void>;
  setzeFort(agent: AgentZugriff): Promise<void>;
  stelleWiederHer(agent: AgentZugriff, runde: number): Promise<void>;

  /**
   * Aus dem, was der Server meldet, ein Ergebnis machen.
   *
   * Bekommt die rohe Meldung und muss selbst entscheiden, ob sie taugt.
   * Ein Adapter, der im Zweifel `eindeutig: false` sagt, ist richtig - ein
   * Bracket, der auf eine Vermutung hin weiterrueckt, ist es nicht.
   */
  leseErgebnis(roh: unknown, bestOf: number): AdapterErgebnis;

  /** Welche Dateien nach dem Match gesichert werden sollen. */
  dateien(agent: AgentZugriff): Promise<AdapterDatei[]>;
}

/** Ein Schritt im Veto-Ablauf. */
export interface VetoSchritt {
  kind: 'BAN' | 'PICK' | 'DECIDER';
  /** Wer dran ist. `SYSTEM` beim Decider. */
  actor: 'A' | 'B' | 'SYSTEM';
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ADAPTER = new Map<GameServerGame, GameAdapter>();

export function registriereAdapter(adapter: GameAdapter): GameAdapter {
  if (ADAPTER.has(adapter.game)) {
    throw new Error(`Game Adapter fuer ${adapter.game} ist bereits registriert.`);
  }
  ADAPTER.set(adapter.game, adapter);
  return adapter;
}

export function gameAdapter(game: GameServerGame): GameAdapter | undefined {
  return ADAPTER.get(game);
}

export function listeAdapter(): GameAdapter[] {
  return [...ADAPTER.values()];
}
