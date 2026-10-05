import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { namenKarte, workspaceBetrachter, workspaceEinstellungen } from '@/modules/workspace/daten';
import {
  Fortschrittsbalken,
  Frist,
  PrioritaetAbzeichen,
  ProjektStatusAbzeichen,
  Tags,
  Zustaendige,
} from '@/modules/workspace/components/abzeichen';
import { ProjektFormular } from '@/modules/workspace/components/projekt-formular';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Projekte · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Die Projektliste.
 *
 * Nur die nicht archivierten - das Archiv ist ein eigener Reiter, weil die
 * beiden verschiedene Fragen beantworten: hier «woran arbeiten wir», dort
 * «haben wir das schon mal gemacht».
 *
 * Die Suche ist ein `GET`-Formular und kein Feld mit Tastaturhorchen: so steht
 * der Suchbegriff in der Adresse, und die Seite filtert serverseitig statt
 * zweihundert Projekte in den Browser zu laden.
 */
export default async function WorkspaceProjektePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view);
  const betrachter = workspaceBetrachter(context);
  /*
   * Rollen und Kanaele fuer das Projektformular.
   *
   * Aus demselben Zwischenspeicher wie die Moduleinstellungen - die Liste
   * gilt eine Minute, und eine zweite Quelle fuer Discord-Optionen waere eine
   * zweite Antwort auf dieselbe Frage.
   */
  const discordOptionen = await loadDiscordOptions();
  const { q } = await searchParams;
  const suche = (q ?? '').trim();
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const jetzt = new Date();

  const [projekte, zahlen] = await Promise.all([
    workspace.ladeProjekte(guildId, betrachter, suche ? { suche } : {}),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const namen = await namenKarte(projekte.flatMap((zeile) => zeile.mitglieder.map((m) => m.discordId)));
  const darfAnlegen = can(context, workspace.WORKSPACE_PERMISSIONS.projectsCreate);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="projekte"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={systemRoutes.workspaceProjekte()} className="flex items-center gap-2">
          <Input
            type="search"
            name="q"
            defaultValue={suche}
            placeholder="Titel, Beschreibung oder Tag"
            className="w-64"
            aria-label="Projekte durchsuchen"
          />
          <Button type="submit" variant="outline" size="sm">
            Suchen
          </Button>
        </form>
        {darfAnlegen ? (
          <ProjektFormular
            csrfToken={csrfTokenFor(context)}
            roles={discordOptionen.roles}
            ereignisse={workspace.WORKSPACE_EREIGNISSE}
            channels={discordOptionen.channels}
          />
        ) : null}
      </div>

      <Panel
        title={suche ? `Treffer für «${suche}»` : 'Laufende Projekte'}
        icon="FolderKanban"
        description={
          projekte.length === 0
            ? undefined
            : `${projekte.length} ${projekte.length === 1 ? 'Projekt' : 'Projekte'} · zuletzt geändert zuerst`
        }
      >
        {projekte.length === 0 ? (
          <EmptyState
            title={suche ? 'Kein Treffer' : 'Noch kein Projekt'}
            description={
              suche
                ? 'Vielleicht liegt es im Archiv - dort wird getrennt gesucht.'
                : darfAnlegen
                  ? 'Ein Projekt bündelt Aufgaben, Fristen und Meilensteine. Wer es anlegt, leitet es.'
                  : 'Sobald das Team ein Projekt anlegt, steht es hier.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projekte.map((zeile) => (
              <Link
                key={zeile.projekt.id}
                href={systemRoutes.workspaceProjekt(zeile.projekt.id)}
                className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 font-medium leading-snug group-hover:underline">
                    {zeile.projekt.title}
                  </span>
                  {zeile.projekt.accent ? (
                    <span
                      aria-hidden="true"
                      className="mt-1 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: zeile.projekt.accent }}
                    />
                  ) : null}
                </div>

                {zeile.projekt.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{zeile.projekt.description}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <ProjektStatusAbzeichen status={zeile.projekt.status} />
                  {zeile.projekt.priority ? (
                    <PrioritaetAbzeichen prioritaet={zeile.projekt.priority} />
                  ) : null}
                  <Frist dueAt={zeile.projekt.dueAt} jetzt={jetzt} baldTage={einstellungen.baldFaelligTage} />
                </div>

                <Tags tags={zeile.projekt.tags} />
                <Fortschrittsbalken fortschritt={zeile.fortschritt} />

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <Zustaendige
                    kennungen={zeile.mitglieder.map((mitglied) => mitglied.discordId)}
                    namen={namen}
                    max={4}
                  />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {zeile.offeneAufgaben} offen
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
