/**
 * Die Tonausgabe ueber Web Audio - mit vorbereiteten Puffern.
 *
 * ## Warum es diese Datei gibt
 *
 * Bis hierher spielte der Slot jeden Klang ueber ein `HTMLAudioElement` aus
 * einem Stimmenpool. Das funktioniert, es war vorgeladen, und auf dem
 * Schreibtisch hoert und spuert man nichts davon. Auf iPhone und iPad ist es
 * der Teil der Tonausgabe, der in den Hauptfaden hineinreicht:
 *
 *  - **Jedes `play()` ist Arbeit im Hauptfaden.** Fuenf Walzenstopps,
 *    mehrere Gewinnlinien, der Knopf - in Safari laeuft dabei jedes Mal ein
 *    Stueck der Medienpipeline mit, waehrend die Walzen animieren.
 *  - **`playbackRate` auf einem Medienelement** zieht in WebKit einen
 *    Resampler hinter sich her. Genau die Klaenge mit Abweichung sind die,
 *    die am dichtesten kommen.
 *  - **Die Blenden liefen ueber `setInterval` mit 25 Millisekunden.** Also
 *    vierzig Weckrufe je Sekunde im Hauptfaden, mitten im Walzenlauf - der
 *    `reel_loop` blendet bei **jedem** Spin ein und aus. Das ist kein
 *    Rundungsfehler, das ist ein Zeitgeber, der genau dann tickt, wenn das
 *    Bild knapp ist.
 *  - **Dekodieren** passiert bei einem Medienelement dann, wenn der Browser
 *    es fuer richtig haelt - und das ist auf iOS gern der erste `play()`.
 *
 * Web Audio raeumt alle vier Punkte ab, und zwar nicht durch Verzicht:
 * dieselben Dateien, dieselben Lautstaerken, dieselben Abweichungen,
 * dieselben Blendenzeiten. Nur fallen sie jetzt auf dem **Audiofaden** an:
 *
 *  - Jede Datei wird **einmal** geholt und **einmal** dekodiert, bevor
 *    gespielt wird - danach liegt sie als `AudioBuffer` im Speicher.
 *  - Ein Einmalklang ist ein `AudioBufferSourceNode`: anlegen, starten,
 *    fertig. Kein Element, kein Netz, kein Dekodieren, keine Pipeline.
 *  - `playbackRate` eines Puffers ist ein Zahlenwert am Knoten.
 *  - Blenden sind `linearRampToValueAtTime` auf einem `GainNode`. Der
 *    Hauptfaden sagt den Zielwert **einmal** und ist danach fertig; die
 *    Rampe selbst rechnet der Audiofaden. Kein `setInterval`, nirgends.
 *
 * ## Was dieser Motor nicht entscheidet
 *
 * Nichts ueber das Spiel, und nichts ueber Lautstaerken. Welcher Klang zu
 * welchem Ereignis gehoert, steht in `klangereignisse.ts`; wie laut ein Slot
 * ist und ob Musik ueberhaupt an ist, rechnet `klang.ts`. Hier kommt eine
 * Zahl zwischen 0 und 1 herein, und sie wird gespielt.
 *
 * ## Die Regel aus `klang.ts` gilt hier genauso
 *
 * **Kein Tonproblem haelt je einen Spin auf.** Kein `throw`, nirgends. Ein
 * Browser ohne `AudioContext` liefert `null` statt eines Motors, und
 * `klang.ts` spielt dann weiter ueber Medienelemente. Eine Datei, die sich
 * nicht dekodieren laesst, hat keinen Puffer - `hat()` sagt `false`, und
 * derselbe Rueckfallweg greift fuer genau diesen einen Slot.
 */

/*
 * ## Warum hier eigene Formen stehen und nicht `AudioContext`
 *
 * Damit diese Datei **pruefbar** ist. Die Tests des Projekts uebersetzen mit
 * `lib: ES2022` und ohne die DOM-Bibliothek - zu Recht, denn ein Modulkern,
 * der versehentlich `document` anfasst, soll daran scheitern. Eine Datei, die
 * `AudioContext` im Typ nennt, laesst sich dort nicht importieren, und damit
 * waere vom Motor nur noch der Quelltext pruefbar gewesen.
 *
 * Darum steht hier der Ausschnitt von Web Audio, den der Motor wirklich
 * benutzt - nicht mehr. {@link baueTonmotor} nimmt einen Kontext entgegen;
 * im Browser baut es ihn selbst, im Test reicht eine Attrappe, die diese
 * Formen erfuellt. Dieselbe Trennung wie zwischen `klang.ts` und
 * `tonausgabe.ts`, aus demselben Grund.
 */

/** Ein `AudioParam` - der Wert und seine Planung. */
export interface MotorParameter {
  value: number;
  cancelScheduledValues: (zeit: number) => void;
  setValueAtTime: (wert: number, zeit: number) => void;
  linearRampToValueAtTime: (wert: number, zeit: number) => void;
}

/** Etwas, worauf sich verbinden laesst. */
export interface MotorZiel {
  readonly _marke?: never;
}

/** Ein `GainNode`. */
export interface MotorVerstaerker extends MotorZiel {
  gain: MotorParameter;
  connect: (ziel: MotorZiel) => unknown;
  disconnect: () => void;
}

/** Ein dekodierter Klang. Der Inhalt interessiert den Motor nicht. */
export interface MotorPuffer {
  readonly duration?: number;
}

/** Ein `AudioBufferSourceNode` - das Einwegteil je Klang. */
export interface MotorQuelle extends MotorZiel {
  buffer: MotorPuffer | null;
  loop: boolean;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connect: (ziel: MotorZiel) => unknown;
  disconnect: () => void;
  start: (zeit?: number) => void;
  stop: (zeit?: number) => void;
}

/** Ein `AudioContext` - der Ausschnitt, den der Motor braucht. */
export interface MotorKontext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: MotorZiel;
  createGain: () => MotorVerstaerker;
  createBufferSource: () => MotorQuelle;
  decodeAudioData: (
    rohdaten: ArrayBuffer,
    fertig?: (puffer: MotorPuffer) => void,
    schiefgegangen?: (fehler: unknown) => void,
  ) => Promise<MotorPuffer> | undefined;
  resume: () => Promise<void>;
  close: () => Promise<void>;
}

/** Was `klang.ts` von einem Motor braucht. */
export interface Tonmotor {
  /** Holt und dekodiert eine Datei - einmal je Adresse. */
  lade: (slot: string, adresse: string) => void;
  /** Liegt der Puffer bereit? Sonst muss der Rueckfallweg spielen. */
  hat: (slot: string) => boolean;
  /** Nach der ersten Beruehrung. Mehrfach aufrufen ist harmlos. */
  wecke: () => void;
  /** Ein Einmalklang. `rate` ist die Abweichung, `laut` die Mischung. */
  spiele: (slot: string, laut: number, rate: number) => void;
  /** Startet eine Schleife und blendet sie ueber `blendeMs` auf. */
  starteSchleife: (slot: string, laut: number, blendeMs: number) => void;
  /** Blendet eine Schleife ueber `blendeMs` ab. 0 heisst sofort. */
  stoppeSchleife: (slot: string, blendeMs: number) => void;
  /** Laeuft diese Schleife gerade? */
  schleifeLaeuft: (slot: string) => boolean;
  /** Zieht eine laufende Schleife auf einen neuen Wert - ohne Blende. */
  setzeSchleifenLaut: (slot: string, laut: number) => void;
  /** Alles anhalten und den Kontext schliessen. Fuer das Verlassen der Seite. */
  beende: () => void;
}

interface Schleife {
  quelle: MotorQuelle;
  verstaerker: MotorVerstaerker;
  laeuft: boolean;
  /**
   * Der zuletzt angeforderte Zielwert.
   *
   * Er steht hier, weil er gebraucht wird: die Grundstimmung wird aus einem
   * Effekt gesetzt, und der laeuft bei jedem Rendern. Ohne den Vergleich
   * «blendet schon auf genau diesen Wert» begaenne jedes Rendern eine neue
   * Rampe, vom gerade erreichten Wert aus - die Musik wuerde in Stufen
   * pulsieren und nie oben ankommen. Derselbe Fehler lag schon einmal im
   * Weg, als die Blenden noch mit `setInterval` liefen.
   */
  ziel: number;
}

type AudioKontextKlasse = new () => MotorKontext;

/**
 * Der Kontext dieses Browsers - oder `null`.
 *
 * `webkitAudioContext` steht hier wegen alter iOS-Versionen; neuere Safari
 * kennen den Standardnamen. Beides abzufragen kostet eine Zeile und deckt
 * das Geraet mit ab, auf dem es am ehesten klemmt.
 */
function kontextKlasse(): AudioKontextKlasse | null {
  /*
   * `globalThis` und nicht `window`: diese Datei soll ohne die
   * DOM-Bibliothek uebersetzen, und `window` gibt es dort nicht als Typ.
   * Nachgesehen wird dasselbe.
   */
  const fenster = globalThis as unknown as {
    AudioContext?: AudioKontextKlasse;
    webkitAudioContext?: AudioKontextKlasse;
  };
  return fenster.AudioContext ?? fenster.webkitAudioContext ?? null;
}

/**
 * Baut den Motor - oder gibt `null` zurueck, wenn dieser Browser kein
 * Web Audio hat.
 *
 * ## Warum der Kontext sofort entsteht und nicht erst bei der Geste
 *
 * Weil `decodeAudioData` einen Kontext braucht. Wartete man auf die erste
 * Beruehrung, waere der erste Spin genau das, was er nicht sein soll: das
 * Fenster, in dem zwei Dutzend Dateien dekodiert werden.
 *
 * Ein frisch gebauter Kontext ist auf iOS `suspended`, und das ist in
 * Ordnung - dekodieren darf er trotzdem. Zum Klingen bringt ihn
 * {@link Tonmotor.wecke}, und das laeuft aus dem Klick heraus.
 *
 * @param eigener Ein fertiger Kontext. Im Browser bleibt das leer; die Tests
 *   geben eine Attrappe herein und sehen dadurch nach, **was** der Motor am
 *   Kontext tut - dass eine Blende eine Rampe ist und kein Zeitgeber, dass
 *   fuenf Klaenge fuenf Knoten sind, dass nichts klingt, bevor geweckt wurde.
 */
export function baueTonmotor(eigener?: MotorKontext | null): Tonmotor | null {
  let kontext: MotorKontext;
  if (eigener) {
    kontext = eigener;
  } else {
    const Klasse = kontextKlasse();
    if (!Klasse) {
      return null;
    }
    try {
      kontext = new Klasse();
    } catch {
      return null;
    }
  }

  const summe = kontext.createGain();
  summe.gain.value = 1;
  try {
    summe.connect(kontext.destination);
  } catch {
    return null;
  }

  const puffer = new Map<string, MotorPuffer>();
  /** Welche Adresse schon geholt wird - damit nichts zweimal laeuft. */
  const unterwegs = new Set<string>();
  const schleifen = new Map<string, Schleife>();
  let geweckt = false;

  const jetzt = (): number => kontext.currentTime;
  const begrenzt = (wert: number): number => Math.max(0, Math.min(1, wert));

  /**
   * Setzt eine Rampe auf einen Zielwert.
   *
   * `cancelScheduledValues` plus `setValueAtTime` auf den **aktuellen** Wert
   * ist der Teil, der leicht fehlt: ohne das zweite setzt die neue Rampe am
   * Ende der alten an, und eine Schleife, die mitten im Ausblenden wieder
   * startet, springt dann erst auf Null und faehrt von dort hoch - genau das
   * Loch, das die Blende verhindern soll.
   *
   * `linearRampToValueAtTime` mit `dauer === 0` ist nicht erlaubt; dann wird
   * der Wert direkt gesetzt.
   */
  const rampe = (knoten: MotorVerstaerker, nach: number, dauerMs: number): void => {
    const zeit = jetzt();
    try {
      const aktuell = knoten.gain.value;
      knoten.gain.cancelScheduledValues(zeit);
      knoten.gain.setValueAtTime(aktuell, zeit);
      if (dauerMs <= 0) {
        knoten.gain.setValueAtTime(begrenzt(nach), zeit);
        return;
      }
      knoten.gain.linearRampToValueAtTime(begrenzt(nach), zeit + dauerMs / 1000);
    } catch {
      // Ein Knoten, dessen Rampe nicht gesetzt werden kann, bleibt, wie er ist.
    }
  };

  const lade = (slot: string, adresse: string): void => {
    if (puffer.has(slot) || unterwegs.has(slot)) {
      return;
    }
    unterwegs.add(slot);
    void fetch(adresse)
      .then((antwort) => (antwort.ok ? antwort.arrayBuffer() : Promise.reject(new Error('weg'))))
      .then(
        (rohdaten) =>
          /*
           * Beide Formen von `decodeAudioData`.
           *
           * Der Standard gibt ein Versprechen zurueck; aeltere WebKit
           * kennen nur die Variante mit zwei Rueckrufen und geben
           * `undefined`. Ein `Promise`-Umschlag deckt beides ab, und zwar
           * ohne Versionsabfrage.
           */
          new Promise<MotorPuffer>((fertig, schiefgegangen) => {
            const ergebnis = kontext.decodeAudioData(rohdaten, fertig, schiefgegangen);
            if (ergebnis && typeof ergebnis.then === 'function') {
              ergebnis.then(fertig, schiefgegangen);
            }
          }),
      )
      .then((fertig) => {
        puffer.set(slot, fertig);
      })
      .catch(() => {
        /*
         * Kein Puffer heisst: `hat()` sagt `false`, und `klang.ts` spielt
         * diesen einen Slot ueber ein Medienelement. Still bleibt nichts.
         */
      })
      .finally(() => {
        unterwegs.delete(slot);
      });
  };

  const wecke = (): void => {
    geweckt = true;
    try {
      if (kontext.state !== 'running') {
        void kontext.resume().catch(() => undefined);
      }
    } catch {
      // Ein Kontext, der nicht aufwacht, bleibt still - und das Spiel laeuft.
    }
  };

  const spiele = (slot: string, laut: number, rate: number): void => {
    const stueck = puffer.get(slot);
    if (!geweckt || !stueck || laut <= 0) {
      return;
    }
    try {
      /*
       * Ein Knoten je Klang - und das ist kein Verschwenden.
       *
       * Ein `AudioBufferSourceNode` ist ein Einwegteil: anlegen, starten,
       * und der Browser raeumt ihn nach dem Ende selbst ab. Genau deshalb
       * braucht Web Audio keinen Stimmenpool - die Ueberlagerung, fuer die
       * der Pool bei Medienelementen da war, ist hier der Normalfall. Fuenf
       * Walzenstopps sind fuenf Knoten, und keiner schneidet den anderen ab.
       */
      const quelle = kontext.createBufferSource();
      quelle.buffer = stueck;
      quelle.playbackRate.value = rate;
      const verstaerker = kontext.createGain();
      verstaerker.gain.value = begrenzt(laut);
      quelle.connect(verstaerker);
      verstaerker.connect(summe);
      quelle.onended = (): void => {
        try {
          quelle.disconnect();
          verstaerker.disconnect();
        } catch {
          // Schon abgeraeumt.
        }
      };
      quelle.start();
    } catch {
      // Siehe die Regel oben.
    }
  };

  /**
   * Die Schleife eines Slots - angelegt, wenn es sie noch nicht gibt.
   *
   * ## Warum die Quelle laufen bleibt
   *
   * Ein `AudioBufferSourceNode` laesst sich nach `stop()` nicht wieder
   * starten; wer eine Schleife anhalten und spaeter fortsetzen will, muesste
   * jedes Mal einen neuen Knoten bauen und die alte Stop-Planung
   * zurueckziehen. Beides ist Buchhaltung, die schiefgehen kann - und sie
   * geht genau dort schief, wo es am meisten auffaellt: beim Musikwechsel
   * zwischen Grundspiel und Freispielen.
   *
   * Darum laeuft die Quelle einer Schleife **durch**, und angehalten wird
   * mit der Lautstaerke. Bei Null ist sie unhoerbar, und mehr als vier
   * Schleifen gibt es im ganzen Spiel nicht. Nebenbei faellt der Knacks
   * weg, und die Musik setzt dort fort, wo sie war, statt bei jedem Wechsel
   * von vorn anzufangen.
   */
  const schleife = (slot: string): Schleife | null => {
    const vorhanden = schleifen.get(slot);
    if (vorhanden) {
      return vorhanden;
    }
    const stueck = puffer.get(slot);
    if (!stueck) {
      return null;
    }
    try {
      const quelle = kontext.createBufferSource();
      quelle.buffer = stueck;
      quelle.loop = true;
      const verstaerker = kontext.createGain();
      verstaerker.gain.value = 0;
      quelle.connect(verstaerker);
      verstaerker.connect(summe);
      quelle.start();
      const neu: Schleife = { quelle, verstaerker, laeuft: false, ziel: 0 };
      schleifen.set(slot, neu);
      return neu;
    } catch {
      return null;
    }
  };

  const starteSchleife = (slot: string, laut: number, blendeMs: number): void => {
    if (!geweckt || laut <= 0) {
      return;
    }
    const eintrag = schleife(slot);
    if (!eintrag) {
      return;
    }
    if (eintrag.laeuft && Math.abs(eintrag.ziel - laut) < 0.01) {
      return;
    }
    eintrag.laeuft = true;
    eintrag.ziel = laut;
    rampe(eintrag.verstaerker, laut, blendeMs);
  };

  const stoppeSchleife = (slot: string, blendeMs: number): void => {
    const eintrag = schleifen.get(slot);
    if (!eintrag) {
      return;
    }
    if (!eintrag.laeuft && eintrag.ziel === 0) {
      return;
    }
    eintrag.laeuft = false;
    eintrag.ziel = 0;
    rampe(eintrag.verstaerker, 0, blendeMs);
  };

  const schleifeLaeuft = (slot: string): boolean => schleifen.get(slot)?.laeuft === true;

  const setzeSchleifenLaut = (slot: string, laut: number): void => {
    const eintrag = schleifen.get(slot);
    if (!eintrag || !eintrag.laeuft || Math.abs(eintrag.ziel - laut) < 0.01) {
      return;
    }
    eintrag.ziel = laut;
    rampe(eintrag.verstaerker, laut, 0);
  };

  const beende = (): void => {
    for (const eintrag of schleifen.values()) {
      try {
        eintrag.quelle.stop();
        eintrag.quelle.disconnect();
        eintrag.verstaerker.disconnect();
      } catch {
        // Schon abgeraeumt.
      }
    }
    schleifen.clear();
    puffer.clear();
    try {
      void kontext.close().catch(() => undefined);
    } catch {
      // Ein Kontext, der sich nicht schliessen laesst, verschwindet mit der Seite.
    }
  };

  return {
    lade,
    hat: (slot) => puffer.has(slot),
    wecke,
    spiele,
    starteSchleife,
    stoppeSchleife,
    schleifeLaeuft,
    setzeSchleifenLaut,
    beende,
  };
}
