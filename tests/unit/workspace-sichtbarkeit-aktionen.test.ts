import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Jede Server Action mit einer Kennung prueft die Sichtbarkeit.
 *
 * ## Warum ein Test ueber den Quelltext
 *
 * Weil die Luecke hier nicht in einer Zeile steckt, sondern in einer
 * **fehlenden**. Die Sichtbarkeit wird im Modul durchgesetzt, aber nur, wenn
 * sie gerufen wird - und eine Aktion, die in einem halben Jahr dazukommt und
 * die Zeile vergisst, waere eine offene Tuer, die kein Verhaltenstest findet:
 * sie funktioniert ja, nur eben fuer zu viele.
 *
 * Geprueft wird deshalb die Struktur: nimmt eine Aktion eine `taskId` oder
 * `projectId`, muss in ihrem Rumpf `pruefeSichtbarkeit` oder
 * `pruefeProjektzugriff` stehen - letzteres ruft das erste selbst.
 *
 * Ausgenommen sind die beiden Aktionen, die etwas **anlegen**: dort gibt es
 * noch keine Kennung, und die Sichtbarkeit ist Teil der Eingabe.
 */

const QUELLE = readFileSync(join(process.cwd(), 'apps/web/src/modules/workspace/actions.ts'), 'utf8');

/**
 * Aktionen, die kein Ziel haben, weil sie es erst erzeugen.
 *
 * **Nicht** dabei: «Aufgabe erstellen». Sie nimmt eine Projektkennung, und
 * eine Aufgabe in einem Projekt anzulegen, das man nicht sehen darf, waere der
 * bequemste Weg hinein - man schreibt sich selbst eine Aufgabe hinzu und liest
 * danach alles, was daran haengt.
 */
const OHNE_ZIEL = new Set(['workspaceProjektErstellenAction', 'workspaceProjektAusVorlageAction']);

interface Aktion {
  name: string;
  block: string;
}

function aktionen(): Aktion[] {
  const treffer = [...QUELLE.matchAll(/export const (\w+) = defineAction\(\n/gu)];
  return treffer.map((eintrag, index) => {
    const start = eintrag.index ?? 0;
    const ende = index + 1 < treffer.length ? (treffer[index + 1]?.index ?? QUELLE.length) : QUELLE.length;
    return { name: eintrag[1] as string, block: QUELLE.slice(start, ende) };
  });
}

describe('Workspace: die Sichtbarkeit wird in jeder Aktion geprueft', () => {
  it('findet überhaupt Aktionen - sonst prüft dieser Test nichts', () => {
    // Die Gegenprobe gegen einen Test, der durch eine Umbenennung lautlos
    // leer läuft und seitdem alles gutheisst.
    expect(aktionen().length).toBeGreaterThan(20);
  });

  it('prüft in jeder Aktion mit Kennung', () => {
    const fehlend = aktionen()
      .filter((aktion) => !OHNE_ZIEL.has(aktion.name))
      .filter((aktion) => /taskId:|projectId:/u.test(aktion.block))
      .filter(
        (aktion) =>
          !aktion.block.includes('pruefeSichtbarkeit(ctx') &&
          !aktion.block.includes('pruefeProjektzugriff(ctx'),
      )
      .map((aktion) => aktion.name);

    expect(fehlend).toEqual([]);
  });

  it('lässt die Anlege-Aktionen begründet aus', () => {
    /*
     * Eine Ausnahmeliste ohne Begründung im Code wäre eine Einladung, sie zu
     * verlängern. Jede dieser Aktionen sagt im Rumpf, warum sie nichts zu
     * prüfen hat.
     */
    for (const name of OHNE_ZIEL) {
      const aktion = aktionen().find((eintrag) => eintrag.name === name);
      expect(aktion, name).toBeDefined();
      expect(aktion?.block, name).toContain('Keine Sichtbarkeitspruefung');
    }
  });

  it('prüft im Modul und nicht in der Oberfläche', () => {
    // Die Hilfe ruft das Modul - sie entscheidet nicht selbst. Sonst gäbe es
    // zwei Regeln, und die zweite wäre die, die niemand kennt.
    const hilfe = QUELLE.slice(QUELLE.indexOf('async function pruefeSichtbarkeit'));
    expect(hilfe).toContain('workspace.sichereAufgabenSicht');
    expect(hilfe).toContain('workspace.sichereProjektSicht');
  });
});

/**
 * Die Filter werden mit UND verknuepft, nicht gespreizt.
 *
 * `{ ...a, ...b }` ueberschreibt bei Prisma stillschweigend: bringen beide
 * Teile ein `OR` mit, gewinnt das letzte. Genau so ist der Sichtbarkeitsfilter
 * beim ersten Versuch von `nichtArchiviert()` verdraengt worden - und private
 * Aufgaben standen im Board. Beide Teile sahen fuer sich richtig aus.
 */
describe('Workspace: die Filter werden nicht gespreizt', () => {
  const DATEIEN = [
    'packages/modules/src/workspace/projekte.ts',
    'packages/modules/src/workspace/aufgaben.ts',
    'packages/modules/src/workspace/kennzahlen.ts',
    'packages/modules/src/workspace/planung.ts',
  ];

  it('spreizt keinen Sichtfilter in ein where-Objekt', () => {
    for (const pfad of DATEIEN) {
      const text = readFileSync(join(process.cwd(), pfad), 'utf8');
      // `...sicht` und Verwandte: genau das Muster, das den Fehler erzeugt hat.
      expect(text, pfad).not.toMatch(/\.\.\.(sicht|aufgabenSicht|projektSicht)\b/u);
    }
  });

  it('benutzt dafür die gemeinsame Verknüpfung', () => {
    for (const pfad of DATEIEN) {
      const text = readFileSync(join(process.cwd(), pfad), 'utf8');
      expect(text, pfad).toContain('undAlles');
    }
  });
});
