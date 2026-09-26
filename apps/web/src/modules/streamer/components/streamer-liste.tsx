'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, Megaphone, MegaphoneOff, Pause, Play, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  entferneKanalAction,
  erstelleSpotlightAction,
  pausiereAction,
  schalteFreiAction,
  setzeAnkuendigungAction,
} from '@/modules/streamer/actions';

/**
 * Die freigegebenen Streamer - verwalten.
 *
 * ## Warum das Entfernen eines Kanals eine Rueckfrage bekommt
 *
 * Weil es mehr entfernt als den Kanal: die beobachteten Sessions und ihre
 * Ankuendigungen gehen mit. Das ist gewollt - sie haengen an einem Kanal, den
 * es nicht mehr gibt -, aber es ist nicht rueckgaengig zu machen, und ein Klick
 * daneben kostet die ganze beobachtete Geschichte eines Streamers.
 */

export interface StreamerListenZeile {
  id: string;
  discordId: string;
  anzeigename: string;
  avatarHash: string | null;
  slug: string | null;
  status: 'APPROVED' | 'SUSPENDED';
  ankuendigungAktiv: boolean;
  liveSeit: string | null;
  pausierungsGrund: string | null;
  kanaele: Array<{
    plattform: 'TWITCH' | 'YOUTUBE';
    handle: string;
    adresse: string;
    verifikation: 'KEINE' | 'OAUTH' | 'MANUELL';
    letzterFehler: string | null;
  }>;
}

export function StreamerListe({
  csrfToken,
  zeilen,
  darfVerwalten,
  darfSpotlight,
}: {
  csrfToken: string;
  zeilen: StreamerListenZeile[];
  darfVerwalten: boolean;
  darfSpotlight: boolean;
}): React.JSX.Element {
  if (zeilen.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Noch kein Streamer freigegeben.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {zeilen.map((zeile) => (
        <StreamerZeile
          key={zeile.id}
          csrfToken={csrfToken}
          zeile={zeile}
          darfVerwalten={darfVerwalten}
          darfSpotlight={darfSpotlight}
        />
      ))}
    </div>
  );
}

function StreamerZeile({
  csrfToken,
  zeile,
  darfVerwalten,
  darfSpotlight,
}: {
  csrfToken: string;
  zeile: StreamerListenZeile;
  darfVerwalten: boolean;
  darfSpotlight: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [kanalZumEntfernen, setKanalZumEntfernen] = useState<'TWITCH' | 'YOUTUBE' | null>(null);

  const melde = (ergebnis: { geaendert: boolean; grund?: string }, erfolg: string): void => {
    toast[ergebnis.geaendert ? 'success' : 'info'](
      ergebnis.geaendert ? erfolg : (ergebnis.grund ?? 'Nichts geändert.'),
    );
    router.refresh();
  };

  return (
    <Card className={zeile.status === 'SUSPENDED' ? 'border-destructive/30' : undefined}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- Discord-CDN */}
          <img
            src={getDiscordAvatarUrl(zeile.discordId, zeile.avatarHash, 128)}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-xl object-cover"
          />

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{zeile.anzeigename}</span>
              {zeile.liveSeit ? (
                <Badge variant="default" className="gap-1">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />
                  Live seit {zeile.liveSeit}
                </Badge>
              ) : null}
              {zeile.status === 'SUSPENDED' ? <Badge variant="destructive">Pausiert</Badge> : null}
              {!zeile.ankuendigungAktiv ? (
                <Badge variant="outline" className="gap-1">
                  <MegaphoneOff className="size-3" aria-hidden="true" />
                  Keine Ankündigungen
                </Badge>
              ) : null}
            </span>

            <span className="flex flex-wrap items-center gap-2 text-sm">
              {zeile.kanaele.map((kanal) => (
                <span key={kanal.plattform} className="flex items-center gap-1.5">
                  <a
                    href={kanal.adresse}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {PLATTFORMEN[kanal.plattform].label}: {kanal.handle}
                  </a>
                  {kanal.verifikation === 'OAUTH' ? (
                    <BadgeCheck className="size-3.5 text-success" aria-label="Von der Plattform bestätigt" />
                  ) : kanal.verifikation === 'MANUELL' ? (
                    <span className="text-[0.65rem] uppercase text-muted-foreground">Team</span>
                  ) : (
                    <Badge variant="warning" className="px-1.5 py-0 text-[0.65rem]">
                      offen
                    </Badge>
                  )}
                  {darfVerwalten ? (
                    <button
                      type="button"
                      onClick={() => setKanalZumEntfernen(kanal.plattform)}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      aria-label={`${PLATTFORMEN[kanal.plattform].label}-Kanal entfernen`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
            </span>

            {/*
              Der letzte Fehler der Plattformabfrage. Er steht hier, weil er die
              Frage beantwortet, die sonst niemand beantworten kann: warum sieht
              dieser Streamer seit Stunden offline aus?
            */}
            {zeile.kanaele
              .filter((kanal) => kanal.letzterFehler)
              .map((kanal) => (
                <p key={`fehler-${kanal.plattform}`} className="text-xs text-warning">
                  {PLATTFORMEN[kanal.plattform].label}: {kanal.letzterFehler}
                </p>
              ))}

            {zeile.pausierungsGrund ? (
              <p className="text-xs text-muted-foreground">Pausiert: {zeile.pausierungsGrund}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {zeile.slug ? (
              <Link
                href={systemRoutes.streamerOeffentlichProfil(zeile.slug)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Öffentliche Seite
              </Link>
            ) : (
              <span className="text-xs text-warning">
                Kein öffentliches Profil - erscheint nicht in der Übersicht
              </span>
            )}

            {darfSpotlight && zeile.status === 'APPROVED' && zeile.slug ? (
              <Button
                size="sm"
                variant="outline"
                disabled={laeuft}
                onClick={() =>
                  starte(async () => {
                    const antwort = await erstelleSpotlightAction({ csrfToken, profilId: zeile.id });
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    toast.success('Spotlight-Entwurf angelegt.');
                    router.push(systemRoutes.streamerHubSpotlight(antwort.data.spotlightId));
                  })
                }
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Spotlight
              </Button>
            ) : null}

            {darfVerwalten ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={laeuft}
                  onClick={() =>
                    starte(async () => {
                      const antwort = await setzeAnkuendigungAction({
                        csrfToken,
                        profilId: zeile.id,
                        aktiv: !zeile.ankuendigungAktiv,
                      });
                      if (!antwort.ok) {
                        toast.error(antwort.error.message);
                        return;
                      }
                      melde(
                        antwort.data,
                        zeile.ankuendigungAktiv ? 'Ankündigungen aus.' : 'Ankündigungen an.',
                      );
                    })
                  }
                >
                  {zeile.ankuendigungAktiv ? (
                    <MegaphoneOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Megaphone className="size-4" aria-hidden="true" />
                  )}
                </Button>

                {zeile.status === 'APPROVED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={laeuft}
                    onClick={() =>
                      starte(async () => {
                        const antwort = await pausiereAction({ csrfToken, profilId: zeile.id, grund: '' });
                        if (!antwort.ok) {
                          toast.error(antwort.error.message);
                          return;
                        }
                        melde(antwort.data, 'Pausiert.');
                      })
                    }
                  >
                    <Pause className="size-4" aria-hidden="true" />
                    Pausieren
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={laeuft}
                    onClick={() =>
                      starte(async () => {
                        const antwort = await schalteFreiAction({ csrfToken, profilId: zeile.id });
                        if (!antwort.ok) {
                          toast.error(antwort.error.message);
                          return;
                        }
                        melde(antwort.data, 'Wieder freigeschaltet.');
                      })
                    }
                  >
                    <Play className="size-4" aria-hidden="true" />
                    Freischalten
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>
      </CardContent>

      <ConfirmationDialog
        open={kanalZumEntfernen !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setKanalZumEntfernen(null);
          }
        }}
        title="Kanalverbindung entfernen?"
        description={`Der ${kanalZumEntfernen ? PLATTFORMEN[kanalZumEntfernen].label : ''}-Kanal von ${zeile.anzeigename} wird entfernt. Damit endet die Live-Erkennung für diesen Kanal, seine beobachteten Streams und die dazugehörigen Ankündigungen verschwinden, und eine noch nicht gesendete Ankündigung wird ungültig. Das lässt sich nicht zurücknehmen.`}
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!kanalZumEntfernen) {
            return;
          }
          const antwort = await entferneKanalAction({
            csrfToken,
            profilId: zeile.id,
            plattform: kanalZumEntfernen,
          });
          setKanalZumEntfernen(null);
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          melde(antwort.data, 'Kanalverbindung entfernt.');
        }}
      />
    </Card>
  );
}
