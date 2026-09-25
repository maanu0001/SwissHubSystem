import type { Metadata } from 'next';
import { Archive, History, TriangleAlert } from 'lucide-react';
import { backup } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { BackupAbschnittsNav } from '@/modules/backup/components/abschnitts-nav';
import {
  artLabel,
  bytesLesbar,
  dauerLesbar,
  laufLabel,
  repoLabel,
  vorWieLange,
  zeitLesbar,
} from '@/modules/backup/darstellung';
import { requirePagePermission } from '@/server/auth';
import { backupAbschnitte } from '../abschnitte';

export const metadata: Metadata = { title: 'Backup-Historie' };
export const dynamic = 'force-dynamic';

/**
 * B) Die Historie.
 *
 * Zwei Listen, und die Reihenfolge ist Absicht: zuerst die Sicherungspunkte -
 * was es GIBT -, dann die Läufe - was PASSIERT IST. Wer hierher kommt, sucht
 * fast immer das Erste.
 *
 * Fehlgeschlagene Läufe werden nicht versteckt und nicht kleingeschrieben. Ein
 * Verlaufsprotokoll, in dem Fehlschläge unauffällig sind, ist genau das, in dem
 * man drei Wochen lang nichts merkt.
 */
export default async function BackupHistorieSeite(): Promise<React.JSX.Element> {
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

  const punkte = zustand.wiederherstellungspunkte?.punkte ?? [];
  const laeufe = zustand.laeufe ?? [];

  return (
    <>
      <BackupAbschnittsNav abschnitte={abschnitte} />

      <Panel
        title="Sicherungspunkte"
        icon={<Archive />}
        description={`${punkte.length} Punkt${punkte.length === 1 ? '' : 'e'}, neueste zuerst. Erhoben ${vorWieLange(zustand.wiederherstellungspunkte?.erhoben)}.`}
      >
        {punkte.length === 0 ? (
          <EmptyState
            title="Keine Sicherungspunkte"
            description="Es liegt nichts vor, aus dem sich etwas wiederherstellen liesse."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Erstellt</th>
                  <th className="pb-2 pr-4 font-medium">Geschützt</th>
                  <th className="pb-2 pr-4 font-medium">Typ</th>
                  <th className="pb-2 pr-4 font-medium">Kennung</th>
                  <th className="pb-2 pr-4 font-medium">Grösse</th>
                  <th className="pb-2 pr-4 font-medium">Speicherort</th>
                  <th className="pb-2 pr-4 font-medium">Verschlüsselt</th>
                  <th className="pb-2 font-medium">Wiederherstellbar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {punkte.map((punkt) => {
                  const ort = repoLabel(punkt.repo);
                  // Ein inkrementeller Punkt ohne seinen Vorgänger ist
                  // unbrauchbar. Das gehört in die Spalte und nicht in eine
                  // Fussnote.
                  const braucht = punkt.baut_auf ? `baut auf ${punkt.baut_auf}` : null;
                  return (
                    <tr key={`${punkt.art}-${punkt.kennung}`}>
                      <td className="py-2 pr-4 align-top">
                        <div className="whitespace-nowrap">{zeitLesbar(punkt.beginn)}</div>
                        <div className="text-xs text-muted-foreground">{vorWieLange(punkt.beginn)}</div>
                      </td>
                      <td className="py-2 pr-4 align-top">{artLabel(punkt.art)}</td>
                      <td className="py-2 pr-4 align-top">
                        <Badge variant={punkt.typ === 'full' ? 'default' : 'secondary'}>
                          {punkt.typ ?? '–'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 align-top font-mono text-xs">{punkt.kennung ?? '–'}</td>
                      <td className="py-2 pr-4 align-top tabular-nums">
                        {bytesLesbar(punkt.bytes)}
                        {punkt.bytes_datenbank ? (
                          <div className="text-xs text-muted-foreground">
                            Datenbank {bytesLesbar(punkt.bytes_datenbank)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <Badge variant={ort.extern ? 'success' : 'warning'}>{ort.text}</Badge>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        {punkt.verschluesselt ? (
                          <Badge variant="success">ja</Badge>
                        ) : (
                          <Badge variant="destructive">nein</Badge>
                        )}
                      </td>
                      <td className="py-2 align-top text-xs text-muted-foreground">
                        {punkt.art === 'datenbank' ? (
                          punkt.wal_von && punkt.wal_bis ? (
                            <>
                              WAL {punkt.wal_von.slice(-8)}…{punkt.wal_bis.slice(-8)}
                              {braucht ? <div>{braucht}</div> : null}
                            </>
                          ) : (
                            <span className="text-destructive">keine WAL-Spanne</span>
                          )
                        ) : punkt.db_zeitpunkt ? (
                          <>zum DB-Stand {punkt.db_zeitpunkt.slice(0, 19)}</>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 space-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">«Nur lokal»</strong> heisst: dieser Punkt liegt auf demselben
            Rechner, der gesichert wird. Gegen dessen Verlust schützt er nicht.
          </p>
          <p>
            <strong className="text-foreground">Ansteuerbarer Zeitraum:</strong>{' '}
            {zustand.wiederherstellungspunkte?.aeltester
              ? `${zeitLesbar(zustand.wiederherstellungspunkte.aeltester)} bis zum jüngsten archivierten WAL-Segment (${zustand.wiederherstellungspunkte.wal_bis ?? '?'}).`
              : 'unbekannt.'}{' '}
            Ein Zeitpunkt ist erreichbar, wenn er nach dem Ende des ältesten Basis-Backups liegt und die
            WAL-Kette bis dorthin reicht.
          </p>
        </div>
      </Panel>

      <Panel title="Läufe" icon={<History />} description={`Die letzten ${laeufe.length}, neueste zuerst.`}>
        {laeufe.length === 0 ? (
          <EmptyState title="Noch kein Lauf" />
        ) : (
          <ul className="space-y-2">
            {laeufe.map((lauf) => (
              <li
                key={lauf.id}
                className={
                  lauf.status === 'fehler'
                    ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3'
                    : 'rounded-lg border border-border/60 p-3'
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {lauf.status === 'fehler' ? (
                        <Badge variant="destructive">
                          <TriangleAlert className="size-3" aria-hidden="true" />
                          Fehlgeschlagen
                        </Badge>
                      ) : lauf.status === 'uebersprungen' ? (
                        <Badge variant="secondary">Übersprungen</Badge>
                      ) : (
                        <Badge variant="success">Erfolg</Badge>
                      )}
                      <span className="font-medium">{laufLabel(lauf.art)}</span>
                      {lauf.ziel !== 'lokal' ? <Badge variant="secondary">{lauf.ziel}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{lauf.meldung}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div className="whitespace-nowrap">{zeitLesbar(lauf.beginn)}</div>
                    <div>
                      {dauerLesbar(lauf.dauer_s)}
                      {lauf.bytes > 0 ? ` · ${bytesLesbar(lauf.bytes)}` : ''}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          Diese Liste ist das Betriebsprotokoll und steht ausdrücklich nicht im Audit Log: ein täglicher
          Sicherungslauf dort wären dreihundert Zeilen im Jahr, und ein Audit Log, das man nicht mehr liest,
          ist keine Beweiskette. Im Audit Log steht, was ein Mensch entschieden hat.
        </p>
      </Panel>
    </>
  );
}
