import Link from 'next/link';
import { Clapperboard, Heart, Medal, Trophy } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import type { clips } from '@swisshub/modules';

/**
 * Clip of the Week im Mitgliedsprofil.
 *
 * ## Warum kein eigenes Erfolgssystem
 *
 * Es waere schnell gebaut - eine Tabelle «Achievement», ein Dienst, ein
 * Abgleich - und es haette ab dann zwei Wahrheiten darueber, wer gewonnen
 * hat: die Runden selbst und eine Kopie davon. Gezaehlt wird deshalb, was
 * ohnehin dasteht: `finalRank` der abgeschlossenen Runden.
 *
 * ## Warum der Block verschwindet, wenn nichts dasteht
 *
 * Vier Nullen im Profil sagen «hier ist etwas, woran du gescheitert bist».
 * Wer noch nie eingereicht hat, soll stattdessen nichts sehen.
 */
export function ClipBilanzBlock({ bilanz }: { bilanz: clips.ClipBilanz }): React.JSX.Element | null {
  if (bilanz.eingereicht === 0 && bilanz.siege === 0) {
    return null;
  }

  const werte = [
    { label: bilanz.siege === 1 ? 'Sieg' : 'Siege', wert: bilanz.siege, Symbol: Trophy },
    { label: 'Top 3', wert: bilanz.treppchen, Symbol: Medal },
    { label: 'Eingereicht', wert: bilanz.eingereicht, Symbol: Clapperboard },
    { label: 'Stimmen erhalten', wert: bilanz.erhalteneStimmen, Symbol: Heart },
  ];

  return (
    <section className="mt-4 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="text-sm font-medium">Clip of the Week</h3>
        {bilanz.letzterSieg ? (
          <Link
            href={systemRoutes.clipRunde(bilanz.letzterSieg.key)}
            className="truncate text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Letzter Sieg: {bilanz.letzterSieg.titel}
          </Link>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {werte.map((eintrag) => (
          <div key={eintrag.label} className="flex items-center gap-2.5">
            <eintrag.Symbol
              className={`size-4 shrink-0 ${eintrag.label.startsWith('Sieg') && eintrag.wert > 0 ? 'text-[hsl(45_92%_58%)]' : 'text-muted-foreground'}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <dd className="text-lg font-semibold leading-none tabular-nums">{eintrag.wert}</dd>
              <dt className="truncate text-xs text-muted-foreground">{eintrag.label}</dt>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
