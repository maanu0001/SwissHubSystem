import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WalzenBild, type SymbolBild } from '@/modules/level/xpslot/components/walzenbild';

/**
 * Der Aufbau der fuenf Walzen - gerendert und nachgezaehlt.
 *
 * ## Warum das ein Verhaltenstest ist und kein Quelltextvergleich
 *
 * Weil die Aussage dieser Runde eine ueber **Baumform** ist, und ein `grep`
 * auf «slot-band» beweist sie nicht.
 *
 * Hier stand im Walzenfenster `laeuft ? <Band/> : <Stand/>`. Das sieht
 * sparsam aus und ist das Gegenteil: bei jedem Walzenstart und jedem
 * Walzenstopp baut React den Teilbaum neu auf - sechs Fuellbilder raus, drei
 * Ergebnisbilder rein, fuenfmal je Spin, dazu beim Anlaufen dasselbe
 * rueckwaerts. Im Browserprofil waren das rund **zweihundert Bildpaints je
 * Spin**, auf allen vier gemessenen Ansichten: nicht die Bewegung, sondern
 * das Entstehen und Vergehen der Elemente.
 *
 * Also wird hier gerendert - einmal mit laufenden Walzen, einmal mit
 * stehenden - und nachgesehen, dass die Lagen in beiden Faellen dieselben
 * sind. Dass eine Zelle, die sich nicht aendert, nicht neu gemalt wird, ist
 * dann eine Eigenschaft von React und nicht mehr unsere Sorge.
 *
 * Und es wird nachgezaehlt, wie viele Ebenen ueberhaupt bewegt werden
 * koennen: **fuenf** Baender, eines je Walze. Nicht zwanzig bis vierzig
 * animierte Symbolebenen.
 */

const SYMBOLE: readonly SymbolBild[] = [
  { key: 'eins', name: 'Eins', bildPfad: null, bildUrl: null, glow: false },
  { key: 'drei', name: 'Drei', bildPfad: null, bildUrl: null, glow: false },
  { key: 'fuenf', name: 'Fuenf', bildPfad: null, bildUrl: null, glow: false },
  { key: 'wild', name: 'Wild', bildPfad: null, bildUrl: null, glow: true },
  { key: 'premium', name: 'Premium', bildPfad: null, bildUrl: null, glow: true },
];

const GITTER = Array.from({ length: 15 }, (_leer, index) => SYMBOLE[index % SYMBOLE.length]!.key);

/*
 * `createElement` und nicht JSX, weil die Testdateien dieses Projekts `.ts`
 * sind: `vitest.config.ts` sammelt nur Dateien mit der Endung `.test.ts`.
 * Ein `.tsx` hier wuerde stillschweigend nicht laufen, und ein Test, der
 * nicht laeuft, ist schlimmer als keiner.
 */
function male(laufend: readonly boolean[], treffer: readonly number[] = [], gitter = GITTER): string {
  return renderToStaticMarkup(
    createElement(WalzenBild, {
      grid: gitter,
      symbole: SYMBOLE,
      laufend,
      treffer,
      klebend: [],
      sweatAbWalze: null,
      reihen: 3,
      walzen: 5,
      /*
       * Die Geometrie kommt fertig herein, und hier eben leer.
       *
       * Genau das ist die Zusage: der Baum **misst nicht**. Ohne gemessene
       * Punkte zeichnet er keine Gewinnlinie und kein XP-Schild - und alles
       * andere, worum es hier geht, steht trotzdem.
       */
      rahmen: () => undefined,
      walzenRef: () => () => undefined,
      mitten: [],
      kasten: null,
    }),
  );
}

/** Alle Vorkommen eines Klassennamens als Element-Anfang. */
const zaehle = (markup: string, klasse: string): number =>
  [...markup.matchAll(new RegExp(`class="[^"]*\\b${klasse}\\b[^"]*"`, 'gu'))].length;

/** Die fuenf Bandlagen als Zeichenketten - fuer den Vergleich. */
function baender(markup: string): string[] {
  return [...markup.matchAll(/<div class="slot-band">(.*?)<div class="slot-stand">/gsu)].map(
    (treffer) => treffer[1] ?? '',
  );
}

describe('Aufbau der Walzen', () => {
  it('zeigt fuenf Walzen mit je einem Band und einem Stand', () => {
    const markup = male([false, false, false, false, false]);
    expect(zaehle(markup, 'slot-walze')).toBe(5);
    expect(zaehle(markup, 'slot-band')).toBe(5);
    expect(zaehle(markup, 'slot-stand')).toBe(5);
  });

  it('haelt beide Lagen im Baum, ob die Walze laeuft oder steht', () => {
    /*
     * Das ist der Kern. Fuenf Baender und fuenf Staende - im Lauf, im
     * Stillstand und mitten im gestaffelten Stopp. Nichts entsteht, nichts
     * vergeht.
     */
    for (const laufend of [
      [true, true, true, true, true],
      [false, false, false, false, false],
      [false, false, true, true, true],
      [false, true, false, true, false],
    ]) {
      const markup = male(laufend);
      expect(zaehle(markup, 'slot-band')).toBe(5);
      expect(zaehle(markup, 'slot-stand')).toBe(5);
    }
  });

  it('laesst die Bandlagen unveraendert, wenn die Walzen anhalten', () => {
    /*
     * Die Fuellsymbole haengen nicht am Spielstand - sie sind Fuellung. Wenn
     * ihr Markup beim Stopp gleich bleibt, hat React nichts zu tun: kein
     * Abbauen, kein Aufbauen, kein neues Bild, kein Bildpaint.
     */
    const imLauf = baender(male([true, true, true, true, true]));
    const gestoppt = baender(male([false, false, false, false, false]));
    expect(imLauf).toHaveLength(5);
    expect(gestoppt).toEqual(imLauf);
  });

  it('fuellt das Band mit sechs Zellen und den Stand mit drei', () => {
    const markup = male([true, true, true, true, true]);
    // Sechs Fuellzellen je Band, damit beim Umlauf keine Luecke entsteht,
    // drei Ergebniszellen je Stand - zusammen 45 Zellen bei fuenf Walzen.
    expect(zaehle(markup, 'slot-zelle')).toBe(5 * 6 + 5 * 3);
    const erstesBand = baender(markup)[0] ?? '';
    expect(zaehle(erstesBand, 'slot-zelle')).toBe(6);
  });

  it('markiert Treffer nur an stehenden Walzen', () => {
    /*
     * Eine Trefferzelle leuchtet. Waehrend die Walze laeuft, ist das
     * Ergebnis verdeckt - ein Leuchten darin waere ein Leuchten auf einer
     * Lage, die niemand sieht, und es wuerde jedes Bild neu gemalt.
     */
    const imLauf = male([true, true, true, true, true], [0, 3, 6]);
    expect(zaehle(imLauf, 'slot-zelle--treffer')).toBe(0);

    const gestoppt = male([false, false, false, false, false], [0, 3, 6]);
    expect(zaehle(gestoppt, 'slot-zelle--treffer')).toBe(3);
  });

  it('setzt kein will-change und keinen Filter als Inline-Stil', () => {
    /*
     * Die Entscheidung, welche Ebene befoerdert wird, gehoert ins
     * Stylesheet - dort steht sie an genau einer Stelle und laesst sich
     * nachzaehlen (siehe `xpslot-leistung.test.ts`). Ein Inline-Stil waere
     * eine zweite Stelle, die der andere Test nicht sieht.
     */
    const markup = male([true, false, true, false, true], [1, 4, 7]);
    expect(markup).not.toContain('will-change');
    expect(markup).not.toContain('filter');
  });

  it('zeigt kein Ergebnis in der laufenden Lage - dort liegt nur Fuellung', () => {
    /*
     * Die Fuellsymbole kommen aus einer festen Reihe und nicht aus dem
     * Spielfeld. Wer das Band anhaelt, sieht keine Vorschau.
     *
     * Geprueft wird es daran, dass die Bandlagen sich **nicht** aendern,
     * wenn das Spielfeld ein anderes ist.
     */
    const anderes = male(
      [true, true, true, true, true],
      [],
      Array.from({ length: 15 }, () => 'premium'),
    );
    expect(baender(anderes)).toEqual(baender(male([true, true, true, true, true])));
  });
});
