import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

/**
 * Emoji Management.
 *
 * ## Was das Modul löst
 *
 * Emojis sind auf Discord ein Verwaltungsrecht: wer eines hinzufügen darf,
 * darf auch alle löschen. Deshalb hat es praktisch niemand - und deshalb
 * landen Wünsche in irgendeinem Kanal, wo sie liegenbleiben. Die Plätze sind
 * ausserdem begrenzt und knapp, und niemand weiss, wie viele noch frei sind.
 *
 * Dieses Modul macht daraus einen Vorgang: vorschlagen, entscheiden oder
 * abstimmen lassen, hochladen - mit Platzzählung, Namensprüfung und Verlauf.
 * Das Discord-Recht braucht dafür nur der Bot.
 *
 * ## Wo die Grenzen liegen
 *
 * **Bilder werden nicht von beliebigen Adressen geholt.** Der Weg ohne Netz
 * ist der Normalfall: eine Datei hochladen. Wer eine Adresse angibt, kommt nur
 * durch, wenn ihr Host freigegeben ist - und danach noch durch dieselbe
 * SSRF-Prüfung, die die Automation-Webhooks benutzen. Siehe `herkunft.ts`.
 *
 * **SwissHub behauptet nichts über Rechte.** Gespeichert wird, woher die Bytes
 * technisch kamen - hochgeladen, importiert, Discord-Anhang. Ob jemand das
 * Bild verwenden darf, weiss SwissHub nicht und schreibt es deshalb nirgends
 * hin.
 *
 * ## Was nicht neu entsteht
 *
 * Keine zweite Discord-Verbindung: `discord.emojis` ist dem bestehenden
 * Gateway hinzugefügt. Kein eigener Verlauf: der Verlauf ist das zentrale
 * Audit Log, gefiltert auf dieses Modul. Kein eigener Wecker: die ablaufenden
 * Abstimmungen erledigt ein Job im bestehenden, neustartsicheren Scheduler.
 */

export const EMOJI_MODULE_ID = 'emoji';

export const EMOJI_PERMISSIONS = {
  /** Den Bereich und die Vorschläge sehen. */
  view: 'emoji.view',
  /** Emojis selbst hinzufügen, umbenennen, löschen. */
  manage: 'emoji.manage',
  /** Über Vorschläge entscheiden und Abstimmungen starten. */
  moderate: 'emoji.moderate',
  /** Einen Vorschlag einreichen. */
  request: 'emoji.request',
} as const;

export interface EmojiSettings {
  /** Dürfen Mitglieder Vorschläge einreichen? */
  antraegeAktiv: boolean;
  /** Wohin die Moderationsmeldung geht. */
  moderationChannelId: string;
  /** Darf das Team eine Abstimmung starten? */
  abstimmungAktiv: boolean;
  /** Wohin die Abstimmung gepostet wird. */
  abstimmungChannelId: string;
  /** Wie viele Stimmen einen Vorschlag annehmen. */
  stimmenZiel: number;
  /** Wie lange die Abstimmung läuft, in Minuten. */
  abstimmungMinuten: number;
  /** Wie viele offene Vorschläge ein Mitglied gleichzeitig haben darf. */
  maxOffeneJeMitglied: number;
  /**
   * Hosts, von denen ein Bild geholt werden darf - einer je Zeile oder durch
   * Komma getrennt. Leer heisst: gar kein Import, nur Upload.
   */
  erlaubteHosts: string;
  /**
   * Plätze, die frei bleiben sollen.
   *
   * Damit die Community die Plätze nicht bis zum letzten füllt und das Team
   * danach keinen mehr für ein Server-Emoji hat.
   */
  reservePlaetze: number;
}

export const emojiSettingsSchema = z.object({
  antraegeAktiv: z.boolean().default(true),
  moderationChannelId: z.string().default(''),
  abstimmungAktiv: z.boolean().default(false),
  abstimmungChannelId: z.string().default(''),
  /*
   * Zehn Stimmen in zehn Minuten - die Vorgabe, nicht das Gesetz.
   *
   * Beides ist einstellbar, weil beides von der Servergrösse abhängt: zehn
   * Stimmen sind auf einem Server mit dreissig Aktiven viel und auf einem mit
   * dreitausend nichts. Die Grenzen unten verhindern nur den Unsinn - eine
   * Abstimmung mit einer Stimme ist keine.
   */
  stimmenZiel: z.number().int().min(2).max(500).default(10),
  abstimmungMinuten: z.number().int().min(1).max(10_080).default(10),
  maxOffeneJeMitglied: z.number().int().min(1).max(20).default(3),
  erlaubteHosts: z.string().max(2000).default('cdn.discordapp.com, media.discordapp.net'),
  reservePlaetze: z.number().int().min(0).max(100).default(5),
});

export const emojiSettingsFields: SettingsField[] = [
  {
    key: 'antraegeAktiv',
    label: 'Vorschläge erlauben',
    type: 'boolean',
    description:
      'Mitglieder können Emojis vorschlagen. Aus heisst: nur das Team fügt hinzu - der Bereich bleibt, die Vorschlagswege verschwinden.',
  },
  {
    key: 'moderationChannelId',
    label: 'Moderationskanal',
    type: 'discord-channel',
    description:
      'Wohin ein neuer Vorschlag gemeldet wird, mit Annehmen- und Ablehnen-Knopf. Leer lassen, wenn nur im Dashboard entschieden wird.',
  },
  {
    key: 'abstimmungAktiv',
    label: 'Community-Abstimmung erlauben',
    type: 'boolean',
    description:
      'Das Team kann einen Vorschlag der Community vorlegen, statt selbst zu entscheiden. Erreicht er das Stimmenziel im Zeitfenster, wird er angenommen.',
  },
  {
    key: 'abstimmungChannelId',
    label: 'Abstimmungskanal',
    type: 'discord-channel',
    description: 'Wohin die Abstimmung mit dem Stimmknopf gepostet wird.',
  },
  {
    key: 'stimmenZiel',
    label: 'Stimmen zum Annehmen',
    type: 'number',
    description:
      'Wie viele Stimmen einen Vorschlag annehmen. Zehn ist die Vorgabe; auf einem grossen Server ist das wenig.',
  },
  {
    key: 'abstimmungMinuten',
    label: 'Dauer der Abstimmung (Minuten)',
    type: 'number',
    description:
      'Wie lange abgestimmt werden kann. Wird das Ziel nicht erreicht, endet die Abstimmung - der Vorschlag ist damit nicht abgelehnt, nur nicht angenommen.',
  },
  {
    key: 'maxOffeneJeMitglied',
    label: 'Offene Vorschläge je Mitglied',
    type: 'number',
    description:
      'Verhindert, dass eine Person die Liste füllt. Entschiedene Vorschläge zählen nicht mit.',
  },
  {
    key: 'erlaubteHosts',
    label: 'Adressen, von denen importiert werden darf',
    type: 'text',
    description:
      'Nur von diesen Hosts holt SwissHub ein Bild - durch Komma getrennt. Leer heisst: kein Import, nur Datei-Upload. Beliebige Adressen zu laden wäre ein Weg ins interne Netz.',
  },
  {
    key: 'reservePlaetze',
    label: 'Plätze freihalten',
    type: 'number',
    description:
      'So viele Emoji-Plätze bleiben für das Team reserviert. Vorschläge werden abgelehnt, bevor diese Reserve angetastet wird.',
  },
];

export const emojiModule: ModuleDefinition = registerModule({
  id: EMOJI_MODULE_ID,
  name: 'Emojis',
  description:
    'Emojis verwalten, Vorschläge entgegennehmen und über sie entscheiden oder abstimmen lassen - mit Platzzählung und Verlauf.',
  icon: 'Smile',
  permissionPrefix: 'emoji',
  defaultEnabled: false,
  settingsSchema: emojiSettingsSchema,
  settingsFields: emojiSettingsFields,
  navigation: [
    {
      href: '/server/emojis',
      label: 'Emojis',
      description: 'Emojis verwalten, Vorschläge entscheiden, Plätze im Blick behalten',
      permission: EMOJI_PERMISSIONS.view,
      icon: 'Smile',
      group: 'server',
      order: 34,
    },
  ],
  permissions: [
    {
      key: EMOJI_PERMISSIONS.view,
      label: 'Emojis ansehen',
      description: 'Den Bereich, die Vorschläge, die Platzzählung und den Verlauf sehen.',
      module: EMOJI_MODULE_ID,
    },
    {
      key: EMOJI_PERMISSIONS.request,
      label: 'Emoji vorschlagen',
      description: 'Einen Vorschlag einreichen. Entscheidet nichts.',
      module: EMOJI_MODULE_ID,
    },
    {
      key: EMOJI_PERMISSIONS.moderate,
      label: 'Vorschläge entscheiden',
      description:
        'Vorschläge annehmen, ablehnen oder der Community vorlegen. Ein angenommener Vorschlag landet unmittelbar auf dem Server.',
      module: EMOJI_MODULE_ID,
      critical: true,
    },
    {
      key: EMOJI_PERMISSIONS.manage,
      label: 'Emojis verwalten',
      description: 'Emojis selbst hinzufügen, umbenennen und löschen - ohne Vorschlagsweg.',
      module: EMOJI_MODULE_ID,
      critical: true,
    },
  ],
});
