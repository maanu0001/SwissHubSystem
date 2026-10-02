'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Dices, Loader2, Swords, Vote, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EROEFFNEN } from '@/modules/spielwahl/befehle';
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
 *
 * ## Mit Konto und ohne
 *
 * Dasselbe Feld, derselbe Knopf, dasselbe Ziel. Der einzige Unterschied ist
 * ein Namensfeld: wer kein Konto hat, hat kein Profil, aus dem sein Name in
 * der Teilnehmerliste kommen könnte.
 *
 * Hier stand früher nichts für Gäste - die Seite zeigte ihnen stattdessen
 * eine Einladung, sich anzumelden. Das war der halbe Weg: zusehen ging ohne
 * Konto, anfangen nicht, und angefangen wird am Freitagabend von dem, der
 * gerade fragt.
 */
const MODI = [
  { key: 'ROULETTE' as const, label: 'Roulette', Symbol: Dices, text: 'Das Rad entscheidet.' },
  { key: 'VOTING' as const, label: 'Abstimmung', Symbol: Vote, text: 'Alle wählen gleichzeitig.' },
  { key: 'ELIMINATION' as const, label: 'Ausscheidung', Symbol: Swords, text: 'Duell für Duell.' },
];

export function Schnellstart({
  csrfToken,
  gast = false,
}: {
  csrfToken: string;
  /**
   * Betrachtet das jemand ohne Konto?
   *
   * Entscheidet zwei Dinge: ob ein Namensfeld erscheint, und welcher der
   * beiden Eröffnungsbefehle läuft. Beide Wege enden in derselben
   * `eroeffne`-Funktion mit denselben Vorgaben und Grenzen; der Server prüft
   * zusätzlich die Servereinstellung und die Obergrenze offener Gastrunden.
   */
  gast?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [offen, setOffen] = useState(false);
  const [modus, setModus] = useState<'ROULETTE' | 'VOTING' | 'ELIMINATION'>('ROULETTE');
  const [name, setName] = useState('');

  const bereit = !gast || name.trim().length >= 2;

  const eroeffnen = (): void => {
    if (!bereit) {
      return;
    }
    starte(async () => {
      const antwort = gast
        ? await EROEFFNEN.gast({ modus, csrfToken, name: name.trim() })
        : await EROEFFNEN.mitglied({ modus, csrfToken });
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
              {gast ? ' Ein Konto braucht dafür niemand.' : ''}
            </p>
          </div>

          <form
            className="flex w-full flex-wrap items-center gap-3"
            onSubmit={(ereignis) => {
              ereignis.preventDefault();
              eroeffnen();
            }}
          >
            {gast ? (
              <label className="min-w-0 flex-1 sm:max-w-xs">
                <span className="sr-only">Dein Name</span>
                <input
                  value={name}
                  onChange={(ereignis) => setName(ereignis.target.value)}
                  placeholder="Dein Name"
                  maxLength={24}
                  autoComplete="nickname"
                  className="h-12 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-base text-white outline-none placeholder:text-white/30 focus-visible:border-[hsl(var(--sp-rot-hell))]"
                />
              </label>
            ) : null}
            <Button type="submit" size="lg" disabled={laeuft || !bereit} className="h-12 px-6 text-base">
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
          </form>

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
