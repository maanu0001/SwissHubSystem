import { describe, expect, it } from 'vitest';
import {
  letzteAbgeschlosseneWoche,
  periodeVon,
  periodenLabel,
  wochenSchluessel,
} from '../../packages/modules/src/wrapped/perioden';
import { kalenderwoche } from '../../packages/modules/src/clips/woche';
import { FOLIEN_OBERGRENZE, WRAPPED_STORIES } from '../../packages/modules/src/wrapped/stories';

/**
 * Die Kalenderwoche als Wrapped-Zeitraum.
 *
 * ## Was hier tatsaechlich schiefgehen kann
 *
 * Nicht «zeigt die Woche 39 die Woche 39». Sondern: der Jahreswechsel, das
 * 53-Wochen-Jahr und die beiden Zeitumstellungen. Genau die drei Faelle
 * stehen unten, mit Datumsangaben, die man nachrechnen kann - eine
 * Wochenlogik, die nur im Maerz geprueft wurde, ist im Dezember falsch und
 * niemand merkt es, weil dann alle Ferien haben.
 *
 * ## Warum nicht gegen `new Date()`
 *
 * Weil ein Test, der von der Uhr abhaengt, in 51 von 52 Wochen gruen ist.
 * Jeder Aufruf bekommt seinen Zeitpunkt mit.
 */

describe('Wochenperiode', () => {
  it('schneidet die Woche von Montag 00:00 bis zum folgenden Montag 00:00 Zürcher Zeit', () => {
    const woche = periodeVon('WEEKLY', '2026-W39');

    expect(woche).not.toBeNull();
    // Montag, 21.09.2026, 00:00 Zuercher Sommerzeit = 22:00 UTC am Sonntag.
    expect(woche?.start.toISOString()).toBe('2026-09-20T22:00:00.000Z');
    expect(woche?.end.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(woche?.jahr).toBe(2026);
    expect(woche?.woche).toBe(39);
    expect(woche?.monat).toBeNull();
  });

  it('dauert genau sieben Kalendertage, auch über die Zeitumstellung', () => {
    const stunden = (key: string): number => {
      const periode = periodeVon('WEEKLY', key);
      expect(periode, key).not.toBeNull();
      return (periode!.end.getTime() - periode!.start.getTime()) / 3600_000;
    };

    // Die Woche der Rueckstellung: in der Nacht auf Sonntag, 25.10.2026,
    // wird die Uhr zurueckgestellt. Diese Woche hat 169 Stunden.
    expect(stunden('2026-W43')).toBe(169);
    // Die Woche der Vorstellung: Nacht auf Sonntag, 29.03.2026. 167 Stunden.
    expect(stunden('2026-W13')).toBe(167);
    // Und eine gewoehnliche Woche dazwischen.
    expect(stunden('2026-W20')).toBe(168);
  });

  it('ordnet den Jahreswechsel nach ISO zu - der 31.12.2025 gehört zu 2026-W01', () => {
    // Mittwoch, 31.12.2025, 12:00 Zuercher Zeit.
    expect(wochenSchluessel(new Date('2025-12-31T11:00:00Z'))).toBe('2026-W01');

    const erste = periodeVon('WEEKLY', '2026-W01');
    // Montag, 29.12.2025 - die Woche beginnt im Vorjahr.
    expect(erste?.start.toISOString()).toBe('2025-12-28T23:00:00.000Z');
    expect(erste?.jahr).toBe(2026);
  });

  it('kennt die 53. Woche eines langen Jahres und verweigert sie in einem kurzen', () => {
    // 2026 hat 53 Wochen: der 31.12.2026 ist ein Donnerstag.
    expect(periodeVon('WEEKLY', '2026-W53')).not.toBeNull();
    expect(periodeVon('WEEKLY', '2026-W53')?.woche).toBe(53);

    // 2027 hat 52. `2027-W53` besteht das Muster und ist trotzdem keine Woche.
    expect(periodeVon('WEEKLY', '2027-W53')).toBeNull();
  });

  it('weist Schlüssel ab, die keine Woche sind', () => {
    for (const unsinn of ['2026-W00', '2026-W54', '2026-W9', '2026-9', '2026', 'KW39', '2026-W', '']) {
      expect(periodeVon('WEEKLY', unsinn)).toBeNull();
    }
  });

  it('stimmt in beide Richtungen mit derselben Wochenrechnung überein', () => {
    /*
     * Der Rundgang: aus einem Zeitpunkt den Schluessel, daraus den Zeitraum,
     * und dessen Beginn muss wieder denselben Schluessel tragen.
     *
     * Ueber ein ganzes Jahr, Donnerstag fuer Donnerstag - der Wochentag, der
     * nach ISO die Zuordnung entscheidet. Faende die Rechnung irgendwo einen
     * Montag zu weit vorne oder hinten, bricht der Rundgang genau dort.
     */
    for (let tag = 0; tag < 366; tag += 7) {
      const zeitpunkt = new Date(Date.UTC(2026, 0, 1, 10) + tag * 86_400_000);
      const key = wochenSchluessel(zeitpunkt);
      const periode = periodeVon('WEEKLY', key);
      expect(periode, key).not.toBeNull();
      expect(kalenderwoche(periode!.start).key).toBe(key);
      // Und die letzte Millisekunde gehoert noch dazu.
      expect(kalenderwoche(new Date(periode!.end.getTime() - 1)).key).toBe(key);
    }
  });

  it('nennt die Woche «KW 39 2026»', () => {
    expect(periodenLabel(periodeVon('WEEKLY', '2026-W39')!)).toBe('KW 39 2026');
    // Monat und Jahr bleiben, wie sie waren.
    expect(periodenLabel(periodeVon('MONTHLY', '2026-09')!)).toBe('September 2026');
    expect(periodenLabel(periodeVon('YEARLY', '2026')!)).toBe('2026');
  });

  it('meint mit «zuletzt abgeschlossen» die Woche davor, nicht die laufende', () => {
    // Montag, 28.09.2026, 00:01 Zuercher Zeit - die Woche 40 hat gerade
    // begonnen, abgeschlossen ist die 39.
    expect(letzteAbgeschlosseneWoche(new Date('2026-09-27T22:01:00Z')).key).toBe('2026-W39');

    // Sonntag, 27.09.2026, 23:59 Zuercher Zeit - die 39 laeuft noch.
    expect(letzteAbgeschlosseneWoche(new Date('2026-09-27T21:59:00Z')).key).toBe('2026-W38');

    // Und ueber den Jahreswechsel: am 1.1.2026 ist die Woche 2026-W01 noch
    // nicht vorbei, abgeschlossen ist die letzte von 2025.
    expect(letzteAbgeschlosseneWoche(new Date('2026-01-01T11:00:00Z')).key).toBe('2025-W52');
  });
});

describe('Wochenausgaben im Story-Katalog', () => {
  it('gibt der Woche weniger Folien als dem Monat', () => {
    expect(FOLIEN_OBERGRENZE.WEEKLY).toBeLessThan(FOLIEN_OBERGRENZE.MONTHLY);
    expect(FOLIEN_OBERGRENZE.MONTHLY).toBeLessThan(FOLIEN_OBERGRENZE.YEARLY);
  });

  it('hat für die Woche einen Anfang und ein Ende', () => {
    const fuerWoche = WRAPPED_STORIES.filter((story) => story.perioden.includes('WEEKLY'));
    expect(fuerWoche.some((story) => story.fest === 'anfang')).toBe(true);
    expect(fuerWoche.some((story) => story.fest === 'ende')).toBe(true);
  });

  it('lässt der Woche genug Stories für ihre Obergrenze', () => {
    /*
     * Sonst waere die Obergrenze eine Zahl ohne Deckung: fuenf Folien
     * versprochen, drei Stories vorhanden. Gezaehlt werden die freien
     * Plaetze - Anfang und Ende sind gesetzt.
     */
    const frei = WRAPPED_STORIES.filter(
      (story) => story.perioden.includes('WEEKLY') && story.fest === undefined,
    );
    expect(frei.length).toBeGreaterThanOrEqual(FOLIEN_OBERGRENZE.WEEKLY - 2);
  });

  it('hält Stories, die nur über ein Jahr Sinn ergeben, von der Woche fern', () => {
    // Der Monatsverlauf braucht zwoelf Monate. In einer Woche gibt es einen.
    for (const story of WRAPPED_STORIES) {
      if (story.perioden.includes('WEEKLY')) {
        expect(story.perioden).toContain('MONTHLY');
      }
    }
    const nurJahr = WRAPPED_STORIES.filter(
      (story) => story.perioden.length === 1 && story.perioden[0] === 'YEARLY',
    );
    expect(nurJahr.length).toBeGreaterThan(0);
  });
});
