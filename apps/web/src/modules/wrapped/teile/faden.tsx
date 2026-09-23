import { cn } from '@/lib/utils';

/**
 * Der Faden.
 *
 * ## Woher er kommt
 *
 * Das SwissHub-Logo ist ein durchgehendes Band: dicke, diagonale Striche mit
 * runden Enden, die in sich zurueckläufen. Genau diese Geometrie - nicht das
 * Logo selbst - ist die Formensprache von Wrapped.
 *
 * Das Logo zwanzigmal in den Hintergrund zu legen waere das Gegenteil davon:
 * es waere Branding statt Gestaltung. Hier wird nur die Bewegung
 * uebernommen - ein Strich, der sich selbst zeichnet, seinen Winkel haelt
 * und zurueckläuft.
 *
 * ## Warum SVG und kein Bild
 *
 * Weil er sich zeichnen koennen muss. `stroke-dashoffset` von der vollen
 * Laenge auf null ist die billigste Animation, die es gibt - der Browser
 * rechnet sie im Compositor -, und sie sieht aus wie ein Stift, der laeuft.
 */

export type FadenVariante = 'marke' | 'linie' | 'band';

export function Faden({
  variante = 'linie',
  className,
  verzug = 0,
  farbe = 'currentColor',
  breite = 10,
}: {
  variante?: FadenVariante;
  className?: string;
  /** Verzoegerung in Millisekunden - fuer gestaffelte Auftritte. */
  verzug?: number;
  farbe?: string;
  breite?: number;
}): React.JSX.Element {
  if (variante === 'marke') {
    // Klein und ohne Animation: in der Kopfzeile soll nichts zappeln.
    return (
      <svg viewBox="0 0 96 64" className={cn('overflow-visible', className)} aria-hidden="true">
        <path
          d={MARKE}
          fill="none"
          stroke={farbe}
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (variante === 'band') {
    return (
      <svg viewBox="0 0 96 64" className={cn('overflow-visible', className)} aria-hidden="true">
        <path
          className="wrapped-faden"
          style={{ ['--faden-laenge' as string]: '260', ['--faden-verzug' as string]: `${verzug}ms` }}
          d={MARKE}
          stroke={farbe}
          strokeWidth={breite}
        />
      </svg>
    );
  }

  /*
   * `preserveAspectRatio="none"` ist hier Absicht.
   *
   * Mit dem Standardwert skaliert der Browser das Kaestchen 200x24 so, dass
   * es ganz hineinpasst - in einem 320x20-Rahmen wird daraus ein 166 Pixel
   * breiter, mittig sitzender Strich. Die Linie soll aber die volle Breite
   * nehmen und links anfangen, also wird ausdruecklich verzerrt. Damit der
   * Strich davon nicht eiförmig wird, rechnet `non-scaling-stroke` die
   * Staerke in Bildschirmpixeln.
   */
  return (
    <svg
      viewBox="0 0 200 24"
      preserveAspectRatio="none"
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      {/* Eine Diagonale im Winkel des Logos - sie trennt und betont. */}
      <path
        className="wrapped-faden"
        style={{ ['--faden-laenge' as string]: '210', ['--faden-verzug' as string]: `${verzug}ms` }}
        d="M 4 20 L 196 4"
        stroke={farbe}
        strokeWidth={breite}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Die abstrahierte Bandform.
 *
 * Ein durchgehender Pfad: von links unten aufsteigend, diagonal quer nach
 * rechts unten, wieder aufsteigend. Zwei Richtungswechsel, gleicher Winkel,
 * runde Enden - das ist der Kern der Marke, ohne sie zu kopieren.
 */
const MARKE = 'M 11 50 C 11 17 30 11 42 26 L 57 44 C 69 59 85 53 85 20';
