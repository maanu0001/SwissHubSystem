import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

/**
 * Der Streamer Hub.
 *
 * ## Was das Modul tut
 *
 * Es macht Community-Streamer sichtbar: Mitglieder bewerben sich mit ihren
 * Twitch- und YouTube-Kanaelen, das Team gibt frei, und ab dann erscheinen sie
 * auf einer oeffentlichen Seite, werden bei Livestreams auf Discord
 * angekuendigt und lassen sich als Social-Media-Grafik vorstellen.
 *
 * ## Die Trennung, an der alles haengt
 *
 * Ein Streamer ist **kein eigenes Konto**. `StreamerProfil` haengt an einer
 * `discordId` und erweitert damit ein Mitglied, das es schon gibt. Name,
 * Avatar, Banner, Lieblingsspiele und Social Links stehen in `MemberProfile`
 * und werden von dort gelesen - nicht kopiert.
 *
 * Der Unterschied zaehlt beim ersten Umbenennen: waere der Name hier noch
 * einmal gespeichert, hiesse dieselbe Person auf der Streamer-Seite anders als
 * in ihrem Profil, und niemand wuesste, welcher der beiden Namen gilt.
 *
 * ## Was hier nicht neu entsteht
 *
 * Kein zweiter Discord-Bot, kein zweites Anmeldeverfahren, kein zweiter
 * Spielkatalog, kein zweites Profilsystem, kein eigener Scheduler, keine
 * eigene Geheimnisverwaltung. Die Zugangsdaten von Twitch und YouTube liegen
 * im Integrationskatalog (`packages/secrets/src/catalog.ts`), verschluesselt
 * wie jedes andere Geheimnis auch.
 *
 * ## Was ohne Zugangsdaten passiert
 *
 * Nichts Schlimmes. Ohne Twitch-Zugangsdaten gibt es keine Live-Erkennung und
 * keine Kanalpruefung; Bewerbungen, Freigaben, oeffentliche Seiten und das
 * Content Studio laufen weiter. Das Dashboard sagt, was fehlt - es tut nicht
 * so, als waere alles in Ordnung.
 */

export const STREAMER_MODULE_ID = 'streamer';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const STREAMER_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen.
 *
 * Fein geschnitten, weil hier drei verschiedene Vertrauensfragen
 * zusammenkommen: sich selbst bewerben ist etwas, das jedes Mitglied darf;
 * ueber eine Bewerbung entscheiden ist Moderation; einen Kanal an alle
 * ankuendigen oder eine Grafik erzeugen, die den Server verlaesst, ist
 * Veroeffentlichung.
 *
 * Kein Bezug auf Rollennamen: wer das darf, entscheidet der Server unter
 * Server → Berechtigungen.
 */
export const STREAMER_PERMISSIONS = {
  /** Den Bereich und die Streamerliste sehen. */
  view: 'streamer.view',
  /** Sich selbst bewerben und die eigene Bewerbung pflegen. */
  apply: 'streamer.apply',
  /** Ueber Bewerbungen entscheiden. */
  review: 'streamer.review',
  /** Freigegebene Streamer verwalten, pausieren, Kanaele entfernen. */
  manage: 'streamer.manage',
  /** Live-Ankuendigungen konfigurieren. */
  announce: 'streamer.announce',
  /** Einen Spotlight-Entwurf anlegen und bearbeiten. */
  spotlight: 'streamer.spotlight',
  /** Einen Spotlight auf Discord veroeffentlichen. */
  publish: 'streamer.publish',
  /** Moduleinstellungen. */
  settings: 'streamer.settings',
} as const;

export type StreamerPermission = (typeof STREAMER_PERMISSIONS)[keyof typeof STREAMER_PERMISSIONS];

/**
 * Die Vorlage einer Live-Ankuendigung.
 *
 * Platzhalter, die eingesetzt werden. Bewusst wenige und bewusst benannt: eine
 * Vorlagensprache mit Bedingungen waere ein Programm in einem Textfeld.
 */
export const ANKUENDIGUNG_PLATZHALTER = ['{streamer}', '{titel}', '{spiel}', '{plattform}', '{url}'] as const;

export const ANKUENDIGUNG_VORLAGE = '{streamer} ist jetzt LIVE!';

export const streamerSettingsSchema = z.object({
  // --- Plattformen -----------------------------------------------------------
  /**
   * Twitch abfragen.
   *
   * Getrennt von «Zugangsdaten hinterlegt»: wer die Abfrage kurz stilllegen
   * will, soll dafuer nicht das Client Secret loeschen muessen.
   */
  twitchAktiv: z.boolean().default(false),
  /**
   * Wie oft Twitch gefragt wird.
   *
   * Drei Minuten sind ein Kompromiss: Twitch erlaubt 800 Anfragen je Minute
   * fuer ein App Token, und eine Anfrage deckt 100 Kanaele ab - die Grenze ist
   * also nicht das Problem. Die Frage ist, wie frisch eine Ankuendigung sein
   * soll. Unter einer Minute waere Verschwendung, ueber zehn faellt es auf.
   */
  twitchIntervallMinuten: z.coerce.number().int().min(1).max(60).default(3),

  youtubeAktiv: z.boolean().default(false),
  /**
   * Wie oft YouTube gefragt wird - und warum viel seltener als Twitch.
   *
   * Die YouTube Data API rechnet in Kontingenteinheiten, nicht in Anfragen.
   * Der guenstige Weg kostet 2 Einheiten je Kanal und Durchgang, der genaue
   * 100. Bei 15 Minuten sind das 96 Durchgaenge am Tag: mit dem guenstigen Weg
   * 192 Einheiten je Kanal, mit dem genauen 9 600 - und damit ist das
   * Standardkontingent von 10 000 bei **einem** Kanal erschoepft.
   */
  youtubeIntervallMinuten: z.coerce.number().int().min(5).max(360).default(15),
  /** Das Tageskontingent des Google-Projekts. Vorgabe ist die Standardzuteilung. */
  youtubeKontingent: z.coerce.number().int().min(100).max(10_000_000).default(10_000),
  /**
   * Der genaue, teure Weg.
   *
   * Aus: Erkennung ueber die Uploads-Playlist (2 Einheiten). An: ueber die
   * Suche (100 Einheiten). Die Vorgabe ist der guenstige Weg, weil der teure
   * bei mehr als einem Kanal nicht durch den Tag kommt.
   */
  youtubeGenau: z.boolean().default(false),

  // --- Oeffentliche Seite ----------------------------------------------------
  /**
   * Die oeffentliche Uebersicht unter `/streamer`.
   *
   * Aus: die Seite antwortet mit 404. Die Verwaltung im Dashboard laeuft
   * weiter - so lassen sich Bewerbungen sammeln und freigeben, bevor die Seite
   * an den Start geht.
   */
  oeffentlichAktiv: z.boolean().default(true),
  /** Der Satz oben auf der oeffentlichen Seite. */
  oeffentlichUntertitel: z
    .string()
    .trim()
    .max(200)
    .default('Streamer aus der SwissHub-Community. Schau vorbei, wenn jemand live ist.'),

  // --- Live-Ankuendigungen ---------------------------------------------------
  /**
   * Vorgabe **aus**.
   *
   * Eine Ankuendigung geht an alle im Kanal. Dass sie beim ersten Deployment
   * noch nicht losgeht, ist Absicht: erst Kanal waehlen, dann einschalten.
   */
  ankuendigungAktiv: z.boolean().default(false),
  ankuendigungChannelId: z.string().trim().max(20).default(''),
  ankuendigungVorlage: z.string().trim().max(200).default(ANKUENDIGUNG_VORLAGE),
  /**
   * Ein Text vor dem Embed - etwa eine Rollenerwaehnung.
   *
   * Leer ist die Vorgabe, und `@everyone` beziehungsweise `@here` werden beim
   * Senden entfernt. Nicht aus Vorsicht, sondern aus Erfahrung: eine
   * automatische Ankuendigung, die jeden anpingt, wird nach dem dritten Mal
   * stummgeschaltet - und damit auch die vierte, die jemanden interessiert
   * haette.
   */
  ankuendigungMention: z.string().trim().max(120).default(''),
  /**
   * Wie lange nach einer Ankuendigung derselbe Streamer nicht erneut
   * angekuendigt wird.
   *
   * Nicht gegen doppelte Ankuendigungen derselben Session - dagegen steht die
   * Eindeutigkeit in der Datenbank. Das hier ist gegen den Streamer, der
   * dreimal am Abend neu startet.
   */
  cooldownMinuten: z.coerce.number().int().min(0).max(1440).default(180),
  /**
   * Obergrenze je Tag ueber alle Streamer.
   *
   * Die Bremse fuer den Fall, den niemand vorhersieht: zwanzig Streamer gehen
   * gleichzeitig live, oder eine Plattform meldet Unsinn. Danach schweigt der
   * Job und schreibt es ins Protokoll.
   */
  maxProTag: z.coerce.number().int().min(1).max(200).default(20),

  // --- Spotlight -------------------------------------------------------------
  /** Wohin ein Spotlight auf Discord geht. Leer = nur Grafikexport. */
  spotlightChannelId: z.string().trim().max(20).default(''),
});

export type StreamerSettings = z.infer<typeof streamerSettingsSchema>;

export const STREAMER_SETTINGS_VORGABE: StreamerSettings = streamerSettingsSchema.parse({});

const streamerSettingsFields: SettingsField[] = [
  {
    key: 'twitchAktiv',
    label: 'Twitch abfragen',
    description:
      'Die Live-Erkennung über Twitch. Die Zugangsdaten stehen unter System → Integrationen → Twitch; ohne sie bleibt die Abfrage aus, auch wenn hier «ein» steht.',
    type: 'boolean',
    group: 'Twitch',
  },
  {
    key: 'twitchIntervallMinuten',
    label: 'Abfrage alle',
    description:
      'Eine Anfrage deckt bis zu 100 Kanäle ab - die Zahl der Streamer spielt hier also keine Rolle. Kürzer als eine Minute bringt nichts, länger als zehn fällt auf.',
    type: 'number',
    unit: 'Minuten',
    group: 'Twitch',
  },
  {
    key: 'youtubeAktiv',
    label: 'YouTube abfragen',
    description:
      'Die Live-Erkennung über die YouTube Data API. Sie kostet Tageskontingent - siehe die beiden Felder darunter.',
    type: 'boolean',
    group: 'YouTube',
  },
  {
    key: 'youtubeIntervallMinuten',
    label: 'Abfrage alle',
    description:
      'Deutlich seltener als bei Twitch, und zwar aus einem Grund: YouTube rechnet in Kontingenteinheiten je Kanal, nicht in Anfragen.',
    type: 'number',
    unit: 'Minuten',
    group: 'YouTube',
  },
  {
    key: 'youtubeKontingent',
    label: 'Tageskontingent',
    description:
      'Die Zuteilung des Google-Projekts, Standard 10 000. Ist sie aufgebraucht, hört die Abfrage auf, statt in Fehler zu laufen - der verbrauchte Anteil steht in der Übersicht.',
    type: 'number',
    unit: 'Einheiten',
    group: 'YouTube',
  },
  {
    key: 'youtubeGenau',
    label: 'Genauere Erkennung (teuer)',
    description:
      'Aus: über die Uploads-Playlist, 2 Einheiten je Kanal und Durchgang. An: über die Suche, 100 Einheiten - bei 15 Minuten sind das 9 600 pro Tag und Kanal, also fast das gesamte Standardkontingent.',
    type: 'boolean',
    group: 'YouTube',
  },
  {
    key: 'oeffentlichAktiv',
    label: 'Öffentliche Seite',
    description:
      'Die Übersicht unter /streamer, ohne Anmeldung erreichbar. Aus: die Seite antwortet mit 404, die Verwaltung läuft weiter.',
    type: 'boolean',
    group: 'Öffentliche Seite',
  },
  {
    key: 'oeffentlichUntertitel',
    label: 'Untertitel',
    description: 'Ein Satz unter der Überschrift. Leer lassen entfernt ihn.',
    type: 'text',
    group: 'Öffentliche Seite',
  },
  {
    key: 'ankuendigungAktiv',
    label: 'Live-Ankündigungen',
    description:
      'Eine Nachricht im gewählten Kanal, sobald ein freigegebener Streamer live geht. Höchstens eine je Stream - auch nach einem Bot-Neustart.',
    type: 'boolean',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'ankuendigungChannelId',
    label: 'Kanal',
    description: 'Der Discord-Kanal für Live-Ankündigungen.',
    type: 'discord-channel',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'ankuendigungVorlage',
    label: 'Überschrift',
    description: `Platzhalter: ${ANKUENDIGUNG_PLATZHALTER.join(', ')}. Was nicht bekannt ist, wird weggelassen statt als «unbekannt» hingeschrieben.`,
    type: 'text',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'ankuendigungMention',
    label: 'Erwähnung',
    description:
      'Ein Text vor dem Embed, z.B. eine Rollenerwähnung als <@&ROLLEN-ID>. @everyone und @here werden entfernt - eine Automatik, die jeden anpingt, wird stummgeschaltet.',
    type: 'text',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'cooldownMinuten',
    label: 'Ruhezeit je Streamer',
    description:
      'Nach einer Ankündigung so lange keine weitere für dieselbe Person. Gegen den Streamer, der dreimal am Abend neu startet - gegen doppelte Ankündigungen derselben Session steht eine Bedingung in der Datenbank.',
    type: 'number',
    unit: 'Minuten',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'maxProTag',
    label: 'Höchstens pro Tag',
    description:
      'Über alle Streamer zusammen. Die Bremse für den Fall, den niemand vorhersieht; danach schweigt der Job und schreibt es ins Protokoll.',
    type: 'number',
    group: 'Live-Ankündigungen',
  },
  {
    key: 'spotlightChannelId',
    label: 'Spotlight-Kanal',
    description:
      'Wohin ein Streamer Spotlight auf Discord geht. Leer: Spotlights entstehen nur als Grafik zum Herunterladen.',
    type: 'discord-channel',
    group: 'Content Studio',
  },
];

export const streamerModule: ModuleDefinition = registerModule({
  id: STREAMER_MODULE_ID,
  name: 'Streamer Hub',
  description:
    'Community-Streamer sichtbar machen: Twitch- und YouTube-Kanäle, automatische Live-Ankündigungen und Social-Media-Spotlights.',
  icon: 'Radio',
  permissionPrefix: 'streamer',
  defaultEnabled: false,
  settingsSchema: streamerSettingsSchema,
  settingsFields: streamerSettingsFields,
  permissions: [
    {
      key: STREAMER_PERMISSIONS.view,
      label: 'Streamer Hub ansehen',
      description: 'Die Übersicht und die Liste der freigegebenen Streamer sehen.',
      module: STREAMER_MODULE_ID,
    },
    {
      key: STREAMER_PERMISSIONS.apply,
      label: 'Sich als Streamer bewerben',
      description:
        'Die eigene Bewerbung anlegen und pflegen. Betrifft ausschliesslich das eigene Profil - diese Berechtigung gehört den Mitgliedern.',
      module: STREAMER_MODULE_ID,
    },
    {
      key: STREAMER_PERMISSIONS.review,
      label: 'Bewerbungen prüfen',
      description: 'Über Bewerbungen entscheiden: genehmigen oder mit Begründung ablehnen.',
      module: STREAMER_MODULE_ID,
    },
    {
      key: STREAMER_PERMISSIONS.manage,
      label: 'Streamer verwalten',
      description: 'Freigegebene Streamer pausieren, wieder freischalten und Kanalverbindungen entfernen.',
      module: STREAMER_MODULE_ID,
      critical: true,
    },
    {
      key: STREAMER_PERMISSIONS.announce,
      label: 'Ankündigungen konfigurieren',
      description: 'Kanal, Vorlage, Ruhezeit und Obergrenze der Live-Ankündigungen einstellen.',
      module: STREAMER_MODULE_ID,
    },
    {
      key: STREAMER_PERMISSIONS.spotlight,
      label: 'Spotlight erstellen',
      description: 'Social-Media-Entwürfe anlegen, bearbeiten und als PNG exportieren.',
      module: STREAMER_MODULE_ID,
    },
    {
      key: STREAMER_PERMISSIONS.publish,
      label: 'Spotlight veröffentlichen',
      description: 'Einen Spotlight auf Discord senden. Das sehen alle im Kanal.',
      module: STREAMER_MODULE_ID,
      critical: true,
    },
    {
      key: STREAMER_PERMISSIONS.settings,
      label: 'Einstellungen verwalten',
      description: 'Plattformabfragen, Intervalle, Kontingent und öffentliche Seite einstellen.',
      module: STREAMER_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/streamer-hub',
      label: 'Streamer Hub',
      description: 'Community-Streamer, Live-Ankündigungen und Social-Media-Spotlights',
      permission: STREAMER_PERMISSIONS.view,
      icon: 'Radio',
      group: 'modules',
      order: 27,
      /*
       * Wer sich bewerben darf, aber den Bereich nicht sehen soll, bekommt
       * einen eigenen Weg - direkt auf die eigene Bewerbung. Ohne das stuende
       * «Streamer Hub» in seiner Navigation und fuehrte auf eine 403.
       */
      alternatives: [
        {
          permission: STREAMER_PERMISSIONS.apply,
          href: '/streamer-hub/bewerbung',
          label: 'Streamer werden',
          description: 'Deinen Twitch- oder YouTube-Kanal bei SwissHub eintragen',
          icon: 'Radio',
        },
      ],
      altPermissions: [STREAMER_PERMISSIONS.review, STREAMER_PERMISSIONS.spotlight],
    },
  ],
});
