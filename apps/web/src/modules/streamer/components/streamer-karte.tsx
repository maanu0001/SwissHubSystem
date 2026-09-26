import Link from 'next/link';
import { Radio, Users } from 'lucide-react';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { OeffentlicherStreamerDaten } from '@swisshub/modules/streamer/typen';
import { spracheLabel } from './sprache';

/**
 * Die Karte eines Streamers auf der oeffentlichen Uebersicht.
 *
 * ## Zwei Zustaende, zwei Gesichter
 *
 * **Live** heisst: das Vorschaubild des Streams traegt die Karte, gross, mit
 * Titel und Spiel darauf. Das ist der Punkt der ganzen Seite - jemand soll
 * sehen, was gerade laeuft, und klicken.
 *
 * **Offline** heisst: das Profilbanner traegt die Karte, ruhiger, mit Spielen
 * und Sprachen. Kein ausgegrautes Live-Layout mit «offline» darin - das waere
 * dieselbe Karte, nur traurig.
 *
 * ## Warum keine Zahl, die wir nicht haben
 *
 * Die Zuschauerzahl erscheint nur, wenn die Plattform sie geliefert hat. «0
 * Zuschauer» stuende sonst bei jedem Kanal, der sie verbirgt - und waere eine
 * Behauptung, die einem Streamer schadet.
 */
export function StreamerKarte({ streamer }: { streamer: OeffentlicherStreamerDaten }): React.JSX.Element {
  const live = streamer.live;
  const ziel = systemRoutes.streamerOeffentlichProfil(streamer.slug);
  const bild = getDiscordAvatarUrl(streamer.discordId, streamer.avatarHash, 128);

  return (
    <Link
      href={ziel}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        live
          ? 'border-primary/40 shadow-[0_0_30px_-12px_hsl(var(--primary))] hover:border-primary/70'
          : 'border-border hover:border-primary/30',
      )}
    >
      {/*
        Die Flaeche oben.

        Bei Live das Vorschaubild des Streams - das ist der Grund, warum jemand
        klickt. Ohne Bild (oder offline) der Bannerverlauf des Profils, der fuer
        sich stehen kann; eine graue Notflaeche gibt es nicht.
      */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {live?.vorschaubildUrl ? (
          // Fremde CDN mit wechselnden Hosts (Twitch, YouTube): `next/image`
          // braucht dafür eine Allowlist in der Konfiguration, und die wäre eine
          // zweite Stelle, an der ein neuer Plattform-Host nachzuziehen wäre.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={live.vorschaubildUrl}
            alt=""
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="size-full" style={{ backgroundImage: streamer.bannerVerlauf }}>
            {streamer.bannerBild ? (
              // eslint-disable-next-line @next/next/no-img-element -- siehe oben
              <img src={streamer.bannerBild} alt="" className="size-full object-cover" loading="lazy" />
            ) : null}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />

        {live ? (
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider text-primary-foreground">
              {/* Der Punkt pulsiert - das ist die einzige Animation auf der
                  Karte, und sie sagt etwas: es läuft gerade. */}
              <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />
              Live
            </span>
            {live.zuschauer !== null ? (
              <span className="flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[0.7rem] font-medium backdrop-blur">
                <Users className="size-3" aria-hidden="true" />
                {live.zuschauer.toLocaleString('de-CH')}
              </span>
            ) : null}
          </div>
        ) : null}

        {live?.spiel ? (
          <span className="absolute bottom-3 left-3 max-w-[85%] truncate rounded-md bg-background/85 px-2 py-1 text-xs font-medium backdrop-blur">
            {live.spiel}
          </span>
        ) : null}
      </div>

      {/* Der Kopf: Bild, Name, Titel oder Spiele. */}
      <div className="flex items-start gap-3 p-4">
        <span
          className={cn(
            'relative -mt-8 shrink-0 overflow-hidden rounded-xl border-2 bg-card',
            live ? 'border-primary' : 'border-border',
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Discord-CDN */}
          <img src={bild} alt="" width={52} height={52} className="size-13 object-cover" loading="lazy" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold leading-tight">{streamer.name}</span>
          {live?.titel ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{live.titel}</span>
          ) : streamer.spiele.length > 0 ? (
            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
              {streamer.spiele.map((spiel) => spiel.name).join(' · ')}
            </span>
          ) : streamer.beschreibung ? (
            <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
              {streamer.beschreibung}
            </span>
          ) : null}
        </span>
      </div>

      {/* Die Fusszeile: Plattformen und Sprachen. */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-3">
        {streamer.kanaele.map((kanal) => (
          <Badge key={kanal.plattform} variant={live ? 'default' : 'outline'} className="gap-1">
            <Radio className="size-3" aria-hidden="true" />
            {PLATTFORMEN[kanal.plattform].label}
          </Badge>
        ))}
        {streamer.sprachen.slice(0, 3).map((sprache) => (
          <Badge key={sprache} variant="secondary" className="font-normal">
            {spracheLabel(sprache)}
          </Badge>
        ))}
      </div>
    </Link>
  );
}
