import { describe, expect, it } from 'vitest';
import { bonusEinstieg } from '../../packages/modules/src/level/xpslot/regeln';

/**
 * Wo eine Bonusrunde beginnt.
 *
 * ## Was bestellt war
 *
 * «4 Scatter sollen 12 Spinns geben, 6 Scatter sollen 16 Spinns geben» - und
 * daraus wurde, nach Ruecksprache, ein hoeherer Einstieg in die bestehende
 * Leiter statt einer zweiten Zahlenreihe daneben:
 *
 * | Scatter | Einstieg   | Es gibt                        |
 * | ------- | ---------- | ------------------------------ |
 * | 3       | `LADDER_1` | 8, riskierbar auf 12, dann 16  |
 * | 4 – 5   | `LADDER_2` | 12, riskierbar auf 16          |
 * | 6+      | `SPINS`    | 16 sofort, ohne Entscheidung   |
 *
 * ## Warum relativ zur Ausloeseschwelle
 *
 * Gerechnet wird `scatter - bonusAusloeser` und nicht gegen die festen Zahlen
 * 4 und 6. Die Schwelle ist einstellbar: setzt jemand sie auf 4, hiesse eine
 * feste 4 «jeder Bonus beginnt auf Sprosse zwei» - die unterste Sprosse waere
 * damit lautlos unerreichbar geworden. Relativ gerechnet bleibt die Staffel
 * dieselbe Zugabe, egal wo der Bonus anfaengt.
 */

/** Die Vorgaben, wie sie in der Konfiguration stehen. */
const WERTE = { bonusAusloeser: 3, bonusFreispiele: 8, leiter1: 12, leiter2: 16 };

describe('bonusEinstieg', () => {
  it('beginnt bei genau ausgeloest unten in der Leiter', () => {
    expect(bonusEinstieg(3, WERTE)).toEqual({ stufe: 'LADDER_1', freispiele: 0 });
  });

  it('ueberspringt bei einem oder zwei Scattern mehr die erste Sprosse', () => {
    for (const scatter of [4, 5]) {
      expect(bonusEinstieg(scatter, WERTE), `${scatter} Scatter`).toEqual({
        stufe: 'LADDER_2',
        freispiele: 0,
      });
    }
  });

  it('gibt ab drei Scattern mehr die oberste Zahl ohne Entscheidung', () => {
    for (const scatter of [6, 7, 10, 15]) {
      expect(bonusEinstieg(scatter, WERTE), `${scatter} Scatter`).toEqual({
        stufe: 'SPINS',
        freispiele: 16,
      });
    }
  });

  it('sagt auf einer Leitersprosse noch keine Freispiele zu', () => {
    /*
     * `freispiele: 0` ist kein Versehen. Auf einer Sprosse ist die Zahl ein
     * Angebot: `awarded` bleibt 0, bis jemand nimmt oder riskiert. Stuende
     * sie schon in der Zeile, waere sie zweimal gutgeschrieben.
     */
    expect(bonusEinstieg(3, WERTE).freispiele).toBe(0);
    expect(bonusEinstieg(4, WERTE).freispiele).toBe(0);
  });

  it('verschiebt sich mit der Ausloeseschwelle', () => {
    // Schwelle 5: fuenf Scatter sind dann der Normalfall und beginnen unten.
    const hoch = { ...WERTE, bonusAusloeser: 5 };
    expect(bonusEinstieg(5, hoch).stufe).toBe('LADDER_1');
    expect(bonusEinstieg(6, hoch).stufe).toBe('LADDER_2');
    expect(bonusEinstieg(8, hoch).stufe).toBe('SPINS');
  });

  it('steigt nie auf eine Sprosse, die nichts mehr hergibt', () => {
    /*
     * Die Leiter ist abschaltbar: `leiter1 = 0` heisst «es gibt keine zweite
     * Sprosse». Ein Einstieg dort gaebe eine Runde mit einer Wahl zwischen
     * null und null - und die Freispiele waeren weg, obwohl jemand vier
     * Scatter getroffen hat. Dann gilt die Sprosse darunter.
     */
    const ohneLeiter = { ...WERTE, leiter1: 0, leiter2: 0 };
    expect(bonusEinstieg(4, ohneLeiter).stufe).toBe('LADDER_1');
    expect(bonusEinstieg(9, ohneLeiter).stufe).toBe('LADDER_1');

    // Nur die oberste abgeschaltet: Sprosse zwei traegt noch.
    const ohneSpins = { ...WERTE, leiter2: 0 };
    expect(bonusEinstieg(9, ohneSpins).stufe).toBe('LADDER_2');
  });

  it('behandelt weniger Scatter als die Schwelle wie den Normalfall', () => {
    /*
     * Dieser Fall kommt nicht vor - ohne genug Scatter gibt es keinen Bonus.
     * Er steht hier, weil «kommt nicht vor» in einer Funktion ohne Antwort
     * ein stiller Absturz waere, und `LADDER_1` ist die vorsichtige Antwort.
     */
    expect(bonusEinstieg(0, WERTE).stufe).toBe('LADDER_1');
    expect(bonusEinstieg(2, WERTE).stufe).toBe('LADDER_1');
  });
});
