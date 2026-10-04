'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { klangQuelle, STANDARD_KLAENGE } from '../adressen';
import type { KlangEinstellungen, KlangEintrag, SchleifenOptionen, Tonausgabe } from './tonausgabe';

/*
 * Der Vertrag steht in `tonausgabe.ts` und wird von hier weitergegeben.
 *
 * Grund: diese Datei fasst `window` an, und Tests uebersetzen ohne die
 * DOM-Bibliothek. Wer den Vertrag braucht - die Ereigniszuordnung, eine
 * Attrappe im Test -, soll nicht den ganzen Browser mitziehen muessen.
 */
export type { KlangEinstellungen, KlangEintrag, SchleifenOptionen, Tonausgabe };

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
 * ## Warum ein Klang sich jetzt mit sich selbst ueberlagern kann
 *
 * Es gab hier lange genau **ein** Element je Slot, mit der Begruendung, ein
 * neues `Audio` je Walzenstopp waeren bei hundert Auto-Spins fuenfhundert
 * Elemente. Der Preis dafuer stand als Nebensatz daneben - «derselbe Klang
 * kann sich nicht mit sich selbst ueberlagern» - und dieser Preis war zu
 * hoch:
 *
 *  - Fuenf Walzen halten nacheinander. Mit einem Element schneidet der
 *    zweite Stopp den ersten ab; man hoert nicht fuenf Einrastungen, sondern
 *    vier abgehackte und eine ganze.
 *  - Vier Gewinnlinien werden einzeln gezeigt und sollen einzeln klingen.
 *    Mit einem Element ist das ein Stottern statt vier Treffern.
 *
 * Deshalb hat jeder Slot jetzt einen kleinen **Stimmenpool**. Er waechst nur,
 * wenn er gebraucht wird: angelegt wird eine Stimme, eine zweite entsteht
 * erst, wenn ein Klang kommt, waehrend die erste noch laeuft. Mehr als
 * {@link POOL_STIMMEN} werden es nie - danach uebernimmt die aelteste Stimme
 * wieder, so wie vorher. Alle Stimmen eines Slots zeigen auf dieselbe
 * Adresse; der Browser laedt sie einmal.
 *
 * ## Warum leichte Abweichungen
 *
 * Fuenfmal exakt dieselbe Datei in 800 Millisekunden klingt nach Maschine,
 * nicht nach Automat - es ist derselbe Abtastwert, fuenfmal uebereinander.
 * Darum bekommen die Klaenge, die schnell wiederkommen, eine winzige
 * Abweichung in Tonhoehe und Lautstaerke ({@link ABWEICHUNG}). Die Reihe ist
 * **fest** und nicht zufaellig: die fuenf Stopps eines Spins klingen jedes
 * Mal gleich, nur untereinander verschieden. Die grossen Momente - Jackpot,
 * Mega, Bonus - bleiben unberuehrt; die sollen jedes Mal identisch sitzen.
 *
 * ## Warum Schleifen ein- und ausgeblendet werden
 *
 * Ein `pause()` mitten im Ton ist ein harter Schnitt, und bei einem
 * Musikwechsel - normale Musik, Freispielmusik, zurueck - hoert man ihn als
 * Knacken. Jede Schleife wird deshalb ueber {@link BLENDE_MS} auf- und
 * abgefahren. Startet eine Schleife, waehrend die andere ausblendet, ist das
 * von allein eine Ueberblendung; man muss dafuer nichts weiter tun, als
 * beides im selben Moment zu sagen.
 */

/**
 * Die Slots, die als Schleife laufen - und die, die am Musikregler haengen.
 *
 * Dieselben Listen wie im Modulkern, und zwar bewusst zweimal: diese Datei
 * laeuft im Browser und darf die Modulschicht mit ihrer Datenbankanbindung
 * nicht laden. Gebraucht werden sie fuer die Slots, fuer die es gar keine
 * Konfigurationszeile gibt - die mitgelieferten.
 *
 * Der Unterschied zwischen den beiden ist der Grund, weshalb es zwei sind:
 * Walzenlauf und Rad **laufen** als Schleife, gehoeren aber zu den Effekten.
 * Wer die Musik abschaltet, will die Walzen weiter hoeren.
 */
const SCHLEIFEN_SLOTS = new Set(['musik', 'freespin_loop', 'reel_loop', 'gamble_spin']);
const MUSIK_SLOTS = new Set(['musik', 'freespin_loop']);

/** Mehr Stimmen als das bekommt kein Slot, auch im Auto-Spin nicht. */
const POOL_STIMMEN = 4;

/**
 * Die Slots mit leichter Abweichung je Wiederholung.
 *
 * Genau die, die schnell hintereinander kommen koennen: fuenf Walzenstopps je
 * Spin, ein Gewinnklang je Linie, der Knopf so oft, wie jemand klickt. Alles
 * andere bleibt bei jedem Mal identisch - ein Jackpot, der jedes Mal ein
 * bisschen anders klingt, klingt kaputt und nicht lebendig.
 */
const VARIATION = new Set(['reel_stop', 'ui_button', 'no_win', 'win_small', 'win_normal', 'win_big']);

/**
 * Die Abweichungsreihe.
 *
 * Fuenf Eintraege, weil ein Spin fuenf Walzen hat: die fuenf Stopps
 * durchlaufen die Reihe genau einmal und fangen beim naechsten Spin wieder
 * vorn an. Die Werte sind klein - unter vier Prozent -, weil mehr nicht mehr
 * nach derselben Mechanik klingt, sondern nach einem Fehler.
 */
const ABWEICHUNG: readonly { rate: number; laut: number }[] = [
  { rate: 1, laut: 1 },
  { rate: 1.028, laut: 0.95 },
  { rate: 0.974, laut: 1 },
  { rate: 1.014, laut: 0.97 },
  { rate: 0.988, laut: 0.99 },
];

const OHNE_ABWEICHUNG = { rate: 1, laut: 1 } as const;

/**
 * Wie lange eine Schleife auf- und abgefahren wird, je Slot.
 *
 * Die Musik lang, weil ein Wechsel der Stimmung Zeit braucht und ein
 * Schnitt dort am meisten auffaellt. Walzenlauf und Rad kurz: sie gehoeren zu
 * einer Bewegung, die sichtbar aufhoert, und eine Ausblende von einer halben
 * Sekunde waere ein Nachlaufen, das man als Fehler hoert. Kurz heisst aber
 * nicht Null - genau Null ist das Knacken, das wir loswerden wollen.
 */
const BLENDE_MS: Readonly<Record<string, number>> = {
  musik: 650,
  freespin_loop: 650,
  reel_loop: 110,
  gamble_spin: 140,
};
const BLENDE_VORGABE = 200;
const BLENDE_SCHRITT = 25;

const SPEICHER = 'swisshub.xpslot.ton';

/*
 * Die Vorgaben.
 *
 * Musik **an**, und zwar leise: sie ist jetzt mitgeliefert, sie gehoert zum
 * Spiel, und sie laeuft erst nach der ersten Beruehrung - ein Automat, der
 * stumm startet, klingt kaputt. Wer sie nicht will, schaltet sie mit einem
 * Klick aus, und die Entscheidung bleibt in diesem Browser.
 */
const VORGABE: KlangEinstellungen = {
  musikAn: true,
  effekteAn: true,
  musikLaut: 28,
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

const begrenzt = (wert: number): number => Math.max(0, Math.min(1, wert));

export function useTon(klaenge: readonly KlangEintrag[]): Tonausgabe {
  const [einstellungen, setze] = useState<KlangEinstellungen>(VORGABE);
  const [freigegeben, setFreigegeben] = useState(false);
  /**
   * Dasselbe als Referenz - und das ist nicht Bequemlichkeit.
   *
   * ## Der Fehler, den das behebt
   *
   * `freigeben()` wird im **ersten** Spin aufgerufen, in derselben Funktion,
   * die unmittelbar danach den Spinstart und den Walzenlauf anfordert. Ein
   * `setState` wirkt aber erst beim naechsten Rendern: `freigegeben` war in
   * genau diesen Aufrufen noch `false`, und `baue` gab `null` zurueck. Der
   * erste Spin eines Besuchs lief damit ohne Startklang und ohne Walzenlauf
   * - die Walzenstopps kamen, weil React bis dahin neu gerendert hatte.
   *
   * Das war nicht zu sehen und nur schwer zu hoeren, und der Browser-Smoke
   * hat es gefunden, indem er die Abspielvorgaenge gezaehlt hat: Spinstart
   * **null** Mal statt einmal.
   *
   * Die Referenz gilt sofort. Der Zustand bleibt daneben stehen, weil die
   * Effekte - Vorladen, Lautstaerke - an einer Zustandsaenderung haengen
   * muessen, um ueberhaupt zu laufen.
   */
  const freigegebenRef = useRef(false);
  /** Je Slot ein Stimmenpool. Stimme 0 traegt auch die Schleifen. */
  const elemente = useRef(new Map<string, HTMLAudioElement[]>());
  const laufend = useRef(new Set<string>());
  /** Wie oft ein Slot schon gespielt hat - fuer die Abweichungsreihe. */
  const zaehler = useRef(new Map<string, number>());
  /**
   * Die laufenden Blenden, je Slot eine - mit ihrem Ziel.
   *
   * Das Ziel steht dabei, weil es gebraucht wird: die Grundstimmung wird aus
   * einem Effekt gesetzt, und der laeuft bei jedem Rendern. Ohne den
   * Vergleich «blendet schon auf genau diesen Wert» begaenne jedes Rendern
   * die Blende neu, von der gerade erreichten Lautstaerke aus - sie wuerde
   * nie fertig.
   */
  const blenden = useRef(new Map<string, { uhr: number; ziel: number }>());

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
   *
   * ## Warum alle mitgelieferten auf 80 stehen
   *
   * Weil die Dateien selbst eingepegelt sind: `ZIELPEGEL` in
   * `scripts/xp-slot-standardklaenge.mjs` legt jeden Standardklang auf ein
   * gewolltes Niveau, und die Treppe von dort - Knopf unten, Jackpot oben -
   * ist die Mischung. Eine zweite Korrekturtabelle an dieser Stelle waere ein
   * zweiter Mischpult-Zug fuer denselben Regler, und zwei davon widersprechen
   * sich irgendwann.
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
      return begrenzt((eintrag.lautstaerke / 100) * (global / 100));
    },
    [einstellungen],
  );

  /** Eine neue Stimme fuer einen Slot - oder `null`, wenn es nicht geht. */
  const baue = useCallback(
    (slot: string): HTMLAudioElement | null => {
      if (!freigegebenRef.current || typeof window === 'undefined' || typeof window.Audio !== 'function') {
        return null;
      }
      const eintrag = nachSlot.get(slot);
      if (!eintrag) {
        return null;
      }
      const adresse = klangQuelle(slot, eintrag.dateiname);
      if (!adresse) {
        return null;
      }
      try {
        const element = new window.Audio(adresse);
        element.preload = 'auto';
        element.loop = SCHLEIFEN_SLOTS.has(slot);
        return element;
      } catch {
        return null;
      }
    },
    [nachSlot],
  );

  /** Der Pool eines Slots, mit mindestens einer Stimme. */
  const hole = useCallback(
    (slot: string): HTMLAudioElement[] | null => {
      const vorhanden = elemente.current.get(slot);
      if (vorhanden && vorhanden.length > 0) {
        return vorhanden;
      }
      const erste = baue(slot);
      if (!erste) {
        return null;
      }
      const pool = [erste];
      elemente.current.set(slot, pool);
      return pool;
    },
    [baue],
  );

  const brichBlendeAb = useCallback((slot: string): void => {
    const laufende = blenden.current.get(slot);
    if (laufende) {
      window.clearInterval(laufende.uhr);
      blenden.current.delete(slot);
    }
  }, []);

  /**
   * Faehrt die Lautstaerke eines Elements auf einen Zielwert.
   *
   * `danach` laeuft nur, wenn die Blende wirklich durchgelaufen ist. Eine
   * abgebrochene Blende - weil im selben Moment wieder gestartet wurde - darf
   * ihr `pause()` nicht nachtraeglich ausfuehren; das waere eine Schleife,
   * die eine halbe Sekunde nach dem Start von allein verstummt.
   */
  const blende = useCallback(
    (slot: string, element: HTMLAudioElement, nach: number, danach?: () => void): void => {
      brichBlendeAb(slot);
      if (typeof window === 'undefined') {
        return;
      }
      const dauer = BLENDE_MS[slot] ?? BLENDE_VORGABE;
      const schritte = Math.max(1, Math.round(dauer / BLENDE_SCHRITT));
      const von = element.volume;
      let schritt = 0;
      const uhr = window.setInterval(() => {
        schritt += 1;
        const anteil = Math.min(1, schritt / schritte);
        try {
          element.volume = begrenzt(von + (nach - von) * anteil);
        } catch {
          // Ein Element, dessen Lautstaerke sich nicht setzen laesst, ist
          // kein Grund, die Blende weiterlaufen zu lassen.
          schritt = schritte;
        }
        if (anteil >= 1) {
          brichBlendeAb(slot);
          danach?.();
        }
      }, BLENDE_SCHRITT);
      blenden.current.set(slot, { uhr, ziel: nach });
    },
    [brichBlendeAb],
  );

  /*
   * Vorladen, sobald Ton ueberhaupt erlaubt ist.
   *
   * ## Warum das zur Synchronitaet gehoert
   *
   * Ein Element entstand bisher beim ersten Abspielen. Der erste Walzenstopp
   * eines Besuchs musste also erst eine Datei holen - und kam damit zu spaet,
   * sichtbar neben der Animation. Ein Klang, der einmal zu spaet kommt,
   * macht den ganzen Satz unglaubwuerdig.
   *
   * Darum wird nach der Freigabe je Slot die erste Stimme angelegt;
   * `preload = 'auto'` laedt dann im Hintergrund. Weitere Stimmen entstehen
   * erst, wenn sie gebraucht werden - sie zeigen auf dieselbe, dann schon
   * geladene Adresse. Die Musik bleibt bewusst aussen vor: sie ist die
   * groesste Datei und wird ohnehin gestartet, nicht angespielt.
   */
  useEffect(() => {
    if (!freigegeben) {
      return;
    }
    for (const slot of nachSlot.keys()) {
      if (MUSIK_SLOTS.has(slot)) {
        continue;
      }
      hole(slot);
    }
  }, [freigegeben, hole, nachSlot]);

  /*
   * Die Regler wirken sofort - auch auf eine laufende Schleife.
   *
   * Nur auf die Schleifen: ein Einmalklang bekommt seine Lautstaerke beim
   * Abspielen, samt Abweichung, und die wuerde hier wieder plattgebuegelt.
   * Und nicht auf eine Schleife, die gerade blendet - sonst springt sie
   * mitten in der Ueberblendung auf den Endwert.
   */
  useEffect(() => {
    for (const slot of laufend.current) {
      if (blenden.current.has(slot)) {
        continue;
      }
      const element = elemente.current.get(slot)?.[0];
      const eintrag = nachSlot.get(slot);
      if (element && eintrag) {
        element.volume = lautstaerkeVon(eintrag);
      }
    }
  }, [lautstaerkeVon, nachSlot]);

  // Beim Verlassen der Seite alles anhalten. Ohne das laeuft die Musik
  // weiter, wenn jemand im Dashboard weiterklickt.
  useEffect(
    () => () => {
      for (const laufende of blenden.current.values()) {
        window.clearInterval(laufende.uhr);
      }
      blenden.current.clear();
      for (const pool of elemente.current.values()) {
        for (const element of pool) {
          try {
            element.pause();
          } catch {
            // Ein Element, das sich nicht anhalten laesst, verschwindet mit der Seite.
          }
        }
      }
      elemente.current.clear();
      laufend.current.clear();
      zaehler.current.clear();
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
      const pool = hole(slot);
      if (!pool || !eintrag) {
        return;
      }
      const laut = lautstaerkeVon(eintrag);
      if (laut <= 0) {
        return;
      }

      const nummer = zaehler.current.get(slot) ?? 0;
      zaehler.current.set(slot, nummer + 1);

      /*
       * Die Stimmenwahl, in dieser Reihenfolge:
       *
       *  1. eine freie Stimme - der Normalfall, und der guenstigste;
       *  2. eine neue, solange der Pool Platz hat - das ist der Walzenstopp,
       *     der auf den vorherigen faellt;
       *  3. die naechste in der Reihe, wenn der Pool voll ist. Dann wird eine
       *     noch klingende Stimme zurueckgespult, genau wie vorher - bei vier
       *     gleichzeitigen Stimmen desselben Klangs hoert das ohnehin
       *     niemand mehr heraus.
       */
      let element = pool.find((stimme) => stimme.paused || stimme.ended) ?? null;
      if (!element && pool.length < POOL_STIMMEN) {
        element = baue(slot);
        if (element) {
          pool.push(element);
        }
      }
      element ??= pool[nummer % pool.length] ?? null;
      if (!element) {
        return;
      }

      const abweichung = VARIATION.has(slot)
        ? (ABWEICHUNG[nummer % ABWEICHUNG.length] ?? OHNE_ABWEICHUNG)
        : OHNE_ABWEICHUNG;
      try {
        element.loop = false;
        element.playbackRate = abweichung.rate;
        element.volume = begrenzt(laut * abweichung.laut);
        element.currentTime = 0;
        void element.play().catch(() => undefined);
      } catch {
        // Ein abgewiesenes `play()` ist kein Fehler des Spiels.
      }
    },
    [baue, hole, lautstaerkeVon, nachSlot],
  );

  const starteSchleife = useCallback(
    (slot: string, optionen?: SchleifenOptionen) => {
      const eintrag = nachSlot.get(slot);
      const element = hole(slot)?.[0];
      if (!element || !eintrag) {
        return;
      }
      const laut = lautstaerkeVon(eintrag);
      if (laut <= 0) {
        return;
      }
      try {
        element.loop = true;
        element.playbackRate = 1;
        const lief = laufend.current.has(slot);
        const schonDa = lief || !element.paused;
        laufend.current.add(slot);
        /*
         * Schon am Laufen, auf dem richtigen Wert, keine Blende unterwegs?
         * Dann ist nichts zu tun.
         *
         * Diese Zeile ist nicht Feinschliff, sondern notwendig: die
         * Grundstimmung wird aus einem Effekt heraus gesetzt, und der laeuft
         * bei jedem Rendern. Ohne die Pruefung begaenne jedes Rendern eine
         * neue Blende - die Musik wuerde in Stufen pulsieren.
         */
        const blendet = blenden.current.get(slot);
        if (
          lief &&
          (blendet ? Math.abs(blendet.ziel - laut) < 0.01 : Math.abs(element.volume - laut) < 0.01)
        ) {
          return;
        }
        if (optionen?.sofort) {
          brichBlendeAb(slot);
          element.volume = laut;
        } else if (schonDa) {
          // Laeuft noch - etwa aus einer Ausblende, die wir hiermit
          // zurueckdrehen. Von der aktuellen Lautstaerke aus, nicht von Null:
          // sonst entsteht beim Zurueckdrehen genau der Einbruch, den die
          // Blende verhindern soll.
          blende(slot, element, laut);
        } else {
          element.volume = 0;
          blende(slot, element, laut);
        }
        if (!schonDa) {
          void element.play().catch(() => undefined);
        }
      } catch {
        // Siehe oben.
      }
    },
    [blende, brichBlendeAb, hole, lautstaerkeVon, nachSlot],
  );

  const stoppeSchleife = useCallback(
    (slot: string, optionen?: SchleifenOptionen) => {
      const element = elemente.current.get(slot)?.[0];
      const lief = laufend.current.has(slot);
      laufend.current.delete(slot);
      // Eine Ausblende, die schon laeuft, nicht neu anfangen: sonst setzt
      // jeder weitere Aufruf sie vom gerade erreichten Wert aus fort, und das
      // Ausblenden wuerde nie fertig.
      if (!lief && blenden.current.get(slot)?.ziel === 0) {
        return;
      }
      if (!element || element.paused) {
        brichBlendeAb(slot);
        return;
      }
      const halt = (): void => {
        try {
          element.pause();
          element.currentTime = 0;
        } catch {
          // Siehe oben.
        }
      };
      if (optionen?.sofort) {
        brichBlendeAb(slot);
        halt();
        return;
      }
      blende(slot, element, 0, halt);
    },
    [blende, brichBlendeAb],
  );

  const freigeben = useCallback(() => {
    // Erst die Referenz - sie gilt in derselben Funktion weiter -, dann der
    // Zustand fuer die Effekte.
    freigegebenRef.current = true;
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
