'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { spielwahl } from '@swisshub/modules';

export type Stand = Awaited<ReturnType<typeof spielwahl.baueAnsicht>> & object;

/**
 * Die Verbindung zur Bühne.
 *
 * ## Die eine Regel
 *
 * **Der Server hat recht.** Dieser Haken hält keinen eigenen Zustand, den er
 * mit dem Server abgleicht; er hält den letzten Schnappschuss, den er
 * bekommen hat, und ersetzt ihn, sobald ein neuerer kommt. Eine Stimme, die
 * gerade abgegeben wurde, erscheint nicht sofort - sie erscheint, wenn der
 * Server sie bestätigt hat.
 *
 * Das ist spürbar langsamer als optimistisches Zeichnen und dafür nie
 * falsch. Bei einer Abstimmung, in der es darauf ankommt, wer was hat, ist
 * das der richtige Tausch.
 *
 * ## Warum die Revision
 *
 * Zwei Wege führen zum selben Bildschirm: der Strom und die Antwort auf eine
 * eigene Handlung. Sie können sich überholen. Ein Schnappschuss mit
 * kleinerer Revision als der vorhandene wird deshalb weggeworfen - sonst
 * blitzte gelegentlich der alte Stand auf.
 *
 * ## Und wenn der Strom abreisst?
 *
 * Dann verbindet der Browser von selbst neu; `EventSource` tut das ohne
 * Zutun. Die Anzeige sagt derweil, dass die Verbindung steht oder nicht -
 * eine Bühne, die stillsteht, ohne es zu sagen, ist schlimmer als eine, die
 * es zugibt.
 */
export interface Verbindung {
  stand: Stand;
  verbunden: boolean;
  /** Einen Schnappschuss übernehmen, der über einen anderen Weg kam. */
  uebernimm: (neu: Stand | null | undefined) => void;
}

export function useSpielwahl(anfang: Stand): Verbindung {
  const [stand, setStand] = useState<Stand>(anfang);
  const [verbunden, setVerbunden] = useState(false);
  const revision = useRef(anfang.revision);

  const uebernimm = useCallback((neu: Stand | null | undefined) => {
    if (!neu || neu.revision < revision.current) {
      return;
    }
    revision.current = neu.revision;
    setStand(neu);
  }, []);

  const sessionId = anfang.id;

  useEffect(() => {
    const quelle = new EventSource(`/api/was-spielen-wir/${encodeURIComponent(sessionId)}/live`);

    quelle.addEventListener('open', () => setVerbunden(true));
    quelle.addEventListener('stand', (ereignis) => {
      setVerbunden(true);
      try {
        uebernimm(JSON.parse((ereignis as MessageEvent<string>).data) as Stand);
      } catch {
        // Eine unlesbare Nachricht ist kein Grund, den Strom aufzugeben.
      }
    });
    /*
     * Der Server beendet lange Ströme von sich aus. Das ist kein Fehler,
     * sondern der Punkt, an dem die Berechtigung neu geprüft wird - also
     * schliessen und neu verbinden.
     */
    quelle.addEventListener('neuverbinden', () => quelle.close());
    quelle.addEventListener('error', () => setVerbunden(false));

    return () => quelle.close();
  }, [sessionId, uebernimm]);

  return { stand, verbunden, uebernimm };
}

/**
 * Ob die Person weniger Bewegung möchte.
 *
 * Wird zur Laufzeit befragt und nicht nur über CSS: bei einer Auslosung
 * genügt es nicht, die Animation zu verkürzen - dann stünde das Ergebnis für
 * diese eine Person sofort da, während die anderen noch zehn Sekunden auf
 * ein drehendes Rad schauen. Zwei Leute im selben Raum wüssten verschiedene
 * Dinge, und das ist keine Erleichterung, sondern ein Fehler.
 *
 * Deshalb bekommt sie **kein** Rad, sondern eine ruhige Anzeige mit
 * demselben Countdown - und erfährt den Gewinner in derselben Sekunde wie
 * alle anderen.
 */
export function useRuhig(): boolean {
  const [ruhig, setRuhig] = useState(false);

  useEffect(() => {
    const abfrage = window.matchMedia('(prefers-reduced-motion: reduce)');
    setRuhig(abfrage.matches);
    const hoeren = (ereignis: MediaQueryListEvent): void => setRuhig(ereignis.matches);
    abfrage.addEventListener('change', hoeren);
    return () => abfrage.removeEventListener('change', hoeren);
  }, []);

  return ruhig;
}

/**
 * Ein Befehlsschlüssel.
 *
 * Er entsteht im Browser, weil nur dort bekannt ist, ob der zweite Klick
 * derselbe Klick war. `crypto.randomUUID` gibt es in jedem Browser, der
 * diese Anwendung ohnehin voraussetzt.
 */
export function neuerSchluessel(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/**
 * Die verbleibende Zeit, aus der Uhr des Servers.
 *
 * Die lokale Uhr wird **nicht** befragt, um zu entscheiden - nur, um
 * zwischen zwei Schnappschüssen weiterzuzählen. Der Versatz zwischen beiden
 * wird einmal gemessen und abgezogen; damit stimmt der Countdown auch auf
 * einem Gerät, dessen Uhr zehn Minuten falsch geht.
 */
export function useFrist(endsAt: string | null, serverJetzt: string): number | null {
  const versatz = useRef(0);
  const [rest, setRest] = useState<number | null>(null);

  useEffect(() => {
    versatz.current = Date.parse(serverJetzt) - Date.now();
  }, [serverJetzt]);

  useEffect(() => {
    if (!endsAt) {
      setRest(null);
      return;
    }
    const ziel = Date.parse(endsAt);
    const rechnen = (): void => {
      setRest(Math.max(0, ziel - (Date.now() + versatz.current)));
    };
    rechnen();
    const uhr = window.setInterval(rechnen, 200);
    return () => window.clearInterval(uhr);
  }, [endsAt]);

  return rest;
}
