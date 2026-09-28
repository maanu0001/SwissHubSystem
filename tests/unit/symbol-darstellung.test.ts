import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Panel } from '../../apps/web/src/components/shared/panel';
import { StatCard } from '../../apps/web/src/components/shared/stat-card';
import { NavIcon, symbolKnoten } from '../../apps/web/src/components/layout/nav-icon';

/**
 * Symbole sind Symbole und keine Woerter.
 *
 * ## Der Fehler, den es dazu brauchte
 *
 * `Panel` und `StatCard` nahmen ihr Symbol als `React.ReactNode` entgegen.
 * Eine Zeichenkette ist ein gueltiger `ReactNode` - TypeScript nahm also
 * `icon="BarChart3"` klaglos an, und React zeichnete gehorsam den **Namen**
 * in den Symbolkreis. In «SwissHub fragt» stand an 23 Stellen `Radio`,
 * `Library`, `BarChart3` geschrieben, wo ein Symbol hingehoerte.
 *
 * Das war kein Fehler von «SwissHub fragt». Das Modul hat die Form benutzt,
 * die die Navigation vorgibt - dort **ist** ein Symbol ein Name, weil die
 * Liste serverseitig entsteht und ein React-Element den Weg zum Client nicht
 * uebersteht. Nur haben die zwei Bausteine diese Form nicht nachgeschlagen,
 * sondern hingeschrieben.
 *
 * ## Was dieser Test festhaelt
 *
 * Dass ein Name im ausgelieferten HTML als `<svg>` ankommt und **nicht** als
 * Text. Der Typecheck deckt den anderen Teil ab: seit `SymbolAngabe` ist ein
 * erfundener Name ein Uebersetzungsfehler. Gegenprobe gemacht - mit
 * `icon="GibtEsNichtXY"` meldet `tsc`
 * «Type '"GibtEsNichtXY"' is not assignable to type 'SymbolAngabe'»,
 * ohne ist er still.
 */

/** Die Symbolnamen, die «SwissHub fragt» tatsaechlich verwendet. */
const FRAGT_SYMBOLE = [
  'BarChart3',
  'CalendarClock',
  'Clock',
  'Image',
  'Library',
  'List',
  'MessageCircleQuestion',
  'Plus',
  'Radio',
  'TrendingUp',
  'Trophy',
  'Users',
  'Zap',
] as const;

describe('Symbole in Kopfzeilen', () => {
  it('zeichnet einen Namen im Panel als Grafik, nicht als Wort', () => {
    const html = renderToStaticMarkup(
      createElement(Panel, { title: 'Verteilung', icon: 'BarChart3', children: null }),
    );

    expect(html).toContain('<svg');
    /*
     * Der Kern des Ganzen. `toContain('BarChart3')` wuerde auch anschlagen,
     * wenn der Name in einem Attribut stuende - gesucht ist er als
     * **Textinhalt**, also zwischen zwei Tags.
     */
    expect(html).not.toMatch(/>\s*BarChart3\s*</u);
  });

  it('zeichnet einen Namen in der StatCard als Grafik, nicht als Wort', () => {
    const html = renderToStaticMarkup(
      createElement(StatCard, { label: 'Gültige Stimmen', value: '42', icon: 'Users' }),
    );

    expect(html).toContain('<svg');
    expect(html).not.toMatch(/>\s*Users\s*</u);
    // Der Wert steht weiterhin da - der Test darf nicht gruen werden, weil
    // gar nichts mehr gezeichnet wird.
    expect(html).toContain('42');
  });

  it('nimmt weiterhin ein fertiges Element an', () => {
    /*
     * Die urspruengliche Form bleibt gueltig. Ein Umbau, der sie verbietet,
     * haette dreihundert Aufrufstellen angefasst, um einen Fehler an
     * dreiundzwanzig zu beheben.
     */
    const html = renderToStaticMarkup(
      createElement(StatCard, {
        label: 'Mitglieder',
        value: 7,
        icon: createElement(NavIcon, { name: 'Users' }),
      }),
    );
    expect(html).toContain('<svg');
  });

  it('zeichnet jedes Symbol, das «SwissHub fragt» verwendet', () => {
    /*
     * Nicht «es kommt ein SVG heraus» - das kaeme auch vom Ersatzsymbol.
     * Verglichen wird gegen `Blocks`: faellt ein Name auf den Ersatz zurueck,
     * ist sein Pfad derselbe wie dessen, und der Test schlaegt an.
     */
    const ersatz = renderToStaticMarkup(createElement(NavIcon, { name: 'GibtEsNichtXY' }));

    for (const name of FRAGT_SYMBOLE) {
      const html = renderToStaticMarkup(createElement(NavIcon, { name }));
      expect(html, `${name} zeichnet das Ersatzsymbol`).not.toBe(ersatz);
      expect(html, `${name} zeichnet kein SVG`).toContain('<svg');
    }
  });

  it('laesst ein fehlendes Symbol einfach weg', () => {
    expect(symbolKnoten(null)).toBeNull();
    expect(symbolKnoten(undefined)).toBeNull();
  });

  it('haelt die Symbole zugaenglich aus dem Namensbaum heraus', () => {
    /*
     * Ein Symbol neben einer Beschriftung ist Dekoration. Stuende es im
     * Namensbaum, laese ein Screenreader «Grafik Verteilung» statt
     * «Verteilung».
     */
    const html = renderToStaticMarkup(createElement(NavIcon, { name: 'Trophy' }));
    expect(html).toContain('aria-hidden="true"');
  });
});
