'use client';

import { usePathname } from 'next/navigation';
import { UserMenu, type UserMenuProps } from './user-menu';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { NotificationBell, type NotificationBellProps } from './notification-bell';
import { BrandMark } from '@/components/shared/brand-mark';
import { KOPF_GRUPPE } from '@/lib/kopfzeile-geometrie';
import { cn } from '@/lib/utils';
import type { NavigationGroup } from './sidebar-nav';

export interface HeaderTitle {
  href: string;
  label: string;
  description?: string;
}

interface AppHeaderProps {
  titles: HeaderTitle[];
  groups: NavigationGroup[];
  user: UserMenuProps;
  canSearchMembers: boolean;
  logoUrl: string;
  /** Die persönlichen Benachrichtigungen der angemeldeten Person. */
  benachrichtigungen: NotificationBellProps;
}

/**
 * Kopfzeile: Seitentitel (aus der Module Registry abgeleitet), Schnellsuche
 * und Benutzerprofil. Der Titel kommt aus der Route - dadurch muss ihn keine
 * Seite doppelt pflegen.
 *
 * Hier stand ein Eingabefeld für die Mitgliedersuche, und es hatte `⌘K` für
 * sich. Zwei Dinge waren daran schief: die Tastenkombination gehörte einer
 * einzelnen Funktion statt der Navigation, und wer den Mitgliederbereich
 * nicht sehen durfte, hatte gar keine - für ihn tat `⌘K` nichts.
 *
 * Jetzt öffnet `⌘K` die Schnellnavigation, und die Mitgliedersuche steht
 * darin als erster Vorschlag, sobald man tippt - auf derselben Adresse wie
 * zuvor und weiterhin nur für Berechtigte.
 */
export function AppHeader({
  titles,
  groups,
  user,
  canSearchMembers,
  logoUrl,
  benachrichtigungen,
}: AppHeaderProps): React.JSX.Element {
  const pathname = usePathname();

  const current = titles
    .filter((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    /*
     * Die Zonen der Kopfzeile - und warum sie deklariert sind.
     *
     * Gemessen auf acht Seiten und fuenf Bildschirmen: die Kopfzeile stand
     * ueberall gleich. Wandern tat nichts. Der Seitentitel aber bekam nur das,
     * was uebrig blieb - auf 390 Pixeln waren das 72, und daraus wurde aus
     * «Dashboard» ein «Das…». Auf 360 blieben 42 Pixel und damit «Da…».
     *
     * Der Titel ist das einzige, was sich je Seite aendert, und er war das
     * einzige, was man nicht lesen konnte. Deshalb drei Zonen statt vier
     * Geschwister in einer Reihe: links und rechts tragen `shrink-0` und
     * damit feste Breiten, die Mitte nimmt den Rest und darf als einzige
     * nachgeben. Was sich aendern darf, ist der Text - nicht die Geometrie.
     *
     * `h-14` auf dem Telefon ist eine **Hoehe**, kein Mindestmass. Vorher
     * stand hier `min-h-[4.5rem]` plus Innenabstand, und die Hoehe ergab sich
     * aus dem Inhalt: 75 Pixel mobil, 77 ab `sm`. Ein Mindestmass, das der
     * Inhalt ueberschreitet, ist keine Vorgabe mehr.
     *
     * Ab `sm` bleibt alles wie bisher: dort steht die Beschreibung unter dem
     * Titel, die Zeile ist zweizeilig, und der Rechner soll sich nicht
     * aendern.
     */
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div
        className={cn(
          'flex h-14 items-center gap-2',
          'sm:h-auto sm:min-h-[4.5rem] sm:gap-3 sm:py-3',
          /*
           * Safe Area ohne doppelte Addition.
           *
           * `max()` und nicht `calc(... + ...)`: auf einem Geraet ohne
           * Aussparung ist der Wert null und es bleibt beim normalen Rand; wo
           * eine Aussparung ist, gewinnt sie. Addiert man beides, steht die
           * Kopfzeile auf dem iPhone quer ploetzlich doppelt so weit innen.
           */
          'pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]',
          'pt-[env(safe-area-inset-top)]',
          'sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]',
        )}
      >
        {/* --- Linke Zone: Menue und Marke, feste Breite --- */}
        <div className="flex shrink-0 items-center gap-1 lg:hidden">
          <MobileNav groups={groups} logoUrl={logoUrl} />
          <BrandMark size={28} withWordmark={false} logoUrl={logoUrl} />
        </div>

        {/* --- Mitte: der Rest, und das einzige, was nachgibt --- */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-2xl" title={current?.label}>
            {current?.label ?? 'SwissHub'}
          </h1>
          {current?.description ? (
            <p className="hidden truncate text-sm text-muted-foreground sm:block" title={current.description}>
              {current.description}
            </p>
          ) : null}
        </div>

        {/* --- Rechte Zone: drei gleich grosse Flaechen, feste Breite --- */}
        <div className={KOPF_GRUPPE}>
          <CommandPalette groups={groups} canSearchMembers={canSearchMembers} />
          <NotificationBell {...benachrichtigungen} />
          <UserMenu {...user} />
        </div>
      </div>
    </header>
  );
}
