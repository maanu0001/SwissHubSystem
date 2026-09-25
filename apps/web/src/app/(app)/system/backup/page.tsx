import type { Metadata } from 'next';
import {
  Archive,
  CheckCircle2,
  Clock,
  CloudUpload,
  DatabaseBackup,
  FileStack,
  KeyRound,
  Play,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { can } from '@swisshub/auth';
import { backup } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { BackupAbschnittsNav } from '@/modules/backup/components/abschnitts-nav';
import { AktionKnopf } from '@/modules/backup/components/aktion-knopf';
import {
  bytesLesbar,
  dauerLesbar,
  laufLabel,
  rpoLesbar,
  vorWieLange,
  zeitLesbar,
} from '@/modules/backup/darstellung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { backupAbschnitte } from './abschnitte';

export const metadata: Metadata = { title: 'Backup & Recovery' };
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht.
 *
 * ==========================================================================
 * WAS DIESE SEITE ZEIGT UND WAS SIE NICHT ZEIGT
 * ==========================================================================
 *
 * Sie zeigt **gemessene** Werte. «Letzter erfolgreicher Restore-Test: vor
 * 3 Tagen» ist eine Messung; «RTO: 2 Stunden» wäre eine Absicht. Absichten
 * stehen in der Dokumentation, nicht hier - eine Oberfläche, die ein Ziel als
 * Zustand zeigt, sagt im Ernstfall etwas Falsches.
 *
 * Sie zeigt **keinen einzigen Schlüsselwert**. Vom Hauptschlüssel erscheint
 * höchstens seine Kennung - acht Zeichen aus einem SHA-256, genug um zu
 * erkennen, ob der gesicherte derselbe ist wie der laufende, und zu wenig, um
 * damit etwas anzufangen.
 *
 * Und sie zeigt ausdrücklich die Fehlschläge. Ein Backup-Dashboard, das nur
 * grüne Haken kennt, ist genau das Dashboard, dem man im Ernstfall nicht
 * glauben kann.
 * ==========================================================================
 */
export default async function BackupUebersichtSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(backup.BACKUP_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);
  const darfStarten = can(context, backup.BACKUP_PERMISSIONS.run);
  const darfTesten = can(context, backup.BACKUP_PERMISSIONS.test);

  const [zustand, laufende, freigaben] = await Promise.all([
    backup.leseBackupZustand(),
    backup.leseLaufende(),
    can(context, backup.BACKUP_PERMISSIONS.points) ? backup.listeFreigaben(50) : Promise.resolve([]),
  ]);

  const offeneFreigaben = freigaben.filter((zeile) => zeile.status === 'ANGEFORDERT').length;
  const befunde = (zustand.monitor?.fehler ?? 0) + (zustand.verify?.fehler ?? 0);
  const abschnitte = backupAbschnitte(context, { offeneFreigaben, befunde });

  if (!zustand.erreichbar) {
    return (
      <>
        <BackupAbschnittsNav abschnitte={abschnitte} />
        <ErrorState title="Die Backup-Anlage ist nicht erreichbar" description={zustand.grund} />
        <Panel title="Was jetzt zu tun ist" icon={<TriangleAlert />}>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Diese Seite liest Zustandsdateien, die die Backup-Anlage auf dem Server schreibt. Sie sind nicht
              da - also läuft die Anlage nicht, oder das Verzeichnis ist im Container nicht eingehängt.
            </p>
            <p className="font-medium text-foreground">
              Solange hier nichts steht, gibt es keine geprüfte Sicherung. Das ist der Zustand, in dem ein
              Serverausfall alles kostet.
            </p>
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                Auf dem Server: <code className="font-mono">sudo bash deploy/backup/install.sh</code>
              </li>
              <li>
                Konfiguration ausfüllen:{' '}
                <code className="font-mono">/etc/swisshub-backup/swisshub-backup.env</code>
              </li>
              <li>
                Anlage prüfen: <code className="font-mono">swisshub-backup-selbsttest</code>
              </li>
              <li>
                Einzelheiten: <code className="font-mono">docs/BACKUP.md</code>
              </li>
            </ol>
          </div>
        </Panel>
      </>
    );
  }

  // --- Die Kennzahlen ------------------------------------------------------
  //
  // Jede davon ist eine Messung. Wo nichts gemessen wurde, steht «nie» oder
  // «nicht gemessen» - nie eine Schätzung.
  const punkte = zustand.wiederherstellungspunkte;
  const letzterErfolgDb =
    (zustand['letzter-erfolg-db-incr'] as backup.LetzterLauf | undefined) ??
    (zustand['letzter-erfolg-db-diff'] as backup.LetzterLauf | undefined) ??
    (zustand['letzter-erfolg-db-full'] as backup.LetzterLauf | undefined);
  const letzterErfolgDateien = zustand['letzter-erfolg-dateien'] as backup.LetzterLauf | undefined;
  const letzterFehlschlag = (zustand.laeufe ?? []).find((lauf) => lauf.status === 'fehler');
  const test = zustand['restore-test'];

  const walAbstand = zustand.wal?.abstand_s;
  const walTon =
    zustand.wal?.archive_mode !== 'on' && zustand.wal?.archive_mode !== 'always'
      ? 'destructive'
      : (walAbstand ?? 0) > 900
        ? 'warning'
        : 'success';

  return (
    <>
      <BackupAbschnittsNav abschnitte={abschnitte} />

      {/* Die Befunde zuerst. Wer hierher kommt, will zuerst wissen, ob etwas
          kaputt ist - und nicht, wie viele Gigabyte gesichert sind. */}
      {zustand.monitor && (zustand.monitor.fehler ?? 0) > 0 ? (
        <section
          aria-label="Aktuelle Warnungen"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {zustand.monitor.fehler} kritische{zustand.monitor.fehler === 1 ? 'r' : ''} Befund
            {zustand.monitor.fehler === 1 ? '' : 'e'}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(zustand.monitor.befunde ?? [])
              .filter((befund) => befund.stufe === 'kritisch')
              .map((befund) => (
                <li key={befund.kennung} className="text-muted-foreground">
                  <span className="font-mono text-xs text-destructive">{befund.kennung}</span> {befund.text}
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Erhoben {vorWieLange(zustand.monitor.zeit)}. Die Überwachung läuft alle 15 Minuten und meldet
            zusätzlich über einen Weg, der nicht von diesem Server abhängt.
          </p>
        </section>
      ) : null}

      {zustand.monitor && (zustand.monitor.warnungen ?? 0) > 0 ? (
        <section aria-label="Hinweise" className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {zustand.monitor.warnungen} Hinweis{zustand.monitor.warnungen === 1 ? '' : 'e'}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(zustand.monitor.befunde ?? [])
              .filter((befund) => befund.stufe === 'warnung')
              .map((befund) => (
                <li key={befund.kennung} className="text-muted-foreground">
                  <span className="font-mono text-xs text-warning">{befund.kennung}</span> {befund.text}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {/* --- A) Übersicht --- */}
      <section
        aria-label="Zustand der Sicherungen"
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]"
      >
        <StatCard
          label="Datenbank gesichert"
          value={vorWieLange(letzterErfolgDb?.zeit)}
          hint={letzterErfolgDb ? zeitLesbar(letzterErfolgDb.zeit) : 'Noch kein erfolgreicher Lauf'}
          icon={<DatabaseBackup />}
          tone={letzterErfolgDb ? 'success' : 'destructive'}
        />
        <StatCard
          label="Uploads gesichert"
          value={vorWieLange(letzterErfolgDateien?.zeit)}
          hint={
            letzterErfolgDateien
              ? `${bytesLesbar(letzterErfolgDateien.bytes)} erfasst`
              : 'Noch kein erfolgreicher Lauf'
          }
          icon={<FileStack />}
          tone={letzterErfolgDateien ? 'success' : 'destructive'}
        />
        <StatCard
          label="WAL-Archivierung"
          value={
            zustand.wal?.archive_mode === 'on' || zustand.wal?.archive_mode === 'always'
              ? `${walAbstand ?? '?'} s`
              : 'aus'
          }
          hint={
            zustand.wal
              ? `${zustand.wal.archiviert ?? 0} archiviert, ${zustand.wal.gescheitert ?? 0} Fehlschläge`
              : 'Nie erhoben'
          }
          icon={<Clock />}
          tone={walTon}
        />
        <StatCard
          label="Externe Kopie"
          value={zustand.extern?.status === 'erfolg' ? vorWieLange(zustand.extern.zeit) : 'keine'}
          hint={zustand.extern?.ziel ?? 'Nicht eingerichtet - ein Serververlust kostet dann alle Sicherungen'}
          icon={<CloudUpload />}
          tone={zustand.extern?.status === 'erfolg' ? 'success' : 'destructive'}
        />
        <StatCard
          label="Letzter Restore-Test"
          value={test?.zeit ? vorWieLange(test.zeit) : 'nie'}
          hint={
            test?.ergebnis === 'erfolg'
              ? `Bestanden, Datenbank in ${dauerLesbar(test.dauer_restore_s)} wiederhergestellt`
              : test?.ergebnis === 'fehler'
                ? `Gescheitert: ${test.fehler} Prüfung${test.fehler === 1 ? '' : 'en'} fehlerhaft`
                : 'Ohne ihn ist unbewiesen, dass sich etwas wiederherstellen lässt'
          }
          icon={<ShieldCheck />}
          tone={test?.ergebnis === 'erfolg' ? 'success' : 'destructive'}
        />
        <StatCard
          label="Gemessenes RPO"
          value={rpoLesbar(test?.gemessenes_rpo_s ?? walAbstand ?? null)}
          hint="Gemessen im letzten Restore-Test bzw. am Abstand der WAL-Archivierung. Kein Zielwert."
          icon={<Clock />}
          tone={
            (test?.gemessenes_rpo_s ?? walAbstand ?? Number.POSITIVE_INFINITY) <= 900 ? 'success' : 'warning'
          }
        />
        <StatCard
          label="Ältester Punkt"
          value={punkte?.aeltester ? vorWieLange(punkte.aeltester) : '–'}
          hint={punkte?.aeltester ? zeitLesbar(punkte.aeltester) : 'Keine Sicherung vorhanden'}
          icon={<Archive />}
        />
        <StatCard
          label="Letzter Fehlschlag"
          value={letzterFehlschlag ? vorWieLange(letzterFehlschlag.beginn) : 'keiner'}
          hint={
            letzterFehlschlag
              ? `${laufLabel(letzterFehlschlag.art)}: ${letzterFehlschlag.meldung}`
              : 'In der aufbewahrten Historie steht kein Fehlschlag.'
          }
          icon={letzterFehlschlag ? <TriangleAlert /> : <CheckCircle2 />}
          tone={letzterFehlschlag ? 'warning' : 'success'}
        />
      </section>

      {/* Der Schlüsselzustand - ohne einen Wert zu zeigen. */}
      <Panel
        title="Schlüssel und Wiederherstellungspaket"
        icon={<KeyRound />}
        description="Ob die Schlüssel gesichert sind - ohne ihre Werte."
      >
        {zustand.geheimnisse ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Paket erzeugt</dt>
              <dd className="mt-1 text-sm">
                {vorWieLange(zustand.geheimnisse.zeit)}{' '}
                <span className="text-muted-foreground">({bytesLesbar(zustand.geheimnisse.bytes)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Kennung des Hauptschlüssels</dt>
              <dd className="mt-1 font-mono text-sm">{zustand.geheimnisse.master_key_kennung ?? '–'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Empfänger</dt>
              <dd className="mt-1 text-sm">
                {zustand.geheimnisse.empfaenger ?? 0}
                {(zustand.geheimnisse.empfaenger ?? 0) < 2 ? (
                  <Badge variant="warning" className="ml-2">
                    nur einer
                  </Badge>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Auch extern</dt>
              <dd className="mt-1 text-sm">
                {zustand.geheimnisse.in_repository === 'ja' ? (
                  <Badge variant="success">ja</Badge>
                ) : (
                  <Badge variant="warning">nur lokal</Badge>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2 space-y-2 border-t border-border/60 pt-3 text-sm text-muted-foreground">
              <p>
                Das Paket enthält den <code className="font-mono">MASTER_ENCRYPTION_KEY</code>, die{' '}
                <code className="font-mono">.env</code>, die Repository-Passwörter und eine Kurzanleitung. Es
                ist mit <code className="font-mono">age</code> auf öffentliche Empfängerschlüssel
                verschlüsselt.
              </p>
              <p className="font-medium text-foreground">
                Der Server kann es schreiben und danach selbst nicht lesen.
              </p>
              <p>
                Der private Schlüssel liegt nicht auf diesem Server. Wer den Server übernimmt, bekommt die
                Pakete - und kann mit ihnen nichts anfangen. Genau deshalb braucht es zum Schreiben keinen
                Entschlüsselungsschlüssel.
              </p>
              {zustand['geheimnisse-geprueft']?.zeit ? (
                <p>
                  Zuletzt mit dem privaten Schlüssel geöffnet und geprüft:{' '}
                  {zeitLesbar(zustand['geheimnisse-geprueft'].zeit)}
                </p>
              ) : (
                <p className="text-warning">
                  Das Paket wurde noch nie mit dem privaten Schlüssel geöffnet. Ob es sich öffnen lässt, ist
                  damit unbewiesen - das gehört in die vierteljährliche Übung.
                </p>
              )}
            </div>
          </dl>
        ) : (
          <ErrorState
            title="Es gibt kein Wiederherstellungspaket"
            description="Der MASTER_ENCRYPTION_KEY liegt damit nur auf diesem Server. Geht er verloren, sind Bot-Token, Discord-OAuth und AI-Schlüssel aus der Datenbanksicherung dauerhaft unlesbar - die Sicherung wäre technisch fehlerfrei und trotzdem unvollständig."
          />
        )}
      </Panel>

      {/* Die sechs Prüfstufen. */}
      <Panel
        title="Prüfstufen"
        icon={<ShieldCheck />}
        description="Ein abgeschlossener Kopiervorgang ist kein wiederherstellbares Backup."
        action={{ label: 'Historie', href: '/system/backup/historie' }}
      >
        <div className="space-y-4">
          {zustand.verify ? (
            <ul className="space-y-2">
              {(zustand.verify.befunde ?? []).map((befund) => (
                <li
                  key={`${befund.stufe}-${befund.name}`}
                  className="flex flex-wrap items-start gap-2 rounded-lg border border-border/60 p-3 text-sm"
                >
                  <Badge
                    variant={
                      befund.ergebnis === 'erfolg'
                        ? 'success'
                        : befund.ergebnis === 'warnung'
                          ? 'warning'
                          : 'destructive'
                    }
                  >
                    Stufe {befund.stufe}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{befund.name}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{befund.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Noch nicht geprüft"
              description="Die Stufen 1 bis 4 prüfen Vollständigkeit, Integrität, die externe Kopie und die WAL-Kette."
            />
          )}

          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-sm font-medium">Stufen 5 und 6: der Restore-Test</p>
            {test ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {test.ergebnis === 'erfolg'
                    ? `Bestanden am ${zeitLesbar(test.zeit)}. ${test.pruefungen?.length ?? 0} Prüfungen, Datenbank in ${dauerLesbar(test.dauer_restore_s)} wiederhergestellt.`
                    : `Gescheitert am ${zeitLesbar(test.zeit)}: ${test.fehler} Prüfung(en) fehlerhaft.`}
                </p>
                {test.hinweis ? <p className="mt-2 text-xs text-muted-foreground">{test.hinweis}</p> : null}
                <ul className="mt-3 space-y-1 text-xs">
                  {(test.pruefungen ?? []).map((pruefung) => (
                    <li key={pruefung.name} className="flex gap-2">
                      <span
                        className={pruefung.ergebnis === 'erfolg' ? 'text-success' : 'text-destructive'}
                        aria-hidden="true"
                      >
                        {pruefung.ergebnis === 'erfolg' ? '✓' : '✗'}
                      </span>
                      <span className="font-mono text-muted-foreground">{pruefung.name}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{pruefung.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-sm text-destructive">
                Nie ausgeführt. Damit ist unbewiesen, dass sich aus diesen Sicherungen etwas wiederherstellen
                lässt - und das ist der Befund, der alle übrigen grünen Haken entwertet.
              </p>
            )}
          </div>
        </div>
      </Panel>

      {/* --- C) Backup erstellen --- */}
      {darfStarten || darfTesten ? (
        <Panel
          title="Sicherung ausser der Reihe"
          icon={<Play />}
          description="Legt eine Anforderung ab. Der Controller arbeitet sie ab."
        >
          <div className="space-y-4">
            {laufende.length > 0 ? (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium text-primary">
                  {laufende.length} Anforderung{laufende.length === 1 ? '' : 'en'} läuft gerade
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {laufende.map((eintrag) => (
                    <li key={eintrag.kennung}>
                      <span className="font-mono">{eintrag.operation}</span> seit{' '}
                      {vorWieLange(eintrag.begonnen)} · {eintrag.beschreibung}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Die Werkzeuge haben eine Sperre: ein zweiter Lauf derselben Art wird übersprungen, nicht
                  parallel ausgeführt.
                </p>
              </div>
            ) : null}

            {darfStarten ? (
              <div className="flex flex-wrap gap-2">
                <AktionKnopf
                  operation="backup-datenbank"
                  label="Datenbank (differentiell)"
                  beschreibung="Ein differentielles Basis-Backup - schnell, baut auf dem letzten Vollbackup auf."
                  csrfToken={csrfToken}
                />
                <AktionKnopf
                  operation="backup-datenbank-voll"
                  label="Datenbank (vollständig)"
                  csrfToken={csrfToken}
                  bestaetigung={{
                    titel: 'Vollständiges Basis-Backup starten?',
                    text: 'Ein Vollbackup liest die ganze Datenbank und belastet den Server merklich. Der Discord-Bot läuft daneben weiter, wird aber langsamer. Das dauert je nach Datenmenge Minuten bis Stunden.',
                  }}
                />
                <AktionKnopf operation="backup-dateien" label="Uploads" csrfToken={csrfToken} />
                <AktionKnopf operation="backup-konfiguration" label="Konfiguration" csrfToken={csrfToken} />
                <AktionKnopf
                  operation="backup-geheimnisse"
                  label="Wiederherstellungspaket"
                  beschreibung="Erzeugt das age-verschlüsselte Paket neu. Nötig nach jeder Änderung an der .env."
                  csrfToken={csrfToken}
                />
                <AktionKnopf operation="backup-extern" label="Extern übertragen" csrfToken={csrfToken} />
                <AktionKnopf operation="pruefen" label="Prüfen (Stufen 1–4)" csrfToken={csrfToken} />
                <AktionKnopf
                  operation="pruefen-tief"
                  label="Tief prüfen"
                  csrfToken={csrfToken}
                  bestaetigung={{
                    titel: 'Tiefe Prüfung starten?',
                    text: 'Dabei wird ein Teil der Nutzdaten wirklich gelesen und gegen die Prüfsummen gehalten. Das findet stille Bitfehler - und kostet erheblich I/O. Gedacht für den wöchentlichen Lauf.',
                  }}
                />
              </div>
            ) : null}

            {darfTesten ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                <AktionKnopf
                  operation="restore-test"
                  label="Restore-Test starten"
                  variante="secondary"
                  csrfToken={csrfToken}
                  bestaetigung={{
                    titel: 'Restore-Test starten?',
                    text: 'Eine Sicherung wird in einer isolierten Umgebung wiederhergestellt und geprüft: eigener Port, eigenes Datenverzeichnis, keine Anwendung, kein Netzwerk. Die Produktion wird nicht berührt. Der Server ist dabei deutlich belastet.',
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Der einzige Nachweis, der zählt. Alles andere prüft, ob Dateien da sind - dies prüft, ob
                  daraus eine Datenbank wird.
                </p>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Diese Knöpfe führen nichts aus. Sie legen eine Anforderung in einem Verzeichnis ab; ein Dienst
              unter einem anderen Benutzer prüft sie gegen eine feste Liste erlaubter Operationen und führt
              aus. Ein produktiver Restore steht nicht auf dieser Liste - er lässt sich von hier aus nicht
              auslösen.
            </p>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
