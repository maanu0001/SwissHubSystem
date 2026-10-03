'use client';

import { Dice5, Hand, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Die Risikoleiter der Bonusrunde.
 *
 * ## Was hier passiert - und was nicht
 *
 * Hier wird **gewaehlt**, nicht gewuerfelt. Der Wurf fallt auf dem Server,
 * bevor diese Komponente etwas anzeigt; sie inszeniert ein Ergebnis, das in
 * dem Moment schon feststeht, in dem die Antwort ankommt.
 *
 * ## Warum die Chance dasteht
 *
 * Weil sie zur Entscheidung gehoert. Ein Risiko, dessen Chance man nicht
 * kennt, ist keine Entscheidung, sondern ein Knopf. Und weil der Verlust
 * **alles** kostet, steht das auch dort - nicht im Kleingedruckten.
 */

export interface LeiterStufe {
  freispiele: number;
  chance: number;
}

export interface LeiterProps {
  /** Was Nehmen jetzt bringt. */
  nehmen: number;
  /** Die Stufe, auf die riskiert wird - `null`, wenn es keine mehr gibt. */
  riskierenAuf: number | null;
  chance: number;
  stufen: readonly LeiterStufe[];
  /** Die Stufe, auf der die Runde steht (0-basiert). */
  aktuell: number;
  verloren: boolean;
  beschaeftigt: boolean;
  onNehmen: () => void;
  onRiskieren: () => void;
}

export function Leiter({
  nehmen,
  riskierenAuf,
  chance,
  stufen,
  aktuell,
  verloren,
  beschaeftigt,
  onNehmen,
  onRiskieren,
}: LeiterProps): React.JSX.Element {
  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-card/80 p-4">
      <div className="flex items-start gap-3">
        <span className="icon-chip size-10 shrink-0">
          <Dice5 aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">Bonusrunde gewonnen</p>
          <p className="text-xs text-muted-foreground">
            {verloren
              ? 'Das Risiko ist nicht aufgegangen. Die Bonusrunde ist vorbei.'
              : `${nehmen} Freispiele sind dir sicher. Oder du riskierst sie.`}
          </p>
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {[{ freispiele: nehmen, chance: 1 }, ...stufen].map((stufe, index) => (
          <li
            key={index}
            className={cn(
              'slot-leiter-stufe rounded-lg border border-border bg-background/60 p-3 text-center',
              index === aktuell && !verloren && 'slot-leiter-stufe--aktiv',
              index === aktuell && verloren && 'slot-leiter-stufe--verloren',
            )}
          >
            <p className="text-lg font-bold tabular-nums">{stufe.freispiele}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Freispiele</p>
            {index > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {Math.round(stufe.chance * 100)} % Chance
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">sicher</p>
            )}
          </li>
        ))}
      </ol>

      {verloren ? null : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button disabled={beschaeftigt} onClick={onNehmen} className="flex-1">
              <Hand aria-hidden="true" />
              {nehmen} Freispiele nehmen
            </Button>
            {riskierenAuf !== null && riskierenAuf > 0 ? (
              <Button
                disabled={beschaeftigt}
                variant="outline"
                onClick={onRiskieren}
                className="flex-1 border-primary/50"
              >
                <Dice5 aria-hidden="true" />
                Auf {riskierenAuf} riskieren ({Math.round(chance * 100)} %)
              </Button>
            ) : null}
          </div>
          {riskierenAuf !== null && riskierenAuf > 0 ? (
            <p className="flex items-start gap-2 text-xs text-warning">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Geht das Risiko nicht auf, ist die ganze Bonusrunde weg - auch die sicheren {nehmen} Freispiele.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
