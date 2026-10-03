'use client';

import { useMemo } from 'react';
import { symbolBild } from '../adressen';
import { cn } from '@/lib/utils';

/**
 * Die fuenf Walzen.
 *
 * ## Was diese Komponente nicht tut
 *
 * Sie entscheidet nichts. Das Spielfeld kommt fertig vom Server; hier wird es
 * gezeigt. Waehrend eine Walze laeuft, laufen **Fuellsymbole** durch - sie
 * haben mit dem Ergebnis nichts zu tun und sind auch nicht aus ihm abgeleitet.
 * Wer sie anhaelt, sieht keine Vorschau, sondern Fuellung.
 *
 * ## Die gestaffelten Stopps
 *
 * Walze 1 haelt zuerst, dann 2 bis 5. Das ist die ganze Dramatik eines
 * Automaten, und sie entsteht aus einer Zahl: `stoppt[i]`. Die Zeiten stehen
 * im Elternteil, weil sie dort mit dem Ton zusammenhaengen - hier wird nur
 * gezeigt, was schon entschieden ist.
 */

export interface SymbolBild {
  key: string;
  name: string;
  bildPfad: string | null;
  bildUrl: string | null;
  glow: boolean;
}

export interface WalzenProps {
  /** 15 Symbolschluessel, Index `walze * 3 + reihe`. */
  grid: string[];
  symbole: readonly SymbolBild[];
  /** Je Walze: laeuft sie noch? */
  laufend: readonly boolean[];
  /** Zellen, die zu einem Treffer gehoeren. */
  treffer: readonly number[];
  /** Zellen mit festsitzendem Wild. */
  klebend: readonly number[];
  /** Ab dieser Walze war der Bonus noch offen. */
  sweatAbWalze: number | null;
  reihen: number;
  walzen: number;
  /** Die Zellen der hervorgehobenen Gewinnlinie - oder nichts. */
  linie?: readonly number[] | null;
}

/** Ein zufaelliges Fuellsymbol - nur fuer das laufende Band. */
function fuellung(symbole: readonly SymbolBild[], index: number): SymbolBild | undefined {
  return symbole[index % Math.max(1, symbole.length)];
}

export function Walzen({
  grid,
  symbole,
  laufend,
  treffer,
  klebend,
  sweatAbWalze,
  reihen,
  walzen,
  linie = null,
}: WalzenProps): React.JSX.Element {
  const nachKey = useMemo(() => new Map(symbole.map((eintrag) => [eintrag.key, eintrag])), [symbole]);
  const trefferSet = useMemo(() => new Set(treffer), [treffer]);
  const klebtSet = useMemo(() => new Set(klebend), [klebend]);

  return (
    <div className="slot-walzen">
      {Array.from({ length: walzen }, (_unused, walze) => {
        const laeuft = laufend[walze] === true;
        const sweat = laeuft && sweatAbWalze !== null && walze >= sweatAbWalze;

        return (
          <div
            key={walze}
            className={cn('slot-walze', !laeuft && 'slot-walze--stopp', sweat && 'slot-walze--sweat')}
          >
            {/*
              Zwei Klassen fuer zwei Zustaende, beide absolut im Walzenfenster:
              `slot-band` traegt die Fuellzellen und laeuft, `slot-stand` traegt
              das Ergebnis und federt beim Stopp aus. Weil beide absolut liegen,
              aendert der Wechsel die Hoehe der Walze nicht - und genau das war
              der Fehler, bei dem sich die Maschine waehrend des Spins dehnte.
            */}
            <div className={laeuft ? 'slot-band' : 'slot-stand'}>
              {laeuft
                ? /*
                   * Sechs Fuellzellen statt drei: das Band muss ueber die
                   * sichtbare Hoehe hinausreichen, sonst gaebe es beim
                   * Umlauf eine Luecke.
                   */
                  Array.from({ length: reihen * 2 }, (_leer, reihe) => (
                    <Zelle key={`fuell-${reihe}`} symbol={fuellung(symbole, walze * 7 + reihe * 3)} />
                  ))
                : Array.from({ length: reihen }, (_leer, reihe) => {
                    const index = walze * reihen + reihe;
                    return (
                      <Zelle
                        key={index}
                        symbol={nachKey.get(grid[index] ?? '')}
                        treffer={trefferSet.has(index)}
                        klebt={klebtSet.has(index)}
                      />
                    );
                  })}
            </div>
          </div>
        );
      })}

      {/*
        Die Linie liegt im Raster und nicht darueber: das Raster ist zentriert
        und nur so breit wie fuenf Walzen, der Kasten darum ist breiter. Eine
        Linie, die sich am Kasten ausrichtet, traefe die Zellen nicht.
      */}
      {linie && linie.length > 1 ? <Gewinnlinie zellen={linie} reihen={reihen} walzen={walzen} /> : null}
    </div>
  );
}

function Zelle({
  symbol,
  treffer = false,
  klebt = false,
}: {
  symbol: SymbolBild | undefined;
  treffer?: boolean;
  klebt?: boolean;
}): React.JSX.Element {
  const bild = symbol ? symbolBild(symbol) : null;

  return (
    <div
      className={cn(
        'slot-zelle',
        symbol?.glow && 'slot-zelle--glow',
        treffer && 'slot-zelle--treffer',
        klebt && 'slot-zelle--klebt',
      )}
    >
      {bild ? (
        // Bewusst `img` und nicht `next/image`: die Datei kommt aus einem
        // Route Handler mit eigenem Cache-Kopf, und der Optimierer von Next
        // wuerde sie durch eine zweite Umwandlung schicken, die bei einem
        // 128x128-Symbol nichts spart.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="slot-zelle__bild" src={bild} alt={symbol?.name ?? ''} draggable={false} />
      ) : (
        <span className="slot-zelle__text">{symbol?.name ?? '?'}</span>
      )}
    </div>
  );
}

/**
 * Die Gewinnlinie als Pfad.
 *
 * Gezeichnet in einem Koordinatensystem von 100x60, damit die Form unabhaengig
 * von der tatsaechlichen Groesse stimmt - `preserveAspectRatio="none"` zieht
 * sie auf das Spielfeld.
 */
export function Gewinnlinie({
  zellen,
  reihen,
  walzen,
}: {
  zellen: readonly number[];
  reihen: number;
  walzen: number;
}): React.JSX.Element | null {
  if (zellen.length < 2) {
    return null;
  }
  const punkte = zellen.map((index) => {
    const walze = Math.trunc(index / reihen);
    const reihe = index % reihen;
    const x = ((walze + 0.5) / walzen) * 100;
    const y = ((reihe + 0.5) / reihen) * 60;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg className="slot-linie" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <path d={`M ${punkte.join(' L ')}`} />
    </svg>
  );
}

/** Die treibenden Punkte bei einem Gewinn. */
export function Partikel({ anzahl = 12 }: { anzahl?: number }): React.JSX.Element {
  return (
    <div className="slot-partikel" aria-hidden="true">
      {Array.from({ length: anzahl }, (_unused, index) => (
        <span
          key={index}
          style={{
            left: `${(index * 97) % 100}%`,
            animationDuration: `${2.4 + (index % 5) * 0.35}s`,
            animationDelay: `${(index % 7) * 0.18}s`,
            // Eine Drift je Punkt, damit nicht zwoelf Punkte dieselbe Bahn
            // fliegen - das sieht nach einem Fehler aus, nicht nach Funken.
            ['--drift' as string]: `${((index % 5) - 2) * 14}px`,
          }}
        />
      ))}
    </div>
  );
}
