'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp } from 'lucide-react';
import * as abschnitte from '@swisshub/modules/profil/abschnitte';
import { abschnitteSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

/**
 * Die Reihenfolge der oeffentlichen Abschnitte.
 *
 * ## Warum Pfeile und kein Drag-and-drop
 *
 * Weil Drag-and-drop auf einem Telefon schwierig und mit einer Tastatur kaum
 * bedienbar ist. §17 verlangt ausdruecklich eine Alternative - hier ist sie die
 * einzige Bedienung, und damit gibt es keine zweite, die schlechter gepflegt
 * waere. Zwei Knoepfe je Zeile brauchen keine Bibliothek und funktionieren
 * ueberall.
 *
 * ## Was das nicht ist
 *
 * Kein Website-Builder. Die **Menge** der Abschnitte ist fest, ihr Inhalt kommt
 * aus dem Profil, und was ein Abschnitt zeigt, entscheidet seine Komponente.
 * Verschieben laesst sich die Reihenfolge und sonst nichts - eine gespeicherte
 * Liste von Schluesseln kann nur umsortieren, was es gibt.
 *
 * ## Warum hier alle Abschnitte stehen, auch leere
 *
 * Weil die Liste eine Reihenfolge ist und keine Vorschau. Wer noch keine
 * Turniere gespielt hat, kann trotzdem entscheiden, wo sie einmal stehen sollen -
 * und sieht daneben, dass der Abschnitt derzeit nicht erscheint.
 */
export function AbschnittReihenfolge({
  csrfToken,
  start,
  onSchmutzig,
}: {
  csrfToken: string;
  start: string[];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start);
  const [entwurf, setEntwurf] = useState(start);
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const verschieben = (index: number, richtung: -1 | 1): void => {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= entwurf.length) {
      return;
    }
    const liste = [...entwurf];
    const a = liste[index]!;
    const b = liste[ziel]!;
    liste[index] = b;
    liste[ziel] = a;
    setEntwurf(liste);
    onSchmutzig(!unveraendert(gespeichert, liste));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await abschnitteSpeichernAction({ csrfToken, reihenfolge: entwurf });
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        In dieser Reihenfolge erscheinen die Abschnitte auf deinem öffentlichen Profil. Der Kopf mit Name,
        Bild und deinen hervorgehobenen Links steht immer oben.
      </p>

      <ol className="flex flex-col gap-2">
        {entwurf.map((schluessel, index) => {
          const art = abschnitte.abschnittArt(schluessel);
          if (!art) {
            return null;
          }
          return (
            <li
              key={schluessel}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3"
            >
              <span className="mt-1 w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{art.label}</span>
                <span className="block text-xs text-muted-foreground">{art.beschreibung}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => verschieben(index, -1)}
                  disabled={index === 0}
                  aria-label={`${art.label} nach oben`}
                  className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => verschieben(index, 1)}
                  disabled={index === entwurf.length - 1}
                  aria-label={`${art.label} nach unten`}
                  className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>

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
