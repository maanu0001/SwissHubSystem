'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, Check, ShieldQuestion, X } from 'lucide-react';
import { getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { bestaetigeVonHandAction, genehmigeAction, lehneAbAction } from '@/modules/streamer/actions';
import { spracheLabel } from './sprache';

/**
 * Die offenen Bewerbungen.
 *
 * ## Warum die Verifikation so prominent steht
 *
 * Weil sie die Frage beantwortet, die ein Moderator hier zu entscheiden hat:
 * gehoert dieser Kanal der Person? «Von Twitch bestaetigt» heisst, dass die
 * Plattform es gesagt hat - dann ist die Entscheidung einfach. «Nicht
 * bestaetigt» heisst, dass jemand hinsehen muss, und dafuer stehen die
 * Kanaladressen als Links daneben.
 *
 * Beides gleich darzustellen waere die bequemere Loesung und die, die
 * irgendwann einen fremden Kanal freigibt.
 *
 * ## Warum eine Ablehnung einen Grund verlangt
 *
 * Weil die Person ihn liest. Eine Ablehnung ohne Begruendung ist keine
 * Auskunft, und die naechste Bewerbung derselben Person hat denselben Fehler.
 */

export interface BewerbungsZeile {
  id: string;
  discordId: string;
  anzeigename: string;
  avatarHash: string | null;
  slug: string | null;
  beschreibung: string | null;
  sprachen: string[];
  eingereichtAm: string | null;
  kanaele: Array<{
    id: string;
    plattform: 'TWITCH' | 'YOUTUBE';
    handle: string;
    anzeigename: string | null;
    adresse: string;
    verifikation: 'KEINE' | 'OAUTH' | 'MANUELL';
  }>;
}

export function BewerbungsListe({
  csrfToken,
  zeilen,
}: {
  csrfToken: string;
  zeilen: BewerbungsZeile[];
}): React.JSX.Element {
  if (zeilen.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Keine offenen Bewerbungen.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {zeilen.map((zeile) => (
        <BewerbungsKarte key={zeile.id} csrfToken={csrfToken} zeile={zeile} />
      ))}
    </div>
  );
}

function BewerbungsKarte({
  csrfToken,
  zeile,
}: {
  csrfToken: string;
  zeile: BewerbungsZeile;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [grund, setGrund] = useState('');
  const [ablehnenOffen, setAblehnen] = useState(false);

  const alleBestaetigt = zeile.kanaele.every((kanal) => kanal.verifikation !== 'KEINE');

  return (
    <Card className={alleBestaetigt ? undefined : 'border-warning/40'}>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- Discord-CDN */}
          <img
            src={getDiscordAvatarUrl(zeile.discordId, zeile.avatarHash, 128)}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-xl object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{zeile.anzeigename}</span>
              {zeile.eingereichtAm ? (
                <span className="text-xs text-muted-foreground">eingereicht {zeile.eingereichtAm}</span>
              ) : null}
            </span>
            {zeile.beschreibung ? (
              <p className="text-sm text-muted-foreground">{zeile.beschreibung}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">Keine Beschreibung angegeben.</p>
            )}
            <span className="flex flex-wrap gap-1.5 pt-1">
              {zeile.sprachen.map((sprache) => (
                <Badge key={sprache} variant="secondary" className="font-normal">
                  {spracheLabel(sprache)}
                </Badge>
              ))}
            </span>
          </div>
        </div>

        {/* --- Die Kanäle, und woher wir wissen, wem sie gehören --- */}
        <div className="flex flex-col gap-2">
          {zeile.kanaele.map((kanal) => (
            <div
              key={kanal.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {PLATTFORMEN[kanal.plattform].label}
                </span>
                <a
                  href={kanal.adresse}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {kanal.anzeigename ?? kanal.handle}
                </a>
              </span>

              {kanal.verifikation === 'OAUTH' ? (
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  Von {PLATTFORMEN[kanal.plattform].label} bestätigt
                </Badge>
              ) : kanal.verifikation === 'MANUELL' ? (
                <Badge variant="outline" className="gap-1">
                  <ShieldQuestion className="size-3" aria-hidden="true" />
                  Vom Team freigegeben
                </Badge>
              ) : (
                <span className="flex items-center gap-2">
                  <Badge variant="warning">Nicht bestätigt</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={laeuft}
                    onClick={() =>
                      starte(async () => {
                        const antwort = await bestaetigeVonHandAction({ csrfToken, kanalId: kanal.id });
                        if (!antwort.ok) {
                          toast.error(antwort.error.message);
                          return;
                        }
                        toast[antwort.data.geaendert ? 'success' : 'info'](
                          antwort.data.geaendert
                            ? 'Kanal von Hand bestätigt.'
                            : (antwort.data.grund ?? 'Nichts geändert.'),
                        );
                        router.refresh();
                      })
                    }
                  >
                    Von Hand bestätigen
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>

        {!alleBestaetigt ? (
          <p className="text-xs text-warning">
            Mindestens ein Kanal ist nicht über die Plattform bestätigt. Sieh dir den Kanal an, bevor du
            freigibst - eine Freigabe bedeutet Live-Ankündigungen an alle im Kanal.
          </p>
        ) : null}

        {/* --- Entscheiden --- */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button
            size="sm"
            disabled={laeuft}
            onClick={() =>
              starte(async () => {
                const antwort = await genehmigeAction({ csrfToken, profilId: zeile.id });
                if (!antwort.ok) {
                  toast.error(antwort.error.message);
                  return;
                }
                toast[antwort.data.geaendert ? 'success' : 'info'](
                  antwort.data.geaendert ? 'Freigegeben.' : (antwort.data.grund ?? 'Nichts geändert.'),
                );
                router.refresh();
              })
            }
          >
            <Check className="size-4" aria-hidden="true" />
            Freigeben
          </Button>

          {ablehnenOffen ? (
            <span className="flex min-w-64 flex-1 items-center gap-2">
              <Input
                value={grund}
                onChange={(ereignis) => setGrund(ereignis.target.value)}
                placeholder="Grund - die Person liest ihn"
                maxLength={500}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={laeuft || grund.trim().length < 5}
                onClick={() =>
                  starte(async () => {
                    const antwort = await lehneAbAction({ csrfToken, profilId: zeile.id, grund });
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    toast[antwort.data.geaendert ? 'success' : 'info'](
                      antwort.data.geaendert ? 'Abgelehnt.' : (antwort.data.grund ?? 'Nichts geändert.'),
                    );
                    setAblehnen(false);
                    setGrund('');
                    router.refresh();
                  })
                }
              >
                Ablehnen
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAblehnen(false)}>
                Abbrechen
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAblehnen(true)} disabled={laeuft}>
              <X className="size-4" aria-hidden="true" />
              Ablehnen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
