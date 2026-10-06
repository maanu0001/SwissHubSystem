/*
 * Die beiden Dokumentationswerke.
 *
 * Hier stehen Reihenfolge und Gruppierung - nicht die Inhalte. Eine Seite
 * taucht genau einmal auf; welcher Kategorie sie angehoert, entscheidet sich
 * an dieser Stelle und nicht in der Seite selbst. Das macht Umsortieren zu
 * einer Aenderung an einer Datei.
 *
 * Die Reihenfolge der Kategorien ist die Leserichtung: wer oben anfaengt und
 * nach unten liest, kommt vom Ueberblick zum Detail. Deshalb steht
 * «Troubleshooting» am Ende und nicht alphabetisch zwischen Testing und
 * Deployment.
 */
import type { DokuWerk } from './typen';
import * as grundlagen from './inhalt/entwickler/grundlagen';
import * as plattform from './inhalt/entwickler/plattform';
import * as betrieb from './inhalt/entwickler/betrieb';
import * as entwicklerModule from './inhalt/entwickler/module';
import * as teamBasis from './inhalt/team/basis';
import * as teamBereiche from './inhalt/team/bereiche';
import * as teamSystem from './inhalt/team/system';

export const ENTWICKLER_DOKU: DokuWerk = {
  id: 'entwickler',
  titel: 'Entwickler-Dokumentation',
  kurz: 'Wie SwissHub System gebaut ist: Architektur, Datenbank, Permission Engine, Deployment.',
  basis: '/system/docs/entwickler',
  permission: 'system.docs.developer.view',
  kategorien: [
    {
      id: 'grundlagen',
      titel: 'Grundlagen',
      seiten: [grundlagen.architektur, grundlagen.techStack, grundlagen.ablaeufe, grundlagen.webRouting],
    },
    {
      id: 'plattform',
      titel: 'Plattform',
      seiten: [
        plattform.datenbank,
        plattform.permissions,
        plattform.auth,
        plattform.secrets,
        plattform.media,
      ],
    },
    {
      id: 'module',
      titel: 'Module',
      seiten: [
        entwicklerModule.moduleUebersicht,
        entwicklerModule.modulXpSlot,
        entwicklerModule.modulWorkspace,
        entwicklerModule.modulPremium,
        entwicklerModule.modulSocialMedia,
        entwicklerModule.modulServerrollen,
      ],
    },
    {
      id: 'betrieb',
      titel: 'Betrieb',
      seiten: [betrieb.scheduler, betrieb.audit, betrieb.bot, betrieb.botRuntime, betrieb.deployment],
    },
    {
      id: 'arbeiten',
      titel: 'Daran arbeiten',
      seiten: [betrieb.testing, betrieb.neuesFeature, betrieb.troubleshooting],
    },
  ],
};

export const TEAM_DOKU: DokuWerk = {
  id: 'team',
  titel: 'Team-Dokumentation',
  kurz: 'Wie die Module benutzt werden - Schritt fuer Schritt, ohne Code.',
  basis: '/system/docs/team',
  permission: 'system.docs.team.view',
  kategorien: [
    {
      id: 'start',
      titel: 'Zum Anfangen',
      seiten: [teamBasis.ersteSchritte, teamBasis.dashboard],
    },
    {
      id: 'community',
      titel: 'Community',
      seiten: [
        teamBasis.mitglieder,
        teamBereiche.levelSystem,
        teamBereiche.turniere,
        teamSystem.kalender,
        teamBereiche.premium,
        teamBereiche.musik,
      ],
    },
    {
      id: 'betreuung',
      titel: 'Support & Moderation',
      seiten: [teamBereiche.moderation, teamBereiche.tickets],
    },
    {
      id: 'server',
      titel: 'Server',
      seiten: [teamBereiche.serverrollen, teamSystem.berechtigungen],
    },
    {
      id: 'arbeiten',
      titel: 'Arbeiten & Inhalte',
      seiten: [
        teamBereiche.workspace,
        teamBereiche.socialMedia,
        teamBereiche.kommunikation,
        teamBereiche.analytics,
      ],
    },
    {
      id: 'system',
      titel: 'System',
      seiten: [teamSystem.systembereich, teamBereiche.integrationen],
    },
  ],
};

/** Beide Werke, in der Reihenfolge der Navigationseintraege. */
export const WERKE: readonly DokuWerk[] = [ENTWICKLER_DOKU, TEAM_DOKU];

export function werkZu(id: string): DokuWerk | undefined {
  return WERKE.find((werk) => werk.id === id);
}
