import { can } from '@swisshub/auth';
import { workspace } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import type { AuthContext } from '@swisshub/auth';
import type { ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Die Bereiche des Workspace.
 *
 * ## Warum acht und nicht drei
 *
 * Weil jeder davon eine andere Frage beantwortet. «Meine Aufgaben» ist die
 * Frage am Morgen, das Board die am Nachmittag, die Planung die am
 * Monatsanfang. Sie in einer Seite mit Filtern zusammenzulegen hiesse, dass
 * jeder sie jeden Tag neu einstellt.
 *
 * ## Warum die Einstellungen nach aussen führen
 *
 * Sie liegen unter System → Module, wie bei jedem Modul: die Modulseite
 * erzeugt sie aus `settingsFields`. Eine eigene Seite hier wäre eine zweite
 * Stelle mit derselben Oberfläche.
 *
 * Diese Leiste ist Darstellung, keine Sicherheit - jede Seite prüft ihre
 * Berechtigung zusätzlich selbst über `requirePagePermission`.
 */
export function workspaceNavigation(
  context: AuthContext,
  abzeichen: { meineOffenen?: number } = {},
): ModulNavigationEintrag[] {
  const eintraege: ModulNavigationEintrag[] = [
    {
      key: 'uebersicht',
      label: 'Übersicht',
      href: systemRoutes.workspace(),
      icon: 'LayoutDashboard',
      hinweis: 'Was ansteht',
    },
    {
      key: 'meine',
      label: 'Meine Aufgaben',
      href: systemRoutes.workspaceMeine(),
      icon: 'CircleCheck',
      hinweis: 'Was bei dir liegt',
      // Eine Null wird nicht angezeigt - sie ist keine Nachricht.
      badge: abzeichen.meineOffenen,
    },
    {
      key: 'board',
      label: 'Board',
      href: systemRoutes.workspaceBoard(),
      icon: 'KanbanSquare',
      hinweis: 'Offen bis erledigt',
    },
    {
      key: 'projekte',
      label: 'Projekte',
      href: systemRoutes.workspaceProjekte(),
      icon: 'FolderKanban',
      hinweis: 'Laufende Vorhaben',
    },
  ];

  eintraege.push({
    key: 'archiv',
    label: 'Archiv',
    href: systemRoutes.workspaceArchiv(),
    icon: 'Archive',
    hinweis: 'Abgeschlossene Projekte',
  });

  if (can(context, workspace.WORKSPACE_PERMISSIONS.settingsManage)) {
    eintraege.push({
      key: 'einstellungen',
      label: 'Einstellungen',
      href: '/modules/workspace',
      icon: 'Settings',
      hinweis: 'Vorwarnzeit und Erinnerungen',
    });
  }

  return eintraege;
}
