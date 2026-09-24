'use client';

import { Crown, Shield, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Die kleinen Teile, aus denen die Bühne besteht.
 *
 * Bewusst hier und nicht je Szene: ein Cover sieht in der Lobby genauso aus
 * wie im Duell, und drei Fassungen davon wären drei Gelegenheiten, dass eine
 * abweicht.
 */

/**
 * Das Cover eines Spiels.
 *
 * ## Warum ein Monogramm und nicht der Titel
 *
 * Ein Spiel ohne Bild im Katalog braucht trotzdem eine Fläche. Der erste
 * Versuch setzte den Titel gross darauf - und weil die Karte ihn unten
 * ohnehin nennt, stand er zweimal da. Jetzt steht dort der Anfangsbuchstabe,
 * sehr gross und sehr leise: eine Fläche, die nach Absicht aussieht statt
 * nach fehlendem Bild, und die nichts wiederholt.
 *
 * ## Warum das Bild erst erscheint, wenn es da ist
 *
 * Ein `onError`-Ersatz deckt den Fall ab, in dem ein Fehler gemeldet wird -
 * nicht den, in dem die Anfrage hängenbleibt. Dann stünde das Browsersymbol
 * für «kaputtes Bild» mitten auf der Bühne. Deshalb liegt das Monogramm
 * immer darunter, und das Bild blendet sich darüber, sobald es geladen ist.
 * Kein Loch während des Ladens, kein Symbol, wenn nie etwas kommt.
 */
export function Cover({
  name,
  bannerUrl,
  className,
}: {
  name: string;
  bannerUrl: string | null;
  className?: string;
}): React.JSX.Element {
  const [geladen, setGeladen] = useState(false);

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(var(--sp-rot)/0.35)] to-[hsl(var(--background))]',
        className,
      )}
    >
      {/*
        Das Monogramm trägt die Fläche, wenn kein Bild da ist.

        Erst stand es bei 9 % Weiss - auf der Ergebnisbühne war davon nichts
        mehr zu sehen, und der Gewinner erschien als schwarzes Loch. Jetzt
        ist es deutlich genug, um eine Fläche zu sein, und leise genug, dass
        der Titel darunter die Hauptsache bleibt.
      */}
      <div
        aria-hidden="true"
        className="flex h-full w-full select-none items-center justify-center bg-[radial-gradient(60%_60%_at_50%_40%,hsl(var(--sp-rot)/0.35),transparent_70%)] text-[clamp(3rem,14vw,7rem)] font-black leading-none text-white/25"
      >
        {monogramm(name)}
      </div>
      {bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Fremde CDN-Adresse; der Optimierer von Next.js bringt hier nichts und verlangte eine Hostliste.
        <img
          src={bannerUrl}
          alt=""
          aria-hidden="true"
          onLoad={() => setGeladen(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            geladen ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
    </div>
  );
}

/**
 * Der Anfangsbuchstabe eines Titels.
 *
 * Ziffern und Satzzeichen werden übersprungen: «7 Days to Die» als «7» wäre
 * schwächer als als «D». Findet sich kein Buchstabe, bleibt das erste
 * Zeichen - besser als eine leere Fläche.
 */
function monogramm(name: string): string {
  const buchstabe = [...name].find((zeichen) => /\p{L}/u.test(zeichen));
  return (buchstabe ?? name.trim()[0] ?? '?').toUpperCase();
}

/** Ein Teilnehmer mit Avatar, Rolle und - während einer Abstimmung - Status. */
export function Teilnehmer({
  person,
  zeigeStimmstand,
}: {
  person: Stand['teilnehmer'][number];
  zeigeStimmstand: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3">
      <div className="relative">
        <DiscordAvatar
          discordId={person.discordId}
          avatarHash={person.avatarHash}
          name={person.anzeigename}
          size={28}
        />
        {zeigeStimmstand ? (
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[hsl(var(--background))] transition-colors',
              person.hatGewaehlt ? 'bg-emerald-400' : 'bg-white/25',
            )}
            aria-label={person.hatGewaehlt ? 'hat gewählt' : 'wählt noch'}
          />
        ) : null}
      </div>
      <span className="min-w-0 truncate text-sm text-white/80">{person.anzeigename}</span>
      {person.rolle === 'HOST' ? (
        <Crown className="size-3.5 shrink-0 text-[hsl(var(--sp-rot-hell))]" aria-label="Host" />
      ) : null}
      {person.rolle === 'COHOST' ? (
        <Shield className="size-3.5 shrink-0 text-white/40" aria-label="Co-Host" />
      ) : null}
    </div>
  );
}

/** Die Reihe der Teilnehmer. */
export function Runde({
  teilnehmer,
  zeigeStimmstand = false,
  max,
}: {
  teilnehmer: Stand['teilnehmer'];
  zeigeStimmstand?: boolean;
  max?: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
        <Users className="size-3.5" aria-hidden="true" />
        {teilnehmer.length}
        {max ? ` / ${max}` : ''}
      </span>
      {teilnehmer.map((person) => (
        <Teilnehmer key={person.discordId} person={person} zeigeStimmstand={zeigeStimmstand} />
      ))}
    </div>
  );
}

/**
 * Der Countdown.
 *
 * Die Zahl ist Darstellung; entschieden wird beim Server. Deshalb bleibt sie
 * bei 0 stehen, statt negativ zu werden oder zu verschwinden - «0» heisst
 * «gleich», nicht «vorbei».
 */
export function Frist({
  rest,
  dauerSek,
}: {
  rest: number | null;
  dauerSek: number;
}): React.JSX.Element | null {
  if (rest === null) {
    return null;
  }
  const sekunden = Math.ceil(rest / 1000);
  const anteil = Math.max(0, Math.min(1, rest / (dauerSek * 1000)));

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Noch</span>
        <span
          className={cn(
            'font-mono text-2xl font-bold tabular-nums transition-colors',
            sekunden <= 5 ? 'text-[hsl(var(--sp-rot-hell))]' : 'text-white/80',
          )}
        >
          {sekunden}s
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[hsl(var(--sp-rot-hell))] transition-[width] duration-200 ease-linear"
          style={{ width: `${anteil * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Die Überschrift einer Szene - klein, gesperrt, darüber die grosse Aussage. */
export function Vorzeile({
  children,
  verzug = 0,
}: {
  children: React.ReactNode;
  verzug?: number;
}): React.JSX.Element {
  return (
    <p
      className="sp-auf text-xs font-semibold uppercase tracking-[0.28em] text-white/35"
      style={{ ['--verzug' as string]: `${verzug}ms` }}
    >
      {children}
    </p>
  );
}

/** Sagt, ob der Strom steht. Eine stillstehende Bühne soll es zugeben. */
export function Verbindungsanzeige({ verbunden }: { verbunden: boolean }): React.JSX.Element {
  /*
   * Erst nach zwei Sekunden meckern.
   *
   * Beim Laden der Seite ist der Strom naturgemäss noch nicht offen. Ein
   * Warnhinweis, der bei jedem Seitenaufruf kurz aufblitzt, wird nach dem
   * dritten Mal nicht mehr gelesen.
   */
  const [zeigen, setZeigen] = useState(false);
  useEffect(() => {
    if (verbunden) {
      setZeigen(false);
      return;
    }
    const uhr = window.setTimeout(() => setZeigen(true), 2000);
    return () => window.clearTimeout(uhr);
  }, [verbunden]);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs transition-opacity',
        zeigen ? 'text-amber-300/80 opacity-100' : 'text-white/25 opacity-60',
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', verbunden ? 'bg-emerald-400' : 'bg-amber-400')}
        aria-hidden="true"
      />
      {verbunden ? 'Live' : zeigen ? 'Verbindung unterbrochen' : 'verbindet …'}
    </span>
  );
}
