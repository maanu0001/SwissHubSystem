import type { Metadata } from 'next';
import Link from 'next/link';
import { getModuleHealth, listModuleStatus } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { NavIcon } from '@/components/layout/nav-icon';
import { ModulStatusWahl } from '@/modules/settings/components/module-status-wahl';
import { HealthChecks } from '@/modules/configuration/components/health-checks';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Module' };
export const dynamic = 'force-dynamic';

export default async function ModulesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('modules.manage', { allowDuringSetup: true });
  const [status, health] = await Promise.all([listModuleStatus(), getModuleHealth()]);
  const csrfToken = csrfTokenFor(context);
  const healthById = new Map(health.map((entry) => [entry.moduleId, entry]));

  const features = status.filter((entry) => !entry.definition.core);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {features.map((entry) => (
        <article
          key={entry.definition.id}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="icon-chip size-11 shrink-0 [&_svg]:size-5">
                <NavIcon name={entry.definition.icon} />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">{entry.definition.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{entry.definition.description}</p>
              </div>
            </div>
            <ModulStatusWahl
              csrfToken={csrfToken}
              moduleId={entry.definition.id}
              moduleName={entry.definition.name}
              status={entry.status}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {entry.definition.permissions.map((permission) => (
              <Badge key={permission.key} variant="outline">
                {permission.key}
              </Badge>
            ))}
          </div>

          {(() => {
            const report = healthById.get(entry.definition.id);
            if (!report || report.checks.length === 0 || report.status === 'ok') {
              return null;
            }
            return <HealthChecks checks={report.checks.filter((check) => check.status !== 'ok')} />;
          })()}

          <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {/*
              Der Status noch einmal als Text.

              Die Knoepfe oben zeigen ihn durch Hervorhebung - eine Farbe
              allein ist aber keine Auskunft. Wer die Karte ueberfliegt oder
              einen Screenreader benutzt, liest ihn hier ausgeschrieben.
            */}
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  entry.status === 'AKTIV'
                    ? 'bg-success'
                    : entry.status === 'TESTMODUS'
                      ? 'bg-warning'
                      : 'bg-destructive',
                )}
                aria-hidden="true"
              />
              {entry.status === 'AKTIV'
                ? 'Aktiv'
                : entry.status === 'TESTMODUS'
                  ? 'Testmodus'
                  : 'Deaktiviert'}
            </span>
            {entry.status === 'TESTMODUS' ? (
              <Badge variant="warning" title="Nur für berechtigte Admins und Moderatoren sichtbar.">
                Nur für das Team sichtbar
              </Badge>
            ) : null}
            {entry.updatedAt ? <span>Zuletzt geändert: {formatDateTime(entry.updatedAt)}</span> : null}
            {entry.definition.navigation[0] ? (
              <Link
                href={entry.definition.navigation[0].href}
                className="text-primary-bright hover:underline"
              >
                Zum Modul
              </Link>
            ) : null}
            {/* Auch ein Modul ohne Einstellungsfelder kann eine eigene
                Verwaltungsseite haben - siehe `managementLinks`. */}
            {entry.definition.settingsFields?.length || entry.definition.managementLinks?.length ? (
              <Link href={`/modules/${entry.definition.id}`} className="text-primary-bright hover:underline">
                Einstellungen
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
