'use client';

import { useEffect, useRef, useState } from 'react';
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
                      // `min-h-11` und kein `truncate`: im Schubfach ist Platz
                      // in der Hoehe, nicht in der Breite. Ein Kapitelname wie
                      // «Permission Engine» abzuschneiden macht zwei Eintraege
                      // ununterscheidbar; zweizeilig bleibt er lesbar, und
                      // 44px Hoehe trifft ein Daumen sicher.
                      'flex min-h-11 min-w-0 items-center rounded-md px-2 py-1.5 text-sm leading-snug transition-colors lg:min-h-0',
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
  const knopf = useRef<HTMLButtonElement | null>(null);
  const schliessen = useRef<HTMLButtonElement | null>(null);

  /*
   * Was ein offenes Schubfach braucht, damit es sich wie eines verhaelt.
   *
   * **ESC** schliesst es. Auf dem Rechner ist das die erste Taste, die man
   * drueckt; dass das Schubfach dort selten erscheint, macht es nicht
   * weniger erwartbar.
   *
   * **Die Seite scrollt nicht mit.** Ohne `overflow: hidden` am Dokument
   * laeuft die Wischbewegung im Schubfach am Ende auf die Seite dahinter
   * ueber - man scrollt den Artikel, den man gerade nicht sieht.
   *
   * **Der Fokus wandert hinein und zurueck.** Ein Schubfach, das sich
   * oeffnet, ohne den Fokus mitzunehmen, laesst die Tastatur hinter dem
   * Vorhang stehen; beim Schliessen gehoert er an den Knopf zurueck, der es
   * geoeffnet hat, und nicht an den Anfang des Dokuments.
   */
  useEffect(() => {
    if (!offen) {
      return;
    }
    const vorher = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    schliessen.current?.focus();

    const taste = (ereignis: KeyboardEvent): void => {
      if (ereignis.key === 'Escape') {
        setOffen(false);
      }
    };
    document.addEventListener('keydown', taste);

    return () => {
      document.removeEventListener('keydown', taste);
      document.body.style.overflow = vorher;
      knopf.current?.focus();
    };
  }, [offen]);

  /*
   * Ein Seitenwechsel schliesst das Schubfach - auch wenn er nicht aus einem
   * Klick darin kam. Der Zurueck-Knopf des Browsers wechselt die Seite, ohne
   * `onNavigate` auszuloesen; ohne diese Zeile stuende das Schubfach danach
   * offen vor einer Seite, die man nicht angefordert hat.
   */
  useEffect(() => {
    setOffen(false);
  }, [pfad]);

  return (
    <>
      {/* Telefon und Tablet: ein Knopf, der ein Schubfach aufzieht. */}
      <div className="lg:hidden">
        <button
          ref={knopf}
          type="button"
          onClick={() => setOffen(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border/60 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:w-auto sm:px-3"
          aria-expanded={offen}
          aria-haspopup="dialog"
          aria-label="Inhalt der Dokumentation"
        >
          <Menu className="size-[1.1rem] shrink-0" aria-hidden="true" />
          {/*
            Das Wort erst ab `sm`. Auf 360px steht der Knopf neben dem
            Suchfeld, und jedes Zeichen hier fehlt dort - als quadratischer
            Knopf mit Symbol bleibt er 44px gross und nimmt trotzdem kaum
            Breite.
          */}
          <span className="hidden sm:inline">Inhalt</span>
        </button>
        {offen ? (
          <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={titel}>
            <button
              type="button"
              aria-label="Inhalt schliessen"
              onClick={() => setOffen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            {/*
              `pb-[env(safe-area-inset-bottom)]` und `pr-[env(safe-area-inset-right)]`:
              auf einem iPhone liegt unten die Browserleiste und im Querformat
              rechts die Rundung. Ohne die Insets endet der letzte Eintrag der
              Liste darunter und ist nicht antippbar.
            */}
            <div className="relative ml-auto flex h-full w-[min(20rem,85vw)] flex-col border-l border-border bg-card pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <p className="min-w-0 truncate text-sm font-semibold">{titel}</p>
                <button
                  ref={schliessen}
                  type="button"
                  onClick={() => setOffen(false)}
                  aria-label="Schliessen"
                  className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-3">
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
