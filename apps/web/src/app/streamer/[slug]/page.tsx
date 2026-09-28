import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Radio, Users } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { streamer } from '@swisshub/modules';
import { PLATTFORMEN, embedAdresse } from '@swisshub/modules/streamer/typen';
import { formatDateTime, systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { spracheLabel } from '@/modules/streamer/components/sprache';
import { cn } from '@/lib/utils';

/**
 * Die oeffentliche Seite eines Streamers.
 *
 * ## Warum sie am Profil-Slug haengt
 *
 * Weil ein Streamer **dieselbe** Identitaet hat wie sein Mitgliedsprofil.
 * `/streamer/<slug>` und `/u/<slug>` zeigen dieselbe Person, aus zwei
 * Richtungen. Eine eigene Streamer-Kennung waere eine zweite Identitaet - und
 * die erste Frage danach waere, welche die richtige ist.
 *
 * ## Einbetten - und wann nicht
 *
 * Bei Twitch bettet der offizielle Player ein; er verlangt den `parent`-
 * Parameter mit unserem Hostnamen. Bei YouTube der offizielle Embed, aber nur
 * fuer ein laufendes Video.
 *
 * Gibt es keinen zulaessigen Weg, steht hier **kein** `<iframe>`, sondern das
 * Vorschaubild mit einem Link. Ein Rahmen auf eine Adresse, die die Plattform
 * nicht dafuer vorsieht, ist fremder Code auf unserer Seite - und genau das
 * schliesst die Aufgabenstellung aus.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const eintrag = await streamer.ladeOeffentlichenStreamer(slug);
  if (!eintrag) {
    return { title: `Streamer · ${branding.name}` };
  }
  return {
    title: `${eintrag.name} · ${branding.name} Streamer`,
    description:
      eintrag.beschreibung ??
      `${eintrag.name} streamt aus der ${branding.name}-Community${
        eintrag.spiele.length > 0 ? `: ${eintrag.spiele.map((spiel) => spiel.name).join(', ')}` : ''
      }.`,
  };
}

export default async function StreamerProfilSeite({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  // Derselbe Schalter wie auf der Uebersicht - und an derselben Stelle geprueft.
  if (!(await streamer.oeffentlichErlaubt())) {
    notFound();
  }
  const { slug } = await params;
  const eintrag = await streamer.ladeOeffentlichenStreamer(slug);
  /*
   * Dieselbe Antwort fuer «gibt es nicht», «nicht freigegeben» und «pausiert».
   * Ein Besucher soll nicht unterscheiden koennen, ob eine Adresse frei ist
   * oder ob dahinter eine abgelehnte Bewerbung steht.
   */
  if (!eintrag) {
    notFound();
  }

  const live = eintrag.live;
  const host = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').host;
  const embed = live
    ? embedAdresse(live.plattform, hauptHandle(eintrag, live.plattform), live.sessionId, host)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <Link
        href="/streamer"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Alle Streamer
      </Link>

      {/* --- Kopf mit Banner --- */}
      <header className="relative overflow-hidden rounded-3xl border border-border">
        <div className="absolute inset-0" style={{ backgroundImage: eintrag.bannerVerlauf }} />
        {eintrag.bannerBild ? (
          // Eigene Route mit veränderlichem Dateinamen; `next/image` bräuchte
          // dafür eine Konfiguration, die nichts verbessert.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={eintrag.bannerBild} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />

        <div className="relative flex flex-col gap-4 p-6 pt-24 sm:flex-row sm:items-end sm:p-8 sm:pt-32">
          <span className="shrink-0 overflow-hidden rounded-2xl border-2 border-primary bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- Discord-CDN */}
            <img
              src={getDiscordAvatarUrl(eintrag.discordId, eintrag.avatarHash, 256)}
              alt=""
              width={96}
              height={96}
              className="size-24 object-cover"
            />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{eintrag.name}</h1>
              {live ? (
                <span className="flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wider text-primary-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />
                  Live
                </span>
              ) : null}
            </span>
            {eintrag.beschreibung ? (
              <p className="max-w-2xl text-sm text-muted-foreground">{eintrag.beschreibung}</p>
            ) : null}
            <span className="flex flex-wrap gap-1.5">
              {eintrag.sprachen.map((sprache) => (
                <Badge key={sprache} variant="secondary" className="font-normal">
                  {spracheLabel(sprache)}
                </Badge>
              ))}
            </span>
          </div>

          <Link
            href={systemRoutes.oeffentlichesProfil(eintrag.slug)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
          >
            {branding.name}-Profil
          </Link>
        </div>
      </header>

      {/* --- Der laufende Stream --- */}
      {live ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Läuft gerade</h2>
          <div className="overflow-hidden rounded-2xl border border-primary/40 bg-card">
            {embed ? (
              <div className="aspect-video w-full bg-black">
                {/*
                  Der offizielle Player der Plattform. `allow` bewusst knapp:
                  Vollbild ja, Kamera und Mikrofon nein - ein eingebetteter
                  Player braucht sie nicht, und was nicht erlaubt ist, kann
                  nicht gefragt werden.
                */}
                <iframe
                  src={embed}
                  title={live.titel ?? `Stream von ${eintrag.name}`}
                  className="size-full"
                  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : live.vorschaubildUrl ? (
              <a href={live.streamUrl} target="_blank" rel="noopener noreferrer" className="group block">
                <span className="relative block aspect-video w-full overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- fremde CDN */}
                  <img
                    src={live.vorschaubildUrl}
                    alt=""
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-background/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className={cn(buttonVariants())}>
                      Auf {PLATTFORMEN[live.plattform].label} ansehen
                    </span>
                  </span>
                </span>
              </a>
            ) : null}

            <div className="flex flex-col gap-3 p-5">
              {live.titel ? <p className="font-medium">{live.titel}</p> : null}
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {live.spiel ? <Badge variant="default">{live.spiel}</Badge> : null}
                <span className="flex items-center gap-1.5">
                  <Radio className="size-4" aria-hidden="true" />
                  {PLATTFORMEN[live.plattform].label}
                </span>
                {/* Die Zuschauerzahl nur, wenn die Plattform sie geliefert hat. */}
                {live.zuschauer !== null ? (
                  <span className="flex items-center gap-1.5">
                    <Users className="size-4" aria-hidden="true" />
                    {live.zuschauer.toLocaleString('de-CH')} Zuschauer
                  </span>
                ) : null}
                <span>seit {formatDateTime(live.gestartetAm)}</span>
              </div>
              <a
                href={live.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants(), 'w-fit gap-2')}
              >
                Auf {PLATTFORMEN[live.plattform].label} anschauen
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* --- Kanäle --- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Kanäle</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {eintrag.kanaele.map((kanal) => (
            <a
              key={kanal.plattform}
              href={kanal.adresse}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {PLATTFORMEN[kanal.plattform].label}
                </span>
                <span className="truncate font-medium">{kanal.anzeigename ?? kanal.handle}</span>
              </span>
              <ExternalLink
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden="true"
              />
            </a>
          ))}
        </div>
      </section>

      {/* --- Spiele --- */}
      {eintrag.spiele.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Spielt am liebsten</h2>
          <div className="flex flex-wrap gap-2">
            {eintrag.spiele.map((spiel) => (
              <Badge key={spiel.id} variant="outline" className="px-3 py-1 text-sm font-normal">
                {spiel.name}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {/*
        Der letzte beobachtete Stream - und nur, wenn wir ihn beobachtet haben.
        Fuer die Zeit vor der Einrichtung dieses Moduls gibt es keine Angabe,
        und dann steht hier nichts. Eine geratene waere eine erfundene.
      */}
      {!live && eintrag.letzterStreamAm ? (
        <p className="text-sm text-muted-foreground">
          Zuletzt live gesehen: {formatDateTime(eintrag.letzterStreamAm)}
        </p>
      ) : null}
    </div>
  );
}

/** Der Handle des Kanals auf der Plattform, auf der gerade gestreamt wird. */
function hauptHandle(
  eintrag: { kanaele: Array<{ plattform: string; handle: string }> },
  plattform: string,
): string {
  return eintrag.kanaele.find((kanal) => kanal.plattform === plattform)?.handle ?? '';
}
