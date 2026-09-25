'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface BackupAbschnitt {
  href: string;
  label: string;
  /** Eine Zahl, die vor dem Klick etwas beantwortet - etwa offene Freigaben. */
  badge?: number;
  /** Ein Punkt, der auf einen Befund hinweist. */
  warnung?: boolean;
}

/**
 * Die Abschnitte von Backup & Recovery.
 *
 * Dieselbe Reiterleiste wie in den uebrigen Modulen. Sie ist Darstellung und
 * keine Sicherheit - jede Seite prueft ihre Berechtigung serverseitig selbst.
 */
export function BackupAbschnittsNav({ abschnitte }: { abschnitte: BackupAbschnitt[] }): React.JSX.Element {
  const pfad = usePathname();

  return (
    <nav
      aria-label="Backup & Recovery"
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
            {abschnitt.warnung && !aktiv ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive"
                aria-label="Es liegen Befunde vor"
              />
            ) : null}
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
