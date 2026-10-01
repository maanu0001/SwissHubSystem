import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

/**
 * Serverrollen - die öffentliche Rollenübersicht.
 *
 * ## Was das Modul tut
 *
 * Es beantwortet die Frage, die jeder neue Server stellt: «Was bedeuten diese
 * ganzen Rollen eigentlich?» Auf Discord steht dort nur eine Liste von Namen
 * in Farben; wofür eine Rolle steht, wie man sie bekommt und welche man sich
 * selbst geben darf, weiss nur, wer lange genug dabei ist.
 *
 * ## Woher die Rollen kommen
 *
 * **Von Discord.** Name, Farbe und Kennung stehen in `DiscordRoleCache` und
 * werden von dort gelesen - nicht abgeschrieben. Eine Rolle, die auf Discord
 * umbenannt oder umgefärbt wird, heisst hier sofort anders; eine zweite,
 * gepflegte Farbe wäre genau die, die nach dem ersten Umfärben falsch ist.
 *
 * SwissHub trägt nur bei, was Discord nicht kennt: eine Beschreibung, eine
 * Gruppe, eine Reihenfolge darin und die Freigabe zur Selbstvergabe. Das steht
 * in `ServerRoleMeta`, eine Zeile je Rolle - und nur für Rollen, zu denen
 * jemand etwas eingetragen hat.
 *
 * ## Was hier nicht neu entsteht
 *
 * Keine zweite Rollenverwaltung. `Server → Rollen` zeigt weiterhin die
 * Hierarchie und was der Bot vergeben kann; dieses Modul hängt sich daneben
 * und nutzt dieselbe `getRoleHierarchy`, denselben Rollen-Zwischenspeicher und
 * dasselbe `discord.roles.add/remove`. Es gibt keine eigene Discord-Verbindung
 * und keine eigene Rechteprüfung.
 *
 * ## Die Sicherheitsfrage
 *
 * Selbstvergabe ist bequem und genau deshalb gefährlich. Welche Rolle sich
 * jemand selbst geben darf, entscheidet **nicht** der Haken im Dashboard
 * allein - `pruefeSelbstzuweisung` prüft bei jeder Zuweisung erneut gegen die
 * Discord-Rechte der Rolle, gegen `managed` und gegen die Bot-Hierarchie. Die
 * Begründung steht in `sicherheit.ts`.
 */

export const SERVERROLLEN_MODULE_ID = 'serverrollen';

/**
 * Berechtigungen.
 *
 * Zwei, und die Trennung ist die zwischen «beschreiben» und «freigeben». Wer
 * Beschreibungen und Gruppen pflegt, macht Redaktionsarbeit. Wer eine Rolle
 * zur Selbstvergabe freigibt, entscheidet darüber, wer auf dem Server was
 * bekommen kann - das ist Moderation und deshalb `critical`.
 */
export const SERVERROLLEN_PERMISSIONS = {
  /** Den Bereich im Dashboard sehen. */
  view: 'serverrollen.view',
  /** Gruppen, Beschreibungen und Reihenfolge pflegen. */
  manage: 'serverrollen.manage',
  /** Eine Rolle zur Selbstvergabe freigeben. */
  selfService: 'serverrollen.selfservice.manage',
} as const;

export interface ServerrollenSettings {
  /** Ist `/serverrollen` öffentlich erreichbar? */
  oeffentlichAktiv: boolean;
  /** Der Satz unter der Überschrift der öffentlichen Seite. */
  untertitel: string;
  /** Dürfen sich Mitglieder freigegebene Rollen selbst geben? */
  selbstvergabeAktiv: boolean;
}

export const serverrollenSettingsSchema = z.object({
  oeffentlichAktiv: z.boolean().default(false),
  untertitel: z
    .string()
    .max(200)
    .default('Was die Rollen auf diesem Server bedeuten - und welche du dir selbst geben kannst.'),
  selbstvergabeAktiv: z.boolean().default(true),
});

export const serverrollenSettingsFields: SettingsField[] = [
  {
    key: 'oeffentlichAktiv',
    label: 'Öffentliche Seite',
    type: 'boolean',
    description:
      'Macht /serverrollen ohne Anmeldung erreichbar. Solange sie aus ist, gibt es die Seite nicht - besser als eine Seite, die es gibt und nichts zeigt.',
  },
  {
    key: 'untertitel',
    label: 'Untertitel der öffentlichen Seite',
    type: 'text',
    description: 'Ein Satz unter der Überschrift. Leer lassen, wenn die Überschrift genügt.',
  },
  {
    key: 'selbstvergabeAktiv',
    label: 'Selbstvergabe erlauben',
    type: 'boolean',
    description:
      'Ein Hauptschalter über allen einzelnen Freigaben. Aus heisst: niemand kann sich eine Rolle selbst geben, auch wenn sie freigegeben ist.',
  },
];

export const serverrollenModule: ModuleDefinition = registerModule({
  id: SERVERROLLEN_MODULE_ID,
  name: 'Serverrollen',
  description:
    'Die Rollen des Servers erklären: Gruppen, Beschreibungen und eine öffentliche Seite. Freigegebene Rollen können sich Mitglieder selbst geben.',
  icon: 'Tags',
  permissionPrefix: 'serverrollen',
  defaultEnabled: false,
  settingsSchema: serverrollenSettingsSchema,
  settingsFields: serverrollenSettingsFields,
  /*
   * Der Bereich liegt unter «Server», nicht unter «Module».
   *
   * Serverrollen sind kein Freizeitangebot wie Clip of the Week, sondern
   * Serververwaltung - dieselbe Ecke wie Kanaele und Berechtigungen. Wer
   * Rollen pflegt, sucht sie dort und nicht in der Modulliste.
   */
  navigation: [
    {
      href: '/server/serverrollen',
      label: 'Serverrollen',
      description: 'Rollen erklären, gruppieren und zur Selbstvergabe freigeben',
      permission: SERVERROLLEN_PERMISSIONS.view,
      icon: 'Tags',
      group: 'server',
      order: 32,
    },
  ],
  permissions: [
    {
      key: SERVERROLLEN_PERMISSIONS.view,
      label: 'Serverrollen ansehen',
      description: 'Den Bereich im Dashboard und die gepflegten Beschreibungen sehen.',
      module: SERVERROLLEN_MODULE_ID,
    },
    {
      key: SERVERROLLEN_PERMISSIONS.manage,
      label: 'Serverrollen pflegen',
      description:
        'Gruppen anlegen und sortieren, Beschreibungen schreiben, Rollen zuordnen und auf der öffentlichen Seite ein- oder ausblenden.',
      module: SERVERROLLEN_MODULE_ID,
    },
    {
      key: SERVERROLLEN_PERMISSIONS.selfService,
      label: 'Selbstvergabe freigeben',
      description:
        'Festlegen, welche Rollen sich Mitglieder selbst geben dürfen. Rollen mit kritischen Discord-Rechten bleiben unabhängig davon gesperrt.',
      module: SERVERROLLEN_MODULE_ID,
      critical: true,
    },
  ],
});
