import { describe, expect, it } from 'vitest';
import { ausSchluessel, inDerWoche, kalenderwoche } from '@swisshub/modules/clips/woche';

/**
 * Die Woche, in der ein Wettbewerb laeuft.
 *
 * ## Warum das nicht «Datum durch sieben» ist
 *
 * Eine Runde heisst `2026-W39`, und dieser Schluessel ist zugleich der
 * Riegel gegen eine zweite Runde derselben Woche. Rechnet die Funktion an
 * einem Jahreswechsel falsch, entstehen zwei Runden fuer dieselben Tage -
 * oder eine Woche faellt aus.
 *
 * Die ISO-Regel lautet: die Woche gehoert zu dem Jahr, in dem ihr Donnerstag
 * liegt. Genau daran scheitert jede naive Rechnung, und genau das steht
 * unten.
 *
 * ## Und warum Zuercher Zeit
 *
 * «Freitag 20:00» soll im Sommer wie im Winter 20:00 Uhr in Zuerich sein.
 * Gespeichert wird UTC - im Sommer also 18:00, im Winter 19:00. Eine feste
 * Verschiebung waere zweimal im Jahr eine Stunde daneben.
 */
describe('Kalenderwoche in Zuercher Zeit', () => {
  const woche = (iso: string): string => kalenderwoche(new Date(iso)).key;

  describe('Jahreswechsel nach ISO', () => {
    it.each([
      // Der 31.12.2025 ist ein Mittwoch - sein Donnerstag liegt 2026.
      ['2025-12-31T12:00:00Z', '2026-W01'],
      ['2026-01-01T12:00:00Z', '2026-W01'],
      // Der 03.01.2027 ist ein Sonntag und gehoert noch zur letzten Woche 2026.
      ['2027-01-03T12:00:00Z', '2026-W53'],
      ['2027-01-04T12:00:00Z', '2027-W01'],
      // Ein gewoehnlicher Montag mitten im Jahr.
      ['2026-09-21T06:00:00Z', '2026-W39'],
      ['2026-09-27T21:59:00Z', '2026-W39'],
    ])('%s liegt in %s', (zeitpunkt, erwartet) => {
      expect(woche(zeitpunkt)).toBe(erwartet);
    });

    it('nummeriert zweistellig - sonst sortiert W9 hinter W10', () => {
      expect(woche('2026-03-02T12:00:00Z')).toMatch(/^\d{4}-W\d{2}$/u);
      expect(woche('2026-03-02T12:00:00Z')).toBe('2026-W10');
    });
  });

  describe('Wochengrenze', () => {
    /*
     * Die Grenze liegt Montag 00:00 Zuercher Zeit - im Sommer also um
     * 22:00 UTC am Sonntag. Wer nach UTC rechnet, eroeffnet die Runde zwei
     * Stunden zu spaet und laesst den Sonntagabend in die alte Woche fallen.
     */
    it('wechselt Montag um Mitternacht in Zuerich, nicht in UTC', () => {
      // Sonntag, 27.09.2026, 22:00 UTC = Montag, 28.09., 00:00 in Zuerich (MESZ).
      expect(woche('2026-09-27T21:59:59Z')).toBe('2026-W39');
      expect(woche('2026-09-27T22:00:00Z')).toBe('2026-W40');
    });

    it('verschiebt sich im Winter um eine Stunde', () => {
      // Sonntag, 25.01.2026, 23:00 UTC = Montag, 26.01., 00:00 in Zuerich (MEZ).
      expect(woche('2026-01-25T22:59:59Z')).toBe('2026-W04');
      expect(woche('2026-01-25T23:00:00Z')).toBe('2026-W05');
    });
  });

  describe('Zeitpunkte innerhalb der Woche', () => {
    it('rechnet Sommerzeit richtig - Freitag 20:00 in Zuerich ist 18:00 UTC', () => {
      const w = kalenderwoche(new Date('2026-09-23T12:00:00Z'));
      expect(inDerWoche(w, 5, 20, 0).toISOString()).toBe('2026-09-25T18:00:00.000Z');
    });

    it('rechnet Winterzeit richtig - Freitag 20:00 in Zuerich ist 19:00 UTC', () => {
      const w = kalenderwoche(new Date('2026-01-21T12:00:00Z'));
      expect(inDerWoche(w, 5, 20, 0).toISOString()).toBe('2026-01-23T19:00:00.000Z');
    });

    it('trifft die Zeitumstellung - dieselbe Wochenzeit, andere UTC-Stunde', () => {
      /*
       * Die Uhren werden am letzten Sonntag im Maerz vorgestellt. Montag und
       * Freitag derselben Woche liegen dadurch in verschiedenen Zonen - und
       * genau hier haette eine feste Verschiebung eine Stunde Unterschied.
       */
      const umstellung = kalenderwoche(new Date('2026-03-30T12:00:00Z'));
      expect(inDerWoche(umstellung, 1, 0, 0).toISOString()).toBe('2026-03-29T22:00:00.000Z');
      expect(inDerWoche(umstellung, 5, 20, 0).toISOString()).toBe('2026-04-03T18:00:00.000Z');
    });

    it('legt den Wochenbeginn auf Montag', () => {
      const w = kalenderwoche(new Date('2026-09-25T12:00:00Z'));
      // Freitag gefragt, Montag als Beginn - nicht der Tag der Anfrage.
      expect(w.beginn.getTime()).toBe(inDerWoche(w, 1, 0, 0).getTime());
    });
  });

  describe('Schluessel wieder zerlegen', () => {
    it('liest Jahr und Woche zurueck', () => {
      expect(ausSchluessel('2026-W39')).toEqual({ jahr: 2026, woche: 39 });
      expect(ausSchluessel('2026-W01')).toEqual({ jahr: 2026, woche: 1 });
    });

    it('gibt Nullen statt NaN, wenn der Schluessel nicht passt', () => {
      // Eine Zeile aus einer frueheren Fassung soll die Hall of Fame nicht
      // mit «Woche NaN/NaN» sprengen.
      expect(ausSchluessel('kaputt')).toEqual({ jahr: 0, woche: 0 });
    });

    it('ist die Umkehrung von `kalenderwoche`', () => {
      const w = kalenderwoche(new Date('2027-01-03T12:00:00Z'));
      expect(ausSchluessel(w.key)).toEqual({ jahr: w.jahr, woche: w.woche });
    });
  });
});
