import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { meldungFuerFremdeAntwort } from '@/lib/upload-meldung';

/**
 * Eine Zahl, die man nicht kennt, nennt man nicht.
 *
 * ## Was gemeldet war
 *
 * Eine PNG von 3,1 MB wurde abgelehnt mit: «Die Datei ist zu gross. Maximal
 * erlaubt: 24 MB.» Drei ist kleiner als vierundzwanzig - die Meldung war aus
 * sich heraus widersprüchlich und schickte die Fehlersuche zu den Dateien,
 * während die Ursache einen Sprung davor lag: ein Reverse Proxy, der den
 * Koerper mit einem rohen `413` abwies, bevor die Anwendung ihn sah.
 *
 * Die Oberflaeche erkannte den Status richtig und setzte dann die Grenze ein,
 * die **sie** kennt. Die ablehnende Schicht hat eine andere, und im `413`
 * steht sie nicht.
 */

const WURZEL = process.cwd();

describe('Meldung fuer eine Antwort, die nicht von der Anwendung kommt', () => {
  it('sagt bei 413, dass es vor der Anwendung geklemmt hat', () => {
    const text = meldungFuerFremdeAntwort(413);
    expect(text).toContain('bevor SwissHub ihn gesehen hat');
  });

  it('erfindet ohne eigene Grenze keine Zahl', () => {
    // Genau der Fehler, der gemeldet war: eine Zahl, die niemand geprueft hat.
    expect(meldungFuerFremdeAntwort(413)).not.toMatch(/\d+\s*MB/u);
  });

  it('nennt die eigene Grenze als Einordnung, nicht als Urteil', () => {
    const text = meldungFuerFremdeAntwort(413, 24);
    expect(text).toContain('24 MB');
    // Nicht «die Datei ist zu gross» - das waere wieder die falsche Aussage.
    expect(text).not.toMatch(/Datei ist zu gross/u);
    expect(text).toContain('die Grenze davor ist kleiner');
  });

  it('zeigt bei jedem anderen Status den Status', () => {
    expect(meldungFuerFremdeAntwort(502)).toContain('502');
    expect(meldungFuerFremdeAntwort(502)).not.toContain('bevor SwissHub');
  });
});

describe('Keine Oberflaeche behauptet mehr eine Grenze, die sie nicht kennt', () => {
  const sammle = (verzeichnis: string, treffer: string[] = []): string[] => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const pfad = join(verzeichnis, eintrag);
      if (statSync(pfad).isDirectory()) {
        sammle(pfad, treffer);
      } else if (pfad.endsWith('.tsx') || pfad.endsWith('.ts')) {
        treffer.push(pfad);
      }
    }
    return treffer;
  };

  it('verbindet nirgends einen 413 mit einer selbst gesetzten Zahl', () => {
    /*
     * Der Status sagt nur «zu gross fuer die Schicht, die geantwortet hat».
     * Wer daneben eine eigene Grenze in MB nennt, behauptet etwas ueber eine
     * fremde Einstellung - und liegt im Zweifel daneben.
     */
    const schuldige: string[] = [];
    for (const pfad of sammle(join(WURZEL, 'apps/web/src'))) {
      const zeilen = readFileSync(pfad, 'utf8').split('\n');
      zeilen.forEach((zeile, i) => {
        if (!/status === 413/u.test(zeile)) {
          return;
        }
        // Der Griff ist der Ausdruck selbst: steht im Umfeld der Pruefung eine
        // MB-Zahl oder ein Urteil ueber die Datei, behauptet die Meldung etwas
        // ueber eine fremde Einstellung.
        const umfeld = zeilen.slice(i, i + 3).join(' ');
        if (/\bMB\b|Maximal erlaubt|zu gross/u.test(umfeld)) {
          schuldige.push(`${pfad.replace(`${WURZEL}/`, '')}:${i + 1}`);
        }
      });
    }
    expect(schuldige).toEqual([]);
  });

  it('nutzt an jeder Upload-Stelle denselben Text', () => {
    const stellen = [
      'apps/web/src/modules/level/xpslot/components/verwaltung.tsx',
      'apps/web/src/modules/socialmedia/components/post-editor.tsx',
      'apps/web/src/modules/jail/components/import-wizard.tsx',
      'apps/web/src/modules/clips/components/einreich-assistent.tsx',
      'apps/web/src/modules/settings/components/branding-form.tsx',
    ];
    for (const stelle of stellen) {
      expect(readFileSync(join(WURZEL, stelle), 'utf8'), stelle).toContain('meldungFuerFremdeAntwort');
    }
  });
});
