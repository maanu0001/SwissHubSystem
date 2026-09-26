import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Jede Stelle, die einen Clip zeigt, geht durch `ClipRahmen`.
 *
 * ## Warum das ein Test ist
 *
 * Vor den Uploads war ein Clip immer ein `iframe`, und die Wiederholung an
 * fuenf Stellen war harmlos. Jetzt ist es eine Entscheidung - `iframe` fuer
 * Twitch, YouTube und Medal, `<video>` fuer eigene Dateien -, und eine
 * Entscheidung an fuenf Stellen ist eine Stelle, die beim naechsten Mal
 * vergessen wird.
 *
 * Vergessen hiesse hier nicht «sieht etwas anders aus». Es hiesse: die
 * **Moderation** sieht eine leere Flaeche und gibt einen Clip frei, den sie
 * nicht gesehen hat. Oder die Gewinnerbuehne zeigt Schwarz.
 *
 * Und ein `iframe` auf die eigene Domain waere ausserdem ein Rahmen mit
 * unseren eigenen Cookies darin - genau das, was die Sandbox verhindern soll.
 *
 * Geprueft wird deshalb die Abwesenheit: **kein** `iframe` im Clip-Modul
 * aussor in `clip-rahmen.tsx` selbst.
 */
const VERZEICHNIS = join(process.cwd(), 'apps/web/src/modules/clips/components');

/** Die eine Datei, die ein `iframe` schreiben darf. */
const RAHMEN = 'clip-rahmen.tsx';

function dateien(): string[] {
  return readdirSync(VERZEICHNIS).filter((name) => name.endsWith('.tsx') && name !== RAHMEN);
}

describe('Clips einbetten: eine Entscheidung, eine Stelle', () => {
  it('schreibt nirgends sonst ein iframe', () => {
    for (const name of dateien()) {
      const quelle = readFileSync(join(VERZEICHNIS, name), 'utf8');
      expect(quelle, `${name} baut ein eigenes iframe`).not.toMatch(/<iframe/u);
    }
  });

  it('schreibt nirgends sonst ein video-Element', () => {
    // Dieselbe Begruendung in die andere Richtung: ein `<video>` mit einer
    // Anbieteradresse waere ein Player, der nie etwas abspielt.
    for (const name of dateien()) {
      const quelle = readFileSync(join(VERZEICHNIS, name), 'utf8');
      expect(quelle, `${name} baut ein eigenes video-Element`).not.toMatch(/<video\n/u);
    }
  });

  it('fuehrt alle fuenf Ansichten ueber ClipRahmen', () => {
    /*
     * Namentlich, nicht als Suche: waere eine dieser Dateien umbenannt oder
     * durch eine neue ersetzt, soll dieser Test auffallen und nicht still
     * weniger pruefen.
     */
    const stellen = [
      ['clip-spieler.tsx', 'der Player im Dialog'],
      ['einreich-assistent.tsx', 'die Vorschau beim Einreichen'],
      ['moderations-liste.tsx', 'die Moderation'],
      ['gewinner-buehne.tsx', 'die Gewinnerbuehne'],
      ['zufalls-ansicht.tsx', 'die Zufallsansicht'],
    ] as const;
    for (const [name, wofuer] of stellen) {
      const quelle = readFileSync(join(VERZEICHNIS, name), 'utf8');
      expect(quelle, `${wofuer} (${name})`).toContain('<ClipRahmen');
    }
  });

  it('entscheidet im Rahmen an genau einer Bedingung', () => {
    /*
     * `provider === 'upload'` - und sonst nichts. Eine zweite Bedingung, etwa
     * an der Adresse oder der Endung, waere eine zweite Vorstellung davon, was
     * eine eigene Datei ist.
     */
    const quelle = readFileSync(join(VERZEICHNIS, RAHMEN), 'utf8');
    expect([...quelle.matchAll(/provider === 'upload'/gu)]).toHaveLength(1);
    expect(quelle).toMatch(/<video\n/u);
    expect(quelle).toMatch(/<iframe/u);
  });

  it('gibt einer eigenen Datei kein autoplay', () => {
    /*
     * Ein Video, das von selbst losgeht, ist im besten Fall ueberraschend und
     * im schlechtesten laut. Beim `iframe` entscheidet das der Aufrufer - dort
     * geht es um die `allow`-Liste, nicht um das Starten.
     */
    const quelle = readFileSync(join(VERZEICHNIS, RAHMEN), 'utf8');
    // `<video` mit Umbruch dahinter: das JSX-Element, nicht die Erwaehnung
    // `<video>` im Kommentar darueber.
    const videoBlock = /<video\n[\s\S]*?<\/video>/u.exec(quelle)?.[0] ?? '';
    expect(videoBlock, 'kein video-Element in clip-rahmen.tsx gefunden').not.toBe('');
    expect(videoBlock).not.toMatch(/autoPlay/u);
    expect(videoBlock).toMatch(/preload="metadata"/u);
  });
});
