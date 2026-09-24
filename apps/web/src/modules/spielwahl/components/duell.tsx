'use client';

import { Check, Swords, Ticket } from 'lucide-react';
import { aktuellesDuell } from '@swisshub/modules/spielwahl/baum';
import { Cover, Frist, Vorzeile } from './bausteine';
import { cn } from '@/lib/utils';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Das Ausscheidungsduell.
 *
 * ## Warum ein Duell nach dem anderen
 *
 * Vier Paarungen nebeneinander wären eine Tabelle mit acht Knöpfen und die
 * Frage, wo man zuerst hinschauen soll. Nacheinander ist es ein Ereignis:
 * zwei Titel, gross, gegeneinander, alle stimmen über dasselbe ab.
 *
 * ## Das Freilos
 *
 * Bei ungerader Zahl bleibt einer übrig. Das ist unvermeidlich - vermeidbar
 * ist nur, dass es aussieht, als hätte es jemand vergeben. Deshalb steht
 * ausdrücklich da, dass es gelost wurde, und der Turnierbaum daneben zeigt,
 * wen es getroffen hat.
 */
export function Duell({
  stand,
  rest,
  aufStimme,
  beschaeftigt,
}: {
  stand: Stand;
  rest: number | null;
  aufStimme: (candidateId: string, duell: number) => void;
  beschaeftigt: boolean;
}): React.JSX.Element | null {
  const runde = stand.runde;
  if (!runde?.baum) {
    return null;
  }

  const baum = runde.baum;
  const paarung = aktuellesDuell(baum, runde.duellIndex);
  const stufe = baum.stufen[baum.stufen.length - 1];
  const offen = stand.status === 'ENTSCHEIDUNG';

  const name = (id: string | null): string =>
    stand.kandidaten.find((eintrag) => eintrag.id === id)?.name ?? '—';
  const kandidat = (id: string | null) => stand.kandidaten.find((eintrag) => eintrag.id === id) ?? null;

  const offeneDuelle = stufe?.paarungen.filter((eintrag) => eintrag.b !== null).length ?? 0;
  const entschiedene =
    stufe?.paarungen.filter((eintrag) => eintrag.b !== null && eintrag.sieger !== null).length ?? 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Vorzeile>
            Stufe {stufe?.nummer ?? 1} · Duell {Math.min(entschiedene + 1, offeneDuelle)} von {offeneDuelle}
          </Vorzeile>
          <h2 className="text-[clamp(1.6rem,6vw,2.6rem)] font-black leading-[1.05] tracking-tight text-white">
            {offen ? 'Wer bleibt?' : 'Entschieden'}
          </h2>
        </div>
        <div className="min-w-[10rem] flex-1 sm:max-w-xs">
          {offen ? <Frist rest={rest} dauerSek={stand.einstellungen.abstimmdauerSek} /> : null}
          <p className="mt-2 text-right text-xs text-white/35">
            {runde.abgegeben} von {stand.teilnehmer.length} haben gewählt
          </p>
        </div>
      </div>

      {paarung && paarung.b ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
          <Seite
            seite="links"
            kandidat={kandidat(paarung.a)}
            stimmen={runde.stimmen?.[paarung.a] ?? null}
            gewaehlt={runde.eigeneStimmen.includes(paarung.a)}
            offen={offen}
            beschaeftigt={beschaeftigt}
            aufStimme={() => aufStimme(paarung.a, paarung.nr)}
          />

          <div className="flex flex-col items-center gap-1 px-1">
            <span className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] sm:size-12">
              <Swords className="size-4 text-[hsl(var(--sp-rot-hell))] sm:size-5" aria-hidden="true" />
            </span>
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-white/30">vs</span>
          </div>

          <Seite
            seite="rechts"
            kandidat={kandidat(paarung.b)}
            stimmen={runde.stimmen?.[paarung.b] ?? null}
            gewaehlt={runde.eigeneStimmen.includes(paarung.b)}
            offen={offen}
            beschaeftigt={beschaeftigt}
            aufStimme={() => aufStimme(paarung.b!, paarung.nr)}
          />
        </div>
      ) : (
        <p className="text-sm text-white/45">Das Turnier läuft weiter …</p>
      )}

      <Baum baum={baum} name={name} aktuell={runde.duellIndex} />
    </div>
  );
}

function Seite({
  seite,
  kandidat,
  stimmen,
  gewaehlt,
  offen,
  beschaeftigt,
  aufStimme,
}: {
  seite: 'links' | 'rechts';
  kandidat: Stand['kandidaten'][number] | null;
  stimmen: number | null;
  gewaehlt: boolean;
  offen: boolean;
  beschaeftigt: boolean;
  aufStimme: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!offen || beschaeftigt || !kandidat}
      onClick={aufStimme}
      aria-pressed={gewaehlt}
      className={cn(
        seite === 'links' ? 'sp-duell-links' : 'sp-duell-rechts',
        'group relative overflow-hidden rounded-2xl text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
        offen ? 'hover:-translate-y-1 hover:brightness-110' : '',
        gewaehlt ? 'ring-2 ring-[hsl(var(--sp-rot-hell))]' : 'ring-1 ring-white/10',
      )}
    >
      <Cover
        name={kandidat?.name ?? '—'}
        bannerUrl={kandidat?.bannerUrl ?? null}
        className="aspect-[3/4] w-full sm:aspect-[4/3]"
      />
      {gewaehlt ? (
        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-[hsl(var(--sp-rot-hell))] text-white">
          <Check className="size-4" aria-hidden="true" />
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
        <span className="min-w-0 truncate text-sm font-bold text-white sm:text-base">
          {kandidat?.name ?? '—'}
        </span>
        {stimmen !== null ? (
          <span className="shrink-0 font-mono text-2xl font-black tabular-nums text-white">{stimmen}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Der Turnierbaum.
 *
 * Keine Tabelle: jede Stufe ist eine Spalte, jede Paarung ein Paar kurzer
 * Zeilen, der Sieger hervorgehoben. Bei sechzehn Titeln ist das immer noch
 * lesbar, und man sieht auf einen Blick, wo man steht.
 */
function Baum({
  baum,
  name,
  aktuell,
}: {
  baum: NonNullable<Stand['runde']>['baum'];
  name: (id: string | null) => string;
  aktuell: number;
}): React.JSX.Element | null {
  if (!baum || baum.stufen.length === 0) {
    return null;
  }

  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-max gap-3 px-1">
        {baum.stufen.map((stufe) => (
          <div key={stufe.nummer} className="min-w-[8.5rem] space-y-1.5">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-white/30">
              Stufe {stufe.nummer}
            </p>
            {stufe.paarungen.map((paarung) => (
              <div
                key={paarung.nr}
                className={cn(
                  'space-y-0.5 rounded-lg border p-1.5 text-[0.7rem] transition',
                  paarung.nr === aktuell
                    ? 'border-[hsl(var(--sp-rot-hell)/0.6)] bg-[hsl(var(--sp-rot)/0.16)]'
                    : 'border-white/[0.07] bg-white/[0.02]',
                )}
              >
                {paarung.b === null ? (
                  <p className="flex items-center gap-1.5 text-white/60">
                    <Ticket className="size-3 shrink-0 text-[hsl(var(--sp-rot-hell))]" aria-hidden="true" />
                    <span className="min-w-0 truncate">{name(paarung.a)}</span>
                    <span className="shrink-0 text-white/30">Freilos</span>
                  </p>
                ) : (
                  <>
                    <Zeile text={name(paarung.a)} sieger={paarung.sieger === paarung.a} />
                    <Zeile text={name(paarung.b)} sieger={paarung.sieger === paarung.b} />
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Zeile({ text, sieger }: { text: string; sieger: boolean }): React.JSX.Element {
  return (
    <p className={cn('truncate', sieger ? 'font-bold text-white' : 'text-white/40')}>
      {sieger ? '› ' : ''}
      {text}
    </p>
  );
}
