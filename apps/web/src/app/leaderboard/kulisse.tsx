/**
 * Die Kulisse hinter der Rangliste.
 *
 * ## Was sie ist
 *
 * Ein feines Raster, das sehr langsam wandert, und zwei weiche Lichter, die
 * kaum merklich atmen. Mehr nicht.
 *
 * ## Warum so wenig
 *
 * Der Inhalt dieser Seite ist eine Rangliste. Alles, was davon ablenkt,
 * arbeitet gegen sie. Schwebende Leuchtkugeln, Partikel und Farbverlaeufe
 * ueber die ganze Flaeche sehen auf einem Screenshot lebendig aus und machen
 * eine Tabelle danach unleserlich.
 *
 * ## Warum ohne Canvas
 *
 * Zwei CSS-Animationen auf `transform` und `opacity` laufen im Compositor -
 * ohne JavaScript, ohne Layout, ohne Neuzeichnen. Ein Canvas mit Partikeln
 * haelt dagegen einen Timer am Laufen, solange die Seite offen ist, und das
 * auf einer Seite, die auch auf Telefonen im Hintergrund liegen wird.
 *
 * ## Reduzierte Bewegung
 *
 * Bei `prefers-reduced-motion: reduce` steht alles still. Die Kulisse bleibt
 * als ruhige Flaeche sichtbar - sie verschwinden zu lassen waere ein anderes
 * Aussehen, nicht weniger Bewegung.
 */
export function Kulisse(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Grundton: nach unten hin dunkler, damit die Liste ruhig steht. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,hsl(var(--card-elevated))_0%,hsl(var(--background))_60%)]" />

      {/* Das wandernde Raster. */}
      <div className="lb-raster absolute inset-x-[-25%] top-[-20%] h-[75%] opacity-[0.16]" />

      {/* Zwei Lichter in Markenrot - gezielt, nicht flaechendeckend. */}
      <div className="lb-licht lb-licht-a absolute left-[8%] top-[-6rem] size-[26rem] rounded-full bg-[hsl(var(--primary))] blur-[120px]" />
      <div className="lb-licht lb-licht-b absolute right-[4%] top-[18rem] size-[20rem] rounded-full bg-[hsl(var(--primary-bright))] blur-[140px]" />

      {/* Weicher Uebergang in die Seite. */}
      <div className="absolute inset-x-0 top-[55%] h-[45%] bg-gradient-to-b from-transparent to-[hsl(var(--background))]" />
    </div>
  );
}
