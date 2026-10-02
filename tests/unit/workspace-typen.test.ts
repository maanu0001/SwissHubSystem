import { describe, expect, it } from 'vitest';
import { workspace } from '@swisshub/modules';

/**
 * Die beiden Rechnungen des Workspace, ohne Datenbank.
 *
 * Sie stehen als reine Funktionen da, damit genau das hier möglich ist: die
 * Grenzfälle einzeln durchgehen, statt sie über angelegte Aufgaben
 * herzustellen. Beide haben einen Fall, in dem die naive Rechnung falsch ist -
 * und das ist der Grund für diese Datei.
 */

const { faelligkeitsstufe, fortschritt, normalisiereTags, BOARD_SPALTEN, ERINNERUNG_TAGE } = workspace;

describe('faelligkeitsstufe', () => {
  const jetzt = new Date('2026-07-15T14:00:00Z');

  it('nennt eine Aufgabe ohne Frist «ohne»', () => {
    expect(faelligkeitsstufe(null, jetzt, 3)).toBe('ohne');
  });

  it('zählt den laufenden Tag nicht als überfällig', () => {
    /*
     * Der Fall, um den es geht: eine Aufgabe war heute um 09:00 fällig, es ist
     * 14:00. Eine Rechnung auf Zeitstempeln nennt sie überfällig - und färbt
     * sie rot, obwohl der Tag noch läuft. Gerechnet wird deshalb auf
     * Tagesgrenzen.
     */
    expect(faelligkeitsstufe(new Date('2026-07-15T09:00:00Z'), jetzt, 3)).toBe('heute');
    expect(faelligkeitsstufe(new Date('2026-07-15T23:30:00Z'), jetzt, 3)).toBe('heute');
  });

  it('nennt gestern überfällig', () => {
    expect(faelligkeitsstufe(new Date('2026-07-14T23:00:00Z'), jetzt, 3)).toBe('ueberfaellig');
  });

  it('richtet «bald» nach der Einstellung', () => {
    const inDreiTagen = new Date('2026-07-18T08:00:00Z');
    expect(faelligkeitsstufe(inDreiTagen, jetzt, 3)).toBe('bald');
    // Dieselbe Frist, engere Einstellung: dann ist sie noch nicht «bald».
    expect(faelligkeitsstufe(inDreiTagen, jetzt, 1)).toBe('normal');
  });

  it('nennt alles jenseits der Frist «normal»', () => {
    expect(faelligkeitsstufe(new Date('2026-09-01T08:00:00Z'), jetzt, 3)).toBe('normal');
  });
});

describe('fortschritt', () => {
  it('ist ohne Aufgaben null und nicht hundert', () => {
    // Ein Projekt ohne Aufgaben ist nicht fertig. Eine Division durch null als
    // «100 Prozent» zu lesen wäre genau die Art Zahl, der niemand mehr traut.
    expect(fortschritt([])).toEqual({ gesamt: 0, erledigt: 0, prozent: 0 });
  });

  it('lässt den Fortschritt nicht steigen, indem man Arbeit wegwirft', () => {
    // Zwei von vier erledigt, zwei abgebrochen: das sind zwei von zwei
    // zählenden - und nicht «50 Prozent», weil die abgebrochenen mitzählten.
    expect(fortschritt(['DONE', 'DONE', 'CANCELLED', 'CANCELLED'])).toEqual({
      gesamt: 2,
      erledigt: 2,
      prozent: 100,
    });
  });

  it('zählt blockierte und laufende Aufgaben als offen mit', () => {
    expect(fortschritt(['DONE', 'IN_PROGRESS', 'BLOCKED', 'OPEN'])).toEqual({
      gesamt: 4,
      erledigt: 1,
      prozent: 25,
    });
  });

  it('rundet auf ganze Prozent', () => {
    expect(fortschritt(['DONE', 'OPEN', 'OPEN']).prozent).toBe(33);
  });
});

describe('normalisiereTags', () => {
  it('fasst Schreibweisen zusammen', () => {
    expect(normalisiereTags(['Turnier', 'TURNIER', ' turnier '])).toEqual(['turnier']);
  });

  it('lässt Leeres weg', () => {
    expect(normalisiereTags(['', '   ', 'cs2'])).toEqual(['cs2']);
  });

  it('begrenzt die Anzahl', () => {
    const viele = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    expect(normalisiereTags(viele)).toHaveLength(10);
  });
});

describe('Listen', () => {
  it('zeigt «Abgebrochen» nicht als Board-Spalte', () => {
    // Abgebrochen ist ein Ausgang, keine Ablage: eine fünfte Spalte dafür
    // machte das Board breiter und die Entscheidung beiläufiger.
    expect(BOARD_SPALTEN).not.toContain('CANCELLED');
    expect(BOARD_SPALTEN).toEqual(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
  });

  it('kennt für jede Erinnerungsart einen Vorlauf', () => {
    // `NONE` ist `null` - kein Vorlauf von null Tagen, sondern gar keine
    // Erinnerung. Die Unterscheidung trägt den Reminder-Job.
    expect(ERINNERUNG_TAGE.NONE).toBeNull();
    expect(ERINNERUNG_TAGE.ON_DUE_DATE).toBe(0);
    expect(ERINNERUNG_TAGE.ONE_WEEK).toBe(7);
  });
});
