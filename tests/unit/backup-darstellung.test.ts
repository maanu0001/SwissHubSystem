import { describe, expect, it } from 'vitest';

import { istAnsteuerbar, passendeDateisicherung } from '../../packages/modules/src/backup/zustand';
// Der Typ steht in `typen.ts`; `zustand.ts` verwendet ihn nur.
import type { Wiederherstellungspunkt } from '../../packages/modules/src/backup/typen';
import {
  bytesLesbar,
  dauerLesbar,
  repoLabel,
  rpoLesbar,
  vorWieLange,
  zeitFuerBefehl,
} from '../../apps/web/src/modules/backup/darstellung';

function punkt(teil: Partial<Wiederherstellungspunkt>): Wiederherstellungspunkt {
  return {
    art: 'datenbank',
    typ: 'full',
    kennung: 'x',
    beginn: null,
    ende: null,
    bytes: null,
    repo: 1,
    verschluesselt: true,
    ...teil,
  };
}

/**
 * Der Bezug zwischen Dateien und Datenbank.
 *
 * ==========================================================================
 * DIE REGEL, UM DIE ES GEHT
 * ==========================================================================
 *
 * Die Uploads werden unter serverseitig erzeugten Namen genau einmal
 * geschrieben und danach nie geaendert. Daraus folgt:
 *
 *   Eine Dateisicherung, die NICHT AELTER ist als der Zielzeitpunkt der
 *   Datenbank, enthaelt jede Datei, auf die diese Datenbank verweist.
 *
 * Umgekehrt gilt es nicht. Eine aeltere Dateisicherung laesst Verweise ins
 * Leere zeigen - ein wiederhergestelltes Ticket mit einem Verlauf, den es
 * nicht mehr gibt. Ueberzaehlige Dateien sind dagegen harmlos: Waisen, die
 * nichts kaputt machen.
 *
 * Deshalb muss nicht eingefroren werden, und deshalb ist diese Auswahl der
 * Kern der Konsistenz. Ein Fehler hier ist kein Anzeigefehler, sondern
 * verlorene Anhaenge.
 * ==========================================================================
 */
describe('Passende Dateisicherung zu einem Datenbankstand', () => {
  const zielzeit = new Date('2026-09-25T12:00:00Z');

  it('nimmt eine Sicherung, die gleich alt ist', () => {
    const gewaehlt = passendeDateisicherung(
      [punkt({ art: 'dateien', kennung: 'gleich', beginn: '2026-09-25T12:00:00Z' })],
      zielzeit,
    );
    expect(gewaehlt?.kennung).toBe('gleich');
  });

  it('nimmt eine juengere Sicherung', () => {
    const gewaehlt = passendeDateisicherung(
      [punkt({ art: 'dateien', kennung: 'juenger', beginn: '2026-09-25T13:00:00Z' })],
      zielzeit,
    );
    expect(gewaehlt?.kennung).toBe('juenger');
  });

  it('nimmt KEINE aeltere Sicherung', () => {
    // Der wichtigste Fall. Eine aeltere Sicherung enthaelt nicht jede Datei,
    // auf die die wiederhergestellte Datenbank verweist - und die fehlenden
    // faende man erst, wenn jemand ein Ticket oeffnet.
    const gewaehlt = passendeDateisicherung(
      [punkt({ art: 'dateien', kennung: 'aelter', beginn: '2026-09-25T11:00:00Z' })],
      zielzeit,
    );
    expect(gewaehlt).toBeNull();
  });

  it('nimmt von mehreren geeigneten die AELTESTE', () => {
    // Die aelteste geeignete ist der genaueste Treffer: eine juengere enthaelt
    // zusaetzlich Dateien, die zum Zielzeitpunkt noch nicht existierten.
    const gewaehlt = passendeDateisicherung(
      [
        punkt({ art: 'dateien', kennung: 'spaet', beginn: '2026-09-25T18:00:00Z' }),
        punkt({ art: 'dateien', kennung: 'knapp', beginn: '2026-09-25T12:05:00Z' }),
        punkt({ art: 'dateien', kennung: 'mittig', beginn: '2026-09-25T15:00:00Z' }),
      ],
      zielzeit,
    );
    expect(gewaehlt?.kennung).toBe('knapp');
  });

  it('beachtet nur Dateisicherungen, keine Datenbankpunkte', () => {
    const gewaehlt = passendeDateisicherung(
      [punkt({ art: 'datenbank', kennung: 'db', beginn: '2026-09-25T13:00:00Z' })],
      zielzeit,
    );
    expect(gewaehlt).toBeNull();
  });

  it('ueberspringt einen Punkt mit unlesbarem Zeitstempel', () => {
    const gewaehlt = passendeDateisicherung(
      [
        punkt({ art: 'dateien', kennung: 'kaputt', beginn: 'kein-datum' }),
        punkt({ art: 'dateien', kennung: 'gut', beginn: '2026-09-25T13:00:00Z' }),
      ],
      zielzeit,
    );
    expect(gewaehlt?.kennung).toBe('gut');
  });

  it('gibt null zurueck, wenn es keine Dateisicherung gibt', () => {
    expect(passendeDateisicherung([], zielzeit)).toBeNull();
  });
});

/**
 * Welcher Zeitpunkt ansteuerbar ist.
 *
 * Erreichbar ist, was NACH dem Ende des aeltesten noch vorhandenen
 * Basis-Backups liegt - alles davor nicht, auch wenn WAL dafuer vorliegt. Die
 * Frage gehoert in die Oberflaeche und nicht in eine Fehlermeldung von
 * pgBackRest.
 */
describe('Ansteuerbarer Zeitraum', () => {
  const punkte = [
    punkt({ kennung: 'alt', ende: '2026-09-20T03:00:00Z' }),
    punkt({ kennung: 'neu', ende: '2026-09-25T03:00:00Z' }),
  ];

  it('erlaubt einen Zeitpunkt nach dem aeltesten Basis-Backup', () => {
    const befund = istAnsteuerbar(punkte, new Date('2026-09-22T12:00:00Z'));
    expect(befund.moeglich).toBe(true);
  });

  it('lehnt einen Zeitpunkt vor dem aeltesten Basis-Backup ab', () => {
    const befund = istAnsteuerbar(punkte, new Date('2026-09-19T12:00:00Z'));
    expect(befund.moeglich).toBe(false);
    expect(befund.grund).toContain('aeltesten Basis-Backups');
    // Und nennt, ab wann es geht - eine Ablehnung ohne Alternative ist eine
    // Sackgasse.
    expect(befund.frueheste?.toISOString()).toBe('2026-09-20T03:00:00.000Z');
  });

  it('lehnt einen Zeitpunkt in der Zukunft ab', () => {
    const befund = istAnsteuerbar(punkte, new Date(Date.now() + 86_400_000));
    expect(befund.moeglich).toBe(false);
    expect(befund.grund).toContain('Zukunft');
  });

  it('lehnt ohne Basis-Backup jeden Zeitpunkt ab', () => {
    const befund = istAnsteuerbar([], new Date('2026-09-22T12:00:00Z'));
    expect(befund.moeglich).toBe(false);
    expect(befund.grund).toContain('kein Basis-Backup');
  });

  it('beachtet nur Datenbankpunkte, nicht Dateisicherungen', () => {
    // Eine Dateisicherung von vorletzter Woche macht keinen Zeitpunkt
    // ansteuerbar - dafuer braucht es eine Datenbank.
    const befund = istAnsteuerbar(
      [punkt({ art: 'dateien', ende: '2026-09-01T00:00:00Z' })],
      new Date('2026-09-05T00:00:00Z'),
    );
    expect(befund.moeglich).toBe(false);
  });
});

describe('Darstellung', () => {
  it.each([
    [null, '–'],
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KiB'],
    [1024 * 1024 * 3.5, '3.5 MiB'],
    [1024 ** 3 * 42, '42 GiB'],
  ])('bytesLesbar(%s) = %s', (eingabe, erwartet) => {
    expect(bytesLesbar(eingabe as number | null)).toBe(erwartet);
  });

  it.each([
    [null, '–'],
    [5, '5 s'],
    [60, '1 min'],
    [90, '1 min 30 s'],
    [3600, '1 h 0 min'],
    [7860, '2 h 11 min'],
  ])('dauerLesbar(%s) = %s', (eingabe, erwartet) => {
    expect(dauerLesbar(eingabe as number | null)).toBe(erwartet);
  });

  it('nennt «nie», wenn nichts geschehen ist', () => {
    // Und nicht «vor 56 Jahren» oder eine leere Zelle. «nie» ist die Auskunft,
    // um die es geht.
    expect(vorWieLange(null)).toBe('nie');
    expect(vorWieLange(undefined)).toBe('nie');
  });

  it('nennt ein unlesbares Datum «unbekannt», statt zu rechnen', () => {
    expect(vorWieLange('kein-datum')).toBe('unbekannt');
  });

  it.each([
    [30, 'gerade eben'],
    [300, 'vor 5 min'],
    [7200, 'vor 2 Stunden'],
    [3600, 'vor 1 Stunde'],
    [172_800, 'vor 2 Tagen'],
    [86_400, 'vor 1 Tag'],
  ])('vorWieLange bei %s Sekunden = %s', (sekunden, erwartet) => {
    expect(vorWieLange(new Date(Date.now() - (sekunden as number) * 1000))).toBe(erwartet);
  });

  it('nennt ein nicht gemessenes RPO ausdruecklich «nicht gemessen»', () => {
    // Nicht «0 s» und nicht «–». Der Unterschied zwischen «gemessen: 0» und
    // «nie gemessen» ist der ganze Punkt: das eine ist eine Zusage, das andere
    // ihr Fehlen.
    expect(rpoLesbar(null)).toBe('nicht gemessen');
    expect(rpoLesbar(undefined)).toBe('nicht gemessen');
  });

  it.each([
    [45, '45 s'],
    [300, '5 min'],
    [10_800, '3.0 h'],
  ])('rpoLesbar(%s) = %s', (eingabe, erwartet) => {
    expect(rpoLesbar(eingabe as number)).toBe(erwartet);
  });

  it('unterscheidet «nur lokal» von «lokal und extern»', () => {
    // Der wichtigste Unterschied der ganzen Uebersicht: ein Punkt, der nur in
    // Repository 1 liegt, liegt auf demselben Rechner, der gesichert wird.
    expect(repoLabel(1)).toEqual({ text: 'nur lokal', extern: false });
    expect(repoLabel(2)).toEqual({ text: 'lokal und extern', extern: true });
    expect(repoLabel(null).extern).toBe(false);
    expect(repoLabel(undefined).extern).toBe(false);
  });

  it('erzeugt einen Zeitpunkt in der Form, die das Werkzeug versteht', async () => {
    /*
     * Der Wert wird im Recovery Center zum Kopieren angezeigt und landet in
     * `swisshub-recovery --zeit`. Er MUSS dem Muster entsprechen, das der
     * Controller und die Server Action zulassen - sonst kopiert jemand etwas,
     * das abgelehnt wird.
     */
    const { ZEITPUNKT_MUSTER } = await import('../../packages/modules/src/backup/controller');
    const erzeugt = zeitFuerBefehl(new Date('2026-09-25T14:30:00Z'));
    expect(erzeugt).toMatch(ZEITPUNKT_MUSTER);
    expect(erzeugt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u);
  });

  it('gibt fuer ein fehlendes Datum eine leere Zeichenkette', () => {
    expect(zeitFuerBefehl(null)).toBe('');
    expect(zeitFuerBefehl('kein-datum')).toBe('');
  });
});
