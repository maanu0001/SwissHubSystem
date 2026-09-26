import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import type { AuthContext } from '@swisshub/auth';
import type { ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Die Bereiche des Streamer Hubs.
 *
 * Serverseitig zusammengesetzt, weil die Liste an Berechtigungen haengt - ein
 * Client, der sie selbst baut, bekaeme sie entweder vollstaendig geschickt
 * (dann steht in seinem HTML, welche Bereiche es gibt) oder muesste sie
 * nachladen.
 *
 * Jede Seite ruft sie, damit von jeder Seite jeder andere Bereich erreichbar
 * ist. Die Seitenleiste fuehrt auf genau einen Eintrag; ohne diese Leiste waere
 * er eine Sackgasse.
 */
export function streamerNavigation(context: AuthContext): ModulNavigationEintrag[] {
  const eintraege: ModulNavigationEintrag[] = [];

  if (can(context, streamer.STREAMER_PERMISSIONS.view)) {
    eintraege.push({
      key: 'uebersicht',
      label: 'Übersicht',
      href: systemRoutes.streamerHub(),
      icon: 'LayoutDashboard',
      hinweis: 'Wer ist live, was ist offen',
    });
    eintraege.push({
      key: 'streamer',
      label: 'Streamer',
      href: systemRoutes.streamerHubStreamer(),
      icon: 'Users',
      hinweis: 'Freigegebene Kanäle',
    });
  }

  if (can(context, streamer.STREAMER_PERMISSIONS.review)) {
    eintraege.push({
      key: 'bewerbungen',
      label: 'Bewerbungen',
      href: systemRoutes.streamerHubBewerbungen(),
      icon: 'UserSearch',
      hinweis: 'Offene Anträge prüfen',
    });
  }

  if (can(context, streamer.STREAMER_PERMISSIONS.announce)) {
    eintraege.push({
      key: 'ankuendigungen',
      label: 'Live-Ankündigungen',
      href: systemRoutes.streamerHubAnkuendigungen(),
      icon: 'Megaphone',
      hinweis: 'Was gesendet wurde',
    });
  }

  if (can(context, streamer.STREAMER_PERMISSIONS.spotlight)) {
    eintraege.push({
      key: 'studio',
      label: 'Content Studio',
      href: systemRoutes.streamerHubStudio(),
      icon: 'Sparkles',
      hinweis: 'Spotlights für Social Media',
    });
  }

  /*
   * Die eigene Bewerbung steht am Ende und nicht am Anfang: fuer ein Mitglied
   * ist sie der einzige Eintrag (die uebrigen sieht es nicht), fuer einen
   * Moderator der seltenste.
   */
  if (can(context, streamer.STREAMER_PERMISSIONS.apply)) {
    eintraege.push({
      key: 'bewerbung',
      label: 'Meine Bewerbung',
      href: systemRoutes.streamerHubBewerbung(),
      icon: 'Radio',
      hinweis: 'Eigene Kanäle eintragen',
    });
  }

  /*
   * Die Einstellungen liegen unter System → Module, wie bei jedem Modul. Ein
   * eigener Eintrag hier waere eine zweite Stelle mit derselben Oberflaeche -
   * und die Modulseite erzeugt sie aus `settingsFields`, also ohne Handarbeit.
   */
  if (can(context, streamer.STREAMER_PERMISSIONS.settings)) {
    eintraege.push({
      key: 'einstellungen',
      label: 'Einstellungen',
      href: '/modules/streamer',
      icon: 'Settings',
      hinweis: 'Plattformen, Intervalle, Ankündigungen',
    });
  }

  return eintraege;
}
