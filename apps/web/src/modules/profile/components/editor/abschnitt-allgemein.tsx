'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as angaben from '@swisshub/modules/profil/angaben';
import type { profile } from '@swisshub/modules';
import { allgemeinSpeichernAction } from '@/modules/profile/profil-aktionen';
import { ChipAuswahl, Feldgruppe, SpeicherLeiste, TextFeld, unveraendert, useQuittung } from './felder';

/**
 * Abschnitt «Allgemein».
 *
 * ## Warum das Motto und nicht der Name oben steht
 *
 * Der Discord-Name laesst sich hier nicht aendern - er kommt aus Discord und
 * bleibt dort. Das Feld «Profilname» steht daneben und ersetzt ihn nicht;
 * das sagt der Hinweis darunter auch ausdruecklich, damit niemand ein
 * Umbenennen erwartet, das nicht stattfindet.
 */
export function AbschnittAllgemein({
  csrfToken,
  start,
  onEntwurf,
  onSchmutzig,
}: {
  csrfToken: string;
  start: profile.EditorDaten['allgemein'];
  /** Meldet den Stand fuer die Vorschau - bei jeder Tastatureingabe. */
  onEntwurf: (entwurf: profile.EditorDaten['allgemein']) => void;
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [gespeichert, setGespeichert] = useState(start);
  const [entwurf, setEntwurfIntern] = useState(start);
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const aendern = (teil: Partial<profile.EditorDaten['allgemein']>): void => {
    const neu = { ...entwurf, ...teil };
    setEntwurfIntern(neu);
    onEntwurf(neu);
    onSchmutzig(!unveraendert(gespeichert, neu));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await allgemeinSpeichernAction({
      csrfToken,
      displayName: entwurf.displayName ?? '',
      tagline: entwurf.tagline ?? '',
      bio: entwurf.bio ?? '',
      languages: entwurf.languages,
      platforms: entwurf.platforms,
      playtimes: entwurf.playtimes,
      comms: entwurf.comms,
      playStyle: entwurf.playStyle,
      availability: entwurf.availability,
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

  const verwerfen = (): void => {
    setEntwurfIntern(gespeichert);
    onEntwurf(gespeichert);
    onSchmutzig(false);
  };

  return (
    <div className="space-y-6">
      <Feldgruppe titel="Profilname" hinweis="Steht neben deinem Discord-Namen - er ersetzt ihn nicht.">
        <TextFeld
          label="Profilname"
          wert={entwurf.displayName ?? ''}
          onChange={(wert) => aendern({ displayName: wert })}
          maxLaenge={32}
          platzhalter="Optional"
        />
      </Feldgruppe>

      <Feldgruppe titel="Motto" hinweis="Eine Zeile, die im Profilkopf steht.">
        <TextFeld
          label="Motto"
          wert={entwurf.tagline ?? ''}
          onChange={(wert) => aendern({ tagline: wert })}
          maxLaenge={80}
          platzhalter="z.B. «Immer für eine Runde zu haben»"
        />
      </Feldgruppe>

      <Feldgruppe titel="Über mich">
        <TextFeld
          label="Über mich"
          wert={entwurf.bio ?? ''}
          onChange={(wert) => aendern({ bio: wert })}
          maxLaenge={600}
          mehrzeilig
          platzhalter="Was solltest du über mich wissen, bevor wir zusammen spielen?"
        />
      </Feldgruppe>

      <Feldgruppe titel="Status" hinweis="Steht als farbige Marke im Profilkopf.">
        <ChipAuswahl
          optionen={angaben.VERFUEGBARKEIT}
          gewaehlt={[entwurf.availability]}
          onChange={(werte) => aendern({ availability: werte[0] ?? 'UNSET' })}
          einfach
        />
      </Feldgruppe>

      <Feldgruppe titel="Spielart">
        <ChipAuswahl
          optionen={angaben.SPIELART}
          gewaehlt={[entwurf.playStyle]}
          onChange={(werte) => aendern({ playStyle: werte[0] ?? 'BOTH' })}
          einfach
        />
      </Feldgruppe>

      <Feldgruppe titel="Sprachen" hinweis="Höchstens sechs.">
        <ChipAuswahl
          optionen={angaben.SPRACHEN}
          gewaehlt={entwurf.languages}
          onChange={(werte) => aendern({ languages: werte })}
          maxAnzahl={6}
        />
      </Feldgruppe>

      <Feldgruppe titel="Plattformen">
        <ChipAuswahl
          optionen={angaben.PLATTFORMEN}
          gewaehlt={entwurf.platforms}
          onChange={(werte) => aendern({ platforms: werte })}
        />
      </Feldgruppe>

      <Feldgruppe titel="Spielzeiten" hinweis="Grob genügt - wann trifft man dich ungefähr an?">
        <ChipAuswahl
          optionen={angaben.SPIELZEITEN}
          gewaehlt={entwurf.playtimes}
          onChange={(werte) => aendern({ playtimes: werte })}
        />
      </Feldgruppe>

      <Feldgruppe titel="Absprache" hinweis="Höchstens drei.">
        <ChipAuswahl
          optionen={angaben.ABSPRACHE}
          gewaehlt={entwurf.comms}
          onChange={(werte) => aendern({ comms: werte })}
          maxAnzahl={3}
        />
      </Feldgruppe>

      <SpeicherLeiste
        schmutzig={schmutzig}
        laeuft={laeuft}
        gespeichert={quittung}
        onSpeichern={() => void speichern()}
        onVerwerfen={verwerfen}
      />
    </div>
  );
}
