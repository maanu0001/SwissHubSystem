import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';
import { STATE_COOKIE, rueckwegAdresse } from '../oauth-rueckweg';

/**
 * Der Anstoss der Kanalpruefung: weiter zu Twitch.
 *
 * ## Was diese Route beweist - und was nicht
 *
 * Sie beweist nichts. Sie schickt jemanden zu Twitch. Der Beweis entsteht erst
 * im Rueckweg, weil dort **Twitch** sagt, wem das Konto gehoert.
 *
 * ## Warum ein `state` in einem Cookie
 *
 * Ohne ihn koennte jemand einem Mitglied einen Link auf den Rueckweg schicken,
 * der einen Code aus **seiner** eigenen Twitch-Anmeldung traegt - und damit
 * seinen Kanal an dessen Bewerbung haengen. Das ist CSRF, nur mit einem
 * fremden Konto am Ende.
 *
 * Der Wert ist Zufall, steht httpOnly im Cookie und wird im Rueckweg
 * verglichen. Zusaetzlich steht die Discord-Kennung darin: ein Cookie aus
 * einer anderen Sitzung passt damit nicht, selbst wenn jemand beide haette.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/*
 * `STATE_COOKIE` und `rueckwegAdresse` liegen in `../oauth-rueckweg`.
 *
 * Eine Route darf nur Handler und bekannte Konfigurationsfelder exportieren -
 * `next build` lehnt alles andere ab. Die beiden Werte sind ausserdem die
 * Vereinbarung zwischen dieser Route und dem Rueckweg und gehoeren damit keiner
 * von beiden allein.
 */

export async function GET(): Promise<Response> {
  const context = await getActionAuthContext('critical');
  if (!context) {
    return Response.redirect(appUrl('/login'), 302);
  }
  /*
   * Dieselbe Berechtigung wie das Formular. Eine Route, die nur «angemeldet»
   * prueft, waere die Luecke neben der Aktion, die richtig prueft.
   */
  if (!can(context, streamer.STREAMER_PERMISSIONS.apply)) {
    return new Response('Keine Berechtigung.', { status: 403 });
  }
  await enforceRateLimit('streamerVerify', context.user.discordId);

  const zugang = await streamer.twitchZugang();
  if (!zugang) {
    return Response.redirect(appUrl(`${systemRoutes.streamerHubBewerbung()}?twitch=nicht-eingerichtet`), 302);
  }

  const zufall = randomBytes(24).toString('base64url');
  const state = `${zufall}.${context.user.discordId}`;

  const lager = await cookies();
  lager.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl().startsWith('https://'),
    path: '/api/streamer/twitch',
    // Zehn Minuten. Wer laenger braucht, faengt neu an - ein Zustand, der
    // stundenlang gilt, ist ein Zustand, den jemand liegenlassen kann.
    maxAge: 600,
  });

  return Response.redirect(streamer.autorisierungsAdresse(zugang.clientId, rueckwegAdresse(), state), 302);
}
