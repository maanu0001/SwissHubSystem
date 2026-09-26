/**
 * Der Bot-Startup-Test.
 *
 * ## Warum es ihn gibt
 *
 * Weil `tsc --noEmit` einen Produktionsausfall nicht verhindert hat.
 *
 * Der Vorfall: drei neue Dateien in `packages/modules` begannen mit
 * `import 'server-only'`. Sie wurden ueber ein Barrel (`export * as backup from
 * './backup'`) Teil von `@swisshub/modules` - und damit Teil dessen, was der
 * Bot laedt. `server-only` wirft in jedem Node-Prozess, der kein Next ist.
 *
 * Die Pipeline war gruen. Typecheck sieht keinen Laufzeitimport, die Tests
 * starten den Bot nicht, und der Build des Bots ist selbst nur ein Typecheck.
 * Aufgefallen ist es, als der Container in einer Neustartschleife haengen
 * blieb.
 *
 * ## Was dieser Test tut
 *
 * Zwei Dinge, und beide muessen gelingen:
 *
 * **1. Jede Datei des Bots einzeln laden.** Ein `import` fuehrt den
 * Modulkopf aus - genau dort steht ein `import 'server-only'`, und genau dort
 * wirft es. Weil die Liste aus dem Verzeichnis kommt und nicht aus einer
 * gepflegten Aufzaehlung, deckt sie auch die Datei ab, die jemand morgen
 * hinzufuegt.
 *
 * **2. Den echten Einstiegspunkt starten.** `apps/bot/src/index.ts` in einem
 * eigenen Prozess. Er darf an den Laufzeitpruefungen scheitern - kein Token,
 * keine Datenbank -, aber er muss **bis dorthin kommen**. Ein Importfehler
 * geschieht davor, und dann gibt es keine einzige Logzeile.
 *
 * ## Was er ausdruecklich nicht tut
 *
 * Keine Verbindung zu Discord. Der Token unten ist eine Attrappe in der Form,
 * die die Validierung erwartet, und `DEV_MOCK_DISCORD` schaltet das Gateway
 * ohnehin auf die Nachbildung. Keine produktive Datenbank: `DATABASE_URL`
 * zeigt auf einen Host, den es nicht gibt - der Bot soll an den Zugangsdaten
 * scheitern, nicht an Daten, die er veraendern koennte.
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('..', import.meta.url));
const BOT_SRC = join(WURZEL, 'apps/bot/src');
const EINSTIEG = join(BOT_SRC, 'index.ts');

/**
 * Wegwerfwerte.
 *
 * In der Form, die die Validierung des Bots verlangt - sonst scheitert er an
 * der Form und nicht an dem, was dieser Test pruefen soll. Keiner davon
 * erreicht einen echten Dienst.
 */
const UMGEBUNG: Record<string, string> = {
  NODE_ENV: 'test',
  DEV_MOCK_DISCORD: 'true',
  DISCORD_BOT_TOKEN: 'MTAwMDAwMDAwMDAwMDAwMDAw.Gsmoke.attrappe-kein-echter-token',
  DISCORD_CLIENT_ID: '100000000000000000',
  DISCORD_CLIENT_SECRET: 'attrappe-kein-echtes-secret',
  DISCORD_GUILD_ID: '100000000000000002',
  AUTH_SECRET: 'startup-test-nur-hierfuer-mindestens-32-zeichen',
  SESSION_SECRET: 'startup-test-nur-hierfuer-mindestens-32-zeichen',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  PAYMENT_PROVIDER: 'mock',
  PAYMENT_API_KEY: 'attrappe',
  PAYMENT_WEBHOOK_SECRET: 'attrappe',
  MUSIC_RUNTIME_KEY: 'attrappe',
  /*
   * Ein Host, den es nicht gibt.
   *
   * Absicht: der Bot soll keine Datenbank finden. Ein Startup-Test, der eine
   * echte Datenbank braucht, prueft irgendwann die Datenbank statt der
   * Importe - und auf einem Rechner ohne PostgreSQL faellt er aus, obwohl er
   * gerade dort am meisten wert waere.
   */
  DATABASE_URL: 'postgresql://startup:test@127.0.0.1:1/startup_test',
};

/** Alle `.ts`-Dateien unter `apps/bot/src`, ausser dem Einstiegspunkt. */
export function botDateien(): string[] {
  const gefunden: string[] = [];
  const gehe = (verzeichnis: string): void => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const pfad = join(verzeichnis, eintrag);
      if (statSync(pfad).isDirectory()) {
        gehe(pfad);
        continue;
      }
      if (eintrag.endsWith('.ts') && !eintrag.endsWith('.d.ts') && pfad !== EINSTIEG) {
        gefunden.push(pfad);
      }
    }
  };
  gehe(BOT_SRC);
  return gefunden.sort();
}

/**
 * Teil 1: jede Datei einzeln laden.
 *
 * Einzeln und nicht gebuendelt, damit die Fehlermeldung sagt, **welche** Datei
 * es war. Bei einem Barrel-Import ueber `@swisshub/modules` waere die Antwort
 * sonst «irgendwo in modules».
 */
export async function pruefeImporte(): Promise<{ datei: string; fehler: string }[]> {
  const probleme: { datei: string; fehler: string }[] = [];
  for (const datei of botDateien()) {
    try {
      await import(datei);
    } catch (fehler) {
      probleme.push({
        datei: relative(WURZEL, datei),
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    }
  }
  return probleme;
}

export interface StartErgebnis {
  /** Hat der Prozess ueberhaupt eine eigene Logzeile erzeugt? */
  erreichteLaufzeit: boolean;
  ausgabe: string;
  code: number | null;
}

/**
 * Teil 2: den echten Einstiegspunkt starten.
 *
 * ## Woran «die Importe haben geklappt» zu erkennen ist
 *
 * An einer Logzeile des Bots. Die Anwendung schreibt ihre erste Zeile, sobald
 * der Modulgraph geladen ist und die Laufzeitpruefungen beginnen. Ein
 * Importfehler geschieht davor - dann steht auf `stdout` nichts und auf
 * `stderr` ein Stacktrace.
 *
 * Deshalb ist das Kriterium nicht «Exit-Code 0» (den gibt es nicht: der Bot
 * scheitert absichtlich an den Attrappen-Zugangsdaten), sondern «hat der Bot
 * etwas von sich gegeben».
 */
export function starteEinstieg(zeitgrenzeMs = 90_000): Promise<StartErgebnis> {
  return new Promise((fertig) => {
    const prozess = spawn(process.execPath, [join(WURZEL, 'node_modules/tsx/dist/cli.mjs'), EINSTIEG], {
      cwd: WURZEL,
      env: { ...process.env, ...UMGEBUNG },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let ausgabe = '';
    const sammle = (stueck: Buffer): void => {
      ausgabe += stueck.toString('utf8');
      /*
       * Sobald eine Logzeile des Bots da ist, ist die Frage beantwortet.
       *
       * Weiterlaufen zu lassen haette keinen Zweck - er wuerde vergeblich eine
       * Datenbank suchen - und der Test soll Sekunden dauern, nicht Minuten.
       */
      if (LAUFZEIT_MARKER.test(ausgabe)) {
        prozess.kill('SIGTERM');
      }
    };
    prozess.stdout.on('data', sammle);
    prozess.stderr.on('data', sammle);

    const wecker = setTimeout(() => prozess.kill('SIGKILL'), zeitgrenzeMs);

    prozess.on('close', (code) => {
      clearTimeout(wecker);
      fertig({ erreichteLaufzeit: LAUFZEIT_MARKER.test(ausgabe), ausgabe, code });
    });
  });
}

/**
 * Eine Logzeile der Anwendung.
 *
 * Das Format der Logger: `LEVEL [bereich] Meldung`. Gesucht wird ein Bereich
 * in eckigen Klammern - der entsteht erst, wenn `createLogger` lief, und das
 * heisst: die Module sind geladen.
 */
const LAUFZEIT_MARKER = /\[(bot|secrets:startup|database|config|discord)[^\]]*\]/u;

/** Ein Importfehler, an seinen ueblichen Formen erkannt. */
export function istImportfehler(ausgabe: string): boolean {
  return (
    /server-only/u.test(ausgabe) ||
    /ERR_MODULE_NOT_FOUND/u.test(ausgabe) ||
    /Cannot find module/u.test(ausgabe) ||
    /ERR_REQUIRE_ESM/u.test(ausgabe) ||
    /Cannot find package/u.test(ausgabe)
  );
}

/** Als Skript aufgerufen: pruefen und mit einem Code beenden, den CI versteht. */
async function main(): Promise<void> {
  process.stdout.write('Bot-Startup-Test\n');
  process.stdout.write('================\n');

  const dateien = botDateien();
  process.stdout.write(`1. ${dateien.length} Dateien unter apps/bot/src einzeln laden ...\n`);
  const probleme = await pruefeImporte();
  if (probleme.length > 0) {
    process.stderr.write('\nFEHLER: Diese Dateien lassen sich im Node-Prozess nicht laden:\n\n');
    for (const problem of probleme) {
      process.stderr.write(`  ${problem.datei}\n`);
      process.stderr.write(`    ${problem.fehler}\n\n`);
    }
    if (probleme.some((problem) => /server-only/u.test(problem.fehler))) {
      process.stderr.write(
        'Ein `server-only`-Import hat den Bot erreicht - vermutlich ueber ein Barrel in\n' +
          '`packages/modules`. Genau daran ist die Produktion schon einmal gescheitert.\n',
      );
    }
    process.exit(1);
  }
  process.stdout.write('   alle geladen.\n\n');

  process.stdout.write('2. apps/bot/src/index.ts starten ...\n');
  const ergebnis = await starteEinstieg();
  if (istImportfehler(ergebnis.ausgabe)) {
    process.stderr.write('\nFEHLER: Der Einstiegspunkt scheitert an einem Import:\n\n');
    process.stderr.write(`${ergebnis.ausgabe.slice(-4000)}\n`);
    process.exit(1);
  }
  if (!ergebnis.erreichteLaufzeit) {
    process.stderr.write(
      '\nFEHLER: Der Bot hat keine einzige Logzeile erzeugt. Er ist gescheitert,\n' +
        'bevor seine Module geladen waren.\n',
    );
    process.stderr.write(`${ergebnis.ausgabe.slice(-4000) || '(keine Ausgabe)'}\n`);
    process.exit(1);
  }

  process.stdout.write('   Modulgraph geladen, Laufzeitpruefungen erreicht.\n\n');
  process.stdout.write('Bot-Startup-Test bestanden.\n');
}

// Nur ausfuehren, wenn direkt aufgerufen - importiert wird die Datei vom Test.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main();
}
