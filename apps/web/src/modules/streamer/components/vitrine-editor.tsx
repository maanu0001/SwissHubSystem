'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Clapperboard, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  entferneVitrineClipAction,
  setzeVitrineCaptionAction,
  setzeVitrineClipAction,
} from '@/modules/streamer/actions';

/**
 * Die eigene Vitrine bearbeiten.
 *
 * ## Wozu
 *
 * Ein Kanal ist die meiste Zeit offline. Wer einem geteilten Profil-Link folgt,
 * sieht dann «derzeit nicht live» - und weiss danach genau so viel wie vorher.
 * Drei Clips und ein Satz sind das, was in dieser Zeit für den Kanal spricht.
 *
 * ## Warum drei Plätze und kein Hinzufügen
 *
 * Weil drei Plätze eine Entscheidung sind und eine Liste keine. Jeder Platz
 * hat sein eigenes Feld; ihn neu zu füllen ersetzt, was dort stand. Eine Liste
 * mit «Hinzufügen» und «Verschieben» bewegt sich unter dem Finger und braucht
 * eine Reihenfolge, die jemand pflegen muss.
 *
 * ## Was hier nicht geprüft wird
 *
 * Fast alles. Ob eine Adresse zu einem Clip gehört, entscheidet `erkenneClip`
 * auf dem Server - dieselbe Funktion und dieselbe Hostliste wie bei Clip of the
 * Week. Diese Datei schickt den Text ab und zeigt, was zurückkommt: eine
 * Meldung, die weiterhilft, statt eines roten Rahmens ohne Grund.
 */

export interface VitrinePlatz {
  position: number;
  provider: string;
  canonicalUrl: string;
  titel: string | null;
}

export function VitrineEditor({
  csrfToken,
  plaetze,
  belegt,
  caption,
  maxCaptionLaenge,
}: {
  csrfToken: string;
  /** Wie viele Plätze es gibt - die Zahl kommt aus dem Modul, nicht von hier. */
  plaetze: number;
  belegt: VitrinePlatz[];
  caption: string;
  maxCaptionLaenge: number;
}): React.JSX.Element {
  const [laeuft, starte] = useTransition();
  const [zeile, setZeile] = useState(caption);

  const nachPosition = new Map(belegt.map((platz) => [platz.position, platz]));

  const befehl = (arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>, gut: string): void => {
    starte(async () => {
      const antwort = await arbeit();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(gut);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clapperboard className="size-5" aria-hidden="true" />
          Vitrine
        </CardTitle>
        <CardDescription>
          Bis zu {plaetze} eigene Clips und eine hervorgehobene Zeile auf deinem öffentlichen Profil. Sie
          stehen auch dort, wenn du gerade nicht streamst - und das ist die meiste Zeit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Die hervorgehobene Zeile. */}
        <form
          className="space-y-2"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            befehl(
              () => setzeVitrineCaptionAction({ csrfToken, text: zeile }),
              zeile.trim().length === 0 ? 'Die Zeile ist entfernt.' : 'Die Zeile steht.',
            );
          }}
        >
          <Label htmlFor="vitrine-caption">Hervorgehobene Zeile</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="vitrine-caption"
              value={zeile}
              onChange={(ereignis) => setZeile(ereignis.target.value)}
              placeholder="Jeden Dienstag 20:00, Valheim mit der Crew"
              maxLength={maxCaptionLaenge}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline" disabled={laeuft}>
              {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Speichern
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Klartext, höchstens {maxCaptionLaenge} Zeichen. Emoji gehen, Links und Sternchen nicht - deinen
            Kanal trägst du oben als Kanal ein. Leer lassen entfernt die Zeile.
          </p>
        </form>

        {/* Die Plätze. */}
        <div className="space-y-4">
          {Array.from({ length: plaetze }, (_, position) => (
            <VitrinePlatzFeld
              key={position}
              csrfToken={csrfToken}
              position={position}
              vorhanden={nachPosition.get(position) ?? null}
              laeuft={laeuft}
              befehl={befehl}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Ein einzelner Platz.
 *
 * Belegt: die Adresse steht da, daneben ein Knopf zum Räumen. Frei: ein Feld
 * zum Einfügen. Nicht beides gleichzeitig - ein Feld mit einer Adresse darin,
 * die man überschreiben kann, und einem Knopf daneben, der etwas anderes tut,
 * ist eine Gelegenheit zum Vertippen.
 */
function VitrinePlatzFeld({
  csrfToken,
  position,
  vorhanden,
  laeuft,
  befehl,
}: {
  csrfToken: string;
  position: number;
  vorhanden: VitrinePlatz | null;
  laeuft: boolean;
  befehl: (arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>, gut: string) => void;
}): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [titel, setTitel] = useState('');

  if (vorhanden) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{vorhanden.titel ?? vorhanden.provider}</p>
          <p className="truncate text-xs text-muted-foreground">{vorhanden.canonicalUrl}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={laeuft}
          onClick={() =>
            befehl(() => entferneVitrineClipAction({ csrfToken, position }), 'Der Platz ist frei.')
          }
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Entfernen
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2 rounded-lg border border-dashed border-border px-3 py-3"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        befehl(
          () =>
            setzeVitrineClipAction({
              csrfToken,
              position,
              url,
              ...(titel.trim() ? { titel: titel.trim() } : {}),
            }),
          'Der Clip steht in deiner Vitrine.',
        );
        setUrl('');
        setTitel('');
      }}
    >
      <Label htmlFor={`vitrine-url-${position}`}>Platz {position + 1}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`vitrine-url-${position}`}
          value={url}
          onChange={(ereignis) => setUrl(ereignis.target.value)}
          placeholder="Link zum Clip bei Twitch, YouTube oder Medal"
          className="min-w-0 flex-1"
        />
        <Input
          value={titel}
          onChange={(ereignis) => setTitel(ereignis.target.value)}
          placeholder="Titel (optional)"
          maxLength={70}
          className="w-full sm:w-48"
        />
        <Button type="submit" variant="outline" disabled={laeuft || url.trim().length === 0}>
          Einfügen
        </Button>
      </div>
    </form>
  );
}
