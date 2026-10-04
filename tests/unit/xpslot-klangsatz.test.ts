import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { level } from '@swisshub/modules';

/**
 * Der mitgelieferte Klangsatz.
 *
 * ## Warum das ein Test ist und keine Sichtpruefung
 *
 * Weil ein fehlender Klang **still** ist. Ein fehlendes Bild sieht man, ein
 * fehlender Ton fehlt nur - und zwar genau einmal, in dem Moment, in dem er
 * kommen sollte. Genau so sind die beiden Musikschleifen monatelang
 * unbemerkt geblieben: die Slots gab es, die Dateien nicht, und niemand hat
 * nachgezaehlt.
 *
 * Darum zaehlt dieser Test nach: jeder Slot des Katalogs hat eine Adresse,
 * jede Adresse hat eine Datei, jede Datei hat Inhalt. Und die Schleifen sind
 * Schleifen - auch das steht hier, weil eine Hintergrundmusik, die einmal
 * spielt und dann schweigt, kaum von einer fehlenden zu unterscheiden ist.
 */

const WURZEL = 'apps/web/public';
const ADRESSEN = 'apps/web/src/modules/level/xpslot/adressen.ts';
const KLANG = 'apps/web/src/modules/level/xpslot/components/klang.ts';
const SPIEL = 'apps/web/src/modules/level/xpslot/components/spiel.tsx';
const BEFEHL = 'apps/bot/src/commands/xpslot-commands.ts';

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

/** Die Standardadressen, aus der Quelle gelesen - eine Stelle, eine Wahrheit. */
function standardKlaenge(): Map<string, string> {
  const quelle = lies(ADRESSEN);
  const block = quelle.slice(
    quelle.indexOf('export const STANDARD_KLAENGE'),
    quelle.indexOf('export function klangQuelle'),
  );
  return new Map([...block.matchAll(/(\w+):\s*'([^']+)'/gu)].map((treffer) => [treffer[1]!, treffer[2]!]));
}

describe('Klangsatz', () => {
  const standard = standardKlaenge();

  it('belegt jeden Slot des Katalogs', () => {
    const fehlend = level.xpslot.KLANG_SLOTS.filter((slot) => !standard.has(slot.key));
    /*
     * Kein leerer Standard-Slot - so steht es im Konzept. Vorher fehlten
     * `musik` und `freespin_loop`, und zwar mit Absicht: Musik sei Geschmack.
     * Das Ergebnis war ein Automat, der in der Stille stand.
     */
    expect(fehlend.map((slot) => slot.key)).toEqual([]);
    expect(level.xpslot.KLANG_SLOTS.length).toBeGreaterThanOrEqual(24);
  });

  it('hat zu jeder Adresse eine Datei mit Inhalt', () => {
    for (const [slot, adresse] of standard) {
      const pfad = `${WURZEL}${adresse}`;
      expect(existsSync(pfad), `${slot} → ${adresse}`).toBe(true);
      // Eine WAV-Datei mit 44 Byte ist ein Kopf ohne Ton.
      expect(statSync(pfad).size, slot).toBeGreaterThan(1000);
    }
  });

  it('nennt Hintergrundmusik und Freispielmusik ausdrücklich', () => {
    for (const slot of ['musik', 'freespin_loop'] as const) {
      expect(standard.has(slot), slot).toBe(true);
      // Musik muss laenger sein als ein Effekt - sonst ist es ein Jingle.
      expect(statSync(`${WURZEL}${standard.get(slot)!}`).size).toBeGreaterThan(100_000);
    }
  });

  it('hat eigene Klänge für das Risiko-Rad', () => {
    for (const slot of ['gamble_start', 'gamble_spin', 'gamble_tension', 'gamble_win', 'gamble_lose']) {
      expect(standard.has(slot), slot).toBe(true);
    }
  });

  it('lässt Schleifen als Schleifen laufen - Musik am Musikregler', () => {
    const quelle = ohneKommentare(lies(KLANG));
    // Vier Schleifen: Musik, Freispielmusik, Walzenlauf, Rad.
    expect(quelle).toContain(
      "const SCHLEIFEN_SLOTS = new Set(['musik', 'freespin_loop', 'reel_loop', 'gamble_spin'])",
    );
    // Aber nur zwei haengen am Musikregler: wer die Musik abschaltet, will
    // die Walzen weiter hoeren.
    expect(quelle).toContain("const MUSIK_SLOTS = new Set(['musik', 'freespin_loop'])");
    expect(quelle).toContain('element.loop = SCHLEIFEN_SLOTS.has(slot)');
    expect(level.xpslot.MUSIK_SLOTS).toEqual(['musik', 'freespin_loop']);
    expect(level.xpslot.SCHLEIFEN_SLOTS).toContain('reel_loop');
  });

  it('lädt die Klänge vor, sobald Ton erlaubt ist', () => {
    const quelle = ohneKommentare(lies(KLANG));
    // Ohne Vorladen kommt der erste Walzenstopp eines Besuchs zu spaet - er
    // muss erst die Datei holen.
    expect(quelle).toMatch(
      /if \(!freigegeben\) \{\s*return;\s*\}\s*for \(const slot of nachSlot\.keys\(\)\)/u,
    );
  });

  it('bricht bei einem Tonproblem nichts ab', () => {
    const quelle = ohneKommentare(lies(KLANG));
    // Kein `throw` in der ganzen Tonausgabe, und jedes `play` mit `catch`.
    expect(quelle).not.toMatch(/^\s*throw /mu);
    const spiele = [...quelle.matchAll(/\.play\(\)/gu)];
    expect(spiele.length).toBeGreaterThan(0);
    expect(quelle.match(/\.play\(\)\.catch\(\(\) => undefined\)/gu)?.length).toBe(spiele.length);
  });
});

describe('Klänge zur richtigen Zeit', () => {
  const quelle = ohneKommentare(lies(SPIEL));

  it('spielt den Gewinnklang erst nach dem letzten Einrasten', () => {
    // Zuerst der Stopp, dann die Pause, dann das Ergebnis - in dieser
    // Reihenfolge im Quelltext, weil es eine Reihenfolge in der Zeit ist.
    const stopp = quelle.indexOf("ton.stoppeSchleife('reel_loop')");
    const pause = quelle.indexOf('await warte(ZEITEN.ergebnis)');
    const gewinn = quelle.indexOf('STUFEN_KLANG[spin.stufe]');
    expect(stopp).toBeGreaterThan(-1);
    expect(pause).toBeGreaterThan(stopp);
    expect(gewinn).toBeGreaterThan(pause);
  });

  it('ersetzt den Gewinnklang bei einem Bonus, statt beide zu spielen', () => {
    expect(quelle).toMatch(
      /if \(spin\.bonusAusgeloest\) \{[\s\S]*?ton\.spiele\(spin\.art === 'BONUS_ROUND' \? 'retrigger' : 'bonus_trigger'\);[\s\S]*?\} else \{[\s\S]*?STUFEN_KLANG/u,
    );
  });

  it('hält bei Quick Spin alle Walzen zusammen an - ausser beim Sweat', () => {
    expect(quelle).toContain('if (schnell && !sweatSpielt)');
    expect(quelle).toContain('haltAlle(0)');
    // Die Ausnahme steht als eigener Zweig da und nicht als Zufall.
    expect(quelle).toContain('} else if (schnell && sweatAb !== null) {');
    expect(quelle).toContain("ton.spiele('bonus_sweat')");
  });

  it('startet und beendet die Radklänge zusammen mit dem Rad', () => {
    expect(quelle).toContain("ton.starteSchleife('gamble_spin')");
    expect(quelle).toContain("ton.spiele('gamble_tension')");
    expect(quelle).toContain("ton.stoppeSchleife('gamble_spin')");
    // Gewonnen oder verloren entscheidet der Server; der Klang folgt dem
    // Ergebnis und nicht umgekehrt.
    expect(quelle).toContain("ton.spiele(gewonnen ? 'gamble_win' : 'gamble_lose')");
  });

  it('zeigt der Verwaltung den Wartungsmodus', () => {
    expect(quelle).toContain('ansicht.wartung');
    expect(lies(SPIEL)).toContain('Wartungsmodus aktiv');
  });
});

describe('/xp-slot Embed ohne Spielzahlen', () => {
  const quelle = ohneKommentare(lies(BEFEHL));

  it('fügt keine Einsätze, keinen Jackpot, keinen Bonus und keine Quote an', () => {
    /*
     * Vier Felder standen hier automatisch im Embed - unabhaengig davon, was
     * die Verwaltung geschrieben hatte. Das war ein Embed, das niemand
     * vollstaendig gestalten konnte, und eine Tabelle in einer Einladung.
     */
    for (const verboten of ['fields:', 'einsaetze', 'jackpotMultiplikator', 'bonusAusloeser', 'rtp']) {
      expect(quelle, verboten).not.toContain(verboten);
    }
  });

  it('nimmt Titel, Text, Farbe, Fusszeile und Knopf aus der Einstellung', () => {
    for (const feld of [
      'embed.titel',
      'embed.beschreibung',
      'embed.farbe',
      'embed.fusszeile',
      'embed.knopf',
    ]) {
      expect(quelle).toContain(feld);
    }
  });

  it('kennt den Eventmodus nicht mehr', () => {
    expect(quelle).not.toContain('eventName');
    expect(quelle).not.toContain('slotAnsicht');
  });
});
