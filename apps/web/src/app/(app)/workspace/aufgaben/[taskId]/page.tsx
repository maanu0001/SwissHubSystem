import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { ladeTeam, namenKarte, workspaceEinstellungen } from '@/modules/workspace/daten';
import { Frist, PrioritaetAbzeichen, StatusAbzeichen, Tags } from '@/modules/workspace/components/abzeichen';
import { AufgabeFormular } from '@/modules/workspace/components/aufgabe-formular';
import { AufgabeSteuerung } from '@/modules/workspace/components/aufgabe-steuerung';
import { Anhaenge, Checkliste, Kommentare, Links } from '@/modules/workspace/components/mitarbeit';
import { ERINNERUNG_LABEL, VERLAUF_LABEL, fristText, zeitpunktText } from '@/modules/workspace/labels';

export const metadata: Metadata = { title: 'Aufgabe · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Eine Aufgabe.
 *
 * Links die Sache selbst, rechts der Verlauf - und zwar der Verlauf **dieser**
 * Aufgabe und nicht das Audit Log. Das Audit Log beantwortet «wer hat im System
 * was getan» für die Verwaltung; hier steht «was ist mit dieser Aufgabe
 * passiert», und das ist die Frage, die jemand stellt, der sie nach zwei Wochen
 * wieder aufmacht.
 */
export default async function WorkspaceAufgabePage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view);
  const { taskId } = await params;
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const jetzt = new Date();

  const ansicht = await workspace.ladeAufgabe(taskId);
  // Eine Aufgabe einer anderen Gilde ist hier keine Aufgabe.
  if (!ansicht || ansicht.aufgabe.guildId !== guildId) {
    notFound();
  }

  const [verlauf, projekte, team, zahlen, kommentare, punkte, links, anhaenge] = await Promise.all([
    workspace.ladeVerlauf({ taskId }, 30),
    workspace.ladeAktiveProjekte(guildId),
    ladeTeam(),
    workspace.ladeUebersichtszahlen(guildId, context.user.discordId, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
    workspace.ladeKommentare(taskId),
    workspace.ladeCheckliste(taskId),
    workspace.ladeLinks({ taskId }),
    workspace.ladeAnhaenge({ taskId }),
  ]);

  /*
   * Alle Namen der Seite in einer Karte.
   *
   * Erwähnungen inbegriffen: ein Kommentar kann jemanden nennen, der nicht
   * zuständig ist und nichts an dieser Aufgabe getan hat - ohne seine Kennung
   * hier stünde im Kommentar `<@123>` statt eines Namens.
   */
  const namen = await namenKarte([
    ...ansicht.zustaendige,
    ...verlauf.map((eintrag) => eintrag.actorDiscordId),
    ...kommentare.map((kommentar) => kommentar.authorDiscordId),
    ...kommentare.flatMap((kommentar) => kommentar.mentions),
    ...anhaenge.map((anhang) => anhang.uploadedByDiscordId),
    ansicht.aufgabe.createdByDiscordId,
  ]);
  // Eine `Map` übersteht die Grenze zwischen Server und Browser nicht.
  const namenObjekt = Object.fromEntries(namen);

  const darfBearbeiten = can(context, workspace.WORKSPACE_PERMISSIONS.tasksEdit);
  const darfLoeschen = can(context, workspace.WORKSPACE_PERMISSIONS.tasksDelete);
  const csrfToken = csrfTokenFor(context);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="board"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2 className="text-balance text-xl font-semibold leading-tight">{ansicht.aufgabe.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusAbzeichen status={ansicht.aufgabe.status} />
            <PrioritaetAbzeichen prioritaet={ansicht.aufgabe.priority} />
            <Frist dueAt={ansicht.aufgabe.dueAt} jetzt={jetzt} baldTage={einstellungen.baldFaelligTage} />
            {ansicht.projektTitel && ansicht.aufgabe.projectId ? (
              <Link
                href={systemRoutes.workspaceProjekt(ansicht.aufgabe.projectId)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {ansicht.projektTitel}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">kein Projekt</span>
            )}
            <Tags tags={ansicht.aufgabe.tags} />
          </div>
        </div>
        {darfBearbeiten ? (
          <AufgabeFormular
            csrfToken={csrfToken}
            projekte={projekte.map((projekt) => ({ id: projekt.id, title: projekt.title }))}
            team={team}
            aufgabe={ansicht.aufgabe}
            zustaendigeVorgabe={ansicht.zustaendige}
            variante="outline"
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Beschreibung" icon="ScrollText">
            {ansicht.aufgabe.description ? (
              /* `whitespace-pre-wrap`: der Text kommt aus einem Textfeld, und
                 Absätze darin sind Absätze. Als HTML gedeutet würde er nicht -
                 er steht als Text im Dokument, nicht als Markup. */
              <p className="whitespace-pre-wrap text-sm">{ansicht.aufgabe.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Beschreibung.</p>
            )}
          </Panel>

          <Panel
            title="Checkliste"
            icon="ListChecks"
            description="Die Schritte dieser Aufgabe - sie zählen in den Stand, nicht in den Projektfortschritt."
          >
            <Checkliste
              csrfToken={csrfToken}
              taskId={ansicht.aufgabe.id}
              punkte={punkte}
              darfBearbeiten={darfBearbeiten}
            />
          </Panel>

          <Panel title="Kommentare" icon="MessageSquare" description="Warum etwas so entschieden wurde.">
            <Kommentare
              csrfToken={csrfToken}
              taskId={ansicht.aufgabe.id}
              kommentare={kommentare}
              namen={namenObjekt}
              team={team}
              eigeneKennung={context.user.discordId}
              darfSchreiben={darfBearbeiten}
            />
          </Panel>

          <Panel title="Ändern" icon="Pencil">
            <AufgabeSteuerung
              csrfToken={csrfToken}
              taskId={ansicht.aufgabe.id}
              status={ansicht.aufgabe.status}
              prioritaet={ansicht.aufgabe.priority}
              zustaendige={ansicht.zustaendige}
              team={team}
              darfBearbeiten={darfBearbeiten}
              darfLoeschen={darfLoeschen}
              zurueckAuf={
                ansicht.aufgabe.projectId
                  ? systemRoutes.workspaceProjekt(ansicht.aufgabe.projectId)
                  : systemRoutes.workspaceBoard()
              }
            />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Daten" icon="Clock">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Start</dt>
                <dd>{ansicht.aufgabe.startAt ? fristText(ansicht.aufgabe.startAt) : '–'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Frist</dt>
                <dd>{fristText(ansicht.aufgabe.dueAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Erinnerung</dt>
                <dd>
                  {ERINNERUNG_LABEL[ansicht.aufgabe.reminder]}
                  {ansicht.aufgabe.reminder !== 'NONE' && !einstellungen.erinnerungenAktiv ? (
                    <span className="block text-xs text-warning">
                      Erinnerungen sind für das ganze Modul abgeschaltet.
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Erledigt</dt>
                <dd>{ansicht.aufgabe.doneAt ? zeitpunktText(ansicht.aufgabe.doneAt) : 'noch nicht'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Angelegt</dt>
                <dd>
                  {zeitpunktText(ansicht.aufgabe.createdAt)}
                  <span className="block text-xs text-muted-foreground">
                    {namen.get(ansicht.aufgabe.createdByDiscordId)?.name ??
                      ansicht.aufgabe.createdByDiscordId}
                  </span>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Links" icon="Link2">
            <Links
              csrfToken={csrfToken}
              bezug={{ taskId: ansicht.aufgabe.id }}
              links={links}
              darfBearbeiten={darfBearbeiten}
            />
          </Panel>

          <Panel title="Anhänge" icon="Paperclip">
            <Anhaenge
              csrfToken={csrfToken}
              bezug={{ taskId: ansicht.aufgabe.id }}
              anhaenge={anhaenge}
              namen={namenObjekt}
              maxBytes={workspace.ANHANG_MAX_BYTES}
              darfBearbeiten={darfBearbeiten}
            />
          </Panel>

          <Panel title="Verlauf" icon="Activity">
            {verlauf.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch nichts.</p>
            ) : (
              <ol className="space-y-3">
                {verlauf.map((eintrag) => (
                  <li key={eintrag.id} className="space-y-0.5 text-sm">
                    <p>
                      {VERLAUF_LABEL[eintrag.art] ?? eintrag.art}
                      {eintrag.detail ? (
                        <span className="text-muted-foreground"> · {eintrag.detail}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {namen.get(eintrag.actorDiscordId)?.name ?? eintrag.actorDiscordId} ·{' '}
                      {zeitpunktText(eintrag.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
