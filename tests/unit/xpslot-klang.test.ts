import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  klangFuer,
  STUFEN_KLANG,
  type SlotEreignis,
} from '../../apps/web/src/modules/level/xpslot/components/klangereignisse';
import type { Tonausgabe } from '../../apps/web/src/modules/level/xpslot/components/tonausgabe';

/**
 * Welcher Klang zu welchem Ereignis gehoert - gezaehlt.
 *
 * ## Warum das ein Test sein kann
 *
 * Weil die Zuordnung eine freie Funktion ist und keine Zeile mitten im
 * Spielablauf. Vorher stand `ton.spiele('reel_stop')` zwischen zwei
 * `await warte(...)`, und ob daraus einer oder fuenf Klaenge wurden, liess
 * sich nur hoeren - im Browser, von Hand, bei jeder Aenderung neu. Genau
 * dadurch blieb der Mangel so lange stehen: der Quick Spin hielt fuenf Walzen
 * an und spielte **einen** Stoppklang.
 *
 * Hier laeuft stattdessen eine Ereignisfolge durch, und am Ende steht eine
 * Liste von Klaengen. Was gezaehlt wird, ist das, was das Konzept fordert:
 *
 *   - Ein gewoehnlicher Spin: Spinstart 1x, Walzenstopp 5x.
 *   - Der Bonus Sweat: genau 1x, nicht je Walze.
 *   - Vier Gewinnlinien: vier Linienklaenge.
 *   - Das Rad: Start, Lauf, Landung, Gewinn oder Verlust.
 *   - Und nichts doppelt.
 */

interface Mitschrift extends Tonausgabe {
  gespielt: string[];
  gestartet: string[];
  gestoppt: string[];
}

/** Eine Tonausgabe, die nichts abspielt und alles mitschreibt. */
function mitschrift(musikAn = true): Mitschrift {
  const gespielt: string[] = [];
  const gestartet: string[] = [];
  const gestoppt: string[] = [];
  return {
    gespielt,
    gestartet,
    gestoppt,
    einstellungen: { musikAn, effekteAn: true, musikLaut: 28, effekteLaut: 70 },
    setzeEinstellungen: () => undefined,
    freigegeben: true,
    freigeben: () => undefined,
    spiele: (slot: string) => gespielt.push(slot),
    starteSchleife: (slot: string) => gestartet.push(slot),
    stoppeSchleife: (slot: string) => gestoppt.push(slot),
    vorhanden: () => true,
  };
}

/** Die Ereignisse eines gewoehnlichen Spins mit fuenf Walzen. */
function spinFolge(walzen = 5): SlotEreignis[] {
  return [
    { art: 'spinStarted' },
    ...Array.from({ length: walzen }, (_unused, walze): SlotEreignis => ({ art: 'reelStopped', walze })),
    { art: 'reelsFinished' },
  ];
}

const durch = (ereignisse: readonly SlotEreignis[], ton: Mitschrift): Mitschrift => {
  for (const ereignis of ereignisse) {
    klangFuer(ereignis, ton);
  }
  return ton;
};

const wieOft = (liste: readonly string[], slot: string): number =>
  liste.filter((eintrag) => eintrag === slot).length;

describe('Klangereignisse eines Spins', () => {
  it('spielt den Spinstart einmal und jeden Walzenstopp einzeln', () => {
    const ton = durch(spinFolge(5), mitschrift());

    expect(wieOft(ton.gespielt, 'spin_start')).toBe(1);
    expect(wieOft(ton.gespielt, 'reel_stop')).toBe(5);
    // Der Walzenlauf laeuft als Schleife - einmal an, einmal aus.
    expect(wieOft(ton.gestartet, 'reel_loop')).toBe(1);
    expect(wieOft(ton.gestoppt, 'reel_loop')).toBe(1);
  });

  it('gibt auch beim Sprung jeder haltenden Walze ihren Stoppklang', () => {
    /*
     * Der zweite Klick haelt alle noch laufenden Walzen gemeinsam an. Ein
     * einziger Klang dafuer war der Mangel - fuenf Dinge rasten ein, eines
     * macht ein Geraeusch. Ausdruecklich keine eigene «Alle-Stopp»-Datei:
     * dieselbe Datei fuenfmal, mit dem Stimmenpool der Tonausgabe.
     */
    const ton = durch(
      [{ art: 'spinStarted' }, { art: 'spinSkipped', walzen: 5 }, { art: 'reelsFinished' }],
      mitschrift(),
    );

    expect(wieOft(ton.gespielt, 'reel_stop')).toBe(5);
    expect(wieOft(ton.gestoppt, 'reel_loop')).toBe(1);
    // Und kein zweiter Spinstart: ein Sprung ist kein neuer Spin.
    expect(wieOft(ton.gespielt, 'spin_start')).toBe(1);
  });

  it('zählt Sprung und Staffel zusammen auf genau fünf Stopps', () => {
    // Zwei Walzen hielten einzeln, dann wurde gesprungen: drei bleiben.
    const ton = durch(
      [
        { art: 'spinStarted' },
        { art: 'reelStopped', walze: 0 },
        { art: 'reelStopped', walze: 1 },
        { art: 'spinSkipped', walzen: 3 },
        { art: 'reelsFinished' },
      ],
      mitschrift(),
    );
    expect(wieOft(ton.gespielt, 'reel_stop')).toBe(5);
  });

  it('spielt den Bonus Sweat genau einmal je Spin', () => {
    const ton = durch(
      [
        { art: 'spinStarted' },
        { art: 'reelStopped', walze: 0 },
        { art: 'reelStopped', walze: 1 },
        { art: 'bonusSweatStarted' },
        { art: 'reelStopped', walze: 2 },
        { art: 'reelStopped', walze: 3 },
        { art: 'reelStopped', walze: 4 },
        { art: 'reelsFinished' },
      ],
      mitschrift(),
    );

    expect(wieOft(ton.gespielt, 'bonus_sweat')).toBe(1);
    expect(wieOft(ton.gespielt, 'reel_stop')).toBe(5);
  });

  it('spielt für vier Gewinnlinien vier Klänge und keinen Gesamtklang davor', () => {
    const ton = durch(
      [
        ...spinFolge(5),
        { art: 'winLineShown', stufe: 'klein' },
        { art: 'winLineShown', stufe: 'normal' },
        { art: 'winLineShown', stufe: 'klein' },
        { art: 'winLineShown', stufe: 'gross' },
        { art: 'allLinesFinished' },
      ],
      mitschrift(),
    );

    const linien = ton.gespielt.filter((slot) =>
      ['win_small', 'win_normal', 'win_big', 'win_mega', 'jackpot', 'no_win'].includes(slot),
    );
    expect(linien).toEqual(['win_small', 'win_normal', 'win_small', 'win_big']);
    // `allLinesFinished` ist kein fuenfter Klang.
    expect(linien).toHaveLength(4);
  });

  it('spielt ohne Einzelanzeige genau einen Klang für das Ergebnis', () => {
    const ton = durch([...spinFolge(5), { art: 'spinResult', stufe: 'normal' }], mitschrift());
    expect(wieOft(ton.gespielt, 'win_normal')).toBe(1);
    expect(wieOft(ton.gespielt, 'no_win')).toBe(0);
  });

  it('kennt für jede Gewinnstufe einen Klang', () => {
    // Eine Stufe ohne Eintrag waere ein stummer Gewinn.
    for (const [stufe, slot] of Object.entries(STUFEN_KLANG)) {
      expect(slot, stufe).toMatch(/^[a-z_]+$/u);
    }
    expect(Object.keys(STUFEN_KLANG).sort()).toEqual([
      'gross',
      'jackpot',
      'keine',
      'klein',
      'mega',
      'normal',
    ]);
  });

  it('begleitet das Rad von der Drehung bis zur Landung', () => {
    const gewonnen = durch([{ art: 'gambleStarted' }, { art: 'gambleLanded', gewonnen: true }], mitschrift());
    expect(wieOft(gewonnen.gespielt, 'gamble_start')).toBe(1);
    expect(wieOft(gewonnen.gestartet, 'gamble_spin')).toBe(1);
    expect(wieOft(gewonnen.gespielt, 'gamble_tension')).toBe(1);
    expect(wieOft(gewonnen.gestoppt, 'gamble_spin')).toBe(1);
    expect(wieOft(gewonnen.gespielt, 'gamble_win')).toBe(1);
    expect(wieOft(gewonnen.gespielt, 'gamble_lose')).toBe(0);

    const verloren = durch([{ art: 'gambleLanded', gewonnen: false }], mitschrift());
    expect(wieOft(verloren.gespielt, 'gamble_lose')).toBe(1);
    expect(wieOft(verloren.gespielt, 'gamble_win')).toBe(0);
  });

  it('meldet einen verlorenen Bonus nicht zweimal', () => {
    /*
     * Ein verlorener Bonus endet an der Leiter, und dort hat `gambleLanded`
     * schon `gamble_lose` gespielt. Ein Abschlussklang darueber waere
     * zweimal dieselbe Nachricht.
     */
    const ton = durch(
      [
        { art: 'gambleLanded', gewonnen: false },
        { art: 'bonusFinished', gewonnen: false },
      ],
      mitschrift(),
    );
    expect(wieOft(ton.gespielt, 'gamble_lose')).toBe(1);
    expect(wieOft(ton.gespielt, 'freespin_end')).toBe(0);

    const gewonnen = durch([{ art: 'bonusFinished', gewonnen: true }], mitschrift());
    expect(wieOft(gewonnen.gespielt, 'freespin_end')).toBe(1);
  });

  it('blendet die Grundstimmung über, statt zu schneiden', () => {
    const hinein = durch([{ art: 'stimmung', freispiel: true }], mitschrift());
    // Beide im selben Moment - das ist die Ueberblendung.
    expect(hinein.gestoppt).toEqual(['musik']);
    expect(hinein.gestartet).toEqual(['freespin_loop']);

    const heraus = durch([{ art: 'stimmung', freispiel: false }], mitschrift());
    expect(heraus.gestoppt).toEqual(['freespin_loop']);
    expect(heraus.gestartet).toEqual(['musik']);

    // Wer die Musik abgeschaltet hat, bekommt sie nicht durch die Hintertür.
    const stumm = durch([{ art: 'stimmung', freispiel: false }], mitschrift(false));
    expect(stumm.gestartet).toEqual([]);
  });

  it('spielt bei einem abgewiesenen Spin kein Ergebnis', () => {
    const ton = durch([{ art: 'spinStarted' }, { art: 'spinAborted' }], mitschrift());
    expect(wieOft(ton.gestoppt, 'reel_loop')).toBe(1);
    expect(ton.gespielt).toEqual(['spin_start']);
  });
});

describe('Die Tonausgabe selbst', () => {
  const KLANG = 'apps/web/src/modules/level/xpslot/components/klang.ts';
  const quelle = readFileSync(KLANG, 'utf8');
  const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

  it('hat je Slot einen Stimmenpool und nicht ein Element', () => {
    /*
     * Hier stand `new Map<string, HTMLAudioElement>()` - ein Element je
     * Slot. Damit schnitt der zweite Walzenstopp den ersten ab, und vier von
     * fuenf Einrastungen waren abgehackt. Der Pool ist der Grund, weshalb der
     * Test weiter oben fuenf Klaenge zaehlen darf und nicht nur fuenf
     * Aufrufe.
     */
    expect(ohneKommentare).toContain('new Map<string, HTMLAudioElement[]>()');
    expect(ohneKommentare).toContain('POOL_STIMMEN');
    expect(ohneKommentare).toContain('pool.find((stimme) => stimme.paused || stimme.ended)');
  });

  it('variiert wiederkehrende Klänge leicht und die grossen Momente nicht', () => {
    expect(ohneKommentare).toContain('const VARIATION = new Set([');
    const block = quelle.slice(quelle.indexOf('const VARIATION = new Set(['));
    const liste = block.slice(0, block.indexOf(']'));
    expect(liste).toContain('reel_stop');
    // Ein Jackpot, der jedes Mal anders klingt, klingt kaputt.
    expect(liste).not.toContain('jackpot');
    expect(liste).not.toContain('win_mega');
    expect(ohneKommentare).toContain('playbackRate = abweichung.rate');
  });

  it('blendet Schleifen ein und aus, statt sie hart zu schneiden', () => {
    expect(ohneKommentare).toContain('const BLENDE_MS');
    expect(ohneKommentare).toContain('blende(slot, element, laut)');
    expect(ohneKommentare).toContain('blende(slot, element, 0, halt)');
    // Die Musik lang, der Walzenlauf kurz - eine Zahl fuer beides waere falsch.
    const tabelle = quelle.slice(quelle.indexOf('const BLENDE_MS'));
    expect(tabelle.slice(0, tabelle.indexOf('}'))).toMatch(/musik:\s*\d{3}/u);
    expect(tabelle.slice(0, tabelle.indexOf('}'))).toMatch(/reel_loop:\s*\d{2,3}/u);
  });

  it('hält kein Tonproblem einen Spin auf', () => {
    // Die Regel aus dem Konzept, unveraendert: kein `throw`, jedes `play` mit
    // `catch`.
    expect(ohneKommentare).not.toMatch(/\bthrow\b/u);
    const spiele = [...ohneKommentare.matchAll(/\.play\(\)/gu)];
    expect(spiele.length).toBeGreaterThan(0);
    for (const treffer of spiele) {
      const danach = ohneKommentare.slice(treffer.index, treffer.index + 40);
      expect(danach).toContain('.catch(');
    }
  });
});

describe('Der Klangsatz', () => {
  const SKRIPT = 'scripts/xp-slot-standardklaenge.mjs';
  const quelle = readFileSync(SKRIPT, 'utf8');

  it('pegelt jeden mitgelieferten Klang auf ein Ziel ein', () => {
    /*
     * Der Satz war um vierundzwanzig Dezibel auseinander: der Walzenstopp bei
     * -34, der Jackpot bei -16. Wer die Regler nach dem einen stellt, hoert
     * das andere nicht oder erschrickt. Die Tabelle macht daraus eine gewollte
     * Treppe, und der Lauf bricht ab, wenn ein neuer Klang darin fehlt.
     */
    expect(quelle).toContain('const ZIELPEGEL');
    expect(quelle).toContain('function lautheit');
    expect(quelle).toContain('alsWav(normalisiere(name, daten))');
    expect(quelle).toContain('Kein Zielpegel');

    // Jeder Slot der Liste hat einen Zielpegel.
    const slots = [...quelle.matchAll(/^toene\.(\w+)/gmu)].map((treffer) => treffer[1]!);
    const tabelle = quelle.slice(quelle.indexOf('const ZIELPEGEL'));
    const block = tabelle.slice(0, tabelle.indexOf('};'));
    expect(slots.length).toBeGreaterThan(20);
    for (const slot of slots) {
      expect(block, slot).toContain(`${slot}:`);
    }
  });

  it('spannt die Zielpegel über höchstens zwölf Dezibel', () => {
    const tabelle = quelle.slice(quelle.indexOf('const ZIELPEGEL'));
    const block = tabelle.slice(0, tabelle.indexOf('};'));
    const werte = [...block.matchAll(/:\s*(-\d+)/gu)].map((treffer) => Number(treffer[1]));
    expect(werte.length).toBeGreaterThan(20);
    expect(Math.max(...werte) - Math.min(...werte)).toBeLessThanOrEqual(12);
  });

  it('baut den Walzenlauf tief, lang und nahtlos', () => {
    /*
     * Der alte war ein Schnarren: 0,16 Sekunden, Grundton 150 Hertz, mehr
     * Rauschen als Ton. Beides gehoert festgehalten - der tiefe Grundton und
     * die Laenge, weil 0,16 Sekunden als eigener Brummton hoerbar waren.
     */
    const block = quelle.slice(quelle.indexOf('toene.reel_loop'), quelle.indexOf('toene.reel_stop'));
    expect(block).toContain('const grund = 75');
    expect(block).toContain('const dauer = 0.44');
    expect(block).toContain('schliesse(');
    // Keine externe Quelle, nirgends im Satz.
    expect(quelle).not.toMatch(/https?:\/\//u);
  });
});
