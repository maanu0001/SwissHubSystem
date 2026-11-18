/**
 * Der Weg von `onRequestError` zum Fehler-Log - ohne Import.
 *
 * ## Warum es diese Datei gibt
 *
 * `instrumentation.ts` wird von Next.js **für beide Laufzeiten** übersetzt:
 * Node.js und Edge. Die Middleware läuft auf Edge, und dort gibt es kein
 * `fs`, kein `child_process`, kein `node:dns`. Ein
 * `await import('@swisshub/modules')` in `onRequestError` genügt, damit
 * Webpack den ganzen Modulgraphen in das Edge-Bündel zieht - gemessen, nicht
 * vermutet:
 *
 *     Module not found: Can't resolve 'child_process'
 *     Import trace: packages/modules/src/branding/storage.ts
 *                   → modules/index.ts → ./src/instrumentation.ts
 *
 * Eine Prüfung auf `process.env.NEXT_RUNTIME` hilft dagegen nicht. Sie wirkt
 * zur **Laufzeit**; Webpack verfolgt den Import beim **Übersetzen** und sieht
 * die Bedingung nicht.
 *
 * ## Wie es stattdessen geht
 *
 * Die Node-Seite trägt ihren Melder ein, die Laufzeit-Seite fragt ihn ab.
 * `instrumentation.node.ts` läuft ausschliesslich in der Node-Laufzeit - dort
 * ruft `register()` es auf, und es kennt `@swisshub/modules` ohnehin. Damit
 * steht in `instrumentation.ts` kein Import mehr, der nach `fs` führt.
 *
 * ## Warum auf `globalThis` und nicht als Modulvariable
 *
 * Weil beide Seiten dieselbe Variable sehen müssen, und wer mit wem in einem
 * Bündel landet, entscheidet Next.js. Eine Modulvariable wäre in zwei
 * Bündeln zwei Variablen - der Melder stünde eingetragen auf der einen Seite
 * und leer auf der anderen, und zwar lautlos: ein fehlendes Log sieht aus wie
 * ein Fehler, der nicht passiert ist. Auf `globalThis` gibt es sie genau
 * einmal je Prozess.
 */

export interface WebAppFehlerMeldung {
  /** Der Routenpfad - `/u/[slug]`, nicht `/u/manu`. Siehe `instrumentation.ts`. */
  origin: string;
  fehler: unknown;
  kontext?: Record<string, unknown>;
}

type Melder = (meldung: WebAppFehlerMeldung) => Promise<void>;

const SCHLUESSEL = Symbol.for('swisshub.fehlerMelder');

type Traeger = typeof globalThis & { [SCHLUESSEL]?: Melder };

/**
 * Den Melder eintragen - einmal beim Serverstart, aus der Node-Laufzeit.
 */
export function setzeFehlerMelder(melder: Melder): void {
  (globalThis as Traeger)[SCHLUESSEL] = melder;
}

/**
 * Den eingetragenen Melder holen - oder `null`.
 *
 * `null` heisst: Edge-Laufzeit, oder der Serverstart ist noch nicht so weit
 * gekommen. Beides ist kein Fehler, sondern ein Grund, nichts zu tun - der
 * Fehler selbst steht ohnehin im Serverprotokoll.
 */
export function fehlerMelder(): Melder | null {
  return (globalThis as Traeger)[SCHLUESSEL] ?? null;
}
