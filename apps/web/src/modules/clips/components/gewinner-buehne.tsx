'use client';

import { ClipRahmen } from './clip-rahmen';
import { useState } from 'react';
import { Download, Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Button } from '@/components/ui/button';
import type { clips } from '@swisshub/modules';

/**
 * Der Gewinner, gross.
 *
 * ## Warum der Player hier sofort steht
 *
 * Auf dieser Seite gibt es genau einen Grund, hier zu sein. Ihn hinter einem
 * Vorschaubild und einem Klick zu verstecken, waere eine Huerde ohne Zweck -
 * anders als im Raster, wo zwanzig laufende Rahmen das Geraet belasten
 * wuerden.
 *
 * ## Die Karte zum Teilen
 *
 * Ein Bild, das der Server zeichnet. Heruntergeladen wird es ueber einen
 * `blob`, damit die Datei den Namen der Runde traegt - ein `download` auf
 * einen Link gaebe ihr den Namen der Route.
 */
export function GewinnerBuehne({
  karte,
  einbettung,
  nummer,
  teilnehmer,
  stimmen,
  shareUrl,
  dateiname,
}: {
  karte: clips.ClipKarte;
  einbettung: string;
  nummer: number;
  teilnehmer: number;
  stimmen: number;
  shareUrl: string;
  dateiname: string;
}): React.JSX.Element {
  const [laedt, setLaedt] = useState(false);
  const name = karte.einreicher.displayName ?? karte.einreicher.username ?? 'Unbekannt';

  async function herunterladen(): Promise<void> {
    if (laedt) {
      return;
    }
    setLaedt(true);
    try {
      const antwort = await fetch(shareUrl);
      if (!antwort.ok) {
        throw new Error(String(antwort.status));
      }
      const blob = await antwort.blob();
      const adresse = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = adresse;
      link.download = dateiname;
      link.click();
      URL.revokeObjectURL(adresse);
    } catch {
      toast.error('Die Karte konnte nicht erstellt werden.');
    } finally {
      setLaedt(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Trophy className="size-4 text-[hsl(45_92%_58%)]" aria-hidden="true" />
        Clip of the Week #{nummer}
      </div>

      <div className="overflow-hidden rounded-3xl border border-[hsl(45_92%_52%)]/40 bg-black shadow-xl shadow-[hsl(45_92%_52%)]/5">
        <ClipRahmen provider={karte.provider} adresse={einbettung} titel={karte.titel} autoplayErlaubt />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">{karte.titel}</h2>
          <div className="flex items-center gap-2 text-muted-foreground">
            <DiscordAvatar
              discordId={karte.einreicher.discordId}
              avatarHash={karte.einreicher.avatarHash}
              name={name}
              size={28}
            />
            <span className="truncate">{name}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground tabular-nums">{karte.stimmen ?? 0}</strong>{' '}
            {karte.stimmen === 1 ? 'Stimme' : 'Stimmen'} · {teilnehmer} {teilnehmer === 1 ? 'Clip' : 'Clips'}{' '}
            im Rennen · {stimmen} {stimmen === 1 ? 'Stimme' : 'Stimmen'} insgesamt
          </p>
        </div>

        <Button variant="outline" onClick={() => void herunterladen()} disabled={laedt} className="shrink-0">
          {laedt ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Karte herunterladen
        </Button>
      </div>
    </section>
  );
}
