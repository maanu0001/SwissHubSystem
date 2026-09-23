'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SZENEN_KOMPONENTEN, SZENEN_DAUER } from './szenen/registry';
import { Faden } from './teile/faden';
import { cn } from '@/lib/utils';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';
import './wrapped.css';

/**
 * Die Buehne.
 *
 * ## Was sie tut
 *
 * Genau drei Dinge: sie zeigt eine Szene, sie sagt, wo man in der Geschichte
 * steht, und sie nimmt entgegen, dass jemand weiter will. Alles andere -
 * wie eine Szene aussieht, wie sie hereinkommt - steht in der Szene selbst.
 *
 * ## Warum immer nur eine Szene im Dokument steht
 *
 * Vierzehn Szenen gleichzeitig waeren vierzehn laufende Animationen, von
 * denen dreizehn niemand sieht. Auf einem Telefon ist das der Unterschied
 * zwischen fluessig und warm. Gerendert wird die aktuelle Szene; die
 * naechste bekommt nur ihre Bilder vorgeladen.
 *
 * ## Warum der Schluessel den Index enthaelt
 *
 * `key={index}` zwingt React, die Szene beim Wechsel neu aufzubauen. Genau
 * das ist gewollt: CSS-Animationen starten nur bei einem frischen Element.
 * Ohne den Schluessel bliebe die zweite Szene derselben Art still stehen -
 * und wer schnell vor- und zurueckblaettert, saehe gar nichts mehr.
 *
 * ## Schnelles Weiterklicken
 *
 * Es gibt keinen Uebergangszustand, in dem zwei Szenen gleichzeitig leben.
 * Ein Klick setzt den Index, der alte Baum verschwindet, der neue beginnt
 * bei null. Vier Klicks in einer Sekunde ergeben deshalb vier saubere
 * Anfaenge und keine Ueberlagerung - es gibt nichts, was sich ueberholen
 * koennte.
 *
 * ## Browser-Zurueck
 *
 * Bewusst kein Verlaufseintrag je Szene. Wer aus einer Geschichte mit
 * vierzehn Kapiteln herausgehen will, drueckt einmal zurueck und ist
 * draussen - und nicht vierzehnmal.
 */

export interface StoryProps {
  daten: WrappedDaten;
  sceneKeys: string[];
  jahr: number;
  /** Wohin «Schliessen» fuehrt. */
  zurueckHref: string;
  /** Gesetzt, solange es eine Vorschau ist - dann laeuft nichts nach aussen. */
  vorschau?: { label: string } | null;
  /** Reduzierte Bewegung erzwingen - der Schalter im Studio. */
  ruhig?: boolean;
  /** Mit welcher Szene begonnen wird (Fortsetzen, Szenen-Vorschau). */
  startIndex?: number;
  /** Nur eine Szene zeigen - die Einzelvorschau im Studio. */
  einzeln?: boolean;
  /** Meldet jeden Szenenwechsel - fuer den Fortschritt und die Debug-Anzeige. */
  aufSzene?: (info: { index: number; key: string; gesamt: number }) => void;
  /** Wird am Ende der letzten Szene gerufen. */
  aufEnde?: () => void;
  /** Zusaetzliche Einblendung - die Werkzeugleiste des Studios. */
  overlay?: React.ReactNode;
}

export function WrappedStory({
  daten,
  sceneKeys,
  jahr,
  zurueckHref,
  vorschau = null,
  ruhig = false,
  startIndex = 0,
  einzeln = false,
  aufSzene,
  aufEnde,
  overlay,
}: StoryProps): React.JSX.Element {
  const szenen = useMemo(() => sceneKeys.filter((key) => key in SZENEN_KOMPONENTEN), [sceneKeys]);
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(0, szenen.length - 1)));
  const [pausiert, setPausiert] = useState(false);
  const halten = useRef<number | null>(null);
  const beruehrung = useRef<{ x: number; y: number } | null>(null);

  /*
   * Reduzierte Bewegung.
   *
   * Zwei Quellen: die Einstellung des Systems und der Schalter im Studio.
   * Beide fuehren zum selben Ergebnis - nur laeuft die eine ueber eine
   * Medienabfrage in CSS und die andere ueber eine Klasse. Der Zustand hier
   * wird gebraucht, weil auch der Zeitgeber stehenbleiben muss: ein
   * Fortschrittsbalken, der nicht laeuft, waehrend die Szene trotzdem
   * weiterspringt, waere die schlechteste Mischung aus beidem.
   */
  const [systemRuhig, setSystemRuhig] = useState(false);
  useEffect(() => {
    const abfrage = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemRuhig(abfrage.matches);
    const hoeren = (ereignis: MediaQueryListEvent): void => setSystemRuhig(ereignis.matches);
    abfrage.addEventListener('change', hoeren);
    return () => abfrage.removeEventListener('change', hoeren);
  }, []);
  const stillstand = ruhig || systemRuhig;

  const aktuell = szenen[index] ?? szenen[0] ?? 'intro';
  const dauer = SZENEN_DAUER[aktuell] ?? 6500;

  const weiter = useCallback(() => {
    setIndex((bisher) => {
      if (bisher + 1 >= szenen.length) {
        aufEnde?.();
        return bisher;
      }
      return bisher + 1;
    });
  }, [szenen.length, aufEnde]);

  const zurueck = useCallback(() => setIndex((bisher) => Math.max(0, bisher - 1)), []);

  useEffect(() => {
    const key = szenen[index];
    if (key) {
      aufSzene?.({ index, key, gesamt: szenen.length });
    }
  }, [index, szenen, aufSzene]);

  /*
   * Der Zeitgeber.
   *
   * Nur, wenn tatsaechlich automatisch weitergeblaettert wird: bei
   * reduzierter Bewegung, in der Einzelvorschau und waehrend jemand den
   * Finger auf dem Bildschirm haelt, steht er still. Neu gesetzt bei jedem
   * Szenenwechsel - deshalb kann sich hier nichts ueberholen.
   */
  useEffect(() => {
    if (stillstand || einzeln || pausiert) {
      return;
    }
    const uhr = window.setTimeout(weiter, dauer);
    return () => window.clearTimeout(uhr);
  }, [index, dauer, stillstand, einzeln, pausiert, weiter]);

  useEffect(() => {
    const taste = (ereignis: KeyboardEvent): void => {
      if (ereignis.key === 'ArrowRight' || ereignis.key === ' ') {
        ereignis.preventDefault();
        weiter();
      } else if (ereignis.key === 'ArrowLeft') {
        ereignis.preventDefault();
        zurueck();
      } else if (ereignis.key === 'Escape') {
        window.location.assign(zurueckHref);
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [weiter, zurueck, zurueckHref]);

  const Szene = SZENEN_KOMPONENTEN[aktuell];

  return (
    <div
      className={cn('wrapped-buehne', stillstand && 'wrapped-ruhig')}
      // Die Geschichte ist ein eigener Bereich - Screenreader sollen sie als
      // solchen ankuendigen und nicht als Fortsetzung des Dashboards.
      role="region"
      aria-roledescription="Jahresrückblick"
      aria-label={`SwissHub Wrapped ${jahr}`}
      onTouchStart={(ereignis) => {
        const punkt = ereignis.touches[0];
        beruehrung.current = punkt ? { x: punkt.clientX, y: punkt.clientY } : null;
        halten.current = window.setTimeout(() => setPausiert(true), 220);
      }}
      onTouchEnd={(ereignis) => {
        if (halten.current !== null) {
          window.clearTimeout(halten.current);
          halten.current = null;
        }
        setPausiert(false);
        const start = beruehrung.current;
        const ende = ereignis.changedTouches[0];
        beruehrung.current = null;
        if (!start || !ende) {
          return;
        }
        const dx = ende.clientX - start.x;
        const dy = ende.clientY - start.y;
        /*
         * Wischen nur, wenn es eindeutig waagerecht war.
         *
         * Sonst kollidiert die Geste mit dem Zurueckwischen des Browsers und
         * mit dem Scrollen - und beides gewinnt zu Recht gegen uns.
         */
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
          if (dx < 0) {
            weiter();
          } else {
            zurueck();
          }
        }
      }}
    >
      <Kulisse />

      {/* Der Fortschritt - eine Spur je Szene. */}
      {!einzeln ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6"
          aria-hidden="true"
        >
          {szenen.map((key, position) => (
            <div key={key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20">
              {position < index ? (
                <span className="block h-full w-full bg-white" />
              ) : position === index ? (
                <span className="w-fortschritt block h-full" style={{ ['--dauer' as string]: `${dauer}ms` }}>
                  <span className="block h-full w-full bg-white" />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Kopfzeile: Marke links, Schliessen rechts. Mehr nicht. */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-[max(1.75rem,calc(env(safe-area-inset-top)+1rem))] sm:px-7">
        <span className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-white/60">
          <Faden variante="marke" className="h-4 w-6" />
          Wrapped {jahr}
        </span>
        <a
          href={zurueckHref}
          className="grid size-9 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Rückblick schliessen"
        >
          <X className="size-5" aria-hidden="true" />
        </a>
      </div>

      {/* Die Szene. Immer genau eine. */}
      <div className="absolute inset-0 z-10">
        {Szene ? (
          <Szene key={`${aktuell}-${index}`} daten={daten} jahr={jahr} stillstand={stillstand} />
        ) : null}
      </div>

      {/*
        Die Flaechen zum Weiterblaettern.
        Links ein Drittel, rechts zwei Drittel - wie in jeder Story-Oberflaeche,
        weil das die Daumenhaltung ist. Sie liegen ueber der Szene, aber unter
        den Knoepfen: was anklickbar ist, bleibt anklickbar.
      */}
      {!einzeln ? (
        <div className="absolute inset-0 z-20 flex">
          <button
            type="button"
            onClick={zurueck}
            className="h-full w-1/3 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
            aria-label="Vorherige Szene"
            disabled={index === 0}
          />
          <button
            type="button"
            onClick={weiter}
            className="h-full flex-1 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
            aria-label="Nächste Szene"
          />
        </div>
      ) : null}

      {vorschau ? (
        <div className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2">
          <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur">
            {vorschau.label}
          </span>
        </div>
      ) : null}

      {overlay}
    </div>
  );
}

/**
 * Die Kulisse.
 *
 * Zwei sehr langsam atmende Lichter in Markenrot und ein feines Raster.
 * Mehr nicht - was hier passiert, darf der Zahl in der Mitte nie die Schau
 * stehlen. Kein Canvas, keine Partikel: zwei Elemente mit
 * `opacity`/`transform` kosten nichts und laufen ueberall.
 */
function Kulisse(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/*
        Der Schein oben - klein und schwach.
        Die erste Fassung hatte ihn auf 35 % ueber die halbe Hoehe gelegt.
        Das Ergebnis war ein durchgehend roter Bildschirm: die Zahl in der
        Mitte hatte keinen Raum mehr, und Markenrot als Flaeche sieht nach
        Warnung aus, nicht nach Fest. Jetzt ist es ein Schimmer am oberen
        Rand, und der Rest ist schwarz.
      */}
      <div className="absolute inset-0 bg-[radial-gradient(90%_45%_at_50%_-10%,hsl(var(--w-rot)/0.30)_0%,transparent_70%)]" />
      <div className="w-licht absolute -left-[25%] top-[-8%] size-[28rem] rounded-full bg-[hsl(var(--w-rot))] opacity-[0.22] blur-[140px]" />
      <div
        className="w-licht absolute -right-[20%] bottom-[-10%] size-[22rem] rounded-full bg-[hsl(var(--w-rot-hell))] opacity-[0.10] blur-[150px]"
        style={{ animationDelay: '-7s' }}
      />
      {/* Die untere Haelfte laeuft nach Schwarz - dort steht der Text. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_28%,hsl(var(--w-schwarz)/0.85)_72%,hsl(var(--w-schwarz))_100%)]" />
    </div>
  );
}
