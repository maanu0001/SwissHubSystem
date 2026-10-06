'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Das Inhaltsverzeichnis einer Dokumentation.
 *
 * ## Zwei Darstellungen, eine Liste
 *
 * Am Rechner eine Spalte links, auf dem Telefon ein Schubfach. Dieselben
 * Daten, derselbe aktive Eintrag - eine zweite Liste fuer Mobile liefe beim
 * ersten neuen Kapitel auseinander.
 *
 * Der aktive Eintrag kommt aus `usePathname` und nicht aus einem Prop: die
 * Navigation steht im Layout und wird beim Seitenwechsel nicht neu gebaut.
 */
export interface NavKategorie {
  id: string;
  titel: string;
  seiten: readonly { slug: string; titel: string; href: string }[];
}

function Liste({
  kategorien,
  pfad,
  onNavigate,
}: {
  kategorien: readonly NavKategorie[];
  pfad: string;
  onNavigate?: () => void;
}): React.JSX.Element {
  return (
    <nav aria-label="Dokumentationsinhalt" className="space-y-5">
      {kategorien.map((kategorie) => (
        <div key={kategorie.id}>
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {kategorie.titel}
          </p>
          <ul className="space-y-0.5">
            {kategorie.seiten.map((seite) => {
              const aktiv = pfad === seite.href;
              return (
                <li key={seite.slug}>
                  <Link
                    href={seite.href}
                    onClick={onNavigate}
                    aria-current={aktiv ? 'page' : undefined}
                    className={cn(
                      'block min-w-0 truncate rounded-md px-2 py-1.5 text-sm transition-colors',
                      aktiv
                        ? // Der Streifen links macht den aktiven Eintrag auch
                          // dann erkennbar, wenn Rot schlecht zu sehen ist.
                          'border-l-2 border-primary bg-primary/10 pl-[0.375rem] font-medium text-primary-bright'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {seite.titel}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DokuNavigation({
  kategorien,
  titel,
}: {
  kategorien: readonly NavKategorie[];
  titel: string;
}): React.JSX.Element {
  const pfad = usePathname();
  const [offen, setOffen] = useState(false);

  return (
    <>
      {/* Telefon und Tablet: ein Knopf, der ein Schubfach aufzieht. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm font-medium"
          aria-expanded={offen}
        >
          <Menu className="size-4" aria-hidden="true" />
          Inhalt
        </button>
        {offen ? (
          <div className="fixed inset-0 z-50 flex">
            <button
              type="button"
              aria-label="Inhalt schliessen"
              onClick={() => setOffen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <div className="relative ml-auto flex h-full w-[min(20rem,85vw)] flex-col border-l border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="min-w-0 truncate text-sm font-semibold">{titel}</p>
                <button
                  type="button"
                  onClick={() => setOffen(false)}
                  aria-label="Schliessen"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto p-3">
                <Liste kategorien={kategorien} pfad={pfad} onNavigate={() => setOffen(false)} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Rechner: die Spalte bleibt stehen, der Inhalt scrollt daran vorbei. */}
      <div className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          <Liste kategorien={kategorien} pfad={pfad} />
        </div>
      </div>
    </>
  );
}
