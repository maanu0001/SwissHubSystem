'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

/**
 * Die Bausteine des Editors.
 *
 * ## Warum Chips und keine Mehrfachauswahlliste
 *
 * Ein `<select multiple>` ist auf dem Telefon kaum bedienbar und zeigt nie
 * mehr als vier Zeilen. Eine Reihe antippbarer Marken zeigt alles auf
 * einmal, braucht keine Taste zum Mehrfachwaehlen und ist mit dem Daumen zu
 * treffen - 44 Pixel hoch, wie es sich gehoert.
 */

export function Feldgruppe({
  titel,
  hinweis,
  children,
}: {
  titel: string;
  hinweis?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{titel}</p>
        {hinweis ? <p className="text-xs text-muted-foreground">{hinweis}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function ChipAuswahl({
  optionen,
  gewaehlt,
  onChange,
  maxAnzahl,
  einfach = false,
}: {
  optionen: ReadonlyArray<{ key: string; label: string }>;
  gewaehlt: readonly string[];
  onChange: (werte: string[]) => void;
  maxAnzahl?: number;
  /** Nur eine Wahl - dann wirkt die Gruppe wie ein Radiofeld. */
  einfach?: boolean;
}): React.JSX.Element {
  const umschalten = (key: string): void => {
    if (einfach) {
      onChange([key]);
      return;
    }
    if (gewaehlt.includes(key)) {
      onChange(gewaehlt.filter((wert) => wert !== key));
      return;
    }
    // Die Obergrenze hier abzufangen erspart eine Fehlermeldung nach dem
    // Speichern fuer etwas, das man beim Antippen schon weiss.
    if (maxAnzahl !== undefined && gewaehlt.length >= maxAnzahl) {
      return;
    }
    onChange([...gewaehlt, key]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {optionen.map((option) => {
        const aktiv = gewaehlt.includes(option.key);
        const gesperrt = !aktiv && !einfach && maxAnzahl !== undefined && gewaehlt.length >= maxAnzahl;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={aktiv}
            disabled={gesperrt}
            onClick={() => umschalten(option.key)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors ${
              aktiv
                ? 'border-primary-bright bg-primary-bright/12 text-foreground'
                : 'border-border text-muted-foreground hover:border-foreground/30'
            } ${gesperrt ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TextFeld({
  wert,
  onChange,
  maxLaenge,
  mehrzeilig = false,
  platzhalter,
  label,
}: {
  wert: string;
  onChange: (wert: string) => void;
  maxLaenge: number;
  mehrzeilig?: boolean;
  platzhalter?: string;
  label: string;
}): React.JSX.Element {
  const klasse =
    'w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none transition-colors focus-visible:border-primary-bright';

  return (
    <div>
      {mehrzeilig ? (
        <textarea
          value={wert}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLaenge}
          rows={5}
          placeholder={platzhalter}
          aria-label={label}
          className={`${klasse} resize-y`}
        />
      ) : (
        <input
          type="text"
          value={wert}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLaenge}
          placeholder={platzhalter}
          aria-label={label}
          className={`${klasse} min-h-11`}
        />
      )}
      {/* Die Zahl erscheint erst ab drei Vierteln: sonst steht unter jedem
          leeren Feld eine Null, die niemanden interessiert. */}
      {wert.length > maxLaenge * 0.75 ? (
        <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
          {wert.length} / {maxLaenge}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Die Speicherleiste eines Abschnitts.
 *
 * Drei Zustaende, und jeder ist ablesbar: unveraendert (Knopf aus),
 * ungespeichert (Knopf an, Hinweis daneben), gerade gespeichert (Haken, der
 * nach ein paar Sekunden geht). Ein Knopf, der immer gleich aussieht, laesst
 * offen, ob gerade etwas passiert ist.
 */
export function SpeicherLeiste({
  schmutzig,
  laeuft,
  gespeichert,
  onSpeichern,
  onVerwerfen,
}: {
  schmutzig: boolean;
  laeuft: boolean;
  gespeichert: boolean;
  onSpeichern: () => void;
  onVerwerfen: () => void;
}): React.JSX.Element {
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
      {gespeichert && !schmutzig ? (
        <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-success">
          <Check className="size-3.5" aria-hidden="true" />
          Gespeichert
        </span>
      ) : null}
      {schmutzig ? <span className="mr-auto text-xs text-warning">Nicht gespeicherte Änderungen</span> : null}

      {schmutzig ? (
        <button
          type="button"
          onClick={onVerwerfen}
          className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Verwerfen
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSpeichern}
        disabled={!schmutzig || laeuft}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
      >
        {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Speichern
      </button>
    </div>
  );
}

/**
 * Gleichheit zweier Entwuerfe.
 *
 * `JSON.stringify` reicht: die Entwuerfe bestehen aus Zeichenketten,
 * Wahrheitswerten und Listen davon, und die Schluesselreihenfolge ist durch
 * den Anfangszustand festgelegt. Ein tiefer Vergleich waere mehr Code fuer
 * dasselbe Ergebnis.
 */
export function unveraendert<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Warnt, bevor ein Tab mit ungespeicherten Aenderungen geschlossen wird.
 *
 * Nur die Browserwarnung - der Wechsel zwischen den Abschnitten des Editors
 * wird in der Schale selbst abgefangen, weil eine Navigation innerhalb der
 * Anwendung kein `beforeunload` ausloest.
 */
export function useSchliessSchutz(aktiv: boolean): void {
  useEffect(() => {
    if (!aktiv) {
      return;
    }
    const warnen = (ereignis: BeforeUnloadEvent): void => {
      ereignis.preventDefault();
      ereignis.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [aktiv]);
}

/** Zeigt «Gespeichert» ein paar Sekunden lang an. */
export function useQuittung(): [boolean, () => void] {
  const [sichtbar, setSichtbar] = useState(false);
  const zeit = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (zeit.current) {
        clearTimeout(zeit.current);
      }
    },
    [],
  );

  return [
    sichtbar,
    () => {
      setSichtbar(true);
      if (zeit.current) {
        clearTimeout(zeit.current);
      }
      zeit.current = setTimeout(() => setSichtbar(false), 4000);
    },
  ];
}
