import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import type { WorkspacePriority, WorkspaceTaskStatus } from '@swisshub/database';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { WORKSPACE_ZUGANG, ladeTeam, namenKarte, workspaceBetrachter, workspaceEinstellungen } from '@/modules/workspace/daten';
import {
  ChecklisteZahl,
  Frist,
  PrioritaetAbzeichen,
  StatusAbzeichen,
  Tags,
  Zustaendige,
} from '@/modules/workspace/components/abzeichen';
import { AufgabeFormular } from '@/modules/workspace/components/aufgabe-formular';
import { PRIORITAET_LABEL } from '@/modules/workspace/labels';

export const metadata: Metadata = { title: 'Meine Aufgaben · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Meine Aufgaben.
 *
 * ## Warum die Filter in der Adresse stehen
 *
 * Weil «meine offenen, nach Frist» eine Ansicht ist, die man verlinkt und
 * wiederfindet. Ein Zustand im Browser wäre nach jedem Neuladen weg - und
 * serverseitig gefiltert bleibt es eine Abfrage statt dreihundert Zeilen, die
 * der Browser dann aussortiert.
 *
 * ## Warum «alle» kein versteckter Schalter ist
 *
 * Eine Seite, die «Meine Aufgaben» heisst und alle zeigt, wäre gelogen. Der
 * Umschalter steht deshalb sichtbar oben, und die Überschrift des Panels sagt,
 * was gerade gezeigt wird.
 */

type Suche = { wer?: string; status?: string; prio?: string; q?: string };

const STATUS_FILTER: Array<{ key: string; label: string; status: readonly WorkspaceTaskStatus[] }> = [
  { key: 'offen', label: 'Offen', status: workspace.OFFENE_STATUS },
  { key: 'alle', label: 'Alle', status: workspace.AUFGABEN_STATUS },
  { key: 'erledigt', label: 'Erledigt', status: ['DONE'] },
];

export default async function WorkspaceMeinePage({
  searchParams,
}: {
  searchParams: Promise<Suche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(WORKSPACE_ZUGANG);
  const betrachter = workspaceBetrachter(context);
  const suche = await searchParams;
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const jetzt = new Date();

  const nurMeine = suche.wer !== 'alle';
  const statusFilter = STATUS_FILTER.find((eintrag) => eintrag.key === suche.status) ?? STATUS_FILTER[0]!;
  const prio = (['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).includes(suche.prio as WorkspacePriority)
    ? (suche.prio as WorkspacePriority)
    : null;
  const text = (suche.q ?? '').trim();

  const [aufgaben, projekte, team, zahlen] = await Promise.all([
    workspace.ladeAufgaben(guildId, betrachter, {
      status: statusFilter.status,
      ...(nurMeine ? { zustaendig: context.user.discordId } : {}),
      ...(prio ? { prioritaet: [prio] } : {}),
      ...(text ? { suche: text } : {}),
      grenze: 200,
    }),
    workspace.ladeAktiveProjekte(guildId, betrachter),
    ladeTeam(),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const namen = await namenKarte(aufgaben.flatMap((zeile) => zeile.zustaendige));
  const csrfToken = csrfTokenFor(context);
  const darfAufgaben = can(context, workspace.WORKSPACE_PERMISSIONS.tasksCreate);

  /** Eine Adresse mit geänderten Filtern - die übrigen bleiben stehen. */
  const mitFilter = (aenderung: Partial<Suche>): string => {
    const parameter = new URLSearchParams();
    const zusammen = { ...suche, ...aenderung };
    for (const [schluessel, wert] of Object.entries(zusammen)) {
      if (wert && wert !== '') {
        parameter.set(schluessel, wert);
      }
    }
    const rest = parameter.toString();
    return rest === '' ? systemRoutes.workspaceMeine() : `${systemRoutes.workspaceMeine()}?${rest}`;
  };

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="meine"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center gap-2">
        {darfAufgaben ? (
          <AufgabeFormular
            csrfToken={csrfToken}
            projekte={projekte.map((projekt) => ({ id: projekt.id, title: projekt.title }))}
            team={team}
            ichDiscordId={context.user.discordId}
          />
        ) : null}
      </div>

      <div className="space-y-3">
        <Filterreihe
          label="Wer"
          eintraege={[
            { label: 'Ich', href: mitFilter({ wer: undefined }), aktiv: nurMeine },
            { label: 'Alle', href: mitFilter({ wer: 'alle' }), aktiv: !nurMeine },
          ]}
        />
        <Filterreihe
          label="Status"
          eintraege={STATUS_FILTER.map((eintrag) => ({
            label: eintrag.label,
            href: mitFilter({ status: eintrag.key === 'offen' ? undefined : eintrag.key }),
            aktiv: eintrag.key === statusFilter.key,
          }))}
        />
        <Filterreihe
          label="Priorität"
          eintraege={[
            { label: 'Alle', href: mitFilter({ prio: undefined }), aktiv: prio === null },
            ...(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const).map((wert) => ({
              label: PRIORITAET_LABEL[wert],
              href: mitFilter({ prio: wert }),
              aktiv: prio === wert,
            })),
          ]}
        />
      </div>

      <Panel
        title={nurMeine ? 'Meine Aufgaben' : 'Alle Aufgaben'}
        icon="CircleCheck"
        description={`${statusFilter.label}${prio ? ` · ${PRIORITAET_LABEL[prio]}` : ''} · nach Frist, dann nach Priorität`}
      >
        {aufgaben.length === 0 ? (
          <EmptyState
            title={nurMeine ? 'Nichts bei dir' : 'Keine Aufgaben'}
            description={
              nurMeine
                ? 'Mit diesen Filtern liegt bei dir nichts. Über «Alle» siehst du, woran das Team arbeitet.'
                : 'Mit diesen Filtern gibt es keine Aufgabe.'
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {aufgaben.map((zeile) => (
              <li key={zeile.aufgabe.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1.5">
                  <Link
                    href={systemRoutes.workspaceAufgabe(zeile.aufgabe.id)}
                    className="block text-sm font-medium leading-snug hover:underline"
                  >
                    {zeile.aufgabe.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusAbzeichen status={zeile.aufgabe.status} />
                    <PrioritaetAbzeichen prioritaet={zeile.aufgabe.priority} />
                    <Frist
                      dueAt={zeile.aufgabe.dueAt}
                      jetzt={jetzt}
                      baldTage={einstellungen.baldFaelligTage}
                    />
                    <ChecklisteZahl gesamt={zeile.checklisteGesamt} offen={zeile.checklisteOffen} />
                    {zeile.projektTitel ? (
                      <span className="truncate text-xs text-muted-foreground">{zeile.projektTitel}</span>
                    ) : null}
                  </div>
                  <Tags tags={zeile.aufgabe.tags} />
                </div>
                <div className="shrink-0 pt-0.5">
                  <Zustaendige kennungen={zeile.zustaendige} namen={namen} max={3} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * Eine Filterzeile.
 *
 * Links und keine Knöpfe: der Filter steht in der Adresse, und ein Link ist
 * das, was eine Adresse ändert - mit Mittelklick, Lesezeichen und Zurück-Knopf
 * inklusive.
 */
function Filterreihe({
  label,
  eintraege,
}: {
  label: string;
  eintraege: Array<{ label: string; href: string; aktiv: boolean }>;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {eintraege.map((eintrag) => (
        <Link
          key={eintrag.href}
          href={eintrag.href}
          aria-current={eintrag.aktiv ? 'true' : undefined}
          className={cn(
            'flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors',
            eintrag.aktiv
              ? 'border-primary bg-primary/10 font-medium text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {eintrag.label}
        </Link>
      ))}
    </div>
  );
}
