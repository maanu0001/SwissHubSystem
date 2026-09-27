import { describe, expect, it } from 'vitest';
import {
  ABSCHNITT_SCHLUESSEL,
  abschnittArt,
  alleAbschnitte,
  istAbschnittSchluessel,
  ordneAbschnitte,
} from '../../packages/modules/src/profile/abschnitte';

/**
 * Die Reihenfolge der oeffentlichen Abschnitte.
 *
 * ## Warum das eine eigene Pruefung braucht
 *
 * Weil die gespeicherte Liste **aelter ist als der Code**. Ein Abschnitt, den
 * es nicht mehr gibt, steht noch in tausend Profilen; ein neuer fehlt in allen.
 * Beides darf die Seite nicht unvollstaendig machen - und «nicht unvollstaendig»
 * heisst hier: jeder Abschnitt kommt genau einmal vor, egal was in der Spalte
 * steht.
 *
 * Das ist der Unterschied zwischen einer Reihenfolge und einem Website-Builder.
 * Eine Liste von Schluesseln kann nur umsortieren, was es gibt.
 */
describe('Abschnitte: Reihenfolge bereinigen', () => {
  it('haelt die gespeicherte Reihenfolge ein', () => {
    const reihe = ordneAbschnitte(['links', 'gaming', 'streaming']);
    expect(reihe.slice(0, 3)).toEqual(['links', 'gaming', 'streaming']);
  });

  it('haengt fehlende Abschnitte hinten an - in der Vorgabe-Reihenfolge', () => {
    /*
     * Ein neuer Abschnitt erscheint damit bei jedem, ohne Migration - und er
     * draengelt sich nicht vor etwas, das jemand bewusst nach oben gestellt hat.
     */
    const reihe = ordneAbschnitte(['links']);
    expect(reihe[0]).toBe('links');
    expect(new Set(reihe)).toEqual(new Set(ABSCHNITT_SCHLUESSEL));
    // Die angehaengten stehen in der Vorgabe-Reihenfolge, ohne den schon
    // genannten.
    const erwartet = ABSCHNITT_SCHLUESSEL.filter((key) => key !== 'links');
    expect(reihe.slice(1)).toEqual(erwartet);
  });

  it('entfernt unbekannte Schluessel', () => {
    // Ein entfernter Abschnitt steht noch in gespeicherten Listen. Ihn
    // durchzulassen hiesse, dass die Anzeige etwas nachschlagen muss, das es
    // nicht gibt.
    const reihe = ordneAbschnitte(['gibtesnicht', 'links', '../../etc/passwd', '']);
    expect(reihe).not.toContain('gibtesnicht');
    expect(reihe[0]).toBe('links');
    expect(reihe).toHaveLength(ABSCHNITT_SCHLUESSEL.length);
  });

  it('laesst jeden Abschnitt genau einmal vorkommen', () => {
    const reihe = ordneAbschnitte(['links', 'links', 'gaming', 'links']);
    expect(reihe.filter((key) => key === 'links')).toHaveLength(1);
    expect(new Set(reihe).size).toBe(reihe.length);
  });

  it('gibt bei leerer Spalte die Vorgabe', () => {
    // Was jedes bestehende Profil nach der Migration hat: eine leere Liste.
    expect(ordneAbschnitte([])).toEqual([...ABSCHNITT_SCHLUESSEL]);
  });

  it('stellt Streaming voran - das einzige Zeitkritische', () => {
    /*
     * Wer gerade live ist, soll es sehen, bevor er scrollt. Deshalb ist
     * «streaming» der erste Schluessel der Vorgabe, und deshalb steht diese
     * Erwartung hier: sie ist eine Entscheidung, nicht ein Zufall der
     * Listenreihenfolge.
     */
    expect(ABSCHNITT_SCHLUESSEL[0]).toBe('streaming');
  });

  it('hat zu jedem Schluessel eine Beschreibung fuer den Editor', () => {
    for (const key of ABSCHNITT_SCHLUESSEL) {
      const art = abschnittArt(key);
      expect(art, key).toBeDefined();
      expect(art!.label.length, key).toBeGreaterThan(2);
      expect(art!.beschreibung.length, key).toBeGreaterThan(10);
    }
    expect(alleAbschnitte()).toHaveLength(ABSCHNITT_SCHLUESSEL.length);
  });

  it('erkennt nur die eigenen Schluessel', () => {
    expect(istAbschnittSchluessel('links')).toBe(true);
    expect(istAbschnittSchluessel('Links')).toBe(false);
    expect(istAbschnittSchluessel('')).toBe(false);
    expect(istAbschnittSchluessel('__proto__')).toBe(false);
    expect(istAbschnittSchluessel('constructor')).toBe(false);
  });
});
