import type { Metadata } from 'next';
import Link from 'next/link';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { ClipAbschnittsNav } from '@/modules/clips/components/abschnitts-nav';
import { PhasenBuehne } from '@/modules/clips/components/phasen-buehne';
import { Galerie, type GalerieEintrag } from '@/modules/clips/components/galerie';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { clipAbschnitte, ladeClipStand } from '@/server/clips';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Clip of the Week' };
export const dynamic = 'force-dynamic';

const SORTIERUNGEN: Array<{ key: clips.Sortierung; label: string }> = [
  { key: 'neueste', label: 'Neueste' },
  { key: 'stimmen', label: 'Meiste Stimmen' },
  { key: 'aelteste', label: 'Älteste' },
];

/**
 * Die Startseite von Clip of the Week.
 *
 * Eine Seite, drei Gesichter - je nachdem, ob eingereicht, abgestimmt oder
 * gefeiert wird. Was sich aendert, ist die Buehne oben; darunter stehen
 * immer die Clips, weil sie der Grund sind, weshalb jemand hier ist.
 */
export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.view);
  const params = await searchParams;
  const stand = await ladeClipStand(context);

  const offen = stand.darfModerieren && stand.runde ? await clips.offeneModeration(stand.runde.id) : 0;
  const nav = <ClipAbschnittsNav abschnitte={clipAbschnitte(context, offen)} />;

  if (!stand.aktiv) {
    return (
      <div className="space-y-6">
        {nav}
        <ErrorState
          title="Modul deaktiviert"
          description="Clip of the Week ist derzeit deaktiviert. Es laufen keine Runden und es kann nicht eingereicht werden."
        />
      </div>
    );
  }

  const runde = stand.runde;
  const einstellungen = await clips.einstellungen();

  /*
   * Waehrend der Einreichungsphase sind die Clips nur sichtbar, wenn die
   * Einstellung es erlaubt. Wer frueh einreicht, soll nicht dadurch im
   * Nachteil sein, dass alle seinen Clip schon kennen - und wer spaet
   * einreicht, soll sich nicht an den anderen orientieren koennen.
   */
  const zeigeClips =
    runde !== null &&
    (stand.phase !== 'einreichen' || einstellungen.showClipsDuringSubmission) &&
    stand.phase !== 'vorbereitung';

  const sortierung = leseSortierung(params.sort);
  const spiel = params.spiel?.trim() || null;
  const seite = Number.parseInt(params.seite ?? '1', 10);

  const [galerie, spiele, zahlen, eigene] = runde
    ? await Promise.all([
        zeigeClips
          ? clips.galerie({
              competitionId: runde.id,
              betrachterDiscordId: context.user.discordId,
              sortierung,
              spiel,
              seite: Number.isFinite(seite) ? seite : 1,
            })
          : Promise.resolve({ karten: [], gesamt: 0, seite: 1, seiten: 1 }),
        clips.spieleDerRunde(runde.id),
        clips.rundenZahlen(runde.id),
        clips.eigeneEinreichungen(runde.id, context.user.discordId),
      ])
    : [null, [], null, []];

  const eintraege: GalerieEintrag[] = (galerie?.karten ?? []).map((karte) => ({
    karte,
    einbettung: clips.einbettung(karte, stand.hostname),
  }));

  const abstimmbar = stand.phase === 'voting' && stand.darfAbstimmen;

  return (
    <div className="space-y-6">
      {nav}

      <PhasenBuehne
        phase={stand.phase}
        nummer={runde?.number ?? null}
        endetAm={stand.endetAm}
        freigegeben={zahlen?.freigegeben ?? 0}
        teilnehmende={zahlen?.teilnehmende ?? 0}
        darfEinreichen={stand.darfEinreichen}
        eigeneEinreichung={eigene.length > 0}
        verbleibendeStimmen={stand.verbleibendeStimmen}
      />

      {eigene.length > 0 ? <EigeneEinreichungen eintraege={eigene} /> : null}

      {runde && zeigeClips ? (
        <>
          {(spiele.length > 1 || eintraege.length > 1) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {spiele.length > 1 ? (
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                  <FilterChip href={ziel({ sort: sortierung })} aktiv={spiel === null} label="Alle Spiele" />
                  {spiele.map((name) => (
                    <FilterChip
                      key={name}
                      href={ziel({ sort: sortierung, spiel: name })}
                      aktiv={spiel === name}
                      label={name}
                    />
                  ))}
                </div>
              ) : (
                <span />
              )}

              <div className="flex gap-2">
                {SORTIERUNGEN.filter(
                  // Nach Stimmen sortieren ergibt nur Sinn, wenn sie auch zu
                  // sehen sind. Der Knopf verschwindet sonst, statt
                  // wirkungslos dazustehen.
                  (eintrag) => eintrag.key !== 'stimmen' || clips.stimmenSichtbar(runde),
                ).map((eintrag) => (
                  <FilterChip
                    key={eintrag.key}
                    href={ziel({ sort: eintrag.key, spiel })}
                    aktiv={sortierung === eintrag.key}
                    label={eintrag.label}
                  />
                ))}
              </div>
            </div>
          )}

          {eintraege.length === 0 ? (
            <EmptyState
              title="Noch keine Clips"
              description={
                stand.phase === 'einreichen'
                  ? 'Sei der Erste - reiche deinen Clip ein.'
                  : 'In dieser Runde wurde kein Clip freigegeben.'
              }
            />
          ) : (
            <Galerie
              eintraege={eintraege}
              csrfToken={csrfTokenFor(context)}
              abstimmbar={abstimmbar}
              verbleibendeStimmen={stand.verbleibendeStimmen}
              selbstwahlErlaubt={runde.allowSelfVote}
            />
          )}

          {galerie && galerie.seiten > 1 ? (
            <Pagination
              page={galerie.seite}
              totalPages={galerie.seiten}
              total={galerie.gesamt}
              buildHref={(nummer) => ziel({ sort: sortierung, spiel, seite: nummer })}
            />
          ) : null}
        </>
      ) : null}

      {runde && !zeigeClips && stand.phase === 'einreichen' ? (
        <EmptyState
          title="Die Clips bleiben bis Freitag unter Verschluss"
          description="So entscheidet am Ende der Clip und nicht der Zeitpunkt der Einreichung."
        />
      ) : null}
    </div>
  );
}

function leseSortierung(wert: string | undefined): clips.Sortierung {
  return wert === 'stimmen' || wert === 'aelteste' ? wert : 'neueste';
}

function ziel({
  sort,
  spiel,
  seite,
}: {
  sort: clips.Sortierung;
  spiel?: string | null;
  seite?: number;
}): string {
  const parameter = new URLSearchParams();
  if (sort !== 'neueste') {
    parameter.set('sort', sort);
  }
  if (spiel) {
    parameter.set('spiel', spiel);
  }
  if (seite && seite > 1) {
    parameter.set('seite', String(seite));
  }
  const anhang = parameter.toString();
  return anhang ? `${systemRoutes.clips()}?${anhang}` : systemRoutes.clips();
}

function FilterChip({
  href,
  aktiv,
  label,
}: {
  href: string;
  aktiv: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      aria-current={aktiv ? 'true' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-sm transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        aktiv
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Wartet auf Freigabe',
  APPROVED: 'Freigegeben',
  REJECTED: 'Abgelehnt',
  REMOVED: 'Aus der Runde genommen',
};

/**
 * Der Stand der eigenen Einreichung.
 *
 * Wer etwas eingereicht hat, will wissen, was daraus geworden ist - und im
 * Fall einer Ablehnung auch, warum. Die Begruendung steht deshalb hier und
 * nicht nur im Protokoll der Moderation.
 */
function EigeneEinreichungen({
  eintraege,
}: {
  eintraege: Array<{
    entryId: string;
    titel: string;
    status: string;
    grund: string | null;
    notiz: string | null;
  }>;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4">
      <h2 className="text-sm font-medium text-muted-foreground">Deine Einreichung</h2>
      <ul className="mt-3 space-y-2">
        {eintraege.map((eintrag) => (
          <li key={eintrag.entryId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{eintrag.titel}</span>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                eintrag.status === 'APPROVED'
                  ? 'bg-success/15 text-success'
                  : eintrag.status === 'PENDING'
                    ? 'bg-secondary text-muted-foreground'
                    : 'bg-destructive/15 text-destructive',
              )}
            >
              {STATUS_TEXT[eintrag.status] ?? eintrag.status}
            </span>
            {eintrag.status === 'REJECTED' && (eintrag.notiz || eintrag.grund) ? (
              <p className="w-full text-sm text-muted-foreground">
                {eintrag.notiz ?? clips.ABLEHNUNGSGRUND_TEXT.get(eintrag.grund ?? '') ?? 'Ohne Angabe'}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
