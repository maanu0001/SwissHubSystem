import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Panel } from '../../apps/web/src/components/shared/panel';
import { StatCard } from '../../apps/web/src/components/shared/stat-card';
import { QuickAction, QuickActionButton } from '../../apps/web/src/components/shared/quick-action';
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

  it('zeichnet einen Namen in der Schnellaktion als Grafik, nicht als Wort', () => {
    /*
     * Der Block «Schnell erledigt» in «SwissHub fragt».
     *
     * `Panel` und `StatCard` wurden zuerst umgestellt, `QuickAction` blieb
     * dabei stehen - und weil `ReactNode` eine Zeichenkette annimmt, meldete
     * weder der Typecheck noch ein Test etwas. Im Browser standen dort vier
     * Woerter: «Plus», «CalendarClock», «Radio», «BarChart3».
     */
    const html = renderToStaticMarkup(
      createElement(QuickAction, {
        title: 'Neue Frage',
        description: 'In die Bibliothek schreiben',
        icon: 'Plus',
        href: '/fragt/bibliothek',
      }),
    );

    expect(html).toContain('<svg');
    expect(html).not.toMatch(/>\s*Plus\s*</u);
    // Der Text der Karte steht weiterhin da.
    expect(html).toContain('Neue Frage');
  });

  it('zeichnet einen Namen im Schnellaktions-Knopf als Grafik', () => {
    const html = renderToStaticMarkup(
      createElement(QuickActionButton, {
        title: 'Frage planen',
        description: 'Termin zuweisen',
        icon: 'CalendarClock',
      }),
    );
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/>\s*CalendarClock\s*</u);
  });

  it('laesst keine geteilte Komponente ein Symbol als ReactNode annehmen', () => {
    /*
     * Der Wächter gegen die vierte.
     *
     * `React.ReactNode` schliesst `string` ein - eine Komponente mit diesem
     * Typ nimmt einen Symbolnamen entgegen und zeichnet ihn als Text, ohne
     * dass der Typecheck etwas merkt. Genau so ist `QuickAction` zwischen
     * `Panel` und `StatCard` hindurchgerutscht.
     *
     * Geprueft wird deshalb die **Form der Deklaration** und nicht das
     * Verhalten: ein `icon`-Prop in `components/shared` muss `SymbolAngabe`
     * heissen. Wer eine neue geteilte Komponente mit Symbol baut, bekommt
     * hier einen roten Test statt im Browser ein Wort im Kreis.
     */
    const verzeichnis = join(process.cwd(), 'apps/web/src/components/shared');
    const treffer: string[] = [];
    let mitSymbol = 0;

    for (const name of readdirSync(verzeichnis)) {
      if (!name.endsWith('.tsx')) {
        continue;
      }
      const quelle = readFileSync(join(verzeichnis, name), 'utf8');
      if (/^\s*icon\??:/mu.test(quelle)) {
        mitSymbol += 1;
      }
      if (/^\s*icon\??:\s*React\.ReactNode/mu.test(quelle)) {
        treffer.push(name);
      }
    }

    // Ohne diese Zeile waere der Test auch gruen, wenn er gar nichts findet.
    expect(mitSymbol).toBeGreaterThanOrEqual(3);
    expect(
      treffer,
      `Diese geteilten Komponenten nehmen ein Symbol als ReactNode:\n${treffer.join('\n')}`,
    ).toEqual([]);
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
