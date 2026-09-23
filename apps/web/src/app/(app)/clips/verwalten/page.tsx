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

  const aktuelleWoche = clips.kalenderwoche(new Date()).key;
  const wocheVorhanden = runden.some((runde) => runde.key === aktuelleWoche);

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
            csrfToken={csrfTokenFor(context)}
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
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Runde</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Einreichen bis</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Voting bis</th>
                <th className="px-4 py-3 text-right font-medium">Clips</th>
                <th className="px-4 py-3 text-right font-medium">Stimmen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runden.map((runde) => (
                <tr key={runde.id} className="bg-background/40">
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-muted-foreground">
                    {STATUS_TEXT[runde.status] ?? runde.status}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {zeit(runde.submissionEndsAt)}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {zeit(runde.votingEndsAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{runde._count.entries}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{runde._count.votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
