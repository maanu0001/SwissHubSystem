'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ClipRahmen, MedalHinweis } from './clip-rahmen';
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
 * ## Rahmen oder Videoelement
 *
 * Entscheidet `ClipRahmen` - an einer Stelle fuer alle fuenf Ansichten, die
 * einen Clip zeigen. Dort steht auch, warum eine eigene Datei kein `iframe`
 * bekommt und was die Sandbox des Rahmens erlaubt.
 */
export function ClipSpieler({
  offen,
  aufOeffnenAendern,
  titel,
  einbettung,
  quelle,
  provider,
}: {
  offen: boolean;
  aufOeffnenAendern: (offen: boolean) => void;
  titel: string;
  einbettung: string;
  quelle: string;
  /** `twitch`, `youtube`, `medal` oder `upload` - entscheidet die Darstellung. */
  provider: string;
}): React.JSX.Element {
  const eigeneDatei = provider === 'upload';
  return (
    <Dialog open={offen} onOpenChange={aufOeffnenAendern}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{titel}</DialogTitle>
        </DialogHeader>

        <div className="overflow-hidden rounded-xl border border-border bg-black">
          {offen ? (
            <ClipRahmen provider={provider} adresse={einbettung} titel={titel} spaetLaden />
          ) : (
            /*
             * Ohne geoeffneten Dialog kein Player.
             *
             * Der Dialog bleibt sonst im Dokument und der Player laedt im
             * Hintergrund weiter - bei zwanzig Karten auf einer Seite waeren
             * das zwanzig laufende Player.
             */
            <div className="aspect-video w-full" />
          )}
        </div>

        <MedalHinweis provider={provider} />

        <a
          href={quelle}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full sm:w-auto')}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {eigeneDatei ? 'In neuem Tab öffnen' : 'Beim Anbieter öffnen'}
        </a>
      </DialogContent>
    </Dialog>
  );
}
