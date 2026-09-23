'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Einen kurzen Wert in die Zwischenablage legen.
 *
 * Der Rueckfall neben «Discord-Profil oeffnen»: oeffnet die Adresse aus
 * irgendeinem Grund nichts - eine Anwendung ohne Weiterleitung, ein Browser
 * ohne Discord-Anmeldung -, dann sucht man mit der Kennung direkt in Discord.
 *
 * `navigator.clipboard` gibt es nicht ueberall: nicht ohne HTTPS, nicht in
 * jedem eingebetteten Browser. Geht es nicht, sagt der Knopf das, statt so zu
 * tun, als haette er etwas getan.
 */
export function KopierKnopf({ wert, label }: { wert: string; label: string }): React.JSX.Element {
  const [stand, setStand] = useState<'bereit' | 'kopiert' | 'fehlt'>('bereit');

  const kopieren = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(wert);
      setStand('kopiert');
      window.setTimeout(() => setStand('bereit'), 1500);
    } catch {
      setStand('fehlt');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void kopieren()}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      title={wert}
    >
      {stand === 'kopiert' ? (
        <Check className="size-4 text-success" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {stand === 'kopiert' ? 'Kopiert' : stand === 'fehlt' ? wert : label}
    </button>
  );
}
