import type { Metadata } from 'next';
import { Bell, Clock, HardDrive, KeyRound, Lock, Settings, Timer } from 'lucide-react';
import { backup } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { ErrorState } from '@/components/shared/states';
import { BackupAbschnittsNav } from '@/modules/backup/components/abschnitts-nav';
import { vorWieLange } from '@/modules/backup/darstellung';
import { requirePagePermission } from '@/server/auth';
import { backupAbschnitte } from '../abschnitte';

export const metadata: Metadata = { title: 'Backup-Einstellungen' };
export const dynamic = 'force-dynamic';

/**
 * D) Die Einstellungen.
 *
 * ==========================================================================
 * WARUM DIESE SEITE ANZEIGT UND NICHT BEARBEITET
 * ==========================================================================
 *
 * Das ist ungewöhnlich für einen Einstellungsbereich, und die Begründung gehört
 * deshalb ausdrücklich auf die Seite selbst - nicht nur in einen Kommentar.
 *
 * Die Backup-Konfiguration liegt in `/etc/swisshub-backup/swisshub-backup.env`,
 * einer Datei, die root gehört und in die diese Anwendung nicht schreiben kann.
 * Das ist kein Versäumnis, sondern die Absicherung:
 *
 *   Wer diese WebApp übernimmt, soll das Backup-Ziel nicht umlenken und die
 *   Aufbewahrung nicht auf einen Tag verkürzen können.
 *
 * Beides wäre der eleganteste Weg, ein Backup-System unbrauchbar zu machen,
 * ohne eine einzige Datei zu löschen: die Aufbewahrung senken und eine Woche
 * warten. Danach gibt es keine Historie mehr, und niemand hat etwas bemerkt.
 *
 * Dieselbe Überlegung gilt für die Verschlüsselungspasswörter, die
 * Empfängerschlüssel und die Zugangsdaten des externen Speichers. Sie stehen
 * hier nie - auch nicht maskiert.
 *
 * Was diese Seite dafür tut: sie zeigt den ISTZUSTAND, sie sagt bei jedem Wert,
 * WO er geändert wird, und sie sagt, WARUM er dort liegt. Ein Administrator
 * erfährt hier alles, was er wissen muss, um die richtige Datei zu öffnen.
 * ==========================================================================
 */
export default async function BackupEinstellungenSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(backup.BACKUP_PERMISSIONS.view);
  const [zustand, freigaben] = await Promise.all([
    backup.leseBackupZustand(),
    backup.listeFreigaben(50).catch(() => []),
  ]);
  const abschnitte = backupAbschnitte(context, {
    offeneFreigaben: freigaben.filter((zeile) => zeile.status === 'ANGEFORDERT').length,
    befunde: zustand.monitor?.fehler ?? 0,
  });

  if (!zustand.erreichbar) {
    return (
      <>
        <BackupAbschnittsNav abschnitte={abschnitte} />
        <ErrorState title="Die Backup-Anlage ist nicht erreichbar" description={zustand.grund} />
      </>
    );
  }

  return (
    <>
      <BackupAbschnittsNav abschnitte={abschnitte} />

      <section
        aria-label="Wo diese Einstellungen liegen"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          Diese Einstellungen liegen ausserhalb der WebApp - mit Absicht
        </h2>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>
            Sie stehen in <code className="font-mono">/etc/swisshub-backup/swisshub-backup.env</code>, einer
            Datei, die <code className="font-mono">root</code> gehört und in die diese Anwendung nicht
            schreiben kann.
          </p>
          <p className="font-medium text-foreground">Das ist die Absicherung und kein fehlendes Feature.</p>
          <p>
            Der eleganteste Weg, ein Backup-System unbrauchbar zu machen, ist nicht, Dateien zu löschen - es
            ist, die Aufbewahrung auf einen Tag zu senken und eine Woche zu warten. Danach gibt es keine
            Historie mehr, und niemand hat etwas bemerkt. Wer diese WebApp übernimmt, soll das nicht können,
            und ebenso nicht das Backup-Ziel umlenken.
          </p>
          <p>
            Was hier steht, ist der Istzustand samt der Stelle, an der er geändert wird. Schlüssel und
            Zugangsdaten stehen nicht darunter - auch nicht maskiert.
          </p>
        </div>
      </section>

      {/* --- Intervalle --- */}
      <Panel title="Backup-Intervalle" icon={<Timer />} description="systemd-Timer auf dem Server.">
        <div className="space-y-3 text-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Durchgang</th>
                <th className="pb-2 pr-4 font-medium">Wann</th>
                <th className="pb-2 font-medium">Was</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">stuendlich</td>
                <td className="py-2 pr-4 whitespace-nowrap">jede Stunde, Minute 20</td>
                <td className="py-2 text-muted-foreground">
                  WAL prüfen, Uploads sichern, inkrementelles Basis-Backup, extern übertragen
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">taeglich</td>
                <td className="py-2 pr-4 whitespace-nowrap">03:17</td>
                <td className="py-2 text-muted-foreground">
                  differentielles Basis-Backup, logischer Export, Konfiguration, Wiederherstellungspaket,
                  Aufbewahrung
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">woechentlich</td>
                <td className="py-2 pr-4 whitespace-nowrap">Sonntag 02:33</td>
                <td className="py-2 text-muted-foreground">vollständiges Basis-Backup</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">verify</td>
                <td className="py-2 pr-4 whitespace-nowrap">04:43</td>
                <td className="py-2 text-muted-foreground">Prüfstufen 1 bis 4</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">restore-test</td>
                <td className="py-2 pr-4 whitespace-nowrap">Mittwoch 01:37</td>
                <td className="py-2 text-muted-foreground">
                  Prüfstufen 5 und 6 in einer isolierten Umgebung
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-mono text-xs">monitor</td>
                <td className="py-2 pr-4 whitespace-nowrap">alle 15 Minuten</td>
                <td className="py-2 text-muted-foreground">Überwachung, Alarmierung, Totmannschalter</td>
              </tr>
            </tbody>
          </table>

          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>
              Keine Zeit liegt auf einer runden Minute. Das ist kein Zufall: um 03:00 laufen auf einem
              gewöhnlichen Ubuntu auch <code className="font-mono">logrotate</code>,{' '}
              <code className="font-mono">certbot.timer</code> und{' '}
              <code className="font-mono">apt-daily-upgrade</code> an, und ein Backup, das mit ihnen um
              dasselbe Laufwerk streitet, dauert das Doppelte.
            </p>
            <p>
              Ändern (braucht root, weil es systemd-Units sind):
              <br />
              <code className="font-mono">sudo systemctl edit swisshub-backup-taeglich.timer</code>
            </p>
            <p>
              Zustand ansehen: <code className="font-mono">systemctl list-timers &apos;swisshub-*&apos;</code>
            </p>
          </div>
        </div>
      </Panel>

      {/* --- Aufbewahrung --- */}
      <Panel title="Aufbewahrung" icon={<HardDrive />} description="Wie weit die Historie zurückreicht.">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Die Standardwerte und die Stelle, an der sie stehen (
            <code className="font-mono">/etc/swisshub-backup/swisshub-backup.env</code>):
          </p>
          <ul className="space-y-1.5">
            {[
              ['SWISSHUB_RETENTION_FULL', '4', 'vollständige Basis-Backups (lokal)'],
              [
                '(extern)',
                '8',
                'vollständige Basis-Backups im externen Repository - doppelt so viele, weil ein spät erkannter Schaden dort noch erreichbar sein soll',
              ],
              ['SWISSHUB_RETENTION_DIFF', '14', 'differentielle je Vollbackup'],
              ['SWISSHUB_RETENTION_HOURLY', '48', 'stündliche Datei-Snapshots'],
              ['SWISSHUB_RETENTION_DAILY', '30', 'tägliche'],
              ['SWISSHUB_RETENTION_WEEKLY', '12', 'wöchentliche'],
              ['SWISSHUB_RETENTION_MONTHLY', '12', 'monatliche'],
              ['SWISSHUB_OBJECT_LOCK_DAYS', '30', 'Tage Löschschutz im externen Speicher'],
            ].map(([schluessel, wert, was]) => (
              <li key={schluessel} className="flex flex-wrap gap-2 rounded-lg border border-border/60 p-2.5">
                <code className="font-mono text-xs">{schluessel}</code>
                <Badge variant="secondary">{wert}</Badge>
                <span className="min-w-0 flex-1 text-muted-foreground">{was}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
            <p className="font-medium text-warning">
              Zwei Dinge, die die Aufbewahrung nicht tun kann - und das ist gebaut, nicht gehofft
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Die WAL-Kette zerreissen.</strong> pgBackRest rechnet die
              WAL-Aufbewahrung aus den Basis-Backups (
              <code className="font-mono">repo-retention-archive-type=full</code>) und behält WAL so lange,
              wie das älteste aufbewahrte Vollbackup es braucht. Ohne diese Einstellung könnte es genau die
              Segmente wegräumen, die das älteste Backup zum Wiederherstellen braucht - das Backup wäre noch
              da und trotzdem unbrauchbar, und das sieht wie Sicherheit aus.
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Die letzte brauchbare Kette löschen.</strong> Vor jedem
              Aufräumen gilt: es muss mehr als ein Wiederherstellungspunkt übrig bleiben, und die
              Integritätsprüfung des Repositories muss bestanden sein. Ist sie es nicht, wird <em>nichts</em>{' '}
              gelöscht - in einem beschädigten Repository aufzuräumen zerstört auch die brauchbaren Reste.
            </p>
          </div>
        </div>
      </Panel>

      {/* --- Speicherziele --- */}
      <Panel title="Speicherziele" icon={<HardDrive />} description="Drei Stufen, zwei Orte.">
        <div className="space-y-3 text-sm">
          <ol className="space-y-2">
            <li className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Stufe 1</Badge>
                <span className="font-medium">Lokales Repository</span>
                <Badge variant="success">verschlüsselt</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                pgBackRest und Restic unter <code className="font-mono">/var/lib/swisshub-backup/</code>,
                beide mit AES-256. Schnell wiederherstellbar - und auf demselben Rechner, der gesichert wird.
              </p>
            </li>
            <li className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Stufe 2</Badge>
                <span className="font-medium">Externer S3-Speicher</span>
                {zustand.extern?.status === 'erfolg' ? (
                  <Badge variant="success">eingerichtet</Badge>
                ) : (
                  <Badge variant="destructive">nicht eingerichtet</Badge>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">
                {zustand.extern?.ziel
                  ? `${zustand.extern.ziel} · letzte Übertragung ${vorWieLange(zustand.extern.zeit)}`
                  : 'Ohne externe Kopie liegen alle Sicherungen auf dem Server, der gesichert wird. Gegen dessen Verlust - den häufigsten Ernstfall - schützt das nicht.'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Die Zugangsdaten dieses Servers dürfen <strong>anlegen und lesen</strong>, nicht löschen und
                nicht überschreiben. Darauf beruht der Schutz gegen Ransomware.
              </p>
            </li>
            <li className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Stufe 3</Badge>
                <span className="font-medium">Object Lock</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                Compliance-Modus mit 30 Tagen Frist. Innerhalb der Frist kann niemand eine Fassung entfernen -
                auch der Betreiber nicht, auch der Anbieter-Support nicht. Genau das ist der Zweck.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Geprüft wird das in Prüfstufe 3, und zwar auf die einzige ehrliche Weise: es wird versucht zu
                löschen, und erwartet wird, dass es scheitert. Einzelheiten in{' '}
                <code className="font-mono">deploy/backup/vorlagen/s3-richtlinien.md</code>.
              </p>
            </li>
          </ol>
        </div>
      </Panel>

      {/* --- Verschlüsselung --- */}
      <Panel title="Verschlüsselung" icon={<KeyRound />} description="Zustand, keine Werte.">
        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <span className="font-medium">pgBackRest-Repository</span>
              <Badge variant="success">AES-256-CBC</Badge>
              <span className="text-xs text-muted-foreground">
                Passwort in der Konfigurationsdatei und im Wiederherstellungspaket
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <span className="font-medium">Restic-Repository</span>
              <Badge variant="success">AES-256-CTR</Badge>
              <span className="text-xs text-muted-foreground">ebenso</span>
            </li>
            <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <span className="font-medium">Wiederherstellungspaket</span>
              <Badge variant="success">age / X25519</Badge>
              <span className="text-xs text-muted-foreground">
                asymmetrisch - der Server kann schreiben und nicht lesen
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
              <span className="font-medium">Zugangsdaten in der Datenbank</span>
              <Badge variant="success">AES-256-GCM</Badge>
              <span className="text-xs text-muted-foreground">
                mit dem MASTER_ENCRYPTION_KEY, Kennung{' '}
                <code className="font-mono">{zustand.geheimnisse?.master_key_kennung ?? 'unbekannt'}</code>
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Die beiden Repository-Passwörter werden einmalig erzeugt und <strong>nie</strong> geändert: ein
            geänderter Wert macht das bestehende Repository unlesbar. Sie stehen im Wiederherstellungspaket,
            weil ohne sie kein Restore möglich ist - und das Paket ist der einzige Ort, der den Verlust des
            Servers überlebt.
          </p>
        </div>
      </Panel>

      {/* --- Benachrichtigungen --- */}
      <Panel
        title="Benachrichtigungen"
        icon={<Bell />}
        description="Mindestens ein Weg muss ohne diesen Server funktionieren."
      >
        <div className="space-y-3 text-sm">
          <ol className="space-y-2">
            <li className="rounded-lg border border-success/40 bg-success/5 p-3">
              <p className="font-medium">
                Totmannschalter{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (SWISSHUB_ALERT_HEARTBEAT_URL)
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Der wichtigste Weg, und der einzige, der einen Totalausfall überlebt: ein externer Dienst
                erwartet nach jedem Durchgang ein Lebenszeichen und schlägt Alarm, wenn es{' '}
                <strong className="text-foreground">ausbleibt</strong>. Eine Meldung, die nicht kommt, fällt
                auf - und dafür muss der Server nichts können.
              </p>
            </li>
            <li className="rounded-lg border border-border/60 p-3">
              <p className="font-medium">
                E-Mail{' '}
                <span className="text-xs font-normal text-muted-foreground">(SWISSHUB_ALERT_SMTP_*)</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Über einen externen SMTP-Anbieter, nicht über einen MTA auf diesem Server - der fällt mit ihm
                aus.
              </p>
            </li>
            <li className="rounded-lg border border-border/60 p-3">
              <p className="font-medium">
                Webhook{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (SWISSHUB_ALERT_WEBHOOK_URL)
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Beliebiger externer Dienst, der ein JSON-POST annimmt.
              </p>
            </li>
            <li className="rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="font-medium">
                Discord{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (SWISSHUB_ALERT_DISCORD_WEBHOOK)
                </span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Ergänzend, nie allein. Der Bot läuft auf demselben Server; fällt der aus, fällt er mit aus,
                und die Meldung über den Ausfall kommt nie an.
              </p>
            </li>
          </ol>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Gegen Alarm-Spam</p>
            <p className="mt-1">
              Dieselbe Meldung wird unterdrückt: eine kritische für eine Stunde, eine Warnung für sechs. Wer
              bei «kritisch» lange schweigt, verliert den Anlass; wer bei einer Warnung stündlich meldet, wird
              ignoriert.
            </p>
            <p className="mt-1">
              Und es gibt Entwarnungen: was wieder in Ordnung ist, sagt das. Ohne sie bleibt eine Warnung im
              Gedächtnis stehen, und beim nächsten Mal glaubt sie niemand mehr.
            </p>
            {zustand['letzter-alarm'] ? (
              <p className="mt-2">
                Letzter Alarm: <Badge variant="secondary">{zustand['letzter-alarm'].stufe}</Badge>{' '}
                <code className="font-mono">{zustand['letzter-alarm'].kennung}</code>{' '}
                {vorWieLange(zustand['letzter-alarm'].zeit)}
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      {/* --- Grenzwerte --- */}
      <Panel title="Grenzwerte" icon={<Settings />} description="Wann gewarnt und wann abgebrochen wird.">
        <ul className="space-y-1.5 text-sm">
          <li className="flex flex-wrap gap-2 rounded-lg border border-border/60 p-2.5">
            <code className="font-mono text-xs">SWISSHUB_MIN_FREE_GB</code>
            <Badge variant="secondary">10</Badge>
            <span className="min-w-0 flex-1 text-muted-foreground">
              Untergrenze an freiem Platz. Wird sie unterschritten, bricht der Lauf ab,{' '}
              <strong className="text-foreground">bevor</strong> er schreibt - ein volles Laufwerk nimmt
              PostgreSQL und den Bot mit. Gewarnt wird beim Doppelten, also solange noch Zeit zum Handeln ist.
            </span>
          </li>
          <li className="flex flex-wrap gap-2 rounded-lg border border-border/60 p-2.5">
            <code className="font-mono text-xs">SWISSHUB_RESTORE_TEST_MAX_AGE_DAYS</code>
            <Badge variant="secondary">8</Badge>
            <span className="min-w-0 flex-1 text-muted-foreground">
              Ab wann ein Restore-Test als veraltet gilt. Angestrebt ist wöchentlich.
            </span>
          </li>
          <li className="flex flex-wrap gap-2 rounded-lg border border-border/60 p-2.5">
            <code className="font-mono text-xs">SWISSHUB_PGBACKREST_PROCESSES</code>
            <Badge variant="secondary">1</Badge>
            <span className="min-w-0 flex-1 text-muted-foreground">
              Bei zwei vCPU macht mehr Parallelität die Sicherung nicht schneller, sondern den Bot langsamer.
            </span>
          </li>
          <li className="flex flex-wrap gap-2 rounded-lg border border-border/60 p-2.5">
            <code className="font-mono text-xs">archive_timeout</code>
            <Badge variant="secondary">300 s</Badge>
            <span className="min-w-0 flex-1 text-muted-foreground">
              In <code className="font-mono">postgresql.conf</code>. Die Zeile, an der der erreichbare RPO
              hängt: ohne sie wird ein WAL-Segment erst archiviert, wenn es voll ist (16 MB) - auf einem
              ruhigen Server kann das Stunden dauern, und so alt wäre dann der jüngste erreichbare Zeitpunkt.
            </span>
          </li>
        </ul>
      </Panel>

      <Panel title="Wie die Werte geändert werden" icon={<Clock />}>
        <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Auf dem Server:{' '}
            <code className="font-mono">sudo nano /etc/swisshub-backup/swisshub-backup.env</code>
          </li>
          <li>
            Wurde etwas geändert, das pgBackRest betrifft (Aufbewahrung, Prozesse, S3):
            <br />
            <code className="font-mono">sudo swisshub-backup konfiguration-schreiben</code>
            <br />
            <span className="text-xs">
              Das erzeugt <code className="font-mono">pgbackrest.conf</code> neu - sie ist eine erzeugte Datei
              und wird nicht von Hand bearbeitet.
            </span>
          </li>
          <li>
            Prüfen, ob noch alles läuft: <code className="font-mono">sudo swisshub-backup einrichten</code>
          </li>
          <li>
            Zeitpläne: <code className="font-mono">sudo systemctl edit swisshub-backup-taeglich.timer</code>
          </li>
          <li>
            Die ganze Anlage gefahrlos durchprobieren - auf einem Wegwerf-Cluster, ohne die Produktion zu
            berühren: <code className="font-mono">sudo swisshub-backup-selbsttest</code>
          </li>
        </ol>
      </Panel>
    </>
  );
}
