import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Die Anzeige: Top-Bar, Rad-Ergebnis, Funken.
 *
 * ## Warum am Quelltext
 *
 * Weil die Aussagen struktureller Art sind - «dieses Feld erscheint nur in
 * diesem Modus», «diese Zahl kommt aus dieser Quelle», «die Funken gehen vom
 * Zentrum des Kastens aus und nicht von seinem unteren Rand». Ob es gut
 * aussieht, zeigt der Browser-Smoke; ob es aus der richtigen Quelle kommt,
 * steht im Code, und dort kann es auch wieder herausfallen.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
const ohneCssKommentare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, '');

const SPIEL = 'apps/web/src/modules/level/xpslot/components/spiel.tsx';
const WALZEN = 'apps/web/src/modules/level/xpslot/components/walzen.tsx';
const MELDUNG = 'apps/web/src/modules/level/xpslot/components/meldung.tsx';
const CSS = 'apps/web/src/modules/level/xpslot/xpslot.css';

describe('Top-Bar: Letzter Gewinn', () => {
  const quelle = ohneKommentare(lies(SPIEL));

  it('heisst «Letzter Gewinn» und nicht «Gewinn»', () => {
    expect(quelle).toContain('label="Letzter Gewinn"');
    expect(quelle).not.toMatch(/label="Gewinn"/u);
  });

  it('zeigt den letzten einzelnen Spin und nicht die Bonussumme', () => {
    expect(quelle).toContain('<HudFeld label="Letzter Gewinn" wert={letzterGewinn} vorzeichen />');
    /*
     * Der Fehler, den das abdeckt: hier stand
     * `imFreispiel ? bonus.gewinn : ergebnis.gewinn`. Damit zeigte das Feld
     * waehrend Freispielen die Summe der ganzen Runde - also einen Betrag
     * auch bei einem Freispiel ohne Treffer.
     */
    expect(quelle).not.toMatch(/imFreispiel \? \(spieler\.bonus\?\.gewinn/u);
    // Fortgeschrieben wird am Ende des Spins, mit dessen eigenem Gewinn.
    expect(quelle).toContain('setLetzterGewinn(spin.gewinn)');
  });

  it('zeigt den Freispiel-Abschluss aus der Spinantwort, nicht erst beim Laden', () => {
    expect(quelle).toContain("melde({ art: 'freespinsFinished' })");
    expect(quelle).toContain('setMeldungen((vorher) => ({ ...vorher, freispielEnde: spin.freispielEnde }))');
  });

  it('holt den Anfangswert aus dem Verlauf, damit ein Neuladen ihn behält', () => {
    expect(quelle).toContain('useState<number>(() => start.verlauf[0]?.gewinn ?? 0)');
    // Und nach einem neu geholten Stand gilt dieselbe Quelle.
    expect(quelle).toContain('setLetzterGewinn(antwort.data.verlauf[0]?.gewinn ?? 0)');
  });
});

describe('Top-Bar: Freispiele nur wenn relevant', () => {
  const quelle = ohneKommentare(lies(SPIEL));
  const css = ohneCssKommentare(lies(CSS));

  it('zeigt das Feld nur, wenn Freispiele laufen', () => {
    expect(quelle).toContain('const zeigeFreispiele = imFreispiel;');
    expect(quelle).toMatch(/\{zeigeFreispiele \? \(\s*<HudFeld\s*label="Freispiele"/u);
    /*
     * Auf der Risikoleiter nicht: dort stehen null offene Freispiele, und
     * «Freispiele 0» waere falsch, waehrend jemand zwischen acht und zwoelf
     * waehlt. Die Zahlen stehen auf der Leiter.
     */
    expect(quelle).not.toContain('zeigeFreispiele = imFreispiel || spieler.bonus');
  });

  it('lässt das Raster seine Spalten zählen, damit keine Lücke bleibt', () => {
    const hud = css.slice(css.indexOf('.slot-hud {'));
    const block = hud.slice(0, hud.indexOf('}'));
    expect(block).toContain('grid-auto-flow: column');
    expect(block).toContain('grid-auto-columns: minmax(0, 1fr)');
    // Vier feste Spalten waeren ohne «Freispiele» eine leere Spalte.
    expect(block).not.toMatch(/repeat\(4,/u);
  });
});

describe('Das Rad-Ergebnis', () => {
  const quelle = ohneKommentare(lies(SPIEL));

  it('nimmt die Freispielzahl aus der Serverantwort', () => {
    expect(quelle).toContain('radFreispiele.current = antwort.data.freispiele');
    expect(quelle).toContain('setRadAusgang({ gewonnen, freispiele: radFreispiele.current })');
    /*
     * Die alte Form - und der Grund fuer «0 Freispiele» nach einem Gewinn
     * auf der ersten Leiterstufe.
     */
    expect(quelle).not.toMatch(/freispiele: neu\?\.stufe === 'SPINS' \? neu\.offen : 0/u);
  });

  it('sagt im Klartext, was gilt', () => {
    expect(quelle).toContain("radAusgang.gewonnen ? 'Gamble gewonnen' : 'Gamble verloren'");
    expect(quelle).toContain('Freispiele`');
    expect(quelle).toContain("'Dein Bonus ist beendet.'");
  });
});

describe('Die Funken einer grossen Meldung', () => {
  const walzen = ohneKommentare(lies(WALZEN));
  const meldung = ohneKommentare(lies(MELDUNG));
  const css = ohneCssKommentare(lies(CSS));

  it('kennt zwei Ursprünge - Bühne unten, Meldung Mitte', () => {
    expect(walzen).toMatch(/ursprung\?: 'unten' \| 'mitte'/u);
    expect(walzen).toContain("ursprung = 'unten'");
    expect(meldung).toContain('<Partikel anzahl={14} ursprung="mitte" />');
  });

  it('setzt den Ursprung auf das Zentrum des Kastens und nicht auf Pixel', () => {
    const block = css.slice(css.indexOf('.slot-partikel--mitte {'));
    const mitte = block.slice(0, block.indexOf('}'));
    expect(mitte).toContain('left: 50%');
    expect(mitte).toContain('top: 50%');
    // Ohne eigene Groesse ist der Ursprung ein Punkt - und damit immer die
    // echte Mitte, auch wenn die Karte wegen eines langen Textes hoeher wird.
    expect(mitte).toContain('width: 0');
    expect(mitte).toContain('height: 0');
    expect(mitte).toContain('overflow: visible');
    // Die Weite ist begrenzt: keine bildschirmgrosse Ebene.
    expect(mitte).toMatch(/--slot-funken-weite: clamp\(/u);
  });

  it('lässt die Karte die Funken nicht abschneiden', () => {
    const karte = css.slice(css.indexOf('.slot-meldung__karte {'));
    expect(karte.slice(0, karte.indexOf('}'))).not.toContain('overflow: hidden');
  });

  it('verteilt die Richtungen und fliegt radial nach aussen', () => {
    // Der goldene Winkel - sonst entsteht eine sichtbare Speichenform.
    expect(walzen).toContain('137.5');
    expect(walzen).toContain("['--dx' as string]");
    expect(walzen).toContain("['--dy' as string]");
    expect(css).toMatch(/@keyframes slot-funken \{[\s\S]*?var\(--dx/u);
  });

  it('schaltet die Funken bei weniger Bewegung ganz ab', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block.slice(0, block.indexOf('.slot-buehne--gross'))).toContain('.slot-partikel');
  });
});
