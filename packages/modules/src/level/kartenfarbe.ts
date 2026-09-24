/**
 * Die Textfarbe der eigenen Levelkarte.
 *
 * ## Warum das Pruefen hierher gehoert
 *
 * Die Farbe kommt aus einem Eingabefeld und landet in einem SVG-Attribut.
 * Zwischen diesen beiden Punkten muss aus einer beliebigen Zeichenkette eine
 * Farbe geworden sein - und zwar genau hier, nicht im Browser und nicht in
 * der Vorlage. Was `normalisiereTextfarbe` zurueckgibt, ist entweder
 * `#RRGGBB` in Grossbuchstaben oder `null`. Etwas anderes gibt es nicht, und
 * damit kann in der Karte nichts stehen, was dort anders gelesen wuerde als
 * eine Farbe.
 *
 * ## Warum der Kontrast nur gemeldet und nicht erzwungen wird
 *
 * Wer Dunkelrot auf Dunkelrot waehlt, bekommt einen Hinweis. Was er nicht
 * bekommt, ist eine stillschweigend andere Farbe: eine Oberflaeche, die die
 * eigene Eingabe heimlich ersetzt, ist schlimmer als eine schlecht lesbare
 * Karte - beim naechsten Mal weiss niemand mehr, was er eigentlich
 * eingestellt hat.
 *
 * Fuer die Lesbarkeit sorgt die Karte selbst: hinter dem Text liegt ein
 * Verlauf, der den Untergrund abdunkelt. Deshalb ist der Bezugspunkt der
 * Rechnung unten nicht das Hintergrundbild - das kennt niemand im Voraus -,
 * sondern dieser abgedunkelte Untergrund.
 */

/** Die Farbe, wenn niemand etwas gewaehlt hat. */
export const STANDARD_TEXTFARBE = '#FFFFFF';

/** Dieselbe Frage im Hoechstlevel: dort ist die Karte golden. */
export const PRESTIGE_TEXTFARBE = '#D4AF37';

/**
 * Wie dunkel der Untergrund hinter dem Text mindestens ist.
 *
 * Die Karte legt einen Verlauf aus `#08080A` darueber, links bei 88 Prozent
 * Deckkraft. Selbst vor einem weissen Bild bleibt damit ein sehr dunkler
 * Grund - das ist der Wert, gegen den hier gerechnet wird.
 */
const UNTERGRUND_DUNKEL = '#0B0B0D';

/** Und das Gegenstueck: der hellste Punkt, den derselbe Verlauf noch zulaesst. */
const UNTERGRUND_HELL = '#3A3A3E';

/**
 * Aus einer Eingabe eine Farbe machen - oder `null`.
 *
 * Erlaubt sind `#RGB`, `#RRGGBB` und dieselben beiden ohne Rautezeichen, mit
 * Gross- oder Kleinbuchstaben und mit Leerzeichen davor und dahinter. Alles
 * andere ist keine Farbe: benannte Farben nicht, `rgb(...)` nicht,
 * `url(...)` schon gar nicht.
 */
export function normalisiereTextfarbe(roh: string | null | undefined): string | null {
  if (typeof roh !== 'string') {
    return null;
  }
  const geputzt = roh.trim().replace(/^#/u, '').toUpperCase();

  if (/^[0-9A-F]{6}$/u.test(geputzt)) {
    return `#${geputzt}`;
  }
  if (/^[0-9A-F]{3}$/u.test(geputzt)) {
    // `#F0A` meint `#FF00AA` - jede Stelle verdoppelt.
    return `#${[...geputzt].map((zeichen) => zeichen + zeichen).join('')}`;
  }
  return null;
}

/** Die drei Kanaele einer bereits normalisierten Farbe. */
function kanaele(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Relative Leuchtdichte nach WCAG 2.
 *
 * Nicht der Mittelwert der Kanaele: das menschliche Auge sieht Gruen sehr
 * viel heller als Blau, und eine Rechnung, die das ignoriert, haelt
 * Dunkelblau auf Schwarz fuer gut lesbar.
 */
export function relativeLeuchtdichte(hex: string): number {
  const [r, g, b] = kanaele(hex).map((wert) => {
    const anteil = wert / 255;
    return anteil <= 0.03928 ? anteil / 12.92 : ((anteil + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis zweier Farben, von 1 (gleich) bis 21 (Schwarz zu Weiss). */
export function kontrastverhaeltnis(a: string, b: string): number {
  const ersteres = relativeLeuchtdichte(a);
  const zweiteres = relativeLeuchtdichte(b);
  const hell = Math.max(ersteres, zweiteres);
  const dunkel = Math.min(ersteres, zweiteres);
  return (hell + 0.05) / (dunkel + 0.05);
}

export type Kontraststufe = 'gut' | 'knapp' | 'kritisch';

export interface Kontrastbefund {
  stufe: Kontraststufe;
  /** Das schlechtere der beiden Verhaeltnisse, auf eine Stelle gerundet. */
  verhaeltnis: number;
  /** Was dem Benutzer dazu gesagt wird - `null`, wenn es nichts zu sagen gibt. */
  hinweis: string | null;
}

/**
 * Wie gut sich diese Farbe auf der Karte lesen laesst.
 *
 * Gemessen gegen beide Enden des Verlaufs hinter dem Text und bewertet nach
 * dem schlechteren Wert. Die Schwellen sind die von WCAG fuer grossen Text:
 * ab 3:1 lesbar, ab 4.5:1 ohne Einschraenkung. Die Levelkarte besteht fast
 * nur aus grossem Text; 4.5 als Mindestmass zu verlangen wuerde jede
 * gedecktere Farbe ausschliessen, ohne dass irgendetwas davon besser lesbar
 * wuerde.
 */
export function pruefeKartenkontrast(farbe: string): Kontrastbefund {
  const normalisiert = normalisiereTextfarbe(farbe);
  if (!normalisiert) {
    return { stufe: 'kritisch', verhaeltnis: 1, hinweis: 'Das ist keine gültige Farbe.' };
  }

  const verhaeltnis = Math.min(
    kontrastverhaeltnis(normalisiert, UNTERGRUND_DUNKEL),
    kontrastverhaeltnis(normalisiert, UNTERGRUND_HELL),
  );
  const gerundet = Math.round(verhaeltnis * 10) / 10;

  if (verhaeltnis >= 4.5) {
    return { stufe: 'gut', verhaeltnis: gerundet, hinweis: null };
  }
  if (verhaeltnis >= 3) {
    return {
      stufe: 'knapp',
      verhaeltnis: gerundet,
      hinweis: `Kontrast ${gerundet}:1 - lesbar, aber knapp. Vor einem hellen Hintergrundbild kann die Schrift schwer erkennbar werden.`,
    };
  }
  return {
    stufe: 'kritisch',
    verhaeltnis: gerundet,
    hinweis: `Kontrast ${gerundet}:1 - diese Farbe ist auf der Karte kaum zu lesen. Sie wird trotzdem genau so verwendet.`,
  };
}
