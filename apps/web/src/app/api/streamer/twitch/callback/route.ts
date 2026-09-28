import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getActionAuthContext } from '@/server/auth';
import { STATE_COOKIE, rueckwegAdresse } from '../start/route';

/**
 * Der Rueckweg von Twitch - hier entsteht der Beweis.
 *
 * ## Die Kette
 *
 * 1. `state` aus dem Cookie stimmt mit dem aus der Adresse ueberein, und die
 *    Discord-Kennung darin ist die der angemeldeten Person.
 * 2. Der Code wird bei Twitch gegen ein Benutzertoken getauscht.
 * 3. Mit diesem Token wird `/helix/users` gefragt - die Antwort **ist** das
 *    Konto des Anmelders. Ein fremdes Konto ist hier nicht erreichbar.
 * 4. Das Token wird bei Twitch widerrufen und weggeworfen.
 * 5. Nur wenn das zurueckgegebene Konto der eingetragene Kanal ist, wird
 *    `verifikation: OAUTH` gesetzt.
 *
 * Schritt 5 ist der, den man leicht weglaesst: ohne ihn wuerde eine Anmeldung
 * mit **irgendeinem** Twitch-Konto die Bewerbung bestaetigen, und jemand
 * koennte den Kanal eines Fremden eintragen und sich selbst anmelden.
 *
 * ## Warum die Antwort eine Weiterleitung ist
 *
 * Weil hier ein Browser ankommt, der von Twitch geschickt wurde. Er soll auf
 * der Bewerbungsseite landen - mit einer Meldung in der Adresse, nicht mit
 * einem JSON-Objekt auf dem Schirm.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const log = createLogger('streamer:twitch-oauth');

const zurueck = (meldung: string): Response =>
  Response.redirect(
    appUrl(`${systemRoutes.streamerHubBewerbung()}?twitch=${encodeURIComponent(meldung)}`),
    302,
  );

/** Vergleich in konstanter Zeit - der `state` ist ein Geheimnis dieser Sitzung. */
function gleich(links: string, rechts: string): boolean {
  const a = Buffer.from(links);
  const b = Buffer.from(rechts);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(anfrage: Request): Promise<Response> {
  const context = await getActionAuthContext('critical');
  if (!context) {
    return Response.redirect(appUrl('/login'), 302);
  }
  if (!can(context, streamer.STREAMER_PERMISSIONS.apply)) {
    return new Response('Keine Berechtigung.', { status: 403 });
  }

  const adresse = new URL(anfrage.url);
  const lager = await cookies();
  const erwartet = lager.get(STATE_COOKIE)?.value ?? '';
  // Der Zustand ist verbraucht, sobald er gelesen wurde - auch im Fehlerfall.
  lager.delete({ name: STATE_COOKIE, path: '/api/streamer/twitch' });

  /*
   * Twitch schickt bei einer Ablehnung `error=access_denied`. Das ist kein
   * Fehler, sondern eine Entscheidung - und wird als solche gemeldet.
   */
  const abgelehnt = adresse.searchParams.get('error');
  if (abgelehnt) {
    return zurueck(abgelehnt === 'access_denied' ? 'abgebrochen' : `twitch-fehler:${abgelehnt.slice(0, 40)}`);
  }

  const state = adresse.searchParams.get('state') ?? '';
  const code = adresse.searchParams.get('code') ?? '';
  if (erwartet === '' || state === '' || !gleich(erwartet, state)) {
    log.warn('Twitch-Rückweg mit ungültigem state', { discordId: context.user.discordId });
    return zurueck('sitzung-abgelaufen');
  }
  /*
   * Die Kennung im `state` muss die der angemeldeten Person sein. Ohne diese
   * Pruefung wuerde ein Cookie aus einer anderen Sitzung genuegen - und der
   * Kanal landete beim Falschen.
   */
  const [, kennungImState] = state.split('.');
  if (kennungImState !== context.user.discordId) {
    log.warn('Twitch-Rückweg mit fremdem state', { discordId: context.user.discordId });
    return zurueck('sitzung-abgelaufen');
  }
  if (code === '') {
    return zurueck('kein-code');
  }

  const ergebnis = await streamer.loeseCodeEin(code, rueckwegAdresse());
  if (ergebnis.art === 'fehler') {
    log.warn('Twitch-Code liess sich nicht einlösen', { grund: ergebnis.grund });
    return zurueck('twitch-nicht-erreichbar');
  }

  const bestaetigt = await streamer.bestaetigeKanal(
    context.user.discordId,
    'TWITCH',
    ergebnis.wert.kanal.id,
    ergebnis.wert.kanal.login,
  );
  if (!bestaetigt.bestaetigt) {
    return zurueck(`nicht-bestaetigt:${(bestaetigt.grund ?? '').slice(0, 120)}`);
  }
  return zurueck('bestaetigt');
}
