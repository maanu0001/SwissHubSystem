import './auszeichnungs-stufen.css';

/**
 * Bronze, Silber, Gold - an einer Stelle beschrieben.
 *
 * ## Warum es diese Datei gibt
 *
 * Die Stufen standen an drei Orten, und an zweien nur als Wort. Die
 * Auszeichnungsliste im Profil trug sie als Material - Rahmen, Struktur,
 * Licht -, die drei hervorgehobenen auf der oeffentlichen Profilseite
 * dagegen als Kleintext unter dem Namen, und die Gamer Card als graues
 * «GOLD» am rechten Rand. Wer sein Profil teilte, teilte damit eine Karte,
 * auf der alle drei Stufen gleich aussahen.
 *
 * Hier steht deshalb, was eine Stufe ist, und die drei Orte fragen nach.
 * Eine vierte Stufe braucht danach genau einen Eintrag in `STUFEN`.
 *
 * ## Warum die Stufe nicht nur Farbe sein darf
 *
 * Etwa jeder zwoelfte Mann unterscheidet Rot und Gruen schlecht; Braun,
 * Grau und Gelb nebeneinander sind fuer einen Teil davon drei Grautoene.
 * Eine Auszeichnung, deren Stufe ausschliesslich in der Farbe steckt, ist
 * fuer diese Leute keine Auszeichnung mehr.
 *
 * Darum traegt jede Stufe drei voneinander unabhaengige Merkmale:
 *
 *   - **Form.** Bronze hat weiche Ecken, Silber angeschnittene, Gold
 *     facettierte. Das ist auch in Graustufen sichtbar.
 *   - **Marke.** Ein bis drei Striche - eine Anzahl, keine Farbe.
 *   - **Wort.** «Bronze», «Silber», «Gold», dazu ein `aria-label` fuer alle,
 *     die die Karte hoeren statt sehen.
 */

export type Stufe = 'bronze' | 'silber' | 'gold';

export interface StufenBeschreibung {
  /** Wie die Stufe heisst - so steht sie auch auf der Karte. */
  label: string;
  /** Die Klassen fuer die Karte selbst. */
  karte: string;
  /** Wie viele Striche die Marke zeigt. */
  striche: 1 | 2 | 3;
  /**
   * Die Farben fuer alles, was kein CSS kann - die Gamer Card.
   *
   * Satori kennt keine CSS-Variablen und keine Klassen; es braucht Zahlen.
   * Sie stehen hier und nicht dort, damit die exportierte Karte dieselbe
   * Stufe zeigt wie die Seite, aus der sie entsteht.
   */
  bild: {
    /** Rahmen. */
    rand: string;
    /** Flaeche der Karte - als Verlauf, wie auf der Seite. */
    flaeche: string;
    /** Das Symbolfeld hinter dem Zeichen. */
    feld: string;
    /** Schrift der Stufenangabe und der Marke. */
    schrift: string;
    /** Wie rund die Ecken sind. Gold am wenigsten, Bronze am meisten. */
    radius: number;
  };
}

export const STUFEN: Record<Stufe, StufenBeschreibung> = {
  bronze: {
    label: 'Bronze',
    karte: 'az-karte az-bronze',
    striche: 1,
    bild: {
      rand: 'rgba(174, 106, 58, 0.62)',
      flaeche: 'linear-gradient(168deg, rgba(92, 58, 34, 0.92), rgba(44, 29, 19, 0.92))',
      feld: 'rgba(120, 74, 42, 0.55)',
      schrift: 'rgb(214, 158, 110)',
      radius: 18,
    },
  },
  silber: {
    label: 'Silber',
    karte: 'az-karte az-silber',
    striche: 2,
    bild: {
      rand: 'rgba(186, 196, 208, 0.55)',
      flaeche: 'linear-gradient(172deg, rgba(72, 80, 92, 0.92), rgba(36, 40, 47, 0.92))',
      feld: 'rgba(104, 114, 128, 0.55)',
      schrift: 'rgb(206, 214, 224)',
      radius: 8,
    },
  },
  gold: {
    label: 'Gold',
    karte: 'az-karte az-gold',
    striche: 3,
    bild: {
      rand: 'rgba(233, 186, 76, 0.72)',
      flaeche: 'linear-gradient(165deg, rgba(126, 95, 30, 0.94), rgba(58, 44, 18, 0.94))',
      feld: 'rgba(160, 122, 40, 0.6)',
      schrift: 'rgb(242, 204, 112)',
      radius: 5,
    },
  },
};

/** Die Beschreibung zu einer Stufe - Unbekanntes faellt auf Bronze. */
export function stufe(wert: string): StufenBeschreibung {
  return STUFEN[wert as Stufe] ?? STUFEN.bronze;
}

/**
 * Die Stufenmarke: ein bis drei Striche.
 *
 * Eine Anzahl statt einer Farbe, und deshalb auch dann lesbar, wenn die Farbe
 * es nicht ist - auf einem schlechten Bildschirm, im Sonnenlicht, mit einer
 * Farbsehschwaeche. Das `aria-label` sagt dasselbe noch einmal in Worten;
 * die Striche selbst sind fuer Vorleseprogramme unsichtbar, sonst hoerte man
 * dreimal «Strich».
 */
export function StufenMarke({
  wert,
  className = '',
}: {
  wert: string;
  className?: string;
}): React.JSX.Element {
  const beschreibung = stufe(wert);
  return (
    <span className={`az-marke ${className}`} role="img" aria-label={beschreibung.label}>
      {Array.from({ length: beschreibung.striche }, (_, index) => (
        <i key={index} aria-hidden="true" />
      ))}
    </span>
  );
}
