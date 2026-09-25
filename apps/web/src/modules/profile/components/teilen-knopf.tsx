'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Link2, Share2 } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { toast } from 'sonner';

/**
 * Den Profil-Link in die Zwischenablage legen.
 *
 * ## Warum nur das
 *
 * Der Knopf oeffnete frueher die Teilen-Funktion des Systems, wo es sie gibt.
 * Das klang nach dem kuerzeren Weg und war in der Praxis der ueberraschende:
 * auf dem Telefon sprang ein Systemblatt auf, auf dem Schreibtisch geschah
 * etwas anderes, und wer einfach nur die Adresse in eine Discord-Nachricht
 * setzen wollte, musste den Umweg ueber ein Menue nehmen, das er nicht
 * bestellt hatte.
 *
 * Ein Knopf, zwei Verhalten, je nach Geraet - das ist einer zu viel. Jetzt
 * tut er ueberall dasselbe: kopieren, kurz bestaetigen, fertig. Wer teilen
 * will, fuegt ein.
 *
 * ## Die Adresse
 *
 * Sie entsteht erst im Browser aus `location.origin`. Serverseitig muesste
 * dafuer die oeffentliche Domain bekannt sein, und sie waere eine zweite
 * Stelle, die beim naechsten Umzug falsch wird.
 */
/**
 * Text in die Zwischenablage - mit Rueckfallebene.
 *
 * `navigator.clipboard` gibt es nur in sicheren Kontexten. Ueber HTTP, in
 * manchen eingebetteten Ansichten und in aelteren Browsern fehlt es ganz,
 * und dann wirft der Zugriff, ehe ueberhaupt etwas kopiert wurde. Der alte
 * Weg ueber ein unsichtbares Textfeld und `execCommand` funktioniert dort
 * weiterhin; er ist abgekuendigt und trotzdem das, was in genau diesen
 * Faellen noch traegt.
 *
 * Gibt zurueck, ob es geklappt hat - geraten wird nicht.
 */
async function inDieZwischenablage(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Verweigert oder nicht verfuegbar - unten weiter.
  }

  try {
    const feld = document.createElement('textarea');
    feld.value = text;
    // Ausserhalb des Sichtfelds statt `display: none`: ein verstecktes Feld
    // laesst sich nicht auswaehlen, und ohne Auswahl kopiert `execCommand`
    // nichts.
    feld.setAttribute('readonly', '');
    feld.style.position = 'fixed';
    feld.style.top = '-1000px';
    feld.style.opacity = '0';
    document.body.append(feld);
    feld.select();
    const geklappt = document.execCommand('copy');
    feld.remove();
    return geklappt;
  } catch {
    return false;
  }
}

export function TeilenKnopf({
  slug,
  variante = 'knopf',
}: {
  slug: string;
  variante?: 'knopf' | 'dezent';
}): React.JSX.Element {
  const [kopiert, setKopiert] = useState(false);

  const teilen = async (): Promise<void> => {
    const adresse = `${window.location.origin}/u/${slug}`;

    if (await inDieZwischenablage(adresse)) {
      setKopiert(true);
      toast.success('Profil-Link kopiert!');
      window.setTimeout(() => setKopiert(false), 2000);
      return;
    }

    /*
     * Ohne Zwischenablage bleibt, die Adresse zu zeigen.
     *
     * Sie steht dann im Hinweis und laesst sich von Hand markieren. Das ist
     * kein schoener Weg, aber ein gangbarer - und besser als eine Meldung,
     * die sagt, es habe nicht geklappt, ohne zu sagen, was stattdessen.
     */
    toast.error(`Kopieren hat nicht geklappt. Die Adresse lautet: ${adresse}`, { duration: 15000 });
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
