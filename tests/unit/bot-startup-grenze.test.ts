import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botDateien, istImportfehler, pruefeImporte } from '../../scripts/bot-startup-test';

/**
 * Die Grenze zwischen WebApp und Bot.
 *
 * ## Woher das kommt
 *
 * Aus einem Produktionsausfall. Drei neue Dateien in `packages/modules`
 * begannen mit `import 'server-only'`. Sie wurden ueber ein Barrel
 * (`export * as backup from './backup'`) Teil von `@swisshub/modules` - und
 * damit Teil dessen, was der Bot laedt. `server-only` wirft in jedem
 * Node-Prozess, der kein Next ist; der Container haengte in einer
 * Neustartschleife.
 *
 * Die Pipeline war dabei gruen. `tsc --noEmit` sieht keinen Laufzeitimport,
 * die Tests starteten den Bot nicht, und der Bot-Build ist selbst nur ein
 * Typecheck.
 *
 * ## Was hier geprueft wird
 *
 * Der Importteil des Startup-Tests, als gewoehnlicher Test - damit `npm test`
 * ihn mitnimmt und nicht erst der eigene CI-Schritt. Der zweite Teil (den
 * echten Einstiegspunkt starten) laeuft nur dort: er braucht einen eigenen
 * Prozess und eine Minute, und beides gehoert nicht in eine Testdatei, die
 * hundertmal am Tag laeuft.
 */
describe('Die Module des Bots laden in einem Node-Prozess', () => {
  it('findet ueberhaupt Dateien', () => {
    /*
     * Ohne diese Pruefung waere ein umbenanntes Verzeichnis ein Test, der
     * nichts mehr prueft und trotzdem gruen ist - die gefaehrlichste Sorte.
     */
    expect(botDateien().length).toBeGreaterThan(10);
  });

  it('laedt jede Datei unter apps/bot/src ohne Fehler', async () => {
    const probleme = await pruefeImporte();
    expect(
      probleme,
      probleme.length > 0
        ? `Diese Dateien lassen sich nicht laden:\n${probleme
            .map((problem) => `  ${problem.datei}: ${problem.fehler}`)
            .join('\n')}`
        : '',
    ).toEqual([]);
  }, 120_000); // Der erste Import zieht den ganzen Modulgraph nach - das dauert.

  it('erkennt einen server-only-Import als Importfehler', () => {
    // Die Meldung, die `server-only` wirft. Ohne diesen Test waere die
    // Erkennung eine Behauptung.
    expect(
      istImportfehler(
        'Error: This module cannot be imported from a Client Component module. It should only be used from a Server Component.\n    at Object.<anonymous> (/app/node_modules/server-only/index.js:1:7)',
      ),
    ).toBe(true);
    expect(istImportfehler('ERR_MODULE_NOT_FOUND')).toBe(true);
    expect(istImportfehler("Cannot find module '@swisshub/nichts'")).toBe(true);
    // Eine gewoehnliche Laufzeitmeldung ist kein Importfehler - sonst wuerde
    // der Test bei jedem fehlenden Token rot.
    expect(istImportfehler('ERROR [bot] Pflichtangaben fehlen (Discord: Bot Token)')).toBe(false);
  });
});

describe('Die Pipeline laesst ohne diesen Test nicht ausrollen', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

  it('fuehrt den Startup-Test im validate-Job aus', () => {
    expect(workflow).toContain('npm run bot:startup-test');
  });

  it('haengt den Deploy an validate', () => {
    /*
     * Der Test nuetzt nur, wenn sein Fehlschlag das Ausrollen verhindert.
     * `needs: validate` ist die Zeile, an der das haengt - faellt sie weg,
     * liefe der Deploy trotz rotem Startup-Test.
     */
    expect(workflow).toMatch(/needs: validate/u);
  });

  it('steht vor dem Build - ein Importfehler soll nicht erst danach auffallen', () => {
    const startupPos = workflow.indexOf('npm run bot:startup-test');
    const buildPos = workflow.indexOf('Production build');
    expect(startupPos).toBeGreaterThan(0);
    expect(buildPos).toBeGreaterThan(0);
    expect(startupPos).toBeLessThan(buildPos);
  });
});
