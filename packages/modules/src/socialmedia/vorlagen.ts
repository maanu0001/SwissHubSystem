/**
 * Die Vorlagen des Post Creators (§31, §32, §33).
 *
 * ## Die Grundidee: Design ist das Gerüst, Typ ist der Inhalt
 *
 * Dreizehn Posttypen und sechs Designs waeren achtundsiebzig handgebaute
 * Kompositionen - und achtundsiebzig Stellen, an denen eine Aenderung
 * nachgezogen werden muss. Genauso falsch waere das Gegenteil: ein Layout fuer
 * alles und sechs Farbsaetze darueber. Die Vorgabe sagt dazu ausdruecklich,
 * Designs sollen echte unterschiedliche Layouts sein, nicht nur andere Farben.
 *
 * Deshalb zwei Achsen, die sich kreuzen:
 *
 * - **Das Design** bestimmt die Flaeche: wo die Marke steht, wie der Text
 *   gesetzt ist, ob zentriert oder links, ob ein Bild die halbe Flaeche nimmt
 *   oder als Band laeuft, wie viel Luft bleibt. Sechs Geruste, und sie sehen
 *   nebeneinander nicht nach Geschwistern aus.
 * - **Der Typ** bestimmt, was in die Inhaltsflaeche kommt: eine Begegnung
 *   zeigt zwei Namen gegeneinander, ein Resultat dieselben zwei mit Punkten,
 *   ein Turnierbaum einen Baum, eine Ankuendigung Fliesstext. Das ist der
 *   Inhaltsblock, und er ist pro Typ ein anderer.
 *
 * Eine neue Vorlage ist damit entweder ein neuer Eintrag in dieser Liste oder
 * ein neuer Inhaltsblock - und nicht sechs neue Dateien.
 *
 * ## Warum die Felder hier stehen und nicht im Editor
 *
 * Weil der Editor sonst entscheiden wuerde, was ein Typ braucht, und die
 * Zeichenquelle etwas anderes liest. Hier steht einmal, welche Felder ein Typ
 * hat; der Editor zeigt genau die (§33: nur die relevanten Felder), die
 * Pruefung beim Speichern laesst genau die durch, und die Zeichenquelle kennt
 * dieselbe Liste.
 *
 * ## Was hier ausdruecklich nicht steht
 *
 * Kein JSX. Diese Datei ist Datei fuer Datei lesbare Beschreibung und laeuft
 * im Bot wie in der WebApp wie im Test. Gezeichnet wird in
 * `apps/web/src/modules/socialmedia/post-folie.tsx`, und das ist die **eine**
 * Quelle fuer Vorschau und Export (§38).
 */

// --- Formate ----------------------------------------------------------------

/**
 * Die drei Ausgabeformate (§44).
 *
 * Dieselben Masse wie `SOCIAL_MASSE` in «SwissHub fragt» - und absichtlich
 * dieselben Namen, damit nicht zwei Listen entstehen, die auseinanderlaufen.
 */
export const POST_FORMATE = ['quadrat', 'feed', 'story'] as const;
export type PostFormat = (typeof POST_FORMATE)[number];

export const POST_MASSE: Readonly<Record<PostFormat, { breite: number; hoehe: number }>> = {
  /** 1080 × 1080 - Feed-Klassiker, X, LinkedIn. */
  quadrat: { breite: 1080, hoehe: 1080 },
  /** 1080 × 1350 - das hoechste, was Instagram im Feed ungeschnitten zeigt. */
  feed: { breite: 1080, hoehe: 1350 },
  /** 1080 × 1920 - Story und Reels-Cover. */
  story: { breite: 1080, hoehe: 1920 },
};

export const FORMAT_LABEL: Readonly<Record<PostFormat, string>> = {
  quadrat: 'Quadrat 1080 × 1080',
  feed: 'Feed 1080 × 1350',
  story: 'Story 1080 × 1920',
};

// --- Felder -----------------------------------------------------------------

/**
 * Alle Feldarten, die eine Vorlage verlangen kann (§33).
 *
 * Eine geschlossene Liste, und das ist der Punkt: ein Feld, das es hier nicht
 * gibt, kann kein Editor anbieten und keine Zeichenquelle lesen.
 */
export const POST_FELDER = [
  'titel',
  'untertitel',
  'text',
  'cta',
  'datum',
  'zeit',
  'ort',
  'link',
  'bild',
  'hintergrundbild',
  'logo',
  'akzentfarbe',
  'sponsoren',
  'teams',
  'punkte',
  'gewinner',
  'platzierung',
  'bracket',
  'fusszeile',
  'branding',
] as const;
export type PostFeld = (typeof POST_FELDER)[number];

export type FeldArt =
  | 'text'
  | 'mehrzeilig'
  | 'datum'
  | 'zeit'
  | 'url'
  | 'bild'
  | 'farbe'
  | 'liste'
  | 'begegnung'
  | 'turnierbaum'
  | 'schalter';

export interface FeldBeschreibung {
  art: FeldArt;
  label: string;
  hinweis: string;
  /** Zeichengrenze fuer Textfelder - gezeichnet wird in fester Breite. */
  maxLaenge?: number;
}

export const FELD_BESCHREIBUNG: Readonly<Record<PostFeld, FeldBeschreibung>> = {
  titel: { art: 'text', label: 'Überschrift', hinweis: 'Die Aussage des Bildes.', maxLaenge: 90 },
  untertitel: {
    art: 'text',
    label: 'Unterzeile',
    hinweis: 'Eine Zeile darunter - Spiel, Modus, Anlass.',
    maxLaenge: 90,
  },
  text: {
    art: 'mehrzeilig',
    label: 'Text',
    hinweis: 'Eine Zeile je Punkt. Was nicht aufs Bild passt, gehört in die Bildunterschrift.',
    maxLaenge: 420,
  },
  cta: { art: 'text', label: 'Handlungsaufruf', hinweis: '«Jetzt anmelden», «Link in Bio».', maxLaenge: 48 },
  datum: { art: 'datum', label: 'Datum', hinweis: 'Wird in Schweizer Schreibweise gesetzt.' },
  zeit: { art: 'zeit', label: 'Uhrzeit', hinweis: 'Ortszeit - dieselbe Zone wie im übrigen System.' },
  ort: { art: 'text', label: 'Ort', hinweis: 'Kanal, Server, Lokal.', maxLaenge: 60 },
  link: { art: 'url', label: 'Link', hinweis: 'Nur https. Erscheint als Text, nicht als Verweis.' },
  bild: { art: 'bild', label: 'Motiv', hinweis: 'PNG, JPG oder WebP. Wird je Design anders eingesetzt.' },
  hintergrundbild: {
    art: 'bild',
    label: 'Hintergrund',
    hinweis: 'Liegt hinter allem, abgedunkelt - damit die Schrift lesbar bleibt.',
  },
  logo: { art: 'bild', label: 'Logo', hinweis: 'Oben links. Ohne Angabe das SwissHub-Signet.' },
  akzentfarbe: { art: 'farbe', label: 'Akzentfarbe', hinweis: 'Ohne Angabe SwissHub-Rot.' },
  sponsoren: { art: 'liste', label: 'Partnerzeichen', hinweis: 'Bis zu sechs Logos in einer Reihe.' },
  teams: { art: 'begegnung', label: 'Teams', hinweis: 'Zwei Seiten - Namen, optional je ein Zeichen.' },
  punkte: { art: 'begegnung', label: 'Punkte', hinweis: 'Das Ergebnis je Seite.' },
  gewinner: { art: 'text', label: 'Gewinner', hinweis: 'Der Name, der grossgesetzt wird.', maxLaenge: 60 },
  platzierung: {
    art: 'text',
    label: 'Platzierung',
    hinweis: '«1. Platz», «Sieger», «Bester Rookie» - steht über dem Namen.',
    maxLaenge: 40,
  },
  bracket: {
    art: 'turnierbaum',
    label: 'Turnierbaum',
    hinweis: 'Runden und Begegnungen - von Hand oder aus einem Turnier übernommen.',
  },
  fusszeile: { art: 'text', label: 'Fusszeile', hinweis: 'Der Satz unten.', maxLaenge: 80 },
  branding: { art: 'schalter', label: 'SwissHub-Zeichen zeigen', hinweis: 'Das Signet oben links.' },
};

// --- Designs ----------------------------------------------------------------

/**
 * Die sechs Geruste (§32).
 *
 * Jedes ist eine andere Anordnung derselben Bausteine - nicht derselbe Aufbau
 * in anderen Farben. Was sie unterscheidet, steht in `aufbau`, und ein Test
 * prueft, dass sich die gezeichneten Strukturen tatsaechlich unterscheiden.
 */
export const POST_DESIGNS = ['clean', 'bold', 'minimal', 'tournament', 'dark', 'spotlight'] as const;
export type PostDesign = (typeof POST_DESIGNS)[number];

export interface DesignBeschreibung {
  id: PostDesign;
  label: string;
  beschreibung: string;
  /** Wie die Flaeche aufgeteilt ist - die Kurzform fuer die Auswahl. */
  aufbau: string;
  /** Nutzt dieses Design ein Motiv, und wenn ja wofuer? */
  bildrolle: 'keine' | 'band' | 'haelfte' | 'rund' | 'flaeche';
  /** Dunkler Grund? Entscheidet ueber die Schriftfarbe. */
  dunkel: boolean;
}

export const DESIGN_BESCHREIBUNG: Readonly<Record<PostDesign, DesignBeschreibung>> = {
  clean: {
    id: 'clean',
    label: 'Clean',
    beschreibung: 'Links gesetzt, viel Luft, feine Linien. Das ruhigste der sechs.',
    aufbau: 'Marke oben, Text links in drei Stufen, Motiv als Band unten, Fusszeile am Rand.',
    bildrolle: 'band',
    dunkel: false,
  },
  bold: {
    id: 'bold',
    label: 'Bold',
    beschreibung: 'Die Überschrift füllt die Fläche, ein Farbkeil liegt darunter.',
    aufbau: 'Farbkeil diagonal, Überschrift übergross und randlos, Meta als Streifen unten.',
    bildrolle: 'keine',
    dunkel: true,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    beschreibung: 'Zentriert, kleine Versalien, ein Haarlinienrahmen und sonst Leere.',
    aufbau: 'Rahmen innen, alles zentriert in der Mitte, nichts an den Rändern.',
    bildrolle: 'keine',
    dunkel: false,
  },
  tournament: {
    id: 'tournament',
    label: 'Tournament',
    beschreibung: 'Für Wettbewerbe: Kopfband mit Spiel und Modus, grosse Mitte, Faktenstreifen.',
    aufbau: 'Kopfband, Inhaltsbühne in der Mitte, drei Fakten als Spalten unten.',
    bildrolle: 'keine',
    dunkel: true,
  },
  dark: {
    id: 'dark',
    label: 'Dark / Red SwissHub',
    beschreibung: 'Schwarz mit rotem Keil in der Ecke, Textblock versetzt, Motiv als Seitenbahn.',
    aufbau: 'Eckkeil oben rechts, Motiv als rechte Bahn, Text versetzt links, Linie als Abschluss.',
    bildrolle: 'haelfte',
    dunkel: true,
  },
  spotlight: {
    id: 'spotlight',
    label: 'Spotlight',
    beschreibung: 'Ein Gesicht oder Zeichen im Kreis, das Namensschild überlappt es.',
    aufbau: 'Motiv rund und gross in der Mitte, Namensschild überlappend darunter, Lichthof dahinter.',
    bildrolle: 'rund',
    dunkel: true,
  },
};

// --- Die Posttypen ----------------------------------------------------------

export interface PostTypBeschreibung {
  id: string;
  label: string;
  beschreibung: string;
  /** Welcher Inhaltsblock in die Flaeche des Designs kommt. */
  block: InhaltsBlock;
  /** Die Felder dieses Typs - in der Reihenfolge, in der der Editor sie zeigt. */
  felder: readonly PostFeld[];
  /** Pflichtfelder: ohne sie ist der Post nicht «fertig». */
  pflicht: readonly PostFeld[];
  /** Welche Geruste zu diesem Inhalt passen - das erste ist die Vorgabe. */
  designs: readonly PostDesign[];
  /** Liest der Typ Daten aus einem anderen Modul? */
  quelle: 'frei' | 'turnier';
}

/**
 * Die Inhaltsbloecke.
 *
 * Sieben Formen, in denen Inhalt auftritt - und dreizehn Typen, die sich
 * darauf verteilen. Eine Turnier-Ankuendigung und eine Event-Ankuendigung
 * zeigen dasselbe (Titel, Zeit, Ort, Aufruf) und sind trotzdem zwei Typen:
 * verschiedene Vorgaben, verschiedene Designs, verschiedene Worte im Editor.
 */
export type InhaltsBlock = 'aussage' | 'termin' | 'begegnung' | 'ergebnis' | 'baum' | 'person' | 'liste';

export const POST_TYPEN: readonly PostTypBeschreibung[] = [
  {
    id: 'info',
    label: 'Info / Ankündigung',
    beschreibung: 'Eine Aussage, die für sich steht.',
    block: 'aussage',
    felder: [
      'titel',
      'untertitel',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'logo',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['clean', 'bold', 'minimal', 'dark'],
    quelle: 'frei',
  },
  {
    id: 'event',
    label: 'Event',
    beschreibung: 'Was, wann, wo - und was man tun soll.',
    block: 'termin',
    felder: [
      'titel',
      'untertitel',
      'datum',
      'zeit',
      'ort',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'logo',
      'sponsoren',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel', 'datum'],
    designs: ['clean', 'bold', 'dark', 'tournament'],
    quelle: 'frei',
  },
  {
    id: 'turnier',
    label: 'Turnier-Ankündigung',
    beschreibung: 'Spiel, Termin, Preis, Anmeldung.',
    block: 'termin',
    felder: [
      'titel',
      'untertitel',
      'datum',
      'zeit',
      'ort',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'logo',
      'sponsoren',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['tournament', 'bold', 'dark', 'clean'],
    quelle: 'turnier',
  },
  {
    id: 'bracket',
    label: 'Turnier-Baum',
    beschreibung: 'Runden und Begegnungen - von Hand oder aus einem Turnier übernommen.',
    block: 'baum',
    felder: ['titel', 'untertitel', 'bracket', 'logo', 'sponsoren', 'akzentfarbe', 'fusszeile', 'branding'],
    pflicht: ['titel', 'bracket'],
    designs: ['tournament', 'dark', 'clean'],
    quelle: 'turnier',
  },
  {
    id: 'gewinner',
    label: 'Gewinner',
    beschreibung: 'Ein Name gross, der Anlass klein.',
    block: 'person',
    felder: [
      'titel',
      'gewinner',
      'platzierung',
      'untertitel',
      'punkte',
      'text',
      'cta',
      'bild',
      'logo',
      'sponsoren',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['gewinner'],
    designs: ['spotlight', 'bold', 'dark', 'tournament'],
    quelle: 'turnier',
  },
  {
    id: 'match',
    label: 'Match / Begegnung',
    beschreibung: 'Zwei Seiten gegeneinander, mit Termin.',
    block: 'begegnung',
    felder: [
      'titel',
      'untertitel',
      'teams',
      'datum',
      'zeit',
      'ort',
      'punkte',
      'text',
      'logo',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['teams'],
    designs: ['tournament', 'dark', 'bold'],
    quelle: 'turnier',
  },
  {
    id: 'resultat',
    label: 'Resultat',
    beschreibung: 'Dieselben zwei Seiten, jetzt mit Punkten.',
    block: 'ergebnis',
    felder: [
      'titel',
      'untertitel',
      'teams',
      'punkte',
      'datum',
      'zeit',
      'ort',
      'text',
      'logo',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['teams', 'punkte'],
    designs: ['tournament', 'dark', 'bold'],
    quelle: 'turnier',
  },
  {
    id: 'team',
    label: 'Team-Vorstellung',
    beschreibung: 'Ein Team mit seiner Aufstellung.',
    block: 'liste',
    felder: [
      'titel',
      'untertitel',
      'text',
      'cta',
      'link',
      'bild',
      'logo',
      'sponsoren',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['spotlight', 'clean', 'dark'],
    quelle: 'frei',
  },
  {
    id: 'partner',
    label: 'Partner / Sponsor',
    beschreibung: 'Wer mitträgt - mit Zeichen.',
    block: 'liste',
    felder: [
      'titel',
      'untertitel',
      'text',
      'sponsoren',
      'cta',
      'link',
      'bild',
      'logo',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['clean', 'minimal', 'dark'],
    quelle: 'frei',
  },
  {
    id: 'news',
    label: 'Community-News',
    beschreibung: 'Was im Server passiert ist.',
    block: 'aussage',
    felder: [
      'titel',
      'untertitel',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'sponsoren',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['clean', 'bold', 'minimal'],
    quelle: 'frei',
  },
  {
    id: 'reminder',
    label: 'Reminder',
    beschreibung: 'Die Erinnerung kurz vorher.',
    block: 'termin',
    felder: [
      'titel',
      'untertitel',
      'datum',
      'zeit',
      'ort',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['bold', 'minimal', 'dark'],
    quelle: 'frei',
  },
  {
    id: 'recruitment',
    label: 'Recruitment',
    beschreibung: 'Wir suchen jemanden - was und wofür.',
    block: 'liste',
    felder: [
      'titel',
      'untertitel',
      'text',
      'cta',
      'link',
      'bild',
      'hintergrundbild',
      'logo',
      'akzentfarbe',
      'fusszeile',
      'branding',
    ],
    pflicht: ['titel'],
    designs: ['bold', 'clean', 'dark'],
    quelle: 'frei',
  },
  {
    id: 'update',
    label: 'Update / Patch / System-News',
    beschreibung: 'Was sich geändert hat, als Liste.',
    block: 'liste',
    felder: ['titel', 'untertitel', 'text', 'cta', 'link', 'bild', 'akzentfarbe', 'fusszeile', 'branding'],
    pflicht: ['titel'],
    designs: ['minimal', 'clean', 'dark'],
    quelle: 'frei',
  },
];

// --- Nachschlagen -----------------------------------------------------------

const TYP_INDEX = new Map(POST_TYPEN.map((typ) => [typ.id, typ]));

export function postTyp(id: string | null | undefined): PostTypBeschreibung | null {
  return (id && TYP_INDEX.get(id)) || null;
}

/**
 * Das Design, mit dem ein Typ gezeichnet wird.
 *
 * Ein Typ, dem ein Design nicht zugeordnet ist, bekommt sein erstes - und
 * nicht einen Fehler. Die Alternative waere ein Post, der nach einer
 * Umbenennung in der Registry nicht mehr oeffnet; die Vorgabe sagt, die
 * Vorlagenliste soll erweiterbar sein, und das schliesst Umbauten ein.
 */
export function postDesign(typId: string, designId: string | null | undefined): PostDesign {
  const typ = postTyp(typId);
  if (!typ) {
    return 'clean';
  }
  const gewaehlt = POST_DESIGNS.find((eintrag) => eintrag === designId);
  if (gewaehlt && typ.designs.includes(gewaehlt)) {
    return gewaehlt;
  }
  return typ.designs[0] ?? 'clean';
}

/** Hat dieser Typ dieses Feld? Die Antwort, auf die sich Editor und Pruefung stuetzen. */
export function typHatFeld(typId: string, feld: PostFeld): boolean {
  return postTyp(typId)?.felder.includes(feld) ?? false;
}
