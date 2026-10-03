'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { klangQuelle, STANDARD_KLAENGE } from '../adressen';

/**
 * Die Tonausgabe des XP-Slots.
 *
 * ## Die wichtigste Regel
 *
 * **Kein Tonproblem haelt je einen Spin auf.** Jeder Aufruf hier ist
 * folgenlos, wenn etwas fehlt: ein Slot ohne Datei ist still, ein
 * abgewiesenes `play()` wird verschluckt, ein Browser ohne `Audio` liefert
 * eine Attrappe. Das steht so im Konzept, und es ist der Grund, weshalb hier
 * nirgends ein `throw` vorkommt und jedes `play()` ein `.catch()` hat.
 *
 * ## Warum erst nach einer Beruehrung
 *
 * Browser und Mobilgeraete lassen Ton erst zu, nachdem jemand etwas
 * angefasst hat; ein `play()` davor wird abgewiesen und schreibt eine Warnung
 * in die Konsole. Deshalb wird **gar nichts** geladen, bis `freigeben()`
 * gelaufen ist - das passiert beim ersten Klick auf Spin oder beim Einschalten
 * des Tons. Wer nie klickt, laedt keine Kilobyte.
 *
 * ## Warum zwei Regler
 *
 * Musik und Effekte sind zwei Beduerfnisse. Wer am Schreibtisch Musik hoert,
 * will die Walzen trotzdem hoeren; wer im Buero sitzt, will nur die Walzen.
 * Beide Werte und beide Schalter liegen im `localStorage` - sie gehoeren zu
 * diesem Browser und nicht zum Konto, und sie sind nach einem Neuladen
 * wieder da.
 *
 * ## Warum ein Element je Slot und nicht einer je Abspielvorgang
 *
 * Weil ein neues `Audio` je Walzenstopp bei hundert Auto-Spins fuenfhundert
 * Elemente waeren. Stattdessen gibt es eines je Slot, das zurueckgespult
 * wird. Der Preis: derselbe Klang kann sich nicht mit sich selbst
 * ueberlagern - bei einem Walzenstopp ist das sogar erwuenscht.
 */

export interface KlangEintrag {
  slot: string;
  /** Die hochgeladene Datei - oder `null` fuer den mitgelieferten Klang. */
  dateiname: string | null;
  lautstaerke: number;
  musik: boolean;
}

/**
 * Die Slots, die als Schleife laufen.
 *
 * Dieselbe Liste wie `MUSIK_SLOTS` im Modulkern, und zwar bewusst zweimal:
 * diese Datei laeuft im Browser und darf die Modulschicht mit ihrer
 * Datenbankanbindung nicht laden. Die Konfiguration bringt das Merkmal je
 * Eintrag ohnehin mit; gebraucht wird die Liste nur fuer die Slots, fuer die
 * es gar keine Konfigurationszeile gibt - die mitgelieferten.
 */
const MUSIK_SLOTS = new Set(['musik', 'freespin_loop']);

export interface KlangEinstellungen {
  musikAn: boolean;
  effekteAn: boolean;
  /** 0 bis 100. */
  musikLaut: number;
  effekteLaut: number;
}

const SPEICHER = 'swisshub.xpslot.ton';

const VORGABE: KlangEinstellungen = {
  musikAn: false,
  effekteAn: true,
  musikLaut: 35,
  effekteLaut: 70,
};

/**
 * Liest die gespeicherten Einstellungen.
 *
 * Jeder Zugriff in `try`: im privaten Fenster, bei gesperrten Website-Daten
 * und in einer Vorschau wirft der Zugriff oder gibt nichts zurueck. Dann
 * gelten die Vorgaben, und das ist kein Fehlerfall.
 */
function lies(): KlangEinstellungen {
  try {
    const roh = window.localStorage.getItem(SPEICHER);
    if (!roh) {
      return VORGABE;
    }
    const gelesen = JSON.parse(roh) as Partial<KlangEinstellungen>;
    return {
      musikAn: typeof gelesen.musikAn === 'boolean' ? gelesen.musikAn : VORGABE.musikAn,
      effekteAn: typeof gelesen.effekteAn === 'boolean' ? gelesen.effekteAn : VORGABE.effekteAn,
      musikLaut: zahl(gelesen.musikLaut, VORGABE.musikLaut),
      effekteLaut: zahl(gelesen.effekteLaut, VORGABE.effekteLaut),
    };
  } catch {
    return VORGABE;
  }
}

function zahl(wert: unknown, ersatz: number): number {
  return typeof wert === 'number' && Number.isFinite(wert)
    ? Math.max(0, Math.min(100, Math.round(wert)))
    : ersatz;
}

function schreibe(werte: KlangEinstellungen): void {
  try {
    window.localStorage.setItem(SPEICHER, JSON.stringify(werte));
  } catch {
    // Kein Speicher, kein Problem: die Einstellungen gelten fuer diese Sitzung.
  }
}

export interface Tonausgabe {
  einstellungen: KlangEinstellungen;
  setzeEinstellungen: (werte: Partial<KlangEinstellungen>) => void;
  /** Darf schon Ton kommen? */
  freigegeben: boolean;
  /** Nach der ersten Beruehrung aufrufen. Mehrfach aufrufen ist harmlos. */
  freigeben: () => void;
  /** Spielt einen Klang an. Still, wenn es ihn nicht gibt. */
  spiele: (slot: string) => void;
  /** Startet eine Schleife - Musik oder Freispielmusik. */
  starteSchleife: (slot: string) => void;
  /** Beendet eine Schleife. */
  stoppeSchleife: (slot: string) => void;
  /** Ein Slot mit Datei? Fuer die Vorschau in der Verwaltung. */
  vorhanden: (slot: string) => boolean;
}

export function useTon(klaenge: readonly KlangEintrag[]): Tonausgabe {
  const [einstellungen, setze] = useState<KlangEinstellungen>(VORGABE);
  const [freigegeben, setFreigegeben] = useState(false);
  const elemente = useRef(new Map<string, HTMLAudioElement>());
  const laufend = useRef(new Set<string>());

  // Erst im Browser lesen - auf dem Server gibt es kein `window`, und ein
  // Unterschied zwischen Server- und Clientrendern waere ein Hydrationsfehler.
  useEffect(() => {
    setze(lies());
  }, []);

  /*
   * Die Klaenge, die tatsaechlich spielen.
   *
   * Erst die mitgelieferten, dann die der Verwaltung darueber. Ein Slot, fuer
   * den jemand eine Datei hochgeladen hat, spielt diese; alle uebrigen spielen
   * den Standard. Wird die Datei spaeter entfernt, kommt der Slot gar nicht
   * mehr aus der Konfiguration - und faellt damit von allein auf den Standard
   * zurueck. Genau deshalb braucht «zuruecksetzen» hier keinen eigenen Zweig.
   */
  const nachSlot = useMemo(() => {
    const karte = new Map<string, KlangEintrag>();
    for (const slot of Object.keys(STANDARD_KLAENGE)) {
      karte.set(slot, { slot, dateiname: null, lautstaerke: 80, musik: MUSIK_SLOTS.has(slot) });
    }
    for (const eintrag of klaenge) {
      karte.set(eintrag.slot, eintrag);
    }
    return karte;
  }, [klaenge]);

  const lautstaerkeVon = useCallback(
    (eintrag: KlangEintrag): number => {
      const global = eintrag.musik ? einstellungen.musikLaut : einstellungen.effekteLaut;
      const an = eintrag.musik ? einstellungen.musikAn : einstellungen.effekteAn;
      if (!an) {
        return 0;
      }
      // Die Lautstaerke des Slots ist eine Mischung, nicht ein Regler: ein
      // Jackpot darf lauter eingestellt sein als ein Walzenstopp, und der
      // Regler der Person gilt trotzdem.
      return Math.max(0, Math.min(1, (eintrag.lautstaerke / 100) * (global / 100)));
    },
    [einstellungen],
  );

  const hole = useCallback(
    (slot: string): HTMLAudioElement | null => {
      if (!freigegeben || typeof window === 'undefined' || typeof window.Audio !== 'function') {
        return null;
      }
      const eintrag = nachSlot.get(slot);
      if (!eintrag) {
        return null;
      }
      const vorhanden = elemente.current.get(slot);
      if (vorhanden) {
        return vorhanden;
      }
      const adresse = klangQuelle(slot, eintrag.dateiname);
      if (!adresse) {
        return null;
      }
      try {
        const element = new window.Audio(adresse);
        element.preload = 'auto';
        element.loop = eintrag.musik;
        elemente.current.set(slot, element);
        return element;
      } catch {
        return null;
      }
    },
    [freigegeben, nachSlot],
  );

  // Die Regler wirken sofort - auch auf eine laufende Schleife.
  useEffect(() => {
    for (const [slot, element] of elemente.current) {
      const eintrag = nachSlot.get(slot);
      if (eintrag) {
        element.volume = lautstaerkeVon(eintrag);
      }
    }
  }, [lautstaerkeVon, nachSlot]);

  // Beim Verlassen der Seite alles anhalten. Ohne das laeuft die Musik
  // weiter, wenn jemand im Dashboard weiterklickt.
  useEffect(
    () => () => {
      for (const element of elemente.current.values()) {
        try {
          element.pause();
        } catch {
          // Ein Element, das sich nicht anhalten laesst, verschwindet mit der Seite.
        }
      }
      elemente.current.clear();
      laufend.current.clear();
    },
    [],
  );

  const setzeEinstellungen = useCallback((werte: Partial<KlangEinstellungen>) => {
    setze((vorher) => {
      const neu: KlangEinstellungen = {
        musikAn: werte.musikAn ?? vorher.musikAn,
        effekteAn: werte.effekteAn ?? vorher.effekteAn,
        musikLaut: zahl(werte.musikLaut ?? vorher.musikLaut, vorher.musikLaut),
        effekteLaut: zahl(werte.effekteLaut ?? vorher.effekteLaut, vorher.effekteLaut),
      };
      schreibe(neu);
      return neu;
    });
  }, []);

  const spiele = useCallback(
    (slot: string) => {
      const eintrag = nachSlot.get(slot);
      const element = hole(slot);
      if (!element || !eintrag) {
        return;
      }
      const laut = lautstaerkeVon(eintrag);
      if (laut <= 0) {
        return;
      }
      try {
        element.volume = laut;
        element.currentTime = 0;
        void element.play().catch(() => undefined);
      } catch {
        // Ein abgewiesenes `play()` ist kein Fehler des Spiels.
      }
    },
    [hole, lautstaerkeVon, nachSlot],
  );

  const starteSchleife = useCallback(
    (slot: string) => {
      const eintrag = nachSlot.get(slot);
      const element = hole(slot);
      if (!element || !eintrag) {
        return;
      }
      const laut = lautstaerkeVon(eintrag);
      if (laut <= 0) {
        return;
      }
      try {
        element.loop = true;
        element.volume = laut;
        if (!laufend.current.has(slot)) {
          laufend.current.add(slot);
          void element.play().catch(() => undefined);
        }
      } catch {
        // Siehe oben.
      }
    },
    [hole, lautstaerkeVon, nachSlot],
  );

  const stoppeSchleife = useCallback((slot: string) => {
    const element = elemente.current.get(slot);
    laufend.current.delete(slot);
    if (!element) {
      return;
    }
    try {
      element.pause();
      element.currentTime = 0;
    } catch {
      // Siehe oben.
    }
  }, []);

  const freigeben = useCallback(() => {
    setFreigegeben(true);
  }, []);

  const vorhanden = useCallback((slot: string) => nachSlot.has(slot), [nachSlot]);

  return {
    einstellungen,
    setzeEinstellungen,
    freigegeben,
    freigeben,
    spiele,
    starteSchleife,
    stoppeSchleife,
    vorhanden,
  };
}

/**
 * Will diese Person weniger Bewegung?
 *
 * Gelesen und **beobachtet**: die Einstellung kann sich im Betriebssystem
 * aendern, waehrend die Seite offen ist. Ohne den Beobachter muesste man neu
 * laden, damit es wirkt.
 */
export function useWenigerBewegung(): boolean {
  const [wenig, setWenig] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const abfrage = window.matchMedia('(prefers-reduced-motion: reduce)');
    setWenig(abfrage.matches);
    const hoeren = (ereignis: MediaQueryListEvent): void => setWenig(ereignis.matches);
    abfrage.addEventListener('change', hoeren);
    return () => abfrage.removeEventListener('change', hoeren);
  }, []);

  return wenig;
}
