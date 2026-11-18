'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { systemRoutes } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';
import { kommentarEntfernenAction, kommentarSchreibenAction } from '@/modules/profile/kommentar-aktionen';

/**
 * Die Pinnwand unter einem oeffentlichen Profil.
 *
 * ## Warum sie ausserhalb der Profilgestaltung steht
 *
 * Das Profil darueber traegt das Design seiner Besitzerin - eigene Farben,
 * eigene Flaechen, eigener Hintergrund. Die Kommentare gehoeren nicht ihr,
 * sondern den Leuten, die sie geschrieben haben, und sie sollen auf jedem
 * Profil gleich aussehen und gleich gut lesbar sein. In die Themenfarben
 * gezogen waere ein Kommentar auf einem dunklen Design irgendwann nicht mehr
 * zu lesen, und zwar ohne dass es jemandem auffaellt, der es selbst nicht
 * benutzt.
 *
 * ## Warum die Liste nachgeladen wird
 *
 * Die Profilseite liegt eine Minute lang im Zwischenspeicher - deshalb ist
 * sie schnell. Die Kommentare passen dort nicht hinein: neben dem eigenen
 * steht ein Loeschknopf, neben einem fremden nicht. Mitgespeichert zeigte die
 * Seite dem naechsten Besucher die Knoepfe des vorigen. Die Begruendung in
 * ganzer Laenge steht in `app/api/profil/kommentare/[slug]/route.ts`.
 *
 * ## Warum ohne Anmeldung nichts versteckt wird
 *
 * Ein Gast sieht die Kommentare und sieht, dass es ein Feld gaebe - mit einem
 * Link zum Anmelden. Das Feld ganz wegzulassen hiesse, ihm die Moeglichkeit zu
 * verschweigen; ein Feld, das beim Abschicken scheitert, waere schlimmer.
 */

/** Dieselbe Grenze wie im Schema des Moduls. */
const MAX_ZEICHEN = 500;

/**
 * Feste Zeitzone, feste Sprache.
 *
 * Ohne die Zeitzone formatiert jeder Browser nach seiner eigenen, und zwei
 * Besucher sehen unter demselben Kommentar zwei Uhrzeiten. Es ist eine
 * Schweizer Gemeinschaft auf einem Schweizer Server; die Zeit ist die hiesige.
 */
const ZEIT = new Intl.DateTimeFormat('de-CH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Zurich',
});

interface Kommentar {
  id: string;
  autorDiscordId: string;
  autorName: string;
  text: string;
  /** ISO-8601 - so kommt es durch JSON. */
  geschriebenAm: string;
  loeschbar: boolean;
}

interface Antwort {
  csrfToken: string | null;
  kommentare: Kommentar[];
}

export function OeKommentare({ slug }: { slug: string }): React.JSX.Element {
  const [stand, setStand] = useState<Antwort | null>(null);
  const [gescheitert, setGescheitert] = useState(false);
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const laden = useCallback(async (): Promise<void> => {
    try {
      const antwort = await fetch(`/api/profil/kommentare/${encodeURIComponent(slug)}`, {
        cache: 'no-store',
      });
      if (!antwort.ok) {
        setGescheitert(true);
        return;
      }
      setStand((await antwort.json()) as Antwort);
      setGescheitert(false);
    } catch {
      /*
       * Ein Netzfehler ist kein Grund fuer eine Fehlermeldung in Rot.
       *
       * Die Kommentare sind der Fuss der Seite. Wer sie nicht laden kann,
       * sieht einen Satz und einen Knopf - das Profil darueber steht und ist
       * das, weswegen er da ist.
       */
      setGescheitert(true);
    }
  }, [slug]);

  useEffect(() => {
    void laden();
  }, [laden]);

  const uebrig = MAX_ZEICHEN - text.trim().length;
  const abschickbar = text.trim().length > 0 && uebrig >= 0 && !laeuft;
  const csrfToken = stand?.csrfToken ?? null;

  const schreiben = async (): Promise<void> => {
    if (!csrfToken || !abschickbar) {
      return;
    }
    setLaeuft(true);
    try {
      const antwort = await kommentarSchreibenAction({ csrfToken, slug, text: text.trim() });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Der Kommentar konnte nicht gespeichert werden.');
        return;
      }
      setText('');
      toast.success('Kommentar veröffentlicht.');
      /*
       * Neu laden statt die Liste im Browser zu ergaenzen.
       *
       * Der Server hat gerade entschieden, wie der Eintrag aussieht - Name,
       * Zeit, Loeschrecht. Dasselbe hier noch einmal zusammenzusetzen waere
       * eine zweite Vorstellung davon, und sie wuerde irgendwann abweichen.
       */
      await laden();
    } finally {
      setLaeuft(false);
    }
  };

  const entfernen = async (kommentarId: string): Promise<void> => {
    if (!csrfToken) {
      return;
    }
    setLaeuft(true);
    try {
      const antwort = await kommentarEntfernenAction({ csrfToken, kommentarId });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Der Kommentar konnte nicht entfernt werden.');
        return;
      }
      toast.success('Kommentar entfernt.');
      await laden();
    } finally {
      setLaeuft(false);
    }
  };

  const kommentare = stand?.kommentare ?? [];

  return (
    <section className="mx-auto mt-10 w-full max-w-2xl px-4" aria-labelledby="kommentare-titel">
      <h2 id="kommentare-titel" className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        Kommentare
        {kommentare.length > 0 ? (
          <span className="font-normal text-muted-foreground">({kommentare.length})</span>
        ) : null}
      </h2>

      {gescheitert ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
          <span>Die Kommentare liessen sich nicht laden.</span>
          <button
            type="button"
            onClick={() => void laden()}
            className="shrink-0 text-xs font-medium text-foreground underline underline-offset-4"
          >
            Erneut versuchen
          </button>
        </div>
      ) : stand === null ? (
        /*
         * Zwei graue Balken statt eines Textes.
         *
         * «Wird geladen …» waere eine Zeile, die gleich wieder verschwindet,
         * und sie verschiebt beim Verschwinden alles darunter.
         */
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <>
          {csrfToken ? (
            <div className="mt-3">
              <label htmlFor="kommentar-text" className="sr-only">
                Kommentar schreiben
              </label>
              <textarea
                id="kommentar-text"
                value={text}
                onChange={(ereignis) => setText(ereignis.target.value)}
                rows={3}
                /*
                 * Etwas mehr als die Grenze.
                 *
                 * Ein `maxLength` genau auf 500 liesse die Taste still ins
                 * Leere laufen - der Zaehler daneben sagt dann nichts, weil
                 * nichts mehr ankommt. So darf jemand darueber hinaus
                 * schreiben und sieht, um wie viel er kuerzen muss.
                 */
                maxLength={MAX_ZEICHEN + 200}
                disabled={laeuft}
                placeholder="Schreib etwas Nettes …"
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                {/*
                  Die Restzahl erscheint erst spaet.

                  Ein Zaehler, der von 500 herunterlaeuft, waehrend jemand
                  einen Satz schreibt, ist eine Aufforderung, sich kurz zu
                  fassen. Ab fuenfzig Zeichen wird er zur Auskunft, die man
                  braucht.
                */}
                <span
                  className={cn(
                    'text-xs',
                    uebrig < 0 ? 'text-destructive' : 'text-muted-foreground',
                    uebrig > 50 ? 'invisible' : undefined,
                  )}
                  aria-live="polite"
                >
                  {uebrig < 0 ? `${-uebrig} Zeichen zu viel` : `noch ${uebrig} Zeichen`}
                </span>
                <button
                  type="button"
                  onClick={() => void schreiben()}
                  disabled={!abschickbar}
                  className="h-9 shrink-0 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {laeuft ? 'Wird gesendet …' : 'Abschicken'}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
              <Link
                /*
                  Die Adresse kommt aus `systemRoutes` und nicht aus einer
                  Zeichenkette. `/u/<slug>` von Hand zusammenzusetzen ist der
                  Fehler, den `tests/unit/app-url.test.ts` abfaengt: es gab
                  einmal zwei Vorstellungen davon, wie ein Profillink aussieht.
                */
                href={`/login?redirect=${encodeURIComponent(systemRoutes.oeffentlichesProfil(slug))}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Melde dich an
              </Link>
              , um einen Kommentar zu schreiben.
            </p>
          )}

          {kommentare.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Noch kein Kommentar. Sei der Erste.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {kommentare.map((kommentar) => (
                <li key={kommentar.id} className="flex gap-3 rounded-lg border border-border p-3">
                  <DiscordAvatar
                    discordId={kommentar.autorDiscordId}
                    name={kommentar.autorName}
                    size={32}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-medium">{kommentar.autorName}</span>
                      <time
                        dateTime={kommentar.geschriebenAm}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {ZEIT.format(new Date(kommentar.geschriebenAm))}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
                      {kommentar.text}
                    </p>
                  </div>
                  {kommentar.loeschbar ? (
                    <button
                      type="button"
                      onClick={() => void entfernen(kommentar.id)}
                      disabled={laeuft}
                      title="Kommentar entfernen"
                      aria-label={`Kommentar von ${kommentar.autorName} entfernen`}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
