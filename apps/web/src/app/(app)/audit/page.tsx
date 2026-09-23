import type { Metadata } from 'next';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { getGuildConfig, listModuleDefinitions, loadPersonen } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buttonVariants } from '@/components/ui/button';
import { PageToolbar } from '@/components/shared/page-header';
import { Pagination } from '@/components/shared/pagination';
import { AuditZeile } from '@/modules/audit/audit-zeile';
import { auditActionLabel, auditKategorie, resolveAuditContext } from '@/modules/audit/kontext';
import { EmptyState } from '@/components/shared/states';
import { can } from '@swisshub/auth';
import { requirePagePermission } from '@/server/auth';
import { AUDIT_ACTION_OPTIONS, checkAuditIntegrity, leseAuditFilter, loadAuditLog } from '@/server/audit';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Audit Log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission('audit.view');
  const params = await searchParams;
  /*
   * Lesen, nicht erzwingen.
   *
   * Hier stand `auditFilterSchema.parse(params)`. Das Formular schickt beim
   * Absenden aber alle Felder mit, auch die leeren - `from=` und `to=` liefen
   * damit in eine Datumsregel, die den Leerstring ablehnt, und die Server
   * Component brach ab. Sichtbar war «Diese Seite konnte nicht geladen
   * werden», und zwar bei **jeder** Anwendung des Filters.
   */
  const { filter, verworfen } = leseAuditFilter(params);

  const [result, integrity, guild] = await Promise.all([
    loadAuditLog(filter),
    checkAuditIntegrity(),
    getGuildConfig().catch(() => null),
  ]);

  /*
   * Personen in einem Zug nachschlagen.
   *
   * Handelnde und Ziele zusammen, nicht je Zeile: fünfundzwanzig Einträge
   * wären sonst bis zu fünfzig Abfragen. `loadPersonen` macht daraus zwei.
   */
  const personen = Object.fromEntries(
    await loadPersonen(result.items.flatMap((entry) => [entry.actorDiscordId, entry.targetDiscordId])),
  );
  const modules = listModuleDefinitions();
  // Rohdaten können Namen und Gründe enthalten - sie sind nicht Teil dessen,
  // was «Audit Log ansehen» zusagt.
  const darfRohdatenSehen = can(context, 'settings.edit');

  const aktionsGruppen = [
    ...AUDIT_ACTION_OPTIONS.reduce((gruppen, action) => {
      const bereich = auditKategorie(action);
      const vorhanden = gruppen.get(bereich.label) ?? [];
      gruppen.set(bereich.label, [...vorhanden, action]);
      return gruppen;
    }, new Map<string, string[]>()),
  ]
    .map(([label, aktionen]) => ({
      label,
      aktionen: [...aktionen].sort((a, b) => auditActionLabel(a).localeCompare(auditActionLabel(b), 'de')),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));

  const buildHref = (page: number): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') {
        search.set(key, value);
      }
    }
    if (page > 1) {
      search.set('page', String(page));
    }
    const queryString = search.toString();
    return queryString ? `/audit?${queryString}` : '/audit';
  };

  return (
    <>
      <PageToolbar
        actions={
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
              integrity.valid
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {integrity.valid ? (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldX className="size-3.5" aria-hidden="true" />
            )}
            {integrity.valid
              ? `Hash-Chain intakt (${integrity.checked} geprüft)`
              : 'Hash-Chain verletzt - bitte prüfen'}
          </span>
        }
      >
        <p className="text-sm text-muted-foreground">
          Einträge können über die Oberfläche weder bearbeitet noch gelöscht werden.
        </p>
      </PageToolbar>

      {verworfen.length > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {verworfen.length === 1
            ? `Der Filter «${verworfen[0]}» war unbrauchbar und wurde übergangen.`
            : `Diese Filter waren unbrauchbar und wurden übergangen: ${verworfen.join(', ')}.`}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Einträge nach Benutzer, Aktion, Modul oder Zeitraum eingrenzen.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="filter-actor">Moderator</Label>
              <Input
                id="filter-actor"
                name="actor"
                defaultValue={params.actor ?? ''}
                placeholder="Username oder ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-target">Zielbenutzer</Label>
              <Input
                id="filter-target"
                name="target"
                defaultValue={params.target ?? ''}
                placeholder="Username oder ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-action">Aktion</Label>
              <select
                id="filter-action"
                name="action"
                defaultValue={params.action ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="">Alle</option>
                {/*
                  Nach Bereich gruppiert und alphabetisch sortiert.

                  Zweihundertsechsundzwanzig Einträge in einer flachen Liste
                  sind keine Auswahl, sondern eine Suche ohne Suchfeld. Die
                  Gruppen entstehen aus derselben Ableitung wie die Abzeichen
                  in der Liste - keine zweite Einteilung, die davon abweichen
                  könnte.
                */}
                {aktionsGruppen.map((gruppe) => (
                  <optgroup key={gruppe.label} label={gruppe.label}>
                    {gruppe.aktionen.map((action) => (
                      <option key={action} value={action}>
                        {auditActionLabel(action)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-module">Modul</Label>
              <select
                id="filter-module"
                name="module"
                defaultValue={params.module ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="">Alle</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-from">Von</Label>
              <Input id="filter-from" name="from" type="date" defaultValue={params.from ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-to">Bis</Label>
              <Input id="filter-to" name="to" type="date" defaultValue={params.to ?? ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-outcome">Ergebnis</Label>
              <select
                id="filter-outcome"
                name="outcome"
                defaultValue={params.outcome ?? 'all'}
                className="flex h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              >
                <option value="all">Alle</option>
                <option value="success">Erfolgreich</option>
                <option value="error">Fehler</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className={cn(buttonVariants({ variant: 'default' }), 'flex-1')}>
                Filtern
              </button>
              <a href="/audit" className={cn(buttonVariants({ variant: 'outline' }))}>
                Zurücksetzen
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {result.items.length === 0 ? (
            <EmptyState
              title="Keine Einträge"
              description="Für die gewählten Filter gibt es keine Einträge."
            />
          ) : (
            <ul>
              {result.items.map((entry) => (
                <AuditZeile
                  key={entry.id}
                  eintrag={{
                    id: entry.id,
                    createdAt: entry.createdAt,
                    action: entry.action,
                    module: entry.module,
                    actorUsername: entry.actorUsername,
                    actorDiscordId: entry.actorDiscordId,
                    targetLabel: entry.targetLabel,
                    targetDiscordId: entry.targetDiscordId,
                    success: entry.success,
                    errorCode: entry.errorCode,
                    metadata: entry.metadata,
                  }}
                  kontext={resolveAuditContext(entry, { guildId: guild?.guildId ?? null })}
                  personen={personen}
                  darfRohdatenSehen={darfRohdatenSehen}
                />
              ))}
            </ul>
          )}
          {result.totalPages > 1 ? (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              buildHref={buildHref}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
