import type { Metadata } from 'next';
import { Archive, FileSearch, RotateCcw, ShieldAlert, Terminal } from 'lucide-react';
import { can } from '@swisshub/auth';
import { backup } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { ErrorState } from '@/components/shared/states';
import { BackupAbschnittsNav } from '@/modules/backup/components/abschnitts-nav';
import { AktionKnopf } from '@/modules/backup/components/aktion-knopf';
import { FreigabeListe } from '@/modules/backup/components/freigabe-liste';
import { RestoreAnfordern } from '@/modules/backup/components/restore-anfordern';
import {
  bytesLesbar,
  repoLabel,
  vorWieLange,
  zeitFuerBefehl,
  zeitLesbar,
} from '@/modules/backup/darstellung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { backupAbschnitte } from '../abschnitte';

export const metadata: Metadata = { title: 'Recovery Center' };
export const dynamic = 'force-dynamic';

/**
 * E) Das Recovery Center.
 *
 * ==========================================================================
 * WARUM HIER KEIN KNOPF «WIEDERHERSTELLEN» STEHT
 * ==========================================================================
 *
 * Das ist die Stelle, an der man ihn erwartet, und deshalb gehört die
 * Begründung hierher und nicht in eine Fussnote.
 *
 * Ein produktiver Restore verwirft alles, was nach dem Zielzeitpunkt geschehen
 * ist. Er ist die destruktivste Operation des Systems. Ein Knopf dafür in einer
 * Oberfläche, die aus dem Internet erreichbar ist, wäre aus zwei Richtungen
 * falsch: er lässt sich versehentlich drücken, und er ist das Erste, was jemand
 * benutzt, der sich Zugang verschafft hat.
 *
 * Stattdessen drei Hürden:
 *
 *   1. ANFORDERN      hier, mit Pflichtbegründung
 *   2. FREIGEBEN      hier, durch eine ZWEITE Person
 *   3. AUSFÜHREN      auf der Kommandozeile, von einem Menschen,
 *                     mit `swisshub-recovery`
 *
 * Was hier dagegen sehr wohl geht, weil es nichts verwirft: ein PROBELAUF
 * (`pgbackrest --dry-run` liest das Manifest und sagt, was es täte) und ein
 * RESTORE-TEST in einer isolierten Umgebung.
 * ==========================================================================
 */
export default async function RecoveryCenterSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(backup.BACKUP_PERMISSIONS.points);
  const csrfToken = csrfTokenFor(context);
  const darfTesten = can(context, backup.BACKUP_PERMISSIONS.test);
  const darfAnfordern = can(context, backup.BACKUP_PERMISSIONS.restoreRequest);
  const darfFreigeben = can(context, backup.BACKUP_PERMISSIONS.restoreApprove);

  const [zustand, freigaben] = await Promise.all([backup.leseBackupZustand(), backup.listeFreigaben(25)]);

  const offene = freigaben.filter((zeile) => zeile.status === 'ANGEFORDERT').length;
  const abschnitte = backupAbschnitte(context, {
    offeneFreigaben: offene,
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

  const punkte = zustand.wiederherstellungspunkte?.punkte ?? [];
  const datenbankPunkte = punkte.filter((punkt) => punkt.art === 'datenbank');
  const dateiPunkte = punkte.filter((punkt) => punkt.art === 'dateien');

  /**
   * Der Befehl, den ein Administrator nach der Freigabe ausführt.
   *
   * Zusammengesetzt hier und nicht im Browser: der Zeitpunkt muss genau die
   * Form haben, die `--zeit` versteht, und wer sie abschreibt, soll keinen
   * Fehler machen können.
   */
  const befehlFuer = (zielZeitpunkt: Date | null): string => {
    const zeit = zielZeitpunkt ? ` --zeit '${zeitFuerBefehl(zielZeitpunkt)}'` : '';
    return `sudo swisshub-recovery wiederherstellen --repo 1${zeit}`;
  };

  return (
    <>
      <BackupAbschnittsNav abschnitte={abschnitte} />

      {/* --- Die verfügbaren Punkte --- */}
      <Panel
        title="Verfügbare Wiederherstellungspunkte"
        icon={<Archive />}
        description={
          zustand.wiederherstellungspunkte?.aeltester
            ? `Ansteuerbar von ${zeitLesbar(zustand.wiederherstellungspunkte.aeltester)} bis zum jüngsten archivierten WAL-Segment.`
            : 'Es liegt keine Sicherung vor.'
        }
        action={{ label: 'Alle Punkte', href: '/system/backup/historie' }}
      >
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">Datenbank</h3>
            {datenbankPunkte.length === 0 ? (
              <p className="mt-1 text-sm text-destructive">
                Kein Basis-Backup. Ohne eines ist kein Zeitpunkt erreichbar - die WAL-Kette allein ergibt
                keine Datenbank.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {datenbankPunkte.slice(0, 8).map((punkt) => {
                  const ort = repoLabel(punkt.repo);
                  const passend = punkt.ende
                    ? backup.passendeDateisicherung(punkte, new Date(punkt.ende))
                    : null;
                  return (
                    <li
                      key={punkt.kennung}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5 text-sm"
                    >
                      <Badge variant={punkt.typ === 'full' ? 'default' : 'secondary'}>{punkt.typ}</Badge>
                      <span className="font-mono text-xs">{punkt.kennung}</span>
                      <span className="text-muted-foreground">{zeitLesbar(punkt.ende)}</span>
                      <span className="text-xs text-muted-foreground">{bytesLesbar(punkt.bytes)}</span>
                      <Badge variant={ort.extern ? 'success' : 'warning'}>{ort.text}</Badge>
                      {/* Der wichtigste Hinweis der ganzen Liste: gibt es zu
                          diesem Datenbankstand überhaupt passende Dateien? */}
                      {passend ? (
                        <span className="text-xs text-success">Dateien vorhanden ({passend.kennung})</span>
                      ) : (
                        <span className="text-xs text-destructive">
                          keine passende Dateisicherung - Uploads wären totverweisend
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold">Uploads</h3>
            {dateiPunkte.length === 0 ? (
              <p className="mt-1 text-sm text-destructive">Keine Dateisicherung.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {dateiPunkte.slice(0, 5).map((punkt) => (
                  <li
                    key={punkt.kennung}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5 text-sm"
                  >
                    <span className="font-mono text-xs">{punkt.kennung}</span>
                    <span className="text-muted-foreground">{zeitLesbar(punkt.beginn)}</span>
                    <span className="text-xs text-muted-foreground">{vorWieLange(punkt.beginn)}</span>
                    {punkt.db_zeitpunkt ? (
                      <span className="text-xs text-muted-foreground">
                        zum DB-Stand {punkt.db_zeitpunkt.slice(0, 19)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Warum zu jedem Datenbankstand eine gleich alte oder jüngere Dateisicherung gehört
            </p>
            <p className="mt-1">
              Die Uploads werden unter serverseitig erzeugten Namen genau einmal geschrieben und danach nie
              geändert. Eine Dateisicherung, die <em>nicht älter</em> ist als der Zielzeitpunkt, enthält
              deshalb jede Datei, auf die diese Datenbank verweist. Umgekehrt gilt es nicht: eine ältere lässt
              Verweise ins Leere zeigen - ein wiederhergestelltes Ticket mit einem Verlauf, den es nicht mehr
              gibt. Überzählige Dateien sind dagegen harmlos.
            </p>
          </div>
        </div>
      </Panel>

      {/* --- Was gefahrlos geht --- */}
      {darfTesten ? (
        <Panel
          title="Probelauf und Restore-Test"
          icon={<FileSearch />}
          description="Beides verändert nichts an der Produktion."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <AktionKnopf
                operation="restore-probelauf"
                label="Probelauf"
                beschreibung="pgbackrest --dry-run: liest das Manifest und sagt, welche Dateien es anfassen würde."
                csrfToken={csrfToken}
              />
              <AktionKnopf
                operation="restore-test"
                label="Restore-Test (isoliert)"
                variante="secondary"
                csrfToken={csrfToken}
                bestaetigung={{
                  titel: 'Restore-Test starten?',
                  text: 'Die Sicherung wird in einer isolierten Umgebung wiederhergestellt und geprüft: eigener Port, eigenes Datenverzeichnis, keine Anwendung, bei Docker kein Netzwerk. Die Produktion wird nicht berührt.',
                }}
              />
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <strong className="text-foreground">Probelauf:</strong> rechnet durch, was eine
                Wiederherstellung täte, und schreibt nichts.
              </li>
              <li>
                <strong className="text-foreground">Restore-Test:</strong> stellt wirklich her - in einer
                Umgebung, die nichts mit der Produktion teilt. Kein Bot startet, keine Webhooks, keine
                Discord-Aktionen, <code className="font-mono">archive_mode=off</code> (ohne das schriebe der
                Testcluster in das produktive WAL-Archiv und beschädigte genau die Sicherung, die er prüft).
              </li>
            </ul>
          </div>
        </Panel>
      ) : null}

      {/* --- Einzelne Daten zurückholen --- */}
      <Panel
        title="Einzelne Daten zurückholen"
        icon={<RotateCcw />}
        description="Nicht jeder Fehler braucht einen vollständigen Restore."
      >
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Für die häufigen Fälle gibt es Wege, die nichts verwerfen. Sie laufen auf der Kommandozeile, weil
            sie ein Urteil brauchen - welche Datei, welcher Datensatz, welcher Stand.
          </p>

          <dl className="space-y-3">
            <div className="rounded-lg border border-border/60 p-3">
              <dt className="font-medium">Eine einzelne hochgeladene Datei ist weg</dt>
              <dd className="mt-1 space-y-1 text-muted-foreground">
                <p>
                  Sucht über <em>alle</em> Snapshots - auch die, in denen sie noch existierte:
                </p>
                <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
                  sudo swisshub-recovery datei &lt;teil-des-namens&gt;
                </pre>
                <p>
                  Zurückgeholt wird in ein Nebenverzeichnis, nicht über die Produktion. Der Dateiname steht in
                  der Datenbank - er ist serverseitig erzeugt und hat mit dem Namen aus dem Browser nichts zu
                  tun.
                </p>
              </dd>
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <dt className="font-medium">Das ganze Upload-Verzeichnis ist weg</dt>
              <dd className="mt-1 space-y-1 text-muted-foreground">
                <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
                  sudo swisshub-recovery verzeichnis
                </pre>
                <p>
                  Der bisherige Stand wird beiseitegelegt und nicht gelöscht - wer den falschen Snapshot
                  gewählt hat, verliert dadurch nicht auch das, was vorher da war.
                </p>
              </dd>
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <dt className="font-medium">Ein einzelner Datensatz wurde versehentlich gelöscht</dt>
              <dd className="mt-1 space-y-1 text-muted-foreground">
                <p>
                  Der wichtigste Fall - und der, bei dem ein produktiver Restore der falsche Weg wäre: er
                  würde auch alle übrigen Änderungen seit damals verwerfen.
                </p>
                <ol className="ml-4 list-decimal space-y-1">
                  <li>
                    Die Datenbank auf den Zeitpunkt davor in einer <strong>isolierten</strong> Umgebung
                    wiederherstellen:
                    <pre className="mt-1 overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
                      sudo swisshub-restore-test --zeit &apos;2026-09-25 14:31:00+02&apos; --behalten
                    </pre>
                  </li>
                  <li>
                    Dort nachsehen und die gesuchten Zeilen exportieren (
                    <code className="font-mono">pg_dump --table=… --data-only</code>).
                  </li>
                  <li>
                    In die Produktion einspielen - in einer Transaktion, mit Prüfung, und mit einem
                    Audit-Eintrag dazu.
                  </li>
                  <li>Den Testcluster löschen. Er enthält echte Zugangsdaten.</li>
                </ol>
                <p className="text-foreground">
                  Ein physischer Restore stellt immer den <em>ganzen Cluster</em> her, nie eine Tabelle.
                  Deshalb dieser Umweg - und deshalb ist er der richtige Weg und keine Notlösung.
                </p>
              </dd>
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <dt className="font-medium">Eine Datenbankmigration ist schiefgegangen</dt>
              <dd className="mt-1 space-y-1 text-muted-foreground">
                <p>
                  Ein Git-Rollback stellt kein altes Datenbankschema wieder her - er ändert nur den Quelltext.
                  Die Reihenfolge ist:
                </p>
                <ol className="ml-4 list-decimal space-y-1">
                  <li>Deployment anhalten, damit nicht erneut migriert wird.</li>
                  <li>
                    Den Zustand in einer isolierten Umgebung ansehen: ist die Migration teilweise
                    durchgelaufen?
                  </li>
                  <li>
                    Wenn Daten verloren gingen: hier einen produktiven Restore auf den Zeitpunkt <em>vor</em>{' '}
                    dem Deployment anfordern.
                  </li>
                  <li>
                    Wenn nur das Schema falsch ist: eine korrigierende Migration ist der bessere Weg - sie
                    verwirft nichts.
                  </li>
                </ol>
              </dd>
            </div>
          </dl>
        </div>
      </Panel>

      {/* --- Der produktive Restore: anfordern und freigeben --- */}
      <Panel
        title="Produktiver Restore"
        icon={<ShieldAlert />}
        description="Drei Hürden: anfordern, freigeben durch eine zweite Person, ausführen auf der Kommandozeile."
      >
        <div className="space-y-4">
          <section
            aria-label="Warum es hier keinen Knopf gibt"
            className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm"
          >
            <p className="flex items-center gap-2 font-medium">
              <Terminal className="size-4 shrink-0" aria-hidden="true" />
              In dieser Oberfläche gibt es keinen Knopf, der die Produktion zurücksetzt.
            </p>
            <p className="mt-2 text-muted-foreground">
              Das ist eine Entscheidung und keine fehlende Funktion. Ein produktiver Restore verwirft alles
              nach dem Zielzeitpunkt; ein Knopf dafür in einer Oberfläche, die aus dem Internet erreichbar
              ist, lässt sich versehentlich drücken und ist das Erste, was jemand benutzt, der sich Zugang
              verschafft hat.
            </p>
            <p className="mt-2 text-muted-foreground">
              Der Controller, der Anforderungen dieser WebApp ausführt, kennt die Operation nicht - sie steht
              nicht auf seiner Liste. Auch eine vollständig übernommene WebApp kann sie deshalb nicht
              auslösen.
            </p>
          </section>

          <FreigabeListe
            freigaben={freigaben.map((zeile) => ({
              id: zeile.id,
              umfangLabel: zeile.umfangLabel,
              zielZeitpunkt: zeile.zielZeitpunkt ? zeitLesbar(zeile.zielZeitpunkt) : null,
              begruendung: zeile.begruendung,
              angefordertVon: zeile.angefordertVon,
              angefordertVonName: zeile.angefordertVonName,
              angefordertAm: zeile.angefordertAm.toISOString(),
              freigegebenVonName: zeile.freigegebenVonName,
              freigegebenAm: zeile.freigegebenAm?.toISOString() ?? null,
              gueltigBis: zeile.gueltigBis.toISOString(),
              status: zeile.status,
              jetztGueltig: zeile.jetztGueltig,
              befehl: befehlFuer(zeile.zielZeitpunkt),
            }))}
            csrfToken={csrfToken}
            eigeneDiscordId={context.user.discordId}
            darfFreigeben={darfFreigeben}
          />
        </div>
      </Panel>

      {darfAnfordern ? <RestoreAnfordern csrfToken={csrfToken} /> : null}
    </>
  );
}
