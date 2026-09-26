import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LEBENSZEICHEN_DATEI } from '../../apps/bot/src/jobs';
import { MAX_LEGACY_DB_BYTES } from '../../packages/modules/src/level/import/reader';
import { VIDEO_MAX_BYTES_GRENZE } from '../../packages/modules/src/clips/video-speicher';

/**
 * Was die Deployment-Kette zusammenhaelt.
 *
 * Nach einem Deployment lief der Bot weiter auf dem alten Abbild: Compose
 * entscheidet selbst, ob ein Container ersetzt werden muss, und lag daneben.
 * Auffallen konnte das niemandem - ohne festen `image:`-Namen gibt es gar
 * nichts, womit sich das laufende Abbild mit dem eben gebauten vergleichen
 * liesse.
 *
 * Die Pipeline vergleicht jetzt genau das. Diese Pruefungen halten die
 * Voraussetzungen dafuer fest, denn jede einzelne davon faellt still aus:
 * ein fehlender `image:`-Name macht den Vergleich unmoeglich, ein
 * auseinandergelaufener Pfad des Lebenszeichens macht den Bot dauerhaft
 * krank, und ohne `SWISSHUB_TEST_DATABASE_URL` ueberspringen sich die
 * datenbankgestuetzten Tests selbst - gruen, ohne je gelaufen zu sein.
 */
const compose = readFileSync(join(process.cwd(), 'docker-compose.prod.yml'), 'utf8');
const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

/** Die Dienste des Produktions-Stacks samt ihrer eigenen Zeilen. */
function dienstBlock(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `Dienst ${name} fehlt in docker-compose.prod.yml`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const naechster = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/u);
  return naechster === -1 ? rest : rest.slice(0, naechster + 1);
}

/** Dienste, die die Pipeline baut - und deren Abbild sie danach vergleicht. */
const GEBAUT = ['migrate', 'web', 'bot', 'music-runtime'];

describe('Produktions-Compose', () => {
  it.each(GEBAUT)('gibt %s einen festen Abbildnamen', (dienst) => {
    const block = dienstBlock(dienst);
    expect(block, `${dienst} wird nicht gebaut`).toMatch(/^\s{4}build:$/mu);
    expect(
      block,
      `${dienst} hat keinen festen image:-Namen - die Pipeline kann nicht pruefen, ob der Container auf dem neuen Abbild laeuft`,
    ).toMatch(new RegExp(`^\\s{4}image: swisshub-${dienst}:latest$`, 'mu'));
  });

  it.each(['web', 'bot', 'music-runtime'])('gibt %s einen Gesundheitscheck', (dienst) => {
    expect(dienstBlock(dienst), `${dienst} hat keinen healthcheck - die Pipeline kann nur raten`).toMatch(
      /^\s{4}healthcheck:$/mu,
    );
  });

  it('prueft beim Bot dieselbe Datei, die der Bot schreibt', () => {
    // Laufen die beiden auseinander, findet der Check nie etwas Frisches und
    // der Bot gilt dauerhaft als krank - obwohl er tadellos arbeitet.
    expect(dienstBlock('bot')).toContain(LEBENSZEICHEN_DATEI);
  });

  it('laesst web, bot und music-runtime erst nach der Migration starten', () => {
    for (const dienst of ['web', 'bot', 'music-runtime']) {
      expect(dienstBlock(dienst), `${dienst} wartet nicht auf die Migration`).toContain(
        'service_completed_successfully',
      );
    }
  });
});

describe('Deployment-Workflow', () => {
  it('rollt nur nach bestandener Pruefung aus', () => {
    expect(workflow).toMatch(/^\s{4}needs: validate$/mu);
  });

  it.each([
    ['Lint', 'npm run lint'],
    ['Typecheck', 'npm run typecheck'],
    ['Tests', 'npm test'],
    ['Production-Build', 'npm run build'],
  ])('prueft %s vor dem Deployment', (_name, befehl) => {
    expect(workflow).toMatch(new RegExp(`^\\s+run: ${befehl.replace(/ /gu, ' ')}$`, 'mu'));
  });

  it('laesst die datenbankgestuetzten Tests nicht durchrutschen', () => {
    expect(workflow).toContain('SWISSHUB_TEST_DATABASE_URL:');
    expect(workflow).toContain('postgres:16-alpine');
  });

  it.each(GEBAUT.filter((dienst) => dienst !== 'migrate'))(
    'vergleicht nach dem Deployment das Abbild von %s',
    (dienst) => {
      expect(workflow).toMatch(new RegExp(`\\b${dienst}\\b`, 'u'));
    },
  );

  it('bricht bei Fehlern ab, statt einen kaputten Stand zu melden', () => {
    expect(workflow).toContain('set -euo pipefail');
    expect(workflow).toContain('script_stop: true');
    expect(workflow).toMatch(/^\s+exit 1$/mu);
  });
});

/**
 * Der Reverse Proxy und die Grenzen der Anwendung.
 *
 * nginx entscheidet vor der Anwendung. Steht `client_max_body_size` unter dem
 * groessten Upload, das SwissHub annimmt, bricht nginx die Uebertragung mit
 * **413** ab - und der Fehler sieht aus, als kaeme er von SwissHub. Der
 * Anwendung faellt nichts auf: sie hat die Datei nie gesehen.
 *
 * Genau das ist schon auseinandergelaufen. Die Konfiguration stand auf 72 MB,
 * die Anleitung sagte weiter 8 MB, und keine der beiden Zahlen war an das
 * Limit gebunden, das sie decken soll. Diese Pruefung bindet sie: wer
 * `MAX_LEGACY_DB_BYTES` anhebt, ohne den Proxy nachzuziehen, faellt hier auf.
 */
/**
 * Die Sicherung deckt auch die Dateien.
 *
 * ## Warum das geprueft wird
 *
 * Weil der Fehler unsichtbar ist. In der Anleitung stand jahrelang, ein
 * PostgreSQL-Dump genuege als vollstaendige Sicherung - und solange nur Logos
 * und Banner im Upload-Verzeichnis lagen, fiel es niemandem auf.
 *
 * Mit hochgeladenen Clips ergibt eine Wiederherstellung aus einem reinen Dump
 * eine Datenbank voller Clips ohne Dateien: die Ausliefer-Route antwortet mit
 * 404, die Hall of Fame zeigt schwarze Flaechen, und im Log steht nichts.
 * Gemerkt wird das beim Wiederherstellen - dem einen Moment, in dem man es
 * nicht mehr aendern kann.
 */
describe('Sicherung', () => {
  const skript = readFileSync(join(process.cwd(), 'deploy/backup.sh'), 'utf8');

  it('spiegelt das Upload-Verzeichnis', () => {
    expect(skript).toContain('SWISSHUB_UPLOAD_DIR');
    expect(skript).toMatch(/rsync -a --delete/u);
  });

  it('kommt auch ohne rsync zurecht', () => {
    // Nicht jede Installation hat es, und ein Skript, das dann still nur die
    // Datenbank sichert, waere schlimmer als eines, das abbricht.
    expect(skript).toMatch(/command -v rsync/u);
    expect(skript).toMatch(/cp -a -u/u);
  });

  it('behauptet in der Anleitung nicht mehr, ein Dump genuege', () => {
    const anleitung = readFileSync(join(process.cwd(), 'docs/DEPLOYMENT.md'), 'utf8');
    expect(anleitung).not.toMatch(/Dump\s*\ngen(ü|ue)gt als vollst(ä|ae)ndige Sicherung/u);
    expect(anleitung).toContain('Und die Dateien:');
  });
});

describe('Reverse Proxy und Upload-Limits', () => {
  const nginx = readFileSync(join(process.cwd(), 'deploy/nginx/system.swisshub.gg.conf'), 'utf8');

  /** `72m`, `72M` oder `73728k` - nginx nimmt alle drei. */
  function grenzeInBytes(quelle: string): number {
    const treffer = /client_max_body_size\s+(\d+)([kmg]?);/iu.exec(quelle);
    expect(treffer, 'client_max_body_size fehlt in der nginx-Konfiguration').not.toBeNull();
    const [, zahl = '0', einheit = ''] = treffer as RegExpExecArray;
    const faktor = { '': 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[einheit.toLowerCase()];
    return Number(zahl) * (faktor ?? 1);
  }

  it('laesst den groessten Upload der Anwendung durch', () => {
    expect(grenzeInBytes(nginx)).toBeGreaterThanOrEqual(MAX_LEGACY_DB_BYTES);
  });

  it('laesst eine hochgeladene Clipdatei bis zur Modulgrenze durch', () => {
    /*
     * Der Clip-Upload ist der einzige Endpunkt mit eigener Grenze: 500 MB
     * darf ein Administrator im Dashboard erlauben, und die globalen 72 MB
     * wuerden ihn bei 72 abschneiden - mit einem 413, das nach einem Fehler
     * von SwissHub aussieht.
     *
     * Geprueft wird der Block, nicht die Datei als Ganzes: ein
     * `client_max_body_size` irgendwo sonst wuerde diese Route nicht decken.
     */
    const block = /location\s*=\s*\/api\/clips\/upload\s*\{[\s\S]*?\n {4}\}/u.exec(nginx);
    expect(block, 'Kein eigener nginx-Block fuer /api/clips/upload').not.toBeNull();
    expect(grenzeInBytes(block![0])).toBeGreaterThanOrEqual(VIDEO_MAX_BYTES_GRENZE);
  });

  it('nennt in der Anleitung dieselbe Zahl wie die Konfiguration', () => {
    const anleitung = readFileSync(join(process.cwd(), 'docs/DEPLOYMENT.md'), 'utf8');
    const megabyte = Math.floor(grenzeInBytes(nginx) / (1024 * 1024));
    expect(
      anleitung,
      `DEPLOYMENT.md muss ${megabyte} MB nennen - die nginx-Konfiguration setzt das.`,
    ).toContain(`**${megabyte} MB**`);
  });
});
