'use client';

import { useState } from 'react';
import { ClipKarte } from './clip-karte';
import type { clips } from '@swisshub/modules';

export interface GalerieEintrag {
  karte: clips.ClipKarte;
  einbettung: string;
}

/**
 * Das Raster der Clips.
 *
 * ## Warum das Stimmenkonto hier liegt
 *
 * Eine Stimme aendert nicht nur die Karte, auf die geklickt wurde: sie
 * verbraucht das Kontingent, und damit muessen die uebrigen Karten wissen,
 * ob noch etwas uebrig ist. Laege der Zaehler in jeder Karte, wuerden zwanzig
 * Karten zwanzig verschiedene Antworten geben, bis die Seite neu laedt.
 *
 * ## Das Raster
 *
 * Auf dem Telefon eine Karte je Zeile - ein Clip ist ein Video, und ein
 * halbes Video nebeneinander sieht niemand an. Ab Tablet zwei, auf grossen
 * Schirmen drei. Vier waeren auf 1440 Pixeln Briefmarken.
 */
export function Galerie({
  eintraege,
  csrfToken,
  abstimmbar,
  verbleibendeStimmen,
  selbstwahlErlaubt,
}: {
  eintraege: GalerieEintrag[];
  csrfToken: string;
  abstimmbar: boolean;
  verbleibendeStimmen: number;
  selbstwahlErlaubt: boolean;
}): React.JSX.Element {
  const [kontingent, setKontingent] = useState(verbleibendeStimmen);

  return (
    <>
      {abstimmbar ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {kontingent > 0 ? (
            <>
              Noch <strong className="text-foreground tabular-nums">{kontingent}</strong>{' '}
              {kontingent === 1 ? 'Stimme' : 'Stimmen'} übrig.
            </>
          ) : (
            <>Alle Stimmen vergeben. Du kannst eine Stimme zurückziehen und neu setzen.</>
          )}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {eintraege.map((eintrag) => (
          <ClipKarte
            key={eintrag.karte.entryId}
            karte={eintrag.karte}
            einbettung={eintrag.einbettung}
            csrfToken={csrfToken}
            abstimmbar={abstimmbar}
            verbleibendeStimmen={kontingent}
            selbstwahlErlaubt={selbstwahlErlaubt}
            aufStimmeGeaendert={setKontingent}
          />
        ))}
      </div>
    </>
  );
}
