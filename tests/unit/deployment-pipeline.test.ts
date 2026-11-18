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
/**
 * Der Client darf nie neuer sein als der Server.
 *
 * Gemeldet hat das die Pipeline selbst, und zwar ohne eine Codeaenderung:
 * `postgresql-client` ohne Versionsnummer zog auf dem Runner irgendwann 18.7,
 * waehrend Dienst und Produktion auf PostgreSQL 16 laufen. Ein `pg_dump` 18
 * schreibt `SET transaction_timeout = 0;` in den Export - ein Parameter, den
 * es erst ab PostgreSQL 17 gibt -, und `psql -v ON_ERROR_STOP=1` brach beim
 * Einspielen daran ab:
 *
 *     ERROR: unrecognized configuration parameter "transaction_timeout"
 *
 * Der Restore-Test wurde rot und hatte recht: ein Export, der sich nicht
 * einspielen laesst, ist keine Sicherung. Exporte sind vorwaerts
 * vertraeglich, nicht rueckwaerts.
 *
 * Diese Pruefung haelt die drei Zahlen zusammen, die auseinanderlaufen
 * koennen: die Hauptversion in der Produktion, die im Testdienst und die des
 * Clients, den die Pipeline installiert.
 */
describe('PostgreSQL: Server und Client in derselben Hauptversion', () => {
  /** `image: postgres:16-alpine` -> alle Hauptversionen, die dort stehen. */
  function hauptversionen(quelle: string): string[] {
    return [...quelle.matchAll(/postgres:(\d+)-/gu)].map((treffer) => treffer[1] ?? '');
  }

  const produktion = hauptversionen(compose);
  const pipeline = hauptversionen(workflow);

  it('nennt ueberhaupt eine Fassung', () => {
    // Die Gegenprobe zu den beiden Pruefungen darunter: ohne Treffer waere
    // ein Vergleich zweier leerer Listen gruen und wertlos.
    expect(produktion.length, 'Kein postgres-Abbild in docker-compose.prod.yml').toBeGreaterThan(0);
    expect(pipeline.length, 'Kein postgres-Abbild im Workflow').toBeGreaterThan(0);
  });

  it('prueft gegen dieselbe Fassung, die in der Produktion laeuft', () => {
    /*
     * Ein Testdienst mit einer anderen Hauptversion prueft die Migrationen
     * gegen eine Datenbank, die es nicht gibt - und ein Fehler, der nur in
     * einer der beiden auftritt, faellt genau dort auf, wo niemand mehr
     * eingreifen kann.
     */
    expect(new Set([...produktion, ...pipeline]).size, `Produktion ${produktion}, Pipeline ${pipeline}`).toBe(
      1,
    );
  });

  it('holt die Client-Werkzeuge aus demselben Abbild und nicht aus apt', () => {
    /*
     * Zweimal gescheitert, bevor es so stand, und beide Male hatte der
     * Restore-Test recht:
     *
     * 1. `postgresql-client` ohne Zahl zog 18.7 gegen einen Server 16. Ein
     *    pg_dump 18 schreibt `SET transaction_timeout = 0;` in den Export -
     *    ein Parameter ab PostgreSQL 17 -, und `psql -v ON_ERROR_STOP=1`
     *    brach beim Einspielen daran ab.
     * 2. `postgresql-client-16` gibt es auf Ubuntu 26.04 nicht. Die Fassung
     *    festzunageln half also nicht - das Paket muss es auch geben.
     *
     * Aus dem Abbild des Dienstes gibt es die Frage nicht mehr, und es ist
     * derselbe Weg wie in der Produktion: dort laeuft `pg_dump` im
     * Postgres-Container.
     */
    const installiert = workflow
      .split('\n')
      .filter((zeile) => /apt-get install/u.test(zeile) && /postgresql-client/u.test(zeile));
    expect(installiert, 'postgresql-client gehoert nicht mehr aus apt').toEqual([]);

    expect(workflow).toContain('ABBILD=postgres:');
    expect(workflow).toMatch(/docker run --rm -i --network host/u);
    for (const werkzeug of ['pg_dump', 'psql', 'createdb', 'dropdb']) {
      expect(workflow, `Huelle fuer ${werkzeug} fehlt`).toContain(werkzeug);
    }
  });

  it('bricht ab, wenn Client und Server doch auseinanderlaufen', () => {
    /*
     * Der Rueckhalt, der beide Ausfaelle oben an derselben Stelle gefangen
     * haette: die Pipeline scheitert dann mit einem Satz, statt irgendwo in
     * einer Wiederherstellung.
     */
    expect(workflow).toContain('passt nicht zum Server');
    expect(workflow).toMatch(/if \[ "\$client" != "\$server" \]; then/u);
    expect(workflow).toContain("SELECT current_setting('server_version_num')::int / 10000");
  });
});

describe('Sicherung', () => {
  /*
   * Das Skript liegt jetzt in `deploy/backup/`; `deploy/backup.sh` ist eine
   * Weiterleitung, damit ein bestehender Cron-Eintrag nicht ins Leere faellt.
   * Die Zusage dieser Pruefungen ist dieselbe wie vorher: die Dateien gehoeren
   * dazu, und niemand darf still nur die Datenbank sichern.
   */
  const skript = readFileSync(join(process.cwd(), 'deploy/backup/bin/swisshub-backup'), 'utf8');
  // Die Konfiguration steht in der gemeinsamen Bibliothek, das Archivieren im
  // Skript - beide Haelften gehoeren zur Zusage.
  const bibliothek = readFileSync(join(process.cwd(), 'deploy/backup/lib/gemeinsam.sh'), 'utf8');
  const weiterleitung = readFileSync(join(process.cwd(), 'deploy/backup.sh'), 'utf8');

  it('sichert das Upload-Verzeichnis', () => {
    expect(bibliothek).toContain('SWISSHUB_UPLOAD_DIR');
    expect(skript).toMatch(/tar -czf .* -C "\$\{UPLOAD_DIR\}" \./u);
    // Dasselbe Verzeichnis, das die WebApp beschreibt.
    const compose = readFileSync(join(process.cwd(), 'docker-compose.prod.yml'), 'utf8');
    expect(compose).toContain('SWISSHUB_UPLOAD_DIR: /var/lib/swisshub/uploads');
    expect(bibliothek).toContain('/var/lib/swisshub/uploads');
  });

  it('laesst die Dateien nicht still weg', () => {
    /*
     * Der Fehler, gegen den die alte Pruefung stand, in seiner neuen Form: aus
     * einem Verzeichnis, das zu gross geworden ist, darf keine Sicherung
     * entstehen, die nur die Datenbank enthaelt und so aussieht wie eine
     * vollstaendige. Deshalb ein Abbruch mit eigenem Exit-Code.
     */
    expect(skript).toContain('CODE_DATEIEN');
    expect(skript).toMatch(/DATEIEN_MAX_MB/u);
    // Und wenn absichtlich nur die Datenbank gesichert wird, steht es im
    // Manifest - `typ=nur-datenbank`.
    expect(skript).toContain('nur-datenbank');
  });

  it('leitet den alten Aufruf auf das neue Skript', () => {
    expect(weiterleitung).toContain('backup/bin/swisshub-backup');
    expect(weiterleitung).toMatch(/^exec /mu);
  });

  it('behauptet in der Anleitung nicht mehr, ein Dump genuege', () => {
    const anleitung = readFileSync(join(process.cwd(), 'docs/DEPLOYMENT.md'), 'utf8');
    expect(anleitung).not.toMatch(/Dump\s*\ngen(ü|ue)gt als vollst(ä|ae)ndige Sicherung/u);
    // Die Anleitung muss weiterhin sagen, dass eine Sicherung mehr ist als die
    // Datenbank - und was sie ausdruecklich nicht mitbringt.
    expect(anleitung).toContain('Upload-Verzeichnisses');
    expect(anleitung).toContain('Zwei Dinge, die keine Sicherung mitbringt');
  });

  it('nennt in der Anleitung den Weg zur Wiederherstellung', () => {
    // Eine Sicherung ohne beschriebenen Rueckweg ist eine Sicherung, die im
    // Ernstfall niemand benutzt.
    const anleitung = readFileSync(join(process.cwd(), 'docs/DEPLOYMENT.md'), 'utf8');
    expect(anleitung).toContain('swisshub-recovery plan');
    expect(anleitung).toContain('--bestaetigen');
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

  /*
   * Die Luecke, die die drei Pruefungen darueber offen liessen.
   *
   * Sie alle lasen `deploy/nginx/system.swisshub.gg.conf` - eine Datei, die
   * **nie ausgespielt wurde**. Die Grenze stimmte darin seit Monaten, und
   * nginx lief die ganze Zeit mit seiner Vorgabe von 1 MB. Gemeldet wurde es
   * als «meine Bilder sind zu gross»; gemessen war es ein roher 413 der
   * Schicht davor.
   *
   * Ein Waechter, der eine Datei prueft, die niemand liest, ist schlimmer als
   * keiner: er sagt «stimmt», und es stimmt nur auf der Platte.
   */
  describe('Der Deploy spielt die Konfiguration auch aus', () => {
    const deploy = workflow;

    it('legt die Datei ab und verlinkt sie', () => {
      expect(deploy).toContain('/etc/nginx/sites-available/system.swisshub.gg.conf');
      expect(deploy).toContain('/etc/nginx/sites-enabled/system.swisshub.gg.conf');
      expect(deploy).toContain('deploy/nginx/system.swisshub.gg.conf');
      expect(deploy).toMatch(/sudo install .*"\$QUELLE" "\$ZIEL"/u);
      expect(deploy).toMatch(/sudo ln -sfn "\$ZIEL" "\$LINK"/u);
    });

    it('prueft mit nginx -t, bevor es neu laedt', () => {
      /*
       * Die Reihenfolge ist die ganze Sicherheit dieses Schritts. Ein Reload
       * vor dem Test koennte eine kaputte Konfiguration laden - und dann ist
       * die Seite weg, nicht nur der Upload.
       */
      const test = deploy.indexOf('sudo nginx -t');
      const reload = deploy.indexOf('sudo systemctl reload nginx');
      expect(test, 'nginx -t fehlt im Deploy').toBeGreaterThan(-1);
      expect(reload, 'Der Reload fehlt im Deploy').toBeGreaterThan(-1);
      expect(test).toBeLessThan(reload);
    });

    it('sichert die laufende Fassung und holt sie bei einem Fehler zurueck', () => {
      // Auf dem Server kann von Hand etwas stehen - certbot schreibt dort.
      expect(deploy).toMatch(/sudo cp -a "\$ZIEL" "\$sicherung"/u);
      expect(deploy).toMatch(/sudo cp -a "\$sicherung" "\$ZIEL"/u);
      // Und der Unterschied steht im Protokoll, statt lautlos zu geschehen.
      expect(deploy).toContain('sudo diff -u "$ZIEL" "$QUELLE"');
    });

    it('bricht ab, wenn zwei Dateien dieselbe Domain bedienen', () => {
      // Welcher Serverblock gilt, entscheidet sonst nginx.
      expect(deploy).toContain("grep -rl 'server_name[[:space:]]\\+system\\.swisshub\\.gg'");
    });

    it('prueft am Ende die Wirkung und nicht die Datei', () => {
      /*
       * Zwei Megabyte an einen Pfad, den es nicht gibt. Ein 413 darauf heisst:
       * die Grenze greift weiterhin nicht - genau der gemeldete Fehler. Ohne
       * diese Probe waere der Schritt darueber eine Datei, die ausgespielt
       * wurde, und keine Grenze, die gilt.
       */
      expect(deploy).toContain('2097152');
      expect(deploy).toMatch(/if \[ "\$status" = "413" \]; then/u);

      /*
       * Und der 413 ist nur dann ein Fehler, wenn die Konfiguration auch
       * gilt. Auf dem Server fehlt dem Deploy-Benutzer `sudo` ohne Passwort;
       * bis das jemand vergibt, ist der 413 die bekannte Folge davon und
       * keine Meldung ueber etwas, das dieser Lauf aendern koennte. Ein
       * harter Abbruch machte sonst **jedes** Deployment rot - auch die, bei
       * denen alles andere in Ordnung ist.
       */
      expect(deploy).toContain('NGINX_GEPFLEGT=nein');
      expect(deploy).toContain('NGINX_GEPFLEGT=ja');
      expect(deploy).toMatch(/if \[ "\$NGINX_GEPFLEGT" = "ja" \]; then\n\s*echo "FEHLER/u);
      // Und ohne die Berechtigung bricht 7b nicht ab, sondern sagt es.
      expect(deploy).toContain('WARNUNG: Die nginx-Konfiguration wurde NICHT ausgespielt.');
      expect(deploy).toContain('NOPASSWD:');
    });
  });
});
