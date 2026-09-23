'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface ClipAbschnitt {
  href: string;
  label: string;
  badge?: number;
}

/**
 * Die Abschnitte von Clip of the Week.
 *
 * Bewusst schlicht und als Reiterleiste: «Diese Woche» und «Hall of Fame»
 * stehen fuer alle da, Moderation und Runden nur fuer die, die sie auch
 * betreten duerfen. Jede Seite prueft die Berechtigung zusaetzlich selbst -
 * diese Leiste ist Darstellung, keine Sicherheit.
 */
export function ClipAbschnittsNav({ abschnitte }: { abschnitte: ClipAbschnitt[] }): React.JSX.Element {
  const pfad = usePathname();

  return (
    <nav
      aria-label="Clip of the Week"
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {abschnitte.map((abschnitt) => {
        const aktiv = pfad === abschnitt.href;
        return (
          <Link
            key={abschnitt.href}
            href={abschnitt.href}
            aria-current={aktiv ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              aktiv
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {abschnitt.label}
            {abschnitt.badge ? (
              <span
                className={cn(
                  'grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                  aktiv ? 'bg-primary-foreground/20' : 'bg-primary/15 text-primary',
                )}
              >
                {abschnitt.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
