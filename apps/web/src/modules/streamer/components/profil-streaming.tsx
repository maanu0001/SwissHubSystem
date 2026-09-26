import Link from 'next/link';
import { ArrowUpRight, BadgeCheck, Radio, ShieldCheck, Users } from 'lucide-react';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { formatDateTime } from '@swisshub/shared';
import type { streamer } from '@swisshub/modules';
import { OeAbschnitt } from '@/modules/profile/components/oeffentlich/oe-bausteine';
import { spracheLabel } from './sprache';

/**
 * Der Streaming-Abschnitt im oeffentlichen Mitgliedsprofil.
 *
 * ## Warum ein Abschnitt und keine zweite Seite
 *
 * Weil es schon eine Seite gibt: `/streamer/<slug>`. Hier geht es um das
 * bestehende Profil, das um einen Abschnitt waechst - mit seinem Theme, seiner
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

      {streaming.streamerSeite ? (
        <p className="mt-3 text-xs">
          <Link
            href={streaming.streamerSeite}
            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Im SwissHub Streamer Hub ansehen
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </OeAbschnitt>
  );
}
