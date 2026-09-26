import { describe, expect, it } from 'vitest';
import {
  ausSnapshot,
  berechneErgebnis,
  verteileProzente,
  zuSnapshot,
  type StimmenZeile,
} from '../../packages/modules/src/fragt/ergebnis';
import { buttonId, parseButtonId } from '../../packages/modules/src/fragt/embed';
import { FRAGETYPEN, fragetyp } from '../../packages/modules/src/fragt/typen';
import { folienVorschlag, leseFolien } from '../../packages/modules/src/fragt/entwurf';

/**
 * Die Zahlen, und was sie nicht behaupten duerfen.
 *
 * `ergebnis.ts` haengt an nichts - keine Datenbank, kein Discord. Das ist
 * Absicht: hier entstehen die Werte, die spaeter auf einer Grafik stehen, die
 * jemand auf Instagram postet. Sie muessen einzeln pruefbar sein.
 */

const zeile = (label: string, position: number, stimmen: number): StimmenZeile => ({
  optionId: `c${label.toLowerCase().padEnd(24, 'x')}`,
  label,
  position,
  stimmen,
});

describe('Prozente summieren sich zu 100', () => {
  it('teilt drei gleiche Anteile ohne Rest auf', () => {
    /*
     * Der Fall, an dem naives Runden scheitert: 33 + 33 + 33 = 99. Auf einer
     * Grafik, die nur diese drei Zahlen zeigt, fehlt dann ein Prozent ohne
     * Erklaerung.
     */
    const prozente = verteileProzente([1, 1, 1]);
    expect(prozente.reduce((summe, wert) => summe + wert, 0)).toBe(100);
    expect(prozente).toEqual([34, 33, 33]);
  });

  it('bleibt auch bei Sechsteln bei 100', () => {
    // 17 + 17 + 67 = 101 waere das naive Ergebnis.
    const prozente = verteileProzente([1, 1, 4]);
    expect(prozente.reduce((summe, wert) => summe + wert, 0)).toBe(100);
  });

  it.each([[[1, 1, 1]], [[1, 2, 3, 4]], [[7, 7, 7, 7, 7]], [[1, 0, 0]], [[999, 1]], [[5, 5, 5, 5, 5, 5, 5]]])(
    'summiert %j zu 100',
    (stimmen) => {
      expect(verteileProzente(stimmen).reduce((summe, wert) => summe + wert, 0)).toBe(100);
    },
  );

  it('gibt bei null Stimmen ueberall 0 - nicht 100 verteilt auf niemanden', () => {
    expect(verteileProzente([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('entscheidet bei gleichem Rest nach Position, nicht nach Zufall', () => {
    // Zweimal dasselbe Ergebnis - sonst saehe ein zweiter Export anders aus
    // als der erste.
    expect(verteileProzente([1, 1, 1])).toEqual(verteileProzente([1, 1, 1]));
  });
});

describe('Das Ergebnis', () => {
  it('nennt den Gewinner, wenn es einen gibt', () => {
    const ergebnis = berechneErgebnis([zeile('Minecraft', 0, 42), zeile('CS2', 1, 30)]);
    expect(ergebnis.gewinner?.label).toBe('Minecraft');
    expect(ergebnis.gleichstand).toEqual([]);
    expect(ergebnis.gesamt).toBe(72);
  });

  it('erklaert keinen Gewinner bei Gleichstand', () => {
    /*
     * Die wichtigste Zusage dieses Moduls. Einen von zwei gleichstarken zum
     * Sieger zu machen - etwa den mit der kleineren Position - waere eine
     * Zahl, die das Ergebnis nicht hergibt.
     */
    const ergebnis = berechneErgebnis([zeile('Controller', 0, 20), zeile('Maus', 1, 20)]);
    expect(ergebnis.gewinner).toBeNull();
    expect(ergebnis.gleichstand.map((eintrag) => eintrag.label)).toEqual(['Controller', 'Maus']);
    expect(ergebnis.zeilen.every((eintrag) => eintrag.fuehrt)).toBe(true);
  });

  it('laesst bei null Stimmen niemanden fuehren', () => {
    // Ohne diese Regel waere `stimmen === hoechste` fuer jede Zeile wahr -
    // alle haetten null - und die Grafik hoebe alle vier als Sieger hervor.
    const ergebnis = berechneErgebnis([zeile('A', 0, 0), zeile('B', 1, 0)]);
    expect(ergebnis.gesamt).toBe(0);
    expect(ergebnis.gewinner).toBeNull();
    expect(ergebnis.gleichstand).toEqual([]);
    expect(ergebnis.zeilen.some((eintrag) => eintrag.fuehrt)).toBe(false);
  });

  it('behaelt die Reihenfolge der Frage bei, nicht die der Stimmen', () => {
    // Wer das Ergebnis neben die Frage haelt, soll nicht suchen muessen.
    const ergebnis = berechneErgebnis([zeile('C', 2, 90), zeile('A', 0, 5), zeile('B', 1, 5)]);
    expect(ergebnis.zeilen.map((eintrag) => eintrag.label)).toEqual(['A', 'B', 'C']);
  });

  it('fuehrt eine Antwort ohne Stimmen weiterhin auf', () => {
    // Sonst fehlte sie in der Ergebnisgrafik, und niemand wuesste, dass sie
    // zur Wahl stand.
    const ergebnis = berechneErgebnis([zeile('A', 0, 10), zeile('B', 1, 0)]);
    expect(ergebnis.zeilen).toHaveLength(2);
    expect(ergebnis.zeilen[1]).toMatchObject({ label: 'B', stimmen: 0, prozent: 0 });
  });
});

describe('Der Schnappschuss', () => {
  it('gibt beim Zuruecklesen dieselben Zahlen', () => {
    /*
     * Der Kern der Unveraenderlichkeit: was beim Schliessen festgeschrieben
     * wurde, ergibt beim zweiten Export dasselbe Bild.
     */
    const original = berechneErgebnis([zeile('A', 0, 7), zeile('B', 1, 3)]);
    const zurueck = ausSnapshot(zuSnapshot(original, new Date('2026-09-26T10:00:00Z')));
    expect(zurueck?.gesamt).toBe(original.gesamt);
    expect(zurueck?.zeilen.map((eintrag) => eintrag.prozent)).toEqual(
      original.zeilen.map((eintrag) => eintrag.prozent),
    );
    expect(zurueck?.gewinner?.label).toBe('A');
  });

  it('gibt null statt zu werfen, wenn das JSON nicht passt', () => {
    // Ein Ergebnis aus einer kuenftigen Fassung soll die Ergebnisliste nicht
    // unbenutzbar machen.
    expect(ausSnapshot(null)).toBeNull();
    expect(ausSnapshot({ version: 2, zeilen: [] })).toBeNull();
    expect(ausSnapshot({ version: 1, zeilen: [{ label: 'A' }] })).toBeNull();
    expect(ausSnapshot('kaputt')).toBeNull();
  });
});

describe('Die Button-Kennung', () => {
  const A = 'clh3kx9q10000abcdefghijkl';
  const B = 'clh3kx9q10001abcdefghijkl';

  it('bringt Abstimmung und Antwort zurueck', () => {
    expect(parseButtonId(buttonId(A, B))).toEqual({ abstimmungId: A, optionId: B });
  });

  it('bleibt unter Discords Grenze von 100 Zeichen', () => {
    expect(buttonId(A, B).length).toBeLessThanOrEqual(100);
  });

  it('traegt die Abstimmung mit, nicht nur die Antwort', () => {
    /*
     * Eine Frage kann mehrfach gestellt worden sein - dann zeigen die Buttons
     * von letztem Monat auf dieselben Optionen wie die von heute. Ohne die
     * Abstimmungskennung landete ein Klick auf einer alten Nachricht in der
     * laufenden Abstimmung.
     */
    expect(buttonId(A, B)).toContain(A);
    expect(parseButtonId(buttonId(A, B))?.abstimmungId).toBe(A);
  });

  it('gibt null fuer alles, was nicht hierher gehoert', () => {
    const schlecht = [
      ['fremdes Modul', 'jail:vote:abc'],
      ['nur Praefix', 'fragt'],
      ['zu wenige Teile', `fragt:${A}`],
      ['zu viele Teile', `fragt:${A}:${B}:extra`],
      ['keine cuid', 'fragt:../../etc:passwd'],
      ['leer', ''],
      ['SQL-Versuch', `fragt:${A}:' OR 1=1--`],
    ] as const;
    for (const [was, kennung] of schlecht) {
      expect(parseButtonId(kennung), was).toBeNull();
    }
  });
});

describe('Die Fragetypen', () => {
  it('gibt jedem Typ eine Regel', () => {
    for (const angaben of FRAGETYPEN) {
      expect(fragetyp(angaben.typ)).toBe(angaben);
      expect(angaben.minOptionen).toBeGreaterThanOrEqual(2);
      expect(angaben.maxOptionen).toBeGreaterThanOrEqual(angaben.minOptionen);
    }
  });

  it('haelt jeden Typ unter fuenf Antworten', () => {
    // Discord erlaubt fuenf Buttons je Reihe. Mehr hiesse eine zweite Reihe -
    // und auf einem Telefon ist eine Frage mit acht Knoepfen eine Liste.
    for (const angaben of FRAGETYPEN) {
      expect(angaben.maxOptionen, angaben.label).toBeLessThanOrEqual(5);
    }
  });

  it('gibt Hot Take feste Antworten', () => {
    // Sonst sagt jede zweite Hot-Take-Frage «Ja / Nein», und die Grafiken
    // waeren nicht mehr vergleichbar.
    expect(fragetyp('HOT_TAKE').festeOptionen).toEqual(['Stimme zu', 'Stimme nicht zu']);
  });

  it('wirft bei einem Typ ohne Regel', () => {
    expect(() => fragetyp('GIBT_ES_NICHT' as never)).toThrow();
  });
});

describe('Die Folien eines Carousels', () => {
  it('nimmt bei zwei Antworten drei Folien statt vier', () => {
    /*
     * Keine kuenstliche Streckung: bei einem Entweder-oder zeigten «der
     * Gewinner» und «die Verteilung» beide dasselbe - zwei Balken, einer
     * laenger.
     */
    expect(folienVorschlag('ENTWEDER_ODER').map((folie) => folie.art)).toEqual(['frage', 'duell', 'cta']);
    expect(folienVorschlag('HOT_TAKE')).toHaveLength(3);
  });

  it('nimmt bei mehr Antworten vier Folien', () => {
    expect(folienVorschlag('UMFRAGE').map((folie) => folie.art)).toEqual([
      'frage',
      'gewinner',
      'verteilung',
      'cta',
    ]);
  });

  it('faellt bei kaputtem JSON auf den Vorschlag zurueck', () => {
    // Eine leere Liste saehe im Studio wie ein Fehler aus.
    expect(leseFolien(null, 'UMFRAGE')).toHaveLength(4);
    expect(leseFolien([{ art: 'gibtsnicht' }], 'UMFRAGE')).toHaveLength(4);
    expect(leseFolien('kaputt', 'ENTWEDER_ODER')).toHaveLength(3);
  });

  it('liest eine gespeicherte Auswahl in ihrer Reihenfolge', () => {
    const gespeichert = [
      { art: 'cta', aktiv: true, position: 1 },
      { art: 'frage', aktiv: false, position: 0 },
    ];
    expect(leseFolien(gespeichert, 'UMFRAGE').map((folie) => folie.art)).toEqual(['frage', 'cta']);
    expect(leseFolien(gespeichert, 'UMFRAGE')[0]?.aktiv).toBe(false);
  });
});
