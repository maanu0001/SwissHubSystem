'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

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
 */

/** Wie viele Felder das Rad hat. Zwoelf teilt sich gut und bleibt zaehlbar. */
const FELDER = 12;
/** Volle Umdrehungen vor dem Ziel - genug fuer Schwung, kurz genug fuer Geduld. */
const RUNDEN = 4;
/** Wie lange die Drehung dauert. Dieselbe Zahl steht im CSS als Uebergang. */
export const RAD_DAUER_MS = 2600;

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

export function Rad({ chance, riskierenAuf, nehmen, ergebnis, aufEnde }: RadProps): React.JSX.Element {
  const felder = useMemo(() => felderFuer(chance), [chance]);
  const [winkel, setWinkel] = useState(0);
  const [steht, setSteht] = useState(false);
  const gemeldet = useRef(false);

  /*
   * Der Zielwinkel.
   *
   * Der Zeiger steht oben. Damit die Mitte des Zielfeldes unter ihm landet,
   * muss das Rad um `360 - mitte` gedreht werden, plus die vollen Runden.
   * Der kleine Versatz darin ist Zierde: ohne ihn stehen alle Ergebnisse
   * exakt mittig, und das sieht nach Raster aus statt nach Rad.
   */
  useEffect(() => {
    if (!ergebnis || gemeldet.current) {
      return;
    }
    const passende = felder.filter((feld) => feld.gewinn === (ergebnis === 'gewonnen'));
    const gewaehlt = passende[Math.floor(Math.random() * passende.length)] ?? felder[0]!;
    const halb = 360 / FELDER / 2;
    const versatz = (Math.random() * 2 - 1) * (halb * 0.55);
    setWinkel(RUNDEN * 360 + (360 - gewaehlt.mitte) + versatz);

    const uhr = setTimeout(() => {
      setSteht(true);
      gemeldet.current = true;
      aufEnde();
    }, RAD_DAUER_MS);
    return () => clearTimeout(uhr);
  }, [aufEnde, ergebnis, felder]);

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
          className={cn('slot-rad__scheibe', !steht && 'slot-rad__scheibe--laeuft')}
          style={{
            background: gradient,
            transform: `rotate(${winkel}deg)`,
            // Ohne Ergebnis dreht es frei weiter; mit Ergebnis faehrt es aus.
            transitionDuration: ergebnis ? `${RAD_DAUER_MS}ms` : '0ms',
          }}
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
