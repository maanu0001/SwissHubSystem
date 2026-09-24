'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Link2, Share2 } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { toast } from 'sonner';

/**
 * Den Profil-Link weitergeben.
 *
 * Zwei Wege, und welcher es wird, entscheidet das Geraet: wo es die
 * Teilen-Funktion des Systems gibt - auf dem Handy praktisch immer -, oeffnet
 * sie sich; sonst wandert die Adresse in die Zwischenablage. Ein Knopf, der
 * auf dem Handy nur kopiert, verschenkt den kuerzeren Weg; einer, der nur
 * teilt, tut am Schreibtisch gar nichts.
 *
 * Die Adresse entsteht erst im Browser aus `location.origin`. Serverseitig
 * muesste dafuer die oeffentliche Domain bekannt sein, und sie waere eine
 * zweite Stelle, die beim naechsten Umzug falsch wird.
 */
export function TeilenKnopf({
  slug,
  name,
  variante = 'knopf',
}: {
  slug: string;
  name: string;
  variante?: 'knopf' | 'dezent';
}): React.JSX.Element {
  const [kopiert, setKopiert] = useState(false);

  const teilen = async (): Promise<void> => {
    const adresse = `${window.location.origin}/u/${slug}`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${name} auf SwissHub`, url: adresse });
        return;
      } catch {
        // Abgebrochen oder nicht erlaubt - dann eben kopieren.
      }
    }

    try {
      await navigator.clipboard.writeText(adresse);
      setKopiert(true);
      toast.success('Link kopiert.');
      window.setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Ohne Zwischenablage bleibt nur, die Adresse zu zeigen - damit sie
      // sich von Hand markieren laesst.
      toast.error(adresse);
    }
  };

  if (variante === 'dezent') {
    return (
      <button
        type="button"
        onClick={() => void teilen()}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {kopiert ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Link2 className="size-4" aria-hidden="true" />
        )}
        {kopiert ? 'Link kopiert' : 'Profil teilen'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void teilen()}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] bg-card-elevated px-3 py-2 text-sm font-medium transition-colors hover:border-[hsl(var(--profil-akzent)/0.6)]"
    >
      {kopiert ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {kopiert ? 'Kopiert' : 'Profil teilen'}
    </button>
  );
}

/**
 * Der Knopf, wenn das Profil noch nicht oeffentlich steht.
 *
 * Hier war vorher gar nichts - der Teilen-Knopf erschien erst, wenn jemand
 * sein Profil bereits freigegeben hatte. Wer das nicht getan hatte, sah
 * nichts und hatte damit auch keinen Hinweis darauf, dass es die Funktion
 * gibt. Die Einstellung liegt im Editor unter «Privatsphaere», und dorthin
 * suchte niemand, der nicht wusste, wonach.
 *
 * Deshalb steht der Knopf jetzt immer da und fuehrt genau dorthin.
 */
export function ProfilFreigebenKnopf(): React.JSX.Element {
  return (
    <Link
      href={`${systemRoutes.profilBearbeiten()}?abschnitt=privatsphaere`}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] bg-card-elevated px-3 py-2 text-sm font-medium transition-colors hover:border-[hsl(var(--profil-akzent)/0.6)]"
      title="Dein Profil ist noch nicht öffentlich - hier stellst du es frei."
    >
      <Share2 className="size-4" aria-hidden="true" />
      Profil teilen
    </Link>
  );
}
