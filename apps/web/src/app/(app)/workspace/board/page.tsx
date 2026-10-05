import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { cn } from '@/lib/utils';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import {
  WORKSPACE_ZUGANG,
  ladeTeam,
  namenKarte,
  workspaceBetrachter,
  workspaceEinstellungen,
} from '@/modules/workspace/daten';
import { Board, BoardLeer } from '@/modules/workspace/components/board';
import { AufgabeFormular } from '@/modules/workspace/components/aufgabe-formular';

export const metadata: Metadata = { title: 'Board · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Das Board.
 *
 * ## Warum Projekt und Zuständigkeit über die Adresse gefiltert werden
 *
 * Weil ein Board über alle Projekte bei vier gleichzeitigen Vorhaben unlesbar
 * ist, und weil «mein Board im Winter Cup» eine Ansicht ist, die man verlinkt.
 *
 * Das Ziehen und die Knopfreihe stecken in der Client-Komponente - alles
 * andere, auch die Entscheidung, ob jemand ziehen darf, entsteht hier.
 */

type Suche = { projekt?: string; wer?: string };

export default async function WorkspaceBoardPage({
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

  const nurMeine = suche.wer === 'ich';
  const projektFilter = suche.projekt && suche.projekt !== 'alle' ? suche.projekt : null;

  const [board, projekte, team, zahlen] = await Promise.all([
    workspace.ladeBoard(guildId, betrachter, {
      ...(projektFilter ? { projectId: projektFilter } : {}),
      ...(nurMeine ? { zustaendig: context.user.discordId } : {}),
    }),
    workspace.ladeAktiveProjekte(guildId, betrachter),
    ladeTeam(),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const alleKarten = workspace.BOARD_SPALTEN.flatMap((spalte) => board[spalte]);
  const namen = await namenKarte(alleKarten.flatMap((karte) => karte.zustaendige));
  // Die Client-Komponente bekommt ein einfaches Objekt - eine `Map` übersteht
  // die Grenze zwischen Server und Browser nicht.
  const namenObjekt = Object.fromEntries(namen);

  const csrfToken = csrfTokenFor(context);
  const darfBearbeiten = can(context, workspace.WORKSPACE_PERMISSIONS.tasksEdit);
  const darfAnlegen = can(context, workspace.WORKSPACE_PERMISSIONS.tasksCreate);

  const mitFilter = (aenderung: Partial<Suche>): string => {
    const parameter = new URLSearchParams();
    for (const [schluessel, wert] of Object.entries({ ...suche, ...aenderung })) {
      if (wert && wert !== '') {
        parameter.set(schluessel, wert);
      }
    }
    const rest = parameter.toString();
    return rest === '' ? systemRoutes.workspaceBoard() : `${systemRoutes.workspaceBoard()}?${rest}`;
  };

  const chip = (label: string, href: string, aktiv: boolean): React.JSX.Element => (
    <Link
      key={href + label}
      href={href}
      aria-current={aktiv ? 'true' : undefined}
      className={cn(
        'flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors',
        aktiv
          ? 'border-primary bg-primary/10 font-medium text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="board"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center gap-2">
        {darfAnlegen ? (
          <AufgabeFormular
            csrfToken={csrfToken}
            projekte={projekte.map((projekt) => ({ id: projekt.id, title: projekt.title }))}
            team={team}
            ichDiscordId={context.user.discordId}
            projektVorgabe={projektFilter}
          />
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projekt</span>
          {chip('Alle', mitFilter({ projekt: undefined }), projektFilter === null)}
          {projekte.map((projekt) =>
            chip(projekt.title, mitFilter({ projekt: projekt.id }), projektFilter === projekt.id),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wer</span>
          {chip('Alle', mitFilter({ wer: undefined }), !nurMeine)}
          {chip('Nur meine', mitFilter({ wer: 'ich' }), nurMeine)}
        </div>
      </div>

      {alleKarten.length === 0 ? (
        <BoardLeer darfAnlegen={darfAnlegen} />
      ) : (
        <>
          <Board
            board={board}
            namen={namenObjekt}
            jetzt={jetzt.toISOString()}
            baldTage={einstellungen.baldFaelligTage}
            darfBearbeiten={darfBearbeiten}
            csrfToken={csrfToken}
          />
          {darfBearbeiten ? (
            <p className="text-xs text-muted-foreground">
              Karten lassen sich ziehen - oder über die Knöpfe darunter verschieben. Die Knöpfe sind der Weg,
              der auch auf dem Telefon und mit der Tastatur funktioniert.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
