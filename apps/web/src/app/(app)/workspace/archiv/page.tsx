import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { namenKarte, workspaceBetrachter, workspaceEinstellungen } from '@/modules/workspace/daten';
import { Fortschrittsbalken, Tags, Zustaendige } from '@/modules/workspace/components/abzeichen';
import { zeitpunktText } from '@/modules/workspace/labels';

export const metadata: Metadata = { title: 'Archiv · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Das Archiv.
 *
 * ## Wozu es da ist
 *
 * Für die häufigste Frage an so ein Werkzeug: «haben wir das schon mal
 * gemacht, und wie?» Deshalb wird archiviert statt gelöscht - und deshalb hat
 * das Archiv eine Suche. Ein Archiv, in dem man nur blättern kann, ist bei
 * dreissig Projekten keines mehr.
 *
 * Zurückgeholt wird auf der Projektseite und nicht hier: das ist eine
 * Entscheidung über ein bestimmtes Projekt, und sie gehört dorthin, wo man
 * sieht, was darin steht.
 */
export default async function WorkspaceArchivPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view);
  const betrachter = workspaceBetrachter(context);
  const { q } = await searchParams;
  const suche = (q ?? '').trim();
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();

  const [projekte, zahlen] = await Promise.all([
    workspace.ladeProjekte(guildId, betrachter, { archiviert: true, ...(suche ? { suche } : {}) }),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const namen = await namenKarte([
    ...projekte.flatMap((zeile) => zeile.mitglieder.map((mitglied) => mitglied.discordId)),
    ...projekte.map((zeile) => zeile.projekt.archivedByDiscordId),
  ]);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="archiv"
        label="Bereiche im Workspace"
      />

      <form action={systemRoutes.workspaceArchiv()} className="flex items-center gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={suche}
          placeholder="Titel, Beschreibung oder Tag"
          className="w-64"
          aria-label="Archiv durchsuchen"
        />
        <Button type="submit" variant="outline" size="sm">
          Suchen
        </Button>
      </form>

      <Panel
        title={suche ? `Treffer für «${suche}»` : 'Archivierte Projekte'}
        icon="Archive"
        description={
          projekte.length === 0
            ? undefined
            : `${projekte.length} ${projekte.length === 1 ? 'Projekt' : 'Projekte'} · zuletzt archiviert zuerst`
        }
      >
        {projekte.length === 0 ? (
          <EmptyState
            title={suche ? 'Kein Treffer' : 'Noch nichts archiviert'}
            description={
              suche
                ? 'Vielleicht läuft das Projekt noch - unter «Projekte» wird getrennt gesucht.'
                : 'Abgeschlossene Projekte landen hier, statt gelöscht zu werden. Aufgaben, Kommentare und Verlauf bleiben vollständig lesbar.'
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {projekte.map((zeile) => (
              <li key={zeile.projekt.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    href={systemRoutes.workspaceProjekt(zeile.projekt.id)}
                    className="min-w-0 text-sm font-medium hover:underline"
                  >
                    {zeile.projekt.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {zeile.projekt.archivedAt ? zeitpunktText(zeile.projekt.archivedAt) : ''}
                    {zeile.projekt.archivedByDiscordId
                      ? ` · ${namen.get(zeile.projekt.archivedByDiscordId)?.name ?? ''}`
                      : ''}
                  </span>
                </div>
                {zeile.projekt.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{zeile.projekt.description}</p>
                ) : null}
                <Tags tags={zeile.projekt.tags} />
                <div className="grid gap-2 sm:max-w-sm">
                  <Fortschrittsbalken fortschritt={zeile.fortschritt} />
                </div>
                <Zustaendige
                  kennungen={zeile.mitglieder.map((mitglied) => mitglied.discordId)}
                  namen={namen}
                  max={5}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
