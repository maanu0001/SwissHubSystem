'use client';

import { useMemo } from 'react';
import { Cover } from './bausteine';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Das Rad.
 *
 * ## Es bestimmt nichts
 *
 * Der Gewinner steht in der Datenbank, bevor sich hier etwas bewegt. Diese
 * Komponente bekommt ihn, rechnet daraus den Endwinkel und dreht dorthin.
 * Es gibt in dieser Datei keinen Zufall - das ist keine Sparsamkeit, sondern
 * die Bedingung dafür, dass zwei Bildschirme dasselbe zeigen.
 *
 * ## Warum alle synchron sind, ohne dass jemand sie synchronisiert
 *
 * Drei Zahlen kommen vom Server: der Gewinner, der Startzeitpunkt und die
 * Dauer. Daraus folgt der Rest von selbst. Wer die Seite mitten im Lauf
 * öffnet, bekommt dieselben drei Zahlen und setzt die Animation über einen
 * negativen `animation-delay` an der richtigen Stelle fort - der Browser
 * rechnet das ohne weiteres Zutun.
 *
 * Es gibt deshalb auch keinen Fall «zu spät gekommen»: entweder das Rad
 * dreht noch, dann steigt man mittendrin ein, oder es ist vorbei, dann steht
 * das Ergebnis.
 *
 * ## Die Segmente
 *
 * Sie sind so breit wie das Gewicht ihres Spiels. Ohne Gewichtung also alle
 * gleich breit - das Bild zeigt damit die tatsächliche Chance und nicht eine
 * geschönte. Bei mehr als zwölf Kandidaten würde die Schrift unlesbar;
 * darum trägt dann nur noch das Feld unter dem Zeiger seinen Namen, und die
 * Liste daneben bleibt vollständig.
 */

/** Mindestens acht volle Umdrehungen, damit der Lauf nicht kurz wirkt. */
const UMDREHUNGEN = 8;

const PALETTE = ['#83060a', '#a81419', '#6d0508', '#b02025', '#8f1114', '#5c0406'];

export interface RadFeld {
  candidateId: string;
  name: string;
  bannerUrl: string | null;
  gewicht: number;
}

export function Rad({
  felder,
  runde,
  serverJetzt,
  dauerMs,
}: {
  felder: RadFeld[];
  runde: NonNullable<Stand['runde']>;
  serverJetzt: string;
  dauerMs: number;
}): React.JSX.Element {
  const geometrie = useMemo(() => baueGeometrie(felder), [felder]);

  /*
   * Der Endwinkel.
   *
   * Der Server hat einen Punkt auf der Gewichtsachse gezogen (`losPunkt` von
   * `losGesamt`). Genau dieser Punkt soll am Ende unter dem Zeiger stehen -
   * nicht die Mitte des Gewinnerfeldes. Der Unterschied ist sichtbar: fällt
   * die Ziehung knapp an den Rand eines Feldes, hält das Rad auch knapp am
   * Rand, und das sieht nach Zufall aus statt nach Choreografie.
   */
  const anteil = runde.losGesamt && runde.losGesamt > 0 ? ((runde.losPunkt ?? 0) + 0.5) / runde.losGesamt : 0;
  const ziel = UMDREHUNGEN * 360 + (360 - anteil * 360);

  const vergangen = Math.max(0, Date.parse(serverJetzt) - Date.parse(runde.startedAt));
  const versatzSek = -Math.min(vergangen, dauerMs) / 1000;

  const gewinner = felder.find((feld) => feld.candidateId === runde.gewinnerCandidateId);
  const vieleFelder = felder.length > 12;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="relative aspect-square w-full max-w-[min(78vw,26rem)]">
        {/* Der Zeiger steht oben und bewegt sich nicht - das Rad kommt zu ihm. */}
        <div className="sp-zeiger absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1">
          <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
            <path d="M13 29 L2 4 A13 13 0 0 1 24 4 Z" fill="hsl(var(--sp-rot-hell))" />
          </svg>
        </div>

        <div
          className="sp-rad-lauf h-full w-full"
          style={{
            ['--dreh' as string]: `${ziel}deg`,
            ['--dauer' as string]: `${dauerMs}ms`,
            ['--versatz' as string]: `${versatzSek}s`,
          }}
        >
          <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-[0_0_3rem_hsl(var(--sp-rot)/0.5)]">
            <circle cx="100" cy="100" r="99" fill="hsl(var(--background))" />
            {geometrie.map((feld, index) => (
              <g key={feld.candidateId}>
                <path
                  d={feld.pfad}
                  fill={PALETTE[index % PALETTE.length]}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="0.4"
                />
                {!vieleFelder ? (
                  <text
                    x={feld.textX}
                    y={feld.textY}
                    transform={`rotate(${feld.textWinkel} ${feld.textX} ${feld.textY})`}
                    textAnchor={feld.textAnker}
                    dominantBaseline="middle"
                    fill="rgba(255,255,255,0.92)"
                    fontSize={felder.length > 8 ? 5.5 : 7}
                    fontWeight="700"
                  >
                    {kuerze(feld.name, felder.length > 8 ? 16 : 20)}
                  </text>
                ) : null}
              </g>
            ))}
            <circle cx="100" cy="100" r="99" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.2" />
            <circle
              cx="100"
              cy="100"
              r="17"
              fill="hsl(var(--background))"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="1"
            />
          </svg>
        </div>
      </div>

      {gewinner ? (
        // Das Cover des Gewinners liegt bereit - unsichtbar, bis das Rad steht.
        <div className="sr-only">{gewinner.name}</div>
      ) : null}

      {vieleFelder ? (
        <p className="text-center text-xs text-white/35">
          {felder.length} Spiele im Rad. Die Namen stehen in der Liste - im Rad wären sie nicht mehr lesbar.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Die Ziehung ohne Bewegung.
 *
 * Für alle, die weniger Bewegung eingestellt haben. Sie sehen dieselben
 * Spiele, denselben Countdown und erfahren den Gewinner in derselben
 * Sekunde - nur eben ohne drehendes Rad. Was fehlt, ist die Bewegung; was
 * bleibt, ist die vollständige Information.
 */
export function RadRuhig({ felder, rest }: { felder: RadFeld[]; rest: number | null }): React.JSX.Element {
  const sekunden = rest === null ? null : Math.ceil(rest / 1000);

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="text-center text-sm text-white/45">
        Es wird gezogen.
        {sekunden !== null
          ? ` Das Ergebnis steht in ${sekunden} ${sekunden === 1 ? 'Sekunde' : 'Sekunden'}.`
          : ''}
      </p>
      <RadStand felder={felder} gewinnerId={null} />
      <p className="max-w-md text-center text-xs text-white/30">
        Jedes Spiel hat dieselbe Chance wie im Rad - gezogen wurde auf dem Server, bevor hier etwas angezeigt
        wurde.
      </p>
    </div>
  );
}

/** Das stehende Rad, wenn die Ziehung vorbei ist. */
export function RadStand({
  felder,
  gewinnerId,
}: {
  felder: RadFeld[];
  gewinnerId: string | null;
}): React.JSX.Element {
  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {felder.map((feld) => {
        const gewonnen = feld.candidateId === gewinnerId;
        return (
          <div key={feld.candidateId} className={gewonnen ? '' : 'opacity-60'}>
            <div className={gewonnen ? 'sp-glut overflow-hidden rounded-xl' : 'overflow-hidden rounded-xl'}>
              <Cover name={feld.name} bannerUrl={feld.bannerUrl} className="aspect-[4/3] w-full" />
            </div>
            {/*
              Der Name gehört darunter.

              Das Monogramm auf der Fläche ist ein Bild, kein Titel - ohne
              diese Zeile stünden hier vier anonyme Buchstaben, und man
              wüsste nicht, wogegen der Gewinner sich durchgesetzt hat.
            */}
            <p
              className={
                gewonnen
                  ? 'mt-1.5 truncate text-center text-xs font-bold text-white'
                  : 'mt-1.5 truncate text-center text-xs text-white/45'
              }
            >
              {feld.name}
            </p>
          </div>
        );
      })}
    </div>
  );
}

interface Geometrie extends RadFeld {
  pfad: string;
  textX: number;
  textY: number;
  textWinkel: number;
  textAnker: 'start' | 'end';
}

/**
 * Die Kuchenstücke.
 *
 * Gezeichnet im Uhrzeigersinn ab oben. Alle Werte werden auf drei Stellen
 * gerundet: `Math.cos` liefert in Node und im Browser gelegentlich die
 * letzte Stelle verschieden, und React meldet das beim Abgleich mit dem
 * servergerenderten Markup als Abweichung.
 */
function baueGeometrie(felder: RadFeld[]): Geometrie[] {
  const gesamt = felder.reduce((summe, feld) => summe + Math.max(feld.gewicht, 0), 0) || 1;
  let winkel = 0;

  return felder.map((feld) => {
    const anteil = Math.max(feld.gewicht, 0) / gesamt;
    const start = winkel;
    const ende = winkel + anteil * 360;
    winkel = ende;

    const mitte = (start + ende) / 2;
    const gross = ende - start > 180 ? 1 : 0;

    const [x1, y1] = punkt(start);
    const [x2, y2] = punkt(ende);
    /*
     * Der Ankerpunkt sitzt am Rand, nicht in der Mitte des Stücks.
     *
     * Der Text läuft von dort nach innen. SäsSe der Anker in der Mitte und
     * liefe der Text nach aussen, stünde bei einem langen Titel die Hälfte
     * ausserhalb des Kreises - genau das war beim ersten Versuch zu sehen
     * («thal Company» statt «Lethal Company»).
     */
    const [tx, ty] = punkt(mitte, 92);

    /*
     * Und die Leserichtung.
     *
     * Auf der rechten Hälfte endet der Text am Rand und läuft nach innen;
     * auf der linken beginnt er dort. Ohne diese Unterscheidung steht die
     * halbe Beschriftung auf dem Kopf - was sie beim ersten Versuch auch
     * tat.
     */
    const linkeHaelfte = mitte >= 180;

    return {
      ...feld,
      pfad: `M100 100 L${x1} ${y1} A99 99 0 ${gross} 1 ${x2} ${y2} Z`,
      textX: tx,
      textY: ty,
      textWinkel: rund(linkeHaelfte ? mitte + 90 : mitte - 90),
      textAnker: linkeHaelfte ? ('start' as const) : ('end' as const),
    };
  });
}

const rund = (wert: number): number => Number(wert.toFixed(3));

function punkt(grad: number, radius = 99): [number, number] {
  const bogen = ((grad - 90) * Math.PI) / 180;
  return [rund(100 + radius * Math.cos(bogen)), rund(100 + radius * Math.sin(bogen))];
}

function kuerze(text: string, laenge: number): string {
  return text.length <= laenge ? text : `${text.slice(0, laenge - 1)}…`;
}
