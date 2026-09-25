import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Die Pruefung der WAL-Kette - Stufe 4.
 *
 * ==========================================================================
 * WARUM DIESE PRUEFUNG EINEN EIGENEN TEST BRAUCHT
 * ==========================================================================
 *
 * Sie ist die wichtigste der vier Stufen und die, die am haeufigsten fehlt.
 * Ein Basis-Backup allein stellt genau einen Zeitpunkt her: den seines eigenen
 * Endes. Jeden anderen erreicht man nur, wenn die WAL-Segmente von diesem
 * Backup bis zum Ziel LUECKENLOS vorliegen. Fehlt eines in der Mitte, endet die
 * Wiederherstellung dort - und zwar ohne dass eine Uebersicht vorher etwas
 * gesagt haette. In jeder Liste sieht so ein Backup aus wie ein Backup.
 *
 * Und sie hatte einen Fehler, der genau in die falsche Richtung ging: die
 * Zuordnung Sicherung → WAL-Archiv war auf die ZEITLINIE geschluesselt statt
 * auf die DATENBANKHISTORIE. `archive[].id` ist «16-1», also
 * «<version>-<db-id>», und nicht «00000001». Der Vergleich traf deshalb nie zu,
 * und die Pruefung meldete eine unterbrochene Kette bei vollstaendig intakter
 * Kette.
 *
 * Ein Fehlalarm an dieser Stelle ist besonders teuer: er entwertet jede
 * weitere Meldung. Die Tests unten halten die richtige Zuordnung fest.
 * ==========================================================================
 */

const SKRIPT = join(process.cwd(), 'deploy/backup/lib/wal-kette.py');

interface Bericht {
  in_ordnung: string[];
  schwer: string[];
  archiv_spanne: Record<string, { von: string | null; bis: string | null; historie: string }>;
  ansteuerbar_ab: string | null;
}

function pruefe(info: unknown): Bericht {
  const ausgabe = execFileSync('python3', [SKRIPT], {
    input: JSON.stringify(info),
    encoding: 'utf8',
  });
  return JSON.parse(ausgabe) as Bericht;
}

/**
 * Die Form, die `pgbackrest --output=json info` wirklich hat.
 *
 * Abgeschrieben von einer echten Ausgabe von pgBackRest 2.50 - nicht erfunden.
 * Eine erfundene Form wuerde hier bestaetigen, dass der Code seine eigene
 * Annahme erfuellt.
 */
function stanza(teil: {
  backups: Array<{
    label: string;
    typ?: string;
    dbId?: number;
    start?: string | null;
    stop?: string | null;
    beginn?: number;
    ende?: number;
    prior?: string | null;
  }>;
  archive: Array<{ dbId: number; id?: string; min: string | null; max: string | null }>;
  status?: { code: number; message: string };
}): unknown[] {
  return [
    {
      name: 'swisshub',
      cipher: 'aes-256-cbc',
      status: teil.status ?? { code: 0, message: 'ok' },
      // Als Zeichenkette: die System-ID von PostgreSQL ist ein 64-Bit-Wert und
      // laege als JavaScript-Zahl jenseits der genauen Darstellung. Die
      // Pruefung liest sie nicht - sie stuende hier nur zur Vollstaendigkeit
      // der Form, und eine ungenaue Zahl waere dafuer der falsche Preis.
      db: [{ id: 1, 'repo-key': 1, 'system-id': '7689431505697216868', version: '16' }],
      archive: teil.archive.map((eintrag) => ({
        database: { id: eintrag.dbId, 'repo-key': 1 },
        id: eintrag.id ?? `16-${eintrag.dbId}`,
        min: eintrag.min,
        max: eintrag.max,
      })),
      backup: teil.backups.map((eintrag) => ({
        label: eintrag.label,
        type: eintrag.typ ?? 'full',
        database: { id: eintrag.dbId ?? 1, 'repo-key': 1 },
        archive: { start: eintrag.start ?? null, stop: eintrag.stop ?? null },
        timestamp: { start: eintrag.beginn ?? 1_790_335_290, stop: eintrag.ende ?? 1_790_335_293 },
        info: { delta: 3_828_208, size: 31_482_433, repository: { delta: 3_828_208, size: 3_828_208 } },
        prior: eintrag.prior ?? null,
        error: false,
      })),
    },
  ];
}

describe('Pruefung der WAL-Kette', () => {
  it('haelt eine vollstaendige Kette fuer vollstaendig', () => {
    /*
     * Der Fall, an dem der alte Fehler auffiel.
     *
     * `archive[].id` ist «16-1» und NICHT die Zeitlinie «00000001». Wer die
     * beiden verwechselt, findet nie eine Uebereinstimmung und meldet eine
     * Luecke, wo keine ist.
     */
    const bericht = pruefe(
      stanza({
        backups: [
          { label: '20260925-113343F', start: '00000001000000000000000A', stop: '00000001000000000000000A' },
        ],
        archive: [{ dbId: 1, min: '000000010000000000000001', max: '00000001000000000000000D' }],
      }),
    );
    expect(bericht.schwer, JSON.stringify(bericht)).toEqual([]);
    expect(bericht.in_ordnung).toHaveLength(1);
  });

  it('meldet eine Sicherung, deren Anfang im Archiv fehlt', () => {
    // Der Anfang der Kette fehlt - diese Sicherung ist nicht
    // wiederherstellbar, obwohl sie in jeder Liste steht.
    const bericht = pruefe(
      stanza({
        backups: [{ label: 'A', start: '000000010000000000000003', stop: '000000010000000000000005' }],
        archive: [{ dbId: 1, min: '000000010000000000000008', max: '00000001000000000000000F' }],
      }),
    );
    expect(bericht.schwer).toHaveLength(1);
    expect(bericht.schwer[0]).toContain('beginnt bei');
    expect(bericht.schwer[0]).toContain('nicht wiederherstellbar');
  });

  it('meldet eine Sicherung, deren Ende im Archiv fehlt', () => {
    const bericht = pruefe(
      stanza({
        backups: [{ label: 'A', start: '000000010000000000000003', stop: '00000001000000000000000F' }],
        archive: [{ dbId: 1, min: '000000010000000000000001', max: '000000010000000000000005' }],
      }),
    );
    expect(bericht.schwer).toHaveLength(1);
    expect(bericht.schwer[0]).toContain('endet bei');
  });

  it('meldet eine Sicherung ohne WAL-Spanne', () => {
    const bericht = pruefe(
      stanza({
        backups: [{ label: 'A', start: null, stop: null }],
        archive: [{ dbId: 1, min: '000000010000000000000001', max: '000000010000000000000005' }],
      }),
    );
    expect(bericht.schwer).toHaveLength(1);
    expect(bericht.schwer[0]).toContain('keine WAL-Spanne');
  });

  it('meldet eine Sicherung, fuer die es gar kein Archiv gibt', () => {
    const bericht = pruefe(
      stanza({
        backups: [
          { label: 'A', dbId: 2, start: '000000010000000000000003', stop: '000000010000000000000003' },
        ],
        archive: [{ dbId: 1, min: '000000010000000000000001', max: '000000010000000000000005' }],
      }),
    );
    expect(bericht.schwer).toHaveLength(1);
    expect(bericht.schwer[0]).toContain('kein WAL-Archiv');
  });

  it('ordnet zwei Datenbankhistorien getrennt zu', () => {
    /*
     * Nach einer Wiederherstellung legt PostgreSQL eine neue Zeitlinie an, und
     * pgBackRest fuehrt dafuer eine neue Datenbankhistorie. Beide muessen
     * getrennt geprueft werden - sonst gilt das Archiv der einen als Beleg fuer
     * die andere.
     */
    const bericht = pruefe(
      stanza({
        backups: [
          { label: 'alt', dbId: 1, start: '000000010000000000000003', stop: '000000010000000000000003' },
          { label: 'neu', dbId: 2, start: '000000020000000000000007', stop: '000000020000000000000007' },
        ],
        archive: [
          { dbId: 1, min: '000000010000000000000001', max: '000000010000000000000005' },
          { dbId: 2, min: '000000020000000000000006', max: '00000002000000000000000A' },
        ],
      }),
    );
    expect(bericht.schwer, JSON.stringify(bericht)).toEqual([]);
    expect(bericht.in_ordnung).toHaveLength(2);
  });

  it('gibt den Zeitpunkt an, ab dem etwas ansteuerbar ist', () => {
    // Erreichbar ist, was NACH dem Ende des aeltesten Basis-Backups liegt.
    const bericht = pruefe(
      stanza({
        backups: [
          {
            label: 'alt',
            ende: 1_790_000_000,
            start: '000000010000000000000003',
            stop: '000000010000000000000003',
          },
          {
            label: 'neu',
            ende: 1_790_300_000,
            start: '000000010000000000000004',
            stop: '000000010000000000000004',
          },
        ],
        archive: [{ dbId: 1, min: '000000010000000000000001', max: '000000010000000000000009' }],
      }),
    );
    // Verglichen wird der ZEITPUNKT und nicht seine Schreibweise: Python
    // schreibt «+00:00» und laesst Millisekunden weg, JavaScript schreibt «Z»
    // und setzt sie. Ein Test auf die Zeichenkette prueefte die Schreibweise
    // zweier Sprachen und nicht die Rechnung.
    expect(new Date(bericht.ansteuerbar_ab as string).getTime()).toBe(1_790_000_000 * 1000);
  });

  it('gibt einen Fehlerzustand der Stanza weiter', () => {
    const bericht = pruefe(
      stanza({
        backups: [],
        archive: [],
        status: { code: 2, message: 'no valid backups' },
      }),
    );
    expect(bericht.schwer).toHaveLength(1);
    expect(bericht.schwer[0]).toContain('no valid backups');
  });

  it('meldet unlesbares JSON als schweren Befund - nicht als «alles gut»', () => {
    /*
     * Die Richtung, in die der Fehler gehen muss.
     *
     * Eine Pruefung, die bei unlesbarer Eingabe «keine Beanstandung» sagt, ist
     * schlimmer als keine: sie erzeugt einen gruenen Haken aus einem Fehler.
     */
    let ausgabe = '';
    try {
      ausgabe = execFileSync('python3', [SKRIPT], { input: 'kein json', encoding: 'utf8' });
    } catch (fehler) {
      ausgabe = String((fehler as { stdout?: string }).stdout ?? '');
    }
    const bericht = JSON.parse(ausgabe) as Bericht;
    expect(bericht.schwer.length).toBeGreaterThan(0);
    expect(bericht.in_ordnung).toEqual([]);
  });

  it('kommt mit einer leeren Stanza-Liste zurecht', () => {
    const bericht = pruefe([]);
    expect(bericht.schwer).toEqual([]);
    expect(bericht.in_ordnung).toEqual([]);
    expect(bericht.ansteuerbar_ab).toBeNull();
  });
});

/**
 * Der Bezug zwischen Dateien und Datenbank - dieselbe Regel, auf der
 * Python-Seite.
 *
 * Sie steht zweimal: in `zustand.ts` fuer das Dashboard und in
 * `datei-bezug.py` fuer die Pruefung, die ohne Node laufen muss. Beide muessen
 * dasselbe sagen.
 */
describe('Bezug zwischen Dateisicherung und Datenbank', () => {
  const BEZUG = join(process.cwd(), 'deploy/backup/lib/datei-bezug.py');

  function bezug(snapshots: unknown[], punkte: unknown): string {
    return execFileSync('python3', [BEZUG, JSON.stringify(punkte)], {
      input: JSON.stringify(snapshots),
      encoding: 'utf8',
    }).trim();
  }

  const datenbankPunkt = (ende: string) => ({ art: 'datenbank', kennung: 'db', ende });
  const snapshot = (zeit: string) => ({ short_id: 'abcd1234', time: zeit, tags: ['uploads'] });

  it('nennt es stimmig, wenn die Dateisicherung juenger ist', () => {
    expect(
      bezug([snapshot('2026-09-25T13:00:00Z')], { punkte: [datenbankPunkt('2026-09-25T12:00:00Z')] }),
    ).toBe('stimmig');
  });

  it('nennt es stimmig, wenn sie gleich alt ist', () => {
    expect(
      bezug([snapshot('2026-09-25T12:00:00Z')], { punkte: [datenbankPunkt('2026-09-25T12:00:00Z')] }),
    ).toBe('stimmig');
  });

  it('meldet den Punkt, zu dem nur eine AELTERE Dateisicherung vorliegt', () => {
    // Eine Wiederherstellung auf diesen Punkt hinterliesse Verweise auf
    // Dateien, die in keiner Sicherung stehen.
    const ergebnis = bezug([snapshot('2026-09-25T11:00:00Z')], {
      punkte: [datenbankPunkt('2026-09-25T12:00:00Z')],
    });
    expect(ergebnis).toContain('ohne-passende-dateien');
    expect(ergebnis).toContain('db');
  });

  it('meldet, wenn es gar keine Dateisicherung gibt', () => {
    expect(bezug([], { punkte: [datenbankPunkt('2026-09-25T12:00:00Z')] })).toBe('keine-dateisicherung');
  });

  it('beachtet nur Snapshots mit der Marke «uploads»', () => {
    // Ein Konfigurations-Snapshot ist keine Dateisicherung der Uploads.
    const ergebnis = bezug([{ short_id: 'k', time: '2026-09-25T13:00:00Z', tags: ['konfiguration'] }], {
      punkte: [datenbankPunkt('2026-09-25T12:00:00Z')],
    });
    expect(ergebnis).toBe('keine-dateisicherung');
  });

  it('kommt mit unlesbarer Eingabe zurecht, ohne «stimmig» zu behaupten', () => {
    let ausgabe = '';
    try {
      ausgabe = execFileSync('python3', [BEZUG, '{}'], { input: 'kein json', encoding: 'utf8' });
    } catch (fehler) {
      ausgabe = String((fehler as { stdout?: string }).stdout ?? '');
    }
    expect(ausgabe.trim()).toBe('unbekannt');
  });
});
