import Link from 'next/link';
import { tageSpaeter, tagesBeginnIn, teileIn } from '@swisshub/shared';
import { systemRoutes } from '@swisshub/shared';
import type { workspace } from '@swisshub/modules';
import { cn } from '@/lib/utils';

/**
 * Monats- und Wochenansicht der Planung.
 *
 * ## Warum serverseitig gerechnet
 *
 * Weil das Gitter feststeht, sobald der Zeitraum feststeht. Ein Kalender, der
 * erst im Browser entsteht, zeigt beim Laden ein leeres Raster - und braucht
 * JavaScript für etwas, das sich nicht bewegt.
 *
 * ## Warum die Tagesgrenzen über die Zone laufen
 *
 * Weil eine feste Stundenzahl an den beiden Umstellungstagen daneben liegt,
 * und zwar lautlos: ein Termin rutscht in den Nachbartag, und niemand weiss,
 * warum. Benutzt werden deshalb dieselben Helfer wie im Kalendermodul - keine
 * zweite Zeitrechnung.
 */

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Ordnet die Termine den Tagen zu, auf die sie fallen. */
function nachTagen(
  termine: readonly workspace.Termin[],
  tage: readonly Date[],
  zone: string,
): Map<number, workspace.Termin[]> {
  const karte = new Map<number, workspace.Termin[]>();
  for (const [index, tag] of tage.entries()) {
    const ende = tageSpaeter(tag, zone, 1);
    const treffer = termine.filter((termin) => termin.faelligAm >= tag && termin.faelligAm < ende);
    if (treffer.length > 0) {
      karte.set(index, treffer);
    }
  }
  return karte;
}

const ART_FARBE: Record<workspace.TerminArt, string> = {
  projektziel: 'border-l-primary',
  meilenstein: 'border-l-warning',
  aufgabe: 'border-l-border',
};

const ART_LABEL: Record<workspace.TerminArt, string> = {
  projektziel: 'Projektziel',
  meilenstein: 'Meilenstein',
  aufgabe: 'Aufgabe',
};

/** Ein Termin als Zeile - überall gleich, damit man ihn überall gleich liest. */
function TerminZeile({ termin }: { termin: workspace.Termin }): React.JSX.Element {
  const ziel =
    termin.art === 'aufgabe'
      ? systemRoutes.workspaceAufgabe(termin.id)
      : termin.projectId
        ? systemRoutes.workspaceProjekt(termin.projectId)
        : systemRoutes.workspaceProjekte();

  return (
    <Link
      href={ziel}
      title={`${ART_LABEL[termin.art]}: ${termin.titel}`}
      className={cn(
        'block truncate border-l-2 px-1.5 py-0.5 text-xs transition-colors hover:bg-secondary',
        ART_FARBE[termin.art],
        termin.erledigt && 'text-muted-foreground line-through',
      )}
    >
      {termin.titel}
    </Link>
  );
}

export interface GitterProps {
  termine: readonly workspace.Termin[];
  /** Der Monat bzw. die Woche, um die es geht. */
  anker: Date;
  zone: string;
  heute: Date;
}

export function Monatsgitter({ termine, anker, zone, heute }: GitterProps): React.JSX.Element {
  const ankerTeile = teileIn(anker, zone);
  /*
   * Sechs Wochen, beginnend am Montag vor dem Monatsersten.
   *
   * Feste Höhe über alle Monate: so springt die Ansicht beim Blättern nicht,
   * und ein Monat, der auf einen Sonntag beginnt, bekommt dieselbe Tabelle wie
   * einer, der auf einen Montag beginnt.
   */
  const monatsErster = tagesBeginnIn(new Date(Date.UTC(ankerTeile.jahr, ankerTeile.monat - 1, 1, 12)), zone);
  const ersterTeile = teileIn(monatsErster, zone);
  const versatz = (ersterTeile.wochentag + 6) % 7;
  const start = tageSpaeter(monatsErster, zone, -versatz);
  const tage = Array.from({ length: 42 }, (_, i) => tageSpaeter(start, zone, i));
  const karte = nachTagen(termine, tage, zone);
  const heuteSchluessel = tagesBeginnIn(heute, zone).getTime();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WOCHENTAGE.map((tag) => (
          <div key={tag} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
            {tag}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {tage.map((tag, index) => {
          const teile = teileIn(tag, zone);
          const imMonat = teile.monat === ankerTeile.monat;
          const istHeute = tag.getTime() === heuteSchluessel;
          const eintraege = karte.get(index) ?? [];
          return (
            <div
              key={tag.toISOString()}
              className={cn(
                'min-h-24 min-w-0 border-b border-r border-border p-1',
                index % 7 === 6 && 'border-r-0',
                !imMonat && 'bg-muted/20',
              )}
            >
              <div className="px-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    imMonat ? 'text-foreground' : 'text-muted-foreground/60',
                    istHeute &&
                      'flex size-5 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground',
                  )}
                >
                  {teile.tag}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {eintraege.slice(0, 3).map((termin) => (
                  <TerminZeile key={`${termin.art}:${termin.id}`} termin={termin} />
                ))}
                {eintraege.length > 3 ? (
                  <p className="px-1.5 text-xs text-muted-foreground">+{eintraege.length - 3} weitere</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Wochengitter({ termine, anker, zone, heute }: GitterProps): React.JSX.Element {
  const tage = Array.from({ length: 7 }, (_, i) => tageSpaeter(anker, zone, i));
  const karte = nachTagen(termine, tage, zone);
  const heuteSchluessel = tagesBeginnIn(heute, zone).getTime();

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Eine Spalte auf dem Telefon, sieben am Bildschirm: sieben Spalten auf
          320 Pixeln sind 45 Pixel je Tag, und darin steht kein Titel. */}
      <div className="grid grid-cols-1 sm:grid-cols-7">
        {tage.map((tag, index) => {
          const teile = teileIn(tag, zone);
          const istHeute = tag.getTime() === heuteSchluessel;
          const eintraege = karte.get(index) ?? [];
          return (
            <div
              key={tag.toISOString()}
              className={cn(
                'min-h-32 min-w-0 border-b border-border p-2 sm:border-r sm:last:border-r-0',
                istHeute && 'bg-primary/5',
              )}
            >
              <div className="mb-2 flex items-baseline gap-1.5">
                <span className="text-xs text-muted-foreground">{WOCHENTAGE[(teile.wochentag + 6) % 7]}</span>
                <span className={cn('text-sm tabular-nums', istHeute && 'font-semibold text-primary')}>
                  {teile.tag}.{teile.monat}.
                </span>
              </div>
              <div className="space-y-1">
                {eintraege.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground/60">–</p>
                ) : (
                  eintraege.map((termin) => (
                    <TerminZeile key={`${termin.art}:${termin.id}`} termin={termin} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Die Legende - drei Arten, drei Farben. */
export function Legende(): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {(['projektziel', 'meilenstein', 'aufgabe'] as const).map((art) => (
        <span key={art} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-0.5 border-l-2', ART_FARBE[art])} />
          {ART_LABEL[art]}
        </span>
      ))}
    </div>
  );
}
