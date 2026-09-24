'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import * as socials from '@swisshub/modules/profil/socials';
import type { profile } from '@swisshub/modules';
import { socialsSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

/**
 * Abschnitt «Socials».
 *
 * ## Warum ein Feld je Plattform und kein «Link hinzufuegen»
 *
 * Gespeichert wird eine Kennung, nie eine Adresse - die Adresse baut der
 * Server aus der Kennung. Ein freies Linkfeld waere das Gegenteil davon: es
 * lebt davon, dass jemand eine vollstaendige Adresse eingibt, und dann muss
 * man hoffen, sie richtig gepruefet zu haben.
 *
 * ## Warum der Hinweis oben steht
 *
 * Damit niemand glaubt, hier entstehe eine geprueftes Kontoverknuepfung.
 * Was hier eingetippt wird, ist eine Behauptung - eine nuetzliche, aber eine
 * unbelegte, und das Profil sagt das auch.
 */
export function AbschnittSocials({
  csrfToken,
  start,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['socials'];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();

  const alsKarte = (liste: profile.EditorDaten['socials']): Record<string, string> =>
    Object.fromEntries(liste.map((eintrag) => [eintrag.platform, eintrag.handle]));

  const [gespeichert, setGespeichert] = useState(alsKarte(start));
  const [entwurf, setEntwurf] = useState(alsKarte(start));
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<Record<string, string>>({});
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const aendern = (plattform: string, wert: string): void => {
    const neu = { ...entwurf, [plattform]: wert };
    if (wert.trim().length === 0) {
      delete neu[plattform];
    }
    setEntwurf(neu);
    onSchmutzig(!unveraendert(gespeichert, neu));

    // Sofort pruefen, aber nur melden, nicht korrigieren: wer mitten im
    // Tippen ist, soll nicht gegen eine Eingabe kaempfen, die sich selbst
    // umschreibt.
    const geprueft = wert.trim().length === 0 || socials.pruefeHandle(plattform, wert) !== null;
    setFehler((vorher) => {
      const naechste = { ...vorher };
      if (geprueft) {
        delete naechste[plattform];
      } else {
        naechste[plattform] = 'Das passt nicht zum Format dieser Plattform.';
      }
      return naechste;
    });
  };

  const speichern = async (): Promise<void> => {
    if (Object.keys(fehler).length > 0) {
      toast.error('Bitte zuerst die markierten Felder korrigieren.');
      return;
    }
    setLaeuft(true);
    const antwort = await socialsSpeichernAction({
      csrfToken,
      eintraege: Object.entries(entwurf).map(([platform, handle]) => ({ platform, handle })),
    });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    setGespeichert(entwurf);
    onSchmutzig(false);
    zeigeQuittung();
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <p className="flex gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Diese Angaben sind selbst eingetragen und werden nicht überprüft. Im Profil erscheinen sie deshalb
          ohne Verifizierungshaken.
        </span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {socials.alleSocialPlattformen().map((plattform) => {
          const wert = entwurf[plattform.key] ?? '';
          const meldung = fehler[plattform.key];
          const vorschau = wert ? socials.zeigeSocial(plattform.key, wert, false) : null;

          return (
            <div key={plattform.key} className="min-w-0">
              <label className="block text-sm font-medium" htmlFor={`social-${plattform.key}`}>
                {plattform.label}
              </label>
              <input
                id={`social-${plattform.key}`}
                type="text"
                value={wert}
                maxLength={plattform.maxLaenge}
                placeholder={plattform.platzhalter}
                onChange={(event) => aendern(plattform.key, event.target.value)}
                aria-invalid={meldung !== undefined}
                aria-describedby={meldung ? `social-fehler-${plattform.key}` : undefined}
                className={`mt-1 min-h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
                  meldung ? 'border-destructive' : 'border-border focus-visible:border-primary-bright'
                }`}
              />
              {meldung ? (
                <p id={`social-fehler-${plattform.key}`} className="mt-1 text-xs text-destructive">
                  {meldung}
                </p>
              ) : vorschau?.adresse ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">{vorschau.adresse}</p>
              ) : plattform.hilfe ? (
                <p className="mt-1 text-xs text-muted-foreground">{plattform.hilfe}</p>
              ) : null}
            </div>
          );
        })}
      </div>

      <SpeicherLeiste
        schmutzig={schmutzig}
        laeuft={laeuft}
        gespeichert={quittung}
        onSpeichern={() => void speichern()}
        onVerwerfen={() => {
          setEntwurf(gespeichert);
          setFehler({});
          onSchmutzig(false);
        }}
      />
    </div>
  );
}
