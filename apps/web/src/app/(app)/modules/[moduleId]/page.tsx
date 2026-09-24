import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@swisshub/auth';
import {
  buildHealthContext,
  getModuleDefinition,
  groupFields,
  isModuleEnabled,
  readModuleSettings,
} from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NavIcon } from '@/components/layout/nav-icon';
import { EmptyState } from '@/components/shared/states';
import { SettingsForm } from '@/modules/configuration/components/settings-form';
import { HealthChecks } from '@/modules/configuration/components/health-checks';
import { csrfTokenFor, hasSetupAccess, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}): Promise<Metadata> {
  const { moduleId } = await params;
  const definition = getModuleDefinition(moduleId);
  return { title: definition ? `${definition.name} – Einstellungen` : 'Modul' };
}

/**
 * Einstellungsseite eines Moduls.
 *
 * Die Seite ist generisch: sie entsteht aus der Feldbeschreibung des Moduls.
 * Ein neues Modul benötigt deshalb keine eigene Seite mehr.
 */
export default async function ModuleSettingsPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}): Promise<React.JSX.Element> {
  const { moduleId } = await params;
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    notFound();
  }

  const settingsPermission = definition.permissions.some(
    (entry) => entry.key === `${definition.permissionPrefix}.settings`,
  )
    ? `${definition.permissionPrefix}.settings`
    : 'modules.manage';

  const context = await requirePagePermission('settings.view', { allowDuringSetup: true });
  const csrfToken = csrfTokenFor(context);
  const canEdit = can(context, settingsPermission) || (await hasSetupAccess());

  const [enabled, options, values, healthContext] = await Promise.all([
    isModuleEnabled(moduleId),
    loadDiscordOptions(),
    readModuleSettings<Record<string, unknown>>(moduleId),
    buildHealthContext(),
  ]);

  const checks = definition.healthChecks ? await definition.healthChecks(healthContext).catch(() => []) : [];
  const fields = definition.settingsFields ?? [];

  /*
   * Die Verweise pruefen ihre eigene Berechtigung.
   *
   * Wer die Einstellungen eines Moduls sehen darf, darf nicht automatisch
   * jede seiner Verwaltungsseiten oeffnen - der Spielekatalog haengt an
   * `spielwahl.games.manage` und nicht an `settings.view`. Ein Verweis auf
   * eine Seite, die danach mit 403 antwortet, waere schlimmer als keiner.
   */
  const verwaltung = (definition.managementLinks ?? []).filter((eintrag) => can(context, eintrag.permission));

  return (
    <>
      <Link
        href="/modules"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Zurück zur Modulübersicht
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {definition.name}
            <Badge variant={enabled ? 'success' : 'outline'}>{enabled ? 'Aktiv' : 'Deaktiviert'}</Badge>
          </CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </CardHeader>
        {checks.length > 0 ? (
          <CardContent>
            <HealthChecks checks={checks} />
          </CardContent>
        ) : null}
      </Card>

      {verwaltung.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Verwalten</CardTitle>
            <CardDescription>
              Eigene Seiten dieses Moduls. Sie stehen nicht in der Seitenleiste - man braucht sie selten, und
              hier sucht man sie.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {verwaltung.map((eintrag) => (
              <Link
                key={eintrag.href}
                href={eintrag.href}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <span className="icon-chip size-10 shrink-0 [&_svg]:size-4">
                  <NavIcon name={eintrag.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{eintrag.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{eintrag.description}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Einstellungen</CardTitle>
          <CardDescription>
            Rollen und Channels werden aus dem letzten Discord-Abgleich angeboten. Änderungen wirken sofort -
            der Bot muss dafür nicht neu gestartet werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <EmptyState
              title="Keine Einstellungen"
              description="Dieses Modul benötigt keine Konfiguration."
            />
          ) : (
            <SettingsForm
              moduleId={moduleId}
              csrfToken={csrfToken}
              groups={groupFields(fields)}
              values={values}
              roles={options.roles}
              channels={options.channels}
              disabled={!canEdit}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
