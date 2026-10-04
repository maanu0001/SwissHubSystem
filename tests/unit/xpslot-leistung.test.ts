import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Die drei gemessenen Leistungsursachen - und dass sie behoben bleiben.
 *
 * ## Warum am Quelltext und nicht als Benchmark
 *
 * Weil eine Zahl auf dieser Maschine nichts darüber sagt, wie es auf einem
 * iPad läuft, und weil eine Schranke wie «unter 16 ms» in einem Container mit
 * Software-Rendering entweder immer oder nie hält. Was sich dagegen eindeutig
 * prüfen lässt, ist die **Ursache**: ob der Code noch das tut, was gemessen
 * zu viel war.
 *
 * ## Was gemessen wurde
 *
 * Im Browser, gegen den gebauten Server, mit drei Spins:
 *
 *   - **207 erzwungene Layoutberechnungen je Spin** (`getBoundingClientRect`,
 *     davon 150 auf `.slot-walze` und 50 auf `.slot-walzen`). Ursache: die
 *     Ref-Rückrufe der Walzen wurden **inline** erzeugt, also bei jedem
 *     Rendern neu. React hängt einen Ref dann ab und neu an - und in diesem
 *     Rückruf stand die Messung.
 *   - **23 Klangdateien, geholt während des ersten Spins.** Ursache: gebaut
 *     wurde erst nach der Freigabe, und die fällt im ersten Spin. Dekodieren
 *     läuft im Hauptfaden.
 *   - **dreissig Compositor-Ebenen mit je einem Weichzeichner** auf dem
 *     laufenden Band: `will-change: transform` stand auf jedem
 *     `.slot-zelle__bild`, der Blur ebenfalls je Bild.
 *
 * Jede dieser drei Ursachen hat hier ihren Test.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
const ohneCssKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, '');

const WALZEN = 'apps/web/src/modules/level/xpslot/components/walzen.tsx';
const KLANG = 'apps/web/src/modules/level/xpslot/components/klang.ts';
const CSS = 'apps/web/src/modules/level/xpslot/xpslot.css';

describe('Layoutmessungen der Walzen', () => {
  const quelle = ohneKommentare(lies(WALZEN));

  it('erzeugt die Ref-Rückrufe einmal und nicht bei jedem Rendern', () => {
    /*
     * Der Kern: eine gemerkte Liste von Rückrufen, einer je Walze.
     * `walzenRef(2)` muss bei jedem Rendern dieselbe Funktion liefern,
     * sonst hängt React den Ref ab und neu an.
     */
    expect(quelle).toMatch(/const rueckrufe = useMemo\(/u);
    expect(quelle).toContain('walzenEls.current[walze] = element');
    expect(quelle).toMatch(/const walzenRef = useCallback\(\s*\(walze: number\) => rueckrufe\[walze\]/u);
    // Die alte Form: eine Funktion, die bei jedem Aufruf eine neue zurückgibt.
    expect(quelle).not.toMatch(/\(walze: number\) => \(element: HTMLDivElement \| null\) => \{/u);
  });

  it('messt gebündelt im nächsten Bild statt sofort im Rückruf', () => {
    expect(quelle).toContain('const planen = useCallback');
    expect(quelle).toContain('window.requestAnimationFrame');
    // Mehrere Anlässe im selben Bild ergeben eine Messung.
    expect(quelle).toMatch(/if \(bild\.current !== 0\) \{\s*return;/u);
    expect(quelle).toContain('window.cancelAnimationFrame(bild.current)');
    // Die Rückrufe melden eine Messung an - sie messen nicht selbst.
    expect(quelle).not.toMatch(/element\) \{\s*messen\(\);/u);
  });

  it('beobachtet den Rahmen und nicht jede Walze einzeln', () => {
    /*
     * Die Zellgroesse haengt an der Breite des Rahmens (`cqw`) - eine Walze
     * kann sich nicht ohne ihn aendern. Fuenf Beobachter waeren fuenf
     * Rueckrufe je Aenderung, fuer dieselbe Aussage.
     */
    expect(quelle).toContain('beobachter.observe(rahmenRef.current)');
    expect(quelle).not.toMatch(/for \(const element of walzenEls\.current\)/u);
  });
});

describe('Klänge liegen vor dem ersten Spin bereit', () => {
  const quelle = ohneKommentare(lies(KLANG));

  it('baut die Stimmen ohne Freigabe - geladen werden darf immer', () => {
    const baue = quelle.slice(quelle.indexOf('const baue = useCallback'), quelle.indexOf('const hole ='));
    expect(baue).toContain("typeof window === 'undefined'");
    // Genau das war der Fehler: ohne Freigabe entstand keine Stimme, also
    // lud auch nichts vor.
    expect(baue).not.toContain('freigegebenRef.current');
    expect(baue).toContain("element.preload = 'auto'");
  });

  it('prüft die Freigabe beim Abspielen - dort gehört sie hin', () => {
    const spiele = quelle.slice(
      quelle.indexOf('const spiele = useCallback'),
      quelle.indexOf('const starteSchleife ='),
    );
    expect(spiele).toMatch(/if \(!freigegebenRef\.current\) \{\s*return;/u);
    const schleife = quelle.slice(
      quelle.indexOf('const starteSchleife = useCallback'),
      quelle.indexOf('const stoppeSchleife ='),
    );
    expect(schleife).toMatch(/if \(!freigegebenRef\.current\) \{\s*return;/u);
  });

  it('lädt direkt nach dem Rendern vor - alle Slots, Musik zuletzt', () => {
    /*
     * Der Effekt darf nicht an `freigegeben` haengen - sonst laeuft er erst
     * im ersten Spin, und genau dann sind die dreiundzwanzig Dateien im
     * Netz, waehrend die Walzen laufen.
     *
     * Und er darf nicht auf einen Zeitgeber warten: ein
     * `requestIdleCallback` stand hier, und der Browser-Smoke klickte
     * schneller, als er feuerte - die Musik lag damit immer noch im Netz,
     * waehrend die Walzen liefen.
     */
    const vorladen = quelle.slice(quelle.indexOf('const reihe = [...nachSlot.keys()]'));
    const effekt = vorladen.slice(0, vorladen.indexOf('}, ['));
    expect(effekt).toContain('MUSIK_SLOTS.has(links)');
    expect(effekt).toContain('hole(slot)');
    const abhaengigkeiten = vorladen.slice(vorladen.indexOf('}, ['), vorladen.indexOf('}, [') + 40);
    expect(abhaengigkeiten).not.toContain('freigegeben,');
    expect(quelle).not.toContain('requestIdleCallback');
  });
});

describe('Ebenen und Filter auf der Bühne', () => {
  const css = ohneCssKommentare(lies(CSS));

  it('setzt will-change nur auf Zellen, die sich wirklich bewegen', () => {
    expect(css).toMatch(
      /\.slot-zelle--treffer \.slot-zelle__bild,\s*\.slot-zelle--klebt \.slot-zelle__bild \{\s*will-change: transform;/u,
    );
    // Die alte Form: der Block des Bildes selbst trug es - also jede der
    // dreissig Fuellzellen im Lauf.
    const bildblock = css.slice(css.indexOf('.slot-zelle__bild {'));
    expect(bildblock.slice(0, bildblock.indexOf('}'))).not.toContain('will-change');
  });

  it('weichzeichnet das Band als Ganzes und nicht jedes Bild darin', () => {
    expect(css).not.toMatch(/\.slot-band \.slot-zelle__bild/u);
    // Einer der `.slot-band`-Blöcke trägt den Weichzeichner - und zwar der
    // Block des Bands selbst, nicht einer seiner Nachfahren.
    expect(css).toMatch(/\.slot-band \{[^}]*filter: blur\(0\.7px\)/u);
  });

  it('nimmt auf schwachen Geräten Nebeneffekte weg, aber nichts vom Spiel', () => {
    const block = css.slice(css.indexOf('@media (max-width: 820px), (hover: none) and (pointer: coarse)'));
    const bis = block.slice(0, block.length);
    expect(bis).toContain('.slot-buehne__puls');
    expect(bis).toContain('backdrop-filter: none');
    expect(bis).toContain('.slot-partikel span:nth-child(2n)');
    /*
     * Was nicht angefasst werden darf: der Walzenlauf, die Gewinnlinie, der
     * Stopp. Eine billige Mobilfassung war ausdruecklich nicht gewollt.
     */
    expect(bis).not.toMatch(/\.slot-band\s*\{[^}]*animation:\s*none/u);
    expect(bis).not.toMatch(/\.slot-linie[^}]*display:\s*none/u);
    expect(bis).not.toMatch(/\.slot-walze--stopp[^}]*animation:\s*none/u);
  });
});
