import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Radio, Search } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { streamer } from '@swisshub/modules';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StreamerKarte } from '@/modules/streamer/components/streamer-karte';
import { spracheLabel } from '@/modules/streamer/components/sprache';

/**
 * Die oeffentliche Streamer-Uebersicht.
 *
 * ## Ohne Anmeldung
 *
 * Genau das ist der Zweck: ein Link, den ein Streamer in seine Twitch-Bio
 * setzen kann und der bei jedem funktioniert. Eine Seite, die zum Login
 * fuehrt, waere fuer Sichtbarkeit wertlos.
 *
 * ## Live zuerst - und zwar als eigener Abschnitt
 *
 * Nicht sortiert, sondern getrennt. Wer die Seite oeffnet, soll in der ersten
 * Bildschirmhoehe sehen, ob gerade jemand streamt. Eine gemischte Liste mit
 * einem kleinen Abzeichen beantwortet diese Frage nicht.
 *
 * ## Warum die Filter ein `<form method="get">` sind
 *
 * Weil sie dann ohne JavaScript funktionieren, teilbar sind (der Filter steht
 * in der Adresse) und der Zurueck-Knopf des Browsers tut, was er soll. Eine
 * Client-Komponente mit Zustand waere mehr Code fuer weniger.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Streamer · ${branding.name}`,
  description: 'Community-Streamer aus der SwissHub-Community: wer gerade live ist und wer sonst streamt.',
};

interface Suche {
  q?: string;
  spiel?: string;
  plattform?: string;
  sprache?: string;
  live?: string;
}

export default async function OeffentlicheStreamerSeite({
  searchParams,
}: {
  searchParams: Promise<Suche>;
}): Promise<React.JSX.Element> {
  /*
   * Ausgeschaltet heisst 404 und nicht «leere Seite».
   *
   * Solange das Team Bewerbungen sammelt, soll es die Seite noch nicht geben -
   * und eine Seite, die es gibt und nichts zeigt, sieht nach einem Fehler aus.
   * `oeffentlichErlaubt` prueft beides: den Schalter und ob das Modul
   * ueberhaupt eingeschaltet ist. Diese Seite liegt ausserhalb von `(app)`;
   * ohne diese Pruefung waere sie die einzige Ansicht eines abgeschalteten
   * Moduls, die weiterlaeuft.
   */
  if (!(await streamer.oeffentlichErlaubt())) {
    notFound();
  }

  // Den Untertitel unter der Ueberschrift setzt das Team in den Moduleinstellungen.
  const einstellungen = await streamer.leseStreamerEinstellungen();

  const suche = await searchParams;
  const plattformFilter =
    suche.plattform === 'TWITCH' || suche.plattform === 'YOUTUBE' ? suche.plattform : undefined;

  const liste = await streamer.ladeOeffentlicheListe({
    suche: suche.q,
    spielId: suche.spiel,
    plattform: plattformFilter,
    sprache: suche.sprache,
    nurLive: suche.live === '1',
  });

  const gefiltert =
    Boolean(suche.q) ||
    Boolean(suche.spiel) ||
    Boolean(plattformFilter) ||
    Boolean(suche.sprache) ||
    suche.live === '1';

  return (
    <div className="flex flex-col gap-10">
      {/* --- Kopf --- */}
      <header className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <Radio className="size-4" aria-hidden="true" />
          {branding.name} Streamer
        </span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {liste.live.length > 0 ? (
            <>
              <span className="text-primary">{liste.live.length}</span>{' '}
              {liste.live.length === 1 ? 'Streamer ist' : 'Streamer sind'} gerade live
            </>
          ) : (
            'Unsere Streamer'
          )}
        </h1>
        {einstellungen.oeffentlichUntertitel ? (
          <p className="max-w-2xl text-muted-foreground">{einstellungen.oeffentlichUntertitel}</p>
        ) : null}
      </header>

      {/* --- Filter --- */}
      <form
        method="get"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Suche</span>
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input name="q" defaultValue={suche.q ?? ''} placeholder="Name oder Kanal" className="pl-9" />
          </span>
        </label>

        {/*
          Nur Filter, die in den Daten vorkommen.

          Eine Auswahl «Spiel» mit einem einzigen Eintrag, der zu nichts fuehrt,
          ist eine Sackgasse mit Ankuendigung - deshalb entsteht jede Liste aus
          `liste.filter` und nicht aus einem Katalog.
        */}
        {liste.filter.spiele.length > 0 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Spiel</span>
            <select
              name="spiel"
              defaultValue={suche.spiel ?? ''}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Alle Spiele</option>
              {liste.filter.spiele.map((spiel) => (
                <option key={spiel.id} value={spiel.id}>
                  {spiel.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {liste.filter.plattformen.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Plattform</span>
            <select
              name="plattform"
              defaultValue={plattformFilter ?? ''}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Alle</option>
              {liste.filter.plattformen.map((eintrag) => (
                <option key={eintrag} value={eintrag}>
                  {PLATTFORMEN[eintrag].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {liste.filter.sprachen.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Sprache</span>
            <select
              name="sprache"
              defaultValue={suche.sprache ?? ''}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Alle Sprachen</option>
              {liste.filter.sprachen.map((sprache) => (
                <option key={sprache} value={sprache}>
                  {spracheLabel(sprache)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
          <input
            type="checkbox"
            name="live"
            value="1"
            defaultChecked={suche.live === '1'}
            className="size-4 accent-[hsl(var(--primary))]"
          />
          Nur Live
        </label>

        <span className="flex gap-2">
          <Button type="submit" size="sm">
            Filtern
          </Button>
          {gefiltert ? (
            <Button type="submit" variant="ghost" size="sm" name="zuruecksetzen" formAction="/streamer">
              Zurücksetzen
            </Button>
          ) : null}
        </span>
      </form>

      {/* --- Live --- */}
      {liste.live.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Jetzt live
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {liste.live.map((eintrag) => (
              <StreamerKarte key={eintrag.slug} streamer={eintrag} />
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Offline --- */}
      {liste.offline.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-muted-foreground">
            Gerade offline
            <Badge variant="outline" className="font-normal">
              {liste.offline.length}
            </Badge>
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {liste.offline.map((eintrag) => (
              <StreamerKarte key={eintrag.slug} streamer={eintrag} />
            ))}
          </div>
        </section>
      ) : null}

      {liste.live.length === 0 && liste.offline.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Radio className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-4 font-medium">
            {gefiltert ? 'Kein Streamer passt zu diesen Filtern.' : 'Noch keine Streamer freigegeben.'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {gefiltert
              ? 'Setze die Filter zurück, um alle zu sehen.'
              : `Du streamst und bist auf dem ${branding.name}-Discord? Melde dich beim Team.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
