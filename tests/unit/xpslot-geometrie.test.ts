import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Die Geometrie des Spielfelds - und was vom Eventmodus übrig ist.
 *
 * ## Warum am Quelltext
 *
 * Weil die Aussagen hier **struktureller** Art sind: dass die Gewinnlinie aus
 * gemessenen Punkten entsteht und nicht aus einem Bruchteil, dass die
 * Zellgrösse aus der Breite des Kastens kommt und nicht aus der des Fensters,
 * dass nirgends mehr eine Eventtabelle steht. Das sind Aussagen darüber, was
 * im Code **nicht** vorkommt, und dafür ist der Quelltext die Wahrheit.
 *
 * Wie es aussieht, prüft der Browser-Smoke; dass es richtig gerechnet ist,
 * prüft dieser Test.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
/** CSS kennt nur Blockkommentare - und genau in ihnen steht die Vorgeschichte. */
const ohneCssKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, '');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const WALZEN = 'apps/web/src/modules/level/xpslot/components/walzen.tsx';
const CSS = 'apps/web/src/modules/level/xpslot/xpslot.css';
const SPIEL = 'apps/web/src/modules/level/xpslot/components/spiel.tsx';
const RAD = 'apps/web/src/modules/level/xpslot/components/rad.tsx';
const SCHEMA = 'packages/database/prisma/schema.prisma';

describe('Gewinnlinien', () => {
  const quelle = ohneKommentare(lies(WALZEN));

  it('rechnet aus gemessenen Zellmitten und nicht aus Bruchteilen', () => {
    /*
     * Die alte Rechnung war `((walze + 0.5) / walzen) * 100`: sie stimmt nur
     * ohne Abstand zwischen den Walzen und ohne Innenabstand am Raster - und
     * beides gibt es. Auf dem iPad lag die Linie dadurch sichtbar daneben.
     */
    expect(quelle).not.toMatch(/\(\s*walze \+ 0\.5\s*\)\s*\/\s*walzen/u);
    expect(quelle).not.toMatch(/\(\s*reihe \+ 0\.5\s*\)\s*\/\s*reihen/u);
    expect(quelle).toContain('getBoundingClientRect');
    expect(quelle).toContain('function useGeometrie');
  });

  it('streckt die Zeichnung nicht', () => {
    // `preserveAspectRatio="none"` verzerrt x und y unterschiedlich stark -
    // genau dann, wenn das Raster nicht im Verhaeltnis der viewBox steht.
    expect(quelle).not.toContain('preserveAspectRatio');
    // Die viewBox ist der gemessene Kasten in echten Pixeln.
    expect(quelle).toMatch(/viewBox=\{`0 0 \$\{kasten\.breite/u);
  });

  it('nimmt als viewBox den gemessenen Rahmen und nicht die doppelte letzte Mitte', () => {
    /*
     * Hier stand `Math.max(...mitten.map((p) => p.x)) * 2`. Bei fuenf Walzen
     * ist der Rahmen aber `max(x) + min(x)` breit, nicht `max(x) * 2` - und
     * eine zu grosse viewBox wird vom Standardverhalten `xMidYMid meet`
     * verkleinert und neu zentriert. Die Linie lag damit zu kurz und
     * verschoben, also genau daneben - und das war der Fehler, der behoben werden sollte.
     */
    expect(quelle).not.toMatch(/Math\.max\([^)]*mitten[\s\S]{0,60}\*\s*2/u);
    expect(quelle).toContain('setKasten');
    expect(quelle).toContain('kasten: Kasten | null');
    // Und ohne Masse wird gar nichts gezeichnet, statt durch null zu teilen.
    expect(quelle).toContain('kasten.breite <= 0 || kasten.hoehe <= 0');
  });

  it('misst bei jeder Grössenänderung neu', () => {
    expect(quelle).toContain('new ResizeObserver');
    expect(quelle).toContain("addEventListener('orientationchange'");
    expect(quelle).toContain("addEventListener('resize'");
    // Und raeumt wieder ab: ein Beobachter je Neuaufbau waere ein Leck.
    expect(quelle).toContain('beobachter?.disconnect()');
  });

  it('hält ein Sticky Wild während des Laufs sichtbar', () => {
    // Die dritte Lage: sie liegt ueber dem laufenden Band und traegt das
    // Wild an seiner Position. Ohne sie verschwand es beim Anlaufen - und
    // das sah aus, als werde es neu gezogen.
    expect(quelle).toContain('slot-haftend');
    expect(quelle).toContain('laeuft && wildSymbol && haftend.length > 0');
  });
});

describe('Walzenbreite', () => {
  const css = lies(CSS);

  it('rechnet in der Breite des Kastens und nicht des Fensters', () => {
    /*
     * `7.4vw` waren auf einem iPad 57 Pixel - fuenf davon in einem Panel von
     * 700. Die Walzen standen als Streifen in einer roten Flaeche. `cqw`
     * misst den Kasten, und die Rechnung ist die Umkehrung des Rasters.
     */
    expect(css).toContain('--slot-breit: calc((100cqw - var(--slot-spalt) * 6) / 5)');
    // Ohne Kommentare geprueft: die alte Rechnung steht in der Erklaerung
    // darueber, und die soll sie auch nennen.
    expect(ohneCssKommentare(css)).not.toContain('7.4vw');
  });

  it('hat einen Container, dessen Breite abfragbar ist', () => {
    // Ein Element kann seine eigene Breite nicht abfragen - der Container
    // muss darueber liegen.
    expect(css).toContain('.slot-feld {\n  container-type: inline-size;');
    expect(ohneKommentare(lies(SPIEL))).toContain('className="slot-feld"');
  });

  it('bleibt bei flachen Fenstern in der Höhe', () => {
    // Auf einem 768er-Laptop und auf dem iPad im Querformat fuehrt die Hoehe.
    expect(css).toContain('--slot-hoch: calc((100vh - var(--slot-rest)) / 3)');
    expect(css).toContain('@media (min-width: 641px) and (max-height: 820px)');
  });

  it('skaliert die Maschine nicht', () => {
    const block = css.slice(css.indexOf('.slot-walzen {'), css.indexOf('.slot-walze {'));
    // `transform: scale` waere unscharfer Text und verschobene Klickflaechen.
    expect(block).not.toContain('scale(');
    expect(block).toContain('clamp(');
  });

  it('legt die Gewinnlinie über das ganze Raster', () => {
    const block = css.slice(css.indexOf('.slot-linie {'), css.indexOf('.slot-linie path'));
    // `inset: var(--slot-spalt)` versetzte das Bild um den Innenabstand -
    // zusaetzlich zur Streckung.
    expect(block).toContain('inset: 0;');
  });
});

describe('Spin-Gefühl', () => {
  const css = lies(CSS);

  it('rastet kurz ein, ohne zu skalieren', () => {
    const stopp = css.slice(css.indexOf('@keyframes slot-stopp'), css.indexOf('@keyframes slot-rasten'));
    expect(stopp).not.toContain('scale');
    // Ein knapper Nachschwinger statt eines weiten: 0,045 statt 0,07 Zellen.
    expect(stopp).toContain('var(--slot-zelle) * 0.045');
    expect(css).toContain('animation: slot-stopp 0.26s');
  });

  it('macht das laufende Band unscharf und den Rest nicht', () => {
    expect(css).toMatch(/\.slot-band \.slot-zelle__bild[\s\S]*?filter: blur/u);
    // Die Unschaerfe gehoert auf das Band: Rahmen und haftende Wilds bleiben
    // scharf, und genau daran sieht man, dass sie nicht mitdrehen.
    expect(css).not.toMatch(/\.slot-walze \{[^}]*filter: blur/u);
  });
});

describe('Risiko-Rad', () => {
  const quelle = ohneKommentare(lies(RAD));

  it('entscheidet nichts selbst', () => {
    /*
     * Der Wurf fallt auf dem Server. Zufall gibt es hier nur fuer Zierde:
     * welches der gleichwertigen Felder getroffen wird und wie weit das Rad
     * ueberdreht. Diese Unterscheidung ist der ganze Punkt.
     */
    expect(quelle).toContain("ergebnis: 'gewonnen' | 'verloren' | null");
    expect(quelle).toContain("feld.gewinn === (ergebnis === 'gewonnen')");
    // Kein Vergleich, der ueber Gewinn oder Verlust entscheidet.
    expect(quelle).not.toMatch(/Math\.random\(\)\s*[<>]/u);
  });

  it('zeigt die Chance als Felder', () => {
    expect(quelle).toContain('Math.round(chance * FELDER)');
  });

  it('wird vom Spiel erst nach der Antwort ausgefahren', () => {
    const spiel = ohneKommentare(lies(SPIEL));
    // Erst drehen, dann fragen, dann ausfahren - und der Zustand folgt dem
    // Rad, nicht umgekehrt.
    const radAn = spiel.indexOf('setRadAn(true)');
    const anfrage = spiel.indexOf('bonusRiskierenAction({ csrfToken, rundeId: runde.id })');
    const ergebnis = spiel.indexOf('setRadErgebnis(antwort.data.gewonnen');
    expect(radAn).toBeGreaterThan(-1);
    expect(anfrage).toBeGreaterThan(radAn);
    expect(ergebnis).toBeGreaterThan(anfrage);
    expect(spiel).toContain('radFolge.current = antwort.data.bonus');
  });
});

describe('Eventmodus entfernt', () => {
  it('hat keine Eventtabelle und keinen Eventstatus mehr', () => {
    const schema = lies(SCHEMA);
    expect(schema).not.toContain('model XpSlotEvent');
    expect(schema).not.toContain('EVENT_ONLY');
    // Und keine Spalte, die ins Leere zeigt.
    const spin = schema.slice(schema.indexOf('model XpSlotSpin {'));
    expect(spin.slice(0, spin.indexOf('\n}'))).not.toContain('eventId');
  });

  it('hat keine Eventlogik im Modul und keine Actions dafür', () => {
    for (const datei of [
      'packages/modules/src/level/xpslot/konfiguration.ts',
      'packages/modules/src/level/xpslot/verwaltung.ts',
      'packages/modules/src/level/xpslot/spin.ts',
      'packages/modules/src/level/xpslot/ansicht.ts',
      'apps/web/src/modules/level/xpslot-actions.ts',
    ]) {
      const quelle = ohneKommentare(lies(datei));
      expect(quelle, datei).not.toMatch(/xpSlotEvent|laufendesEvent|aktiviereEvent|eventUeberschreibung/u);
      // Auch nicht als annehmbarer Statuswert: eine Action, die `EVENT_ONLY`
      // noch durchlaesst, schreibt einen Status, den es nicht mehr gibt.
      expect(quelle, datei).not.toContain('EVENT_ONLY');
    }
  });

  it('hat keinen Eventbereich mehr in der Verwaltung', () => {
    const quelle = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    expect(quelle).not.toContain("key: 'events'");
    expect(quelle).not.toContain('EventsTab');
  });

  it('schaltet Premium über den Schalter unter Bonus', () => {
    const quelle = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    const bonus = quelle.slice(quelle.indexOf('{nurBonus ? ('), quelle.indexOf('<Kasten titel="Einsätze"'));
    expect(bonus).toContain('feld="premiumAktiv"');
    expect(bonus).toContain('PremiumSymbolKasten');
    // Der alte Hinweis «wirkt nur im Eventmodus» ist weg - er beschrieb einen
    // Schalter, der ohne Event nichts tat.
    expect(quelle).not.toContain('Wirkt nur, solange ein Eventmodus läuft');
  });
});

describe('Wartungsmodus', () => {
  it('prüft die Berechtigung serverseitig und ohne feste Kennungen', () => {
    const spin = ohneKommentare(lies('packages/modules/src/level/xpslot/spin.ts'));
    expect(spin).toContain('istSpielbar(konfiguration, eingabe.darfVerwalten ?? false)');

    const action = ohneKommentare(lies('apps/web/src/modules/level/xpslot-actions.ts'));
    // Die Berechtigung kommt aus der Engine, nicht aus einer Liste.
    expect(action).toContain('darfVerwalten: can(ctx, P.xpslotManage)');
    expect(action).not.toMatch(/\d{17,20}/u);

    const konfig = ohneKommentare(lies('packages/modules/src/level/xpslot/konfiguration.ts'));
    expect(konfig).not.toMatch(/\d{17,20}/u);
  });
});
