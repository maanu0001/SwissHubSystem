import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { QuickAction } from '@/components/shared/quick-action';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { ladeTeam, namenKarte, workspaceBetrachter, workspaceEinstellungen } from '@/modules/workspace/daten';
import {
  Frist,
  Fortschrittsbalken,
  PrioritaetAbzeichen,
  ProjektStatusAbzeichen,
  StatusAbzeichen,
  Zustaendige,
} from '@/modules/workspace/components/abzeichen';
import { AufgabeFormular } from '@/modules/workspace/components/aufgabe-formular';
import { ProjektFormular } from '@/modules/workspace/components/projekt-formular';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht.
 *
 * ## Was hier steht, und was nicht
 *
 * Vier Zahlen und zwei Listen - überfällig und was als Nächstes kommt. Keine
 * Diagramme: ein Team von acht Leuten braucht morgens keine Auslastungskurve,
 * sondern die Frage «läuft etwas aus dem Ruder» und die Frage «was ist heute
 * dran».
 *
 * Kein eigener Seitentitel: den Modulnamen rendert die Kopfzeile aus der Module
 * Registry schon als `h1`. Ein zweiter wäre dieselbe Überschrift zweimal, und
 * ein Test hält das fest.
 */
export default async function WorkspaceUebersichtPage(): Promise<React.JSX.Element> {
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
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const jetzt = new Date();

  const [zahlen, projekte, ueberfaellig, naechste, team] = await Promise.all([
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
    workspace.ladeProjekte(guildId, betrachter),
    // Überfällig: alles Offene mit Frist vor heute. Der Dienst sortiert nach
    // Frist, die ältesten stehen also oben - und das sind die, die am längsten
    // niemandem aufgefallen sind.
    workspace.ladeAufgaben(guildId, betrachter, {
      status: workspace.OFFENE_STATUS,
      bisFrist: new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()) - 1),
      grenze: 8,
    }),
    workspace.ladeAufgaben(guildId, betrachter, { status: workspace.OFFENE_STATUS, grenze: 8 }),
    ladeTeam(),
  ]);

  const kennungen = [...ueberfaellig, ...naechste].flatMap((zeile) => zeile.zustaendige);
  const namen = await namenKarte(kennungen);

  const darfProjekte = can(context, workspace.WORKSPACE_PERMISSIONS.projectsCreate);
  const darfAufgaben = can(context, workspace.WORKSPACE_PERMISSIONS.tasksCreate);
  const csrfToken = csrfTokenFor(context);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="uebersicht"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center gap-2">
        {darfAufgaben ? (
          <AufgabeFormular
            csrfToken={csrfToken}
            projekte={projekte.map((zeile) => ({ id: zeile.projekt.id, title: zeile.projekt.title }))}
            team={team}
            ichDiscordId={context.user.discordId}
          />
        ) : null}
        {darfProjekte ? (
          <ProjektFormular
            csrfToken={csrfToken}
            roles={discordOptionen.roles}
            ereignisse={workspace.WORKSPACE_EREIGNISSE}
            channels={discordOptionen.channels}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Überfällig"
          value={String(zahlen.ueberfaellig)}
          hint={zahlen.ueberfaellig === 0 ? 'nichts liegt zurück' : 'Frist ist vorbei'}
          icon="AlarmClock"
          tone={zahlen.ueberfaellig > 0 ? 'destructive' : 'default'}
          href={systemRoutes.workspaceMeine()}
        />
        <StatCard
          label="Bald fällig"
          value={String(zahlen.baldFaellig)}
          hint={`in den nächsten ${einstellungen.baldFaelligTage} ${einstellungen.baldFaelligTage === 1 ? 'Tag' : 'Tagen'}`}
          icon="CalendarDays"
          tone={zahlen.baldFaellig > 0 ? 'warning' : 'default'}
          href={systemRoutes.workspaceMeine()}
        />
        <StatCard
          label="Bei mir"
          value={String(zahlen.meineOffenen)}
          hint="offene Aufgaben"
          icon="CircleCheck"
          href={systemRoutes.workspaceMeine()}
        />
        <StatCard
          label="Aktive Projekte"
          value={String(zahlen.aktiveProjekte)}
          hint={
            zahlen.ohneZustaendige > 0
              ? `${zahlen.ohneZustaendige} Aufgaben ohne Zuständige`
              : 'alle Aufgaben haben Zuständige'
          }
          icon="FolderKanban"
          tone={zahlen.ohneZustaendige > 0 ? 'warning' : 'default'}
          href={systemRoutes.workspaceProjekte()}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Überfällig"
          icon="AlarmClock"
          description={
            ueberfaellig.length === 0 ? 'Keine Frist ist verstrichen.' : 'Die ältesten Fristen zuerst.'
          }
        >
          {ueberfaellig.length === 0 ? (
            <EmptyState
              title="Nichts liegt zurück"
              description="Sobald eine Frist verstreicht, steht die Aufgabe hier - und zwar an erster Stelle."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {ueberfaellig.map((zeile) => (
                <AufgabenZeile
                  key={zeile.aufgabe.id}
                  zeile={zeile}
                  namen={namen}
                  jetzt={jetzt}
                  baldTage={einstellungen.baldFaelligTage}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Als Nächstes"
          icon="ListChecks"
          description="Nach Frist, dann nach Priorität."
          action={{ label: 'Alle Aufgaben', href: systemRoutes.workspaceBoard() }}
        >
          {naechste.length === 0 ? (
            <EmptyState
              title="Keine offenen Aufgaben"
              description={
                darfAufgaben
                  ? 'Lege die erste Aufgabe an - mit oder ohne Projekt.'
                  : 'Sobald das Team Aufgaben anlegt, stehen sie hier.'
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {naechste.map((zeile) => (
                <AufgabenZeile
                  key={zeile.aufgabe.id}
                  zeile={zeile}
                  namen={namen}
                  jetzt={jetzt}
                  baldTage={einstellungen.baldFaelligTage}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Projekte"
        icon="FolderKanban"
        description={projekte.length === 0 ? 'Noch kein Projekt.' : 'Was gerade läuft.'}
        action={{ label: 'Alle Projekte', href: systemRoutes.workspaceProjekte() }}
      >
        {projekte.length === 0 ? (
          <EmptyState
            title="Noch kein Projekt"
            description={
              darfProjekte
                ? 'Ein Projekt bündelt Aufgaben, Fristen und Meilensteine - und bleibt im Archiv auffindbar, wenn es vorbei ist.'
                : 'Sobald das Team ein Projekt anlegt, steht es hier.'
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projekte.slice(0, 6).map((zeile) => (
              <Link
                key={zeile.projekt.id}
                href={systemRoutes.workspaceProjekt(zeile.projekt.id)}
                className="group space-y-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 font-medium leading-snug group-hover:underline">
                    {zeile.projekt.title}
                  </span>
                  {/* Die Akzentfarbe als Punkt, nicht als Rahmen: sie soll das
                      Projekt erkennbar machen und nicht die Karte einfärben. */}
                  {zeile.projekt.accent ? (
                    <span
                      aria-hidden="true"
                      className="mt-1 size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: zeile.projekt.accent }}
                    />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProjektStatusAbzeichen status={zeile.projekt.status} />
                  <Frist dueAt={zeile.projekt.dueAt} jetzt={jetzt} baldTage={einstellungen.baldFaelligTage} />
                </div>
                <Fortschrittsbalken fortschritt={zeile.fortschritt} />
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Schnell erledigt" icon="Zap">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction
            title="Meine Aufgaben"
            description="Was bei dir liegt"
            icon="CircleCheck"
            href={systemRoutes.workspaceMeine()}
          />
          <QuickAction
            title="Board"
            description="Offen bis erledigt"
            icon="KanbanSquare"
            href={systemRoutes.workspaceBoard()}
          />
          <QuickAction
            title="Projekte"
            description="Laufende Vorhaben"
            icon="FolderKanban"
            href={systemRoutes.workspaceProjekte()}
          />
          <QuickAction
            title="Archiv"
            description="Was einmal war"
            icon="Archive"
            href={systemRoutes.workspaceArchiv()}
          />
        </div>
      </Panel>
    </div>
  );
}

/** Eine Zeile in den beiden Listen - dieselbe Zeile, damit sie sich gleich liest. */
function AufgabenZeile({
  zeile,
  namen,
  jetzt,
  baldTage,
}: {
  zeile: Awaited<ReturnType<typeof workspace.ladeAufgaben>>[number];
  namen: Awaited<ReturnType<typeof namenKarte>>;
  jetzt: Date;
  baldTage: number;
}): React.JSX.Element {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 space-y-1">
        <Link
          href={systemRoutes.workspaceAufgabe(zeile.aufgabe.id)}
          className={cn('block truncate text-sm font-medium hover:underline')}
        >
          {zeile.aufgabe.title}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <StatusAbzeichen status={zeile.aufgabe.status} />
          <PrioritaetAbzeichen prioritaet={zeile.aufgabe.priority} />
          <Frist dueAt={zeile.aufgabe.dueAt} jetzt={jetzt} baldTage={baldTage} />
          {zeile.projektTitel ? (
            <span className="truncate text-xs text-muted-foreground">{zeile.projektTitel}</span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        <Zustaendige kennungen={zeile.zustaendige} namen={namen} max={3} />
      </div>
    </li>
  );
}
