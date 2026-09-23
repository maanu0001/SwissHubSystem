'use client';

import { useState } from 'react';
import { Loader2, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { clipZufallAction } from '@/modules/clips/actions';
import type { clips } from '@swisshub/modules';

/**
 * Ein Clip nach dem anderen, in zufaelliger Reihenfolge.
 *
 * Der Knopf tauscht den Clip, ohne die Seite zu wechseln - wer sich
 * durchklickt, will sehen und nicht navigieren. Welcher als naechstes kommt,
 * entscheidet der Server: eine Liste aller Clips in den Browser zu geben und
 * dort zu wuerfeln, hiesse waehrend des Votings alle Clips auf einmal
 * herauszugeben.
 */
export function ZufallsAnsicht({
  competitionId,
  erste,
  einbettung,
  csrfToken,
}: {
  competitionId: string;
  erste: clips.ClipKarte;
  einbettung: string;
  csrfToken: string;
}): React.JSX.Element {
  const [karte, setKarte] = useState(erste);
  const [adresse, setAdresse] = useState(einbettung);
  const [laeuft, setLaeuft] = useState(false);

  async function naechster(): Promise<void> {
    if (laeuft) {
      return;
    }
    setLaeuft(true);
    const antwort = await clipZufallAction({ csrfToken, competitionId, ausser: karte.entryId });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    const naechste = antwort.data.karte;
    if (!naechste || !antwort.data.einbettung) {
      toast.info('Mehr Clips gibt es in dieser Runde nicht.');
      return;
    }
    setKarte(naechste);
    setAdresse(antwort.data.einbettung);
  }

  const name = karte.einreicher.displayName ?? karte.einreicher.username ?? 'Unbekannt';

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl border border-border bg-black">
        <iframe
          key={karte.entryId}
          src={adresse}
          title={karte.titel}
          className="aspect-video w-full"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{karte.titel}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <DiscordAvatar
              discordId={karte.einreicher.discordId}
              avatarHash={karte.einreicher.avatarHash}
              name={name}
              size={20}
            />
            <span className="truncate">{name}</span>
            {karte.spiel ? <span className="truncate">· {karte.spiel}</span> : null}
          </div>
        </div>

        <Button
          size="lg"
          className="shrink-0 rounded-full"
          onClick={() => void naechster()}
          disabled={laeuft}
        >
          {laeuft ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Shuffle className="size-4" aria-hidden="true" />
          )}
          Nächster Clip
        </Button>
      </div>
    </div>
  );
}
