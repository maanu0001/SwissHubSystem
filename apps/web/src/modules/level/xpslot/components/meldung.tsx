'use client';

import { useEffect, useState } from 'react';
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
 * Bei `prefers-reduced-motion` steht die Endzahl sofort da. Wer weniger
 * Bewegung will, will das Ergebnis und nicht die Vorfuehrung.
 */
export function Hochzaehlen({ ziel, ruhig }: { ziel: number; ruhig: boolean }): React.JSX.Element {
  const [wert, setWert] = useState(ruhig ? ziel : 0);

  useEffect(() => {
    if (ruhig) {
      setWert(ziel);
      return undefined;
    }
    const dauer = 650;
    const start = performance.now();
    let bild = 0;
    const schritt = (jetzt: number): void => {
      const p = Math.min(1, (jetzt - start) / dauer);
      // Weich auslaufen: schnell los, ruhig an die Endzahl heran.
      setWert(Math.round(ziel * (1 - Math.pow(1 - p, 3))));
      if (p < 1) {
        bild = requestAnimationFrame(schritt);
      }
    };
    bild = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(bild);
  }, [ruhig, ziel]);

  return <>{formatSwissNumber(wert)}</>;
}
