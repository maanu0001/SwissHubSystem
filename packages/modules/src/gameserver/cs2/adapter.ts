/**
 * Counter-Strike 2.
 *
 * ## Warum SwissHub keinen eigenen Match-Manager baut
 *
 * Weil es ihn gibt. Ein Competitive-Match auf einem CS2-Dedicated-Server -
 * Knife Round, Seitenwechsel, Overtime, Pausen, Backup-Runden,
 * Wiederherstellung nach einem Absturz - ist ein geloestes Problem, und die
 * etablierten Server-Plugins loesen es besser, als ein nebenher gebauter
 * Zustandsautomat es koennte. Sie laufen **im** Spiel und sehen, was
 * passiert; SwissHub sieht nur, was ueber das Netz kommt.
 *
 * SwissHub ist deshalb der **Veranstalter**, nicht der Schiedsrichter: es
 * sorgt fuer die Maschine, legt die Konfiguration hin, sagt «los» und nimmt
 * am Ende das Ergebnis entgegen. Was dazwischen auf dem Server passiert,
 * macht das Plugin.
 *
 * ## Was das fuer diese Datei heisst
 *
 * Sie uebersetzt in beide Richtungen und sonst nichts:
 *
 *   SwissHub-Matchdaten  →  Konfiguration, die das Plugin liest
 *   Meldung des Plugins  →  Ergebnis, das das Turniermodul versteht
 *
 * Das Format der Konfiguration folgt dem, was sich als gemeinsamer Nenner
 * der verbreiteten CS2-Matchplugins eingebuergert hat: ein JSON mit
 * `matchid`, `num_maps`, `maplist`, `team1`/`team2` samt SteamID64-Liste und
 * einem `cvars`-Block. Welches Plugin konkret im Abbild liegt, ist eine
 * Entscheidung der Infrastruktur - deshalb laesst sich jede dieser Angaben
 * ueber `adapterOptions` des Game Profiles ergaenzen oder ueberschreiben,
 * ohne dass diese Datei angefasst werden muss.
 *
 * ## Was ausdruecklich nicht hier steht
 *
 * Kein RCON-Aufruf mit zusammengebautem Text. Der Adapter spricht mit dem
 * Agenten ueber dessen feste Aktionen; was der Agent daraus an RCON gibt,
 * steht im Agenten und nimmt keine Eingabe von aussen entgegen.
 */
import {
  registriereAdapter,
  type AdapterDatei,
  type AdapterErgebnis,
  type AdapterMapErgebnis,
  type AgentZugriff,
  type GameAdapter,
  type MatchKonfiguration,
  type VetoSchritt,
} from '../adapter';

/**
 * Eine SteamID64.
 *
 * 17 Ziffern, beginnend mit 7656119 - der Bereich, den Valve fuer
 * Individual-Accounts vergibt. Die Pruefung ist bewusst genau: eine Zahl,
 * die keine SteamID ist, fuehrt auf dem Server zu einem Spieler, der nie
 * erscheint, und der Fehler faellt erst auf, wenn ein Team unvollstaendig
 * dasteht.
 */
const STEAM_ID64 = /^7656119\d{10}$/u;

export function istSteamId64(wert: string): boolean {
  return STEAM_ID64.test(wert.trim());
}

/**
 * Der Veto-Ablauf.
 *
 * Die drei Modi in der Form, die sich im Turnierbetrieb durchgesetzt hat.
 * Als Liste und nicht als Algorithmus: so steht im Match Room, was als
 * Naechstes kommt, ohne dass es jemand nachrechnen muss - und so laesst sich
 * nachlesen, ob der Ablauf stimmt.
 */
export function cs2VetoAblauf(bestOf: number): VetoSchritt[] {
  if (bestOf <= 1) {
    // BO1: bannen, bis eine uebrig bleibt.
    return [
      { kind: 'BAN', actor: 'A' },
      { kind: 'BAN', actor: 'B' },
      { kind: 'BAN', actor: 'A' },
      { kind: 'BAN', actor: 'B' },
      { kind: 'BAN', actor: 'A' },
      { kind: 'BAN', actor: 'B' },
      { kind: 'DECIDER', actor: 'SYSTEM' },
    ];
  }
  if (bestOf === 3) {
    return [
      { kind: 'BAN', actor: 'A' },
      { kind: 'BAN', actor: 'B' },
      { kind: 'PICK', actor: 'A' },
      { kind: 'PICK', actor: 'B' },
      { kind: 'BAN', actor: 'A' },
      { kind: 'BAN', actor: 'B' },
      { kind: 'DECIDER', actor: 'SYSTEM' },
    ];
  }
  // BO5: zwei Banns, vier Picks, die letzte bleibt.
  return [
    { kind: 'BAN', actor: 'A' },
    { kind: 'BAN', actor: 'B' },
    { kind: 'PICK', actor: 'A' },
    { kind: 'PICK', actor: 'B' },
    { kind: 'PICK', actor: 'A' },
    { kind: 'PICK', actor: 'B' },
    { kind: 'DECIDER', actor: 'SYSTEM' },
  ];
}

/** Aus `bestOf` die Zahl der Maps. */
function mapAnzahl(bestOf: number): number {
  return bestOf <= 1 ? 1 : bestOf;
}

/**
 * Die Konfiguration, die das Plugin liest.
 *
 * `adapterOptions` aus dem Game Profile wird zuletzt darübergelegt. Das ist
 * Absicht: wer ein Plugin mit einem abweichenden Schluessel betreibt, soll
 * ihn setzen koennen, ohne auf eine neue SwissHub-Version zu warten.
 */
function baueKonfiguration(k: MatchKonfiguration): Record<string, unknown> {
  const spielerA: Record<string, string> = {};
  const spielerB: Record<string, string> = {};
  for (const spieler of k.spieler) {
    (spieler.slot === 'A' ? spielerA : spielerB)[spieler.gameId] = spieler.name;
  }

  const gaeste: Record<string, string> = {};
  for (const gast of k.gaeste) {
    gaeste[gast.gameId] = gast.name;
  }

  const basis: Record<string, unknown> = {
    matchid: String(k.matchNumber),
    num_maps: mapAnzahl(k.bestOf),
    maplist: k.maps,
    // «Nach Liste» und nicht «nach Veto»: das Veto ist hier laengst vorbei,
    // und die Reihenfolge in `maplist` ist sein Ergebnis.
    map_sides: k.maps.map(() => 'knife'),
    skip_veto: true,
    players_per_team: Math.max(1, Math.floor(k.profil.slots / 2) - 1),
    min_players_to_ready: k.profil.readyRule === 'ALL' ? Math.floor(k.profil.slots / 2) - 1 : 1,
    team1: { name: k.teamAName, players: spielerA },
    team2: { name: k.teamBName, players: spielerB },
    spectators: { players: gaeste },
    cvars: {
      hostname: `SwissHub | ${k.teamAName} vs ${k.teamBName}`,
      sv_password: k.serverPassword,
      mp_overtime_enable: k.profil.overtime ? 1 : 0,
      mp_warmuptime: Math.max(10, k.profil.warmupSeconds),
      tv_enable: k.profil.gotvEnabled ? 1 : 0,
      tv_autorecord: k.profil.demoRecording ? 1 : 0,
      get5_kniferound: k.profil.knifeRound ? 1 : 0,
      get5_max_pauses: k.profil.tacticalPauses,
      get5_max_tech_pauses: k.profil.technicalPauses,
    },
    /*
     * Wohin der Server sein Ergebnis meldet.
     *
     * Der Token gehoert zu **diesem** Match und laeuft mit ihm ab. Ein
     * Ergebnis ohne gueltigen Token wird nicht angenommen - sonst koennte
     * jeder, der die Adresse kennt, ein Turnier entscheiden.
     */
    match_end_webhook_url: k.rueckmeldung.url,
    authorization: `Bearer ${k.rueckmeldung.token}`,
  };

  return { ...basis, ...k.profil.adapterOptions };
}

/**
 * Aus der Meldung des Servers ein Ergebnis machen.
 *
 * ## Die Haltung
 *
 * Im Zweifel `eindeutig: false`. Diese Funktion entscheidet, ob ein Bracket
 * weiterrueckt; eine Fehldeutung hier kostet ein Turnier. Sie akzeptiert
 * deshalb nur, was zweifelsfrei zusammenpasst, und schiebt alles andere zu
 * einem Menschen - mit der Begruendung, woran es lag.
 */
export function leseCs2Ergebnis(roh: unknown, bestOf: number): AdapterErgebnis {
  const leer: AdapterErgebnis = { maps: [], mapsA: 0, mapsB: 0, eindeutig: false };

  if (typeof roh !== 'object' || roh === null) {
    return { ...leer, unklarGrund: 'Der Server hat keine lesbare Meldung geschickt.' };
  }

  const daten = roh as Record<string, unknown>;
  const rohMaps = daten.maps ?? daten.map_results ?? daten.mapResults;
  if (!Array.isArray(rohMaps) || rohMaps.length === 0) {
    return { ...leer, unklarGrund: 'Die Meldung enthält keine Map-Ergebnisse.' };
  }

  const maps: AdapterMapErgebnis[] = [];
  for (const [i, eintrag] of rohMaps.entries()) {
    if (typeof eintrag !== 'object' || eintrag === null) {
      return { ...leer, unklarGrund: `Map ${i + 1} ist nicht lesbar.` };
    }
    const m = eintrag as Record<string, unknown>;
    const name = m.map ?? m.map_name ?? m.mapName;
    const a = zahl(m.team1_score ?? m.scoreA ?? m.team1);
    const b = zahl(m.team2_score ?? m.scoreB ?? m.team2);

    if (typeof name !== 'string' || a === null || b === null) {
      return { ...leer, unklarGrund: `Map ${i + 1} hat keinen Namen oder keinen Punktestand.` };
    }
    if (a === b) {
      /*
       * Unentschieden gibt es in CS2 nach Overtime nicht - ausser jemand hat
       * Overtime ausgeschaltet oder das Match wurde abgebrochen. Beides ist
       * eine Sache fuer die Turnierleitung.
       */
      return {
        ...leer,
        unklarGrund: `Map ${i + 1} (${name}) endete ${a}:${b} - unentschieden. Das entscheidet die Turnierleitung.`,
      };
    }
    maps.push({ index: i + 1, map: name, scoreA: a, scoreB: b });
  }

  const mapsA = maps.filter((m) => m.scoreA > m.scoreB).length;
  const mapsB = maps.length - mapsA;
  const noetig = Math.floor(mapAnzahl(bestOf) / 2) + 1;

  if (maps.length > mapAnzahl(bestOf)) {
    return {
      maps,
      mapsA,
      mapsB,
      eindeutig: false,
      unklarGrund: `Der Server meldet ${maps.length} Maps, bei Best of ${bestOf} sind höchstens ${mapAnzahl(bestOf)} möglich.`,
    };
  }

  if (Math.max(mapsA, mapsB) !== noetig) {
    return {
      maps,
      mapsA,
      mapsB,
      eindeutig: false,
      unklarGrund: `Bei Best of ${bestOf} gewinnt, wer ${noetig} ${noetig === 1 ? 'Map' : 'Maps'} holt - gemeldet wurde ${mapsA}:${mapsB}. Wahrscheinlich wurde das Match abgebrochen.`,
    };
  }

  return { maps, mapsA, mapsB, eindeutig: true };
}

function zahl(wert: unknown): number | null {
  if (typeof wert === 'number' && Number.isFinite(wert)) {
    return Math.trunc(wert);
  }
  if (typeof wert === 'string' && /^\d{1,3}$/u.test(wert.trim())) {
    return Number.parseInt(wert, 10);
  }
  return null;
}

export const cs2Adapter: GameAdapter = registriereAdapter({
  game: 'CS2',
  label: 'Counter-Strike 2',
  // Die SteamID steht im Mitgliederprofil unter «verbundene Konten».
  profilPlattform: 'steam',

  benoetigtePorts(profil) {
    return { game: 27015, tv: profil.gotvEnabled ? 27020 : null };
  },

  mapAnzahl,
  vetoAblauf: cs2VetoAblauf,
  pruefeSpielerKennung: istSteamId64,
  baueKonfiguration,
  leseErgebnis: leseCs2Ergebnis,

  async starteServer(agent: AgentZugriff, konfiguration: MatchKonfiguration) {
    /*
     * Erst starten, dann konfigurieren.
     *
     * Andersherum ginge die Konfiguration an einen Server, der sie beim
     * Start wieder vergisst. Das Plugin liest sie, sobald es laeuft - und
     * es laeuft erst, wenn der Server laeuft.
     */
    await agent.gameStart();
    await agent.matchConfigure(baueKonfiguration(konfiguration));
  },

  async stoppeServer(agent: AgentZugriff) {
    await agent.gameStop();
  },

  async pruefeGesundheit(agent: AgentZugriff) {
    const stand = await agent.health();
    if (!stand.ok) {
      return { ok: false, meldung: 'Der Agent meldet einen Fehler.' };
    }
    if (!stand.gameRunning) {
      return { ok: false, meldung: 'Der CS2-Server läuft noch nicht.' };
    }
    return { ok: true, meldung: 'CS2 läuft und antwortet.' };
  },

  async pausiere(agent: AgentZugriff) {
    await agent.matchPause();
  },

  async setzeFort(agent: AgentZugriff) {
    await agent.matchUnpause();
  },

  async stelleWiederHer(agent: AgentZugriff, runde: number) {
    await agent.matchRestore(runde);
  },

  async dateien(agent: AgentZugriff): Promise<AdapterDatei[]> {
    return agent.dateien();
  },
});
