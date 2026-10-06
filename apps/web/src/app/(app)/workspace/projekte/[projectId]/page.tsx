import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import {
  WORKSPACE_ZUGANG,
  ladeBeteiligte,
  ladeTeam,
  namenKarte,
  workspaceBetrachter,
  workspaceEinstellungen,
} from '@/modules/workspace/daten';
import {
  ChecklisteZahl,
  Frist,
  PrioritaetAbzeichen,
  ProjektStatusAbzeichen,
  StatusAbzeichen,
  Tags,
  Zustaendige,
} from '@/modules/workspace/components/abzeichen';
import { AufgabeFormular } from '@/modules/workspace/components/aufgabe-formular';
import { ProjektFormular } from '@/modules/workspace/components/projekt-formular';
import { ArchivKnopf, Mitgliederverwaltung } from '@/modules/workspace/components/projekt-steuerung';
import { Anhaenge, Links } from '@/modules/workspace/components/mitarbeit';
import { Meilensteine } from '@/modules/workspace/components/meilensteine';
import { ROLLE_LABEL, VERLAUF_LABEL, zeitpunktText } from '@/modules/workspace/labels';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Projekt · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Ein Projekt.
 *
 * ## Warum die Bearbeitungsknöpfe serverseitig entschieden werden
 *
 * Weil die Antwort nicht aus einer Berechtigung allein folgt: `projects.edit`
 * deckt alle Projekte, die Projektleitung nur dieses. `darfBearbeiten` im
 * Modulkern beantwortet beides zusammen - und die Server Action stellt
 * dieselbe Frage noch einmal, weil ein fehlender Knopf keine Sicherung ist.
 */
export default async function WorkspaceProjektPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(WORKSPACE_ZUGANG);
  const betrachter = workspaceBetrachter(context);
  /*
   * Rollen und Kanaele fuer das Projektformular.
   *
   * Aus demselben Zwischenspeicher wie die Moduleinstellungen - die Liste
   * gilt eine Minute, und eine zweite Quelle fuer Discord-Optionen waere eine
   * zweite Antwort auf dieselbe Frage.
   */
  const discordOptionen = await loadDiscordOptions();
  const { projectId } = await params;
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const jetzt = new Date();

  const ansicht = await workspace.ladeProjekt(projectId, betrachter);
  // Ein Projekt einer anderen Gilde ist für diese Seite kein Projekt. Ohne
  // diese Prüfung wäre die Kennung in der Adresse ein Weg hinein.
  if (!ansicht || ansicht.projekt.guildId !== guildId) {
    notFound();
  }

  const [aufgaben, verlauf, team, beteiligte, zahlen, links, anhaenge, meilensteine] = await Promise.all([
    workspace.ladeAufgaben(guildId, betrachter, { projectId, mitArchivierten: true, grenze: 200 }),
    workspace.ladeVerlauf({ projectId }, betrachter, 20),
    ladeTeam(),
    /*
     * Die Eingetragenen getrennt von den Waehlbaren.
     *
     * `ladeTeam` sagt, wer dazukommen kann - gedeckelt und nach Namen
     * sortiert. Wer schon Projektleitung oder Unterstuetzung ist, gehoert
     * angezeigt, ob er in dieser Liste auftaucht oder nicht; und ob er das
     * Modul oeffnen darf, wird gerechnet und nicht aus dem Fehlen in `team`
     * geschlossen.
     */
    ladeBeteiligte(ansicht.mitglieder.map((mitglied) => mitglied.discordId)),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt,
      baldTage: einstellungen.baldFaelligTage,
    }),
    workspace.ladeLinks({ projectId }, betrachter),
    workspace.ladeAnhaenge({ projectId }, betrachter),
    workspace.ladeMeilensteine(projectId, betrachter),
  ]);

  const namen = await namenKarte([
    ...aufgaben.flatMap((zeile) => zeile.zustaendige),
    ...ansicht.mitglieder.map((mitglied) => mitglied.discordId),
    ...verlauf.map((eintrag) => eintrag.actorDiscordId),
    ...anhaenge.map((anhang) => anhang.uploadedByDiscordId),
  ]);
  // Eine `Map` übersteht die Grenze zwischen Server und Browser nicht.
  const namenObjekt = Object.fromEntries(namen);

  const darfBearbeiten = await workspace.darfBearbeiten(
    projectId,
    context.user.discordId,
    can(context, workspace.WORKSPACE_PERMISSIONS.projectsEdit),
  );
  const darfArchivieren = can(context, workspace.WORKSPACE_PERMISSIONS.projectsArchive);
  const darfAufgaben = can(context, workspace.WORKSPACE_PERMISSIONS.tasksCreate);
  const csrfToken = csrfTokenFor(context);

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="projekte"
        label="Bereiche im Workspace"
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold leading-tight">
              {ansicht.projekt.accent ? (
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: ansicht.projekt.accent }}
                />
              ) : null}
              {ansicht.projekt.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <ProjektStatusAbzeichen status={ansicht.projekt.status} />
              {ansicht.projekt.priority ? (
                <PrioritaetAbzeichen prioritaet={ansicht.projekt.priority} />
              ) : null}
              <Frist dueAt={ansicht.projekt.dueAt} jetzt={jetzt} baldTage={einstellungen.baldFaelligTage} />
              <Tags tags={ansicht.projekt.tags} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {darfAufgaben && !ansicht.projekt.archivedAt ? (
              <AufgabeFormular
                csrfToken={csrfToken}
                projekte={[{ id: ansicht.projekt.id, title: ansicht.projekt.title }]}
                team={team}
                ichDiscordId={context.user.discordId}
                projektVorgabe={ansicht.projekt.id}
              />
            ) : null}
            {darfBearbeiten && !ansicht.projekt.archivedAt ? (
              <ProjektFormular
                csrfToken={csrfToken}
                projekt={ansicht.projekt}
                roles={discordOptionen.roles}
                ereignisse={workspace.WORKSPACE_EREIGNISSE}
                channels={discordOptionen.channels}
              />
            ) : null}
            {darfArchivieren ? (
              <ArchivKnopf
                csrfToken={csrfToken}
                projectId={ansicht.projekt.id}
                archiviert={ansicht.projekt.archivedAt !== null}
                titel={ansicht.projekt.title}
              />
            ) : null}
          </div>
        </div>

        {ansicht.projekt.archivedAt ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Dieses Projekt liegt seit {zeitpunktText(ansicht.projekt.archivedAt)} im Archiv. Aufgaben und
            Verlauf sind vollständig da - geändert wird hier nichts mehr, bis es zurückgeholt ist.
          </p>
        ) : null}

        {ansicht.projekt.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{ansicht.projekt.description}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Fortschritt"
          value={`${ansicht.fortschritt.prozent}%`}
          hint={`${ansicht.fortschritt.erledigt} von ${ansicht.fortschritt.gesamt} erledigt`}
          icon="ListChecks"
        />
        <StatCard
          label="Offen"
          value={String(ansicht.offeneAufgaben)}
          hint="Aufgaben in Arbeit oder wartend"
          icon="CircleCheck"
        />
        <StatCard
          label="Beteiligt"
          value={String(ansicht.mitglieder.length)}
          hint={`${ansicht.mitglieder.filter((m) => m.rolle === 'LEAD').length}× Projektleitung`}
          icon="Users"
        />
        <StatCard
          label="Angelegt"
          value={zeitpunktText(ansicht.projekt.createdAt).split(',')[0] ?? ''}
          hint={namen.get(ansicht.projekt.createdByDiscordId)?.name ?? 'unbekannt'}
          icon="Clock"
        />
      </div>

      {/*
        `grid-cols-1` ist hier kein Beiwerk, sondern der Fix.

        ## Der Fehler, den es behebt

        Hier stand `grid gap-4 lg:grid-cols-3`. Auf dem Telefon greift `lg:`
        nicht, und ein Grid **ohne** Spaltenangabe legt eine implizite Spur
        mit `auto` an. Das Minimum einer `auto`-Spur ist die
        min-content-Breite ihres Inhalts - die Spur waechst also mit dem
        breitesten Kind, statt es zu begrenzen. Gemessen bei 390 px: die
        Spur war **490 px** breit, die Seite lief um 116 px ueber, und auf
        der Aufgabenseite um 220 px.

        `min-w-0` am Item hilft dagegen nicht, und genau das war die
        Falle - es stand schon da. Das Minimum sitzt an der **Spur**, nicht
        am Kind. Tailwinds `grid-cols-1` ist
        `repeat(1, minmax(0, 1fr))`, und dieses `minmax(0, …)` ist die
        Begrenzung. `lg:grid-cols-3` hat sie von sich aus, darum fiel es nur
        auf Mobile auf.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Aufgaben"
          icon="ListChecks"
          className="lg:col-span-2"
          description={aufgaben.length === 0 ? 'Noch keine Aufgabe.' : 'Nach Frist, dann nach Priorität.'}
        >
          {aufgaben.length === 0 ? (
            <EmptyState
              title="Noch keine Aufgabe"
              description={
                darfAufgaben
                  ? 'Ohne Aufgaben hat das Projekt keinen Fortschritt - er wird aus ihnen gerechnet.'
                  : 'Sobald das Team Aufgaben anlegt, stehen sie hier.'
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
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <Zustaendige kennungen={zeile.zustaendige} namen={namen} max={3} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Beteiligte" icon="Users">
            {darfBearbeiten && !ansicht.projekt.archivedAt ? (
              <Mitgliederverwaltung
                csrfToken={csrfToken}
                projectId={ansicht.projekt.id}
                mitglieder={ansicht.mitglieder}
                beteiligtePersonen={[...beteiligte.values()]}
                team={team}
              />
            ) : (
              <ul className="space-y-2">
                {ansicht.mitglieder.map((mitglied) => (
                  <li key={mitglied.discordId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">
                      {namen.get(mitglied.discordId)?.name ?? mitglied.discordId}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {ROLLE_LABEL[mitglied.rolle]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Meilensteine"
            icon="Flag"
            description="Zeitpunkte, an denen ein Zustand erreicht sein muss."
          >
            <Meilensteine
              csrfToken={csrfToken}
              projectId={ansicht.projekt.id}
              meilensteine={meilensteine}
              darfBearbeiten={darfBearbeiten && !ansicht.projekt.archivedAt}
            />
          </Panel>

          <Panel title="Links" icon="Link2" description="Dokumente, Designs, Beiträge.">
            <Links
              csrfToken={csrfToken}
              bezug={{ projectId: ansicht.projekt.id }}
              links={links}
              darfBearbeiten={darfBearbeiten && !ansicht.projekt.archivedAt}
            />
          </Panel>

          <Panel title="Anhänge" icon="Paperclip">
            <Anhaenge
              csrfToken={csrfToken}
              bezug={{ projectId: ansicht.projekt.id }}
              anhaenge={anhaenge}
              namen={namenObjekt}
              maxBytes={workspace.ANHANG_MAX_BYTES}
              darfBearbeiten={darfBearbeiten && !ansicht.projekt.archivedAt}
            />
          </Panel>

          <Panel title="Verlauf" icon="Activity" description="Was an diesem Projekt geschehen ist.">
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
