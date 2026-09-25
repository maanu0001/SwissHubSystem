import type { Metadata } from 'next';
import { AlertOctagon, ClipboardList, KeyRound, ServerCrash, Siren, Terminal } from 'lucide-react';
import { backup } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { BackupAbschnittsNav } from '@/modules/backup/components/abschnitts-nav';
import { dauerLesbar, vorWieLange, zeitLesbar } from '@/modules/backup/darstellung';
import { requirePagePermission } from '@/server/auth';
import { backupAbschnitte } from '../abschnitte';

export const metadata: Metadata = { title: 'Notfall' };
export const dynamic = 'force-dynamic';

/**
 * F) Disaster Recovery.
 *
 * ==========================================================================
 * DIESE SEITE IST DIE, DIE IM ERNSTFALL NICHT DA IST
 * ==========================================================================
 *
 * Und deshalb steht hier vor allem eines: wo die Anleitung noch liegt.
 *
 * Wenn der Server verloren ist, ist auch diese Seite verloren. Ein
 * Notfallplan, der nur in der Anwendung steht, deren Ausfall er behandelt, ist
 * kein Notfallplan. Derselbe Plan liegt deshalb an drei weiteren Orten:
 *
 *   1. IM WIEDERHERSTELLUNGSPAKET, als ANLEITUNG.txt - wer das Paket öffnen
 *      kann, hat damit auch die Anleitung.
 *   2. Im Repository, als docs/DISASTER-RECOVERY.md.
 *   3. Im Werkzeug selbst: `swisshub-recovery notfall` führt Schritt für
 *      Schritt und braucht diese Seite nicht.
 *
 * Was diese Seite tut, solange es sie gibt: sie zeigt, ob eine
 * Wiederherstellung heute möglich WÄRE - und benennt jede Lücke.
 * ==========================================================================
 */
export default async function NotfallSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(backup.BACKUP_PERMISSIONS.view);
  const [zustand, freigaben] = await Promise.all([
    backup.leseBackupZustand(),
    backup.listeFreigaben(50).catch(() => []),
  ]);
  const abschnitte = backupAbschnitte(context, {
    offeneFreigaben: freigaben.filter((zeile) => zeile.status === 'ANGEFORDERT').length,
    befunde: zustand.monitor?.fehler ?? 0,
  });

  /**
   * Die Voraussetzungen einer Wiederherstellung - jede einzeln geprüft.
   *
   * Keine Gesamtnote. «Bereit» als einzelnes Ampellicht wäre genau die Art
   * Zusage, die im Ernstfall nicht hält: es fehlt dann eine Kleinigkeit, und
   * niemand weiss, welche. Hier steht jede Voraussetzung mit dem Satz, was ihr
   * Fehlen bedeutet.
   */
  const test = zustand['restore-test'];
  const voraussetzungen: Array<{
    name: string;
    erfuellt: boolean;
    ist: string;
    folge: string;
  }> = [
    {
      name: 'Basis-Backup der Datenbank',
      erfuellt: Boolean(zustand.wiederherstellungspunkte?.jungster),
      ist: zustand.wiederherstellungspunkte?.jungster
        ? `jüngstes ${vorWieLange(zustand.wiederherstellungspunkte.jungster)}`
        : 'keines vorhanden',
      folge: 'Ohne Basis-Backup ist kein Zeitpunkt erreichbar - die WAL-Kette allein ergibt keine Datenbank.',
    },
    {
      name: 'WAL-Archivierung',
      erfuellt: zustand.wal?.archive_mode === 'on' || zustand.wal?.archive_mode === 'always',
      ist: zustand.wal
        ? `archive_mode=${zustand.wal.archive_mode}, Abstand ${zustand.wal.abstand_s ?? '?'} s`
        : 'nie erhoben',
      folge: 'Ohne sie gibt es nur die Basis-Backups selbst - kein Zeitpunkt dazwischen ist ansteuerbar.',
    },
    {
      name: 'Dateisicherung der Uploads',
      erfuellt: Boolean(zustand['letzter-erfolg-dateien']),
      ist: zustand['letzter-erfolg-dateien']
        ? `zuletzt ${vorWieLange((zustand['letzter-erfolg-dateien'] as backup.LetzterLauf).zeit)}`
        : 'keine',
      folge:
        'Die wiederhergestellte Datenbank verwiese auf Ticket-Verläufe und Antragsanhänge, die es nicht gibt.',
    },
    {
      name: 'Externe Kopie',
      erfuellt: zustand.extern?.status === 'erfolg',
      ist:
        zustand.extern?.status === 'erfolg'
          ? `${zustand.extern.ziel} · ${vorWieLange(zustand.extern.zeit)}`
          : 'keine',
      folge:
        'Ohne sie liegen alle Sicherungen auf dem Server, der verloren ist. Dann gibt es nichts wiederherzustellen.',
    },
    {
      name: 'Wiederherstellungspaket',
      erfuellt: Boolean(zustand.geheimnisse?.paket),
      ist: zustand.geheimnisse?.paket
        ? `${zustand.geheimnisse.paket} · ${vorWieLange(zustand.geheimnisse.zeit)} · Schlüsselkennung ${zustand.geheimnisse.master_key_kennung ?? '?'}`
        : 'keines',
      folge:
        'Ohne den MASTER_ENCRYPTION_KEY sind Bot-Token, Discord-OAuth und AI-Schlüssel aus der Datenbanksicherung dauerhaft unlesbar. Die Datenbank käme zurück, der Bot nicht.',
    },
    {
      name: 'Zwei Empfängerschlüssel',
      erfuellt: (zustand.geheimnisse?.empfaenger ?? 0) >= 2,
      ist: `${zustand.geheimnisse?.empfaenger ?? 0} eingetragen`,
      folge:
        'Mit nur einem ist das Paket dauerhaft verschlossen, wenn dessen privater Schlüssel verloren geht.',
    },
    {
      name: 'Paket mit dem privaten Schlüssel geöffnet',
      erfuellt: Boolean(zustand['geheimnisse-geprueft']?.zeit),
      ist: zustand['geheimnisse-geprueft']?.zeit
        ? `geprüft ${vorWieLange(zustand['geheimnisse-geprueft'].zeit)}`
        : 'nie',
      folge:
        'Ob sich das Paket öffnen lässt, ist unbewiesen. Das gehört in die vierteljährliche Übung - auf einem Rechner, auf dem der private Schlüssel liegen darf.',
    },
    {
      name: 'Restore-Test bestanden',
      erfuellt: test?.ergebnis === 'erfolg',
      ist: test ? `${test.ergebnis} · ${vorWieLange(test.zeit)}` : 'nie ausgeführt',
      folge:
        'Ohne ihn ist unbewiesen, dass sich aus diesen Sicherungen etwas wiederherstellen lässt - der Befund, der alle übrigen grünen Haken entwertet.',
    },
    {
      name: 'Prüfstufen 1 bis 4',
      erfuellt: zustand.verify?.gesamt === 'erfolg',
      ist: zustand.verify
        ? `${zustand.verify.gesamt} · ${zustand.verify.fehler ?? 0} Fehler · ${vorWieLange(zustand.verify.zeit)}`
        : 'nie geprüft',
      folge: 'Vollständigkeit, Integrität, externe Kopie und WAL-Kette sind nicht bestätigt.',
    },
  ];

  const offeneLuecken = voraussetzungen.filter((eintrag) => !eintrag.erfuellt);

  return (
    <>
      <BackupAbschnittsNav abschnitte={abschnitte} />

      {/* Zuerst das Wichtigste: wo der Plan noch liegt. */}
      <section
        aria-label="Wo der Notfallplan noch liegt"
        className="rounded-xl border border-primary/40 bg-primary/5 p-5"
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-primary">
          <Siren className="size-4 shrink-0" aria-hidden="true" />
          Im Ernstfall gibt es diese Seite nicht
        </h2>
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Wenn der Server verloren ist, ist auch diese Anwendung verloren. Ein Notfallplan, der nur in der
            Anwendung steht, deren Ausfall er behandelt, ist kein Notfallplan. Derselbe Plan liegt deshalb an
            drei weiteren Orten:
          </p>
          <ol className="ml-4 list-decimal space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Im Wiederherstellungspaket</strong>, als{' '}
              <code className="font-mono">ANLEITUNG.txt</code>. Wer das Paket öffnen kann, hat damit auch die
              Anleitung - und wer es nicht öffnen kann, braucht sie ohnehin nicht.
            </li>
            <li>
              <strong className="text-foreground">Im Repository</strong>, als{' '}
              <code className="font-mono">docs/DISASTER-RECOVERY.md</code>. Auch als Kopie im
              Restic-Repository unter der Marke <code className="font-mono">konfiguration</code>, falls GitHub
              nicht erreichbar ist.
            </li>
            <li>
              <strong className="text-foreground">Im Werkzeug selbst.</strong>{' '}
              <code className="font-mono">swisshub-recovery notfall</code> führt Schritt für Schritt und
              braucht weder diese Seite noch eine Datenbank.
            </li>
          </ol>
          <p className="font-medium">
            Das Paket und der private age-Schlüssel gehören an einen Ort, der nicht dieser Server ist. Ein
            Passwortmanager und ein Medium im Safe.
          </p>
        </div>
      </section>

      {/* Der Zustand - Lücke für Lücke. */}
      <Panel
        title="Wäre eine Wiederherstellung heute möglich?"
        icon={<ClipboardList />}
        description={
          offeneLuecken.length === 0
            ? 'Alle Voraussetzungen sind erfüllt.'
            : `${offeneLuecken.length} von ${voraussetzungen.length} Voraussetzungen fehlen.`
        }
      >
        <ul className="space-y-2">
          {voraussetzungen.map((eintrag) => (
            <li
              key={eintrag.name}
              className={
                eintrag.erfuellt
                  ? 'rounded-lg border border-border/60 p-3'
                  : 'rounded-lg border border-destructive/40 bg-destructive/5 p-3'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={eintrag.erfuellt ? 'success' : 'destructive'}>
                  {eintrag.erfuellt ? 'erfüllt' : 'fehlt'}
                </Badge>
                <span className="text-sm font-medium">{eintrag.name}</span>
                <span className="text-xs text-muted-foreground">{eintrag.ist}</span>
              </div>
              {!eintrag.erfuellt ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{eintrag.folge}</p>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          Bewusst keine Gesamtnote. «Bereit» als einzelnes Ampellicht wäre genau die Zusage, die im Ernstfall
          nicht hält - es fehlt dann eine Kleinigkeit, und niemand weiss, welche.
        </p>
      </Panel>

      {/* Die letzte durchgeführte Wiederherstellung. */}
      {zustand['letzte-wiederherstellung'] ? (
        <Panel title="Letzte durchgeführte Wiederherstellung" icon={<ServerCrash />}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Wann</dt>
              <dd className="mt-1">{zeitLesbar(zustand['letzte-wiederherstellung'].zeit)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Zielzeitpunkt</dt>
              <dd className="mt-1 font-mono text-xs">
                {zustand['letzte-wiederherstellung'].zielzeit ?? '–'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Gemessen: Datenbank wiederhergestellt in
              </dt>
              <dd className="mt-1">{dauerLesbar(zustand['letzte-wiederherstellung'].dauer_datenbank_s)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Gemessen: gesamt</dt>
              <dd className="mt-1">
                {dauerLesbar(zustand['letzte-wiederherstellung'].dauer_gesamt_s)}
                <span className="ml-1 text-xs text-muted-foreground">(ohne Serveraufsetzung)</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Validiert</dt>
              <dd className="mt-1">
                {zustand['letzte-wiederherstellung'].validiert ? (
                  <Badge variant="success">ja</Badge>
                ) : (
                  <Badge variant="destructive">nein</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Bot und Musik-Laufzeit freigegeben
              </dt>
              <dd className="mt-1">
                {zustand['letzte-wiederherstellung'].freigegeben ? (
                  <Badge variant="success">
                    ja · {zeitLesbar(zustand['letzte-wiederherstellung'].freigegeben_am)}
                  </Badge>
                ) : (
                  <Badge variant="secondary">nein</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Panel>
      ) : null}

      {/* Die Kurzanleitung. */}
      <Panel
        title="Vollständiger Serververlust - die Reihenfolge"
        icon={<AlertOctagon />}
        description="Sie ist nicht beliebig."
      >
        <div className="space-y-4 text-sm">
          <ol className="space-y-3">
            {[
              [
                '1',
                'Neuen Server aufsetzen',
                'Ubuntu 24.04, Docker, nginx. Die PostgreSQL-Hauptversion muss zur Sicherung passen - ein physisches Backup aus 16 lässt sich nicht in 15 oder 17 einspielen. Welche es braucht, sagt `swisshub-recovery punkte`.',
              ],
              [
                '2',
                'DNS auf die neue Adresse',
                'Vor allem anderen. Ohne DNS scheitert die Discord-Anmeldung, und es gibt kein TLS-Zertifikat. Das DNS-Konto gehört zu den Zugängen, die man bereithalten muss - es steht in keinem Backup.',
              ],
              [
                '3',
                'Wiederherstellungspaket öffnen',
                '`swisshub-recovery paket <paket.tar.age> <recovery.key>` - mit dem privaten Schlüssel, der nicht auf dem verlorenen Server lag.',
              ],
              [
                '4',
                'Quelltext auf den produktiven Commit',
                'Der Commit steht in `release.json` im Paket. Ist GitHub nicht erreichbar, liegt eine Kopie im Restic-Repository unter der Marke `konfiguration`.',
              ],
              [
                '5',
                '.env und Backup-Konfiguration einsetzen',
                'Beide aus dem Paket. Dann die LESENDEN S3-Zugangsdaten eintragen - sie liegen beim privaten Schlüssel und nicht im Paket.',
              ],
              [
                '6',
                'Datenbank wiederherstellen',
                '`swisshub-recovery wiederherstellen` - mit `--zeit` für einen bestimmten Zeitpunkt, ohne für den jüngstmöglichen Stand. Der Preflight prüft vorher Integrität, Version, Platz und Schlüssel.',
              ],
              [
                '7',
                'Uploads wiederherstellen',
                'Geschieht im selben Lauf. Gewählt wird der älteste Datei-Snapshot, der NICHT älter ist als der Zielzeitpunkt - eine ältere Sicherung liesse Verweise ins Leere zeigen.',
              ],
              [
                '8',
                'Migrationsstand prüfen - NICHT migrieren',
                '`prisma migrate deploy` würde das Schema auf den Stand des Quelltexts bringen und dabei die gerade wiederhergestellten Daten verändern. Wenn der Quelltext neuer ist als der Zielzeitpunkt, ist das eine Entscheidung und keine Nebenwirkung.',
              ],
              [
                '9',
                'nginx, TLS, WebApp',
                '`certbot --nginx`, dann die WebApp starten und `/api/health` prüfen.',
              ],
              [
                '10',
                'Validieren',
                '`swisshub-recovery validieren` - Schema, Tabellen, Migrationen, Konfiguration, und die wichtigste Prüfung: lassen sich die verschlüsselten Zugangsdaten mit dem vorhandenen Hauptschlüssel wirklich entschlüsseln?',
              ],
              [
                '11',
                'ERST DANN Bot und Musik-Laufzeit',
                '`swisshub-recovery freigeben`. Das Werkzeug verweigert die Freigabe ohne bestandene Validierung und ohne die Gewissheit, dass keine zweite Instanz läuft. Der Bot wirkt nach aussen: er vergibt Rollen, schreibt in Kanäle und arbeitet Jail-Fristen ab. Auf unvalidierten Daten richtet er Schaden an, den kein Backup zurücknimmt.',
              ],
              [
                '12',
                'Neue Sicherung anlegen',
                'Der wiederhergestellte Stand ist in keiner Sicherung. Nach einer Wiederherstellung liegt eine neue Zeitlinie vor: `swisshub-backup einrichten`, `db-voll`, `geheimnisse` - der letzte Befehl, weil der Hauptschlüssel jetzt auf einem neuen Server liegt.',
              ],
            ].map(([nummer, titel, text]) => (
              <li key={nummer} className="flex gap-3 rounded-lg border border-border/60 p-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {nummer}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{titel}</p>
                  <p className="mt-0.5 text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <Terminal className="size-4 shrink-0" aria-hidden="true" />
              Der Fehler, der am meisten anrichtet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Zwei Bot-Instanzen mit demselben Token gleichzeitig. Discord liefert jedes Ereignis an beide
              aus: jede Nachricht doppelt, Rollen zweimal vergeben und wieder entzogen, zwei Jail-Sweeps, die
              sich gegenseitig überschreiben - und ein Verhalten, das keine der beiden Instanzen erklären
              kann.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ist der alte Server nicht mehr erreichbar, sein Bot-Herzschlag aber frisch, dann greift er noch
              auf dieselbe Datenbank zu. Die sicherste Massnahme ist dann, den Bot-Token im Discord Developer
              Portal zu erneuern: der alte wird damit ungültig, und die Altinstanz ist von Discord getrennt.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Was der Betreiber bereithalten muss" icon={<KeyRound />}>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Diese Zugänge stehen in keinem Backup und lassen sich nicht wiederherstellen:</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Der <strong className="text-foreground">private age-Schlüssel</strong> zum
              Wiederherstellungspaket. Ohne ihn bleiben die verschlüsselten Zugangsdaten unlesbar.
            </li>
            <li>
              Die <strong className="text-foreground">lesenden S3-Zugangsdaten</strong>. Sie liegen nie auf
              dem produktiven Server - dort haben sie keinen Zweck.
            </li>
            <li>
              Zugang zum <strong className="text-foreground">DNS-Konto</strong>. Ohne ihn zeigt die Domain
              weiter auf den verlorenen Server.
            </li>
            <li>
              Zugang zum <strong className="text-foreground">Discord Developer Portal</strong>. Für den Fall,
              dass ein Token erneuert werden muss.
            </li>
            <li>
              Zugang zum <strong className="text-foreground">Hosting-Anbieter</strong>, um einen neuen Server
              anzulegen.
            </li>
          </ul>
          <p className="pt-2">
            Alles davon gehört an zwei getrennte Orte - einen Passwortmanager und ein Medium, das nicht am
            Netz hängt. Eine Liste, die nur im Kopf einer Person steht, ist der Einzelpunkt, gegen den dieses
            ganze System nicht hilft.
          </p>
        </div>
      </Panel>
    </>
  );
}
