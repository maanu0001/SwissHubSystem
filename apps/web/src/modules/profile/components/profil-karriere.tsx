import Link from 'next/link';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';

/**
 * Die SwissHub-Karriere.
 *
 * ## Warum eine Leiste und keine Tabelle
 *
 * Eine Tabelle mit Zeitstempel, Ereignistyp und Verweis waere ein
 * Protokollauszug - richtig und uninteressant. Hier geht es darum, dass
 * jemand einen Weg hinter sich hat: eine Linie, Punkte darauf, Siege heller
 * als der Rest.
 *
 * ## Warum sie auch mit zwei Eintraegen gut aussieht
 *
 * Weil sie nichts auffuellt. Kein «und dann passierte lange nichts», keine
 * grauen Platzhalterpunkte fuer kommende Ereignisse. Zwei Punkte auf einer
 * Linie sind zwei Punkte auf einer Linie.
 */
export function ProfilKarriere({
  meilensteine,
}: {
  meilensteine: profile.Meilenstein[];
}): React.JSX.Element | null {
  if (meilensteine.length === 0) {
    return null;
  }

  return (
    <ol className="relative space-y-4 pl-7">
      {/* Die Linie liegt hinter den Punkten und endet am letzten Punkt statt
          am Rand des Kastens - sonst zeigt sie ins Nichts. */}
      <span
        className="absolute bottom-2 left-[0.6875rem] top-2 w-px bg-gradient-to-b from-[hsl(var(--profil-akzent)/0.5)] via-border to-transparent"
        aria-hidden="true"
      />
      {meilensteine.map((eintrag) => (
        <li key={eintrag.key} className="relative">
          <span
            className={`absolute -left-7 top-0.5 flex size-6 items-center justify-center rounded-full border ${
              eintrag.hervorgehoben
                ? 'border-[hsl(var(--profil-akzent)/0.6)] bg-[hsl(var(--profil-akzent)/0.16)] text-[hsl(var(--profil-akzent))]'
                : 'border-border bg-card text-muted-foreground'
            }`}
          >
            <NavIcon name={eintrag.symbol} className="size-3.5" />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {eintrag.link ? (
                <Link
                  href={eintrag.link}
                  className="break-words text-sm font-semibold underline-offset-4 hover:underline"
                >
                  {eintrag.titel}
                </Link>
              ) : (
                <span className="break-words text-sm font-semibold">{eintrag.titel}</span>
              )}
              {eintrag.am ? (
                <time
                  dateTime={eintrag.am.toISOString()}
                  className="text-xs tabular-nums text-muted-foreground"
                >
                  {eintrag.am.toLocaleDateString('de-CH', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </time>
              ) : null}
            </div>
            {eintrag.beschreibung ? (
              <p className="break-words text-xs text-muted-foreground">{eintrag.beschreibung}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
