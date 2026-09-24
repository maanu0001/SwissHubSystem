'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, Dices, Settings2, Swords, Vote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { spielwahlModusSetzenAction } from '@/modules/spielwahl/aktionen';
import { cn } from '@/lib/utils';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Die Regeln der Runde.
 *
 * ## Warum das aufgeklappt werden muss
 *
 * Weil eine spontane Gruppe nichts davon braucht. Die Vorgaben sind so
 * gewählt, dass drei bis sechs Leute ohne eine einzige Einstellung
 * auskommen: Roulette, ein Los je Spiel, drei Vorschläge pro Person. Wer
 * mehr will, findet es hier - und zwar nur das, was tatsächlich sauber
 * umgesetzt ist.
 *
 * ## Was nicht dasteht
 *
 * Ein Veto je Person. Es ist in der Produktidee als spätere Möglichkeit
 * genannt, und genau dort bleibt es: ein halb gebauter Knopf, der eine
 * Auslosung rückgängig macht, wäre schlimmer als keiner.
 */
const MODI = [
  { key: 'ROULETTE' as const, label: 'Roulette', Symbol: Dices, text: 'Ein Rad, ein Los je Spiel.' },
  { key: 'VOTING' as const, label: 'Abstimmung', Symbol: Vote, text: 'Alle wählen gleichzeitig.' },
  {
    key: 'ELIMINATION' as const,
    label: 'Ausscheidung',
    Symbol: Swords,
    text: 'Duell für Duell, bis eines bleibt.',
  },
];

export function Regeln({
  stand,
  csrfToken,
  darfFuehren,
}: {
  stand: Stand;
  csrfToken: string;
  darfFuehren: boolean;
}): React.JSX.Element {
  const [offen, setOffen] = useState(false);
  const [laeuft, starte] = useTransition();

  const setzen = (aenderung: Record<string, unknown>): void => {
    starte(async () => {
      const antwort = await spielwahlModusSetzenAction({ sessionId: stand.id, csrfToken, ...aenderung });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
      }
    });
  };

  const aktiv = stand.einstellungen;

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {MODI.map((eintrag) => {
            const gewaehlt = stand.modus === eintrag.key;
            return (
              <button
                key={eintrag.key}
                type="button"
                disabled={!darfFuehren || laeuft}
                onClick={() => setzen({ modus: eintrag.key })}
                aria-pressed={gewaehlt}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))]',
                  gewaehlt
                    ? 'border-[hsl(var(--sp-rot-hell)/0.6)] bg-[hsl(var(--sp-rot)/0.22)] text-white'
                    : 'border-white/10 text-white/45 hover:border-white/20 hover:text-white/75',
                  !darfFuehren ? 'cursor-default' : '',
                )}
              >
                <eintrag.Symbol className="size-4" aria-hidden="true" />
                {eintrag.label}
              </button>
            );
          })}
        </div>

        {darfFuehren ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-white/40 hover:text-white/80"
            onClick={() => setOffen((bisher) => !bisher)}
            aria-expanded={offen}
          >
            <Settings2 className="size-4" aria-hidden="true" />
            Mehr
            <ChevronDown
              className={cn('size-4 transition-transform', offen ? 'rotate-180' : '')}
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </div>

      <p className="px-4 pb-3 text-xs text-white/35">
        {MODI.find((eintrag) => eintrag.key === stand.modus)?.text}
        {stand.modus === 'ROULETTE' && aktiv.rouletteGewichtet
          ? ' Gewichtet: wer mehr Unterstützer hat, hat mehr Lose.'
          : ''}
      </p>

      {offen && darfFuehren ? (
        <div className="space-y-1 border-t border-white/[0.07] p-4">
          <Schalter
            label="Stimmen geheim halten"
            text="Die Zahlen erscheinen erst zum Schluss. Sichtbare Zwischenstände ziehen die Stimmen zum Führenden."
            an={aktiv.geheimeStimmen}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ geheimeStimmen: wert })}
          />
          <Schalter
            label="Roulette nach Unterstützern gewichten"
            text="Standardmässig hat jedes Spiel ein Los, egal wie viele es genannt haben."
            an={aktiv.rouletteGewichtet}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ rouletteGewichtet: wert })}
          />
          <Schalter
            label="Beitritt während einer laufenden Runde"
            text="Aus heisst: wer zu spät kommt, schaut zu und ist bei der nächsten dabei."
            an={aktiv.beitrittWaehrendRunde}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ beitrittWaehrendRunde: wert })}
          />
          <Schalter
            label="Einmal neu auslosen erlauben"
            text="Das Zugeständnis an die enttäuschte Gruppe - genau einmal je Auswahl."
            an={aktiv.nachlosenErlaubt}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ nachlosenErlaubt: wert })}
          />
          <Schalter
            label="Titel ausserhalb des Katalogs"
            text="Erscheinen ohne Cover - ein Bild aus einer Eingabe wird nirgends geladen."
            an={aktiv.freieVorschlaege}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ freieVorschlaege: wert })}
          />

          <Zahl
            label="Vorschläge pro Person"
            wert={aktiv.vorschlaegeProPerson}
            werte={[1, 2, 3, 5, 10]}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ vorschlaegeProPerson: wert })}
          />
          <Zahl
            label="Abstimmungsdauer"
            wert={aktiv.abstimmdauerSek}
            werte={[20, 30, 45, 60, 90]}
            einheit="s"
            aus={laeuft}
            aufAenderung={(wert) => setzen({ abstimmdauerSek: wert })}
          />
          <Zahl
            label="Stimmen pro Person"
            wert={aktiv.stimmenProPerson}
            werte={[1, 2, 3]}
            aus={laeuft}
            aufAenderung={(wert) => setzen({ stimmenProPerson: wert })}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80">Bei Gleichstand</p>
              <p className="text-xs text-white/35">
                Stichwahl heisst: noch einmal, nur unter den Gleichauf-Kandidaten.
              </p>
            </div>
            <div className="flex gap-1.5">
              {(['STICHWAHL', 'ZUFALL'] as const).map((wert) => (
                <button
                  key={wert}
                  type="button"
                  disabled={laeuft}
                  onClick={() => setzen({ gleichstand: wert })}
                  aria-pressed={aktiv.gleichstand === wert}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                    aktiv.gleichstand === wert
                      ? 'bg-[hsl(var(--sp-rot))] text-white'
                      : 'bg-white/[0.06] text-white/45 hover:text-white/75',
                  )}
                >
                  {wert === 'STICHWAHL' ? 'Stichwahl' : 'Los'}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Schalter({
  label,
  text,
  an,
  aus,
  aufAenderung,
}: {
  label: string;
  text: string;
  an: boolean;
  aus: boolean;
  aufAenderung: (wert: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white/80">{label}</span>
        <span className="block text-xs text-white/35">{text}</span>
      </span>
      <Switch checked={an} disabled={aus} onCheckedChange={aufAenderung} />
    </label>
  );
}

function Zahl({
  label,
  wert,
  werte,
  einheit = '',
  aus,
  aufAenderung,
}: {
  label: string;
  wert: number;
  werte: number[];
  einheit?: string;
  aus: boolean;
  aufAenderung: (wert: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <p className="text-sm font-medium text-white/80">{label}</p>
      <div className="flex gap-1.5">
        {werte.map((eintrag) => (
          <button
            key={eintrag}
            type="button"
            disabled={aus}
            onClick={() => aufAenderung(eintrag)}
            aria-pressed={wert === eintrag}
            className={cn(
              'min-w-[2.6rem] rounded-lg px-2 py-1.5 font-mono text-xs font-semibold tabular-nums transition',
              wert === eintrag
                ? 'bg-[hsl(var(--sp-rot))] text-white'
                : 'bg-white/[0.06] text-white/45 hover:text-white/75',
            )}
          >
            {eintrag}
            {einheit}
          </button>
        ))}
      </div>
    </div>
  );
}
