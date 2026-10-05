import { describe, expect, it } from 'vitest';
import { level } from '@swisshub/modules';
import { pfadMitte, type Mitte } from '@/modules/level/xpslot/components/walzenbild';

/**
 * Das XP-Schild sitzt auf der Linie - gerechnet, nicht geschaetzt.
 *
 * ## Warum das ein eigener Test ist
 *
 * Weil «mittig auf der Linie» eine geometrische Aussage ist und sich als
 * solche pruefen laesst. Der alte Ort - ueber dem hoechsten Punkt, waagrecht
 * am Mittelwert der x-Werte - war bei den fuenf waagrechten Linien beinahe
 * richtig und bei den fuenf uebrigen daneben:
 *
 *   - `[0, 1, 2, 1, 0]` (V): hoechster Punkt ist die oberste Reihe an den
 *     Enden, Mittelwert der x-Werte ist die Mitte. Das Schild stand also
 *     oben in der Mitte - und dort verlaeuft die Linie **nicht**, dort ist
 *     sie unten.
 *   - `[1, 0, 1, 2, 1]` (Zickzack): dasselbe eine Reihe tiefer.
 *
 * Darum wird hier mit der echten Liniendefinition des Spiels gerechnet
 * (`level.xpslot` kennt sie) und nachgesehen, dass der Punkt wirklich auf dem
 * Pfad liegt.
 *
 * ## Die Pruefung «liegt auf dem Pfad»
 *
 * Ein Punkt liegt auf einem Streckenzug, wenn er auf einem seiner Segmente
 * liegt. Fuer ein Segment `a→b` heisst das: der Abstand von `a` zum Punkt
 * plus der Abstand vom Punkt zu `b` ist so gross wie der Abstand `a→b`.
 * Gerechnet wird mit einer Toleranz, weil Gleitkomma.
 */

const REIHEN = 3;
const WALZEN = 5;
/** Ein Raster wie auf dem Schreibtisch: 90 px Zellen, kein Abstand. */
const ZELLE = 90;
const KASTEN = { breite: WALZEN * ZELLE, hoehe: REIHEN * ZELLE };

/** Die Zellmitten eines gleichmaessigen Rasters - wie die echte Messung sie liefert. */
function mitten(zelle = ZELLE): Mitte[] {
  const punkte: Mitte[] = [];
  for (let walze = 0; walze < WALZEN; walze += 1) {
    for (let reihe = 0; reihe < REIHEN; reihe += 1) {
      punkte[walze * REIHEN + reihe] = {
        x: walze * zelle + zelle / 2,
        y: reihe * zelle + zelle / 2,
      };
    }
  }
  return punkte;
}

function laenge(a: Mitte, b: Mitte): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Liegt `punkt` auf dem Streckenzug `punkte`? */
function liegtAufPfad(punkt: Mitte, punkte: readonly Mitte[], toleranz = 0.001): boolean {
  for (let index = 1; index < punkte.length; index += 1) {
    const a = punkte[index - 1]!;
    const b = punkte[index]!;
    const umweg = laenge(a, punkt) + laenge(punkt, b) - laenge(a, b);
    if (Math.abs(umweg) < toleranz) {
      return true;
    }
  }
  return false;
}

/** Die gesamte Pfadlaenge. */
function pfadLaenge(punkte: readonly Mitte[]): number {
  let summe = 0;
  for (let index = 1; index < punkte.length; index += 1) {
    summe += laenge(punkte[index - 1]!, punkte[index]!);
  }
  return summe;
}

/** Die Laenge vom Anfang bis zu einem Punkt auf dem Pfad. */
function laengeBis(punkt: Mitte, punkte: readonly Mitte[]): number {
  let summe = 0;
  for (let index = 1; index < punkte.length; index += 1) {
    const a = punkte[index - 1]!;
    const b = punkte[index]!;
    const umweg = laenge(a, punkt) + laenge(punkt, b) - laenge(a, b);
    if (Math.abs(umweg) < 0.001) {
      return summe + laenge(a, punkt);
    }
    summe += laenge(a, b);
  }
  return Number.NaN;
}

describe('Die Mitte einer Gewinnlinie', () => {
  const punkteFuer = (linie: number, zelle = ZELLE): Mitte[] => {
    const raster = mitten(zelle);
    return level.xpslot.linienZellen(linie).map((index) => raster[index]!);
  };

  it('kennt alle zehn Linien des Spiels', () => {
    // Haengt der Test an einer eigenen Kopie der Linien, prueft er die
    // Kopie. Darum die echte Definition.
    for (let linie = 0; linie < 10; linie += 1) {
      expect(level.xpslot.linienZellen(linie)).toHaveLength(WALZEN);
    }
  });

  it('liegt bei jeder der zehn Linien auf der Linie', () => {
    for (let linie = 0; linie < 10; linie += 1) {
      const punkte = punkteFuer(linie);
      const mitte = pfadMitte(punkte);
      expect(mitte, `Linie ${linie}`).not.toBeNull();
      expect(liegtAufPfad(mitte!, punkte), `Linie ${linie} liegt neben dem Pfad`).toBe(true);
    }
  });

  it('liegt bei jeder Linie genau auf der halben Pfadlaenge', () => {
    for (let linie = 0; linie < 10; linie += 1) {
      const punkte = punkteFuer(linie);
      const mitte = pfadMitte(punkte)!;
      expect(laengeBis(mitte, punkte), `Linie ${linie}`).toBeCloseTo(pfadLaenge(punkte) / 2, 6);
    }
  });

  it('trifft bei einer waagrechten Linie die mittlere Walze', () => {
    // Linie 0 ist die Mittelreihe: die Mitte liegt in Walze 3 von 5.
    const mitte = pfadMitte(punkteFuer(0))!;
    expect(mitte.x).toBeCloseTo(KASTEN.breite / 2, 6);
    expect(mitte.y).toBeCloseTo(ZELLE * 1.5, 6);
  });

  it('trifft bei der V-Linie den unteren Punkt und nicht den oberen', () => {
    /*
     * Das ist der Fall, an dem der alte Ort sichtbar falsch war.
     *
     * `[0, 1, 2, 1, 0]`: die Linie laeuft von oben links nach unten mitte
     * und zurueck nach oben rechts. Ihre Mitte liegt **unten** in der Mitte,
     * nicht oben - und das Schild stand oben.
     */
    const punkte = punkteFuer(3);
    const mitte = pfadMitte(punkte)!;
    expect(mitte.x).toBeCloseTo(KASTEN.breite / 2, 6);
    // Unterste Reihe: y = 2,5 Zellen. Oben waere 0,5.
    expect(mitte.y).toBeCloseTo(ZELLE * 2.5, 6);
  });

  it('trifft bei der umgekehrten V-Linie den oberen Punkt', () => {
    const mitte = pfadMitte(punkteFuer(4))!;
    expect(mitte.x).toBeCloseTo(KASTEN.breite / 2, 6);
    expect(mitte.y).toBeCloseTo(ZELLE * 0.5, 6);
  });

  it('bleibt in jeder Rastergroesse auf der Linie - auch auf dem Telefon', () => {
    /*
     * Die Zellgroesse kommt aus `cqw`, haengt also an der Panelbreite. Die
     * Rechnung darf davon nicht abhaengen: derselbe Punkt, nur skaliert.
     */
    for (const zelle of [34, 52, 90, 128]) {
      for (let linie = 0; linie < 10; linie += 1) {
        const punkte = punkteFuer(linie, zelle);
        const mitte = pfadMitte(punkte)!;
        expect(liegtAufPfad(mitte, punkte), `Zelle ${zelle}, Linie ${linie}`).toBe(true);
      }
    }
  });

  it('verhaelt sich bei Randfaellen still statt zu rechnen', () => {
    expect(pfadMitte([])).toBeNull();
    const einer: Mitte = { x: 7, y: 9 };
    expect(pfadMitte([einer])).toEqual(einer);
    // Alle Punkte gleich: keine Laenge, also der erste Punkt - und keine
    // Division durch Null.
    expect(pfadMitte([einer, einer, einer])).toEqual(einer);
  });
});
