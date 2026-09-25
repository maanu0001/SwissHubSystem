import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTROLLER_OPERATIONEN } from '../../packages/modules/src/backup/typen';
import { ZEITPUNKT_MUSTER } from '../../packages/modules/src/backup/controller';

/**
 * Die Sicherheitsgrenze zwischen WebApp und Backup-Werkzeugen.
 *
 * ==========================================================================
 * WAS HIER GEPRUEFT WIRD
 * ==========================================================================
 *
 * Der Controller ist die einzige Stelle, an der eine Anforderung der WebApp zu
 * einer Ausfuehrung wird. Er ist damit die Grenze, und eine Grenze, die
 * niemand angreift, ist eine Annahme.
 *
 * Die Tests unten versuchen, sie zu ueberschreiten: ein Shell-Befehl als
 * Operation, ein Befehl im Zeitfeld, ein produktiver Restore, eine
 * Pfaddurchquerung in der Kennung. Jeder Versuch muss abgelehnt werden - und
 * zwar mit einem Grund, den das Dashboard anzeigen kann.
 *
 * Und sie pruefen die Doppelung: die Liste der Operationen steht sowohl im
 * Controller (Python) als auch in `typen.ts` (TypeScript). Laufen die beiden
 * auseinander, bietet das Dashboard einen Knopf, der nichts tut - oder
 * schlimmer: eine Operation fehlt in der Liste des Controllers und wird
 * abgelehnt, waehrend die WebApp «angefordert» meldet.
 * ==========================================================================
 */

const CONTROLLER = join(process.cwd(), 'deploy/backup/bin/swisshub-backup-controller');

let wurzel: string;
let konfiguration: string;

/** Eine Wegwerf-Umgebung: eigene Konfiguration, eigener Eingang. */
beforeAll(() => {
  wurzel = mkdtempSync(join(tmpdir(), 'swisshub-controller-test-'));
  mkdirSync(join(wurzel, 'spool', 'eingang'), { recursive: true });
  mkdirSync(join(wurzel, 'spool', 'ergebnis'), { recursive: true });
  mkdirSync(join(wurzel, 'log'), { recursive: true });
  konfiguration = join(wurzel, 'swisshub-backup.env');
  writeFileSync(
    konfiguration,
    [
      `SWISSHUB_BACKUP_ROOT=${wurzel}`,
      'SWISSHUB_PG_MODE=host',
      'SWISSHUB_PGBACKREST_CIPHER_PASS=test-nur-zum-pruefen-kein-echtes-geheimnis',
      'SWISSHUB_RESTIC_PASSWORD=test-nur-zum-pruefen-kein-echtes-geheimnis',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterAll(() => {
  rmSync(wurzel, { recursive: true, force: true });
});

interface Antwort {
  status?: string;
  meldung?: string;
  operation?: string | null;
}

/**
 * Eine Anforderung ablegen und den Controller einmal laufen lassen.
 *
 * Es wird BEWUSST nicht geprueft, ob der Controller die Operation ausfuehren
 * konnte - die Werkzeuge sind in dieser Umgebung nicht eingerichtet. Geprueft
 * wird, WAS er annimmt und was er ablehnt.
 */
function stelleUndLese(dateiname: string, inhalt: unknown): Antwort {
  const eingang = join(wurzel, 'spool', 'eingang');
  const ergebnisDir = join(wurzel, 'spool', 'ergebnis');

  for (const alt of readdirSync(ergebnisDir)) {
    rmSync(join(ergebnisDir, alt), { force: true });
  }

  writeFileSync(
    join(eingang, dateiname),
    typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt),
    'utf8',
  );

  try {
    execFileSync('python3', [CONTROLLER, '--einmal'], {
      encoding: 'utf8',
      env: { ...process.env, SWISSHUB_CONFIG_FILE: konfiguration },
      timeout: 30_000,
    });
  } catch {
    // Der Rueckgabewert interessiert nicht - die Antwort steht in der Datei.
  }

  const dateien = readdirSync(ergebnisDir).filter((name) => name.endsWith('.json'));
  if (dateien.length === 0) {
    return {};
  }
  return JSON.parse(readFileSync(join(ergebnisDir, dateien[0] as string), 'utf8')) as Antwort;
}

describe('Controller: die Liste der Operationen', () => {
  it('stimmt mit der Liste in typen.ts ueberein', () => {
    /*
     * Die Doppelung, die auseinanderlaufen koennte.
     *
     * Der Controller kennt seine Liste selbst und gibt sie auf Wunsch aus.
     * Gefragt wird er hier - statt sie aus seinem Quelltext zu lesen: eine
     * Musterpruefung ueber Python-Code wuerde bei einer harmlosen Umformatierung
     * brechen und dabei nichts Echtes pruefen.
     */
    const ausgabe = execFileSync('python3', [CONTROLLER, '--operationen'], {
      encoding: 'utf8',
      env: { ...process.env, SWISSHUB_CONFIG_FILE: konfiguration },
    });
    const vomController = Object.keys(JSON.parse(ausgabe) as Record<string, unknown>).sort();
    expect(vomController).toEqual([...CONTROLLER_OPERATIONEN].sort());
  });

  it('kennt keine Operation, die die Produktion anfasst', () => {
    /*
     * Die wichtigste Zusicherung des ganzen Entwurfs.
     *
     * Ein produktiver Restore darf von der WebApp aus nicht ausloesbar sein -
     * auch nicht, wenn jemand sie vollstaendig uebernimmt. Das ist nur dann
     * wahr, wenn die Operation in der Liste des Controllers NICHT existiert.
     * Sobald jemand sie einmal ergaenzt, faellt dieser Test.
     */
    const ausgabe = execFileSync('python3', [CONTROLLER, '--operationen'], {
      encoding: 'utf8',
      env: { ...process.env, SWISSHUB_CONFIG_FILE: konfiguration },
    });
    const namen = Object.keys(JSON.parse(ausgabe) as Record<string, unknown>);

    for (const verboten of [
      'wiederherstellen',
      'restore',
      'restore-produktiv',
      'freigeben',
      'aufraeumen',
      'einrichten',
      'konfiguration-schreiben',
    ]) {
      expect(namen, `«${verboten}» darf von der WebApp aus nicht ausloesbar sein`).not.toContain(verboten);
    }
  });

  it('nimmt einen Zeitpunkt nur bei den zwei Operationen an, die einen brauchen', () => {
    const ausgabe = execFileSync('python3', [CONTROLLER, '--operationen'], {
      encoding: 'utf8',
      env: { ...process.env, SWISSHUB_CONFIG_FILE: konfiguration },
    });
    const liste = JSON.parse(ausgabe) as Record<string, { nimmt_zeitpunkt: boolean }>;
    const mitZeitpunkt = Object.entries(liste)
      .filter(([, eintrag]) => eintrag.nimmt_zeitpunkt)
      .map(([name]) => name)
      .sort();
    expect(mitZeitpunkt).toEqual(['restore-probelauf', 'restore-test']);
  });
});

describe('Controller: Angriffsversuche', () => {
  it.each([
    ['ein Shell-Befehl als Operation', 'a1111111.json', { operation: 'bash -c "rm -rf /"' }],
    [
      'ein Semikolon im Zeitfeld',
      'a2222222.json',
      { operation: 'restore-test', zeitpunkt: '2026-01-01 00:00:00; rm -rf /' },
    ],
    [
      'Rueckwaerts-Anfuehrungszeichen im Zeitfeld',
      'a3333333.json',
      { operation: 'restore-test', zeitpunkt: '`id`' },
    ],
    [
      'eine Befehlssubstitution im Zeitfeld',
      'a4444444.json',
      { operation: 'restore-probelauf', zeitpunkt: '$(whoami)' },
    ],
    [
      'ein produktiver Restore',
      'a5555555.json',
      { operation: 'wiederherstellen', zeitpunkt: '2026-01-01 00:00:00' },
    ],
    ['eine unbekannte Operation', 'a6666666.json', { operation: 'aufraeumen' }],
    ['kein JSON-Objekt', 'a7777777.json', ['status']],
    ['eine leere Operation', 'a8888888.json', { operation: '' }],
    ['eine Operation als Zahl', 'a9999999.json', { operation: 42 }],
    [
      'ein ueberlanger Zeitpunkt',
      'b1111111.json',
      { operation: 'restore-test', zeitpunkt: '2026-01-01 00:00:00'.repeat(5) },
    ],
  ])('lehnt %s ab', (_name, dateiname, inhalt) => {
    const antwort = stelleUndLese(dateiname as string, inhalt);
    expect(antwort.status, JSON.stringify(antwort)).toBe('abgelehnt');
    // Mit Grund. Eine stille Ablehnung waere im Dashboard nicht zu deuten.
    expect(antwort.meldung ?? '').not.toBe('');
  });

  it('lehnt eine Datei ab, die kein JSON ist', () => {
    const antwort = stelleUndLese('b2222222.json', 'das ist kein json {{{');
    expect(antwort.status).toBe('abgelehnt');
    expect(antwort.meldung).toContain('JSON');
  });

  it('lehnt eine zu kurze Kennung ab', () => {
    // Die Kennung wird der Dateiname des Ergebnisses. Ein enges Muster darauf
    // ist der Grund, weshalb daraus kein Pfad werden kann.
    const antwort = stelleUndLese('ab.json', { operation: 'status' });
    expect(antwort.status).toBe('abgelehnt');
    expect(antwort.meldung).toContain('Muster');
  });

  it('lehnt eine Kennung mit Sonderzeichen ab', () => {
    const antwort = stelleUndLese('a..b..c..d.json', { operation: 'status' });
    expect(antwort.status).toBe('abgelehnt');
  });

  it('raeumt die Anforderung in jedem Fall aus dem Eingang', () => {
    /*
     * Sonst liefe sie beim naechsten Durchgang erneut.
     *
     * Bei einer abgelehnten waere das Laerm; bei einer angenommenen, die den
     * Controller waehrend der Ausfuehrung sterben liesse, waere es eine
     * Endlosschleife - und ein Backup, das in einer Endlosschleife startet,
     * fuellt das Laufwerk.
     */
    stelleUndLese('b3333333.json', { operation: 'nicht-vorhanden' });
    const eingang = readdirSync(join(wurzel, 'spool', 'eingang'));
    expect(eingang).toEqual([]);
  });
});

describe('Controller: gueltige Anforderungen', () => {
  it('nimmt einen gueltigen Zeitpunkt an', () => {
    const antwort = stelleUndLese('c1111111.json', {
      operation: 'restore-test',
      zeitpunkt: '2026-09-25 14:30:00+02',
      angefordert_von: '100000000000000001',
    });
    // Nicht «erfolg»: die Werkzeuge sind in dieser Wegwerf-Umgebung nicht
    // eingerichtet. Geprueft wird, dass sie nicht ABGELEHNT wurde.
    expect(antwort.status, JSON.stringify(antwort)).not.toBe('abgelehnt');
    expect(antwort.operation).toBe('restore-test');
  });

  it('nimmt eine Operation ohne Zeitpunkt an', () => {
    const antwort = stelleUndLese('c2222222.json', { operation: 'status' });
    expect(antwort.status).not.toBe('abgelehnt');
  });

  it('gibt kein Feld der Anforderung in die Umgebung weiter', () => {
    /*
     * Ein Feld, das zu einer Umgebungsvariablen wird, ist ein Weg, das
     * Verhalten eines Programms zu aendern, ohne einen Befehl zu brauchen -
     * LD_PRELOAD ist der bekannteste davon.
     *
     * Geprueft wird das am Quelltext, weil sich das Gegenteil nicht
     * beobachten laesst: der Controller baut seine Umgebung aus `os.environ`
     * und setzt genau eine Variable.
     */
    const quelltext = readFileSync(CONTROLLER, 'utf8');
    expect(quelltext).toContain('umgebung = dict(os.environ)');
    expect(quelltext).toContain('umgebung["SWISSHUB_CONFIG_FILE"]');
    // Und keine Schleife, die Felder der Anforderung in die Umgebung schreibt.
    expect(quelltext).not.toMatch(/umgebung\[[^\]]*\]\s*=\s*anforderung/u);
  });

  it('ruft niemals eine Shell', () => {
    /*
     * Geprueft wird der CODE, nicht die Kommentare.
     *
     * Ohne diese Unterscheidung faellt der Test an seinem eigenen Gegenstand:
     * der Controller erklaert in einem Kommentar, dass er `shell=True` niemals
     * verwendet - und eine Suche ueber den ganzen Text findet genau diese
     * Erklaerung. Ein Test, der am Kommentar scheitert, der ihn beschreibt,
     * prueft nichts.
     */
    const roh = readFileSync(CONTROLLER, 'utf8');
    const ohneKommentare = roh
      .split('\n')
      .filter((zeile) => !zeile.trim().startsWith('#'))
      .join('\n')
      // Docstrings mit drei Anfuehrungszeichen ebenso.
      .replace(/"""[\s\S]*?"""/gu, '');

    expect(ohneKommentare).toContain('shell=False');
    expect(ohneKommentare).not.toMatch(/shell\s*=\s*True/u);
    expect(ohneKommentare).not.toContain('os.system');
    expect(ohneKommentare).not.toContain('os.popen');
    // Und kein `eval`/`exec` auf etwas aus der Anforderung.
    expect(ohneKommentare).not.toMatch(/\beval\(/u);
    expect(ohneKommentare).not.toMatch(/\bexec\(/u);
  });
});

describe('Das Muster fuer Zeitpunkte', () => {
  it.each([
    '2026-09-25 14:30:00+02',
    '2026-09-25T14:30:00+02:00',
    '2026-09-25 14:30',
    '2026-09-25 14:30:00',
    '2026-09-25 14:30:00.123456+00',
    '2026-09-25T14:30:00Z',
  ])('nimmt «%s» an', (wert) => {
    expect(ZEITPUNKT_MUSTER.test(wert)).toBe(true);
  });

  it.each([
    '2026-09-25 14:30:00; rm -rf /',
    '`id`',
    '$(whoami)',
    "2026-09-25' OR '1'='1",
    'now()',
    '',
    '2026-09-25 14:30:00 && curl boese.example',
    '../../etc/passwd',
  ])('lehnt «%s» ab', (wert) => {
    expect(ZEITPUNKT_MUSTER.test(wert)).toBe(false);
  });
});
