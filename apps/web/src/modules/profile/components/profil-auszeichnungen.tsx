import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import '../auszeichnungs-stufen.css';

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
 * ## Die drei Stufen sind drei Materialien
 *
 * Hier stand vorher je Stufe ein Satz Tailwind-Klassen: derselbe Rahmen,
 * dieselbe Form, dieselbe Flaeche, nur in Braun, Grau und Gelb. An einer
 * einzelnen Karte war die Stufe damit nicht zu erkennen, und an dreien
 * nebeneinander war es eine Farbskala.
 *
 * Die Gestaltung liegt jetzt in `auszeichnungs-stufen.css` - je Stufe eine
 * eigene Rahmengeometrie, Materialstruktur, Lichtfuehrung und
 * Symbolumgebung. Hier steht nur noch, welche Klasse welche Stufe bekommt.
 */
const STUFE_KLASSE: Record<string, string> = {
  gold: 'az-karte az-gold',
  silber: 'az-karte az-silber',
  bronze: 'az-karte az-bronze',
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
    /*
     * Das Raster richtet sich nach der Spalte, nicht nach dem Fenster.
     *
     * Vorher stand hier `sm:grid-cols-2 xl:grid-cols-3`. Breakpoints messen
     * aber das Fenster, und diese Liste steht in einer Seitenspalte von rund
     * 460 Pixeln: bei 1440 griff `xl`, drei Spalten teilten sich die 460 -
     * und «Fünf Jahre dabei» brach mitten im Wort um. Auf der oeffentlichen
     * Profilseite, die schmaler ist als das Dashboard, fiel es zuerst auf.
     *
     * `auto-fill` mit einer Mindestbreite braucht keine Breakpoints: es
     * entstehen so viele Spalten, wie mit 13rem hineinpassen - in der
     * Seitenspalte eine, im breiten Raster drei.
     */
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
      {auszeichnungen.map((eintrag) => (
        <li
          key={eintrag.key}
          className={`flex items-start gap-3 p-3 ${
            eintrag.erreicht
              ? (STUFE_KLASSE[eintrag.stufe] ?? STUFE_KLASSE.bronze)
              : 'rounded-xl border border-dashed border-border bg-transparent text-muted-foreground'
          }`}
        >
          <span
            className={`az-feld mt-0.5 size-9 shrink-0 ${
              eintrag.erreicht ? '' : 'rounded-lg bg-transparent'
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
