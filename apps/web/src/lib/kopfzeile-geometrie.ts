/**
 * Die Masse der Kopfzeile - einmal, und von allen Bedienelementen benutzt.
 *
 * ## Warum es diese Datei gibt
 *
 * Die Kopfzeile trug vier Bedienelemente in drei Groessen und zwei Radien:
 * Menue 40x40 mit `rounded-lg`, Suche 40x40 mit `rounded-lg`, Glocke 36x36 mit
 * `rounded-xl`, Profil 82 breit mit `rounded-xl`. Nebeneinander sehen gleiche
 * Abstaende zwischen ungleichen Kaesten ungleich aus - und genau so las sich
 * die Zeile: unruhig, ohne dass man sagen koennte, woran es liegt.
 *
 * Die Werte stehen deshalb hier und nicht in vier Dateien. Es sind Klassen und
 * keine Zahlen, weil Tailwind seine Klassen aus dem Quelltext liest; diese
 * Datei liegt unter `src/` und wird dabei mitgelesen.
 *
 * ## Was hier **nicht** steht
 *
 * Die Hoehe der Kopfzeile. Die haengt am Breakpoint - auf dem Telefon eine
 * feste Zeile, ab `sm` zwei Zeilen mit Beschreibung - und ein Name dafuer
 * waere ein Name fuer zwei Dinge. Sie steht in `app-header.tsx`, an der einen
 * Stelle, die sie setzt.
 */

/**
 * Ein Bedienelement der Kopfzeile: 40x40, quadratisch, gleicher Radius.
 *
 * `shrink-0` ist der Punkt, nicht die Groesse: ohne das geben die Elemente
 * nach, sobald der Seitentitel lang wird, und dann wandert die ganze rechte
 * Haelfte je nach Route. Mit `shrink-0` kann nur eines nachgeben - der Titel,
 * und der soll es.
 *
 * 40 Pixel sind zugleich die kleinste Flaeche, die sich auf einem Telefon
 * zuverlaessig treffen laesst.
 */
export const KOPF_KNOPF =
  'grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Das Symbol darin - eine Groesse fuer alle vier. */
export const KOPF_SYMBOL = 'size-5';

/**
 * Der Abstand zwischen den Bedienelementen rechts.
 *
 * Eng, weil die Kaesten selbst schon Luft mitbringen: zwischen zwei 40er
 * Flaechen mit 20er Symbol liegen optisch bereits 20 Pixel. `gap-3` darueber
 * liess die Gruppe auseinanderfallen und nahm dem Titel 24 Pixel, die er auf
 * einem 390er Bildschirm nicht hat.
 */
export const KOPF_GRUPPE = 'flex shrink-0 items-center gap-0.5 sm:gap-1';
