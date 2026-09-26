import { readdirSync, readFileSync } from 'node:fs';
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

describe('Der Streamer Hub bleibt auf der Bot-Seite der Grenze', () => {
  /*
   * Das Modul, das nach dem Ausfall gebaut wurde - und dessen Kern der Bot
   * laedt: `apps/bot/src/jobs.ts` ruft `streamer.runStreamerTick()`. Was in
   * `packages/modules/src/streamer` steht, laeuft damit in einem Node-Prozess
   * ohne Next.
   *
   * ## Die Gegenprobe zu diesem Test
   *
   * Mit `import 'server-only'` in `packages/modules/src/streamer/live.ts`:
   * `npx tsc -p apps/web/tsconfig.json --noEmit` bleibt still (Rueckgabewert 0,
   * keine Ausgabe), `npm run bot:startup-test` bricht mit Rueckgabewert 1 ab und
   * nennt 26 Bot-Dateien. Nach dem Zuruecknehmen ist der Startup-Test wieder
   * gruen. Genau diese Blindheit des Typecheckers ist der Grund, warum es den
   * Startup-Test gibt.
   */
  const MODULKERN = 'packages/modules/src/streamer';

  it('importiert in keiner Datei des Modulkerns server-only', () => {
    for (const datei of readdirSync(join(process.cwd(), MODULKERN))) {
      const quelle = readFileSync(join(process.cwd(), MODULKERN, datei), 'utf8');
      /*
       * Nur echte Importzeilen. Zwei Dateien **erklaeren** im Kopfkommentar,
       * warum sie kein `server-only` haben - ein Test, der darauf anspringt,
       * verbietet die Erklaerung statt den Fehler.
       */
      expect(quelle, `${datei} importiert server-only`).not.toMatch(/^\s*import\s+['"]server-only['"]/mu);
    }
  });

  it('haelt die Oberflaechenteile ausserhalb des Modulkerns', () => {
    /*
     * Die Spotlight-Grafik, die Server Actions und die Seiten gehoeren in
     * `apps/web` - dort duerfen sie alles, was Next kann. Der Weg, auf dem der
     * Ausfall entstand, war die Gegenrichtung: etwas Next-Spezifisches im
     * gemeinsamen Paket, exportiert ueber den Barrel.
     */
    const barrel = readFileSync(join(process.cwd(), MODULKERN, 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/next\//u);
    expect(barrel).not.toMatch(/apps\/web/u);

    // Und der Bot ruft genau eine Funktion des Moduls - den Durchgang.
    const jobs = readFileSync(join(process.cwd(), 'apps/bot/src/jobs.ts'), 'utf8');
    expect(jobs).toContain('streamer.runStreamerTick');
  });
});
