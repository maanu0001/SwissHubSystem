import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';

/**
 * Auszeichnungen.
 *
 * ## Warum offene nur im eigenen Profil stehen
 *
 * Im eigenen Profil ist eine offene Auszeichnung ein Ziel - «noch zwei
 * Turniere». Im fremden waere sie eine Liste dessen, was jemand nicht
 * geschafft hat. Der Dienst liefert deshalb gar nicht erst beides: fremde
 * Profile bekommen nur die erreichten.
 *
 * Gold bekommt einen Schein, Silber und Bronze nicht. Drei verschiedene
 * Leuchteffekte nebeneinander waere Kirmes; einer, der etwas bedeutet, ist
 * eine Hierarchie.
 */
const STUFE_KLASSE: Record<string, string> = {
  gold: 'border-[hsl(45_92%_58%/0.45)] bg-[hsl(45_92%_58%/0.08)] text-[hsl(45_92%_62%)]',
  silber: 'border-[hsl(210_16%_70%/0.35)] bg-[hsl(210_16%_70%/0.06)] text-[hsl(210_16%_78%)]',
  bronze: 'border-[hsl(25_50%_55%/0.35)] bg-[hsl(25_50%_55%/0.06)] text-[hsl(25_55%_65%)]',
};

export function ProfilAuszeichnungen({
  auszeichnungen,
}: {
  auszeichnungen: profile.Auszeichnung[];
}): React.JSX.Element | null {
  if (auszeichnungen.length === 0) {
    return null;
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {auszeichnungen.map((eintrag) => (
        <li
          key={eintrag.key}
          className={`flex items-start gap-3 rounded-xl border p-3 ${
            eintrag.erreicht
              ? (STUFE_KLASSE[eintrag.stufe] ?? STUFE_KLASSE.bronze)
              : 'border-dashed border-border bg-transparent text-muted-foreground'
          }`}
        >
          <span
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
              eintrag.erreicht ? 'bg-foreground/5' : 'bg-transparent'
            }`}
          >
            <NavIcon name={eintrag.symbol} className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold leading-tight text-foreground">{eintrag.label}</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{eintrag.beschreibung}</p>
            {/* Der Fortschritt steht nur bei offenen: bei erreichten waere
                «5 von 5» eine Wiederholung des Hakens. */}
            {!eintrag.erreicht && eintrag.fortschritt ? (
              <div className="mt-2">
                <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--profil-akzent))]"
                    style={{
                      width: `${Math.round((eintrag.fortschritt.erreicht / eintrag.fortschritt.noetig) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[0.65rem] tabular-nums text-muted-foreground">
                  {eintrag.fortschritt.erreicht} von {eintrag.fortschritt.noetig}
                </p>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
