'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Dices, Loader2, Swords, Vote, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { spielwahlEroeffnenAction } from '@/modules/spielwahl/aktionen';
import { cn } from '@/lib/utils';

/**
 * Der Schnellstart.
 *
 * ## Warum ein Knopf und kein Assistent
 *
 * Weil die Situation eine spontane ist: sechs Leute sitzen im Voice, jemand
 * fragt «was zocken wir», und wenn die Antwort darauf ein Formular mit
 * sieben Feldern ist, fragt beim nächsten Mal niemand mehr.
 *
 * Ein Klick, eine Runde. Die Vorgaben sind so gewählt, dass drei bis sechs
 * Leute damit durchkommen: Roulette, ein Los je Spiel, drei Vorschläge pro
 * Person. Alles andere lässt sich **in** der Runde noch ändern - die Regeln
 * stehen dort, wo man sie braucht, und nicht davor.
 */
const MODI = [
  { key: 'ROULETTE' as const, label: 'Roulette', Symbol: Dices, text: 'Das Rad entscheidet.' },
  { key: 'VOTING' as const, label: 'Abstimmung', Symbol: Vote, text: 'Alle wählen gleichzeitig.' },
  { key: 'ELIMINATION' as const, label: 'Ausscheidung', Symbol: Swords, text: 'Duell für Duell.' },
];

export function Schnellstart({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [offen, setOffen] = useState(false);
  const [modus, setModus] = useState<'ROULETTE' | 'VOTING' | 'ELIMINATION'>('ROULETTE');

  const eroeffnen = (): void => {
    starte(async () => {
      const antwort = await spielwahlEroeffnenAction({ modus, csrfToken });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      router.push(`/was-spielen-wir/${antwort.data.inviteToken}`);
    });
  };

  return (
    <div className="spielwahl">
      <div className="sp-buehne p-6 sm:p-10">
        <div className="flex flex-col items-start gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/35">
              Gemeinsam entscheiden
            </p>
            <h1 className="mt-2 text-[clamp(2rem,7vw,3.4rem)] font-black leading-[0.98] tracking-tight text-white">
              Was spielen wir?
            </h1>
            <p className="mt-3 max-w-lg text-sm text-white/45">
              Eine Runde eröffnen, den Link teilen, alle schlagen vor - und dann entscheidet das Rad, die
              Abstimmung oder das Duell. Gleichzeitig für alle.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="lg"
              disabled={laeuft}
              onClick={eroeffnen}
              className="h-12 px-6 text-base"
            >
              {laeuft ? (
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              ) : (
                <Zap className="size-5" aria-hidden="true" />
              )}
              Einfach starten
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-white/40 hover:text-white/80"
              onClick={() => setOffen((bisher) => !bisher)}
              aria-expanded={offen}
            >
              Modus wählen
              <ChevronDown
                className={cn('size-4 transition-transform', offen ? 'rotate-180' : '')}
                aria-hidden="true"
              />
            </Button>
          </div>

          {offen ? (
            <div className="grid w-full gap-2 sm:grid-cols-3">
              {MODI.map((eintrag) => (
                <button
                  key={eintrag.key}
                  type="button"
                  onClick={() => setModus(eintrag.key)}
                  aria-pressed={modus === eintrag.key}
                  className={cn(
                    'rounded-xl border p-4 text-left transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sp-rot-hell))]',
                    modus === eintrag.key
                      ? 'border-[hsl(var(--sp-rot-hell)/0.6)] bg-[hsl(var(--sp-rot)/0.2)]'
                      : 'border-white/10 hover:border-white/20',
                  )}
                >
                  <eintrag.Symbol
                    className={cn(
                      'size-5',
                      modus === eintrag.key ? 'text-[hsl(var(--sp-rot-hell))]' : 'text-white/40',
                    )}
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-sm font-bold text-white">{eintrag.label}</p>
                  <p className="text-xs text-white/40">{eintrag.text}</p>
                </button>
              ))}
              <p className="text-xs text-white/30 sm:col-span-3">
                Der Modus lässt sich in der Runde jederzeit noch wechseln, solange nicht entschieden wird.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
