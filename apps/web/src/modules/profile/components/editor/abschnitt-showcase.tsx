'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { SHOWCASE_PLAETZE, alleShowcaseArten, showcaseArt } from '@swisshub/modules/profil/showcase';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { showcaseSpeichernAction } from '@/modules/profile/profil-aktionen';
import { SpeicherLeiste, unveraendert, useQuittung } from './felder';

type Platz = { slot: number; kind: string; refId: string | null };

/**
 * Abschnitt «Showcase».
 *
 * ## Warum drei feste Plaetze und keine Liste
 *
 * Eine Vitrine mit «beliebig viele» waere keine Vitrine. Drei Plaetze
 * zwingen zur Auswahl, und genau die Auswahl ist die Aussage.
 *
 * ## Warum die Auswahllisten aus dem eigenen Bestand kommen
 *
 * Angeboten wird nur, was diesem Profil gehoert - eigene Spiele, eigene
 * Turniere, eigene Clip-Siege. Der Server prueft das beim Speichern noch
 * einmal: diese Liste ist eine Bequemlichkeit, keine Sicherung.
 */
export function AbschnittShowcase({
  csrfToken,
  start,
  auswahl,
  onSchmutzig,
}: {
  csrfToken: string;
  start: Platz[];
  auswahl: profile.EditorDaten['auswahl'];
  onSchmutzig: (schmutzig: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();

  const normalisiert = (liste: Platz[]): Array<Platz | null> =>
    Array.from({ length: SHOWCASE_PLAETZE }, (_, slot) => liste.find((p) => p.slot === slot) ?? null);

  const [gespeichert, setGespeichert] = useState(normalisiert(start));
  const [entwurf, setEntwurf] = useState(normalisiert(start));
  const [laeuft, setLaeuft] = useState(false);
  const [quittung, zeigeQuittung] = useQuittung();

  const schmutzig = !unveraendert(gespeichert, entwurf);

  const setze = (slot: number, platz: Platz | null): void => {
    const neu = entwurf.map((eintrag, index) => (index === slot ? platz : eintrag));
    setEntwurf(neu);
    onSchmutzig(!unveraendert(gespeichert, neu));
  };

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await showcaseSpeichernAction({
      csrfToken,
      plaetze: entwurf.filter((platz): platz is Platz => platz !== null),
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
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Drei Plätze im Profilkopf. Was du hier hinstellst, steht ganz oben - such dir aus, was andere zuerst
        sehen sollen.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {entwurf.map((platz, slot) => (
          <PlatzFeld
            key={slot}
            slot={slot}
            platz={platz}
            auswahl={auswahl}
            onChange={(neu) => setze(slot, neu)}
          />
        ))}
      </div>

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

function PlatzFeld({
  slot,
  platz,
  auswahl,
  onChange,
}: {
  slot: number;
  platz: Platz | null;
  auswahl: profile.EditorDaten['auswahl'];
  onChange: (platz: Platz | null) => void;
}): React.JSX.Element {
  const art = platz ? showcaseArt(platz.kind) : undefined;
  // Nur Typen anbieten, fuer die es auch etwas auszuwaehlen gibt - ein
  // «Turnier» ohne Turniere waere eine Sackgasse.
  const moeglich = alleShowcaseArten().filter(
    (eintrag) => !eintrag.brauchtVerweis || (auswahl[eintrag.key]?.length ?? 0) > 0,
  );
  const verweise = platz ? (auswahl[platz.kind] ?? []) : [];

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
          {slot + 1}
        </span>
        {art ? (
          <NavIcon name={art.symbol} className="size-4 text-primary-bright" />
        ) : (
          <span className="text-xs text-muted-foreground">leer</span>
        )}
      </div>

      <label className="block">
        <span className="sr-only">Typ für Platz {slot + 1}</span>
        <select
          value={platz?.kind ?? ''}
          onChange={(event) => {
            const kind = event.target.value;
            if (!kind) {
              onChange(null);
              return;
            }
            const definition = showcaseArt(kind);
            onChange({
              slot,
              kind,
              // Bei einem Typ mit Verweis gleich den ersten vorbelegen -
              // sonst stuende ein halb gefuellter Platz da, den das Schema
              // beim Speichern ablehnt.
              refId: definition?.brauchtVerweis ? (auswahl[kind]?.[0]?.id ?? null) : null,
            });
          }}
          className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-primary-bright"
        >
          <option value="">Nichts</option>
          {moeglich.map((eintrag) => (
            <option key={eintrag.key} value={eintrag.key}>
              {eintrag.label}
            </option>
          ))}
        </select>
      </label>

      {art?.brauchtVerweis ? (
        <label className="block">
          <span className="sr-only">Auswahl für Platz {slot + 1}</span>
          <select
            value={platz?.refId ?? ''}
            onChange={(event) =>
              platz ? onChange({ ...platz, refId: event.target.value || null }) : undefined
            }
            className="min-h-11 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-primary-bright"
          >
            {verweise.map((eintrag) => (
              <option key={eintrag.id} value={eintrag.id}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {art ? <p className="text-xs text-muted-foreground">{art.beschreibung}</p> : null}
    </div>
  );
}
