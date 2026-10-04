/**
 * Der Walzenbaum - ohne Browser.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil der Aufbau der fuenf Walzen **pruefbar** sein soll, und zwar als
 * Verhalten und nicht als Quelltextvergleich. Die Zusage dieser Runde ist
 * eine ueber Baumform: beide Lagen jeder Walze stehen dauerhaft im Baum, und
 * ein Walzenstopp baut nichts ab und nichts auf. Vorher stand hier
 * `laeuft ? <Band/> : <Stand/>`, und das kostete gemessen rund zweihundert
 * Bildpaints je Spin - nicht die Bewegung, sondern das Entstehen und
 * Vergehen der Elemente.
 *
 * Nachsehen laesst sich das nur, indem man rendert. Die Tests des Projekts
 * uebersetzen aber mit `lib: ES2022` und ohne die DOM-Bibliothek - zu Recht,
 * denn ein Modulkern, der versehentlich `document` anfasst, soll daran
 * scheitern. `walzen.tsx` fasst `window`, `ResizeObserver` und
 * `getBoundingClientRect` an; es laesst sich dort also nicht importieren.
 *
 * Darum der Schnitt: hier steht der Baum, der aus seinen Eigenschaften
 * besteht und sonst nichts kennt. Die Messung - und damit der Browser -
 * bleibt in `walzen.tsx`, das diese Datei benutzt. Das ist genau die
 * Trennung, die das Konzept fuer den Slot beschreibt:
 *
 *     ReelViewport  (.slot-walze)
 *     ├── ReelTrack (.slot-band)   - laeuft, eine Compositor-Ebene
 *     ├── Ergebnis  (.slot-stand)  - steht
 *     └── Haftend   (.slot-haftend) - die festsitzenden Wilds
 *
 * Dieselbe Trennung wie zwischen `klang.ts` und `tonausgabe.ts`, aus
 * demselben Grund.
 */
import { useMemo } from 'react';
import { formatSwissNumber } from '@swisshub/shared';
import { symbolBild } from '../adressen';
import { cn } from '@/lib/utils';

export interface SymbolBild {
  key: string;
  name: string;
  bildPfad: string | null;
  bildUrl: string | null;
  glow: boolean;
}

export interface WalzenBaumProps {
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
  /**
   * Was genau **diese** Linie wert ist, in XP.
   *
   * Steht ein Wert da, erscheint ein Schild an der Linie. Das ist der
   * Unterschied zwischen «vier Linien haben zusammen 1'500 XP gebracht» und
   * «diese Linie hier war 250 XP wert»: die Summe steht unter der Buehne, die
   * einzelne Zahl gehoert an die Linie, die man gerade sieht.
   */
  linienGewinn?: number | null;
  /** Wie lange eine Linie gezeigt wird - das Schild blendet darin ein und aus. */
  linienDauerMs?: number;
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
 * Was der Baum zusaetzlich braucht: die fertige Geometrie.
 *
 * Er misst nicht und er merkt sich nichts. `rahmen` und `walzenRef` gibt er
 * weiter, damit `walzen.tsx` seine Elemente findet; `mitten` und `kasten`
 * kommen schon gerechnet herein. Genau das ist die Zusage aus §27: beim
 * Anzeigen einer Gewinnlinie wird nicht gemessen, die Punkte liegen vor.
 */
export interface WalzenBildProps extends WalzenBaumProps {
  rahmen: (element: HTMLDivElement | null) => void;
  walzenRef: (walze: number) => (element: HTMLDivElement | null) => void;
  mitten: readonly Mitte[];
  kasten: Kasten | null;
}

/** Ein zufaelliges Fuellsymbol - nur fuer das laufende Band. */
function fuellung(symbole: readonly SymbolBild[], index: number): SymbolBild | undefined {
  return symbole[index % Math.max(1, symbole.length)];
}

export function WalzenBild({
  rahmen,
  walzenRef,
  mitten,
  kasten,
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
  linienGewinn = null,
  linienDauerMs = 520,
}: WalzenBildProps): React.JSX.Element {
  const nachKey = useMemo(() => new Map(symbole.map((eintrag) => [eintrag.key, eintrag])), [symbole]);
  const trefferSet = useMemo(() => new Set(treffer), [treffer]);
  const klebtSet = useMemo(() => new Set(klebend), [klebend]);
  const wildSymbol = wildKey ? nachKey.get(wildKey) : undefined;

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
              Beide Lagen stehen **immer** im Baum.

              ## Der Fehler, den das behebt

              Hier stand `laeuft ? <Band/> : <Stand/>`. Das sieht sparsam aus
              und ist das Gegenteil: bei jedem Walzenstart und jedem
              Walzenstopp baut React den Teilbaum neu auf - sechs Fuellbilder
              raus, drei Ergebnisbilder rein, fuenfmal je Spin. Gemessen waren
              das rund **zweihundert Bildpaints je Spin**: nicht die Bewegung,
              sondern das Entstehen und Vergehen der Elemente.

              Jetzt entstehen die Elemente einmal und bleiben. Welche Lage man
              sieht, entscheidet CSS an `slot-walze--stopp` - und das ist
              dieselbe Klasse, die auch den Stopp-Federer ausloest. Ein
              verstecktes Band zeigt dabei nichts vom Ergebnis: es traegt nur
              Fuellsymbole, heute wie vorher.

              Beide liegen absolut im Walzenfenster, der Wechsel aendert die
              Hoehe der Walze also nicht - das war der alte Fehler mit der
              Maschine, die sich waehrend des Spins dehnte.
            */}
            <div className="slot-band">
              {/*
                Sechs Fuellzellen statt drei: das Band muss ueber die
                sichtbare Hoehe hinausreichen, sonst gaebe es beim Umlauf
                eine Luecke.
              */}
              {Array.from({ length: reihen * 2 }, (_leer, reihe) => (
                <Zelle key={`fuell-${reihe}`} symbol={fuellung(symbole, walze * 7 + reihe * 3)} />
              ))}
            </div>

            <div className="slot-stand">
              {Array.from({ length: reihen }, (_leer, reihe) => {
                const index = walze * reihen + reihe;
                return (
                  <Zelle
                    key={index}
                    symbol={nachKey.get(grid[index] ?? '')}
                    treffer={!laeuft && trefferSet.has(index)}
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

      {/* Und das Schild mit dem XP-Wert genau dieser Linie. */}
      {linie && linienGewinn !== null && linienGewinn > 0 && mitten.length > 0 && kasten !== null ? (
        <LinienSchild
          key={`${linie.join('-')}:${linienGewinn}`}
          zellen={linie}
          mitten={mitten}
          kasten={kasten}
          reihen={reihen}
          gewinn={linienGewinn}
          dauerMs={linienDauerMs}
        />
      ) : null}
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

/**
 * Das XP-Schild einer einzelnen Gewinnlinie.
 *
 * ## Wo es steht
 *
 * Ueber dem hoechsten Punkt der Linie, waagrecht in deren Mitte - und zwar
 * aus denselben gemessenen Punkten, aus denen der Pfad entsteht. Deshalb
 * sitzt es auf jedem Geraet an der Linie und nicht irgendwo in der Naehe.
 *
 * Reicht der Platz oben nicht - bei einer Linie, die in der obersten Reihe
 * verlaeuft -, klappt es nach unten. Ein Schild, das halb aus der Buehne
 * ragt, waere schlimmer als eines, das eine Zeile tiefer steht; und ueber den
 * Symbolen der Linie selbst darf es nicht liegen, sonst verdeckt es genau
 * das, was es erklaert.
 *
 * ## Warum die Dauer von aussen kommt
 *
 * Weil sie dieselbe sein muss wie die Zeit, die eine Linie gezeigt wird.
 * Stuende sie im Stylesheet, waeren es zwei Zahlen fuer einen Takt - und die
 * laufen auseinander, sobald jemand eine davon aendert.
 */
function LinienSchild({
  zellen,
  mitten,
  kasten,
  reihen,
  gewinn,
  dauerMs,
}: {
  zellen: readonly number[];
  mitten: readonly Mitte[];
  kasten: Kasten;
  reihen: number;
  gewinn: number;
  dauerMs: number;
}): React.JSX.Element | null {
  const punkte = zellen.map((index) => mitten[index]).filter((punkt): punkt is Mitte => punkt !== undefined);
  if (punkte.length === 0 || kasten.breite <= 0 || kasten.hoehe <= 0) {
    return null;
  }

  const zelle = kasten.hoehe / Math.max(1, reihen);
  const mitteX = punkte.reduce((summe, punkt) => summe + punkt.x, 0) / punkte.length;
  const oben = Math.min(...punkte.map((punkt) => punkt.y)) - zelle * 0.5 - 4;
  const unten = Math.max(...punkte.map((punkt) => punkt.y)) + zelle * 0.5 + 4;
  // Unter 26 Pixeln ragt das Schild oben heraus - dann nach unten.
  const nachUnten = oben < 26;

  return (
    <span
      className={cn('slot-linien-schild', nachUnten && 'slot-linien-schild--unten')}
      style={{
        left: `${Math.max(44, Math.min(kasten.breite - 44, mitteX)).toFixed(1)}px`,
        top: `${(nachUnten ? unten : oben).toFixed(1)}px`,
        animationDuration: `${dauerMs}ms`,
      }}
      aria-hidden="true"
    >
      +{formatSwissNumber(gewinn)} XP
    </span>
  );
}
