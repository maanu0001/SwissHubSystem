'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, Link2, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Cover, Vorzeile } from './bausteine';
import { neuerSchluessel } from '@/modules/spielwahl/verbindung';
import type { Befehlssatz, SpielTreffer } from '@/modules/spielwahl/befehle';
import { cn } from '@/lib/utils';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Die Lobby.
 *
 * ## Was hier passieren muss, und zwar schnell
 *
 * Jemand tippt zwei Buchstaben und will sein Spiel sehen. Die Suche geht
 * gegen denselben Katalog wie Turniere und Clips - keine zweite Spieleliste -
 * und wartet 180 Millisekunden nach dem letzten Tastendruck, bevor sie
 * fragt. Ohne diese Pause wäre jeder Buchstabe eine Anfrage.
 *
 * ## Warum ein freier Titel kein Cover bekommt
 *
 * Weil das Cover dann aus einer Eingabe käme. Eine Adresse aus fremder Hand
 * lädt diese Anwendung nirgends - nicht als Bild, nicht als Vorschau, nicht
 * im Hintergrund. Stattdessen steht dort dieselbe Monogrammfläche wie bei
 * jedem Katalogspiel ohne Bild: nach Absicht aussehend statt nach Fehler.
 */
export function Lobby({
  stand,
  csrfToken,
  darfFuehren,
  befehle,
}: {
  stand: Stand;
  csrfToken: string;
  darfFuehren: boolean;
  befehle: Befehlssatz;
}): React.JSX.Element {
  const [laeuft, starteUebergang] = useTransition();
  const offen = stand.status === 'LOBBY';
  const eigeneRolle = stand.eigeneRolle;
  /*
   * Wer dabei ist, schlaegt vor - mit Konto oder ohne.
   *
   * Hier stand `!stand.betrachterIstGast`, und das war die Oberflaechenseite
   * einer Sperre in `schlageVor`. Beide sind weg: eine Runde, in der nur
   * Angemeldete Spiele nennen koennen, ist fuer eine Gruppe ohne Konten eine
   * leere Liste mit einem Rad, das nichts zu drehen hat.
   *
   * Die Grenzen sind weiterhin die des Moduls und fuer alle dieselben: das
   * Kontingent je Person, der Katalogzwang ohne freie Titel, der Zustand der
   * Runde. Das Suchfeld erscheint deshalb genau dann, wenn noch ein Vorschlag
   * frei ist - `stand.eigeneVorschlaegeOffen`.
   */
  const darfVorschlagen = true;

  return (
    <div className="flex w-full flex-col gap-8">
      <div>
        <Vorzeile>{offen ? 'Vorschläge offen' : 'Die Auswahl steht'}</Vorzeile>
        <h2 className="text-[clamp(1.7rem,6.5vw,2.8rem)] font-black leading-[1.03] tracking-tight text-white">
          {offen ? 'Was könnten wir spielen?' : `${stand.kandidaten.length} Spiele im Rennen`}
        </h2>
        {offen ? (
          <p className="mt-1.5 text-sm text-white/45">
            {eigeneRolle
              ? stand.eigeneVorschlaegeOffen > 0
                ? `Du hast noch ${stand.eigeneVorschlaegeOffen} ${stand.eigeneVorschlaegeOffen === 1 ? 'Vorschlag' : 'Vorschläge'}.`
                : 'Deine Vorschläge sind vergeben. Nimm einen zurück, wenn du einen anderen willst.'
              : 'Tritt bei, um mitzumachen.'}
          </p>
        ) : null}
      </div>

      {offen && darfVorschlagen && eigeneRolle && stand.eigeneVorschlaegeOffen > 0 ? (
        <Spielsuche
          stand={stand}
          csrfToken={csrfToken}
          befehle={befehle}
          laeuft={laeuft}
          starte={starteUebergang}
        />
      ) : null}

      <Kandidatenliste
        stand={stand}
        csrfToken={csrfToken}
        befehle={befehle}
        darfFuehren={darfFuehren}
        offen={offen}
        laeuft={laeuft}
        starte={starteUebergang}
      />
    </div>
  );
}

function Spielsuche({
  stand,
  csrfToken,
  befehle,
  laeuft,
  starte,
}: {
  stand: Stand;
  csrfToken: string;
  befehle: Befehlssatz;
  laeuft: boolean;
  starte: (arbeit: () => void) => void;
}): React.JSX.Element {
  const [suche, setSuche] = useState('');
  const [treffer, setTreffer] = useState<SpielTreffer[]>([]);
  const [sucht, setSucht] = useState(false);
  const letzte = useRef(0);

  useEffect(() => {
    const lauf = ++letzte.current;
    setSucht(true);
    const uhr = window.setTimeout(() => {
      /*
       * Die Suche des Gastes nimmt die `sessionId` mit, die des Mitglieds
       * ignoriert sie: fuer einen Gast ist die Runde der Anlass, aus dem
       * gesucht wird, und damit die Stelle, an der sein Zugang geprueft wird.
       */
      void befehle
        .spieleSuchen({ sessionId: stand.id, query: suche, csrfToken })
        .then((antwort) => {
          // Eine ältere Antwort darf eine neuere nicht überschreiben.
          if (lauf !== letzte.current) {
            return;
          }
          setTreffer(antwort.ok ? antwort.data.spiele : []);
        })
        .finally(() => {
          if (lauf === letzte.current) {
            setSucht(false);
          }
        });
    }, 180);
    return () => window.clearTimeout(uhr);
  }, [suche, csrfToken, befehle, stand.id]);

  const schonDabei = useMemo(
    () => new Set(stand.kandidaten.map((eintrag) => eintrag.gameId).filter(Boolean) as string[]),
    [stand.kandidaten],
  );

  const vorschlagen = (eingabe: { gameId?: string; freierName?: string }): void => {
    starte(async () => {
      const antwort = await befehle.vorschlagen({
        sessionId: stand.id,
        schluessel: neuerSchluessel(),
        csrfToken,
        ...eingabe,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      /*
       * Das Suchfeld leeren, aber den Stand nicht selbst nachziehen: der
       * neue Kandidat kommt ueber den Live-Strom, und zwar fuer alle
       * gleichzeitig. Ein optimistischer Eintrag waere ein zweiter Weg zur
       * selben Wahrheit.
       */
      setSuche('');
    });
  };

  const freierTitel = suche.trim();
  const freiMoeglich =
    stand.einstellungen.freieVorschlaege &&
    freierTitel.length >= 2 &&
    !treffer.some((spiel) => spiel.name.toLowerCase() === freierTitel.toLowerCase());

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/30"
          aria-hidden="true"
        />
        <Input
          value={suche}
          onChange={(ereignis) => setSuche(ereignis.target.value)}
          placeholder="Spiel suchen …"
          aria-label="Spiel suchen"
          maxLength={60}
          className="h-12 border-white/10 bg-white/[0.04] pl-10 text-base text-white placeholder:text-white/25"
        />
        {sucht ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-white/25"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {treffer.map((spiel) => {
          const dabei = schonDabei.has(spiel.id);
          return (
            <li key={spiel.id}>
              <button
                type="button"
                disabled={laeuft}
                onClick={() => vorschlagen({ gameId: spiel.id })}
                className={cn(
                  'group relative block w-full overflow-hidden rounded-xl text-left ring-1 ring-white/10 transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))]',
                  'hover:-translate-y-0.5 hover:ring-white/25',
                )}
              >
                <Cover name={spiel.name} bannerUrl={spiel.bannerUrl} className="aspect-[4/3] w-full" />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
                  <span className="min-w-0 truncate text-xs font-semibold text-white">{spiel.name}</span>
                  {dabei ? (
                    <Check
                      className="size-3.5 shrink-0 text-emerald-400"
                      aria-label="steht schon im Rennen"
                    />
                  ) : (
                    <Plus
                      className="size-3.5 shrink-0 text-white/50 transition group-hover:text-white"
                      aria-hidden="true"
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {freiMoeglich ? (
        <Button
          type="button"
          variant="outline"
          disabled={laeuft}
          onClick={() => vorschlagen({ freierName: freierTitel })}
          className="w-full border-dashed border-white/15 bg-transparent text-white/70 hover:bg-white/5"
        >
          <Plus className="size-4" aria-hidden="true" />«{freierTitel}» vorschlagen - steht nicht im Katalog
        </Button>
      ) : null}

      {!sucht && treffer.length === 0 && !freiMoeglich ? (
        <p className="py-4 text-center text-sm text-white/35">
          {suche.trim().length > 0
            ? 'Nichts gefunden.'
            : 'Der Spielekatalog ist leer - das Team pflegt ihn unter «Spielekatalog».'}
        </p>
      ) : null}
    </div>
  );
}

function Kandidatenliste({
  stand,
  csrfToken,
  befehle,
  darfFuehren,
  offen,
  laeuft,
  starte,
}: {
  stand: Stand;
  csrfToken: string;
  befehle: Befehlssatz;
  darfFuehren: boolean;
  offen: boolean;
  laeuft: boolean;
  starte: (arbeit: () => void) => void;
}): React.JSX.Element {
  if (stand.kandidaten.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
        <p className="text-base font-semibold text-white/70">Noch nichts im Rennen.</p>
        <p className="mt-1 text-sm text-white/35">
          Sucht euer Spiel oben - und wenn drei Leute dasselbe nennen, wird daraus ein Eintrag mit drei
          Stimmen dahinter, nicht drei Einträge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Vorzeile>Im Rennen</Vorzeile>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stand.kandidaten.map((kandidat, index) => {
          const eigener = kandidat.unterstuetzer.includes(stand.betrachter);
          return (
            <li
              key={kandidat.id}
              className="sp-auf relative"
              style={{ ['--verzug' as string]: `${index * 40}ms` }}
            >
              <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
                <Cover name={kandidat.name} bannerUrl={kandidat.bannerUrl} className="aspect-[4/3] w-full" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-7">
                  <p className="truncate text-sm font-semibold text-white">{kandidat.name}</p>
                  <p className="text-[0.7rem] text-white/45">
                    {kandidat.unterstuetzer.length === 1
                      ? '1 will das'
                      : `${kandidat.unterstuetzer.length} wollen das`}
                  </p>
                </div>
              </div>

              {offen && (eigener || darfFuehren) ? (
                <button
                  type="button"
                  disabled={laeuft}
                  aria-label={eigener ? `${kandidat.name} zurückziehen` : `${kandidat.name} entfernen`}
                  onClick={() =>
                    starte(async () => {
                      const antwort = eigener
                        ? await befehle.zurueckziehen({
                            sessionId: stand.id,
                            candidateId: kandidat.id,
                            csrfToken,
                          })
                        : await befehle.kandidatEntfernen({
                            sessionId: stand.id,
                            candidateId: kandidat.id,
                            csrfToken,
                          });
                      if (!antwort.ok) {
                        toast.error(antwort.error.message);
                      }
                    })
                  }
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white/60 backdrop-blur transition hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))]"
                >
                  {eigener ? (
                    <X className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Einladungsknopf({ token }: { token: string }): React.JSX.Element {
  const [kopiert, setKopiert] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/10 hover:text-white"
      onClick={() => {
        const adresse = `${window.location.origin}/was-spielen-wir/${token}`;
        void navigator.clipboard
          .writeText(adresse)
          .then(() => {
            setKopiert(true);
            window.setTimeout(() => setKopiert(false), 2000);
          })
          .catch(() => toast.error('Der Link liess sich nicht kopieren.'));
      }}
    >
      {kopiert ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Link2 className="size-4" aria-hidden="true" />
      )}
      {kopiert ? 'Kopiert' : 'Einladung'}
    </Button>
  );
}
