'use client';

import { Check, EyeOff, Lock } from 'lucide-react';
import { Cover, Frist, Vorzeile } from './bausteine';
import { cn } from '@/lib/utils';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Die Abstimmung.
 *
 * ## Warum hier keine Balken wachsen, solange geheim gewählt wird
 *
 * Weil der Server die Zahlen gar nicht erst schickt. Eine Oberfläche, die sie
 * bekommt und ausblendet, blendet sie nur so lange aus, bis jemand die
 * Netzwerkanfragen ansieht. Was hier fehlt, fehlt echt.
 *
 * Sichtbar ist stattdessen, **wie viele** schon gewählt haben - das nimmt der
 * Gruppe das Warten, ohne das Ergebnis vorwegzunehmen.
 */
export function Abstimmung({
  stand,
  rest,
  aufStimme,
  beschaeftigt,
}: {
  stand: Stand;
  rest: number | null;
  aufStimme: (candidateId: string) => void;
  beschaeftigt: boolean;
}): React.JSX.Element | null {
  const runde = stand.runde;
  if (!runde) {
    return null;
  }

  const kandidaten = runde.kandidaten
    .map((id) => stand.kandidaten.find((eintrag) => eintrag.id === id))
    .filter((eintrag): eintrag is Stand['kandidaten'][number] => Boolean(eintrag));

  const offen = stand.status === 'ENTSCHEIDUNG';
  const geheim = stand.einstellungen.geheimeStimmen && runde.stimmen === null;
  const hoechste = runde.stimmen ? Math.max(1, ...Object.values(runde.stimmen)) : 1;
  const uebrig = stand.einstellungen.stimmenProPerson - runde.eigeneStimmen.length;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Vorzeile>
            {runde.nummer > 1 && runde.entscheidungsart === 'stichwahl'
              ? 'Stichwahl'
              : `Runde ${runde.nummer}`}
          </Vorzeile>
          <h2 className="text-[clamp(1.6rem,6vw,2.6rem)] font-black leading-[1.05] tracking-tight text-white">
            {offen ? 'Was solls sein?' : 'Ausgezählt'}
          </h2>
          <p className="mt-1 text-sm text-white/45">
            {offen
              ? uebrig > 0
                ? `Du hast noch ${uebrig} ${uebrig === 1 ? 'Stimme' : 'Stimmen'}.`
                : 'Deine Stimme steht. Nochmal antippen nimmt sie zurück.'
              : 'Die Abstimmung ist vorbei.'}
          </p>
        </div>
        <div className="min-w-[10rem] flex-1 sm:max-w-xs">
          {offen ? <Frist rest={rest} dauerSek={stand.einstellungen.abstimmdauerSek} /> : null}
          <p className="mt-2 text-right text-xs text-white/35">
            {runde.abgegeben} von {stand.teilnehmer.length} haben gewählt
          </p>
        </div>
      </div>

      {geheim && offen ? (
        <p className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
          <EyeOff className="size-3.5" aria-hidden="true" />
          Geheim - die Zahlen kommen erst zum Schluss.
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kandidaten.map((kandidat, index) => {
          const gewaehlt = runde.eigeneStimmen.includes(kandidat.id);
          const zahl = runde.stimmen?.[kandidat.id] ?? null;
          const gewinner = !offen && runde.gewinnerCandidateId === kandidat.id;

          return (
            <li key={kandidat.id} className="sp-auf" style={{ ['--verzug' as string]: `${index * 45}ms` }}>
              <button
                type="button"
                disabled={!offen || beschaeftigt}
                onClick={() => aufStimme(kandidat.id)}
                aria-pressed={gewaehlt}
                className={cn(
                  'group relative block w-full overflow-hidden rounded-xl text-left transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
                  offen ? 'hover:-translate-y-0.5 hover:brightness-110' : '',
                  gewinner ? 'sp-glut' : '',
                  !offen && !gewinner ? 'opacity-45' : '',
                )}
              >
                <Cover name={kandidat.name} bannerUrl={kandidat.bannerUrl} className="aspect-[4/3] w-full" />

                <span
                  className={cn(
                    'pointer-events-none absolute inset-0 rounded-xl ring-inset transition',
                    gewaehlt ? 'ring-2 ring-[hsl(var(--sp-rot-hell))]' : 'ring-1 ring-white/10',
                  )}
                />

                {gewaehlt ? (
                  <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-[hsl(var(--sp-rot-hell))] text-white">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                ) : null}

                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
                  <span className="min-w-0 truncate text-sm font-semibold text-white">{kandidat.name}</span>
                  {zahl !== null ? (
                    <span className="shrink-0 font-mono text-lg font-bold tabular-nums text-white">
                      {zahl}
                    </span>
                  ) : null}
                </span>

                {zahl !== null ? (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                    <span
                      className="block h-full bg-[hsl(var(--sp-rot-hell))] transition-[width] duration-500"
                      style={{ width: `${(zahl / hoechste) * 100}%` }}
                    />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {!offen && stand.einstellungen.geheimeStimmen ? (
        <p className="inline-flex items-center gap-2 self-start text-xs text-white/35">
          <Lock className="size-3.5" aria-hidden="true" />
          Die Stimmen waren bis zum Schluss verdeckt.
        </p>
      ) : null}
    </div>
  );
}
