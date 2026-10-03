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

const KNOPF = ohneKommentare(
  readFileSync(join(process.cwd(), 'apps/web/src/modules/serverrollen/components/rollen-knopf.tsx'), 'utf8'),
);

/**
 * Die Rückfrage vor einem Tausch.
 *
 * In einer Gruppe, aus der nur eine Rolle gleichzeitig gilt, nimmt ein Klick
 * etwas weg. Das muss vorher dastehen - ein Dialog und kein Hinweistext
 * danach. Durchgesetzt wird die Einschränkung im Dienst; hier festgehalten ist
 * nur, dass die Seite nicht stumm tauscht.
 */
describe('Serverrollen: der Tausch wird angekündigt', () => {
  it('fragt, ehe eine andere Rolle abgegeben wird', () => {
    expect(KNOPF).toContain('ConfirmationDialog');
    // Die Rückfrage hängt daran, dass tatsächlich etwas wegfällt - nicht an
    // der Gruppe allein. Wer noch keine Rolle aus ihr hat, verliert nichts.
    expect(KNOPF).toContain('weichenFuer.length > 0');
  });

  it('nennt im Dialog die Rolle, die wegfällt', () => {
    // «Eine andere Rolle» wäre keine Antwort auf «welche?».
    expect(KNOPF).toMatch(/weichenFuer\[0\]|weichenFuer\.join/u);
  });

  it('beschriftet den Knopf als Tausch und nicht als Nehmen', () => {
    expect(KNOPF).toContain("tauscht ? 'Tauschen' : 'Nehmen'");
  });

  it('übergibt der Seite nur die Rollen derselben Gruppe', () => {
    /*
     * Die Liste entsteht aus `gruppe.rollen` und nicht aus allen Rollen der
     * Seite: exklusiv heisst «eine aus dieser Gruppe», nicht «eine überhaupt».
     */
    expect(RUMPF).toContain('weichenFuer={');
    expect(RUMPF).toContain('gruppe.exklusiv');
    expect(RUMPF).toMatch(/gruppe\.rollen[\s\S]{0,400}meine\.has/u);
  });

  it('zeigt die Einschränkung an der Gruppe', () => {
    // Zwanzig gleiche Hinweise unter zwanzig Rollen wären Rauschen.
    expect(RUMPF).toContain('nur eine');
  });
});
