/**
 * Die Abschnitte der oeffentlichen Profilseite - und ihre Reihenfolge.
 *
 * ## Warum eine Registry und kein Website-Builder
 *
 * Ein Mitglied soll entscheiden koennen, was oben steht: wer streamt, will den
 * Stream zuerst zeigen; wer Turniere spielt, seine Platzierungen. Das ist eine
 * **Reihenfolge einer festen Menge** und keine freie Gestaltung.
 *
 * Der Unterschied ist die ganze Sicherheit dieser Datei. Eine gespeicherte
 * Liste von Schluesseln kann nur die Abschnitte umsortieren, die es gibt. Eine
 * freie Struktur - Spalten, Bloecke, eigenes CSS - waere eine Sprache in einem
 * Textfeld, und dann steht die Frage im Raum, was sie alles ausdruecken kann.
 *
 * ## Warum unbekannte Schluessel uebergangen und fehlende angehaengt werden
 *
 * Die Spalte ist aelter als der naechste Stand des Codes. Wird ein Abschnitt
 * entfernt, steht sein Schluessel noch in tausend Profilen; kommt einer dazu,
 * fehlt er in allen. Beides darf die Seite nicht unvollstaendig machen -
 * `ordneAbschnitte` sorgt dafuer, dass immer jeder Abschnitt genau einmal
 * vorkommt, egal was gespeichert ist.
 *
 * Diese Datei kennt keine Datenbank und keine Anzeige. Damit darf der Editor
 * sie importieren, ohne den Server mitzubringen.
 */

export const ABSCHNITT_SCHLUESSEL = [
  'streaming',
  'ueber-mich',
  'gaming',
  'links',
  'auszeichnungen',
  'vitrine',
  'level',
  'turniere',
  'steckbrief',
] as const;

export type AbschnittSchluessel = (typeof ABSCHNITT_SCHLUESSEL)[number];

export interface AbschnittArt {
  key: AbschnittSchluessel;
  /** Die Ueberschrift auf der oeffentlichen Seite. */
  label: string;
  /** Ein Satz im Editor - was in diesem Abschnitt steht. */
  beschreibung: string;
  /**
   * Nimmt dieser Abschnitt die ganze Breite ein?
   *
   * Steht hier und nicht in der Komponente: die Reihenfolge entscheidet ueber
   * das Layout mit, und eine Komponente, die ihre Breite selbst waehlt, laesst
   * sich nicht umsortieren, ohne dass das Raster bricht.
   */
  breit: boolean;
}

/**
 * Die Vorgabe-Reihenfolge.
 *
 * Streaming zuerst, weil es das einzige Zeitkritische ist: wer gerade live ist,
 * soll es sehen, bevor er scrollt. Dann die Person selbst, dann ihre Spiele,
 * dann die Links - in dieser Reihenfolge liest jemand eine Visitenkarte.
 * Steckbrief und Zahlen stehen unten; sie beantworten Fragen, die man erst
 * stellt, wenn der Rest gefallen hat.
 */
const ARTEN: readonly AbschnittArt[] = [
  {
    key: 'streaming',
    label: 'Streaming',
    beschreibung: 'Live-Status und Kanäle aus dem Streamer Hub - nur wenn du dort freigegeben bist.',
    breit: true,
  },
  {
    key: 'ueber-mich',
    label: 'Über mich',
    beschreibung: 'Dein Text aus dem Abschnitt «Allgemein».',
    breit: true,
  },
  {
    key: 'gaming',
    label: 'Meine Gaming-Welt',
    beschreibung: 'Lieblingsspiele, Plattformen, Sprachen, Spielzeiten und dein Mitspieler-Status.',
    breit: true,
  },
  {
    key: 'links',
    label: 'Links',
    beschreibung: 'Deine Kanäle und Links - die hervorgehobenen als grosse Knöpfe.',
    breit: true,
  },
  {
    key: 'auszeichnungen',
    label: 'Auszeichnungen',
    beschreibung: 'Die Auszeichnungen, die du erreicht hast.',
    breit: false,
  },
  {
    key: 'vitrine',
    label: 'Vitrine',
    beschreibung: 'Deine drei Vitrinenplätze.',
    breit: true,
  },
  {
    key: 'level',
    label: 'Level',
    beschreibung: 'Dein Level und der Fortschritt zum nächsten.',
    breit: false,
  },
  {
    key: 'turniere',
    label: 'Turniererfolge',
    beschreibung: 'Turniere, an denen du teilgenommen hast - mit Platzierung.',
    breit: false,
  },
  {
    key: 'steckbrief',
    label: 'Steckbrief',
    beschreibung: 'Sprachen, Plattformen und Spielzeiten als kurze Liste.',
    breit: false,
  },
];

const NACH_KEY = new Map(ARTEN.map((art) => [art.key, art]));

export function alleAbschnitte(): readonly AbschnittArt[] {
  return ARTEN;
}

export function abschnittArt(key: string): AbschnittArt | undefined {
  return NACH_KEY.get(key as AbschnittSchluessel);
}

export function istAbschnittSchluessel(key: string): key is AbschnittSchluessel {
  return NACH_KEY.has(key as AbschnittSchluessel);
}

/**
 * Aus einer gespeicherten Liste eine vollstaendige Reihenfolge machen.
 *
 * Drei Regeln, und jede deckt einen Fall ab, der tatsaechlich vorkommt:
 *
 * 1. **Unbekannte Schluessel fallen weg.** Ein entfernter Abschnitt steht noch
 *    in gespeicherten Listen; ihn durchzulassen hiesse, dass die Anzeige einen
 *    Schluessel nachschlagen muss, den es nicht gibt.
 * 2. **Doppelte kommen einmal vor.** Sonst stuende ein Abschnitt zweimal auf
 *    der Seite.
 * 3. **Fehlende kommen hinten dazu**, in ihrer Vorgabe-Reihenfolge. Ein neuer
 *    Abschnitt erscheint damit bei jedem, ohne dass jemand eine Migration
 *    schreibt - und ohne dass er sich vor etwas draengelt, das jemand bewusst
 *    nach oben gestellt hat.
 */
export function ordneAbschnitte(gespeichert: readonly string[]): AbschnittSchluessel[] {
  const gesehen = new Set<AbschnittSchluessel>();
  const reihe: AbschnittSchluessel[] = [];

  for (const key of gespeichert) {
    if (istAbschnittSchluessel(key) && !gesehen.has(key)) {
      gesehen.add(key);
      reihe.push(key);
    }
  }
  for (const art of ARTEN) {
    if (!gesehen.has(art.key)) {
      reihe.push(art.key);
    }
  }
  return reihe;
}
