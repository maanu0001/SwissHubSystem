import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { ClipAbschnittsNav } from '@/modules/clips/components/abschnitts-nav';
import { requirePagePermission } from '@/server/auth';
import { clipAbschnitte, ladeClipStand } from '@/server/clips';

export const metadata: Metadata = { title: 'Hall of Fame' };
export const dynamic = 'force-dynamic';

const PRO_SEITE = 12;

/**
 * Jede Woche, die schon entschieden ist.
 *
 * Eine Wand aus Gewinnerclips, neueste zuerst. Kein Player im Raster - bei
 * zwoelf gleichzeitig laufenden Rahmen ist das Telefon nach zehn Sekunden
 * warm; der Clip oeffnet sich auf seiner eigenen Seite.
 */
export default async function HallOfFamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.view);
  const params = await searchParams;
  const stand = await ladeClipStand(context);

  const gewuenscht = Number.parseInt(params.seite ?? '1', 10);
  const gesamt = await clips.hallOfFameAnzahl(stand.guildId);
  const seiten = Math.max(1, Math.ceil(gesamt / PRO_SEITE));
  const seite = Math.min(Math.max(Number.isFinite(gewuenscht) ? gewuenscht : 1, 1), seiten);

  const runden = await clips.hallOfFame(stand.guildId, PRO_SEITE, (seite - 1) * PRO_SEITE);
  const nav = <ClipAbschnittsNav abschnitte={clipAbschnitte(context)} />;

  return (
    <div className="space-y-6">
      {nav}

      {/*
        Die oberste Ueberschrift der Seite traegt die Kopfzeile der Anwendung.
        Hier beginnt es deshalb eine Stufe tiefer - ein zweiter Seitenanfang
        waere fuer einen Screenreader eine zweite Seite.
      */}
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Hall of Fame</h2>
        <p className="text-sm text-muted-foreground">
          {gesamt === 0
            ? 'Noch keine abgeschlossene Runde.'
            : `${gesamt} ${gesamt === 1 ? 'Woche' : 'Wochen'}, ${gesamt === 1 ? 'ein Gewinner' : 'ebenso viele Gewinnerclips'}.`}
        </p>
      </header>

      {runden.length === 0 ? (
        <EmptyState
          title="Die erste Runde läuft noch"
          description="Sobald eine Woche abgeschlossen ist, steht ihr Gewinner hier."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {runden.map((runde) => {
            const name =
              runde.gewinner?.einreicher.displayName ?? runde.gewinner?.einreicher.username ?? 'Unbekannt';
            return (
              <Link
                key={runde.key}
                href={systemRoutes.clipRunde(runde.key)}
                className="group overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-video w-full bg-secondary">
                  {runde.gewinner?.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={runde.gewinner.thumbnailUrl}
                      alt=""
                      className="size-full object-cover transition duration-300 motion-safe:group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                  ) : null}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                    <Trophy className="size-3 text-[hsl(45_92%_58%)]" aria-hidden="true" />
                    Woche {runde.woche}/{runde.jahr}
                  </span>
                </div>

                <div className="space-y-2 p-4">
                  <h3 className="truncate font-semibold leading-tight">
                    {runde.gewinner?.titel ?? 'Ohne Gewinner'}
                  </h3>
                  {runde.gewinner ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DiscordAvatar
                        discordId={runde.gewinner.einreicher.discordId}
                        avatarHash={runde.gewinner.einreicher.avatarHash}
                        name={name}
                        size={20}
                      />
                      <span className="truncate">{name}</span>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {runde.teilnehmer} {runde.teilnehmer === 1 ? 'Clip' : 'Clips'} · {runde.stimmen}{' '}
                    {runde.stimmen === 1 ? 'Stimme' : 'Stimmen'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {seiten > 1 ? (
        <Pagination
          page={seite}
          totalPages={seiten}
          total={gesamt}
          buildHref={(nummer) =>
            nummer > 1 ? `${systemRoutes.hallOfFame()}?seite=${nummer}` : systemRoutes.hallOfFame()
          }
        />
      ) : null}
    </div>
  );
}
