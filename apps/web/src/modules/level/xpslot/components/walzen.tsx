'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { WalzenBild, type Kasten, type Mitte, type WalzenBaumProps } from './walzenbild';

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

export type { SymbolBild, Mitte, Kasten, WalzenBaumProps } from './walzenbild';
export { Gewinnlinie } from './walzenbild';
export type { WalzenBaumProps as WalzenProps } from './walzenbild';

/**
 * Die fuenf Walzen - Baum plus Geometrie.
 *
 * Diese Datei ist die Haelfte, die den Browser anfasst: sie misst das Raster
 * und beobachtet seine Groesse. Der Baum steht in `walzenbild.tsx`, und dort
 * steht auch, warum der Schnitt an dieser Stelle liegt.
 */
export function Walzen(eigenschaften: WalzenBaumProps): React.JSX.Element {
  const { rahmen, walzenRef, mitten, kasten } = useGeometrie(eigenschaften.walzen, eigenschaften.reihen);

  return (
    <WalzenBild {...eigenschaften} rahmen={rahmen} walzenRef={walzenRef} mitten={mitten} kasten={kasten} />
  );
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

  /**
   * Eine Messung anmelden - hoechstens eine je Bild.
   *
   * ## Der Fehler, den das behebt
   *
   * `messen()` stand vorher direkt in den Ref-Rueckrufen, und diese wurden
   * **inline** erzeugt (`ref={walzenRef(walze)}`). Eine inline erzeugte
   * Funktion ist bei jedem Rendern eine andere, und React loest einen Ref
   * dann ab und haengt ihn neu an - also lief bei jedem Rendern fuenfmal
   * `messen()`, und jeder Durchgang holt sechs `getBoundingClientRect`.
   *
   * Gemessen waren das **207 erzwungene Layoutberechnungen je Spin**, jede
   * davon synchron mitten in einer laufenden CSS-Animation. Das ist der
   * Grund, weshalb sich die Maschine anfuehlte, als komme sie nicht nach:
   * nicht die Animation war zu teuer, sondern das Nachmessen daneben.
   *
   * Jetzt sind die Rueckrufe stabil - sie haengen genau einmal an -, und
   * jede Messung laeuft gebuendelt im naechsten Bild. Mehrere Anlaesse im
   * selben Bild werden eine Messung.
   */
  const bild = useRef(0);
  const planen = useCallback(() => {
    if (typeof window === 'undefined') {
      messen();
      return;
    }
    if (bild.current !== 0) {
      return;
    }
    bild.current = window.requestAnimationFrame(() => {
      bild.current = 0;
      messen();
    });
  }, [messen]);

  useEffect(() => {
    planen();
    if (typeof window === 'undefined') {
      return;
    }
    /*
     * `ResizeObserver` statt `window.resize`: das Raster aendert seine Groesse
     * auch ohne Fensteraenderung - wenn eine Seitenleiste aufgeht, wenn die
     * Schriftgroesse wechselt, wenn `vh` auf dem Telefon beim Scrollen
     * nachgibt. Der Beobachter sieht alle drei Faelle, `resize` keinen davon.
     *
     * Beobachtet wird der **Rahmen**, nicht jede Walze: die Zellengroesse
     * haengt an der Breite des Rahmens (`cqw`), eine Walze kann sich also
     * nicht ohne ihn aendern. Fuenf Beobachter fuer dieselbe Aussage waeren
     * fuenf Rueckrufe je Aenderung.
     */
    const beobachter =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            planen();
          })
        : null;
    if (beobachter && rahmenRef.current) {
      beobachter.observe(rahmenRef.current);
    }
    // Die Drehung eines Tablets aendert die Masse, ohne dass der Beobachter
    // in jedem Browser frueh genug anschlaegt - deshalb beides.
    window.addEventListener('orientationchange', planen);
    window.addEventListener('resize', planen);
    return () => {
      beobachter?.disconnect();
      window.removeEventListener('orientationchange', planen);
      window.removeEventListener('resize', planen);
      if (bild.current !== 0) {
        window.cancelAnimationFrame(bild.current);
        bild.current = 0;
      }
    };
  }, [planen]);

  const rahmen = useCallback(
    (element: HTMLDivElement | null) => {
      rahmenRef.current = element;
      if (element) {
        planen();
      }
    },
    [planen],
  );

  /*
   * Je Walze **ein** Rueckruf, und zwar immer derselbe.
   *
   * Das ist der Kern des Fixes: `walzenRef(2)` gibt bei jedem Rendern
   * dieselbe Funktion zurueck, also laesst React den Ref in Ruhe. Die Liste
   * entsteht neu, wenn sich die Zahl der Walzen aendert - und nur dann.
   */
  const rueckrufe = useMemo(
    () =>
      Array.from({ length: walzen }, (_unused, walze) => (element: HTMLDivElement | null) => {
        walzenEls.current[walze] = element;
        if (element) {
          planen();
        }
      }),
    [planen, walzen],
  );

  const walzenRef = useCallback((walze: number) => rueckrufe[walze] ?? (() => undefined), [rueckrufe]);

  return { rahmen, walzenRef, mitten, kasten };
}

/**
 * Die Funken.
 *
 * ## Zwei Urspruenge, ein Effekt
 *
 * Auf der Buehne treiben sie von **unten** nach oben - das ist die Bewegung,
 * die zu einer Maschine passt, deren Gewinn unten steht. In einer grossen
 * Meldung gehen sie vom **Zentrum** aus, und zwar vom Zentrum genau dieses
 * Kastens.
 *
 * ## Der Fehler, den der zweite Ursprung behebt
 *
 * In der Meldung lief bisher derselbe Effekt wie auf der Buehne: Funken vom
 * unteren Rand, waagrecht ueber die ganze Breite verteilt. Das sah nicht
 * zentriert aus, weil es nicht zentriert war - und der obere Rand der Karte
 * schnitt sie ab, weil dort `overflow: hidden` stand.
 *
 * Der Ursprung ist jetzt ein Punkt ohne eigene Groesse bei 50 % / 50 % des
 * Kastens. Damit ist er immer das echte Zentrum - auf dem Telefon wie auf
 * dem Schreibtisch, und auch dann, wenn die Karte wegen eines langen Textes
 * hoeher wird. Keine Viewport-Mitte, keine festen Pixel.
 */
export function Partikel({
  anzahl = 12,
  ursprung = 'unten',
}: {
  anzahl?: number;
  ursprung?: 'unten' | 'mitte';
}): React.JSX.Element {
  const mitte = ursprung === 'mitte';

  return (
    <div className={cn('slot-partikel', mitte && 'slot-partikel--mitte')} aria-hidden="true">
      {Array.from({ length: anzahl }, (_unused, index) => {
        if (!mitte) {
          return (
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
          );
        }
        /*
         * Der goldene Winkel verteilt die Richtungen gleichmaessig.
         *
         * 137,5 Grad je Funke heisst: keine zwei liegen uebereinander, und es
         * entsteht keine sichtbare Speichenform - die bekaeme man mit
         * `360 / anzahl` sofort.
         */
        const winkel = (index * 137.5 * Math.PI) / 180;
        const weite = 0.62 + ((index * 7) % 5) * 0.095;
        return (
          <span
            key={index}
            style={{
              animationDuration: `${1.5 + (index % 5) * 0.22}s`,
              animationDelay: `${(index % 7) * 0.085}s`,
              ['--dx' as string]: `calc(var(--slot-funken-weite) * ${(Math.cos(winkel) * weite).toFixed(3)})`,
              ['--dy' as string]: `calc(var(--slot-funken-weite) * ${(Math.sin(winkel) * weite).toFixed(3)})`,
            }}
          />
        );
      })}
    </div>
  );
}
