import { appUrl } from '@swisshub/config';
import { BUTTON_STYLE, type DiscordLinkButton } from '@swisshub/discord';
import { systemRoutes, type SystemRoute } from '@swisshub/shared';

/**
 * Die Brücke zwischen Discord und dem System.
 *
 * Bot und WebApp sollen sich wie ein System anfühlen, und dafür braucht es
 * beides: aus einer Discord-Nachricht ins System und aus dem System zurück in
 * den Kanal. Beide Richtungen bauen ihre Adressen hier.
 *
 * **Ein Deep Link ist Navigation, keine Autorisierung.** Wer den Knopf
 * drückt, landet auf einer Seite, die ihre Berechtigung prüft wie jede
 * andere - ohne Anmeldung auf dem Login, ohne Berechtigung auf der 403. Der
 * Knopf verkürzt den Weg; er öffnet keine Tür.
 */

/** Absolute Adresse einer Seite des Systems. */
export function systemLink(route: SystemRoute): string {
  return appUrl(route);
}

/** Die Beschriftung, unter der das System in Discord erscheint - überall dieselbe. */
export const IM_SYSTEM_OEFFNEN = 'Im System öffnen';

/**
 * Der Knopf unter einer Discord-Nachricht, der ins System führt.
 *
 * Ein Link-Knopf, kein Interaktionsknopf: Discord öffnet die Adresse selbst,
 * der Bot bekommt nichts zurück und muss nichts beantworten. Das ist der
 * ganze Grund, warum dieser Weg nichts kostet und überall dort stehen kann,
 * wo er hilft.
 */
export function imSystemOeffnen(route: SystemRoute, label: string = IM_SYSTEM_OEFFNEN): DiscordLinkButton {
  return { type: 2, style: BUTTON_STYLE.LINK, label, url: systemLink(route) };
}

/** Dieselben Ziele wie in der WebApp - damit der Bot sie nicht selbst zusammensetzt. */
export { systemRoutes };
