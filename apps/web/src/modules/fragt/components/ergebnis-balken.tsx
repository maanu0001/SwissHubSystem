import type { fragt } from '@swisshub/modules';
import { cn } from '@/lib/utils';

/**
 * Ein Ergebnis als Balkenliste.
 *
 * ## Warum keine Diagrammbibliothek
 *
 * Weil es nichts zu plotten gibt. Vier Zeilen mit je einem Anteil sind vier
 * Rechtecke mit einer Breite in Prozent - eine Achse, eine Legende und ein
 * Tooltip waeren drei Dinge mehr, die jemand lesen muesste, um zu erfahren,
 * was ohnehin daneben steht.
 *
 * ## Warum die Antworten nicht sortiert werden
 *
 * Sie stehen in der Reihenfolge, in der sie im Discord-Embed standen. Wer das
 * Ergebnis neben die Frage haelt, soll nicht suchen muessen.
 *
 * ## Bei Gleichstand fuehren mehrere
 *
 * `fuehrt` ist kein Gewinner-Kennzeichen, sondern «hat die hoechste
 * Stimmenzahl». Bei zwei gleichstarken Antworten sind beide hervorgehoben -
 * und die Fusszeile sagt, dass es keinen Sieger gibt.
 */
export function ErgebnisBalken({
  ergebnis,
  /** Die absoluten Stimmen mitanzeigen - im Dashboard hilfreich, auf einer Kachel zu viel. */
  mitZahlen = true,
}: {
  ergebnis: fragt.Ergebnis;
  mitZahlen?: boolean;
}): React.JSX.Element {
  if (ergebnis.gesamt === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        Noch keine Stimmen. Die Antwortmöglichkeiten stehen bereit:{' '}
        {ergebnis.zeilen.map((zeile) => zeile.label).join(' · ')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ergebnis.zeilen.map((zeile) => (
        <div key={zeile.optionId} className="space-y-1.5">
          <div className="flex items-end justify-between gap-3">
            <span
              className={cn(
                'min-w-0 break-words text-sm leading-tight',
                zeile.fuehrt ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {zeile.label}
            </span>
            <span
              className={cn(
                'shrink-0 text-sm tabular-nums',
                zeile.fuehrt ? 'font-semibold text-primary' : 'text-muted-foreground',
              )}
            >
              {zeile.prozent} %
              {mitZahlen ? <span className="ml-1.5 text-xs opacity-70">({zeile.stimmen})</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={cn('h-full rounded-full', zeile.fuehrt ? 'bg-primary' : 'bg-muted-foreground/40')}
              style={{ width: `${zeile.prozent}%` }}
            />
          </div>
        </div>
      ))}

      <p className="pt-1 text-xs text-muted-foreground">
        {ergebnis.gesamt} {ergebnis.gesamt === 1 ? 'Stimme' : 'Stimmen'}
        {ergebnis.gleichstand.length > 0
          ? ` · Gleichstand: ${ergebnis.gleichstand.map((zeile) => zeile.label).join(' und ')}`
          : ergebnis.gewinner
            ? ` · vorne: ${ergebnis.gewinner.label}`
            : ''}
      </p>
    </div>
  );
}
