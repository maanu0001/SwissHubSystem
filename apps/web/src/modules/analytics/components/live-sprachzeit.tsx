'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { stunden, zahl } from '@/modules/analytics/format';
import { liveSpeicher, type LiveStand, type Momentaufnahme } from '@/modules/analytics/live-speicher';

/**
 * Die Sprachzeit, während man zusieht.
 *
 * Die Seite rechnet den Stand beim Aufruf aus - ein Neuladen ist damit immer
 * aktuell. Bleibt sie offen, altert die Zahl trotzdem: wer noch im Kanal
 * sitzt, sammelt weiter Zeit, und eine Kachel, die eine Viertelstunde lang
 * dieselbe Zahl zeigt, ist falsch, ohne kaputt auszusehen.
 *
 * ## Wie sie aktuell bleibt
 *
 * Zwei Dinge, und beide bewusst bescheiden:
 *
 * 1. **Rechnen.** Der Server sagt, wie viele Sitzungen gerade laufen. Je
 *    laufender Sitzung kommt eine Sekunde je Sekunde dazu - das lässt sich
 *    hier ausrechnen und braucht keine Anfrage. Gerechnet wird ab `asOf`,
 *    dem Zeitpunkt des Servers: die Uhr des Browsers misst nur die
 *    verstrichene Spanne und ist damit auch dann harmlos, wenn sie falsch
 *    geht. Gespeichert wird von hier ohnehin nichts.
 * 2. **Nachfragen.** Alle `ABGLEICH_MS` holt **eine** Anfrage den echten
 *    Stand. Damit kommt auch an, was hier niemand wissen kann: dass jemand
 *    gegangen ist, dazugekommen oder in den AFK-Kanal gewechselt.
 *
 * Ein Abonnement für alle Kacheln, nicht eines je Kachel - sonst holten fünf
 * Karten fünfmal dasselbe. Der gemeinsame Speicher steht in `live-speicher`;
 * dort steht auch, warum jeder Stand die Abfrage trägt, zu der er gehört.
 * Diese Datei ist die Verdrahtung mit React und sonst nichts.
 *
 * ## Wann geruht wird - und wann nicht
 *
 * Eine Statistik über einen **abgeschlossenen** Zeitraum ist fertig; dort
 * gibt es nichts abzugleichen, und dafür wird auch nichts abgefragt.
 *
 * Nicht aber: «gerade läuft keine Sitzung». Das stand hier vorher, und es
 * war der zweite Grund für «Gerade im Sprachkanal: 0». War beim Aufbau der
 * Seite niemand im Kanal, wurde nie wieder nachgefragt - traten zwei Minuten
 * später zwanzig Leute bei, blieb die Kachel auf 0, bis jemand neu lud. Eine
 * Zahl, die «gerade» heisst, muss auch dann nachsehen, wenn die letzte
 * Antwort «niemand» war.
 *
 * Der Abruf und der Takt sind deshalb getrennt: abgefragt wird, solange der
 * Zeitraum in die Gegenwart reicht; hochgezählt wird nur, solange wirklich
 * etwas wächst.
 */

/** Wie oft der echte Stand geholt wird. */
const ABGLEICH_MS = 30_000;
/**
 * Wie oft neu gezeichnet wird.
 *
 * Die Anzeige hat eine Nachkommastelle und ändert sich damit frühestens alle
 * sechs Minuten je laufender Sitzung. Fünf Sekunden sind dafür reichlich fein
 * und kosten nichts - es ist eine Addition, kein Abruf.
 */
const TAKT_MS = 5_000;

export type { LiveStand } from '@/modules/analytics/live-speicher';

let abgleichTimer: number | null = null;
let taktTimer: number | null = null;

async function hole(): Promise<void> {
  /*
   * Die Abfrage kommt aus dem Speicher, nicht aus `window.location`.
   *
   * Beides stimmt meistens überein, aber «meistens» ist bei einer weichen
   * Navigation kein Verlass: wessen Zahl die Kachel zeigt, muss dieselbe
   * Quelle bestimmen, die auch den Schlüssel setzt. Sonst gehört die Antwort
   * zu einem Zeitraum und der Schlüssel zu einem anderen.
   */
  const fuer = liveSpeicher.gewuenschteAbfrage();
  try {
    const antwort = await fetch(`/api/analytics/live${fuer}`, { cache: 'no-store' });
    if (!antwort.ok) {
      return;
    }
    const nutzlast = (await antwort.json()) as Omit<LiveStand, 'asOf'> & { asOf: string };
    // `uebernimm` verwirft die Antwort, wenn inzwischen ein anderer Zeitraum
    // gewählt wurde - zwei Abrufe kommen nicht zwingend der Reihe nach zurück.
    if (liveSpeicher.uebernimm({ ...nutzlast, asOf: Date.parse(nutzlast.asOf) }, fuer)) {
      taktAnpassen();
    }
  } catch {
    // Ein verpasster Abgleich ist kein Problem - der nächste kommt, und bis
    // dahin rechnet die Anzeige weiter.
  }
}

/**
 * Den Takt an das anpassen, was tatsächlich wächst.
 *
 * Läuft keine Sitzung, ändert sich zwischen zwei Abgleichen nichts - dann
 * gibt es auch nichts neu zu zeichnen.
 */
function taktAnpassen(): void {
  const waechst = liveSpeicher.waechst();

  if (waechst && taktTimer === null && liveSpeicher.zuhoererZahl() > 0) {
    taktTimer = window.setInterval(() => liveSpeicher.schlag(), TAKT_MS);
    return;
  }
  if ((!waechst || liveSpeicher.zuhoererZahl() === 0) && taktTimer !== null) {
    window.clearInterval(taktTimer);
    taktTimer = null;
  }
}

function abonniere(ruf: () => void): () => void {
  const abmelden = liveSpeicher.abonniere(ruf);
  if (liveSpeicher.zuhoererZahl() === 1) {
    void hole();
    abgleichTimer = window.setInterval(() => void hole(), ABGLEICH_MS);
    taktAnpassen();
  }
  return () => {
    abmelden();
    if (liveSpeicher.zuhoererZahl() > 0) {
      return;
    }
    for (const timer of [abgleichTimer, taktTimer]) {
      if (timer !== null) {
        window.clearInterval(timer);
      }
    }
    abgleichTimer = null;
    taktTimer = null;
  };
}

/** Kein Abonnement - für Kacheln, an denen sich nichts mehr ändert. */
function ruhend(): () => void {
  return () => undefined;
}

const lies = (): Momentaufnahme => liveSpeicher.lies();
/** Auf dem Server gibt es keinen laufenden Stand - dort gilt, was gerendert wurde. */
const SERVER_STAND: Momentaufnahme = { folge: 0, stand: null, schluessel: null };
const serverLies = (): Momentaufnahme => SERVER_STAND;

/**
 * Der laufende Stand - aber nur, wenn er zu dieser Abfrage gehört.
 *
 * Die Prüfung über `schluessel` steht im Ergebnis und nicht im Effekt: ein
 * Effekt läuft **nach** dem Zeichnen, und für ein Bild lang stünde sonst die
 * Zahl des vorigen Zeitraums auf der Kachel. Genau das war der Fehler.
 */
function useStand(aktiv: boolean, abfrage: string): LiveStand | null {
  useEffect(() => {
    if (aktiv && liveSpeicher.setzeAbfrage(abfrage)) {
      void hole();
    }
  }, [aktiv, abfrage]);

  const momentaufnahme = useSyncExternalStore(aktiv ? abonniere : ruhend, lies, serverLies);
  return momentaufnahme.schluessel === abfrage ? momentaufnahme.stand : null;
}

/**
 * Eine Sprachzeit-Kennzahl, die weiterläuft.
 *
 * `basisSekunden`, `wachsend` und `asOf` kommen vom Server und gelten ab
 * dessen Zeitpunkt. Bis zum ersten Abgleich wird damit gerechnet - die Kachel
 * ist also von der ersten Sekunde an richtig und nicht erst nach dem ersten
 * Abruf.
 */
export function LiveSprachzeit({
  feld,
  basisSekunden,
  wachsend,
  asOf,
  aktiv,
  abfrage,
}: {
  feld: 'zeitraum' | 'heute';
  basisSekunden: number;
  wachsend: number;
  asOf: string;
  /** Reicht der gezeigte Zeitraum in die Gegenwart? Nur dann wird gefragt. */
  aktiv: boolean;
  /** Die Abfrage des gezeigten Zeitraums - `''` oder `'?zeitraum=1d'`. */
  abfrage: string;
}): React.JSX.Element {
  const stand = useStand(aktiv, abfrage);

  const quelle = stand?.[feld] ?? { sekunden: basisSekunden, wachsend };
  const bezug = stand?.asOf ?? Date.parse(asOf);
  const seither = Math.max(0, Date.now() - bezug) / 1000;

  return <>{stunden(quelle.sekunden + quelle.wachsend * seither)}</>;
}

/** Eine einfache Zahl, die der Abgleich aktuell hält. */
export function LiveZahl({
  feld,
  basis,
  aktiv,
  abfrage,
}: {
  feld: 'imSprachkanal' | 'aktive' | 'sitzungen';
  basis: number;
  /** Reicht der gezeigte Zeitraum in die Gegenwart? Nur dann wird gefragt. */
  aktiv: boolean;
  /** Die Abfrage des gezeigten Zeitraums - `''` oder `'?zeitraum=1d'`. */
  abfrage: string;
}): React.JSX.Element {
  const stand = useStand(aktiv, abfrage);
  return <>{zahl(stand?.[feld] ?? basis)}</>;
}
