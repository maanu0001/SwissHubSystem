'use client';

import { useSyncExternalStore } from 'react';
import { stunden, zahl } from '@/modules/analytics/format';

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
 * Ein Abonnement für alle Kacheln, nicht eines je Kachel - sonst holten vier
 * Karten viermal dasselbe. Deshalb der Speicher auf Modulebene.
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

export interface LiveStand {
  /** Serverzeit des Standes, als Millisekunden. */
  asOf: number;
  zeitraum: { sekunden: number; wachsend: number };
  heute: { sekunden: number; wachsend: number };
  imSprachkanal: number;
  aktive: number;
  sitzungen: number;
}

/**
 * Der gemeinsame Stand.
 *
 * `folge` zählt bei jedem Abgleich **und** bei jedem Takt hoch. Ohne sie
 * bliebe die Momentaufnahme identisch, React zeichnete nicht neu, und die
 * Zahl stünde still, obwohl die Zeit läuft.
 */
interface Momentaufnahme {
  folge: number;
  stand: LiveStand | null;
}

let aktuell: Momentaufnahme = { folge: 0, stand: null };
const zuhoerer = new Set<() => void>();
let abgleichTimer: number | null = null;
let taktTimer: number | null = null;

function melde(stand: LiveStand | null = aktuell.stand): void {
  aktuell = { folge: aktuell.folge + 1, stand };
  for (const ruf of zuhoerer) {
    ruf();
  }
}

async function hole(): Promise<void> {
  try {
    /*
     * Derselbe Zeitraum wie die Seite.
     *
     * Er steht in der Adresse - `?zeitraum=30d`, `?zeitraum=custom&von=…`.
     * Sie einfach weiterzureichen ist genauer, als sie durch die Seite zu
     * fädeln: was im Browser steht, ist das, was der Mensch gerade ansieht.
     */
    const antwort = await fetch(`/api/analytics/live${window.location.search}`, {
      cache: 'no-store',
    });
    if (!antwort.ok) {
      return;
    }
    const nutzlast = (await antwort.json()) as Omit<LiveStand, 'asOf'> & { asOf: string };
    melde({ ...nutzlast, asOf: Date.parse(nutzlast.asOf) });
    // Der Stand entscheidet, ob weiter hochgezählt werden muss.
    taktAnpassen();
  } catch {
    // Ein verpasster Abgleich ist kein Problem - der nächste kommt, und bis
    // dahin rechnet die Anzeige weiter.
  }
}

/**
 * Den Takt an das anpassen, was tatsächlich wächst.
 *
 * Läuft keine Sitzung, ändert sich zwischen zwei Abgleichen nichts - dann
 * gibt es auch nichts neu zu zeichnen. Vor der ersten Antwort wird gezählt,
 * denn bis dahin gilt, was der Server mitgegeben hat.
 */
function taktAnpassen(): void {
  const stand = aktuell.stand;
  const waechst = stand ? stand.zeitraum.wachsend > 0 || stand.heute.wachsend > 0 : true;

  if (waechst && taktTimer === null && zuhoerer.size > 0) {
    taktTimer = window.setInterval(() => melde(), TAKT_MS);
    return;
  }
  if ((!waechst || zuhoerer.size === 0) && taktTimer !== null) {
    window.clearInterval(taktTimer);
    taktTimer = null;
  }
}

function abonniere(ruf: () => void): () => void {
  zuhoerer.add(ruf);
  if (zuhoerer.size === 1) {
    void hole();
    abgleichTimer = window.setInterval(() => void hole(), ABGLEICH_MS);
    taktAnpassen();
  }
  return () => {
    zuhoerer.delete(ruf);
    if (zuhoerer.size > 0) {
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

const lies = (): Momentaufnahme => aktuell;
/** Auf dem Server gibt es keinen laufenden Stand - dort gilt, was gerendert wurde. */
const SERVER_STAND: Momentaufnahme = { folge: 0, stand: null };
const serverLies = (): Momentaufnahme => SERVER_STAND;

function useStand(aktiv: boolean): LiveStand | null {
  return useSyncExternalStore(aktiv ? abonniere : ruhend, lies, serverLies).stand;
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
}: {
  feld: 'zeitraum' | 'heute';
  basisSekunden: number;
  wachsend: number;
  asOf: string;
  /** Reicht der gezeigte Zeitraum in die Gegenwart? Nur dann wird gefragt. */
  aktiv: boolean;
}): React.JSX.Element {
  const stand = useStand(aktiv);

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
}: {
  feld: 'imSprachkanal' | 'aktive' | 'sitzungen';
  basis: number;
  /** Reicht der gezeigte Zeitraum in die Gegenwart? Nur dann wird gefragt. */
  aktiv: boolean;
}): React.JSX.Element {
  const stand = useStand(aktiv);
  return <>{zahl(stand?.[feld] ?? basis)}</>;
}
