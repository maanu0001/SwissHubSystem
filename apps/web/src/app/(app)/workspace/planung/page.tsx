import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import {
  monatsBeginnIn,
  naechsterMonatsBeginnIn,
  systemRoutes,
  tageSpaeter,
  teileIn,
  wochenBeginnIn,
} from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import { requirePagePermission } from '@/server/auth';
import { workspaceNavigation } from '@/modules/workspace/navigation';
import { WORKSPACE_ZUGANG, workspaceBetrachter, workspaceEinstellungen } from '@/modules/workspace/daten';
import { Legende, Monatsgitter, Wochengitter } from '@/modules/workspace/components/planungsgitter';
import { fristText } from '@/modules/workspace/labels';

export const metadata: Metadata = { title: 'Planung · Workspace' };
export const dynamic = 'force-dynamic';

const ZONE = 'Europe/Zurich';

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

/**
 * Die Planung.
 *
 * ## Warum Monat **und** Woche
 *
 * Weil sie zwei Fragen beantworten. Der Monat: «ist der Juni zu voll» - da
 * genügt, dass etwas an einem Tag steht. Die Woche: «was ist diese Woche
 * dran» - da braucht man die Titel lesbar. Eine Ansicht, die beides versucht,
 * kann keines von beidem.
 *
 * ## Warum Aufgaben, Meilensteine und Projektziele zusammen
 *
 * Weil die Frage «was ist im Juni» nicht nach Aufgaben fragt, sondern nach
 * Terminen. Drei getrennte Listen müsste der Betrachter selbst zusammenlegen -
 * und würde dabei genau den übersehen, der nicht in der Liste stand, auf die
 * er gerade schaute.
 *
 * ## Warum der Zeitraum in der Adresse steht
 *
 * Damit «der Juni» ein Link ist. Der Zustand im Browser wäre nach dem
 * Neuladen weg, und ein Kalender, bei dem der Zurück-Knopf nicht
 * zurückblättert, fühlt sich kaputt an.
 */
type Suche = { ansicht?: string; monat?: string; woche?: string; alle?: string };

/** `YYYY-MM` zu einem Datum im Monat - oder der laufende Monat. */
function monatAus(wert: string | undefined, heute: Date): Date {
  const treffer = /^(\d{4})-(\d{2})$/u.exec(wert ?? '');
  if (!treffer) {
    return monatsBeginnIn(heute, ZONE);
  }
  const jahr = Number(treffer[1]);
  const monat = Number(treffer[2]);
  // Ein Monat ausserhalb 1-12 oder ein Jahr weit weg ist ein Tippfehler in der
  // Adresse - und die Antwort darauf ist der laufende Monat, nicht ein Fehler.
  if (monat < 1 || monat > 12 || jahr < 2020 || jahr > 2100) {
    return monatsBeginnIn(heute, ZONE);
  }
  return monatsBeginnIn(new Date(Date.UTC(jahr, monat - 1, 15, 12)), ZONE);
}

function wocheAus(wert: string | undefined, heute: Date): Date {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(wert ?? '');
  if (!treffer) {
    return wochenBeginnIn(heute, ZONE);
  }
  const tag = new Date(`${wert}T12:00:00Z`);
  if (Number.isNaN(tag.getTime())) {
    return wochenBeginnIn(heute, ZONE);
  }
  return wochenBeginnIn(tag, ZONE);
}

const alsMonat = (wert: Date): string =>
  `${teileIn(wert, ZONE).jahr}-${String(teileIn(wert, ZONE).monat).padStart(2, '0')}`;

const alsTag = (wert: Date): string => wert.toLocaleDateString('sv-SE', { timeZone: ZONE });

export default async function WorkspacePlanungPage({
  searchParams,
}: {
  searchParams: Promise<Suche>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(WORKSPACE_ZUGANG);
  const betrachter = workspaceBetrachter(context);
  const suche = await searchParams;
  const guildId = await resolveGuildId();
  const einstellungen = await workspaceEinstellungen();
  const heute = new Date();

  const wochenansicht = suche.ansicht === 'woche';
  const nurOffene = suche.alle !== 'ja';

  const von = wochenansicht ? wocheAus(suche.woche, heute) : monatAus(suche.monat, heute);
  const bis = wochenansicht ? tageSpaeter(von, ZONE, 7) : naechsterMonatsBeginnIn(von, ZONE);

  const [termine, zahlen] = await Promise.all([
    workspace.ladeTermine(guildId, betrachter, von, bis, { nurOffene }),
    workspace.ladeUebersichtszahlen(guildId, betrachter, {
      jetzt: heute,
      baldTage: einstellungen.baldFaelligTage,
    }),
  ]);

  const teile = teileIn(von, ZONE);
  const titel = wochenansicht ? `Woche ab ${fristText(von)}` : `${MONATE[teile.monat - 1]} ${teile.jahr}`;

  const vorher = wochenansicht
    ? `?ansicht=woche&woche=${alsTag(tageSpaeter(von, ZONE, -7))}`
    : `?monat=${alsMonat(tageSpaeter(von, ZONE, -1))}`;
  const nachher = wochenansicht
    ? `?ansicht=woche&woche=${alsTag(tageSpaeter(von, ZONE, 7))}`
    : `?monat=${alsMonat(bis)}`;
  const jetztHin = wochenansicht ? '?ansicht=woche' : '';

  const knopf =
    'flex min-h-11 items-center rounded-full border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground';
  const knopfAktiv =
    'flex min-h-11 items-center rounded-full border border-primary bg-primary/10 px-3 text-sm font-medium text-foreground';

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={workspaceNavigation(context, { meineOffenen: zahlen.meineOffenen })}
        aktiv="planung"
        label="Bereiche im Workspace"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${systemRoutes.workspacePlanung()}${vorher}`} className={knopf}>
            ← Zurück
          </Link>
          <Link href={`${systemRoutes.workspacePlanung()}${jetztHin}`} className={knopf}>
            Heute
          </Link>
          <Link href={`${systemRoutes.workspacePlanung()}${nachher}`} className={knopf}>
            Weiter →
          </Link>
          <h2 className="ml-1 text-base font-semibold">{titel}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={systemRoutes.workspacePlanung()} className={wochenansicht ? knopf : knopfAktiv}>
            Monat
          </Link>
          <Link
            href={`${systemRoutes.workspacePlanung()}?ansicht=woche`}
            className={wochenansicht ? knopfAktiv : knopf}
          >
            Woche
          </Link>
          <Link
            href={`${systemRoutes.workspacePlanung()}?${new URLSearchParams({
              ...(wochenansicht ? { ansicht: 'woche' } : {}),
              ...(wochenansicht && suche.woche ? { woche: suche.woche } : {}),
              ...(!wochenansicht && suche.monat ? { monat: suche.monat } : {}),
              ...(nurOffene ? { alle: 'ja' } : {}),
            }).toString()}`}
            className={cn(nurOffene ? knopf : knopfAktiv)}
          >
            {nurOffene ? 'Erledigte zeigen' : 'Erledigte ausblenden'}
          </Link>
        </div>
      </div>

      <Legende />

      {termine.length === 0 ? (
        <EmptyState
          title="Nichts in diesem Zeitraum"
          description="Fristen von Aufgaben, Meilensteine und Projektziele stehen hier, sobald sie in diesen Zeitraum fallen."
        />
      ) : wochenansicht ? (
        <Wochengitter termine={termine} anker={von} zone={ZONE} heute={heute} />
      ) : (
        <Monatsgitter termine={termine} anker={von} zone={ZONE} heute={heute} />
      )}

      <Panel
        title="Alles in diesem Zeitraum"
        icon="List"
        description={`${termine.length} ${termine.length === 1 ? 'Termin' : 'Termine'} · nach Datum`}
      >
        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Termine.</p>
        ) : (
          /*
            Die Liste unter dem Gitter ist keine Dopplung.
            Im Monatsgitter steht ab dem vierten Eintrag eines Tages nur noch
            «+2 weitere» - die Liste ist der Ort, an dem auch der vierte steht.
          */
          <ul className="divide-y divide-border/60">
            {termine.map((termin) => (
              <li
                key={`${termin.art}:${termin.id}`}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <Link
                  href={
                    termin.art === 'aufgabe'
                      ? systemRoutes.workspaceAufgabe(termin.id)
                      : termin.projectId
                        ? systemRoutes.workspaceProjekt(termin.projectId)
                        : systemRoutes.workspaceProjekte()
                  }
                  className={cn(
                    'min-w-0 truncate text-sm hover:underline',
                    termin.erledigt && 'text-muted-foreground line-through',
                  )}
                >
                  {termin.titel}
                  {termin.projektTitel ? (
                    <span className="text-muted-foreground"> · {termin.projektTitel}</span>
                  ) : null}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {fristText(termin.faelligAm)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
