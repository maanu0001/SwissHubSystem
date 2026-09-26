import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bronze, Silber und Gold als drei Materialien.
 *
 * ## Warum an der Quelle geprueft wird
 *
 * Die Unterscheidung steckt in Rahmengeometrie, Materialstruktur und
 * Lichtfuehrung - also in CSS, das ein jsdom-Test nicht berechnet.
 * `clip-path` und `box-shadow` liest `getComputedStyle` dort nicht sinnvoll
 * zurueck, und ein Schnappschusstest waere ein Test des Schnappschusses.
 *
 * Geprueft wird deshalb die Zusage: dass sich die drei Stufen in mehr als
 * einer Farbe unterscheiden. Genau daran hat es vorher gefehlt.
 */
const CSS = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/auszeichnungs-stufen.css'),
  'utf8',
);
const KOMPONENTE = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/components/profil-auszeichnungen.tsx'),
  'utf8',
);

const STUFEN = ['bronze', 'silber', 'gold'] as const;

/** Der Regelblock einer Stufe - bis zur naechsten oeffnenden Klammer. */
function block(klasse: string): string {
  const ab = CSS.indexOf(`.${klasse} {`);
  expect(ab, `${klasse} fehlt`).toBeGreaterThan(-1);
  return CSS.slice(ab, CSS.indexOf('}', ab));
}

describe('Die drei Stufen sind drei Materialien', () => {
  it('gibt jeder Stufe eine eigene Klasse', () => {
    for (const stufe of STUFEN) {
      expect(CSS).toContain(`.az-${stufe} {`);
      expect(KOMPONENTE).toContain(`az-${stufe}`);
    }
  });

  it('gibt jeder Stufe eine eigene Rahmengeometrie', () => {
    /*
     * Der Kern der Anforderung. Drei Karten mit derselben Form und drei
     * Farben sind eine Farbskala; drei Formen sind drei Auszeichnungen.
     *
     * Bronze: weiche Ecken. Silber: angeschnittene. Gold: facettierte.
     */
    expect(block('az-bronze')).toContain('border-radius: 0.75rem');
    expect(block('az-silber')).toContain('clip-path: polygon(');
    expect(block('az-gold')).toContain('clip-path: polygon(');

    // Und die beiden Schnitte sind nicht derselbe.
    const silber = block('az-silber');
    const gold = block('az-gold');
    const schnitt = (b: string): string =>
      b.slice(b.indexOf('clip-path'), b.indexOf(');', b.indexOf('clip-path')));
    expect(schnitt(silber)).not.toBe(schnitt(gold));
  });

  it('gibt jeder Stufe eine eigene Materialstruktur', () => {
    // Bronze koernig, Silber gebuerstet, Gold poliert - drei verschiedene
    // Muster, nicht dasselbe in drei Farben.
    const vor = (stufe: string): string => {
      const ab = CSS.indexOf(`.az-${stufe}::before {`);
      expect(ab, `${stufe}::before fehlt`).toBeGreaterThan(-1);
      return CSS.slice(ab, CSS.indexOf('}', ab));
    };
    expect(vor('bronze')).toContain('radial-gradient');
    expect(vor('silber')).toContain('repeating-linear-gradient');
    expect(vor('gold')).toContain('linear-gradient');
    expect(vor('gold')).not.toContain('repeating-linear-gradient');
  });

  it('gibt jeder Stufe eine eigene Symbolumgebung', () => {
    const feld = (stufe: string): string => {
      const ab = CSS.indexOf(`.az-${stufe} .az-feld {`);
      expect(ab, `${stufe} .az-feld fehlt`).toBeGreaterThan(-1);
      return CSS.slice(ab, CSS.indexOf('}', ab));
    };
    // Rechteck, Sechseck, Kreis.
    expect(feld('bronze')).toContain('border-radius');
    expect(feld('silber')).toContain('clip-path: polygon(');
    expect(feld('gold')).toContain('border-radius: 999px');
  });

  it('bewegt nur Gold von selbst', () => {
    /*
     * Drei animierte Stufen nebeneinander waeren Kirmes. Silber und Bronze
     * zeigen ihren Glanz beim Ueberfahren - Bewegung auf Zuruf.
     */
    const ab = CSS.indexOf('.az-gold::after {');
    const goldNach = CSS.slice(ab, CSS.indexOf('}', ab));
    expect(goldNach).toContain('animation: az-glanz');

    for (const stufe of ['bronze', 'silber']) {
      const stelle = CSS.indexOf(`.az-${stufe}::after {`);
      const nach = CSS.slice(stelle, CSS.indexOf('}', stelle));
      expect(nach, `${stufe} bewegt sich von selbst`).not.toContain('animation:');
    }
    expect(CSS).toContain('@media (hover: hover)');
  });

  it('animiert ausschliesslich transform und opacity', () => {
    // Alles andere waere ein Layout- oder Paint-Durchlauf je Bild.
    const rahmen = CSS.slice(CSS.indexOf('@keyframes az-glanz'));
    const bis = rahmen.indexOf('\n}');
    const inhalt = rahmen.slice(0, bis);
    const eigenschaften = [...inhalt.matchAll(/^\s{4}([a-z-]+):/gmu)].map((m) => m[1]);
    for (const name of eigenschaften) {
      expect(['transform', 'opacity'], `${name} ist animiert`).toContain(name);
    }
  });

  it('laesst Gold bei reduzierter Bewegung erkennbar', () => {
    /*
     * Gold ganz ohne Glanz saehe aus wie ein dunkles Silber - die Stufe waere
     * nicht mehr ablesbar. Der Glanz steht darum still, statt zu verschwinden.
     */
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation:\s*none\s*!important/u);
    expect(block).toContain('.az-gold::after');
    expect(block).toMatch(/opacity:\s*0\.7/u);
  });

  it('legt keinen Farbverlauf ueber identische Karten', () => {
    /*
     * Die Gegenprobe zur alten Fassung. Dort unterschieden sich die drei
     * Stufen in genau drei Eigenschaften - border, bg und text -, und alle
     * drei waren Farben. Jetzt muss jede Stufe mindestens vier Merkmale
     * setzen, und mindestens eines davon darf keine Farbe sein.
     */
    for (const stufe of STUFEN) {
      const b = block(`az-${stufe}`);
      const nichtFarbe = ['border-radius', 'clip-path', 'box-shadow'].filter((name) => b.includes(name));
      expect(nichtFarbe.length, `az-${stufe} unterscheidet sich nur in Farben`).toBeGreaterThanOrEqual(2);
    }
  });
});
