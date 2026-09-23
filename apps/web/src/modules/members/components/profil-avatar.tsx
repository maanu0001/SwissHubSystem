'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { avatarSizeFor, defaultAvatarUrl, getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Der Avatar in der Mitgliedsakte - anklickbar.
 *
 * ## Warum nicht einfach das kleine Bild vergroessern
 *
 * Discords Avatar-Adressen tragen die gewuenschte Kantenlaenge als Parameter.
 * Das Bild der Akte ist 64 Pixel breit, und 64 Pixel auf 512 zu ziehen ergibt
 * einen Matsch. Die grosse Ansicht holt deshalb dieselbe Datei noch einmal -
 * in 512 Pixel.
 *
 * ## Der Rueckfall
 *
 * Ohne eigenes Bild liefert Discord ein Standardbild, und das ist ein
 * gueltiges Bild - kein Platzhalter, den man verstecken muesste. Scheitert
 * auch das, zeigt die Ansicht ein Monogramm statt eines kaputten Rahmens,
 * genau wie die kleine Darstellung.
 *
 * ## Berechtigungen
 *
 * Keine. Wer diese Akte sieht, sieht das Bild ohnehin schon - nur kleiner.
 * Hier wird nichts zugaenglich, was vorher verschlossen war.
 */
export function ProfilAvatar({
  discordId,
  avatarHash,
  name,
}: {
  discordId: string;
  avatarHash: string | null;
  name: string;
}): React.JSX.Element {
  const [offen, setOffen] = useState(false);
  const [fehlgeschlagen, setFehlgeschlagen] = useState(false);

  const gross = avatarHash
    ? getDiscordAvatarUrl(discordId, avatarHash, avatarSizeFor(512))
    : defaultAvatarUrl(discordId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        // Der Knopf ist der Avatar. Kein zusaetzlicher Rahmen, keine
        // zusaetzliche Flaeche - nur ein Ring beim Darueberfahren, damit
        // erkennbar ist, dass er etwas tut.
        className="rounded-full ring-offset-2 ring-offset-background transition hover:ring-2 hover:ring-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Profilbild von ${name} gross anzeigen`}
      >
        <DiscordAvatar discordId={discordId} avatarHash={avatarHash} name={name} size={64} />
      </button>

      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="truncate">{name}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4">
            {fehlgeschlagen ? (
              <div
                className="grid aspect-square w-full max-w-[18rem] place-items-center rounded-2xl border border-border bg-secondary text-4xl font-semibold text-muted-foreground"
                role="img"
                aria-label={`Profilbild von ${name}`}
              >
                {name.trim().slice(0, 2).toUpperCase() || '?'}
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={gross}
                alt={`Profilbild von ${name}`}
                // Discord-Avatare sind quadratisch. `aspect-square` und
                // `object-cover` halten sie das auch dann, wenn Discord
                // einmal etwas anderes liefert - verzerrt wird nichts.
                className="aspect-square w-full max-w-[18rem] rounded-2xl border border-border object-cover"
                onError={() => setFehlgeschlagen(true)}
              />
            )}

            <a
              href={gross}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Bild in voller Grösse
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
