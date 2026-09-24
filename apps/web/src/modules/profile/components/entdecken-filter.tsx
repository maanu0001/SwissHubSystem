'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import * as angaben from '@swisshub/modules/profil/angaben';

/**
 * Die Filterleiste von «Mitglieder entdecken».
 *
 * ## Warum die Adresse der Zustand ist
 *
 * Jede Auswahl landet in der Adresszeile, und der Server liest sie von dort.
 * Das hat drei Folgen, die alle erwuenscht sind: ein Filterstand ist
 * teilbar, der Zurueck-Knopf funktioniert, und es gibt keinen zweiten
 * Zustand im Browser, der mit dem des Servers auseinanderlaufen koennte.
 *
 * Gefiltert wird ausschliesslich in der Datenbank - siehe
 * `profil/entdecken.ts`. Diese Datei sortiert nichts und filtert nichts; sie
 * stellt nur die Frage.
 *
 * ## Warum die Suche wartet
 *
 * Bei jedem Tastenanschlag zu navigieren hiesse, fuer «Michael» sieben
 * Abfragen ueber mehrere tausend Mitglieder zu starten. 350 ms Ruhe genuegt,
 * damit daraus eine wird.
 */
export function EntdeckenFilter({
  spiele,
}: {
  spiele: Array<{ id: string; name: string; anzahl: number }>;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [suche, setSuche] = useState(params.get('suche') ?? '');
  const ersterLauf = useRef(true);

  const setze = (schluessel: string, wert: string): void => {
    const naechste = new URLSearchParams(params.toString());
    if (wert) {
      naechste.set(schluessel, wert);
    } else {
      naechste.delete(schluessel);
    }
    // Jede Aenderung beginnt wieder auf Seite 1: Seite 7 eines anderen
    // Filters ist fast immer leer.
    naechste.delete('seite');
    router.replace(`?${naechste.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (ersterLauf.current) {
      ersterLauf.current = false;
      return;
    }
    const zeit = setTimeout(() => setze('suche', suche.trim()), 350);
    return () => clearTimeout(zeit);
    /*
     * Nur `suche` in der Liste: `setze` liest `params` und waere bei jeder
     * Navigation eine neue Funktion - die Wartezeit finge dann von vorne an,
     * und die Suche loeste nie aus.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche]);

  const aktiv = [...params.keys()].filter((key) => key !== 'seite').length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={suche}
          onChange={(event) => setSuche(event.target.value)}
          placeholder="Name suchen …"
          aria-label="Mitglied suchen"
          className="h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none transition-colors focus-visible:border-primary-bright"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Auswahl
          label="Spiel"
          wert={params.get('gameId') ?? ''}
          onChange={(wert) => setze('gameId', wert)}
          optionen={spiele.map((spiel) => ({ key: spiel.id, label: `${spiel.name} (${spiel.anzahl})` }))}
        />
        <Auswahl
          label="Plattform"
          wert={params.get('plattform') ?? ''}
          onChange={(wert) => setze('plattform', wert)}
          optionen={angaben.PLATTFORMEN.map((eintrag) => ({ key: eintrag.key, label: eintrag.label }))}
        />
        <Auswahl
          label="Spielart"
          wert={params.get('spielart') ?? ''}
          onChange={(wert) => setze('spielart', wert)}
          optionen={angaben.SPIELART.map((eintrag) => ({ key: eintrag.key, label: eintrag.label }))}
        />
        <Auswahl
          label="Sprache"
          wert={params.get('sprache') ?? ''}
          onChange={(wert) => setze('sprache', wert)}
          optionen={angaben.SPRACHEN.map((eintrag) => ({ key: eintrag.key, label: eintrag.label }))}
        />
        <Auswahl
          label="Spielzeit"
          wert={params.get('spielzeit') ?? ''}
          onChange={(wert) => setze('spielzeit', wert)}
          optionen={angaben.SPIELZEITEN.map((eintrag) => ({ key: eintrag.key, label: eintrag.label }))}
        />
        <Auswahl
          label="Status"
          wert={params.get('verfuegbarkeit') ?? ''}
          onChange={(wert) => setze('verfuegbarkeit', wert)}
          optionen={angaben.VERFUEGBARKEIT.filter((eintrag) => eintrag.key !== 'UNSET').map((eintrag) => ({
            key: eintrag.key,
            label: eintrag.label,
          }))}
        />

        {aktiv ? (
          <button
            type="button"
            onClick={() => {
              setSuche('');
              router.replace('?', { scroll: false });
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            Filter zurücksetzen
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Auswahl({
  label,
  wert,
  onChange,
  optionen,
}: {
  label: string;
  wert: string;
  onChange: (wert: string) => void;
  optionen: Array<{ key: string; label: string }>;
}): React.JSX.Element | null {
  if (optionen.length === 0) {
    return null;
  }

  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={wert}
        onChange={(event) => onChange(event.target.value)}
        className={`h-9 rounded-lg border bg-card px-3 text-xs outline-none transition-colors focus-visible:border-primary-bright ${
          wert ? 'border-primary-bright text-foreground' : 'border-border text-muted-foreground'
        }`}
      >
        <option value="">{label}</option>
        {optionen.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
