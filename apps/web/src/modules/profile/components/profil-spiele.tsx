'use client';

import { useEffect, useState } from 'react';
import { Gamepad2, Star } from 'lucide-react';
import type { profile } from '@swisshub/modules';

/**
 * Die Spiele eines Profils.
 *
 * ## Warum die Felder aus der Registry kommen und nicht aus einer Abfrage
 *
 * «Premier 18 400», «FACEIT 8», «Entry» - welche Zeilen ein Spiel hat, steht
 * in `profil/spielfelder.ts`, und der Dienst hat sie dort schon
 * nachgeschlagen. Diese Datei kennt kein einziges Spiel beim Namen; ein
 * neues Spiel braucht hier keine Zeile.
 *
 * ## Warum das Cover erst nach dem Mounten erscheint
 *
 * Dieselbe Falle wie im Spielekatalog: ein `<img>`, das schon im
 * servergerenderten HTML steht, kann fehlschlagen, bevor React hydriert -
 * `onError` feuert dann nie, und uebrig bleibt ein leerer Rahmen. Wird das
 * Bild erst nach dem Mounten eingehaengt, haengt der Handler, bevor das
 * Laden beginnt.
 */
export function ProfilSpiele({ spiele }: { spiele: profile.ProfilSpiel[] }): React.JSX.Element {
  if (spiele.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[hsl(var(--profil-rand))] px-4 py-8 text-center text-sm text-muted-foreground">
        Noch keine Spiele eingetragen.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {spiele.map((spiel) => (
        <li key={spiel.id} className="min-w-0">
          <SpielKachel spiel={spiel} />
        </li>
      ))}
    </ul>
  );
}

function SpielKachel({ spiel }: { spiel: profile.ProfilSpiel }): React.JSX.Element {
  return (
    <article
      className={`pr-kachel flex h-full gap-3 overflow-hidden rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))] p-3 hover:border-[hsl(var(--profil-akzent)/0.55)] ${
        spiel.archiviert ? 'opacity-70' : ''
      }`}
    >
      <Cover src={spiel.cover} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words text-sm font-semibold leading-tight">{spiel.name}</h3>
          {spiel.favorit ? (
            <Star
              className="size-4 shrink-0 fill-[hsl(45_92%_58%)] text-[hsl(45_92%_58%)]"
              aria-label="Lieblingsspiel"
            />
          ) : null}
        </div>

        {spiel.plattform ? <p className="mt-0.5 text-xs text-muted-foreground">{spiel.plattform}</p> : null}

        {spiel.felder.length > 0 ? (
          <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {spiel.felder.map((feld) => (
              <div key={feld.key} className="min-w-0">
                <dt className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  {feld.label}
                </dt>
                <dd
                  className={`break-words text-xs ${
                    feld.hervorgehoben ? 'font-semibold text-[hsl(var(--profil-akzent))]' : ''
                  }`}
                >
                  {feld.wert}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {spiel.notiz ? <p className="mt-2 break-words text-xs text-muted-foreground">{spiel.notiz}</p> : null}

        {spiel.archiviert ? (
          <p className="mt-2 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            Nicht mehr im Katalog
          </p>
        ) : null}
      </div>
    </article>
  );
}

function Cover({ src }: { src: string | null }): React.JSX.Element {
  const [geladen, setGeladen] = useState(false);
  const [gescheitert, setGescheitert] = useState(false);

  useEffect(() => setGeladen(true), []);

  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-[hsl(var(--profil-rand))] bg-card-elevated">
      <span className="absolute inset-0 flex items-center justify-center">
        <Gamepad2 className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      {src && geladen && !gescheitert ? (
        /* Siehe oben: das Cover kann von einer fremden Adresse kommen. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          onError={() => setGescheitert(true)}
        />
      ) : null}
    </div>
  );
}
