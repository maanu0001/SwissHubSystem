'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWenigerBewegung } from './klang';

/**
 * Das Risiko-Rad der Bonusrunde.
 *
 * ## Die eine Regel, auf der alles steht
 *
 * **Das Rad entscheidet nichts.** Der Wurf fallt auf dem Server, bevor dieses
 * Rad sich bewegt: `bonus.riskiere` zieht eine Zahl mit `crypto.randomInt`,
 * schreibt das Ergebnis in die Bonusrunde und antwortet. Erst dann beginnt
 * hier die Drehung, und sie endet auf dem Feld, das schon feststeht. Ein Rad,
 * das selbst wuerfelt, waere ein zweites Spiel mit einem zweiten Ergebnis -
 * und die Bonusrunde in der Datenbank wuesste nichts davon.
 *
 * Daran haengt auch, dass hier kein `Math.random` ueber Gewinn oder Verlust
 * entscheidet. Zufall gibt es nur fuer Zierde: **welches** der gleichwertigen
 * Felder getroffen wird, und wie weit das Rad ueberdreht.
 *
 * ## Warum die Felder die Chance abbilden
 *
 * Weil ein Rad eine Aussage macht. Bei 34 Prozent Gewinnchance waeren sechs
 * gruene und sechs rote Felder eine Luege, die jeder sieht, der zaehlt: das
 * Rad zeigt dann eine Fifty-fifty-Wette, und das Ergebnis fuehlt sich
 * manipuliert an. Darum entsteht die Feldzahl aus der Chance - bei 34 Prozent
 * sind vier von zwoelf Feldern Gewinnfelder.
 *
 * ## Warum die Animation nicht das Ergebnis verzoegert
 *
 * Gebucht ist gebucht, bevor sich etwas dreht. Die Drehung ist Inszenierung;
 * wer die Seite waehrend der Drehung neu laedt, sieht den fertigen Zustand -
 * nicht einen halben. Das ist dieselbe Trennung wie beim Spin selbst.
 *
 * ## Warum die Bewegung im Code steht und nicht im Stylesheet
 *
 * Weil sie vorher aus zwei Teilen bestand, die nichts voneinander wussten,
 * und das war ein echter Fehler und nicht nur unschoen:
 *
 *  - Der freie Lauf war eine CSS-Animation auf `rotate`.
 *  - Das Ausfahren war ein Uebergang auf `transform: rotate(...)`.
 *
 * Zwei Eigenschaften, zwei Drehungen, und sichtbar wurde ihre **Summe**.
 * Waehrend des Ausfahrens lief die Animation weiter und addierte einen
 * Winkel, den niemand kannte; in dem Moment, in dem die Klasse fiel, sprang
 * das Rad um diesen Betrag. Das Ergebnis: ein Sprung im letzten Bild - und
 * ein Rad, das **nicht** exakt auf seinem Feld landete, sondern irgendwo in
 * der Naehe.
 *
 * Jetzt gibt es eine Drehung, einen Winkel und drei Abschnitte:
 *
 *  1. **Anlauf** ({@link ANLAUF_MS}) - die Geschwindigkeit waechst nach einer
 *     S-Kurve von null auf {@link TEMPO}. Anfang und Ende sind
 *     beschleunigungsfrei; es gibt keinen Ruck beim Losfahren.
 *  2. **Lauf** - gleichmaessig, solange die Antwort aussteht.
 *  3. **Ausfahren** ({@link RAD_DAUER_MS}) - zwei bis drei Umdrehungen auf
 *     das Feld, das der Server bestimmt hat, mit einer flachen Kurve, die
 *     die letzten Grad kriecht. Dort entsteht die Spannung.
 *
 * Geschrieben wird der Winkel direkt an das Element und nicht in den
 * Zustand: sonst waeren das bei drei Sekunden gegen zweihundert Rendervorgaenge
 * fuer eine Zahl, die nur das Rad angeht.
 */

/** Wie viele Felder das Rad hat. Zwoelf teilt sich gut und bleibt zaehlbar. */
const FELDER = 12;
/** Der Anlauf: von null auf Reisegeschwindigkeit. */
const ANLAUF_MS = 480;
/** Die Reisegeschwindigkeit in Grad je Millisekunde - eine Umdrehung in 300 ms. */
const TEMPO = 360 / 300;
/** Wie lange das Ausfahren auf das Ergebnis dauert. */
export const RAD_DAUER_MS = 2600;
/**
 * Wie lange das Rad auf seinem Ergebnis stehen bleibt, bevor es abgeben wird.
 *
 * Ohne diese Pause verschwand das Rad in demselben Moment, in dem es stehen
 * blieb: `aufEnde` nimmt es aus dem Baum, und wer hinsah, bekam das Ergebnis
 * nur noch als Meldung zu lesen. Gefordert ist, dass das Rad **eindeutig auf
 * Gewinn oder Verlust stehen bleibt** - und das heisst: lange genug, um es zu
 * sehen.
 */
export const RAD_HALTEN_MS = 900;

export interface RadProps {
  /** Die Gewinnchance dieser Stufe, 0 bis 1 - sie bestimmt die Felder. */
  chance: number;
  /** Was bei einem Gewinn herauskommt. */
  riskierenAuf: number;
  /** Was auf dem Spiel steht. */
  nehmen: number;
  /**
   * Das Ergebnis vom Server - `null`, solange die Antwort aussteht.
   *
   * Solange es `null` ist, dreht das Rad frei. Sobald es da ist, dreht es
   * auf das passende Feld aus.
   */
  ergebnis: 'gewonnen' | 'verloren' | null;
  /** Wird aufgerufen, wenn die Drehung auf dem Ergebnis steht. */
  aufEnde: () => void;
}

interface Feld {
  gewinn: boolean;
  /** Die Mitte des Feldes in Grad, von oben aus gezaehlt. */
  mitte: number;
}

/**
 * Die Felder des Rades.
 *
 * Die Gewinnfelder liegen verteilt und nicht am Stueck: ein Rad mit einem
 * gruenen Viertel sieht aus wie ein Tortendiagramm, eines mit verteilten
 * Feldern wie ein Glücksrad.
 */
function felderFuer(chance: number): Feld[] {
  const gewinnend = Math.min(FELDER - 1, Math.max(1, Math.round(chance * FELDER)));
  const schritt = FELDER / gewinnend;
  const gruen = new Set(Array.from({ length: gewinnend }, (_unused, index) => Math.floor(index * schritt)));
  return Array.from({ length: FELDER }, (_unused, index) => ({
    gewinn: gruen.has(index),
    mitte: (index + 0.5) * (360 / FELDER),
  }));
}

/**
 * Der Weg des Anlaufs nach `ms` Millisekunden.
 *
 * Das Integral einer S-Kurve: die Geschwindigkeit steigt nach
 * `3t^2 - 2t^3` von null auf {@link TEMPO}, und diese Kurve hat an beiden
 * Enden die Steigung null. Deshalb ruckt nichts - weder beim Losfahren noch
 * beim Uebergang in den gleichmaessigen Lauf.
 */
function anlaufWeg(ms: number): number {
  const t = Math.min(1, Math.max(0, ms) / ANLAUF_MS);
  const weg = TEMPO * ANLAUF_MS * (Math.pow(t, 3) - Math.pow(t, 4) / 2);
  return ms <= ANLAUF_MS ? weg : weg + TEMPO * (ms - ANLAUF_MS);
}

/**
 * Die Haerte der Ausfahrkurve.
 *
 * `1 - (1-p)^n`: bei n = 3,2 sind nach drei Viertel der Zeit schon 99 Prozent
 * des Weges zurueckgelegt - das letzte Viertel sind wenige Grad, und genau
 * das ist die spannungsvolle Phase. Ein hoeherer Wert liesse das Rad
 * scheinbar stehen und dann noch zucken; ein niedrigerer waere ein Bremsen
 * ohne Spannung.
 */
const AUSFAHRT_GRAD = 3.2;

const ausfahrt = (p: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), AUSFAHRT_GRAD);

/**
 * Die Strecke vom jetzigen Winkel bis zum Ziel.
 *
 * Der Zeiger steht oben, also muss das Rad um `360 - mitte` stehen, damit die
 * Feldmitte unter ihm liegt. Dazu kommen ganze Umdrehungen - und die sind
 * nicht beliebig gewaehlt: bei der Kurve `1 - (1-p)^n` ist die
 * Anfangsgeschwindigkeit `n * Strecke / Dauer`. Damit das Ausfahren dort
 * anfaengt, wo der freie Lauf aufhoert, muss die Strecke bei etwa
 * `TEMPO * Dauer / n` liegen; gerundet auf eine ganze Umdrehung bleiben rund
 * zehn Prozent Unterschied, und die sieht man nicht. Was man sehen wuerde,
 * ist eine Strecke, die gar nicht passt: dann faellt das Rad in die Bremse
 * oder zieht erst noch an.
 */
function zielStrecke(jetzt: number, mitte: number, versatz: number): number {
  const soll = (((360 - mitte + versatz) % 360) + 360) % 360;
  const rest = (((soll - (jetzt % 360)) % 360) + 360) % 360;
  const ideal = (TEMPO * RAD_DAUER_MS) / AUSFAHRT_GRAD;
  const runden = Math.max(2, Math.round((ideal - rest) / 360));
  return rest + runden * 360;
}

export function Rad({ chance, riskierenAuf, nehmen, ergebnis, aufEnde }: RadProps): React.JSX.Element {
  const felder = useMemo(() => felderFuer(chance), [chance]);
  const [steht, setSteht] = useState(false);
  const gemeldet = useRef(false);
  const scheibe = useRef<HTMLDivElement | null>(null);
  /** Der laufende Winkel - er gehoert dem Bild und nicht dem Zustand. */
  const winkel = useRef(0);
  /** Das Ausfahren, sobald es beschlossen ist. */
  const ausfahren = useRef<{ ab: number; von: number; strecke: number } | null>(null);
  const wenigerBewegung = useWenigerBewegung();

  const zeichne = useCallback((grad: number) => {
    winkel.current = grad;
    if (scheibe.current) {
      scheibe.current.style.transform = `rotate(${grad.toFixed(2)}deg)`;
    }
  }, []);

  /*
   * Die Bewegung - eine Schleife von der ersten bis zur letzten Drehung.
   *
   * Sie laeuft los, sobald das Rad da ist, und hoert auf, wenn das Ausfahren
   * durch ist. Das Ergebnis kommt mitten hinein; es wird deshalb aus einer
   * Referenz gelesen und nicht aus einer Abhaengigkeit - eine Schleife, die
   * bei jeder Zustandsaenderung neu anfaengt, haette keinen Schwung.
   */
  useEffect(() => {
    if (wenigerBewegung) {
      return undefined;
    }
    const start = performance.now();
    let bild = requestAnimationFrame(function schritt(jetzt: number): void {
      const fahrt = ausfahren.current;
      if (!fahrt) {
        zeichne(anlaufWeg(jetzt - start));
        bild = requestAnimationFrame(schritt);
        return;
      }
      const p = (jetzt - fahrt.ab) / RAD_DAUER_MS;
      zeichne(fahrt.von + fahrt.strecke * ausfahrt(p));
      if (p < 1) {
        bild = requestAnimationFrame(schritt);
        return;
      }
      // Genau auf dem Feld, im letzten Bild, ohne Nachsetzen.
      zeichne(fahrt.von + fahrt.strecke);
      setSteht(true);
    });
    return () => cancelAnimationFrame(bild);
  }, [wenigerBewegung, zeichne]);

  /*
   * Das Ziel.
   *
   * Der kleine Versatz darin ist Zierde: ohne ihn stehen alle Ergebnisse
   * exakt mittig, und das sieht nach Raster aus statt nach Rad. Er bleibt
   * innerhalb der halben Feldbreite - der Zeiger steht danach eindeutig
   * ueber dem Feld und nie auf einer Kante.
   */
  useEffect(() => {
    if (!ergebnis || gemeldet.current || ausfahren.current) {
      return undefined;
    }
    const passende = felder.filter((feld) => feld.gewinn === (ergebnis === 'gewonnen'));
    const gewaehlt = passende[Math.floor(Math.random() * passende.length)] ?? felder[0]!;
    const halb = 360 / FELDER / 2;
    const versatz = (Math.random() * 2 - 1) * (halb * 0.55);

    if (wenigerBewegung) {
      // Keine Drehung: das Rad zeigt das Ergebnis, das von Anfang an feststand.
      zeichne((360 - gewaehlt.mitte + versatz + 360) % 360);
      setSteht(true);
    } else {
      ausfahren.current = {
        ab: performance.now(),
        von: winkel.current,
        strecke: zielStrecke(winkel.current, gewaehlt.mitte, versatz),
      };
    }

    /*
     * Zuerst steht das Rad, dann wird abgegeben. In einem Schritt waere das
     * Ergebnis unsichtbar - React nimmt das Rad aus dem Baum, bevor der Text
     * einmal gezeichnet ist.
     */
    const uhrEnde = setTimeout(
      () => {
        gemeldet.current = true;
        aufEnde();
      },
      wenigerBewegung ? RAD_HALTEN_MS : RAD_DAUER_MS + RAD_HALTEN_MS,
    );
    return () => clearTimeout(uhrEnde);
  }, [aufEnde, ergebnis, felder, wenigerBewegung, zeichne]);

  const gradient = useMemo(() => {
    const breite = 360 / FELDER;
    const stuecke = felder.map((feld, index) => {
      const von = index * breite;
      const bis = von + breite;
      const farbe = feld.gewinn ? 'hsl(142 55% 32%)' : 'hsl(0 0% 16%)';
      return `${farbe} ${von}deg ${bis}deg`;
    });
    return `conic-gradient(from 0deg, ${stuecke.join(', ')})`;
  }, [felder]);

  return (
    <div className="slot-rad" role="group" aria-label="Risiko-Rad">
      <div className="slot-rad__kopf">
        <p className="text-sm font-semibold">
          {steht
            ? ergebnis === 'gewonnen'
              ? `Gewonnen - ${riskierenAuf} Freispiele.`
              : 'Verloren - die Bonusrunde ist weg.'
            : `${nehmen} Freispiele stehen auf dem Spiel`}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {Math.round(chance * 100)} % Chance · {felder.filter((feld) => feld.gewinn).length} von {FELDER}{' '}
          Feldern gewinnen
        </p>
      </div>

      <div className="slot-rad__buehne">
        {/* Der Zeiger steht still; das Rad dreht darunter. */}
        <span className="slot-rad__zeiger" aria-hidden="true" />
        <div
          ref={scheibe}
          className={cn('slot-rad__scheibe', steht && 'slot-rad__scheibe--steht')}
          style={{ background: gradient }}
          aria-hidden="true"
        />
        <div className="slot-rad__nabe" aria-hidden="true">
          <span className="text-xs font-bold tabular-nums">{riskierenAuf}</span>
        </div>
      </div>

      {/*
        Der Text unter dem Rad sagt, was gilt - nicht die Farbe allein. Wer
        Rot und Gruen nicht unterscheidet, soll das Ergebnis trotzdem lesen
        koennen.
      */}
      <p aria-live="polite" className="text-center text-xs text-muted-foreground">
        {ergebnis === null
          ? 'Das Rad dreht …'
          : steht
            ? ergebnis === 'gewonnen'
              ? 'Weiter mit den Freispielen oder noch einmal riskieren.'
              : 'Diesmal nicht.'
            : 'Das Ergebnis steht fest - das Rad fährt aus.'}
      </p>
    </div>
  );
}
