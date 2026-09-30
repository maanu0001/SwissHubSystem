import { ArrowUpRight, BadgeCheck, Radio, ShieldCheck, Users } from 'lucide-react';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { formatDateTime } from '@swisshub/shared';
import type { streamer } from '@swisshub/modules';
import { OeAbschnitt } from '@/modules/profile/components/oeffentlich/oe-bausteine';
import { spracheLabel } from './sprache';

/** Wie ein Anbieter heisst, wenn ein Clip keinen eigenen Titel traegt. */
const ANBIETER_LABEL: Record<string, string> = {
  twitch: 'Twitch-Clip',
  youtube: 'YouTube',
  medal: 'Medal-Clip',
};

/**
 * Der Streaming-Abschnitt im oeffentlichen Mitgliedsprofil.
 *
 * ## Warum ein Abschnitt und keine zweite Seite
 *
 * Weil es nur **ein** oeffentliches Profil gibt. Es gab zwei -
 * `/u/<slug>` und `/streamer/<slug>`, dieselbe Person, zwei Gestaltungen -,
 * und die erste Frage danach war, welche die richtige ist. Die zweite leitet
 * jetzt hierher um, und was dort stand, steht in diesem Abschnitt: Kanaele,
 * Live-Stand, Sprachen, die Vitrine mit bis zu drei eigenen Clips und die
 * hervorgehobene Zeile.
 *
 * Das Profil waechst damit um einen Abschnitt - mit seinem Theme, seiner
 * Reihenfolge und seinen Bauteilen. Deshalb `OeAbschnitt` aus dem Profilmodul
 * und keine eigene Karte: eine Karte, die sich ihr Aussehen selbst gibt, faellt
 * in fuenf von sieben Themes heraus.
 *
 * ## Warum keine Zahl, die wir nicht haben
 *
 * Kein «0 Zuschauer», kein «offline seit», kein «zuletzt live». Die
 * Zuschauerzahl erscheint nur, wenn die Plattform sie geliefert hat, und
 * ausserhalb eines laufenden Streams steht hier nur, wo jemand zu finden ist.
 * Eine erfundene Angabe waere auf einer Seite, die jemand teilt, am
 * schaedlichsten.
 *
 * ## Warum «bestaetigt» nur dort steht, wo es stimmt
 *
 * Ein Kanal mit `offen` bekommt kein Abzeichen - nicht eines mit dem Wort
 * «unbestaetigt», sondern gar keines. Die drei Zustaende kommen aus
 * `ladeProfilStreaming`; hier wird nichts hergeleitet.
 */
export function ProfilStreamingAbschnitt({
  streaming,
  verzug,
}: {
  streaming: streamer.ProfilStreaming;
  /** Die Verzögerung des Auftritts - die Seite zählt sie durch. */
  verzug: number;
}): React.JSX.Element {
  const live = streaming.live;

  return (
    <OeAbschnitt titel="Streaming" notiz={live ? 'Live' : null} verzug={verzug} className="po-breit">
      {live ? (
        <a
          href={live.streamUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="po-hebt group mb-4 flex flex-col gap-4 overflow-hidden rounded-xl border border-[hsl(var(--profil-akzent)/0.45)] sm:flex-row"
        >
          {live.vorschaubildUrl ? (
            <span className="relative block w-full shrink-0 overflow-hidden bg-[hsl(var(--profil-flaeche))] sm:w-56">
              {/* eslint-disable-next-line @next/next/no-img-element -- Fremde CDN
                  mit wechselnden Hosts (Twitch, YouTube): `next/image` bräuchte
                  dafür eine Allowlist in der Konfiguration, und die wäre eine
                  zweite Stelle, an der ein neuer Plattform-Host nachzuziehen
                  wäre. */}
              <img
                src={live.vorschaubildUrl}
                alt=""
                className="aspect-video size-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            </span>
          ) : null}

          <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-4 sm:py-4 sm:pl-0 sm:pr-4">
            <span className="flex flex-wrap items-center gap-2">
              {/* Farbe aus dem Theme, nicht eigene: dieselben beiden Werte wie
                  `OeAbzeichen` mit `betont`. Ein Abzeichen mit mitgebrachter
                  Farbe sähe in fünf von sieben Themes falsch aus. */}
              <span className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--profil-akzent)/0.18)] px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider text-[hsl(var(--profil-akzent))]">
                {/* Die einzige Animation im Abschnitt - und sie sagt etwas aus:
                    es läuft gerade. */}
                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                Live auf {PLATTFORMEN[live.plattform].label}
              </span>
              {live.zuschauer !== null ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3.5" aria-hidden="true" />
                  {live.zuschauer.toLocaleString('de-CH')}
                </span>
              ) : null}
            </span>

            {live.titel ? (
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{live.titel}</span>
            ) : null}

            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {live.spiel ? <span className="font-medium">{live.spiel}</span> : null}
              {live.sprache ? <span>{spracheLabel(live.sprache)}</span> : null}
              {/* Absolut, nicht relativ: die Seite wird zwischengespeichert, und
                  «seit 3 Minuten» wäre dann eine Minute später falsch. */}
              <span>seit {formatDateTime(live.gestartetAm)}</span>
            </span>

            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--profil-akzent))]">
              Stream ansehen
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </span>
          </span>
        </a>
      ) : null}

      <ul className="flex flex-wrap gap-2">
        {streaming.kanaele.map((kanal) => (
          <li key={`${kanal.plattform}-${kanal.handle}`}>
            <a
              href={kanal.adresse}
              target="_blank"
              /* `noreferrer` zusätzlich zu `noopener`: Twitch muss nicht
                 erfahren, von welchem Profil jemand kam. */
              rel="noopener noreferrer"
              className="po-hebt inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] px-3 py-2 text-sm"
            >
              <Radio className="size-3.5 text-[hsl(var(--profil-akzent))]" aria-hidden="true" />
              <span className="text-muted-foreground">{PLATTFORMEN[kanal.plattform].label}</span>
              <span className="font-medium">{kanal.anzeigename ?? kanal.handle}</span>
              {kanal.bestaetigt === 'plattform' ? (
                <BadgeCheck
                  className="size-3.5 text-[hsl(var(--profil-akzent))]"
                  aria-label="Von der Plattform bestätigt"
                />
              ) : kanal.bestaetigt === 'team' ? (
                <ShieldCheck className="size-3.5 text-muted-foreground" aria-label="Vom Team geprüft" />
              ) : null}
            </a>
          </li>
        ))}
      </ul>

      {/*
        Die hervorgehobene Zeile.

        Klartext, vom Streamer selbst - geprüft in `streamer/vitrine.ts` gegen
        eine Erlaubnisliste, damit hier kein Markdown und keine Adresse
        landet. Sie steht **unter** den Kanälen und über den Clips: erst wo,
        dann was, dann wie es aussieht.
      */}
      {streaming.caption ? (
        <p className="mt-4 border-l-2 border-[hsl(var(--profil-akzent)/0.55)] pl-3 text-sm italic text-muted-foreground">
          {streaming.caption}
        </p>
      ) : null}

      {/*
        Die Vitrine.

        Der Grund, warum diese Seite auch etwas zeigt, wenn gerade niemand
        streamt - und das ist die meiste Zeit. Kein `<iframe>` je Clip: drei
        Player gleichzeitig laden mehr, als ein Telefon mag, und keiner davon
        wurde angeklickt. Es steht das Vorschaubild da, und der Klick führt zum
        Clip beim Anbieter.
      */}
      {streaming.clips.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {streaming.clips.length === 1 ? 'Clip' : 'Clips'}
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {streaming.clips.map((clip) => (
              <li key={clip.position}>
                <a
                  href={clip.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="po-hebt group block overflow-hidden rounded-xl border border-[hsl(var(--profil-rand))]"
                >
                  <span className="relative block aspect-video w-full overflow-hidden bg-[hsl(var(--profil-flaeche))]">
                    {clip.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- Fremde
                         CDN mit wechselnden Hosts, wie beim Vorschaubild oben. */
                      <img
                        src={clip.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition duration-300 motion-safe:group-hover:scale-[1.03]"
                      />
                    ) : (
                      <span className="grid size-full place-items-center">
                        <Radio className="size-6 text-[hsl(var(--profil-akzent))]" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate font-medium">
                      {clip.titel ?? ANBIETER_LABEL[clip.provider]}
                    </span>
                    <ArrowUpRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </OeAbschnitt>
  );
}
