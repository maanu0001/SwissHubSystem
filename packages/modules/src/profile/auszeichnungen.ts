/**
 * Auszeichnungen.
 *
 * ## Warum es keine Tabelle dafuer gibt
 *
 * Eine Tabelle `Achievement` waere schnell gebaut - und haette ab dann zwei
 * Wahrheiten darueber, wer was erreicht hat: die Turniere, Runden und
 * XP-Buchungen selbst und eine Kopie davon. Kopien laufen auseinander. Statt
 * dessen wird hier aus dem gerechnet, was ohnehin dasteht. Dieselbe
 * Begruendung wie bei der Clip-Bilanz.
 *
 * Das erledigt drei Anforderungen auf einmal:
 *
 * - **Idempotent.** Ein nachtraeglicher Abgleichlauf kann nicht doppelt
 *   vergeben, weil es keinen Abgleichlauf gibt. Es wird nichts geschrieben.
 * - **Rueckwirkend.** Wer vor zwei Jahren ein Turnier gewonnen hat, hat die
 *   Auszeichnung ab der ersten Sekunde - ohne Migration.
 * - **Keine erfundenen Erfolge.** Jede Bedingung unten liest genau eine
 *   Zahl, die jemand tatsaechlich erhoben hat. Wo es keine verlaessliche
 *   Zahl gibt, gibt es keine Auszeichnung.
 *
 * ## Warum nichts fuer Nachrichtenzahlen
 *
 * «1000 Nachrichten geschrieben» belohnt, wer viel tippt, und es ist in
 * zwanzig Minuten zu faelschen. Was hier zaehlt, kostet entweder Zeit
 * (Zugehoerigkeit), Koennen (Turnierplatz, Clip-Sieg) oder die Stimmen
 * anderer. XP fliessen nur ueber das Level ein, und das XP-System hat seine
 * eigenen Bremsen gegen Spam.
 */

/** Wie schwer eine Auszeichnung zu bekommen ist - steuert nur das Aussehen. */
export type Stufe = 'bronze' | 'silber' | 'gold';

/**
 * Die Zahlen, aus denen Auszeichnungen entstehen.
 *
 * Alles, was eine Bedingung lesen darf. Zusammengetragen an einer Stelle im
 * Dienst, damit fuenfzehn Bedingungen nicht fuenfzehn Abfragen ausloesen -
 * und damit hier drin keine Datenbank vorkommt.
 */
export interface Grundlage {
  /** Serverbeitritt laut Discord-Spiegel. `null`, wenn Discord es nie lieferte. */
  beitrittAm: Date | null;
  /** Stand aus dem bestehenden XP-System - nicht hier gerechnet. */
  level: number;
  hoechstlevel: boolean;
  turniere: {
    /** Bestaetigt angemeldet oder als Teammitglied gefuehrt. */
    teilgenommen: number;
    /** Platz 1 bis 3. */
    podeste: number;
    siege: number;
  };
  clips: {
    eingereicht: number;
    treppchen: number;
    siege: number;
    erhalteneStimmen: number;
  };
  /** Bestaetigte Kalenderanmeldungen. Keine Teilnahme - die erhebt niemand. */
  events: number;
  /** Ausgefuellte Spielprofile. */
  spielprofile: number;
  /** Server-Boost laut Discord-Spiegel. */
  boostet: boolean;
  /** Referenzzeitpunkt - als Parameter, damit Tests nicht an der Uhr haengen. */
  jetzt: Date;
}

export interface AuszeichnungsArt {
  key: string;
  label: string;
  beschreibung: string;
  /** Name eines Lucide-Symbols. */
  symbol: string;
  stufe: Stufe;
  /**
   * Trifft zu oder nicht. Rein - keine Datenbank, keine Uhr, kein Zufall.
   * Dieselbe Grundlage muss immer dasselbe ergeben.
   */
  erfuellt: (g: Grundlage) => boolean;
  /**
   * Fortschritt als `[erreicht, noetig]`, falls sich das sinnvoll zaehlen
   * laesst. Nur fuer die Anzeige «3 von 5».
   */
  fortschritt?: (g: Grundlage) => [number, number];
}

const TAG = 24 * 60 * 60 * 1000;

function jahreDabei(g: Grundlage): number {
  if (!g.beitrittAm) {
    return 0;
  }
  return (g.jetzt.getTime() - g.beitrittAm.getTime()) / (365.25 * TAG);
}

const ARTEN: readonly AuszeichnungsArt[] = [
  // --- Zugehoerigkeit -----------------------------------------------------
  // Das Beitrittsdatum kommt aus dem Discord-Spiegel. Fehlt es, gibt es die
  // Auszeichnung nicht - `jahreDabei` gibt dann 0 zurueck. Ein geschaetztes
  // Datum waere ein erfundener Erfolg.
  {
    key: 'dabei-1',
    label: 'Ein Jahr dabei',
    beschreibung: 'Seit über einem Jahr auf dem SwissHub.',
    symbol: 'CalendarCheck',
    stufe: 'bronze',
    erfuellt: (g) => jahreDabei(g) >= 1,
  },
  {
    key: 'dabei-3',
    label: 'Drei Jahre dabei',
    beschreibung: 'Seit über drei Jahren auf dem SwissHub.',
    symbol: 'CalendarCheck',
    stufe: 'silber',
    erfuellt: (g) => jahreDabei(g) >= 3,
  },
  {
    key: 'dabei-5',
    label: 'Fünf Jahre dabei',
    beschreibung: 'Seit über fünf Jahren auf dem SwissHub.',
    symbol: 'CalendarCheck',
    stufe: 'gold',
    erfuellt: (g) => jahreDabei(g) >= 5,
  },

  // --- Level --------------------------------------------------------------
  // Das Level kommt aus dem bestehenden XP-System. Hier wird es gelesen,
  // nicht gerechnet - kein zweites Levelsystem.
  {
    key: 'level-10',
    label: 'Level 10',
    beschreibung: 'Level 10 erreicht.',
    symbol: 'Sparkles',
    stufe: 'bronze',
    erfuellt: (g) => g.level >= 10,
    fortschritt: (g) => [Math.min(g.level, 10), 10],
  },
  {
    key: 'level-20',
    label: 'Level 20',
    beschreibung: 'Level 20 erreicht.',
    symbol: 'Sparkles',
    stufe: 'silber',
    erfuellt: (g) => g.level >= 20,
    fortschritt: (g) => [Math.min(g.level, 20), 20],
  },
  {
    key: 'level-max',
    label: 'Höchstlevel',
    beschreibung: 'Das höchste Level erreicht.',
    symbol: 'Crown',
    stufe: 'gold',
    erfuellt: (g) => g.hoechstlevel,
  },

  // --- Turniere -----------------------------------------------------------
  // Gezaehlt wird bestaetigte Teilnahme, nicht Anmeldung: eine Anmeldung
  // darf nicht wie ein Erfolg aussehen.
  {
    key: 'turnier-dabei',
    label: 'Erstes Turnier',
    beschreibung: 'An einem SwissHub-Turnier teilgenommen.',
    symbol: 'Swords',
    stufe: 'bronze',
    erfuellt: (g) => g.turniere.teilgenommen >= 1,
  },
  {
    key: 'turnier-stammgast',
    label: 'Turnier-Stammgast',
    beschreibung: 'An fünf Turnieren teilgenommen.',
    symbol: 'Swords',
    stufe: 'silber',
    erfuellt: (g) => g.turniere.teilgenommen >= 5,
    fortschritt: (g) => [Math.min(g.turniere.teilgenommen, 5), 5],
  },
  {
    key: 'turnier-podest',
    label: 'Auf dem Podest',
    beschreibung: 'In einem Turnier unter die ersten drei gekommen.',
    symbol: 'Medal',
    stufe: 'silber',
    erfuellt: (g) => g.turniere.podeste >= 1,
  },
  {
    key: 'turnier-sieg',
    label: 'Turniersieg',
    beschreibung: 'Ein SwissHub-Turnier gewonnen.',
    symbol: 'Trophy',
    stufe: 'gold',
    erfuellt: (g) => g.turniere.siege >= 1,
  },
  {
    key: 'turnier-seriensieger',
    label: 'Seriensieger',
    beschreibung: 'Drei Turniere gewonnen.',
    symbol: 'Trophy',
    stufe: 'gold',
    erfuellt: (g) => g.turniere.siege >= 3,
    fortschritt: (g) => [Math.min(g.turniere.siege, 3), 3],
  },

  // --- Clip of the Week ---------------------------------------------------
  {
    key: 'clip-erster',
    label: 'Erster Clip',
    beschreibung: 'Einen Clip für Clip of the Week eingereicht.',
    symbol: 'Clapperboard',
    stufe: 'bronze',
    erfuellt: (g) => g.clips.eingereicht >= 1,
  },
  {
    key: 'clip-treppchen',
    label: 'Clip auf dem Treppchen',
    beschreibung: 'Mit einem Clip unter die ersten drei gekommen.',
    symbol: 'Medal',
    stufe: 'silber',
    erfuellt: (g) => g.clips.treppchen >= 1,
  },
  {
    key: 'clip-sieg',
    label: 'Clip der Woche',
    beschreibung: 'Eine Runde Clip of the Week gewonnen.',
    symbol: 'Clapperboard',
    stufe: 'gold',
    erfuellt: (g) => g.clips.siege >= 1,
  },
  {
    // Die Stimmen anderer - nicht die eigene Aktivitaet. Deshalb steht hier
    // eine Zahl, die sich nicht selbst erzeugen laesst.
    key: 'clip-publikum',
    label: 'Publikumsliebling',
    beschreibung: 'Insgesamt 100 Stimmen für eigene Clips erhalten.',
    symbol: 'Heart',
    stufe: 'silber',
    erfuellt: (g) => g.clips.erhalteneStimmen >= 100,
    fortschritt: (g) => [Math.min(g.clips.erhalteneStimmen, 100), 100],
  },

  // --- Events -------------------------------------------------------------
  // Bestaetigte Anmeldung. Der Kalender erhebt kein Einchecken, also sagt
  // der Text «angemeldet» und nicht «teilgenommen».
  {
    key: 'event-dabei',
    label: 'Event-Gast',
    beschreibung: 'Für ein SwissHub-Event angemeldet gewesen.',
    symbol: 'CalendarDays',
    stufe: 'bronze',
    erfuellt: (g) => g.events >= 1,
  },
  {
    key: 'event-stammgast',
    label: 'Event-Stammgast',
    beschreibung: 'Für zehn Events angemeldet gewesen.',
    symbol: 'CalendarDays',
    stufe: 'silber',
    erfuellt: (g) => g.events >= 10,
    fortschritt: (g) => [Math.min(g.events, 10), 10],
  },

  // --- Profil -------------------------------------------------------------
  {
    key: 'profil-spiele',
    label: 'Vielspieler',
    beschreibung: 'Fünf Spiele im eigenen Profil gepflegt.',
    symbol: 'Gamepad2',
    stufe: 'bronze',
    erfuellt: (g) => g.spielprofile >= 5,
    fortschritt: (g) => [Math.min(g.spielprofile, 5), 5],
  },
  {
    key: 'booster',
    label: 'Server-Booster',
    beschreibung: 'Boostet den SwissHub-Server.',
    symbol: 'Rocket',
    stufe: 'gold',
    erfuellt: (g) => g.boostet,
  },
];

const NACH_KEY = new Map(ARTEN.map((a) => [a.key, a]));

export function alleAuszeichnungsArten(): readonly AuszeichnungsArt[] {
  return ARTEN;
}

export function auszeichnungsArt(key: string): AuszeichnungsArt | undefined {
  return NACH_KEY.get(key);
}

export interface Auszeichnung {
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  erreicht: boolean;
  /** `null`, wenn sich dafuer nichts sinnvoll zaehlen laesst. */
  fortschritt: { erreicht: number; noetig: number } | null;
}

/**
 * Alle Auszeichnungen - erreichte und offene.
 *
 * Auch die offenen, weil eine Vitrine ohne sichtbares naechstes Ziel nur die
 * Vergangenheit zeigt. Der Aufrufer entscheidet, ob er die offenen
 * darstellt; im fremden Profil tut er es nicht.
 *
 * Gold vor Silber vor Bronze, erreichte vor offenen - damit die Reihenfolge
 * nicht von der Reihenfolge der Registry abhaengt.
 */
export function bewerte(g: Grundlage): Auszeichnung[] {
  const rang: Record<Stufe, number> = { gold: 0, silber: 1, bronze: 2 };

  return ARTEN.map((art) => {
    const teil = art.fortschritt?.(g);
    return {
      key: art.key,
      label: art.label,
      beschreibung: art.beschreibung,
      symbol: art.symbol,
      stufe: art.stufe,
      erreicht: art.erfuellt(g),
      fortschritt: teil ? { erreicht: teil[0], noetig: teil[1] } : null,
    };
  }).sort((a, b) => {
    if (a.erreicht !== b.erreicht) {
      return a.erreicht ? -1 : 1;
    }
    return rang[a.stufe] - rang[b.stufe];
  });
}

/** Nur die erreichten - fuer Profilkopf und Vitrine. */
export function erreichte(g: Grundlage): Auszeichnung[] {
  return bewerte(g).filter((a) => a.erreicht);
}
