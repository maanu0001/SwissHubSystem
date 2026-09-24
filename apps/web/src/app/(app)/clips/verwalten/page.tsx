import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@swisshub/database';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { ClipAbschnittsNav } from '@/modules/clips/components/abschnitts-nav';
import { RundenVerwaltung } from '@/modules/clips/components/runden-verwaltung';
import { RundeReaktivieren } from '@/modules/clips/components/runde-reaktivieren';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { clipAbschnitte, ladeClipStand } from '@/server/clips';
import { Clapperboard, Users, Vote } from 'lucide-react';

export const metadata: Metadata = { title: 'Clip-Runden' };
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Vorbereitet',
  SUBMISSION: 'Einreichungen offen',
  VOTING: 'Voting läuft',
  FINALIZING: 'Wird abgeschlossen',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgebrochen',
};

const zeit = (datum: Date): string =>
  datum.toLocaleString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

/**
 * Die Runden, von der Verwaltung aus gesehen.
 *
 * Der einzige Ort im Modul, der wie ein Verwaltungsbereich aussehen darf -
 * hier stehen Zahlen und Zustaende, weil genau danach gefragt wird.
 */
export default async function ClipVerwaltenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.manage);
  const stand = await ladeClipStand(context);
  const offen = stand.runde ? await clips.offeneModeration(stand.runde.id) : 0;
  const nav = <ClipAbschnittsNav abschnitte={clipAbschnitte(context, offen)} />;

  if (!stand.aktiv) {
    return (
      <div className="space-y-6">
        {nav}
        <ErrorState title="Modul deaktiviert" description="Clip of the Week ist derzeit deaktiviert." />
      </div>
    );
  }

  const [runden, zahlen, einstellungen] = await Promise.all([
    prisma.clipCompetition.findMany({
      where: { guildId: stand.guildId },
      orderBy: { number: 'desc' },
      take: 20,
      include: { _count: { select: { entries: true, votes: true } } },
    }),
    stand.runde ? clips.rundenZahlen(stand.runde.id) : Promise.resolve(null),
    clips.einstellungen(),
  ]);

  const jetzt = new Date();
  const aktuelleWoche = clips.kalenderwoche(jetzt).key;
  const wocheVorhanden = runden.some((runde) => runde.key === aktuelleWoche);
  const csrfToken = csrfTokenFor(context);

  /*
   * Wer darf zurueckgeholt werden?
   *
   * Beantwortet hier, auf dem Server, mit derselben Funktion, die auch die
   * Aktion prueft. Der Knopf erscheint damit genau dort, wo er auch wirkt -
   * und ein Etikett «Abgebrochen» allein genuegt nicht: entschieden wird
   * ueber den gespeicherten Zustand samt Abbruch- und Abschlussvermerk.
   */
  const reaktivierbar = new Map<string, { ziel: string; phaseEndetAm: string }>();
  for (const runde of runden) {
    const lage = clips.reaktivierungsLage(runde, jetzt);
    if (lage.moeglich && lage.ziel && lage.phaseEndetAm) {
      reaktivierbar.set(runde.id, { ziel: lage.ziel, phaseEndetAm: lage.phaseEndetAm.toISOString() });
    }
  }

  return (
    <div className="space-y-6">
      {nav}
      <PageHeader
        title="Runden"
        description={
          einstellungen.autoCreateWeekly
            ? 'Jede Woche öffnet selbsttätig eine neue Runde.'
            : 'Die wöchentliche Eröffnung ist ausgeschaltet - Runden werden von Hand angelegt.'
        }
        actions={
          <RundenVerwaltung
            competitionId={stand.runde?.id ?? null}
            status={stand.runde?.status ?? null}
            csrfToken={csrfToken}
            kannAnlegen={!wocheVorhanden}
          />
        }
      />

      {zahlen ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Eingereicht"
            value={String(zahlen.eingereicht)}
            hint={`${zahlen.freigegeben} freigegeben · ${zahlen.offen} offen`}
            icon={<Clapperboard />}
          />
          <StatCard label="Stimmen" value={String(zahlen.stimmen)} icon={<Vote />} />
          <StatCard
            label="Teilnehmende"
            value={String(zahlen.teilnehmende)}
            hint="Personen, die abgestimmt haben"
            icon={<Users />}
          />
        </div>
      ) : null}

      {runden.length === 0 ? (
        <EmptyState
          title="Noch keine Runde"
          description="Sobald die erste Runde eröffnet wurde, steht sie hier."
        />
      ) : (
        /*
         * `overflow-x-auto` statt `overflow-hidden`: mit der Aktionsspalte wird
         * die Tabelle auf einem Telefon breiter als der Bildschirm.
         * Abgeschnitten waere der Knopf unerreichbar, und die Seite selbst soll
         * deswegen nicht seitlich scrollen - also scrollt die Tabelle in ihrem
         * eigenen Rahmen.
         *
         * `relative` gehoert dazu, und zwar nicht zur Zierde: die
         * `sr-only`-Beschriftungen darin sind absolut positioniert. Ohne einen
         * positionierten Vorfahren beziehen sie sich auf das Dokument, entgehen
         * damit der Kappung - und schieben die Seite um genau ihre Breite nach
         * rechts. Bei 390 Pixeln Bildschirmbreite war das messbar.
         */
        <div className="relative overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 sm:px-4 font-medium">Runde</th>
                <th className="px-3 py-3 sm:px-4 font-medium">Status</th>
                <th className="hidden px-3 py-3 sm:px-4 font-medium sm:table-cell">Einreichen bis</th>
                <th className="hidden px-3 py-3 sm:px-4 font-medium md:table-cell">Voting bis</th>
                <th className="px-3 py-3 sm:px-4 text-right font-medium">Clips</th>
                <th className="hidden px-3 py-3 text-right font-medium sm:table-cell sm:px-4">Stimmen</th>
                <th className="px-3 py-3 sm:px-4 text-right font-medium">
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runden.map((runde) => {
                const zurueckholbar = reaktivierbar.get(runde.id);
                return (
                  <tr key={runde.id} className="bg-background/40">
                    <td className="whitespace-nowrap px-3 py-3 sm:px-4">
                      {runde.status === 'COMPLETED' ? (
                        <Link
                          href={systemRoutes.clipRunde(runde.key)}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          #{runde.number} · {runde.key}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          #{runde.number} · {runde.key}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 sm:px-4 text-muted-foreground">
                      {STATUS_TEXT[runde.status] ?? runde.status}
                    </td>
                    <td className="hidden px-3 py-3 sm:px-4 text-muted-foreground sm:table-cell">
                      {zeit(runde.submissionEndsAt)}
                    </td>
                    <td className="hidden px-3 py-3 sm:px-4 text-muted-foreground md:table-cell">
                      {zeit(runde.votingEndsAt)}
                    </td>
                    <td className="px-3 py-3 sm:px-4 text-right tabular-nums">{runde._count.entries}</td>
                    <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell sm:px-4">
                      {runde._count.votes}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right sm:px-4">
                      {zurueckholbar ? (
                        <RundeReaktivieren
                          competitionId={runde.id}
                          nummer={runde.number}
                          ziel={zurueckholbar.ziel}
                          phaseEndetAm={zurueckholbar.phaseEndetAm}
                          csrfToken={csrfToken}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
