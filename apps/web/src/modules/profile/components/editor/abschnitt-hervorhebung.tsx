'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { MAX_HERVORGEHOBENE_AUSZEICHNUNGEN } from '@swisshub/modules/profil/auszeichnungen';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { hervorhebungSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

/**
 * Bis zu drei Auszeichnungen hervorheben.
 *
 * ## Warum hier nur Erreichtes zur Auswahl steht
 *
 * Weil §9 die Vergabe ueber den Editor ausschliesst - und weil eine Auswahlliste
 * mit Auszeichnungen, die man nicht hat, eine Einladung zu einer Fehlermeldung
 * waere. Was hier steht, hat die Person tatsaechlich erreicht; gerechnete und
 * verliehene gleichermassen, denn beide sind erreicht, nur auf anderem Weg.
 *
 * ## Und was passiert, wenn eine zurueckgezogen wird
 *
 * Sie verschwindet vom Profil, ohne dass jemand hier etwas tun muss. Die
 * Auswahl ist eine Wunschliste; was gezeigt wird, entscheidet die Anzeige
 * anhand dessen, was gerade gilt. Deshalb steht in der Spalte auch nie eine
 * Auszeichnung, sondern nur ihr Schluessel.
 */
export function AbschnittHervorhebung({
  csrfToken,
  start,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['hervorhebung'];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start.gewaehlt);
  const [entwurf, setEntwurf] = useState(start.gewaehlt);
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const umschalten = (key: string): void => {
    const liste = entwurf.includes(key)
      ? entwurf.filter((eintrag) => eintrag !== key)
      : [...entwurf, key].slice(0, MAX_HERVORGEHOBENE_AUSZEICHNUNGEN);
    setEntwurf(liste);
    onSchmutzig(!unveraendert(gespeichert, liste));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await hervorhebungSpeichernAction({ csrfToken, keys: entwurf });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    setGespeichert(entwurf);
    onSchmutzig(false);
    zeigeQuittung();
    router.refresh();
  };

  if (start.erreichbar.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Du hast noch keine Auszeichnungen erreicht. Sobald es welche gibt, kannst du hier bis zu{' '}
        {MAX_HERVORGEHOBENE_AUSZEICHNUNGEN} davon hervorheben.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Höchstens {MAX_HERVORGEHOBENE_AUSZEICHNUNGEN}. Sie stehen gross oben auf deinem öffentlichen Profil
          und auf deiner Gamer Card – die vollständige Liste erscheint weiter unten ohnehin.
        </span>
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {start.erreichbar.map((eintrag) => {
          const gewaehlt = entwurf.includes(eintrag.key);
          const voll = !gewaehlt && entwurf.length >= MAX_HERVORGEHOBENE_AUSZEICHNUNGEN;
          return (
            <li key={eintrag.key}>
              <button
                type="button"
                onClick={() => umschalten(eintrag.key)}
                disabled={voll}
                aria-pressed={gewaehlt}
                className={`flex w-full min-h-14 items-center gap-3 rounded-lg border px-3 text-left transition-colors disabled:opacity-40 ${
                  gewaehlt ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-primary/40'
                }`}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4"
                  aria-hidden="true"
                >
                  <NavIcon name={eintrag.symbol} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{eintrag.label}</span>
                  <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                    {eintrag.stufe}
                  </span>
                </span>
                {gewaehlt ? (
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-primary">
                    {entwurf.indexOf(eintrag.key) + 1}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <SpeicherLeiste
        schmutzig={schmutzig}
        laeuft={laeuft}
        gespeichert={quittung}
        onSpeichern={() => void speichern()}
        onVerwerfen={() => {
          setEntwurf(gespeichert);
          onSchmutzig(false);
        }}
      />
    </div>
  );
}
