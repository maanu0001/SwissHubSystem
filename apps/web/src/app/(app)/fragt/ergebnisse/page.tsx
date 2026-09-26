import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { fragtNavigation } from '@/modules/fragt/navigation';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ergebnisse' };
export const dynamic = 'force-dynamic';

const datum = (wert: Date | null): string =>
  wert
    ? wert.toLocaleDateString('de-CH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/Zurich',
      })
    : '–';

const ENTWURF_TEXT: Record<string, { label: string; ton: string }> = {
  OFFEN: { label: 'Entwurf offen', ton: 'bg-amber-500/15 text-amber-400' },
  FINALISIERT: { label: 'Bereit zum Posten', ton: 'bg-sky-500/15 text-sky-400' },
  VEROEFFENTLICHT: { label: 'Gepostet', ton: 'bg-emerald-500/15 text-emerald-400' },
};

/**
 * Die abgeschlossenen Abstimmungen - und was sie ueber die Zeit ergeben.
 *
 * ## Warum hier Summen stehen und keine Personen
 *
 * Die Beteiligungsstatistik unten rechnet je Frage und je Kategorie. Eine
 * Auswertung «wer stimmt wie» beantwortet keine Frage, die jemand stellt, und
 * sie waere eine Liste, die es nicht geben sollte.
 */
export default async function FragtErgebnissePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.results);
  const guildId = await resolveGuildId();

  const [abgeschlossene, beteiligung] = await Promise.all([
    fragt.ladeAbgeschlossene(guildId, 50),
    fragt.ladeBeteiligung(guildId, 30),
  ]);

  const darfStudio = can(context, fragt.FRAGT_PERMISSIONS.studio);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ergebnisse"
        description="Abgeschlossene Abstimmungen mit ihren festgeschriebenen Zahlen."
      />
      <ModulNavigation
        eintraege={fragtNavigation(context)}
        aktiv="ergebnisse"
        label="Bereiche in SwissHub fragt"
      />

      {abgeschlossene.length === 0 ? (
        <EmptyState
          title="Noch nichts abgeschlossen"
          description="Sobald die erste Abstimmung endet, stehen die Zahlen hier - und daraus entsteht automatisch ein Social-Media-Entwurf."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Abstimmungen"
              value={String(beteiligung.reihe.length)}
              hint="abgeschlossen"
              icon="BarChart3"
            />
            <StatCard
              label="Stimmen im Schnitt"
              value={String(beteiligung.schnitt)}
              hint="je Abstimmung"
              icon="Users"
            />
            <StatCard
              label="Beste Beteiligung"
              value={String(beteiligung.spitze[0]?.stimmen ?? 0)}
              hint={beteiligung.spitze[0]?.frageText ?? '–'}
              icon="TrendingUp"
            />
          </div>

          <Panel title="Abgeschlossene Abstimmungen" icon="BarChart3">
            <ul className="divide-y divide-border">
              {abgeschlossene.map(({ abstimmung, ergebnis, entwurf }) => {
                const entwurfStatus = entwurf ? ENTWURF_TEXT[entwurf.status] : null;
                return (
                  <li key={abstimmung.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={systemRoutes.fragtErgebnis(abstimmung.id)}
                        className="break-words font-medium leading-tight hover:text-primary"
                      >
                        {abstimmung.frageText}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {datum(abstimmung.closedAt)} · {abstimmung.finalVotes}{' '}
                        {abstimmung.finalVotes === 1 ? 'Stimme' : 'Stimmen'}
                        {ergebnis?.gewinner
                          ? ` · ${ergebnis.gewinner.label} (${ergebnis.gewinner.prozent} %)`
                          : ergebnis && ergebnis.gleichstand.length > 0
                            ? ' · Gleichstand'
                            : ''}
                      </p>
                    </div>
                    {entwurfStatus ? (
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', entwurfStatus.ton)}>
                        {entwurfStatus.label}
                      </span>
                    ) : (
                      <Badge variant="outline">Kein Entwurf</Badge>
                    )}
                    {darfStudio && entwurf ? (
                      <Link
                        href={systemRoutes.fragtStudio(entwurf.id)}
                        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      >
                        Content Studio
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Beteiligung über die Zeit" icon="TrendingUp">
              {/* Eine Liste statt eines Diagramms: bei dreissig Werten ist die
                  Zahl neben dem Balken schneller gelesen als eine Kurve, und
                  sie stimmt auch auf einem schmalen Telefon. */}
              <ul className="space-y-2">
                {beteiligung.reihe.slice(-12).map((zeile, index) => {
                  const hoechste = Math.max(...beteiligung.reihe.map((eintrag) => eintrag.stimmen), 1);
                  return (
                    <li key={`${zeile.frageText}-${index}`} className="space-y-1">
                      <div className="flex items-end justify-between gap-3">
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                          {zeile.frageText}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums">{zeile.stimmen}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.round((zeile.stimmen / hoechste) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel title="Kategorien" icon="Library" description="Wo die Community am meisten mitmacht.">
              {beteiligung.kategorien.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Daten.</p>
              ) : (
                <ul className="space-y-2">
                  {beteiligung.kategorien.map((zeile) => (
                    <li key={zeile.kategorie} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{zeile.kategorie}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {zeile.stimmen} Stimmen · {zeile.abstimmungen}{' '}
                        {zeile.abstimmungen === 1 ? 'Frage' : 'Fragen'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
