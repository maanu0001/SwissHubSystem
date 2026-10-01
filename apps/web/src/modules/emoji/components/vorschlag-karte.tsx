'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, Users, X } from 'lucide-react';
import type { emoji as emojiModul } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { lehneEmojiAntragAbAction, nimmEmojiAntragAnAction, starteEmojiAbstimmungAction } from '../actions';

/**
 * Ein Vorschlag mit seinen drei Ausgängen.
 *
 * ## Warum «Abstimmen lassen» neben «Annehmen» steht
 *
 * Weil es eine andere Entscheidung ist: nicht «ja» oder «nein», sondern «nicht
 * wir». Ein Vorschlag, bei dem das Team sich nicht einig ist, hat damit einen
 * Weg, der kein Veto ist.
 *
 * Der Knopf fehlt, wenn die Abstimmung ausgeschaltet ist - ein Knopf, der eine
 * Einstellung verlangt, ist eine Fehlermeldung mit Vorlaufzeit.
 *
 * ## Das Vorschaubild
 *
 * Kommt über eine signierte Adresse (siehe `vorschauPfad`). Ist der Vorschlag
 * entschieden, ist die Kopie aufgeräumt und `bildVerfuegbar` falsch - dann
 * steht hier kein Rahmen für ein Bild, das es nicht gibt.
 */
export function VorschlagKarte({
  antrag,
  csrfToken,
  vorschauUrl,
  darfEntscheiden,
  abstimmungMoeglich,
}: {
  antrag: emojiModul.AntragAnsicht;
  csrfToken: string;
  /** `null`, wenn es kein Vorschaubild mehr gibt. */
  vorschauUrl: string | null;
  darfEntscheiden: boolean;
  abstimmungMoeglich: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [grund, setGrund] = useState('');
  const [grundOffen, setGrundOffen] = useState(false);

  const melde = (ok: boolean, text: string): void => {
    if (ok) {
      toast.success(text);
      router.refresh();
    } else {
      toast.error(text);
    }
  };

  const annehmen = (): void => {
    starte(async () => {
      const antwort = await nimmEmojiAntragAnAction({ csrfToken, antragId: antrag.id });
      if (!antwort.ok) {
        melde(false, antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      melde(
        antwort.data.ok,
        antwort.data.ok ? 'Liegt auf dem Server.' : (antwort.data.grund ?? 'Ging nicht.'),
      );
    });
  };

  const ablehnen = (): void => {
    starte(async () => {
      const antwort = await lehneEmojiAntragAbAction({
        csrfToken,
        antragId: antrag.id,
        grund: grund.trim() || null,
      });
      if (!antwort.ok) {
        melde(false, antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setGrundOffen(false);
      setGrund('');
      melde(antwort.data.ok, antwort.data.ok ? 'Abgelehnt.' : (antwort.data.grund ?? 'Ging nicht.'));
    });
  };

  const abstimmenLassen = (): void => {
    starte(async () => {
      const antwort = await starteEmojiAbstimmungAction({ csrfToken, antragId: antrag.id });
      if (!antwort.ok) {
        melde(false, antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      melde(
        antwort.data.ok,
        antwort.data.ok ? 'Die Community stimmt ab.' : (antwort.data.grund ?? 'Ging nicht.'),
      );
    });
  };

  const masze = antrag.breite && antrag.hoehe ? `${antrag.breite}×${antrag.hoehe} px · ` : '';

  return (
    <li className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        {vorschauUrl ? (
          // Kein next/image: die Adresse ist signiert und dynamisch, und ein
          // 128-Pixel-Bild braucht keine Optimierungsstufe.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vorschauUrl}
            alt={`Vorschau von ${antrag.name}`}
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-lg border border-border/70 bg-background object-contain p-1"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-background px-1.5 py-0.5 text-sm font-medium">:{antrag.name}:</code>
            <Badge variant={antrag.animiert ? 'secondary' : 'outline'}>
              {antrag.animiert ? 'animiert' : 'fest'}
            </Badge>
            {antrag.status === 'ABSTIMMUNG' ? (
              <Badge className="gap-1">
                <Users className="size-3" aria-hidden="true" />
                {antrag.stimmen} / {antrag.stimmenZiel ?? '?'}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {masze}
            {Math.max(1, Math.round(antrag.bytes / 1024))} KB · von{' '}
            <span className="font-mono">{antrag.antragstellerId}</span>
          </p>
          {antrag.begruendung ? (
            <p className="text-pretty text-sm text-muted-foreground">{antrag.begruendung}</p>
          ) : null}
          {/*
            Nur die technische Herkunft. Was SwissHub weiss, ist «hochgeladen»
            oder «von dieser Adresse geholt» - wem das Bild gehoert, weiss es
            nicht und behauptet es nirgends.
          */}
          {antrag.herkunftNotiz ? (
            <p className="truncate text-xs text-muted-foreground">Herkunft: {antrag.herkunftNotiz}</p>
          ) : null}
        </div>
      </div>

      {darfEntscheiden ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={annehmen} disabled={laeuft}>
            {laeuft ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            Annehmen
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setGrundOffen((offen) => !offen)}
            disabled={laeuft}
          >
            <X className="size-4" aria-hidden="true" />
            Ablehnen
          </Button>
          {abstimmungMoeglich && antrag.status === 'OFFEN' ? (
            <Button type="button" size="sm" variant="ghost" onClick={abstimmenLassen} disabled={laeuft}>
              <Users className="size-4" aria-hidden="true" />
              Abstimmen lassen
            </Button>
          ) : null}
        </div>
      ) : null}

      {grundOffen ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={grund}
            onChange={(ereignis) => setGrund(ereignis.target.value)}
            placeholder="Grund (optional, geht an die Person)"
            maxLength={400}
          />
          <Button type="button" size="sm" variant="destructive" onClick={ablehnen} disabled={laeuft}>
            Ablehnen
          </Button>
        </div>
      ) : null}
    </li>
  );
}
