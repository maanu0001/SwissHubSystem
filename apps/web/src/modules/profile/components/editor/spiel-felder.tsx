'use client';

import * as spielfelder from '@swisshub/modules/profil/spielfelder';
import { ChipAuswahl, Feldgruppe, TextFeld } from './felder';

/**
 * Die spielabhaengigen Felder im Editor.
 *
 * Welche Felder ein Spiel hat, steht in `profil/spielfelder.ts` - und nur
 * dort. Diese Datei kennt kein einziges Spiel beim Namen: sie liest die
 * Registry und baut daraus Felder. Ein neues Spiel braucht hier keine Zeile
 * und keine Migration.
 */
export function SpielFelder({
  spielName,
  werte,
  onChange,
}: {
  spielName: string;
  werte: Record<string, unknown>;
  onChange: (werte: Record<string, unknown>) => void;
}): React.JSX.Element | null {
  const felder = spielfelder.felderFuer(spielName);
  if (felder.length === 0) {
    return null;
  }

  const setze = (key: string, wert: unknown): void => {
    const neu = { ...werte };
    // Leeres wird entfernt statt als leerer Text gespeichert: sonst steht im
    // Profil eine Zeile «Rang:» ohne Rang.
    if (wert === '' || (Array.isArray(wert) && wert.length === 0)) {
      delete neu[key];
    } else {
      neu[key] = wert;
    }
    onChange(neu);
  };

  return (
    <div className="space-y-4">
      {felder.map((feld) => {
        if (feld.art === 'text') {
          return (
            <Feldgruppe key={feld.key} titel={feld.label} hinweis={feld.hilfe}>
              <TextFeld
                label={feld.label}
                wert={typeof werte[feld.key] === 'string' ? (werte[feld.key] as string) : ''}
                onChange={(wert) => setze(feld.key, wert)}
                maxLaenge={feld.maxLaenge ?? 40}
              />
            </Feldgruppe>
          );
        }

        const gewaehlt = Array.isArray(werte[feld.key])
          ? (werte[feld.key] as string[])
          : typeof werte[feld.key] === 'string'
            ? [werte[feld.key] as string]
            : [];

        return (
          <Feldgruppe key={feld.key} titel={feld.label} hinweis={feld.hilfe}>
            <ChipAuswahl
              optionen={(feld.optionen ?? []).map((option) => ({ key: option, label: option }))}
              gewaehlt={gewaehlt}
              onChange={(werteNeu) =>
                setze(feld.key, feld.art === 'auswahl' ? (werteNeu[0] ?? '') : werteNeu)
              }
              einfach={feld.art === 'auswahl'}
              maxAnzahl={feld.art === 'mehrfachauswahl' ? feld.maxAnzahl : undefined}
            />
          </Feldgruppe>
        );
      })}
    </div>
  );
}
