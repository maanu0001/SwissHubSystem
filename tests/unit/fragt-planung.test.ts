import { describe, expect, it } from 'vitest';
import { faelligerTermin, naechsterTermin } from '../../packages/modules/src/fragt/planung';

/**
 * Wann gefragt wird.
 *
 * ## Warum das ein eigener Test ist
 *
 * Weil der Termin die halbe Absicherung gegen doppelte Veroeffentlichungen
 * ist. Er wird zu `FragtAbstimmung.opensAt`, und darauf liegt
 * `@@unique([frageId, opensAt])`. Rechnen zwei Durchgaenge verschiedene Werte
 * aus, greift die Bedingung nicht - und im Kanal stehen zwei Embeds zur
 * gleichen Frage.
 *
 * ## Und warum die Zeitzone hier wirklich geprueft wird
 *
 * «Freitag 18:00 in Europe/Zurich» ist im Sommer 16:00 UTC und im Winter
 * 17:00 UTC. Ein Test, der nur im Juli laeuft, bestaetigt die halbe Rechnung.
 */

const FREITAG_18 = {
  publishDay: 5,
  publishHour: 18,
  publishMinute: 0,
  timezone: 'Europe/Zurich',
} as const;

describe('Der faellige Termin', () => {
  it('findet den Termin, sobald die Uhrzeit erreicht ist', () => {
    // Freitag, 25.09.2026, 18:05 Zuerich = 16:05 UTC (Sommerzeit).
    const jetzt = new Date('2026-09-25T16:05:00Z');
    const termin = faelligerTermin(jetzt, FREITAG_18);
    expect(termin?.toISOString()).toBe('2026-09-25T16:00:00.000Z');
  });

  it('schweigt am Tag danach - der Termin ist ausserhalb der Nachholfrist', () => {
    /*
     * Samstag 20:00 Zuerich liegt 26 Stunden nach dem Freitagstermin. Ohne
     * diese Grenze wuerde ein Bot, der ueber Nacht stand, die Frage am
     * naechsten Abend nachschieben - zu einem Zeitpunkt, an dem sie nicht mehr
     * in den Wochenrhythmus passt.
     */
    expect(faelligerTermin(new Date('2026-09-26T18:00:00Z'), FREITAG_18)).toBeNull();
  });

  it('rechnet zweimal dasselbe aus', () => {
    /*
     * Die Eigenschaft, an der alles haengt. Ohne sie waere die
     * Eindeutigkeitsbedingung in der Datenbank wirkungslos.
     */
    const jetzt = new Date('2026-09-25T17:30:00Z');
    expect(faelligerTermin(jetzt, FREITAG_18)?.toISOString()).toBe('2026-09-25T16:00:00.000Z');
    expect(faelligerTermin(jetzt, FREITAG_18)?.toISOString()).toBe(
      faelligerTermin(jetzt, FREITAG_18)?.toISOString(),
    );
  });

  it('gibt fuer verschiedene Zeitpunkte innerhalb der Frist denselben Termin', () => {
    // Ein Durchgang um 18:01 Zuerich und einer um 22:59 muessen denselben
    // Termin treffen - sonst entstuenden zwei Abstimmungen fuer dieselbe Woche.
    const frueh = faelligerTermin(new Date('2026-09-25T16:01:00Z'), FREITAG_18);
    const spaet = faelligerTermin(new Date('2026-09-25T20:59:00Z'), FREITAG_18);
    expect(frueh?.toISOString()).toBe(spaet?.toISOString());
  });

  it('schweigt, solange die Uhrzeit am Zieltag noch nicht erreicht ist', () => {
    /*
     * Freitag 12:00 Zuerich: der Termin dieser Woche ist noch nicht da, und
     * der der Vorwoche ist ausserhalb der Nachholfrist. Also nichts zu tun.
     */
    const jetzt = new Date('2026-09-25T10:00:00Z');
    expect(faelligerTermin(jetzt, FREITAG_18)).toBeNull();
  });

  it('haelt die Nachholfrist ein', () => {
    // Sonntagabend - der Freitagstermin ist ueber zwei Tage her. Ein Bot, der
    // drei Wochen aus war, soll nicht drei alte Fragen nachschieben.
    expect(faelligerTermin(new Date('2026-09-27T20:00:00Z'), FREITAG_18)).toBeNull();
  });

  it('holt innerhalb der Frist nach', () => {
    // Zwei Stunden nach dem Termin - ein Bot, der kurz stand, stellt die Frage
    // noch.
    const termin = faelligerTermin(new Date('2026-09-25T18:00:00Z'), FREITAG_18);
    expect(termin?.toISOString()).toBe('2026-09-25T16:00:00.000Z');
  });

  it('rechnet im Winter eine Stunde anders', () => {
    /*
     * Der Fall, den eine Rechnung mit fester Verschiebung verfehlt. Freitag,
     * 12.12.2025, 18:00 Zuerich ist 17:00 UTC - im September waeren es 16:00.
     */
    const termin = faelligerTermin(new Date('2025-12-12T18:00:00Z'), FREITAG_18);
    expect(termin?.toISOString()).toBe('2025-12-12T17:00:00.000Z');
  });

  it('gilt auch in einer anderen Zeitzone', () => {
    // Die Zone ist einstellbar; sie muss wirken und nicht nur dastehen.
    const inTokio = faelligerTermin(new Date('2026-09-25T12:00:00Z'), {
      ...FREITAG_18,
      timezone: 'Asia/Tokyo',
    });
    // Freitag 18:00 in Tokio = 09:00 UTC.
    expect(inTokio?.toISOString()).toBe('2026-09-25T09:00:00.000Z');
  });
});

describe('Der naechste Termin', () => {
  it('liegt immer in der Zukunft', () => {
    for (const stunde of [0, 6, 12, 18, 23]) {
      const jetzt = new Date(`2026-09-23T${String(stunde).padStart(2, '0')}:00:00Z`);
      expect(naechsterTermin(jetzt, FREITAG_18).getTime()).toBeGreaterThan(jetzt.getTime());
    }
  });

  it('springt am Zieltag nach der Uhrzeit auf die naechste Woche', () => {
    // Freitag 20:00 Zuerich: der Termin dieser Woche ist vorbei.
    const naechster = naechsterTermin(new Date('2026-09-25T18:00:00Z'), FREITAG_18);
    expect(naechster.toISOString()).toBe('2026-10-02T16:00:00.000Z');
  });

  it('nennt am Zieltag vor der Uhrzeit noch denselben Tag', () => {
    const naechster = naechsterTermin(new Date('2026-09-25T10:00:00Z'), FREITAG_18);
    expect(naechster.toISOString()).toBe('2026-09-25T16:00:00.000Z');
  });

  it('findet jeden Wochentag', () => {
    for (let tag = 1; tag <= 7; tag += 1) {
      const naechster = naechsterTermin(new Date('2026-09-23T12:00:00Z'), {
        ...FREITAG_18,
        publishDay: tag,
      });
      // Innerhalb einer Woche - sonst stimmt die Wochentagsrechnung nicht.
      expect(naechster.getTime() - new Date('2026-09-23T12:00:00Z').getTime()).toBeLessThanOrEqual(
        8 * 24 * 60 * 60 * 1000,
      );
    }
  });
});
