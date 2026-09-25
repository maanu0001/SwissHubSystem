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

/**
 * Was eine Bedingung lesen darf - als geschlossene Liste.
 *
 * ## Warum das eine Liste ist und keine Funktion
 *
 * Damit sich Schwellenwerte verwalten lassen, ohne dass jemand Code
 * eingibt. Eine Auszeichnung sagt «zaehle `turnierSiege` und vergleiche mit
 * 3» - die Zahl ist eine Einstellung, der Messwert ein Schluessel aus dieser
 * Liste. Ein frei eingegebener Ausdruck waere eine Ausfuehrungsumgebung in
 * einem Textfeld, und daran ist nichts zu retten.
 *
 * `ganzzahlig` steuert, ob ein Fortschritt («3 von 5») angezeigt wird. Bei
 * Jahren ergibt er keinen Sinn: «2.7 von 3 Jahren» liest niemand.
 */
export interface Messwert {
  label: string;
  einheit: string;
  ganzzahlig: boolean;
  lies: (g: Grundlage) => number;
}

export type MesswertKey =
  | 'jahreDabei'
  | 'level'
  | 'turnierTeilnahmen'
  | 'turnierPodeste'
  | 'turnierSiege'
  | 'clipsEingereicht'
  | 'clipsTreppchen'
  | 'clipsSiege'
  | 'clipStimmen'
  | 'events'
  | 'spielprofile';

/**
 * Die Ja-Nein-Merkmale.
 *
 * Sie haben keine Schwelle - «Hoechstlevel» ist erreicht oder nicht. Ihr
 * Schwellenfeld bleibt deshalb in der Verwaltung gesperrt; es gaebe nichts
 * einzustellen.
 */
export type FlaggenKey = 'hoechstlevel' | 'boostet';

export const FLAGGEN: Record<FlaggenKey, { label: string; lies: (g: Grundlage) => boolean }> = {
  hoechstlevel: { label: 'Höchstlevel erreicht', lies: (g) => g.hoechstlevel },
  boostet: { label: 'Boostet den Server', lies: (g) => g.boostet },
};

/** Die Bedingung einer gerechneten Auszeichnung - Daten, kein Code. */
export type Bedingung =
  | { art: 'schwelle'; messwert: MesswertKey; wert: number }
  | { art: 'flagge'; flagge: FlaggenKey };

export interface AuszeichnungsArt {
  key: string;
  label: string;
  beschreibung: string;
  /** Name eines Lucide-Symbols. */
  symbol: string;
  stufe: Stufe;
  /**
   * Wann sie erfuellt ist.
   *
   * Rein beschreibend: keine Datenbank, keine Uhr, kein Zufall. Dieselbe
   * Grundlage muss immer dasselbe ergeben - das war schon so, als hier noch
   * eine Funktion stand; jetzt steht es auch dann fest, wenn ein Admin den
   * Schwellenwert aendert.
   */
  bedingung: Bedingung;
  /**
   * Ausgeschaltet.
   *
   * Nur ueber die Verwaltung gesetzt, nie hier in der Liste. Eine
   * ausgeschaltete Auszeichnung wird nicht mehr gerechnet und erscheint in
   * keinem Profil - geloescht wird nichts, denn sie kann zurueckkommen.
   */
  aus?: boolean;
}

const TAG = 24 * 60 * 60 * 1000;

function jahreDabei(g: Grundlage): number {
  if (!g.beitrittAm) {
    return 0;
  }
  return (g.jetzt.getTime() - g.beitrittAm.getTime()) / (365.25 * TAG);
}

export const MESSWERTE: Record<MesswertKey, Messwert> = {
  jahreDabei: { label: 'Jahre auf dem Server', einheit: 'Jahre', ganzzahlig: false, lies: jahreDabei },
  level: { label: 'Level', einheit: 'Level', ganzzahlig: true, lies: (g) => g.level },
  turnierTeilnahmen: {
    label: 'Turnierteilnahmen',
    einheit: 'Turniere',
    ganzzahlig: true,
    lies: (g) => g.turniere.teilgenommen,
  },
  turnierPodeste: {
    label: 'Turnier-Podestplätze',
    einheit: 'Plätze',
    ganzzahlig: true,
    lies: (g) => g.turniere.podeste,
  },
  turnierSiege: { label: 'Turniersiege', einheit: 'Siege', ganzzahlig: true, lies: (g) => g.turniere.siege },
  clipsEingereicht: {
    label: 'Eingereichte Clips',
    einheit: 'Clips',
    ganzzahlig: true,
    lies: (g) => g.clips.eingereicht,
  },
  clipsTreppchen: {
    label: 'Clips auf dem Treppchen',
    einheit: 'Clips',
    ganzzahlig: true,
    lies: (g) => g.clips.treppchen,
  },
  clipsSiege: { label: 'Clip-Siege', einheit: 'Siege', ganzzahlig: true, lies: (g) => g.clips.siege },
  clipStimmen: {
    label: 'Erhaltene Stimmen für Clips',
    einheit: 'Stimmen',
    ganzzahlig: true,
    lies: (g) => g.clips.erhalteneStimmen,
  },
  events: { label: 'Event-Anmeldungen', einheit: 'Events', ganzzahlig: true, lies: (g) => g.events },
  spielprofile: {
    label: 'Gepflegte Spielprofile',
    einheit: 'Spiele',
    ganzzahlig: true,
    lies: (g) => g.spielprofile,
  },
};

/** Kurzform fuer eine Schwellenbedingung. */
const ab = (messwert: MesswertKey, wert: number): Bedingung => ({ art: 'schwelle', messwert, wert });

/** Kurzform fuer ein Ja-Nein-Merkmal. */
const wenn = (flagge: FlaggenKey): Bedingung => ({ art: 'flagge', flagge });

/**
 * Ist die Bedingung erfuellt?
 *
 * Die einzige Stelle, an der aus einer Bedingung ein Ja oder Nein wird -
 * und sie liest ausschliesslich aus `MESSWERTE` und `FLAGGEN`. Ein
 * veraenderter Schwellenwert wirkt hier und nirgends sonst.
 */
export function bedingungErfuellt(bedingung: Bedingung, g: Grundlage): boolean {
  return bedingung.art === 'flagge'
    ? FLAGGEN[bedingung.flagge].lies(g)
    : MESSWERTE[bedingung.messwert].lies(g) >= bedingung.wert;
}

/**
 * Der Fortschritt - oder `null`.
 *
 * Gezeigt wird er nur dort, wo er etwas sagt: bei einer Schwelle ueber eins
 * und einem ganzzahligen Messwert. «0 von 1 Turniersiegen» ist keine
 * Auskunft, und «2.7 von 3 Jahren» liest niemand.
 */
export function bedingungFortschritt(
  bedingung: Bedingung,
  g: Grundlage,
): { erreicht: number; noetig: number } | null {
  if (bedingung.art !== 'schwelle' || bedingung.wert <= 1) {
    return null;
  }
  const messwert = MESSWERTE[bedingung.messwert];
  if (!messwert.ganzzahlig) {
    return null;
  }
  return { erreicht: Math.min(messwert.lies(g), bedingung.wert), noetig: bedingung.wert };
}

/**
 * Die gerechneten Auszeichnungen.
 *
 * ## Warum sie hier stehen und nicht in der Datenbank
 *
 * Weil sie an Code haengen: welcher Messwert gezaehlt wird, ist eine
 * Aussage ueber die Datenquellen dieses Systems. Was sich **verwalten**
 * laesst, sind Beschriftung, Symbol, Stufe, Schwellenwert und der Schalter
 * «aktiv» - die Liste selbst bleibt der Bauplan. Die Verwaltung legt eine
 * Schicht darueber; siehe `berechnete-arten.ts`.
 */
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
    bedingung: ab('jahreDabei', 1),
  },
  {
    key: 'dabei-3',
    label: 'Drei Jahre dabei',
    beschreibung: 'Seit über drei Jahren auf dem SwissHub.',
    symbol: 'CalendarCheck',
    stufe: 'silber',
    bedingung: ab('jahreDabei', 3),
  },
  {
    key: 'dabei-5',
    label: 'Fünf Jahre dabei',
    beschreibung: 'Seit über fünf Jahren auf dem SwissHub.',
    symbol: 'CalendarCheck',
    stufe: 'gold',
    bedingung: ab('jahreDabei', 5),
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
    bedingung: ab('level', 10),
  },
  {
    key: 'level-20',
    label: 'Level 20',
    beschreibung: 'Level 20 erreicht.',
    symbol: 'Sparkles',
    stufe: 'silber',
    bedingung: ab('level', 20),
  },
  {
    key: 'level-max',
    label: 'Höchstlevel',
    beschreibung: 'Das höchste Level erreicht.',
    symbol: 'Crown',
    stufe: 'gold',
    bedingung: wenn('hoechstlevel'),
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
    bedingung: ab('turnierTeilnahmen', 1),
  },
  {
    key: 'turnier-stammgast',
    label: 'Turnier-Stammgast',
    beschreibung: 'An fünf Turnieren teilgenommen.',
    symbol: 'Swords',
    stufe: 'silber',
    bedingung: ab('turnierTeilnahmen', 5),
  },
  {
    key: 'turnier-podest',
    label: 'Auf dem Podest',
    beschreibung: 'In einem Turnier unter die ersten drei gekommen.',
    symbol: 'Medal',
    stufe: 'silber',
    bedingung: ab('turnierPodeste', 1),
  },
  {
    key: 'turnier-sieg',
    label: 'Turniersieg',
    beschreibung: 'Ein SwissHub-Turnier gewonnen.',
    symbol: 'Trophy',
    stufe: 'gold',
    bedingung: ab('turnierSiege', 1),
  },
  {
    key: 'turnier-seriensieger',
    label: 'Seriensieger',
    beschreibung: 'Drei Turniere gewonnen.',
    symbol: 'Trophy',
    stufe: 'gold',
    bedingung: ab('turnierSiege', 3),
  },

  // --- Clip of the Week ---------------------------------------------------
  {
    key: 'clip-erster',
    label: 'Erster Clip',
    beschreibung: 'Einen Clip für Clip of the Week eingereicht.',
    symbol: 'Clapperboard',
    stufe: 'bronze',
    bedingung: ab('clipsEingereicht', 1),
  },
  {
    key: 'clip-treppchen',
    label: 'Clip auf dem Treppchen',
    beschreibung: 'Mit einem Clip unter die ersten drei gekommen.',
    symbol: 'Medal',
    stufe: 'silber',
    bedingung: ab('clipsTreppchen', 1),
  },
  {
    key: 'clip-sieg',
    label: 'Clip der Woche',
    beschreibung: 'Eine Runde Clip of the Week gewonnen.',
    symbol: 'Clapperboard',
    stufe: 'gold',
    bedingung: ab('clipsSiege', 1),
  },
  {
    // Die Stimmen anderer - nicht die eigene Aktivitaet. Deshalb steht hier
    // eine Zahl, die sich nicht selbst erzeugen laesst.
    key: 'clip-publikum',
    label: 'Publikumsliebling',
    beschreibung: 'Insgesamt 100 Stimmen für eigene Clips erhalten.',
    symbol: 'Heart',
    stufe: 'silber',
    bedingung: ab('clipStimmen', 100),
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
    bedingung: ab('events', 1),
  },
  {
    key: 'event-stammgast',
    label: 'Event-Stammgast',
    beschreibung: 'Für zehn Events angemeldet gewesen.',
    symbol: 'CalendarDays',
    stufe: 'silber',
    bedingung: ab('events', 10),
  },

  // --- Profil -------------------------------------------------------------
  {
    key: 'profil-spiele',
    label: 'Vielspieler',
    beschreibung: 'Fünf Spiele im eigenen Profil gepflegt.',
    symbol: 'Gamepad2',
    stufe: 'bronze',
    bedingung: ab('spielprofile', 5),
  },
  {
    key: 'booster',
    label: 'Server-Booster',
    beschreibung: 'Boostet den SwissHub-Server.',
    symbol: 'Rocket',
    stufe: 'gold',
    bedingung: wenn('boostet'),
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
  /** Von Hand verliehen statt gerechnet - siehe `auszeichnungs-arten.ts`. */
  verliehen?: boolean;
}

/**
 * Auszeichnungen, die jemand vergibt statt sie zu erreichen.
 *
 * ## Warum es sie ueberhaupt gibt
 *
 * Alles oben wird gerechnet, und das ist gut so: ein Turniersieg
 * entsteht, indem jemand ein Turnier gewinnt, und nicht, indem ein Admin
 * einen Haken setzt. Wer das aufweicht, hat ein Profil, das Erfolge zeigt,
 * die die Daten nicht hergeben.
 *
 * Es gibt aber Dinge, die sich nicht rechnen lassen. Wer von Anfang an
 * dabei war, als es noch keine Analytics gab. Wer den Server durch eine
 * schwierige Zeit getragen hat. Dafuer gibt es keine Zahl, sondern eine
 * Entscheidung - und die trifft ein Mensch.
 *
 * ## Warum diese Liste nicht mehr hier steht
 *
 * Sie stand hier, als `readonly`-Konstante mit fuenf Eintraegen. Eine
 * sechste anzulegen hiess: Commit, Review, Deployment. Im Betrieb gab es
 * deshalb keine Verwaltung dafuer - es gab nichts zu verwalten.
 *
 * Jetzt liegen die verleihbaren Arten in `AwardDefinition` und werden in
 * `auszeichnungs-arten.ts` gepflegt. Diese Datei bleibt, was sie war: die
 * **gerechneten** Auszeichnungen und ihre Bedingungen, ohne Datenbank.
 *
 * ## Die Trennung
 *
 * `ARTEN` oben und die verleihbaren unten ueberschneiden sich nicht, und
 * das ist keine Konvention: `erstelleAuszeichnungsArt` weist jeden
 * Schluessel ab, den `auszeichnungsArt` kennt. «Turniersieg» laesst sich
 * deshalb nicht von Hand vergeben - nicht, weil eine Pruefung es abfaengt,
 * sondern weil es den Schluessel gar nicht erst gibt.
 *
 * Keine `erfuellt`-Funktion: es gibt keine Bedingung. Entweder jemand hat
 * sie bekommen, oder nicht.
 */
/**
 * Die Symbole, die zur Wahl stehen.
 *
 * Eine feste Liste und kein freies Textfeld: die Oberflaeche zeichnet
 * Symbole ueber `NavIcon`, und die kennt nur eine feste Zuordnung. Ein
 * freier Name ergaebe einen grauen Platzhalter - sichtbar erst dann, wenn
 * die Auszeichnung schon an einem Profil haengt.
 *
 * Die Liste steht hier und nicht in der Oberflaeche, weil beide sie
 * brauchen: die Auswahl zeichnet sie, und `erstelleAuszeichnungsArt`
 * prueft dagegen. Zwei Listen liefen auseinander, und die Pruefung waere
 * die, die es nicht merkt.
 */
export const AUSZEICHNUNGS_SYMBOLE: readonly string[] = [
  'Award',
  'Trophy',
  'Medal',
  'Crown',
  'Star',
  'Gem',
  'Sparkles',
  'Flame',
  'Zap',
  'Rocket',
  'Heart',
  'HeartHandshake',
  'PartyPopper',
  'Gift',
  'Bug',
  'Swords',
  'Shield',
  'ShieldCheck',
  'Gamepad2',
  'Dices',
  'Clapperboard',
  'Music',
  'Mic',
  'Megaphone',
  'Users',
  'CalendarCheck',
  'CalendarDays',
  'Gavel',
  'KeyRound',
  'Bot',
];

export interface VerleihbareArt {
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
}

/**
 * Verleihungen in Auszeichnungen umwandeln - fuer die Anzeige.
 *
 * Die Arten kommen als Parameter und nicht aus einer Konstanten: sie stehen
 * in der Datenbank, und diese Datei kennt keine. Der Aufrufer laedt sie -
 * er laedt ohnehin die Verleihungen.
 *
 * Die Reihenfolge ist die der Schluessel, also die der Verleihung. Wer
 * seine erste Auszeichnung zuerst sehen will, bekommt sie zuerst.
 */
export function ausVerleihungen(
  schluessel: readonly string[],
  arten: readonly VerleihbareArt[],
): Auszeichnung[] {
  const nachKey = new Map(arten.map((art) => [art.key, art]));
  return schluessel.flatMap((key) => {
    const art = nachKey.get(key);
    if (!art) {
      // Ein Schluessel ohne Definition: lieber weglassen als eine
      // Auszeichnung ohne Namen zeigen.
      return [];
    }
    return [
      {
        key: art.key,
        label: art.label,
        beschreibung: art.beschreibung,
        symbol: art.symbol,
        stufe: art.stufe,
        erreicht: true,
        fortschritt: null,
        verliehen: true,
      },
    ];
  });
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
export function bewerte(g: Grundlage, arten: readonly AuszeichnungsArt[] = ARTEN): Auszeichnung[] {
  const rang: Record<Stufe, number> = { gold: 0, silber: 1, bronze: 2 };

  return arten
    .filter((art) => !art.aus)
    .map((art) => ({
      key: art.key,
      label: art.label,
      beschreibung: art.beschreibung,
      symbol: art.symbol,
      stufe: art.stufe,
      erreicht: bedingungErfuellt(art.bedingung, g),
      fortschritt: bedingungFortschritt(art.bedingung, g),
    }))
    .sort((a, b) => {
    if (a.erreicht !== b.erreicht) {
      return a.erreicht ? -1 : 1;
    }
    return rang[a.stufe] - rang[b.stufe];
  });
}

/** Nur die erreichten - fuer Profilkopf und Vitrine. */
export function erreichte(g: Grundlage, arten?: readonly AuszeichnungsArt[]): Auszeichnung[] {
  return bewerte(g, arten).filter((a) => a.erreicht);
}
