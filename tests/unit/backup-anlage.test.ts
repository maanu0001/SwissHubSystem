import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONTROLLER_OPERATIONEN } from '../../packages/modules/src/backup/typen';
import { BACKUP_PERMISSIONS } from '../../packages/modules/src/backup/config';

/**
 * Was die Backup-Anlage zusammenhaelt.
 *
 * Dieselbe Sorte Pruefung wie `deployment-pipeline.test.ts`: jede Zusicherung
 * hier faellt still aus, wenn sie bricht. Eine fehlende Zeile in einer
 * systemd-Unit macht keinen Fehler - sie macht, dass etwas nicht passiert, und
 * das bemerkt man erst im Ernstfall.
 */

const BACKUP = join(process.cwd(), 'deploy/backup');
const BIN = join(BACKUP, 'bin');
const LIB = join(BACKUP, 'lib');
const SYSTEMD = join(BACKUP, 'systemd');

function lese(...teile: string[]): string {
  return readFileSync(join(...teile), 'utf8');
}

const WERKZEUGE = [
  'swisshub-backup',
  'swisshub-backup-verify',
  'swisshub-restore-test',
  'swisshub-recovery',
  'swisshub-secrets-seal',
  'swisshub-backup-monitor',
  'swisshub-backup-selbsttest',
  'swisshub-backup-controller',
];

describe('Die Werkzeuge', () => {
  it.each(WERKZEUGE)('%s ist vorhanden und ausfuehrbar', (name) => {
    const angaben = statSync(join(BIN, name));
    expect(angaben.isFile()).toBe(true);
    // 0o111: von irgendjemandem ausfuehrbar. Ohne das Bit laeuft die
    // systemd-Unit nicht, und der Fehler lautet «Permission denied».
    expect(angaben.mode & 0o111, `${name} ist nicht ausfuehrbar`).toBeGreaterThan(0);
  });

  it.each(WERKZEUGE.filter((name) => name !== 'swisshub-backup-controller'))(
    '%s ist syntaktisch gueltiges bash',
    (name) => {
      // `bash -n` liest, ohne auszufuehren. Ein Syntaxfehler in einem
      // Backup-Skript faellt sonst erst um drei Uhr nachts auf - und dann als
      // ausgebliebener Lauf, nicht als Fehlermeldung.
      expect(() => execFileSync('bash', ['-n', join(BIN, name)], { stdio: 'pipe' })).not.toThrow();
    },
  );

  it('der Controller ist syntaktisch gueltiges Python', () => {
    expect(() =>
      execFileSync(
        'python3',
        [
          '-c',
          'import ast,sys; ast.parse(open(sys.argv[1]).read())',
          join(BIN, 'swisshub-backup-controller'),
        ],
        {
          stdio: 'pipe',
        },
      ),
    ).not.toThrow();
  });

  it.each(readdirSync(LIB).filter((name) => name.endsWith('.py')))(
    'lib/%s ist syntaktisch gueltiges Python',
    (name) => {
      expect(() =>
        execFileSync(
          'python3',
          ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', join(LIB, name)],
          {
            stdio: 'pipe',
          },
        ),
      ).not.toThrow();
    },
  );

  it('die gemeinsame Bibliothek ist syntaktisch gueltiges bash', () => {
    expect(() => execFileSync('bash', ['-n', join(LIB, 'gemeinsam.sh')], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('Verdeckung von Geheimnissen', () => {
  const gemeinsam = lese(LIB, 'gemeinsam.sh');

  it('kennt jede Variable, die ein Geheimnis traegt', () => {
    /*
     * Die Liste ist der Grund, weshalb `verdecke` funktioniert.
     *
     * Sie muss vollstaendig sein - nicht gegen den eigenen `echo`, sondern
     * gegen pgBackRest und Restic: die geben im Fehlerfall ihre Aufrufe mit
     * aus, und darin steht dann eine Zugangskennung. Genau das ist der Fall,
     * gegen den die Funktion gebaut ist.
     */
    for (const name of [
      'SWISSHUB_PGBACKREST_CIPHER_PASS',
      'SWISSHUB_RESTIC_PASSWORD',
      'SWISSHUB_S3_WRITE_SECRET',
      'SWISSHUB_S3_WRITE_KEY_ID',
      'SWISSHUB_ALERT_SMTP_PASSWORD',
      'SWISSHUB_ALERT_WEBHOOK_URL',
      'SWISSHUB_ALERT_HEARTBEAT_URL',
      'MASTER_ENCRYPTION_KEY',
      'AUTH_SECRET',
      'POSTGRES_PASSWORD',
    ]) {
      expect(gemeinsam, `${name} fehlt in GEHEIME_VARIABLEN`).toContain(name);
    }
  });

  it('verdeckt jede Protokollzeile', () => {
    // `protokoll` ist der eine Weg, auf dem eine Zeile in das Log gelangt -
    // und sie geht durch `verdecke`. Ein zweiter Weg waere die Luecke.
    //
    // Geprueft wird die Kette und nicht ihre genaue Schreibweise: ein Muster
    // ueber jedes Zeichen des Aufrufs braeche bei jeder harmlosen Umformung und
    // prueefte dabei nichts Echtes.
    const protokollFunktion = gemeinsam.slice(
      gemeinsam.indexOf('protokoll() {'),
      gemeinsam.indexOf('info() {'),
    );
    expect(protokollFunktion).not.toBe('');
    // Jede Ausgabe dieser Funktion - auf die Fehlerausgabe und in die Datei -
    // laeuft durch `verdecke`.
    const ausgaben = [...protokollFunktion.matchAll(/printf[^\n]*\n/gu)].map((treffer) => treffer[0]);
    expect(ausgaben.length).toBeGreaterThan(1);
    for (const zeile of ausgaben) {
      expect(zeile, `Diese Ausgabe geht nicht durch verdecke: ${zeile}`).toContain('verdecke');
    }
  });

  it('verdeckt auch die Zustandsdateien, die die WebApp liest', () => {
    expect(gemeinsam).toMatch(/zustand_schreiben\(\)[\s\S]*?\| verdecke/u);
  });

  it('ersetzt nur Werte ab acht Zeichen', () => {
    // Ein dreistelliger Port als Suchmuster zerlegte jede Zeile, in der eine
    // Zahl vorkommt - und ein Protokoll voller ««SWISSHUB_PG_PORT»» ist
    // unlesbar.
    expect(gemeinsam).toContain('${#wert} -ge 8');
  });
});

describe('Die pgBackRest-Vorlage', () => {
  const vorlage = lese(BACKUP, 'vorlagen/pgbackrest.conf.vorlage');

  it('bindet die WAL-Aufbewahrung an die Basis-Backups', () => {
    /*
     * Die entscheidende Zeile der ganzen Konfiguration.
     *
     * Ohne `repo1-retention-archive-type=full` raeumt pgBackRest WAL nach
     * eigenem Ermessen auf und kann dabei genau die Kette zerreissen, die das
     * aelteste aufbewahrte Vollbackup braucht. Das Backup waere dann noch da
     * und trotzdem unbrauchbar - der schlimmste aller Zustaende, weil er wie
     * Sicherheit aussieht.
     */
    expect(vorlage).toContain('repo1-retention-archive-type=full');
  });

  it('verschluesselt auch das lokale Repository', () => {
    // Eine Datenbanksicherung ist eine vollstaendige Kopie aller
    // Personendaten. Unverschluesselt auf demselben Laufwerk waere sie fuer
    // jeden lesbar, der irgendwie Dateizugriff erlangt - eine niedrigere
    // Huerde als der Datenbankzugang.
    expect(vorlage).toContain('repo1-cipher-type=aes-256-cbc');
  });

  it('archiviert asynchron', () => {
    // Synchron wartet PostgreSQLs Archivierungsprozess auf jede WAL-Datei, und
    // bei langsamer Verbindung staut sich pg_wal, bis die Platte voll ist.
    expect(vorlage).toContain('archive-async=y');
    expect(vorlage).toContain('spool-path=');
  });

  it('prueft Pruefsummen auf Seitenebene', () => {
    expect(vorlage).toContain('checksum-page=y');
  });

  it('erzwingt einen Checkpoint, statt auf den naechsten zu warten', () => {
    expect(vorlage).toContain('start-fast=y');
  });

  it('nennt jeden Platzhalter, den der Erzeuger ersetzt', () => {
    // Ein Platzhalter, der in der Vorlage fehlt, laesst den Wert leer - und
    // pgBackRest scheitert dann mit einer Meldung ueber eine fehlende Option.
    for (const platzhalter of [
      '@PGBACKREST_REPO@',
      '@PGBACKREST_CIPHER_PASS@',
      '@BACKUP_ROOT@',
      '@RETENTION_FULL@',
      '@RETENTION_DIFF@',
      '@PGBACKREST_PROCESSES@',
      '@PG_DATA@',
      '@PG_PORT@',
      '@PG_USER@',
      '@S3_BLOCK@',
    ]) {
      expect(vorlage, `${platzhalter} fehlt`).toContain(platzhalter);
    }
  });

  it('der Erzeuger ersetzt jeden Platzhalter der Vorlage', () => {
    // Der Erzeuger steht in der Bibliothek, nicht im Backup-Werkzeug: die
    // Wiederherstellung braucht ihn auch, denn das versiegelte Paket enthaelt
    // keine pgbackrest.conf.
    const erzeuger = lese(LIB, 'gemeinsam.sh');
    const platzhalter = [...vorlage.matchAll(/@([A-Z0-9_]+)@/gu)].map((treffer) => treffer[0]);
    for (const einzeln of new Set(platzhalter)) {
      expect(erzeuger, `${einzeln} wird nicht ersetzt`).toContain(einzeln);
    }
  });

  it('der S3-Block nennt keine Loeschrechte', () => {
    const s3 = lese(BACKUP, 'vorlagen/pgbackrest-s3.vorlage');
    // pgBackRest schreibt nur; die Aufbewahrung im externen Repository regelt
    // die Lifecycle-Regel des Buckets. Das ist der Kern des
    // Ransomware-Schutzes.
    expect(s3).toContain('repo2-cipher-type=aes-256-cbc');
    expect(s3).toContain('repo2-retention-archive-type=full');
  });
});

describe('Die Isolation des Restore-Tests', () => {
  const test = lese(BIN, 'swisshub-restore-test');

  it('schaltet die Archivierung im Testcluster ab', () => {
    /*
     * Die Zeile, die man ohne Nachdenken falsch macht.
     *
     * Ohne `--archive-mode=off` archivierte der wiederhergestellte Cluster in
     * dasselbe Repository und legte dort eine neue Zeitlinie an: der Test
     * beschaedigte genau die Sicherung, die er prueft.
     */
    expect(test).toContain('--archive-mode=off');
    // Und ein zweites Mal unabhaengig von pgBackRest.
    expect(test).toContain('archive_mode = off');
  });

  it('nimmt dem Testcontainer das Netzwerk', () => {
    // Die staerkste Isolationsschicht: er KANN Discord nicht erreichen, auch
    // nicht durch einen Fehler.
    expect(test).toContain('--network none');
  });

  it('startet keine Anwendung', () => {
    // Kein Bot, keine WebApp, keine Musik-Laufzeit, keine Hintergrundjobs. Eine
    // wiederhergestellte Datenbank enthaelt die ECHTEN Bot-Token.
    expect(test).not.toMatch(/\bnpm run (start|dev)\b/u);
    expect(test).not.toMatch(/docker compose[^\n]*up[^\n]*\b(bot|web|music-runtime)\b/u);
  });

  it('bindet das Repository nur lesend ein', () => {
    expect(test).toMatch(/\$SWISSHUB_PGBACKREST_REPO:ro/u);
  });

  it('entfernt den Testcluster wieder', () => {
    // Er enthaelt echte Zugangsdaten.
    expect(test).toContain('trap ');
    expect(test).toContain('aufraeumen');
  });

  it('wartet, bis die Wiederherstellung wirklich abgeschlossen ist', () => {
    // Ein Cluster, der noch WAL einspielt, antwortet bereits - mit einem Stand,
    // der noch nicht der Zielzeitpunkt ist. Wer hier nicht wartet, prueft
    // einen halben Restore.
    expect(test).toContain('pg_is_in_recovery');
  });
});

describe('Aufbewahrung loescht nicht ohne geprueften Ersatz', () => {
  const backup = lese(BIN, 'swisshub-backup');

  it('loescht nicht, solange es nur ein Vollbackup gibt', () => {
    // Ein einziges Backup ist keine Reserve. Wird es beim Aufraeumen entfernt,
    // gibt es danach gar keines - und niemand hat etwas gemerkt.
    expect(backup).toMatch(/anzahl_voll:-0\}"? -lt 2/u);
  });

  it('loescht nichts aus einem Repository, das die Pruefung nicht besteht', () => {
    /*
     * In einem beschaedigten Repository aufzuraeumen zerstoert auch die
     * brauchbaren Reste. Die Pruefung steht deshalb VOR dem `forget`.
     */
    expect(backup).toMatch(/restic_lokal check[\s\S]{0,400}aufraeumen-integritaet/u);
  });

  it('loescht nie im externen Repository', () => {
    // Der Kern des Ransomware-Schutzes: wer diesen Server uebernimmt, hat
    // keinen Weg, die externe Historie zu vernichten.
    expect(backup).toContain('kein Loeschen von hier aus');
    expect(backup).not.toMatch(/restic_extern[\s\S]{0,80}forget/u);
  });
});

describe('Die systemd-Units', () => {
  const units = readdirSync(SYSTEMD);

  it('bringt Dienste und Zeitgeber mit', () => {
    expect(units).toContain('swisshub-backup@.service');
    expect(units).toContain('swisshub-backup-stuendlich.timer');
    expect(units).toContain('swisshub-backup-taeglich.timer');
    expect(units).toContain('swisshub-backup-woechentlich.timer');
    expect(units).toContain('swisshub-backup-verify.timer');
    expect(units).toContain('swisshub-restore-test.timer');
    expect(units).toContain('swisshub-backup-monitor.timer');
    expect(units).toContain('swisshub-backup-controller.path');
  });

  it.each(units.filter((name) => name.endsWith('.timer')))(
    '%s liegt nicht auf einer runden Minute',
    (name) => {
      /*
       * Um 03:00 laufen auf einem gewoehnlichen Ubuntu auch logrotate,
       * certbot.timer und apt-daily-upgrade an. Ein Backup, das mit ihnen um
       * dasselbe Laufwerk streitet, dauert das Doppelte - und eine Sicherung,
       * die zu lange dauert, wird irgendwann verschoben und dann abgeschaltet.
       */
      const inhalt = lese(SYSTEMD, name);
      const kalender = [...inhalt.matchAll(/^OnCalendar=(.+)$/gmu)].map((treffer) => treffer[1]);
      expect(kalender.length, `${name} hat kein OnCalendar`).toBeGreaterThan(0);
      for (const eintrag of kalender) {
        // Ein Eintrag mit `*:00/15` ist ein Intervall und keine Uhrzeit - der
        // ist ausgenommen.
        if ((eintrag as string).includes('/')) {
          continue;
        }
        expect(eintrag, `${name}: ${eintrag} liegt auf einer runden Minute`).not.toMatch(/:00:00$/u);
      }
    },
  );

  it.each(units.filter((name) => name.endsWith('.service')))(
    '%s tritt hinter dem produktiven Betrieb zurueck',
    (name) => {
      /*
       * Der produktive Discord-Bot laeuft daneben. Eine Sicherung, die ihn
       * ausbremst, wird abgeschaltet - und eine abgeschaltete Sicherung ist
       * keine.
       *
       * `IOWeight` und `Nice` sind Gewichtungen und keine Obergrenzen: solange
       * nichts anderes will, darf die Sicherung die ganze Maschine nutzen.
       */
      const inhalt = lese(SYSTEMD, name);
      expect(inhalt, `${name} hat keine I/O-Gewichtung`).toMatch(/IOWeight=/u);
      expect(inhalt, `${name} hat kein Nice`).toMatch(/Nice=/u);
    },
  );

  it.each(units.filter((name) => name.endsWith('.service')))('%s hat eine Zeitgrenze', (name) => {
    // Ein haengender Lauf ohne Grenze belegt die Sperre dauerhaft, und jeder
    // folgende Lauf wird uebersprungen - stillschweigend.
    expect(lese(SYSTEMD, name)).toMatch(/TimeoutStartSec=/u);
  });

  it('gibt dem Backup-Dienst nur das Backup-Verzeichnis zum Schreiben', () => {
    const unit = lese(SYSTEMD, 'swisshub-backup@.service');
    expect(unit).toContain('ProtectSystem=strict');
    expect(unit).toContain('ReadWritePaths=/var/lib/swisshub-backup');
    expect(unit).toContain('NoNewPrivileges=true');
  });

  it('laesst den Controller nicht als root laufen', () => {
    // Er fuehrt aus, was die WebApp anfordert. Als root waere die
    // Sicherheitsgrenze keine.
    const unit = lese(SYSTEMD, 'swisshub-backup-controller.service');
    expect(unit).toContain('User=swisshub-backup');
    expect(unit).not.toMatch(/^User=root$/mu);
  });

  it('hat neben der Pfadbeobachtung eine Reissleine', () => {
    // Fiele die Beobachtung aus, bliebe eine Anforderung ewig liegen - und im
    // Dashboard staende «laeuft», ohne dass etwas laeuft.
    expect(units).toContain('swisshub-backup-controller.timer');
  });
});

describe('Berechtigungen und Operationen passen zusammen', () => {
  it('jede Operation des Controllers hat eine Berechtigung in den Aktionen', () => {
    /*
     * Die Zuordnung steht als Tabelle in `actions.ts`. Fehlt ein Eintrag,
     * lehnt der Rueckfall dort ab - der Knopf im Dashboard taete dann nichts,
     * und die Meldung waere «keine Berechtigung festgelegt». Besser, es faellt
     * hier auf.
     */
    const aktionen = lese(process.cwd(), 'apps/web/src/modules/backup/actions.ts');
    for (const operation of CONTROLLER_OPERATIONEN) {
      expect(aktionen, `Operation «${operation}» fehlt in OPERATION_PERMISSION`).toContain(operation);
    }
  });

  it('kennt keine Berechtigung «Restore ausfuehren»', () => {
    /*
     * Es gibt in dieser Oberflaeche keinen Knopf, der die Produktion
     * zuruecksetzt - und deshalb darf es auch keine Berechtigung dafuer geben.
     * Eine Berechtigung ohne Funktion ist eine Einladung, die Funktion
     * nachzuliefern.
     */
    const werte = Object.values(BACKUP_PERMISSIONS);
    expect(werte).not.toContain('backup.restore_execute');
    expect(werte).not.toContain('backup.restore');
    // Anfordern und Freigeben sind getrennt - das ist die Voraussetzung des
    // Vier-Augen-Prinzips.
    expect(werte).toContain('backup.restore_request');
    expect(werte).toContain('backup.restore_approve');
    expect(BACKUP_PERMISSIONS.restoreRequest).not.toBe(BACKUP_PERMISSIONS.restoreApprove);
  });
});

describe('Der Installer', () => {
  const install = lese(BACKUP, 'install.sh');

  it('schaltet nichts von selbst ein', () => {
    // Ein Zeitplan auf einer leeren Konfiguration erzeugt stuendlich einen
    // Fehlschlag und sonst nichts.
    expect(install).toContain('Eingeschaltet ist noch nichts');
    expect(install).not.toMatch(/^\s*systemctl enable --now/mu);
  });

  it('gibt dem Deploy-Benutzer nur den einen Befehl per sudo', () => {
    // Der SSH-Schluessel dieses Benutzers liegt als GitHub-Secret. Wer ihn
    // erlangt, soll damit nicht root auf diesem Host werden.
    expect(install).toContain('NOPASSWD: $ZIEL/bin/swisshub-backup vor-deployment');
    expect(install).not.toMatch(/NOPASSWD:\s*ALL/u);
    // Und die Regel wird geprueft, bevor sie wirken kann: eine fehlerhafte
    // sudoers-Datei sperrt sudo vollstaendig aus.
    expect(install).toContain('visudo -c');
  });

  it('ueberschreibt eine bestehende Konfiguration nicht', () => {
    expect(install).toContain('wird NICHT ueberschrieben');
  });

  it('legt die Verzeichnisse mit setgid an', () => {
    // Ohne setgid erbt eine neue Datei die Gruppe des Erzeugers, nicht die des
    // Verzeichnisses. Hier arbeiten zwei Benutzer im selben Baum: es liefe beim
    // ersten Lauf und beim zweiten nicht mehr.
    expect(install).toContain('-m 2770');
  });
});

describe('Die Deployment-Pipeline verlangt ein Netz', () => {
  const workflow = lese(process.cwd(), '.github/workflows/deploy.yml');

  it('bewertet die Migrationen', () => {
    expect(workflow).toContain('scripts/migrationen-pruefen.ts');
    expect(workflow).toContain('braucht_recovery_point');
  });

  it('holt genug Historie fuer den Vergleich', () => {
    // Ohne Historie gibt es nichts zu vergleichen, und der Vergleich faellt auf
    // «alle Migrationen» zurueck - das ergaebe bei jedem Deployment ein
    // unnoetiges Backup.
    expect(workflow).toContain('fetch-depth: 0');
  });

  it('bricht ab, wenn kein Wiederherstellungspunkt entsteht', () => {
    expect(workflow).toContain('swisshub-backup vor-deployment');
    expect(workflow).toMatch(/NICHT ausgerollt/u);
  });

  it('verlangt fuer das Uebergehen eine ausdrueckliche Erklaerung', () => {
    // Kein Schalter, den man versehentlich setzt.
    expect(workflow).toContain('SWISSHUB_DEPLOY_OHNE_NETZ');
    expect(workflow).toContain('ich-weiss-was-ich-tue');
  });

  it('verlangt kein Backup, wenn keine Migration etwas wegnimmt', () => {
    expect(workflow).toMatch(/Nicht noetig: keine Migration/u);
  });
});

/**
 * Was die Katastrophenuebung zutage brachte.
 *
 * Jeder Punkt hier ist ein Fehler, der im Probelauf aufgetreten ist und den
 * kein Testlauf zuvor bemerkt hatte - weil sie alle dieselbe Form haben: das
 * Werkzeug endet mit einem Rueckgabewert ungleich null und einer Meldung, die
 * in die falsche Richtung zeigt. Genau das ist im Ernstfall am teuersten.
 */
describe('Die Wiederherstellung, wie die Uebung sie gefunden hat', () => {
  const recovery = lese(BIN, 'swisshub-recovery');
  const gemeinsam = lese(LIB, 'gemeinsam.sh');
  const backup = lese(BIN, 'swisshub-backup');

  it('trennt die Restic-Zugangsdaten vom Pfad', () => {
    // `repo=$(restic_repo_pfad)` laeuft in einer Subshell. Setzte die Funktion
    // dort das Repository-Passwort, war es beim Zurueckkommen weg - und jeder
    // restic-Aufruf scheiterte mitten in der Wiederherstellung.
    const pfad = recovery.slice(
      recovery.indexOf('restic_repo_pfad() {'),
      recovery.indexOf('# Der Snapshot, der zum Zielzeitpunkt passt.'),
    );
    expect(pfad).not.toContain('export ');
    expect(pfad).not.toContain('restic_umgebung');
    expect(recovery).toContain('restic_zugang() {');
  });

  it('setzt die Zugangsdaten vor jedem Restic-Aufruf', () => {
    // Jede Stelle, die einen Repository-Pfad holt, muss vorher `restic_zugang`
    // gerufen haben - ausser der Funktion, die selbst in einer
    // Befehlssubstitution laeuft und die Umgebung vom Aufrufer bekommt.
    const zeilen = recovery.split('\n');
    const treffer = zeilen
      .map((zeile, i) => ({ zeile, i }))
      .filter(({ zeile }) => /^\s*repo(_pfad)?=\$\(restic_repo_pfad\)/u.test(zeile));
    expect(treffer.length).toBeGreaterThan(2);
    for (const { i } of treffer) {
      const davor = zeilen.slice(Math.max(0, i - 6), i).join('\n');
      expect(/restic_zugang/u.test(davor) || /passender_datei_snapshot\(\) \{/u.test(davor)).toBe(true);
    }
  });

  it('nimmt fuer die Uploads nicht den jungsten Snapshot ueberhaupt', () => {
    // Im selben Repository liegen auch «konfiguration» und «recovery». War das
    // Wiederherstellungspaket das Letzte, packte «latest» dieses aus.
    const auswahl = recovery.slice(
      recovery.indexOf('passender_datei_snapshot() {'),
      recovery.indexOf('konfiguration_wiederherstellen() {'),
    );
    expect(auswahl).toContain('--tag uploads');
    // Der blanke Rueckfall auf «latest» darf nicht der Normalfall sein.
    expect(auswahl).toMatch(/\$\{jungster:-latest\}/u);
  });

  it('waehlt die Konfigurationssicherung nach Zeit, nicht nach Ausgabereihenfolge', () => {
    const konf = recovery.slice(
      recovery.indexOf('konfiguration_wiederherstellen() {'),
      recovery.indexOf('konfiguration_wiederherstellen() {') + 1800,
    );
    expect(konf).toContain('daten.sort(key=lambda s: s.get("time") or "")');
  });

  it('weicht auf die lokale Kopie aus, wenn kein auswaertiges Ziel eingerichtet ist', () => {
    // Die Vorgabe zeigt nach auswaerts - richtig, denn der haeufigste Ernstfall
    // ist der Serververlust. Ohne S3 scheiterte aber jeder Aufruf mit «Bucket
    // name cannot be empty»: im Notfall sieht das aus wie ein zerstoertes
    // Backup und ist bloss eine leere Einstellung.
    expect(recovery).toContain('repo_vorgabe_aufloesen() {');
    expect(recovery).toContain('REPO_AUSDRUECKLICH');
    expect(recovery).toMatch(/ueberlebt keinen Verlust dieses Servers/u);
  });

  it('meldet ein ausdruecklich verlangtes Repository 2 als Fehler statt still umzuleiten', () => {
    const aufloesen = recovery.slice(
      recovery.indexOf('repo_vorgabe_aufloesen() {'),
      recovery.indexOf('# Die Zugangsdaten fuer Restic in die Umgebung.'),
    );
    expect(aufloesen).toMatch(/REPO_AUSDRUECKLICH.*==.*'1'/su);
    expect(aufloesen).toContain("REPO='1'");
  });

  it('erzeugt eine fehlende pgbackrest.conf selbst', () => {
    // Das versiegelte Paket enthaelt sie nicht - sie ist aus der .env
    // herleitbar. Auf einem neuen Server fehlt sie also, und pgBackRest meldet
    // «unable to open missing file»: das klingt nach einem zerstoerten
    // Repository und ist eine fehlende Datei.
    expect(gemeinsam).toContain('pgbackrest_konfiguration_schreiben() {');
    expect(recovery).toContain('pgbackrest_konfiguration_schreiben');
    expect(backup).toContain('pgbackrest_konfiguration_schreiben');
  });

  it('schreibt die Konfiguration, bevor `einrichten` sie braucht', () => {
    const einrichten = backup.slice(
      backup.indexOf('befehl_einrichten() {'),
      backup.indexOf('befehl_einrichten() {') + 900,
    );
    expect(einrichten).toContain('pgbackrest_konfiguration_schreiben');
  });

  it('prueft, ob PostgreSQL auf den wiederhergestellten Dateien startet', () => {
    // Ein nicht geprueftes `pg_ctl start` meldete Erfolg und liess die
    // Validierung danach an einer Datenbank scheitern, die nie lief.
    expect(recovery).toMatch(/pg_ctl.*-l "\$startprotokoll".*start/u);
    expect(recovery).toMatch(/nicht gestartet/u);
  });

  it('bestaetigt eine Wiederherstellung nur auf ein getipptes Wort', () => {
    // Kein «[j/N]» mit Vorgabe und kein Schalter, der die Rueckfrage abschaltet:
    // nichts darf die Produktion auf einen Tastendruck ueberschreiben.
    expect(recovery).toContain("'WIEDERHERSTELLEN'");
    expect(recovery).not.toMatch(/--(ja|force|yes|unbeaufsichtigt)\)/u);
  });
});

describe('Die Skripte sagen, was sie meinen', () => {
  it('bricht keinen Apostroph falsch aus einfachen Anfuehrungszeichen heraus', () => {
    // `'... Let\''s ...'` ergibt in bash «Let\s». Der Rueckschraegstrich bleibt
    // stehen, weil er innerhalb einfacher Anfuehrungszeichen kein Zeichen
    // schuetzt - er IST eins.
    for (const werkzeug of WERKZEUGE) {
      const inhalt = lese(BIN, werkzeug);
      expect(inhalt, `${werkzeug} enthaelt \\'' in einfachen Anfuehrungszeichen`).not.toMatch(/\\''/u);
    }
  });
});

/**
 * Was ein Pull Request ausloest - und was niemals.
 *
 * Die Validierung lief frueher erst beim Push auf `production`, also nach dem
 * Zusammenfuehren. Ein fehlerhafter Stand lag dann schon im produktiven
 * Branch; nur `needs: validate` hat verhindert, dass er auch auf den Server
 * kam. Repariert werden musste er trotzdem dort.
 */
describe('Die Pipeline prueft, bevor zusammengefuehrt wird', () => {
  const workflow = lese(process.cwd(), '.github/workflows/deploy.yml');

  it('laeuft auch fuer Pull Requests auf den produktiven Branch', () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\n\s*- production/u);
  });

  it('rollt bei einem Pull Request NICHT aus', () => {
    // Die eine Zeile, an der das haengt. Ohne sie wuerde jeder geoeffnete
    // Pull Request `git reset --hard origin/production` auf dem Server
    // ausfuehren.
    const deployAb = workflow.indexOf('  deploy:');
    expect(deployAb).toBeGreaterThan(0);
    const deploy = workflow.slice(deployAb);
    expect(deploy).toContain("if: github.event_name == 'push'");
    expect(deploy).toContain('needs: validate');
    // Die Bedingung muss VOR den Schritten stehen, also zum Job gehoeren und
    // nicht zu einem einzelnen Schritt.
    expect(deploy.indexOf("if: github.event_name == 'push'")).toBeLessThan(deploy.indexOf('steps:'));
  });

  it('benutzt kein pull_request_target', () => {
    // `pull_request_target` laeuft mit den Rechten und Geheimnissen des
    // Zielbranches, fuehrt aber den Code des Pull Requests aus. Das ist die
    // Uebergabe der Deployment-Schluessel an jeden, der einen PR oeffnen kann.
    //
    // Ohne Kommentarzeilen geprueft: der Workflow ERKLAERT in einem Kommentar,
    // weshalb er es nicht benutzt, und ein Treffer darin waere kein Befund.
    const ohneKommentare = workflow
      .split('\n')
      .filter((zeile) => !zeile.trimStart().startsWith('#'))
      .join('\n');
    expect(ohneKommentare).not.toContain('pull_request_target');
  });

  it('gibt dem Workflow nur Leserechte', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/u);
  });

  it('haelt PR-Pruefungen aus der Deployment-Warteschlange heraus', () => {
    // Eine gemeinsame Gruppe liesse jede PR-Pruefung hinter einem laufenden
    // Deployment warten.
    expect(workflow).toContain("format('swisshub-pr-{0}', github.event.number)");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('vergleicht die Migrationen mit der richtigen Basis', () => {
    // Im Pull Request gibt es kein `github.event.before`. Ohne Unterscheidung
    // fiele die Bewertung auf «alle Migrationen» zurueck und verlangte bei
    // jedem PR einen Wiederherstellungspunkt.
    expect(workflow).toContain('github.event.pull_request.base.sha');
    expect(workflow).toContain('github.event.before');
  });

  it('prueft dasselbe wie `npm run check`', () => {
    // format:check fehlte. Ein Stand, der lokal an `npm run check` scheitert,
    // kam damit durch die Pipeline.
    for (const schritt of ['npm run format:check', 'npm run lint', 'npm run typecheck', 'npm test']) {
      expect(workflow, `${schritt} fehlt im Workflow`).toContain(schritt);
    }
    expect(workflow).toContain('npm run build');
  });

  it('prueft gegen ein echtes PostgreSQL', () => {
    expect(workflow).toContain('postgres:16-alpine');
    expect(workflow).toContain('SWISSHUB_TEST_DATABASE_URL');
    expect(workflow).toContain('npm run db:deploy');
  });

  it('gibt dem Validierungsjob keine Deployment-Zugangsdaten', () => {
    // Der validate-Job laeuft auch fuer Pull Requests. Kaeme ein
    // Deployment-Secret darin vor, laege es im Zugriff von PR-Code.
    const validate = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  deploy:'));
    expect(validate).not.toMatch(/secrets\.DEPLOY_/u);
  });
});
