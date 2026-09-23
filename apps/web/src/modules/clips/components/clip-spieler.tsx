'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Der Clip, gross.
 *
 * ## Die Adresse im Rahmen
 *
 * `embedUrl` kommt aus `erkenneClip()` und ist dort **gebaut** worden - aus
 * Anbieter und Kennung, nie aus der Eingabe. Eine eingegebene Adresse in ein
 * `iframe` zu stellen hiesse, jedem Mitglied eine Seite auf swisshub.gg zu
 * schenken, die aussieht wie unsere und ihm gehoert.
 *
 * Die Content Security Policy zieht dieselbe Grenze ein zweites Mal: nur
 * vier Hosts duerfen ueberhaupt in einem Rahmen stehen. Waere die Pruefung
 * oben je zu umgehen, bliebe der Rahmen leer.
 *
 * ## Die Sandbox
 *
 * Skripte braucht der Player, sonst spielt er nicht. `allow-same-origin`
 * meint dabei den Ursprung des Players - twitch.tv, youtube-nocookie.com -,
 * nicht unseren: der Rahmen bekommt damit Zugriff auf seine eigenen Daten
 * und auf keine unserer. Was fehlt, ist Absicht: keine Formulare, keine
 * Navigation der Hauptseite, kein Download.
 */
export function ClipSpieler({
  offen,
  aufOeffnenAendern,
  titel,
  einbettung,
  quelle,
}: {
  offen: boolean;
  aufOeffnenAendern: (offen: boolean) => void;
  titel: string;
  einbettung: string;
  quelle: string;
}): React.JSX.Element {
  return (
    <Dialog open={offen} onOpenChange={aufOeffnenAendern}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{titel}</DialogTitle>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border bg-black">
          {offen ? (
            <iframe
              src={einbettung}
              title={titel}
              className="aspect-video w-full"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          ) : (
            /*
             * Ohne geoeffneten Dialog kein Rahmen.
             *
             * Der Dialog bleibt sonst im Dokument und der Player laedt im
             * Hintergrund weiter - bei zwanzig Karten auf einer Seite waeren
             * das zwanzig laufende Player.
             */
            <div className="aspect-video w-full" />
          )}
        </div>

        <a
          href={quelle}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full sm:w-auto')}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Beim Anbieter öffnen
        </a>
      </DialogContent>
    </Dialog>
  );
}
