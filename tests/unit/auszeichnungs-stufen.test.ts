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
/**
 * Die zentrale Stufenbeschreibung.
 *
 * Sie ist seit der Zusammenlegung die Quelle: die Auszeichnungsliste, die
 * oeffentliche Profilseite und die Gamer Card fragen hier nach, statt je
 * eigene Klassennamen zu tragen. Der Test prueft deshalb sie - und weiter
 * unten, dass die drei Orte sie tatsaechlich benutzen.
 */
const BESCHREIBUNG = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/auszeichnungs-stufe.tsx'),
  'utf8',
);
const LISTE = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/components/profil-auszeichnungen.tsx'),
  'utf8',
);
const OEFFENTLICH = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/profile/components/oeffentlich/oe-abschnitte.tsx'),
  'utf8',
);
const GAMER_CARD = readFileSync(join(process.cwd(), 'apps/web/src/modules/profile/gamer-card.tsx'), 'utf8');

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
      // Die Klassen stehen an einer Stelle, nicht in jeder Komponente.
      expect(BESCHREIBUNG).toContain(`az-${stufe}`);
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

/**
 * Die Stufe steht ueberall, wo die Auszeichnung steht.
 *
 * ## Warum dieser Block entstanden ist
 *
 * Die Stufen waren gebaut - aber nur an einem von drei Orten benutzt. Die
 * Auszeichnungsliste im Dashboard trug sie als Material; die drei
 * hervorgehobenen auf der oeffentlichen Profilseite trugen sie als graues
 * Kleinwort unter dem Namen, und die Gamer Card als «GOLD» am rechten Rand.
 * Ausgerechnet auf der Seite, die man verlinkt, und auf dem Bild, das man
 * teilt, sahen alle drei Stufen gleich aus.
 *
 * Diese Tests halten fest, dass das nicht zurueckfaellt.
 */
describe('Die Stufe steht an jedem Ort, an dem die Auszeichnung steht', () => {
  it('nimmt die oeffentliche Profilseite die Stufenkarte', () => {
    // Nicht bloss der Import - der Aufruf an der hervorgehobenen Karte.
    expect(OEFFENTLICH).toContain("from '../../auszeichnungs-stufe'");
    expect(OEFFENTLICH).toMatch(/stufe\(eintrag\.stufe\)\.karte/u);
    expect(OEFFENTLICH).toContain('az-feld');
  });

  it('zeichnet die Gamer Card je Stufe anders', () => {
    /*
     * Satori kennt keine Klassen - hier muessen es Werte sein. Geprueft
     * wird, dass sie aus derselben Beschreibung kommen und nicht aus einer
     * zweiten Farbtabelle in der Karte.
     */
    expect(GAMER_CARD).toContain("from './auszeichnungs-stufe'");
    expect(GAMER_CARD).toMatch(/stufe\(eintrag\.stufe\)/u);
    for (const feld of ['bild.rand', 'bild.flaeche', 'bild.feld', 'bild.radius']) {
      expect(GAMER_CARD, `${feld} fehlt auf der Karte`).toContain(`stufenbild.${feld}`);
    }
    // Und ausdruecklich kein `clip-path`: Satori scheitert daran, und ein
    // gescheitertes Rendern liefert eine leere Datei statt eines Fehlers.
    expect(GAMER_CARD).not.toContain('clipPath');
  });

  it('gibt jeder Stufe eine eigene Eckenrundung auf der Karte', () => {
    // Die Abstufung, die auch in Graustufen traegt: Gold am kantigsten.
    const radius = (stufe: string): number => {
      const ab = BESCHREIBUNG.indexOf(`  ${stufe}: {`);
      expect(ab, `${stufe} fehlt in der Beschreibung`).toBeGreaterThan(-1);
      const block = BESCHREIBUNG.slice(ab, BESCHREIBUNG.indexOf('\n  },', ab));
      const treffer = /radius:\s*(\d+)/u.exec(block);
      expect(treffer, `${stufe} ohne radius`).not.toBeNull();
      return Number(treffer![1]);
    };
    expect(radius('gold')).toBeLessThan(radius('silber'));
    expect(radius('silber')).toBeLessThan(radius('bronze'));
  });
});

/**
 * Die Stufe darf nicht nur Farbe sein.
 *
 * Etwa jeder zwoelfte Mann unterscheidet Rot und Gruen schlecht; Braun,
 * Grau und Gelb nebeneinander sind fuer einen Teil davon drei Grautoene. Eine
 * Auszeichnung, deren Stufe ausschliesslich in der Farbe steckt, ist fuer
 * diese Leute keine Auszeichnung.
 */
describe('Accessibility: die Stufe steht nicht nur in der Farbe', () => {
  it('gibt jeder Stufe eine unterschiedliche Anzahl Striche', () => {
    const striche = (stufe: string): number => {
      const ab = BESCHREIBUNG.indexOf(`  ${stufe}: {`);
      const block = BESCHREIBUNG.slice(ab, BESCHREIBUNG.indexOf('\n  },', ab));
      const treffer = /striche:\s*(\d)/u.exec(block);
      expect(treffer, `${stufe} ohne Marke`).not.toBeNull();
      return Number(treffer![1]);
    };
    // Eine Anzahl ist keine Farbe - sie traegt auch in Graustufen.
    expect(new Set(STUFEN.map(striche)).size).toBe(3);
    expect(striche('bronze')).toBe(1);
    expect(striche('silber')).toBe(2);
    expect(striche('gold')).toBe(3);
  });

  it('benennt die Marke fuer Vorleseprogramme', () => {
    // Das Wort fuer die, die die Karte hoeren statt sehen. Die Striche
    // selbst sind ausgeblendet - sonst hoerte man dreimal «Bild».
    expect(BESCHREIBUNG).toContain('aria-label={beschreibung.label}');
    expect(BESCHREIBUNG).toContain('aria-hidden="true"');
  });

  it('nennt die Stufe zusaetzlich beim Namen', () => {
    for (const ort of [LISTE, OEFFENTLICH, GAMER_CARD]) {
      // Entweder die Marke (mit ihrem aria-label) oder das Wort selbst.
      expect(/StufenMarke|stufenbild\.label|\.label/u.test(ort)).toBe(true);
    }
  });

  it('haelt die Toenungen durchscheinend, damit sie auf jeder Flaeche tragen', () => {
    /*
     * Hier standen feste dunkle Farbwerte. Auf einer hellen Flaeche - einem
     * kuenftigen hellen Modus, einem hellen Profildesign - waeren das drei
     * dunkle Kaesten gewesen. `color-mix(..., transparent)` laesst durch,
     * was dahinterliegt.
     */
    for (const stufe of STUFEN) {
      const b = block(`az-${stufe}`);
      expect(b, `az-${stufe} hat eine feste Flaeche`).toContain('color-mix(in srgb');
      expect(b).toContain('transparent)');
    }
    // Und die Schrift bekommt fuer helle Flaechen eigene Werte.
    expect(CSS).toContain('.az-hell');
  });

  it('greift nicht auf die Systemeinstellung fuer helle Flaechen zurueck', () => {
    /*
     * `prefers-color-scheme: light` ist die Einstellung des Betriebssystems
     * und sagt nichts darueber, wie hell diese Seite ist. Griffe sie hier,
     * bekaeme jeder hell eingestellte Rechner falsche Schrift auf einer
     * dunklen Seite.
     */
    // Geprueft wird die Regel, nicht das Wort: im Kommentar daneben steht
    // ausdruecklich, warum es sie nicht gibt.
    const ohneKommentare = CSS.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
    expect(ohneKommentare).not.toMatch(/@media\s*\(\s*prefers-color-scheme:\s*light/u);
  });
});
