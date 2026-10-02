/**
 * Farbwerte aus fremder Hand.
 *
 * ## Warum das serverseitig passiert
 *
 * Weil ein Farbwert aus einem Formular eine Zeichenkette ist, und eine
 * Zeichenkette kann alles sein. Sie landet hier in einer Grafik, also in einem
 * `style`-Attribut - und `red; background-image: url(https://…)` waere dort
 * nicht nur haesslich, sondern ein Abruf einer fremden Adresse durch den
 * Server, der das Bild zeichnet.
 *
 * Deshalb keine Bereinigung, sondern eine **Umwandlung**: was hier
 * herauskommt, ist entweder `#rrggbb` aus sechs Hexziffern oder `null`. Es gibt
 * keinen Weg, durch den eine Eingabe unveraendert in die Ausgabe gelangt.
 *
 * ## Welche Schreibweisen hereinkommen duerfen
 *
 * Die, die Leute tatsaechlich in der Hand haben: `#83060a` aus einem
 * Styleguide, `#fff` als Kurzform, `rgb(131, 6, 10)` aus einem Grafikprogramm.
 * Farbnamen (`darkred`) bewusst nicht - sie sind eine Liste von 148 Woertern,
 * die zwischen Browsern nicht ganz gleich ist, und niemand gibt sie ein, wenn
 * ein Farbwaehler daneben steht.
 */

const HEX_LANG = /^#([0-9a-f]{6})$/iu;
const HEX_KURZ = /^#([0-9a-f]{3})$/iu;
const RGB = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/iu;

function zweiStellen(wert: number): string {
  return wert.toString(16).padStart(2, '0');
}

/**
 * Eine Farbe auf `#rrggbb` bringen - oder `null`.
 *
 * `null` heisst «das ist keine Farbe», und der Aufrufer nimmt dann seinen
 * Standard. Es heisst nicht Schwarz: eine unverstaendliche Eingabe als
 * `#000000` zu lesen hiesse, einen Tippfehler als Entscheidung auszugeben.
 *
 * Leer ist ebenfalls `null`, und zwar ohne Aufhebens - ein leeres Feld ist die
 * normale Art zu sagen «nimm die Standardfarbe».
 */
export function normalisiereFarbe(eingabe: string | null | undefined): string | null {
  const rohwert = (eingabe ?? '').trim();
  if (rohwert === '') {
    return null;
  }

  const lang = HEX_LANG.exec(rohwert);
  if (lang) {
    return `#${lang[1]!.toLowerCase()}`;
  }

  const kurz = HEX_KURZ.exec(rohwert);
  if (kurz) {
    // `#f0a` ist `#ff00aa` - jede Ziffer verdoppelt, so liest sie jeder Browser.
    const ziffern = kurz[1]!.toLowerCase();
    return `#${[...ziffern].map((ziffer) => ziffer + ziffer).join('')}`;
  }

  const rgb = RGB.exec(rohwert);
  if (rgb) {
    const kanaele = [rgb[1]!, rgb[2]!, rgb[3]!].map((teil) => Number.parseInt(teil, 10));
    // 300 ist keine Farbe und auch nicht «fast 255» - wer sich hier vertippt,
    // soll den Standard bekommen und nicht eine geratene Farbe.
    if (kanaele.some((kanal) => kanal > 255)) {
      return null;
    }
    return `#${kanaele.map(zweiStellen).join('')}`;
  }

  return null;
}

/** Ist das eine Farbe, die `normalisiereFarbe` annimmt? */
export function istFarbe(eingabe: string | null | undefined): boolean {
  return normalisiereFarbe(eingabe) !== null;
}

/**
 * Ein hellerer Ton derselben Farbe.
 *
 * ## Wofuer
 *
 * Die Grafiken benutzen zwei Toene: einen satten fuer Flaechen und einen
 * helleren fuer Schrift und Akzente auf dunklem Grund. Bei SwissHub-Rot sind
 * das `#83060a` und `#b81219`. Wer eine eigene Farbe einstellt, gibt **eine**
 * an - den zweiten Ton auch noch zu verlangen, waere eine Frage zu viel fuer
 * einen Gewinn, den man nur sieht, wenn man beide Grafiken nebeneinanderlegt.
 *
 * ## Warum aufgehellt und nicht abgedunkelt
 *
 * Weil der Grund dunkel ist. Ein Akzent, der dunkler waere als die Flaeche,
 * verschwindet darin - und bei einer dunklen Markenfarbe (Marineblau,
 * Flaschengruen) waere genau das passiert.
 *
 * `anteil` ist der Weg Richtung Weiss: 0 laesst die Farbe, 1 ergibt Weiss.
 */
export function heller(farbe: string, anteil = 0.28): string {
  const normal = normalisiereFarbe(farbe);
  if (!normal) {
    return farbe;
  }
  const grenze = Math.min(Math.max(anteil, 0), 1);
  const kanaele = [1, 3, 5].map((start) => Number.parseInt(normal.slice(start, start + 2), 16));
  return `#${kanaele.map((kanal) => zweiStellen(Math.round(kanal + (255 - kanal) * grenze))).join('')}`;
}
