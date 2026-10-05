'use client';

import { useEffect, useRef } from 'react';
import { formatSwissNumber } from '@swisshub/shared';
import { cn } from '@/lib/utils';
import { Partikel } from './walzen';

/**
 * Die grossen Meldungen des XP-Slots.
 *
 * ## Warum eine Komponente fuer fuenf Momente
 *
 * Weil es fuenf Momente derselben Art sind: der Slot hat etwas zu sagen, es
 * ist gross, es kommt einmal, und danach spielt man weiter. Geschenkte
 * Freispiele, deren Abschluss, ein geschenktes Bonusspiel, dessen Abschluss,
 * und der Ausgang des Risiko-Rads. Fuenf Overlays mit fuenf eigenen Animationen
 * waeren fuenf Stellen, an denen dieselbe Entscheidung anders ausfaellt - und
 * man saehe es: dasselbe Spiel mit fuenf Handschriften.
 *
 * Was sich unterscheidet, ist der **Inhalt** und die Stimmung. Das steht in
 * den Eigenschaften; alles andere - der Schleier, der Auftritt, das
 * Hochzaehlen, die Partikel, der Knopf - steht hier einmal.
 *
 * ## Warum nicht wie ein Browser-Alert
 *
 * Ein Alert ist eine Unterbrechung ohne Inszenierung: er erscheint ohne
 * Bewegung, er ist grau, und er ist in dem Moment vorbei, in dem man ihn
 * wegklickt. Eine Meldung hier faehrt auf, verdunkelt den Hintergrund,
 * zaehlt ihre Zahl hoch und wartet auf einen Knopf, den man gern drueckt.
 * Der Unterschied kostet dreissig Zeilen CSS und entscheidet, ob sich ein
 * Gewinn wie ein Gewinn anfuehlt.
 *
 * ## Warum das Schliessen von aussen kommt
 *
 * Weil eine Meldung, die einmal kommt, serverseitig vermerkt werden muss -
 * sonst steht sie nach jedem Neuladen wieder da. Diese Komponente weiss
 * davon nichts; sie sagt nur, dass jemand geschlossen hat.
 */

export type OverlayStimmung = 'gewinn' | 'verlust' | 'geschenk';

export interface SlotOverlayProps {
  stimmung: OverlayStimmung;
  /** Die kleine Zeile darueber - «Freispiele erhalten». */
  augenbraue?: string | null;
  /** Die grosse Zeile - «BONUS ABGESCHLOSSEN». */
  titel: string;
  /** Eine Zahl, die hochzaehlt - die Summe des Moments. */
  zahl?: { wert: number; einheit: string; vorzeichen?: boolean } | null;
  /** Oder eine grosse Zeile ohne Zahl - «10 FREISPIELE». */
  gross?: string | null;
  /** Die erklaerenden Zeilen darunter, in der Reihenfolge der Wichtigkeit. */
  zeilen?: readonly string[];
  knopf?: string;
  /** `prefers-reduced-motion`: dann steht alles sofort und ruhig da. */
  ruhig: boolean;
  aufSchliessen: () => void;
}

export function SlotOverlay({
  stimmung,
  augenbraue = null,
  titel,
  zahl = null,
  gross = null,
  zeilen = [],
  knopf = 'Weiter',
  ruhig,
  aufSchliessen,
}: SlotOverlayProps): React.JSX.Element {
  /*
   * Die Taste Escape schliesst auch.
   *
   * Nicht aus Bequemlichkeit, sondern weil ein Overlay, das den Bildschirm
   * fuellt und nur einen Knopf hat, sonst eine Falle fuer jeden ist, der mit
   * der Tastatur arbeitet.
   */
  useEffect(() => {
    const hoeren = (ereignis: KeyboardEvent): void => {
      if (ereignis.key === 'Escape') {
        aufSchliessen();
      }
    };
    window.addEventListener('keydown', hoeren);
    return () => window.removeEventListener('keydown', hoeren);
  }, [aufSchliessen]);

  return (
    <div className="slot-meldung" role="dialog" aria-modal="true" aria-label={titel}>
      <button
        type="button"
        className="slot-meldung__schleier"
        aria-label="Meldung schliessen"
        tabIndex={-1}
        onClick={aufSchliessen}
      />
      <div
        className={cn(
          'slot-meldung__karte',
          `slot-meldung__karte--${stimmung}`,
          ruhig && 'slot-meldung__karte--ruhig',
        )}
      >
        {/*
          Die Funken gehen vom Zentrum **dieser** Karte aus.

          `ursprung="mitte"` ist der ganze Unterschied zur Buehne, wo sie von
          unten treiben: eine Meldung hat eine Mitte, und ein Funkenschlag,
          der nicht aus ihr kommt, sieht nach einem fremden Effekt aus, der
          zufaellig daruntersteht.
        */}
        {stimmung !== 'verlust' && !ruhig ? <Partikel anzahl={14} ursprung="mitte" /> : null}

        {augenbraue ? <p className="slot-meldung__augenbraue">{augenbraue}</p> : null}
        <p className="slot-meldung__titel">{titel}</p>

        {zahl ? (
          <p className="slot-meldung__zahl">
            {zahl.vorzeichen === false ? '' : '+'}
            <Hochzaehlen ziel={zahl.wert} ruhig={ruhig} /> {zahl.einheit}
          </p>
        ) : null}
        {gross ? <p className="slot-meldung__gross">{gross}</p> : null}

        {zeilen.filter((zeile) => zeile.length > 0).length > 0 ? (
          <div className="slot-meldung__text">
            {zeilen
              .filter((zeile) => zeile.length > 0)
              .map((zeile) => (
                <p key={zeile}>{zeile}</p>
              ))}
          </div>
        ) : null}

        <button type="button" className="slot-meldung__knopf" onClick={aufSchliessen} autoFocus>
          {knopf}
        </button>
      </div>
    </div>
  );
}

/**
 * Eine Zahl, die hochzaehlt.
 *
 * Ueber `requestAnimationFrame` und nicht ueber einen Intervall: der Browser
 * entscheidet, wann ein Bild faellig ist, und bei einem Hintergrundtab faellt
 * gar keines an. Ein Intervall zaehlte dort weiter und waere beim Zurueckkommen
 * mitten im Sprung.
 *
 * ## Warum die Zahl ins DOM geschrieben wird und nicht in den Zustand
 *
 * Weil ein `setState` je Bild ein Rendern je Bild ist. Bei 650 ms sind das
 * rund vierzig Durchlaeufe durch React - fuer eine Ziffernfolge, die sich
 * aendert. Geschrieben wird darum direkt der Textinhalt; React rendert diese
 * Komponente genau einmal, naemlich wenn das Ziel wechselt. Das ist
 * derselbe Grundsatz, der fuer die Walzen gilt: Spielzustand in React,
 * Bewegung im DOM.
 *
 * Bei `prefers-reduced-motion` steht die Endzahl sofort da. Wer weniger
 * Bewegung will, will das Ergebnis und nicht die Vorfuehrung.
 */
export function Hochzaehlen({ ziel, ruhig }: { ziel: number; ruhig: boolean }): React.JSX.Element {
  const feld = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = feld.current;
    if (!element) {
      return undefined;
    }
    if (ruhig) {
      element.textContent = formatSwissNumber(ziel);
      return undefined;
    }
    const dauer = 650;
    const start = performance.now();
    let bild = 0;
    const schritt = (jetzt: number): void => {
      const p = Math.min(1, (jetzt - start) / dauer);
      // Weich auslaufen: schnell los, ruhig an die Endzahl heran.
      element.textContent = formatSwissNumber(Math.round(ziel * (1 - Math.pow(1 - p, 3))));
      if (p < 1) {
        bild = requestAnimationFrame(schritt);
      }
    };
    bild = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(bild);
  }, [ruhig, ziel]);

  /*
   * Der Anfangswert steht im Markup, damit auf dem Server und vor dem ersten
   * Bild dasselbe dort steht - sonst waere es ein Hydrationsunterschied.
   */
  return <span ref={feld}>{formatSwissNumber(ruhig ? ziel : 0)}</span>;
}

/**
 * Die grosse Meldung fuer Big Win, Mega Win und Jackpot.
 *
 * ## Warum nicht `SlotOverlay`
 *
 * Weil die fuenf Momente dort auf einen Knopf warten - sie sagen etwas, das
 * man zur Kenntnis nehmen muss, und bleiben stehen, bis man es getan hat. Ein
 * grosser Gewinn ist das Gegenteil: er kommt bei jedem zehnten Spin, er
 * gehoert zum Spielen, und ein Dialog davor waere nach dem dritten Mal eine
 * Zumutung - und im Auto-Spin ein Abbruch.
 *
 * Diese Meldung faehrt auf, zaehlt ihre Zahl hoch und geht wieder, ohne dass
 * jemand etwas tun muss. Sie nimmt keine Klicks an (`pointer-events: none`),
 * weil darunter der Spin-Knopf liegt und der naechste Spin nicht warten soll.
 *
 * ## Warum Mega und Jackpot dieselbe Komponente sind
 *
 * Weil der Unterschied einer des Grades ist und nicht der Art: dieselbe
 * Anordnung, mehr Glut, mehr Funken, laengere Standzeit. Drei Komponenten
 * waeren drei Stellen, an denen dieselbe Entscheidung anders ausfaellt.
 *
 * Bei `prefers-reduced-motion` steht die Meldung ruhig da: kein Auffahren,
 * keine Funken, die Zahl sofort. Sie entfaellt nicht - wer weniger Bewegung
 * will, will trotzdem wissen, dass er gerade 45'000 XP gewonnen hat.
 */
const GROSS_TITEL: Readonly<Record<string, string>> = {
  gross: 'BIG WIN',
  mega: 'MEGA WIN',
  jackpot: 'JACKPOT',
};

export function GrosserGewinn({
  stufe,
  gewinn,
  ruhig,
}: {
  stufe: 'gross' | 'mega' | 'jackpot';
  gewinn: number;
  ruhig: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn('slot-grossgewinn', `slot-grossgewinn--${stufe}`, ruhig && 'slot-grossgewinn--ruhig')}
      /*
       * `role="status"` und nicht `alert`: ein Gewinn ist eine Mitteilung und
       * keine Warnung. `aria-live="polite"` liest sie vor, ohne dem
       * Screenreader ins Wort zu fallen.
       */
      role="status"
      aria-live="polite"
    >
      {!ruhig ? <Partikel anzahl={stufe === 'gross' ? 16 : 26} ursprung="mitte" /> : null}
      <p className="slot-grossgewinn__titel">{GROSS_TITEL[stufe] ?? 'BIG WIN'}</p>
      <p className="slot-grossgewinn__zahl">
        +<Hochzaehlen ziel={gewinn} ruhig={ruhig} /> XP
      </p>
    </div>
  );
}
