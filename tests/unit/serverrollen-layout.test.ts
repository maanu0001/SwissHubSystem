import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Das Desktop-Layout der öffentlichen Rollenseite.
 *
 * ## Warum ein Test über Klassennamen
 *
 * Ein Layout lässt sich in einem Node-Test nicht ansehen. Festnagelbar ist
 * aber die Ursache: `lg:grid-cols-2` auf dem Container der Kategorien. Weil
 * jede Kategorie-Card so hoch ist wie ihre Rollenliste, verrutschen zwei
 * Spalten gegeneinander - das war die Meldung «versetzte Cards». Der Test
 * verhindert, dass die Mehrspaltigkeit beim nächsten Umbau zurückkommt, und
 * er sagt im Fehlerfall warum.
 */

const SEITE = readFileSync(join(process.cwd(), 'apps/web/src/app/serverrollen/page.tsx'), 'utf8');

/** Der Rumpf ohne Kommentare - sonst zählt die Begründung als Treffer. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const RUMPF = ohneKommentare(SEITE);

describe('Serverrollen: eine vertikale Liste', () => {
  it('stellt die Kategorien nicht nebeneinander', () => {
    expect(RUMPF).not.toMatch(/grid-cols-2/u);
    expect(RUMPF).not.toMatch(/(sm|md|lg|xl):grid-cols-/u);
  });

  it('stapelt die Kategorien untereinander', () => {
    expect(RUMPF).toContain('space-y-5');
  });

  it('lässt die Cards ihre natürliche Höhe behalten', () => {
    /*
     * `h-fit` war die Gegenmassnahme gegen gleich hohe Zellen im Grid. Ohne
     * Grid gibt es keine Zellen - die Klasse wäre ein Rest, der erklären
     * müsste, warum sie noch da ist.
     */
    expect(RUMPF).not.toContain('h-fit');
  });

  it('ordnet die Rollen innerhalb einer Kategorie vertikal', () => {
    // Die Rollen standen schon vorher untereinander. Hier festgehalten,
    // damit ein spaeterer «dichterer» Umbau nicht daraus ein Raster macht.
    expect(RUMPF).toContain('<CardContent className="space-y-3">');
  });
});
