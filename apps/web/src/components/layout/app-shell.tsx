import { PermissionProvider } from '@/components/shared/permission-guard';
import { PreviewBanner } from '@/modules/preview/components/preview-banner';
import { Sidebar } from './sidebar';
import { AppHeader, type HeaderTitle } from './app-header';
import type { NavigationGroup } from './sidebar-nav';
import type { ServerCardData } from './server-card';
import type { UserMenuProps } from './user-menu';
import type { NotificationBellProps } from './notification-bell';

interface AppShellProps {
  groups: NavigationGroup[];
  titles: HeaderTitle[];
  permissions: string[];
  user: UserMenuProps;
  server: ServerCardData;
  bot: { online: boolean; wsPingMs: number | null };
  discordUrl: string;
  premium?: { planName: string | null } | null;
  /** Hochgeladenes Logo aus der Branding-Konfiguration. */
  logoUrl: string;
  benachrichtigungen: NotificationBellProps;
  /** Läuft eine Vorschau, steht ihr Banner über allem. */
  vorschau?: { kind: 'USER' | 'ROLE'; label: string } | null;
  children: React.ReactNode;
}

/**
 * Grundlayout: feste Seitenleiste auf Desktop, Drawer auf Mobile,
 * Kopfzeile mit Seitentitel, Suche und Benutzerprofil.
 */
export function AppShell({
  groups,
  titles,
  permissions,
  user,
  server,
  bot,
  discordUrl,
  premium,
  logoUrl,
  benachrichtigungen,
  vorschau,
  children,
}: AppShellProps): React.JSX.Element {
  return (
    <PermissionProvider permissions={permissions}>
      {/*
        Der Vorschau-Banner steht ueber der gesamten Oberflaeche und nicht im
        Inhaltsbereich: er gehoert zu keiner Seite, sondern zum Zustand der
        Sitzung. Ein Admin darf nie vergessen koennen, dass eine Vorschau
        laeuft - sonst haelt er das halbe Dashboard fuer kaputt.
      */}
      {vorschau ? (
        <PreviewBanner kind={vorschau.kind} label={vorschau.label} csrfToken={user.csrfToken} />
      ) : null}
      <div className="flex min-h-dvh">
        <Sidebar
          groups={groups}
          server={server}
          bot={bot}
          discordUrl={discordUrl}
          logoUrl={logoUrl}
          premium={premium}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            titles={titles}
            groups={groups}
            user={user}
            logoUrl={logoUrl}
            // `permissions` ist die aufgeloeste Liste - `admin.full` daneben
            // abzufragen wuerde eine ausdrueckliche Ausnahme uebergehen.
            canSearchMembers={permissions.includes('members.view')}
            benachrichtigungen={benachrichtigungen}
          />

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1600px] space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </PermissionProvider>
  );
}
