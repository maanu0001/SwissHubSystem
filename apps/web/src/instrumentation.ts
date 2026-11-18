import { fehlerMelder } from './fehler-melder';

/**
 * Wird von Next.js einmalig beim Serverstart ausgeführt.
 *
 * Die eigentliche Startlogik liegt in `instrumentation.node.ts` und wird nur
 * in der Node.js-Laufzeit geladen - die Edge-Runtime (Middleware) darf weder
 * Datenbank noch Node-Krypto einbinden.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}

/**
 * Jeder serverseitige Fehler der WebApp - an einer Stelle.
 *
 * ## Warum hier und nicht in jedem `catch`
 *
 * Weil Next.js diesen Haken für **alles** aufruft, was auf dem Server
 * geworfen und nicht gefangen wird: eine Server Component, ein Route
 * Handler, ein Middleware-Lauf, eine Server Action, die niemand abgefangen
 * hat. Ein `meldeFehler` in jeden `catch`-Block zu schreiben hiesse, beim
 * nächsten neuen Pfad daran zu denken - und ein fehlendes Log sieht aus wie
 * ein Fehler, der nicht passiert ist.
 *
 * Was hier **nicht** ankommt, sind die Fehler aus `defineAction`: die Datei
 * fängt sie und antwortet dem Browser mit einem Ergebnis, statt sie zu
 * werfen. Sie melden selbst - siehe `server/action.ts`.
 *
 * ## Warum der Melder nicht importiert wird
 *
 * Diese Datei wird für beide Laufzeiten übersetzt, Edge eingeschlossen. Ein
 * Import von `@swisshub/modules` hier zieht `fs` und `child_process` in das
 * Edge-Bündel und bricht den Build - gemessen. Die ganze Begründung und der
 * Ausweg stehen in `fehler-melder.ts`.
 *
 * ## Warum alles gefangen wird
 *
 * Ein Fehler beim Melden eines Fehlers darf die Antwort nicht beeinflussen.
 * Next.js ruft diesen Haken bereits auf dem Weg zur Fehlerseite auf; eine
 * Ausnahme von hier würde diesen Weg abbrechen.
 */
export async function onRequestError(
  fehler: unknown,
  anfrage: { path?: string; method?: string },
  zusammenhang: { routeType?: string; routePath?: string; renderSource?: string },
): Promise<void> {
  const melde = fehlerMelder();
  if (!melde) {
    return;
  }
  try {
    await melde({
      /*
       * Der Routenpfad und nicht die Adresse der Anfrage.
       *
       * `/u/[slug]` fasst alle Profile zu einem Ort zusammen; `/u/manu` wäre
       * je Mitglied ein eigener Fehler - und damit je Mitglied eine eigene
       * Meldung für denselben Bug.
       */
      origin: zusammenhang.routePath ?? anfrage.path ?? 'unbekannt',
      fehler,
      kontext: {
        methode: anfrage.method ?? null,
        art: zusammenhang.routeType ?? null,
        herkunft: zusammenhang.renderSource ?? null,
      },
    });
  } catch {
    // Siehe oben: hier endet es. `meldeFehler` protokolliert selbst.
  }
}
