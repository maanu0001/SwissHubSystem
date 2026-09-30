import { describe, expect, it } from 'vitest';
import {
  RAND_ABSTAND,
  UMDREHUNGEN_MIN,
  UMDREHUNGEN_SPANNE,
  radStopp,
  streuung,
} from '../../apps/web/src/modules/spielwahl/rad-stopp';
import { drawWeighted, quelleAusSeed } from '../../packages/modules/src/zufall';

/**
 * Wo das Rad stehen bleibt.
 *
 * ## Was hier geprueft wird und was nicht
 *
 * Nicht: ob der Gewinner stimmt. Der wird auf dem Server gezogen, und dafuer
 * gibt es eigene Tests. Hier geht es um die Frage, die vorher falsch
 * beantwortet war: **haelt der Zeiger im Feld des Gewinners, ohne jedes Mal
 * genau in seiner Mitte zu stehen?**
 *
 * Beides zusammen. Nur «nicht in der Mitte» waere durch einen Wurf in ein
 * fremdes Feld auch erfuellt - und das waere die schlimmere Variante des
 * Fehlers: das Rad zeigt auf Spiel A, verkuendet wird Spiel B.
 *
 * ## Ohne Flackern
 *
 * Kein `Math.random` in diesem Test und keines in der geprueften Funktion.
 * Alles folgt aus dem Seed; dieselben Seeds ergeben dieselben Zahlen, heute
 * und in einem Jahr.
 */

/** Die Seeds, mit denen gerechnet wird - Hex, wie `randomBytes(16)` sie liefert. */
const SEEDS = Array.from({ length: 200 }, (_, index) =>
  index.toString(16).padStart(32, '7').slice(0, 32),
);

describe('streuung', () => {
  it('liegt immer in [0, 1)', () => {
    for (const seed of SEEDS) {
      for (const strom of [0, 1, 2]) {
        const wert = streuung(seed, strom);
        expect(wert).toBeGreaterThanOrEqual(0);
        expect(wert).toBeLessThan(1);
      }
    }
  });

  it('gibt für denselben Seed denselben Wert - auf jedem Bildschirm', () => {
    expect(streuung('abc', 0)).toBe(streuung('abc', 0));
    expect(streuung('abc', 1)).toBe(streuung('abc', 1));
  });

  it('hält die beiden Ströme auseinander', () => {
    // Sonst waeren Stelle im Feld und Zahl der Umdrehungen dieselbe Zahl -
    // ein spaeter Stopp haette dann immer mehr Umdrehungen.
    const treffer = SEEDS.filter((seed) => streuung(seed, 0) === streuung(seed, 1));
    expect(treffer).toEqual([]);
  });

  it('verteilt sich über den ganzen Bereich', () => {
    /*
     * Zehn Faecher, zweihundert Seeds. Jedes Fach muss etwas abbekommen -
     * ohne das koennte der Mischer alle Werte in eine Ecke legen, und das Rad
     * haette statt einer festen Stelle eben eine andere feste Stelle.
     */
    const faecher = new Array<number>(10).fill(0);
    for (const seed of SEEDS) {
      faecher[Math.floor(streuung(seed, 0) * 10)]! += 1;
    }
    expect(faecher.every((anzahl) => anzahl > 0)).toBe(true);
  });

  it('reagiert auf eine Änderung im letzten Zeichen', () => {
    // Zwei Runden hintereinander haben oft aehnliche Seeds. Ohne den
    // Bitmischer landeten sie an fast derselben Stelle.
    const a = streuung('00000000000000000000000000000000', 0);
    const b = streuung('00000000000000000000000000000001', 0);
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});

describe('radStopp', () => {
  it('hält nicht in der Mitte des gezogenen Loses', () => {
    /*
     * Der eigentliche Fehler, in einer Zeile: vorher war der Versatz
     * ausnahmslos 0.5.
     */
    const versaetze = SEEDS.map((seed) => {
      const stopp = radStopp({ seed, losPunkt: 0, losGesamt: 1 });
      return stopp.anteil;
    });

    expect(versaetze.filter((wert) => wert === 0.5)).toEqual([]);
    // Und die Werte sind wirklich verschieden, nicht nur verschoben.
    expect(new Set(versaetze).size).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it('bleibt bei jeder Kandidatenzahl im Feld des Gewinners', () => {
    /*
     * Der Fall, der nicht passieren darf: das Rad zeigt auf ein anderes
     * Spiel als das, das gewonnen hat.
     *
     * Gerechnet wird mit der echten Ziehung des Servers - `drawWeighted` mit
     * derselben seed-gestuetzten Quelle, die `starte` verwendet. Der Gewinner
     * kommt also nicht aus einer Annahme dieses Tests, sondern aus derselben
     * Funktion wie im Betrieb.
     */
    for (const anzahl of [2, 3, 5, 8, 12, 20]) {
      const lose = Array.from({ length: anzahl }, (_, index) => ({
        entryId: `k${index}`,
        discordId: `k${index}`,
        weight: 1,
      }));

      for (const seed of SEEDS.slice(0, 60)) {
        const ziehung = drawWeighted(lose, quelleAusSeed(seed))!;
        const stopp = radStopp({ seed, losPunkt: ziehung.ticket, losGesamt: ziehung.totalWeight });

        // In welchem Feld landet der Zeiger? Bei Gleichgewicht ist das Feld
        // `i` der Abschnitt [i/n, (i+1)/n).
        const getroffen = Math.floor(stopp.anteil * anzahl);
        const gewonnen = lose.findIndex((los) => los.entryId === ziehung.winner.entryId);
        expect(getroffen, `${anzahl} Felder, Seed ${seed}`).toBe(gewonnen);
      }
    }
  });

  it('bleibt im Feld des Gewinners, auch wenn die Lose gewichtet sind', () => {
    // Drei Kandidaten mit 1, 5 und 2 Unterstuetzern - das Gewinnerfeld ist
    // dann nicht mehr so breit wie die anderen.
    const lose = [
      { entryId: 'a', discordId: 'a', weight: 1 },
      { entryId: 'b', discordId: 'b', weight: 5 },
      { entryId: 'c', discordId: 'c', weight: 2 },
    ];
    const grenzen = { a: [0, 1], b: [1, 6], c: [6, 8] } as const;

    for (const seed of SEEDS.slice(0, 80)) {
      const ziehung = drawWeighted(lose, quelleAusSeed(seed))!;
      const stopp = radStopp({ seed, losPunkt: ziehung.ticket, losGesamt: ziehung.totalWeight });

      const [von, bis] = grenzen[ziehung.winner.entryId as keyof typeof grenzen];
      const punktAufDerAchse = stopp.anteil * ziehung.totalWeight;
      expect(punktAufDerAchse).toBeGreaterThanOrEqual(von);
      expect(punktAufDerAchse).toBeLessThan(bis);
    }
  });

  it('hält Abstand zur Trennlinie zwischen zwei Feldern', () => {
    for (const seed of SEEDS) {
      const stopp = radStopp({ seed, losPunkt: 3, losGesamt: 10 });
      const imLos = stopp.anteil * 10 - 3;
      expect(imLos).toBeGreaterThanOrEqual(RAND_ABSTAND);
      expect(imLos).toBeLessThanOrEqual(1 - RAND_ABSTAND);
    }
  });

  it('dreht unterschiedlich oft, aber nie zu kurz', () => {
    const zahlen = new Set(SEEDS.map((seed) => radStopp({ seed, losPunkt: 0, losGesamt: 4 }).umdrehungen));

    // Mehr als eine - sonst wäre die Variation nur behauptet.
    expect(zahlen.size).toBeGreaterThan(1);
    for (const anzahl of zahlen) {
      expect(anzahl).toBeGreaterThanOrEqual(UMDREHUNGEN_MIN);
      expect(anzahl).toBeLessThan(UMDREHUNGEN_MIN + UMDREHUNGEN_SPANNE);
    }
  });

  it('dreht vorwärts und mehr als eine Umdrehung, in jedem Fall', () => {
    for (const seed of SEEDS) {
      for (const [punkt, gesamt] of [
        [0, 1],
        [0, 20],
        [19, 20],
        [7, 13],
      ] as const) {
        const stopp = radStopp({ seed, losPunkt: punkt, losGesamt: gesamt });
        expect(stopp.grad).toBeGreaterThan(UMDREHUNGEN_MIN * 360);
        expect(stopp.grad).toBeLessThanOrEqual((UMDREHUNGEN_MIN + UMDREHUNGEN_SPANNE) * 360);
      }
    }
  });

  it('kommt ohne Ziehung nicht durcheinander', () => {
    for (const runde of [
      { seed: 'abc', losPunkt: null, losGesamt: null },
      { seed: 'abc', losPunkt: 0, losGesamt: 0 },
      { seed: 'abc', losPunkt: 3, losGesamt: null },
    ]) {
      const stopp = radStopp(runde);
      expect(stopp.anteil).toBe(0);
      expect(Number.isFinite(stopp.grad)).toBe(true);
      expect(stopp.grad % 360).toBe(0);
    }
  });

  it('gibt denselben Winkel für dieselbe Runde - auch beim späten Zuschauer', () => {
    const runde = { seed: 'deadbeefdeadbeefdeadbeefdeadbeef', losPunkt: 2, losGesamt: 7 };
    // Zweimal gerufen, als wären es zwei Bildschirme.
    expect(radStopp(runde)).toEqual(radStopp(runde));
  });
});
