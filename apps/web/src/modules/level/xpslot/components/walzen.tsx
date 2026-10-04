'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * Walze 1 haelt zuerst, dann 2 bis 5 - ausser bei Quick Spin, wo alle
 * zusammen halten. Das ist die Dramatik eines Automaten, und sie entsteht aus
 * einer Zahl: `laufend[i]`. Die Zeiten stehen im Elternteil, weil sie dort mit
 * dem Ton zusammenhaengen; hier wird nur gezeigt, was schon entschieden ist.
 *
 * ## Die festsitzenden Wilds
 *
 * Ein Sticky Wild bleibt **waehrend des Laufs sichtbar**, und zwar an genau
 * seiner Position. Darum gibt es je Walze eine dritte Lage: `slot-haftend`
 * liegt ueber dem laufenden Band und zeigt die geklebten Zellen. Vorher
 * verschwand das Wild beim Anlaufen und war nach dem Stopp wieder da - das
 * sah aus, als werde es neu gezogen, und genau das soll es nicht.
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
  /** Der Schluessel des Wild-Symbols - fuer die haftende Lage. */
  wildKey?: string | null;
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
  wildKey = null,
  sweatAbWalze,
  reihen,
  walzen,
  linie = null,
}: WalzenProps): React.JSX.Element {
  const nachKey = useMemo(() => new Map(symbole.map((eintrag) => [eintrag.key, eintrag])), [symbole]);
  const trefferSet = useMemo(() => new Set(treffer), [treffer]);
  const klebtSet = useMemo(() => new Set(klebend), [klebend]);
  const wildSymbol = wildKey ? nachKey.get(wildKey) : undefined;

  const { rahmen, walzenRef, mitten, kasten } = useGeometrie(walzen, reihen);

  return (
    <div className="slot-walzen" ref={rahmen}>
      {Array.from({ length: walzen }, (_unused, walze) => {
        const laeuft = laufend[walze] === true;
        const sweat = laeuft && sweatAbWalze !== null && walze >= sweatAbWalze;
        const haftend = Array.from({ length: reihen }, (_leer, reihe) => walze * reihen + reihe).filter(
          (index) => klebtSet.has(index),
        );

        return (
          <div
            key={walze}
            ref={walzenRef(walze)}
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

            {/*
              Die haftende Lage - nur waehrend des Laufs und nur, wenn auf
              dieser Walze wirklich etwas klebt. Im Stillstand steht das Wild
              im Stand selbst; eine zweite Lage daruerber waere dasselbe Bild
              zweimal.
            */}
            {laeuft && wildSymbol && haftend.length > 0 ? (
              <div className="slot-haftend" aria-hidden="true">
                {haftend.map((index) => (
                  <div
                    key={index}
                    className="slot-haftend__zelle"
                    style={{ top: `calc(var(--slot-zelle) * ${index % reihen})` }}
                  >
                    <Zelle symbol={wildSymbol} klebt />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {/*
        Die Gewinnlinie liegt ueber dem Raster und rechnet in echten Pixeln -
        siehe `Gewinnlinie`.
      */}
      {linie && linie.length > 1 && mitten.length > 0 && kasten !== null ? (
        <Gewinnlinie zellen={linie} mitten={mitten} kasten={kasten} />
      ) : null}
    </div>
  );
}

/** Ein gemessener Punkt - die Mitte einer Zelle im Rahmen des Rasters. */
export interface Mitte {
  x: number;
  y: number;
}

/** Die gemessenen Masse des Rasters selbst - der Bezugsrahmen der Punkte. */
export interface Kasten {
  breite: number;
  hoehe: number;
}

/**
 * Die gemessene Geometrie des Rasters.
 *
 * ## Warum gemessen und nicht gerechnet
 *
 * Weil die Linie sonst neben den Symbolen liegt. Hier stand einmal eine
 * Rechnung: die Mitte der Walze `i` sei `(i + 0.5) / 5` der Rasterbreite.
 * Das stimmt nur ohne Abstand zwischen den Walzen und ohne Innenabstand am
 * Raster - und beides gibt es. Mit `gap` und `padding` liegt die wahre Mitte
 * bei `padding + i * (zelle + gap) + zelle / 2`, und die Abweichung waechst
 * dort, wo die Zellen klein sind: auf dem Tablet und auf dem Telefon lag die
 * Linie um ein Zehntel einer Zelle daneben.
 *
 * Dazu kam ein zweiter Fehler: `viewBox="0 0 100 60"` mit
 * `preserveAspectRatio="none"` streckt die Zeichnung auf die Flaeche. Ein
 * Raster, das nicht genau im Verhaeltnis 100:60 steht - und es steht nie
 * genau darin -, bekommt damit eine Linie, die in x und y unterschiedlich
 * stark verzerrt ist.
 *
 * Darum wird jetzt gemessen. Die Walzenelemente stehen immer im Baum, auch
 * waehrend sie laufen; ihre Kaesten sagen, wo die Zellen wirklich sind. Jede
 * Groessenaenderung - Fenster, Drehung, Tastatur auf dem Telefon, eine
 * aufgehende Seitenleiste - laeuft ueber denselben Beobachter.
 */
function useGeometrie(
  walzen: number,
  reihen: number,
): {
  rahmen: (element: HTMLDivElement | null) => void;
  walzenRef: (walze: number) => (element: HTMLDivElement | null) => void;
  mitten: Mitte[];
  kasten: Kasten | null;
} {
  const rahmenRef = useRef<HTMLDivElement | null>(null);
  const walzenEls = useRef<Array<HTMLDivElement | null>>([]);
  const [mitten, setMitten] = useState<Mitte[]>([]);
  /*
   * Der Rahmen wird mitgemessen, weil die `viewBox` der Linie genau er ist.
   *
   * Hier stand einmal `max(x) * 2` als Breite - die Annahme, der Kasten sei
   * doppelt so breit wie die Mitte der letzten Walze. Das ist falsch: bei
   * fuenf Walzen ist der Kasten `max(x) + min(x)` breit, und `max(x) * 2` ist
   * deutlich mehr. Eine zu grosse `viewBox` wird vom Standardverhalten
   * (`xMidYMid meet`) gleichmaessig verkleinert und neu zentriert - die Linie
   * lag damit zu kurz und verschoben ueber den Symbolen, also genau der
   * Fehler, der behoben werden sollte.
   */
  const [kasten, setKasten] = useState<Kasten | null>(null);

  const messen = useCallback(() => {
    const kasten = rahmenRef.current?.getBoundingClientRect();
    if (!kasten) {
      return;
    }
    setKasten((vorher) =>
      vorher !== null &&
      Math.abs(vorher.breite - kasten.width) < 0.5 &&
      Math.abs(vorher.hoehe - kasten.height) < 0.5
        ? vorher
        : { breite: kasten.width, hoehe: kasten.height },
    );
    const punkte: Mitte[] = [];
    for (let walze = 0; walze < walzen; walze += 1) {
      const element = walzenEls.current[walze];
      if (!element) {
        return;
      }
      const w = element.getBoundingClientRect();
      // Die Walze ist genau `reihen` Zellen hoch - ihre Reihenmitten liegen
      // deshalb in ihrem eigenen Kasten, unabhaengig davon, welche Lage
      // gerade darin steckt.
      for (let reihe = 0; reihe < reihen; reihe += 1) {
        punkte[walze * reihen + reihe] = {
          x: w.left - kasten.left + w.width / 2,
          y: w.top - kasten.top + (w.height / reihen) * (reihe + 0.5),
        };
      }
    }
    setMitten((vorher) =>
      vorher.length === punkte.length &&
      vorher.every((punkt, index) => {
        const neu = punkte[index];
        return neu !== undefined && Math.abs(punkt.x - neu.x) < 0.5 && Math.abs(punkt.y - neu.y) < 0.5;
      })
        ? vorher
        : punkte,
    );
  }, [reihen, walzen]);

  useEffect(() => {
    messen();
    if (typeof window === 'undefined') {
      return;
    }
    /*
     * `ResizeObserver` statt `window.resize`: das Raster aendert seine Groesse
     * auch ohne Fensteraenderung - wenn eine Seitenleiste aufgeht, wenn die
     * Schriftgroesse wechselt, wenn `vh` auf dem Telefon beim Scrollen
     * nachgibt. Der Beobachter sieht alle drei Faelle, `resize` keinen davon.
     */
    const beobachter =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            messen();
          })
        : null;
    if (beobachter && rahmenRef.current) {
      beobachter.observe(rahmenRef.current);
      for (const element of walzenEls.current) {
        if (element) {
          beobachter.observe(element);
        }
      }
    }
    // Die Drehung eines Tablets aendert die Masse, ohne dass der Beobachter
    // in jedem Browser frueh genug anschlaegt - deshalb beides.
    window.addEventListener('orientationchange', messen);
    window.addEventListener('resize', messen);
    return () => {
      beobachter?.disconnect();
      window.removeEventListener('orientationchange', messen);
      window.removeEventListener('resize', messen);
    };
  }, [messen]);

  const rahmen = useCallback(
    (element: HTMLDivElement | null) => {
      rahmenRef.current = element;
      if (element) {
        messen();
      }
    },
    [messen],
  );

  const walzenRef = useCallback(
    (walze: number) => (element: HTMLDivElement | null) => {
      walzenEls.current[walze] = element;
      if (element) {
        messen();
      }
    },
    [messen],
  );

  return { rahmen, walzenRef, mitten, kasten };
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
 * Die Gewinnlinie als Pfad durch gemessene Punkte.
 *
 * Die `viewBox` ist der Kasten des Rasters in echten Pixeln, und es gibt
 * keine Streckung: ein Punkt in der Zeichnung ist ein Punkt auf dem
 * Bildschirm. Damit liegt die Linie auf jedem Geraet ueber den Symbolen - auf
 * dem iPad genauso wie auf 1920 Pixeln, und nach einer Drehung auch.
 */
export function Gewinnlinie({
  zellen,
  mitten,
  kasten,
}: {
  zellen: readonly number[];
  mitten: readonly Mitte[];
  kasten: Kasten;
}): React.JSX.Element | null {
  const punkte = zellen.map((index) => mitten[index]).filter((punkt): punkt is Mitte => punkt !== undefined);
  if (punkte.length < 2 || kasten.breite <= 0 || kasten.hoehe <= 0) {
    return null;
  }

  return (
    <svg
      className="slot-linie"
      viewBox={`0 0 ${kasten.breite.toFixed(1)} ${kasten.hoehe.toFixed(1)}`}
      aria-hidden="true"
    >
      <path d={`M ${punkte.map((punkt) => `${punkt.x.toFixed(1)},${punkt.y.toFixed(1)}`).join(' L ')}`} />
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
