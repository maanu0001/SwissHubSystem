'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import type { profile } from '@swisshub/modules';
import { privatsphaereSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

/**
 * Abschnitt «Privatsphäre».
 *
 * ## Warum nur zwei Stufen
 *
 * «Mitglieder» und «Nur ich». Ein drittes «Freunde» braeuchte ein
 * Freundesystem, das es nicht gibt - und eines nur fuer die Profilanzeige zu
 * erfinden hiesse, eine Beziehungsverwaltung zu bauen, die niemand pflegt.
 *
 * ## Warum das hier nur die Anzeige ist
 *
 * Durchgesetzt wird jede dieser Regeln serverseitig: was jemand auf «Nur
 * ich» stellt, wird fuer andere gar nicht erst geladen. Diese Seite stellt
 * die Schalter, sie bewacht nichts.
 */
const ABSCHNITTE = [
  {
    key: 'visibilityProfile' as const,
    titel: 'Angaben',
    text: 'Motto, «Über mich», Sprachen, Plattformen und Spielzeiten.',
  },
  { key: 'visibilityGames' as const, titel: 'Spiele', text: 'Deine Spiele mit Rang und Rolle.' },
  {
    key: 'visibilitySocials' as const,
    titel: 'Konten',
    text: 'Twitch, Steam, Riot ID und die übrigen Kennungen.',
  },
];

export function AbschnittPrivatsphaere({
  csrfToken,
  start,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['privatsphaere'];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start);
  const [entwurf, setEntwurf] = useState(start);
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const aendern = (teil: Partial<profile.EditorDaten['privatsphaere']>): void => {
    const neu = { ...entwurf, ...teil };
    setEntwurf(neu);
    onSchmutzig(!unveraendert(gespeichert, neu));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await privatsphaereSpeichernAction({ csrfToken, ...entwurf });
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
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Was du hier verbirgst, wird für andere gar nicht erst geladen - nicht nur ausgeblendet. Dein
          Discord-Name, dein Avatar und dein Level bleiben sichtbar; die zeigt der Server ohnehin überall.
          <br />
          <strong className="font-medium text-foreground">Öffentlich</strong> heisst wirklich öffentlich: ohne
          Anmeldung, über deinen Profil-Link, für jeden im Netz. «Angaben» ist dabei der Hauptschalter - steht
          er nicht auf öffentlich, gibt es deine öffentliche Seite gar nicht.
        </span>
      </p>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {ABSCHNITTE.map((abschnitt) => (
          <li
            key={abschnitt.key}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{abschnitt.titel}</p>
              <p className="text-xs text-muted-foreground">{abschnitt.text}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {(
                [
                  ['PUBLIC', 'Öffentlich'],
                  ['MEMBERS', 'Mitglieder'],
                  ['PRIVATE', 'Nur ich'],
                ] as const
              ).map(([stufe, label]) => (
                <button
                  key={stufe}
                  type="button"
                  aria-pressed={entwurf[abschnitt.key] === stufe}
                  onClick={() => aendern({ [abschnitt.key]: stufe })}
                  className={`min-h-11 rounded-lg border px-3 text-sm transition-colors ${
                    entwurf[abschnitt.key] === stufe
                      ? 'border-primary-bright bg-primary-bright/12'
                      : 'border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </li>
        ))}

        <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">In «Mitglieder entdecken» auftauchen</p>
            <p className="text-xs text-muted-foreground">
              Aus: dein Profil bleibt über den direkten Link erreichbar, erscheint aber in keiner Suche und
              keinem Filter.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {(
              [
                [true, 'Ja'],
                [false, 'Nein'],
              ] as const
            ).map(([wert, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={entwurf.discoverable === wert}
                onClick={() => aendern({ discoverable: wert })}
                className={`min-h-11 rounded-lg border px-3 text-sm transition-colors ${
                  entwurf.discoverable === wert
                    ? 'border-primary-bright bg-primary-bright/12'
                    : 'border-border text-muted-foreground hover:border-foreground/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </li>
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
