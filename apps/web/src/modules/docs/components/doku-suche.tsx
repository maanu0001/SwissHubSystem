'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { finde, type SuchEintrag } from '../register';

/**
 * Die Suche einer Dokumentation.
 *
 * ## Warum sie im Browser sucht
 *
 * Weil der Index klein und unveraenderlich ist. Die Doku aendert sich mit
 * einem Deploy, nicht mit einem Klick - ein Suchdienst oder eine Abfrage je
 * Tastendruck waere Aufwand fuer eine Liste, die zwischen zwei Deploys
 * dieselbe bleibt. Der Index kommt als Prop, gebaut auf dem Server aus
 * denselben Daten, aus denen die Seiten entstehen.
 *
 * Gefunden wird je **Abschnitt**: ein Treffer fuehrt mit Anker dorthin, wo
 * der Begriff steht, und nicht an den Seitenanfang.
 */
export function DokuSuche({
  index,
  platzhalter,
}: {
  index: readonly SuchEintrag[];
  platzhalter: string;
}): React.JSX.Element {
  const [anfrage, setAnfrage] = useState('');
  const treffer = useMemo(() => finde(index, anfrage), [index, anfrage]);
  const gesucht = anfrage.trim().length > 0;

  return (
    /*
     * `relative`: die Trefferliste haengt als Overlay am Feld und nicht im
     * Fluss darunter.
     *
     * Im Fluss wuchs sie dem Umfeld in die Hoehe - auf dem Telefon steht das
     * Feld neben dem Inhalts-Knopf, und eine Liste in dieser Zeile hatte die
     * Zeile auf halbe Bildschirmhoehe aufgezogen, bevor der Artikel anfing.
     *
     * Der Bezugspunkt ist bewusst das Feld und nicht ein Container weiter
     * oben: so liegt die Liste genau unter dem, was man getippt hat, und auf
     * dem Rechner unter der Spalte, in der sie steht. `max-h` plus eigenes
     * Scrollen haelt sie im Viewport, auch bei zwoelf Treffern auf 360px.
     */
    <div className="relative min-w-0">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={anfrage}
          onChange={(ereignis) => setAnfrage(ereignis.target.value)}
          placeholder={platzhalter}
          aria-label="Dokumentation durchsuchen"
          className="h-11 w-full min-w-0 rounded-lg border border-border/60 bg-card/60 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 sm:h-10"
        />
        {gesucht ? (
          <button
            type="button"
            onClick={() => setAnfrage('')}
            aria-label="Suche leeren"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {gesucht ? (
        <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-card shadow-lg">
          {treffer.length === 0 ? (
            /*
             * Kein Treffer ist ein Ergebnis und kein Fehler.
             *
             * Die Zeile sagt, was gesucht wurde - sonst fragt man sich, ob
             * die Eingabe ueberhaupt angekommen ist.
             */
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Keine Treffer für «{anfrage.trim()}». Andere Begriffe oder weniger Wörter versuchen.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {treffer.map((eintrag) => (
                <li key={eintrag.href}>
                  <Link
                    href={eintrag.href}
                    onClick={() => setAnfrage('')}
                    className="block min-w-0 px-3 py-3 transition-colors hover:bg-muted/50 sm:py-2.5"
                  >
                    <p className="min-w-0 text-sm font-medium leading-snug">{eintrag.titel}</p>
                    <p className="min-w-0 truncate text-[11px] text-primary-bright">{eintrag.bereich}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
                      {eintrag.vorschau}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
