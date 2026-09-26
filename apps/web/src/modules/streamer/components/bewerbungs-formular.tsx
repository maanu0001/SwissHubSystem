'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, CircleAlert, Radio, Send, ShieldQuestion } from 'lucide-react';
import {
  PLATTFORMEN,
  STREAMER_SPRACHEN,
  erkenneKanal,
  KanalEingabeFehler,
} from '@swisshub/modules/streamer/typen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { reicheEinAction, speichereBewerbungAction } from '@/modules/streamer/actions';

/**
 * Das Bewerbungsformular - «Streamer werden».
 *
 * ## Warum die Kanalpruefung hier schon laeuft
 *
 * `erkenneKanal` kommt aus `@swisshub/modules/streamer/typen` - derselben
 * Datei, die der Server benutzt. Eine Adresse, die hier durchgeht, geht dort
 * durch; eine, die hier auffaellt, faellt dort auf. Zwei Regeln waeren die
 * Stelle, an der ein Formular etwas annimmt, das der Server ablehnt - und das
 * sieht immer nach einem Fehler im Formular aus.
 *
 * Das ist **keine** Sicherheitspruefung. Der Server prueft erneut und schlaegt
 * den Kanal zusaetzlich bei der Plattform nach. Hier geht es nur darum, dass
 * jemand seinen Tippfehler sofort sieht.
 *
 * ## Warum die beiden Verifikationswege verschieden aussehen
 *
 * Weil sie verschieden sind. «Von Twitch bestaetigt» heisst, dass Twitch uns
 * gesagt hat, wem das Konto gehoert. «Vom Team freigegeben» heisst, dass ein
 * Mensch hingesehen hat. Beides gleich darzustellen waere die bequemere und
 * unehrlichere Loesung.
 */

interface KanalStand {
  plattform: 'TWITCH' | 'YOUTUBE';
  handle: string;
  verifikation: 'KEINE' | 'OAUTH' | 'MANUELL';
}

export function BewerbungsFormular({
  csrfToken,
  status,
  beschreibung,
  sprachen,
  ankuendigungAktiv,
  kanaele,
  ablehnungsGrund,
  twitchEingerichtet,
}: {
  csrfToken: string;
  status: 'KEINE' | 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  beschreibung: string;
  sprachen: string[];
  ankuendigungAktiv: boolean;
  kanaele: KanalStand[];
  ablehnungsGrund: string | null;
  /** Ohne Twitch-Zugangsdaten gibt es den OAuth-Weg nicht - dann sagt die Seite das. */
  twitchEingerichtet: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  const [text, setText] = useState(beschreibung);
  const [gewaehlteSprachen, setSprachen] = useState<string[]>(sprachen);
  const [ankuendigen, setAnkuendigen] = useState(ankuendigungAktiv);
  const [twitch, setTwitch] = useState(kanaele.find((k) => k.plattform === 'TWITCH')?.handle ?? '');
  const [youtube, setYoutube] = useState(kanaele.find((k) => k.plattform === 'YOUTUBE')?.handle ?? '');

  /** Sofortige Rueckmeldung zur Form einer Eingabe - nicht zur Existenz des Kanals. */
  const formFehler = (plattform: 'TWITCH' | 'YOUTUBE', wert: string): string | null => {
    if (wert.trim() === '') {
      return null;
    }
    try {
      erkenneKanal(plattform, wert);
      return null;
    } catch (fehler) {
      return fehler instanceof KanalEingabeFehler ? fehler.message : 'Diese Eingabe passt nicht.';
    }
  };

  const twitchFehler = formFehler('TWITCH', twitch);
  const youtubeFehler = formFehler('YOUTUBE', youtube);
  const inPruefung = status === 'PENDING';
  const pausiert = status === 'SUSPENDED';
  const gesperrt = inPruefung || pausiert;

  const speichern = (): void => {
    starte(async () => {
      const antwort = await speichereBewerbungAction({
        csrfToken,
        beschreibung: text,
        sprachen: gewaehlteSprachen,
        spiele: [],
        twitch,
        youtube,
        ankuendigungAktiv: ankuendigen,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      if (antwort.data.vergeben.length > 0) {
        /*
         * Bewusst ohne zu sagen, **wem** der Kanal gehoert. Sonst waere dieses
         * Formular ein Werkzeug, um herauszufinden, welche Mitglieder welche
         * Kanaele haben.
         */
        toast.error(
          `Dieser Kanal ist schon vergeben: ${antwort.data.vergeben
            .map((eintrag) => PLATTFORMEN[eintrag].label)
            .join(', ')}. Wenn er dir gehört, melde dich beim Team.`,
        );
      } else {
        toast.success('Gespeichert.');
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {status === 'REJECTED' && ablehnungsGrund ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <CircleAlert className="size-4" aria-hidden="true" />
              Deine Bewerbung wurde abgelehnt
            </CardTitle>
            {/*
              Der Grund steht hier - die Person selbst sieht ihn. Auf der
              oeffentlichen Seite steht er nie.
            */}
            <CardDescription>{ablehnungsGrund}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Du kannst deine Angaben anpassen und die Bewerbung erneut einreichen.
          </CardContent>
        </Card>
      ) : null}

      {inPruefung ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="text-warning">Deine Bewerbung ist in Prüfung</CardTitle>
            <CardDescription>
              Solange das Team entscheidet, sind keine Änderungen möglich - sonst entscheidet jemand über
              einen Text, der beim Klick schon ein anderer ist.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {pausiert ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Dein Streamer-Profil ist pausiert</CardTitle>
            <CardDescription>Wende dich an das Team, wenn du das klären möchtest.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Deine Kanäle</CardTitle>
          <CardDescription>
            Mindestens einer. Die Adresse oder nur der Name - beides geht. Was gespeichert wird, ist die
            unveränderliche Kennung der Plattform, damit eine Umbenennung deinen Eintrag nicht kaputt macht.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {(
            [
              { id: 'TWITCH' as const, wert: twitch, setzen: setTwitch, fehler: twitchFehler },
              { id: 'YOUTUBE' as const, wert: youtube, setzen: setYoutube, fehler: youtubeFehler },
            ] satisfies Array<{
              id: 'TWITCH' | 'YOUTUBE';
              wert: string;
              setzen: (wert: string) => void;
              fehler: string | null;
            }>
          ).map(({ id, wert, setzen, fehler }) => {
            const vorhanden = kanaele.find((kanal) => kanal.plattform === id);
            return (
              <div key={id} className="flex flex-col gap-2">
                <Label htmlFor={`kanal-${id}`} className="flex items-center gap-2">
                  <Radio className="size-4 text-primary" aria-hidden="true" />
                  {PLATTFORMEN[id].label}
                  {vorhanden?.verifikation === 'OAUTH' ? (
                    <Badge variant="success" className="gap-1">
                      <BadgeCheck className="size-3" aria-hidden="true" />
                      Von {PLATTFORMEN[id].label} bestätigt
                    </Badge>
                  ) : vorhanden?.verifikation === 'MANUELL' ? (
                    <Badge variant="outline" className="gap-1">
                      <ShieldQuestion className="size-3" aria-hidden="true" />
                      Vom Team freigegeben
                    </Badge>
                  ) : null}
                </Label>
                <Input
                  id={`kanal-${id}`}
                  value={wert}
                  onChange={(ereignis) => setzen(ereignis.target.value)}
                  placeholder={PLATTFORMEN[id].beispiel}
                  disabled={gesperrt}
                  aria-invalid={fehler !== null}
                />
                {fehler ? <p className="text-xs text-destructive">{fehler}</p> : null}

                {/*
                  Der Nachweis der Inhaberschaft. Nur bei Twitch, und nur wenn
                  Zugangsdaten hinterlegt sind - ein Knopf, der zu einer
                  Fehlerseite fuehrt, ist schlechter als ein Hinweis.
                */}
                {id === 'TWITCH' && vorhanden && vorhanden.verifikation !== 'OAUTH' ? (
                  twitchEingerichtet ? (
                    <a
                      href="/api/streamer/twitch/start"
                      className="w-fit text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Mit Twitch anmelden und Kanal bestätigen
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Die Twitch-Bestätigung ist auf diesem Server noch nicht eingerichtet. Das Team gibt
                      deinen Kanal von Hand frei.
                    </p>
                  )
                ) : null}
                {id === 'YOUTUBE' && wert.trim() !== '' ? (
                  <p className="text-xs text-muted-foreground">
                    Für YouTube gibt es in dieser Fassung keine automatische Bestätigung - das Team sieht sich
                    den Kanal an und gibt ihn frei.
                  </p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Über deinen Kanal</CardTitle>
          <CardDescription>
            Ein paar Sätze. Leer lassen ist auch in Ordnung - dann nimmt die öffentliche Seite die Bio aus
            deinem Profil.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="beschreibung">Beschreibung</Label>
            <textarea
              id="beschreibung"
              value={text}
              onChange={(ereignis) => setText(ereignis.target.value)}
              maxLength={600}
              rows={4}
              disabled={gesperrt}
              className="rounded-md border border-border bg-background p-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">{text.length} / 600</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Streaming-Sprachen</Label>
            <p className="text-xs text-muted-foreground">
              Mindestens eine. Besucher filtern danach - ohne Angabe wärst du in jedem Sprachfilter
              unsichtbar.
            </p>
            <div className="flex flex-wrap gap-2">
              {STREAMER_SPRACHEN.map((sprache) => {
                const gewaehlt = gewaehlteSprachen.includes(sprache.key);
                return (
                  <button
                    key={sprache.key}
                    type="button"
                    disabled={gesperrt}
                    onClick={() =>
                      setSprachen((bisher) =>
                        gewaehlt
                          ? bisher.filter((eintrag) => eintrag !== sprache.key)
                          : bisher.length >= 5
                            ? bisher
                            : [...bisher, sprache.key],
                      )
                    }
                    className={
                      gewaehlt
                        ? 'rounded-full border border-primary/50 bg-primary/15 px-3 py-1 text-xs font-medium text-foreground'
                        : 'rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40'
                    }
                  >
                    {sprache.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={ankuendigen}
              disabled={gesperrt}
              onChange={(ereignis) => setAnkuendigen(ereignis.target.checked)}
              className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
            />
            <span className="text-sm">
              <span className="font-medium">Auf Discord ankündigen, wenn ich live gehe</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Höchstens eine Nachricht pro Stream. Du kannst das jederzeit hier abschalten.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={speichern} disabled={laeuft || gesperrt}>
          Speichern
        </Button>
        {(status === 'DRAFT' || status === 'KEINE' || status === 'REJECTED') && kanaele.length > 0 ? (
          <Button
            variant="outline"
            disabled={laeuft || gewaehlteSprachen.length === 0}
            onClick={() =>
              starte(async () => {
                const antwort = await reicheEinAction({ csrfToken });
                if (!antwort.ok) {
                  toast.error(antwort.error.message);
                  return;
                }
                toast.success(
                  antwort.data.eingereicht
                    ? 'Eingereicht - das Team sieht sich deine Bewerbung an.'
                    : 'Die Bewerbung war schon eingereicht.',
                );
                router.refresh();
              })
            }
          >
            <Send className="size-4" aria-hidden="true" />
            Bewerbung einreichen
          </Button>
        ) : null}
      </div>
    </div>
  );
}
