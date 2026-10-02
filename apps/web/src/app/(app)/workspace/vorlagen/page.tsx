import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { workspaceEinstellungen } from '@/modules/workspace/daten';
import { PRIORITAET_LABEL } from '@/modules/workspace/labels';
import { Tags } from '@/modules/workspace/components/abzeichen';
import {
  AusVorlage,
  StandardvorlagenKnopf,
  VorlageArchivKnopf,
} from '@/modules/workspace/components/vorlagen-steuerung';

export const metadata: Metadata = { title: 'Vorlagen · Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Vorlagen.
 *
 * ## Was hier steht
 *
 * Jede Vorlage mit ihren Schritten und deren relativen Fristen. Die Fristen
 * sind sichtbar, weil sie der eigentliche Inhalt sind: «Regelwerk schreiben,
 * drei Wochen vorher» ist die Erfahrung, die hier aufbewahrt wird - nicht der
 * Titel der Aufgabe.
 *
 * ## Warum keine Bearbeitung der Schritte hier
 *
 * Eine Vorlage anzulegen und eine bestehende Schritt für Schritt umzubauen sind
 * zwei verschiedene Aufgaben, und die zweite braucht eine Oberfläche, die sich
 * dreissig Zeilen umordnen lässt. Bis die gebraucht wird, legt man eine neue
 * Vorlage an und archiviert die alte - das ist ein Klick mehr und keine halbe
 * Oberfläche.
 */
export default async function WorkspaceVorlagenPage({
  searchParams,
}: {
  searchParams: Promise<{ archiv?: string }>;
}): Promise<React.JSX.Element> {
  /*
   * `view` als Guard, nicht `templates.manage`.
   *
   * Eine Vorlage ist die gesammelte Erfahrung des Teams - sie zu lesen ist
   * dasselbe Recht wie das Modul zu oeffnen. Verwaltet wird sie nur mit
   * `templates.manage`, und die Knoepfe dafuer stehen unten entsprechend.
   *
   * Die beiden Berechtigungen stehen in der Engine nebeneinander und nicht
   * ineinander: `templates.manage` als Guard wuerde jemanden hereinlassen, der
   * `view` nicht hat.
   */
  const context = await requirePagePermission(workspace.WORKSPACE_PERMISSIONS.view);
  const { archiv } = await searchParams;
  const archiviert = archiv === 'ja';
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();

  const [vorlagen, zahlen] = await Promise.all([
    workspace.ladeVorlagen(guildId, { archiviert }),
    workspace.ladeUebersichtszahlen(guildId, context.user.discordId, {
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const csrfToken = csrfTokenFor(context);
  const darfStarten = can(context, workspace.WORKSPACE_PERMISSIONS.projectsCreate);
  const darfVerwalten = can(context, workspace.WORKSPACE_PERMISSIONS.templatesManage);

  const knopf =
    'flex min-h-11 items-center rounded-full border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground';
  const knopfAktiv =
    'flex min-h-11 items-center rounded-full border border-primary bg-primary/10 px-3 text-sm font-medium text-foreground';

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="vorlagen"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={systemRoutes.workspaceVorlagen()} className={archiviert ? knopf : knopfAktiv}>
            Aktiv
          </Link>
          <Link
            href={`${systemRoutes.workspaceVorlagen()}?archiv=ja`}
            className={archiviert ? knopfAktiv : knopf}
          >
            Archiviert
          </Link>
        </div>
        {darfVerwalten && !archiviert ? <StandardvorlagenKnopf csrfToken={csrfToken} /> : null}
      </div>

      {vorlagen.length === 0 ? (
        <EmptyState
          title={archiviert ? 'Nichts archiviert' : 'Noch keine Vorlage'}
          description={
            archiviert
              ? 'Archivierte Vorlagen stehen hier und lassen sich zurückholen.'
              : darfVerwalten
                ? 'Eine Vorlage ist eine Liste von Aufgaben mit Fristen relativ zum Zieldatum - die zwölf Dinge, die bei einem Turnier immer anfallen. Die vier Standardvorlagen sind ein Anfang.'
                : 'Sobald das Team Vorlagen anlegt, stehen sie hier.'
          }
        />
      ) : (
        <div className="space-y-4">
          {vorlagen.map((vorlage) => (
            <Panel
              key={vorlage.id}
              title={vorlage.name}
              icon="Copy"
              description={vorlage.description ?? undefined}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {darfStarten && !archiviert ? (
                    <AusVorlage
                      csrfToken={csrfToken}
                      templateId={vorlage.id}
                      name={vorlage.name}
                      projektTitel={vorlage.projectTitle}
                      anzahl={vorlage.tasks.length}
                    />
                  ) : null}
                  <VorlageArchivKnopf csrfToken={csrfToken} templateId={vorlage.id} archiviert={archiviert} />
                </div>
              }
            >
              <div className="space-y-3">
                <Tags tags={vorlage.tags} />
                <ol className="divide-y divide-border/60">
                  {vorlage.tasks.map((aufgabe) => (
                    <li key={aufgabe.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate">{aufgabe.title}</span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        {aufgabe.priority !== 'NORMAL' ? (
                          <span className="text-xs text-muted-foreground">
                            {PRIORITAET_LABEL[aufgabe.priority]}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            aufgabe.faelligNachTagen === null
                              ? 'text-muted-foreground/60'
                              : 'text-muted-foreground',
                          )}
                        >
                          {relativeFrist(aufgabe.faelligNachTagen)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                {vorlage.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Diese Vorlage hat keine Schritte.</p>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * «14 Tage vorher» statt «-14».
 *
 * Die Zahl im Datenmodell ist vorzeichenbehaftet, weil sie gerechnet wird; die
 * Anzeige ist ein Satz, weil sie gelesen wird. Jemandem «-14» hinzuschreiben
 * hiesse, ihn die Rechnung selbst machen zu lassen.
 */
function relativeFrist(tage: number | null): string {
  if (tage === null) {
    return 'ohne Frist';
  }
  if (tage === 0) {
    return 'am Zieltag';
  }
  const betrag = Math.abs(tage);
  const einheit = betrag === 1 ? 'Tag' : 'Tage';
  return tage < 0 ? `${betrag} ${einheit} vorher` : `${betrag} ${einheit} danach`;
}
