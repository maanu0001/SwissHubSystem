import qrcode from 'qrcode-generator';

/**
 * Der QR-Code zur oeffentlichen Profiladresse.
 *
 * ## Warum eine Bibliothek und kein eigener Encoder
 *
 * Weil der schwierige Teil nicht das Raster ist, sondern die
 * Fehlerkorrektur - Reed-Solomon ueber GF(256), mit Generatorpolynomen je
 * Stufe. Das von Hand zu schreiben ergibt Codes, die im Test lesbar sind und
 * auf einem gedruckten Flyer unter Zimmerlicht nicht. `qrcode-generator` ist
 * MIT, hat keine Abhaengigkeiten und macht seit 2009 genau diese eine Sache.
 *
 * ## Warum SVG und nicht ein Raster
 *
 * Weil der Code sowohl in die Gamer Card (durch Satori) als auch in einen
 * Download muss. Ein SVG ist in beiden Faellen dasselbe Bild, beliebig gross
 * und ohne Unschaerfe - und auf Papier ist Schaerfe der ganze Punkt.
 *
 * ## Fehlerkorrektur «Q» und nicht «M»
 *
 * `Q` verkraftet rund 25 Prozent Schaden, `M` rund 15. Der Unterschied kostet
 * ein paar Module mehr und zahlt sich dort aus, wo diese Codes landen: auf
 * Ausdrucken, auf Stickern, auf einem Bildschirm, den jemand aus zwei Metern
 * abfilmt. §13.4 verlangt ausdruecklich, dass er auf gedruckten Karten lesbar
 * bleibt.
 */

/** Wie viel Rand der Code braucht - in Modulen, nicht in Pixeln. */
const RUHEZONE = 2;

/**
 * Den Code als SVG bauen.
 *
 * `cellSize` ist die Kantenlaenge eines Moduls in SVG-Einheiten. Sie bestimmt
 * nicht die Ausgabegroesse - das tut das `width`/`height` am `<img>` -, wohl
 * aber die Zahlengenauigkeit der Pfade. Acht ist grob genug fuer kurze Pfade
 * und fein genug, dass kein Rundungsfehler eine Kante verschiebt.
 */
export function qrSvg(inhalt: string): string {
  const code = qrcode(0, 'Q');
  code.addData(inhalt);
  code.make();
  return code.createSvgTag({ cellSize: 8, margin: RUHEZONE * 8, scalable: false });
}

/**
 * Derselbe Code als Daten-URI.
 *
 * Fuer Satori: ein `<img src="data:image/svg+xml;base64,...">` braucht keinen
 * Netzaufruf waehrend des Zeichnens. Ein Aufruf nach aussen mitten im Rendern
 * waere ein Export, der an einem langsamen Dienst haengt.
 *
 * Base64 und nicht `utf8,...`: der SVG-Inhalt enthaelt `#`, `<` und `"`, und
 * eine unvollstaendige Prozentkodierung ergibt ein Bild, das stillschweigend
 * nicht geladen wird.
 */
export function qrDatenUri(inhalt: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(qrSvg(inhalt), 'utf8').toString('base64')}`;
}
