import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baueTonmotor,
  type MotorKontext,
  type MotorPuffer,
  type MotorQuelle,
  type MotorVerstaerker,
  type MotorZiel,
} from '@/modules/level/xpslot/components/tonmotor';

/**
 * Die Tonausgabe des XP-Slots ueber Web Audio.
 *
 * ## Warum das ein Verhaltenstest ist und kein Quelltextvergleich
 *
 * Weil die Aussagen dieser Umstellung Aussagen **ueber Aufrufe** sind, und
 * ein `grep` auf «linearRampToValueAtTime» beweist keine davon:
 *
 *  - Eine Blende darf kein Zeitgeber mehr sein. Der alte Weg tickte vierzig
 *    Mal je Sekunde im Hauptfaden, und der `reel_loop` blendet bei **jedem**
 *    Spin ein und aus - das war Arbeit genau in dem Fenster, in dem das Bild
 *    knapp ist. Hier wird nachgesehen, dass `setInterval` und `setTimeout`
 *    **nicht** vorkommen.
 *  - Fuenf Walzenstopps muessen fuenf Klaenge sein. Beim Stimmenpool aus
 *    Medienelementen schnitt der naechste Stopp den vorherigen ab, sobald
 *    der Pool voll war; mit Puffern ist jeder Klang ein eigener Knoten.
 *  - Vor der ersten Beruehrung darf nichts klingen, und `resume()` muss aus
 *    **dieser** Geste kommen - sonst ist der Slot auf dem iPhone stumm.
 *  - Eine Schleife, die schon auf ihrem Zielwert laeuft, darf keine zweite
 *    Rampe anfangen. Genau dieser Fehler lag beim alten Weg im Weg: die
 *    Grundstimmung wird aus einem Effekt gesetzt, der bei jedem Rendern
 *    laeuft, und die Musik pulsierte in Stufen.
 *
 * Moeglich ist das, weil `tonmotor.ts` seinen Kontext **hereingegeben**
 * bekommt und seine eigenen Formen deklariert. Die Attrappe unten ist eine
 * Buchhaltung ueber alles, was der Motor am Kontext tut.
 */

interface ParameterAufruf {
  art: 'abbrechen' | 'sofort' | 'rampe';
  wert?: number;
  zeit: number;
}

interface AttrappenQuelle extends MotorQuelle {
  readonly aufrufe: { gestartet: number; gestoppt: number };
  readonly verstaerker: AttrappenVerstaerker | null;
}

interface AttrappenVerstaerker extends MotorVerstaerker {
  readonly protokoll: ParameterAufruf[];
}

interface Attrappe extends MotorKontext {
  zeit: number;
  zustand: string;
  readonly quellen: AttrappenQuelle[];
  readonly verstaerker: AttrappenVerstaerker[];
  readonly geweckt: { anzahl: number };
  readonly geschlossen: { anzahl: number };
  readonly dekodiert: ArrayBuffer[];
  /** Was `decodeAudioData` zurueckgibt - oder ein Fehlschlag. */
  dekodierung: 'gut' | 'schlecht';
}

function baueAttrappe(): Attrappe {
  const quellen: AttrappenQuelle[] = [];
  const verstaerker: AttrappenVerstaerker[] = [];
  const geweckt = { anzahl: 0 };
  const geschlossen = { anzahl: 0 };
  const dekodiert: ArrayBuffer[] = [];

  const kontext: Attrappe = {
    zeit: 10,
    zustand: 'suspended',
    dekodierung: 'gut',
    quellen,
    verstaerker,
    geweckt,
    geschlossen,
    dekodiert,
    get currentTime() {
      return kontext.zeit;
    },
    get state() {
      return kontext.zustand;
    },
    destination: {} as MotorZiel,
    createGain() {
      const protokoll: ParameterAufruf[] = [];
      const knoten: AttrappenVerstaerker = {
        protokoll,
        gain: {
          value: 0,
          cancelScheduledValues: (zeit) => protokoll.push({ art: 'abbrechen', zeit }),
          setValueAtTime: (wert, zeit) => {
            knoten.gain.value = wert;
            protokoll.push({ art: 'sofort', wert, zeit });
          },
          linearRampToValueAtTime: (wert, zeit) => protokoll.push({ art: 'rampe', wert, zeit }),
        },
        connect: () => undefined,
        disconnect: () => undefined,
      };
      verstaerker.push(knoten);
      return knoten;
    },
    createBufferSource() {
      const aufrufe = { gestartet: 0, gestoppt: 0 };
      const knoten: AttrappenQuelle = {
        aufrufe,
        verstaerker: null,
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        onended: null,
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => {
          aufrufe.gestartet += 1;
        },
        stop: () => {
          aufrufe.gestoppt += 1;
        },
      };
      quellen.push(knoten);
      return knoten;
    },
    decodeAudioData(rohdaten) {
      dekodiert.push(rohdaten);
      return kontext.dekodierung === 'gut'
        ? Promise.resolve({ duration: 1 } satisfies MotorPuffer)
        : Promise.reject(new Error('kaputt'));
    },
    resume() {
      geweckt.anzahl += 1;
      kontext.zustand = 'running';
      return Promise.resolve();
    },
    close() {
      geschlossen.anzahl += 1;
      return Promise.resolve();
    },
  };
  return kontext;
}

/**
 * Wartet, bis die Ladeversprechen des Motors durch sind.
 *
 * `setImmediate` und nicht eine Handvoll `Promise.resolve()`: die Ladekette
 * ist `fetch` → `arrayBuffer` → `decodeAudioData` → ablegen, und wie viele
 * Mikroschritte das sind, haengt daran, wie die Kette gebaut ist. Ein Test,
 * der eine bestimmte Zahl davon abzaehlt, bricht beim naechsten `await` in
 * `tonmotor.ts` - und zwar nicht, weil der Motor kaputt waere.
 */
const atemzug = (): Promise<void> => new Promise((fertig) => setImmediate(fertig));

describe('XP-Slot Tonmotor', () => {
  const echtesFetch = globalThis.fetch;
  let geholt: string[] = [];

  beforeEach(() => {
    geholt = [];
    globalThis.fetch = vi.fn(async (eingabe: unknown) => {
      geholt.push(String(eingabe));
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = echtesFetch;
    vi.restoreAllMocks();
  });

  it('gibt ohne Web Audio keinen Motor zurueck - dann traegt der Rueckfallweg', () => {
    // In dieser Umgebung gibt es kein `AudioContext`; genau so verhaelt sich
    // ein Browser, der Web Audio nicht kennt.
    expect(baueTonmotor()).toBeNull();
  });

  it('holt und dekodiert jede Datei genau einmal', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    expect(motor).not.toBeNull();

    motor?.lade('reel_stop', '/xp-slot/klaenge/reel_stop.wav');
    motor?.lade('reel_stop', '/xp-slot/klaenge/reel_stop.wav');
    await atemzug();
    motor?.lade('reel_stop', '/xp-slot/klaenge/reel_stop.wav');
    await atemzug();

    expect(geholt).toEqual(['/xp-slot/klaenge/reel_stop.wav']);
    expect(kontext.dekodiert).toHaveLength(1);
    expect(motor?.hat('reel_stop')).toBe(true);
  });

  it('meldet einen Slot, dessen Datei sich nicht dekodieren laesst, als nicht vorhanden', async () => {
    const kontext = baueAttrappe();
    kontext.dekodierung = 'schlecht';
    const motor = baueTonmotor(kontext);

    motor?.lade('jackpot', '/xp-slot/klaenge/jackpot.wav');
    await atemzug();
    motor?.wecke();
    motor?.spiele('jackpot', 1, 1);

    // `hat() === false` ist das Zeichen, an dem `klang.ts` auf ein
    // Medienelement umschaltet. Still bleibt dieser Slot also nicht.
    expect(motor?.hat('jackpot')).toBe(false);
    expect(kontext.quellen).toHaveLength(0);
  });

  it('spielt nichts, bevor geweckt wurde - und weckt den Kontext bei der Geste', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('spin_start', '/xp-slot/klaenge/spin_start.wav');
    await atemzug();

    motor?.spiele('spin_start', 1, 1);
    expect(kontext.quellen).toHaveLength(0);
    expect(kontext.geweckt.anzahl).toBe(0);

    motor?.wecke();
    expect(kontext.geweckt.anzahl).toBe(1);

    motor?.spiele('spin_start', 1, 1);
    expect(kontext.quellen).toHaveLength(1);
  });

  it('gibt jedem Klang einen eigenen Knoten - fuenf Walzenstopps sind fuenf Klaenge', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('reel_stop', '/xp-slot/klaenge/reel_stop.wav');
    await atemzug();
    motor?.wecke();

    for (let nummer = 0; nummer < 5; nummer += 1) {
      motor?.spiele('reel_stop', 0.6, 1);
    }

    expect(kontext.quellen).toHaveLength(5);
    expect(kontext.quellen.every((quelle) => quelle.aufrufe.gestartet === 1)).toBe(true);
    // Keiner schneidet den anderen ab: nichts wird gestoppt.
    expect(kontext.quellen.every((quelle) => quelle.aufrufe.gestoppt === 0)).toBe(true);
  });

  it('legt Lautstaerke und Abweichung an den Knoten', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('reel_stop', '/xp-slot/klaenge/reel_stop.wav');
    await atemzug();
    motor?.wecke();

    motor?.spiele('reel_stop', 0.42, 1.028);

    expect(kontext.quellen[0]?.playbackRate.value).toBeCloseTo(1.028, 5);
    expect(kontext.verstaerker.at(-1)?.gain.value).toBeCloseTo(0.42, 5);
    expect(kontext.quellen[0]?.loop).toBe(false);
  });

  it('blendet Schleifen mit einer Rampe - und benutzt dafuer keinen Zeitgeber', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('reel_loop', '/xp-slot/klaenge/reel_loop.wav');
    await atemzug();
    motor?.wecke();

    // Die Wachen erst jetzt: die Aussage gilt fuer die Blende, nicht fuer
    // das Laden - und `atemzug` selbst benutzt einen Zeitgeber.
    const intervall = vi.spyOn(globalThis, 'setInterval');
    const zeitgeber = vi.spyOn(globalThis, 'setTimeout');

    motor?.starteSchleife('reel_loop', 0.5, 110);
    const schleife = kontext.quellen[0];
    expect(schleife?.loop).toBe(true);
    expect(schleife?.aufrufe.gestartet).toBe(1);

    const auf = kontext.verstaerker.at(-1)?.protokoll ?? [];
    expect(auf.filter((eintrag) => eintrag.art === 'rampe')).toHaveLength(1);
    // 110 ms ab `currentTime` 10 - die Rampe rechnet der Audiofaden.
    expect(auf.find((eintrag) => eintrag.art === 'rampe')?.wert).toBeCloseTo(0.5, 5);
    expect(auf.find((eintrag) => eintrag.art === 'rampe')?.zeit).toBeCloseTo(10.11, 5);

    motor?.stoppeSchleife('reel_loop', 110);
    expect(auf.filter((eintrag) => eintrag.art === 'rampe')).toHaveLength(2);
    expect(auf.filter((eintrag) => eintrag.art === 'rampe').at(-1)?.wert).toBe(0);

    // Das ist die Aussage dieser Umstellung: keine Weckrufe im Hauptfaden.
    expect(intervall).not.toHaveBeenCalled();
    expect(zeitgeber).not.toHaveBeenCalled();
  });

  it('laesst eine laufende Schleife laufen, statt sie anzuhalten', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('musik', '/xp-slot/klaenge/musik.wav');
    await atemzug();
    motor?.wecke();

    motor?.starteSchleife('musik', 0.2, 650);
    motor?.stoppeSchleife('musik', 650);
    motor?.starteSchleife('musik', 0.2, 650);

    /*
     * Eine Quelle, drei Wechsel, kein Stopp.
     *
     * Ein `AudioBufferSourceNode` laesst sich nach `stop()` nicht wieder
     * starten. Wer eine Schleife anhalten und fortsetzen will, muesste jedes
     * Mal einen neuen Knoten bauen - und genau diese Buchhaltung geht beim
     * Musikwechsel zwischen Grundspiel und Freispielen schief. Angehalten
     * wird darum mit der Lautstaerke.
     */
    expect(kontext.quellen).toHaveLength(1);
    expect(kontext.quellen[0]?.aufrufe.gestoppt).toBe(0);
    expect(motor?.schleifeLaeuft('musik')).toBe(true);
  });

  it('faengt keine zweite Rampe an, wenn die Schleife schon auf ihrem Wert laeuft', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('musik', '/xp-slot/klaenge/musik.wav');
    await atemzug();
    motor?.wecke();

    // So ruft es die Oberflaeche: die Grundstimmung wird aus einem Effekt
    // gesetzt, und der laeuft bei jedem Rendern.
    motor?.starteSchleife('musik', 0.28, 650);
    motor?.starteSchleife('musik', 0.28, 650);
    motor?.starteSchleife('musik', 0.28, 650);

    const auf = kontext.verstaerker.at(-1)?.protokoll ?? [];
    expect(auf.filter((eintrag) => eintrag.art === 'rampe')).toHaveLength(1);
  });

  it('setzt den Wert ohne Blende, wenn sofort verlangt wird', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('gamble_spin', '/xp-slot/klaenge/gamble_spin.wav');
    await atemzug();
    motor?.wecke();

    motor?.starteSchleife('gamble_spin', 0.7, 0);

    const auf = kontext.verstaerker.at(-1)?.protokoll ?? [];
    expect(auf.filter((eintrag) => eintrag.art === 'rampe')).toHaveLength(0);
    expect(auf.filter((eintrag) => eintrag.art === 'sofort').at(-1)?.wert).toBeCloseTo(0.7, 5);
  });

  it('zieht eine laufende Schleife auf einen neuen Reglerwert', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('musik', '/xp-slot/klaenge/musik.wav');
    await atemzug();
    motor?.wecke();

    motor?.starteSchleife('musik', 0.28, 650);
    motor?.setzeSchleifenLaut('musik', 0.1);
    motor?.setzeSchleifenLaut('musik', 0.1);

    const auf = kontext.verstaerker.at(-1)?.protokoll ?? [];
    expect(auf.filter((eintrag) => eintrag.art === 'sofort' && eintrag.wert === 0.1)).toHaveLength(1);
  });

  it('haelt beim Verlassen der Seite alles an und schliesst den Kontext', async () => {
    const kontext = baueAttrappe();
    const motor = baueTonmotor(kontext);
    motor?.lade('musik', '/xp-slot/klaenge/musik.wav');
    await atemzug();
    motor?.wecke();
    motor?.starteSchleife('musik', 0.28, 650);

    motor?.beende();

    expect(kontext.quellen[0]?.aufrufe.gestoppt).toBe(1);
    expect(kontext.geschlossen.anzahl).toBe(1);
    expect(motor?.hat('musik')).toBe(false);
  });
});
