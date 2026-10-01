import { appUrl } from '@swisshub/config';

/**
 * Was Anstoss und Rückweg der Twitch-Prüfung gemeinsam haben.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil eine Route in Next **nur** Route-Handler und bekannte
 * Konfigurationsfelder exportieren darf. Beides stand vorher in `start/route.ts`
 * und wurde von `callback/route.ts` dort importiert - der Typprüfer von
 * `next build` lehnt das ab:
 *
 *     Type error: Route "src/app/api/streamer/twitch/start/route.ts" does not
 *     match the required types of a Next.js Route.
 *       "rueckwegAdresse" is not a valid Route export field.
 *
 * `npx tsc --noEmit` sieht das nicht, weil es eine Regel von Next ist und keine
 * von TypeScript. Der Fehler fiel deshalb erst beim Bauen auf - und dort erst
 * nach dem Übersetzen, also am Ende einer langen Minute.
 *
 * Die beiden Werte gehören ohnehin nicht in eine Route: sie sind die
 * Vereinbarung zwischen zwei Routen.
 */

/** Der Name des Cookies, in dem der `state` liegt. */
export const STATE_COOKIE = 'swisshub_streamer_twitch_state';

/**
 * Die Redirect-URI - abgeleitet, nicht konfiguriert.
 *
 * Twitch verlangt sie beim Autorisieren **und** beim Einlösen zeichengleich,
 * und sie muss in der Developer Console eingetragen sein. Zwei Quellen für
 * dieselbe Adresse wären eine Fehlerquelle, die sich nur mit «invalid redirect
 * uri» meldet - und zwar erst beim Mitglied.
 */
export function rueckwegAdresse(): string {
  return appUrl('/api/streamer/twitch/callback');
}
