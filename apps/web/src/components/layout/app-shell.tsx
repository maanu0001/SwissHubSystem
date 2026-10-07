import { PermissionProvider } from '@/components/shared/permission-guard';
import { cn } from '@/lib/utils';
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

          {/*
            Der Inhalt haelt denselben Abstand wie die Kopfzeile - und
            respektiert dieselbe Aussparung.

            Quer gehalten liegt die Notch eines iPhones links oder rechts
            **neben** dem Inhalt, nicht darueber: die Seitenleiste ist unter
            `lg` ausgeblendet, der Inhalt nimmt die volle Breite, und bei
            `px-4` begann er 16 Pixel vom Rand - also unter der Aussparung.

            `max()` statt `calc(... + ...)`: ohne Aussparung ist der Wert null
            und es bleibt bei den 16 Pixeln; mit Aussparung gewinnt sie. Das
            ist dieselbe Regel wie in der Kopfzeile, und aus demselben Grund -
            addiert stuende der Inhalt quer doppelt so weit innen wie
            hochkant.
          */}
          <main
            className={cn(
              // `pt-6` und nicht `py-6`: ein `pb-*` daneben und ein `py-*`
              // haben dieselbe Spezifitaet, und welches gewinnt, entscheidet
              // die Reihenfolge im Stylesheet - nicht die im Attribut.
              'flex-1 pt-6',
              'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]',
              'sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]',
              'lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]',
              'pb-[max(1.5rem,env(safe-area-inset-bottom))]',
            )}
          >
            <div className="mx-auto w-full max-w-[1600px] space-y-6">{children}</div>
          </main>
        </div>
      </div>
    </PermissionProvider>
  );
}
