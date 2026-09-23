import { describe, expect, it } from 'vitest';
import { analytics } from '@swisshub/modules';

const { anteilSekunden, sprachzeitFenster } = analytics;

/**
 * Die eine Formel, auf der die Sprachzeit steht.
 *
 *     von   = MAX(joinedAt, fensterVon)
 *     bis   = MIN(leftAt ?? jetzt, fensterBis, jetzt)
 *     dauer = MAX(0, bis - von)
 *
 * Sie gilt für laufende und abgeschlossene Sitzungen gleichermassen - genau
 * deshalb gibt es sie nur einmal. Vorher wurde Sprachzeit ausschliesslich aus
 * `leftAt - joinedAt` gebildet, und eine laufende Sitzung hatte damit keine
 * Dauer, sondern gar keine.
 */

const T = (stunde: number, minute = 0): Date => new Date(Date.UTC(2026, 8, 23, stunde, minute, 0));

const WEIT_OFFEN = { von: new Date(Date.UTC(2000, 0, 1)), bis: new Date(Date.UTC(2100, 0, 1)) };

describe('Anteil einer Sitzung an einem Fenster', () => {
  it('TEST 31: eine laufende Sitzung zählt bis jetzt', () => {
    // 10:00 betreten, noch nicht verlassen, es ist 10:30 → eine halbe Stunde.
    // Nicht null, und nicht erst nach dem Verlassen.
    expect(anteilSekunden(T(10), null, WEIT_OFFEN.von, WEIT_OFFEN.bis, T(10, 30))).toBe(1800);
  });

  it('TEST 32: eine abgeschlossene Sitzung zählt bis zum Verlassen', () => {
    expect(anteilSekunden(T(10), T(11, 30), WEIT_OFFEN.von, WEIT_OFFEN.bis, T(23))).toBe(5400);
  });

  it('rechnet auf die Sekunde, nicht auf ganze Minuten', () => {
    const joined = new Date(Date.UTC(2026, 8, 23, 10, 0, 0));
    const jetzt = new Date(Date.UTC(2026, 8, 23, 10, 1, 35));
    expect(anteilSekunden(joined, null, WEIT_OFFEN.von, WEIT_OFFEN.bis, jetzt)).toBe(95);
  });

  it('TEST 34: schneidet eine abgeschlossene Sitzung auf das Fenster', () => {
    // 23:00 Vortag bis 01:00 heute, Fenster «heute» → eine Stunde.
    const gestern23 = new Date(Date.UTC(2026, 8, 22, 23, 0, 0));
    const heute01 = new Date(Date.UTC(2026, 8, 23, 1, 0, 0));
    expect(anteilSekunden(gestern23, heute01, T(0), T(23, 59), T(12))).toBe(3600);
  });

  it('TEST 35: schneidet auch eine laufende Sitzung auf das Fenster', () => {
    // 23:30 Vortag, noch aktiv; es ist 00:30 → für heute eine halbe Stunde.
    const gestern2330 = new Date(Date.UTC(2026, 8, 22, 23, 30, 0));
    expect(anteilSekunden(gestern2330, null, T(0), T(23, 59), T(0, 30))).toBe(1800);
  });

  it('zählt für einen Zeitraum, der vor der Sitzung endet, nichts', () => {
    const vorgestern = new Date(Date.UTC(2026, 8, 21, 12, 0, 0));
    expect(anteilSekunden(T(10), null, vorgestern, new Date(Date.UTC(2026, 8, 22)), T(12))).toBe(0);
  });

  it('gibt einer laufenden Sitzung auch in einem vergangenen Zeitraum ihren Teil', () => {
    /*
     * Wer seit drei Tagen im Kanal sitzt, war auch vorgestern da. Für
     * «vorgestern» zählt genau dieser Tag - und nicht, was seither
     * dazugekommen ist.
     */
    const vorDreiTagen = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));
    const fensterVon = new Date(Date.UTC(2026, 8, 21, 0, 0, 0));
    const fensterBis = new Date(Date.UTC(2026, 8, 22, 0, 0, 0));
    expect(anteilSekunden(vorDreiTagen, null, fensterVon, fensterBis, T(12))).toBe(86_400);
  });

  it('geht nie über die Serverzeit hinaus', () => {
    // Ein Fenster, das in die Zukunft reicht, erfindet keine Sprachzeit.
    const zukunft = new Date(Date.UTC(2030, 0, 1));
    expect(anteilSekunden(T(10), null, T(0), zukunft, T(11))).toBe(3600);
  });

  it('wird nie negativ', () => {
    // Ein Abschnitt, der nach dem Fensterende begann.
    expect(anteilSekunden(T(20), null, T(0), T(10), T(23))).toBe(0);
    // Und eine Uhr, die zurückgestellt wurde.
    expect(anteilSekunden(T(20), null, T(0), T(23), T(19))).toBe(0);
  });
});

describe('Das Fenster eines Zeitraums', () => {
  it('beginnt am Anfang des Zürcher Kalendertages', () => {
    /*
     * Die Aggregate rechnen in ganzen Kalendertagen: «letzte 30 Tage» holt
     * die Tageszeile des Starttags komplett. Der laufende Anteil muss
     * dasselbe Fenster abdecken - sonst zählte die eine Hälfte einen
     * Zeitraum, den die andere nicht kennt.
     */
    const mittags = new Date(Date.UTC(2026, 8, 23, 12, 34, 56));
    const fenster = sprachzeitFenster({ von: mittags, bis: mittags });

    expect(fenster.von.getTime()).toBeLessThan(mittags.getTime());
    expect(fenster.bis).toBe(mittags);
    // Sommerzeit: Zürich liegt zwei Stunden vor UTC, Mitternacht ist 22:00 UTC.
    expect(fenster.von.toISOString()).toBe('2026-09-22T22:00:00.000Z');
  });

  it('beachtet die Winterzeit', () => {
    const januar = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(sprachzeitFenster({ von: januar, bis: januar }).von.toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    );
  });
});
