import Link from 'next/link';
import { NavIcon } from '@/components/layout/nav-icon';
import { cn } from '@/lib/utils';

/**
 * Die Unternavigation eines Moduls.
 *
 * ## Warum es sie gibt
 *
 * Ein Modul mit mehreren Bereichen bekommt in der Seitenleiste genau einen
 * Eintrag - das ist Absicht, sonst stuenden dort dreissig. Der Preis dafuer
 * ist, dass die uebrigen Bereiche einen Weg brauchen, und zwar von **jeder**
 * Seite des Moduls aus.
 *
 * Genau daran ist Wrapped gescheitert: die Seitenleiste fuehrte ins Studio,
 * und von dort gab es keinen Link auf Ausgaben oder Community Moments.
 * Umgekehrt schon - die Ausgaben verlinkten beides. Wer den Einstieg nahm,
 * den die Navigation anbot, landete in einer Sackgasse.
 *
 * ## Warum eine Serverkomponente
 *
 * Welche Bereiche jemand sieht, haengt an Berechtigungen, und die werden
 * serverseitig geprueft. Ein Client, der die Liste selbst zusammensetzt,
 * bekaeme sie entweder vollstaendig geschickt - dann steht in seinem HTML,
 * welche Bereiche es gibt - oder er muesste sie nachladen.
 *
 * Der aktive Bereich kommt deshalb als Angabe von der Seite und nicht aus
 * `usePathname`. Eine Seite weiss, wo sie ist.
 */

export interface ModulNavigationEintrag {
  /** Stabiler Schluessel - die Seite nennt ihn als `aktiv`. */
  key: string;
  label: string;
  href: string;
  /** Name eines Symbols aus `nav-icon.tsx`. */
  icon: string;
  /** Kurzer Zusatz unter der Beschriftung. Auf schmalen Geräten ausgeblendet. */
  hinweis?: string;
}

export function ModulNavigation({
  eintraege,
  aktiv,
  label,
  className,
}: {
  eintraege: readonly ModulNavigationEintrag[];
  aktiv: string;
  /** Beschriftung für Screenreader, z.B. «Bereiche in SwissHub Wrapped». */
  label: string;
  className?: string;
}): React.JSX.Element | null {
  /*
   * Ein einzelner Bereich ist keine Navigation.
   *
   * Wer nur die Community Moments pflegen darf, bekommt keine Leiste mit
   * einem Knopf darin - das sieht nach einer Auswahl aus, die es nicht gibt.
   */
  if (eintraege.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label={label}
      /* Seitlich scrollend statt umbrechend: auf 320 px passen drei
         Beschriftungen nicht nebeneinander, und zwei Zeilen Reiter sind
         schlimmer als ein Wisch. Die negativen Ränder lassen den Inhalt am
         Bildschirmrand auslaufen, damit sichtbar ist, dass es weitergeht. */
      className={cn('relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}
    >
      <ul className="flex min-w-max gap-1 border-b border-border">
        {eintraege.map((eintrag) => {
          const istAktiv = eintrag.key === aktiv;
          return (
            <li key={eintrag.key}>
              <Link
                href={eintrag.href}
                aria-current={istAktiv ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors [&_svg]:size-4',
                  istAktiv ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <NavIcon name={eintrag.icon} />
                {eintrag.label}
                {eintrag.hinweis ? (
                  <span className="hidden text-xs font-normal text-muted-foreground md:inline">
                    {eintrag.hinweis}
                  </span>
                ) : null}
                {istAktiv ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-bright"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
