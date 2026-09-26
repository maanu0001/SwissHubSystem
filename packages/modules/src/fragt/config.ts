import { z } from 'zod';
import { istBekannteZeitzone } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

/**
 * SwissHub fragt.
 *
 * ## Was das Modul tut
 *
 * Es stellt der Community regelmaessig eine Frage, laesst auf Discord darueber
 * abstimmen, schreibt das Ergebnis fest und macht daraus einen Entwurf fuer
 * Social Media.
 *
 * ## Die Trennung, an der alles haengt
 *
 * **Frage** und **Abstimmung** sind zwei Dinge. Eine Frage steht in der
 * Bibliothek und darf bearbeitet werden; eine Abstimmung ist ein Vorgang in
 * der Vergangenheit und darf es nicht. Wer den Fragetext nachtraeglich
 * umformuliert, aendert damit nicht, was die Leute damals gelesen haben - und
 * eine Grafik, die schon auf Instagram steht, bleibt richtig.
 *
 * ## Warum kein eigenes Abstimmungssystem
 *
 * Es gibt keines zum Erweitern. `jail/vote` zaehlt Stimmen fuer genau eine
 * Sache (soll jemand eingesperrt werden), `clips` stimmt in der WebApp ueber
 * Einreichungen ab, `spielwahl` entscheidet in einer Sitzung ueber Spiele.
 * Keines davon kennt eine Frage mit freien Antwortmoeglichkeiten.
 *
 * Was hier **nicht** neu entsteht: der Discord-Bot, der Scheduler, die
 * Permission Engine, das Audit Log, die Medienverwaltung, der PNG-Renderer
 * (`next/og`, wie bei Wrapped) und der ZIP-Schreiber (`wrapped/zip.ts`).
 */

export const FRAGT_MODULE_ID = 'fragt';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const FRAGT_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen.
 *
 * Feiner geschnitten als bei den meisten Modulen, und mit Absicht: eine Frage
 * zu schreiben ist redaktionelle Arbeit, sie auf Discord zu stellen ist eine
 * Veroeffentlichung an alle, und ein Social-Media-Entwurf verlaesst den Server.
 * Das sind drei verschiedene Vertrauensfragen, und wer nur Fragen vorbereiten
 * soll, soll nicht senden koennen.
 *
 * Kein Bezug auf Rollennamen: wer das darf, entscheidet der Server unter
 * Server → Berechtigungen.
 */
export const FRAGT_PERMISSIONS = {
  view: 'fragt.view',
  questions: 'fragt.questions',
  publish: 'fragt.publish',
  schedule: 'fragt.schedule',
  close: 'fragt.close',
  results: 'fragt.results',
  studio: 'fragt.studio',
  settings: 'fragt.settings',
} as const;

export type FragtPermission = (typeof FRAGT_PERMISSIONS)[keyof typeof FRAGT_PERMISSIONS];

/** Die Auswahlliste liefert Zeichenketten - daraus werden Zahlen. */
const wochentag = z.coerce.number().int().min(1).max(7);
const stunde = z.coerce.number().int().min(0).max(23);
const minute = z.coerce.number().int().min(0).max(59);

export const fragtSettingsSchema = z.object({
  /**
   * Selbsttaetig veroeffentlichen.
   *
   * Vorgabe **aus**. Das Modul schreibt in einen Kanal, den alle lesen; das
   * einzuschalten soll eine Entscheidung sein, die jemand trifft, nachdem er
   * den Kanal und die vorbereiteten Fragen gesehen hat - keine, die er
   * vorfindet.
   */
  autoPublish: z.boolean().default(false),

  /** Wohin die Frage gestellt wird. */
  channelId: z.string().nullable().default(null),

  /**
   * Wohin das Ergebnis gemeldet wird.
   *
   * Leer heisst: in denselben Kanal. Ein Ergebnis dort, wo die Frage stand,
   * ist der Normalfall - wer zwei Kanaele will, kann sie haben.
   */
  resultChannelId: z.string().nullable().default(null),

  /*
   * Wann gefragt wird.
   *
   * Als Wochentag und Uhrzeit, nicht als Datum: der Termin wiederholt sich
   * jede Woche, und ein Datum waere nach sieben Tagen falsch.
   */
  publishDay: wochentag.default(5),
  publishHour: stunde.default(18),
  publishMinute: minute.default(0),

  /**
   * Die Zeitzone, in der «Freitag 18:00» gilt.
   *
   * Konfigurierbar, weil die Aufgabe es verlangt, und geprueft gegen die
   * zentrale Liste: eine unbekannte Zone waere ein Termin, der nie faellig
   * wird, und das faellt erst auf, wenn wochenlang keine Frage kam.
   */
  timezone: z
    .string()
    .refine(istBekannteZeitzone, { message: 'Unbekannte Zeitzone.' })
    .default('Europe/Zurich'),

  /** Wie lange abgestimmt wird, in Stunden. */
  durationHours: z.number().int().min(1).max(336).default(48),

  /**
   * Wer die naechste Frage bestimmt.
   *
   * `manuell`: nur, was jemand ausdruecklich geplant hat.
   * `automatisch`: das System nimmt eine freigegebene Frage aus der Bibliothek.
   */
  selectionMode: z.enum(['manuell', 'automatisch']).default('manuell'),

  /**
   * Zwischenstand oeffentlich sichtbar.
   *
   * Vorgabe **aus**. Ein sichtbarer Zwischenstand beeinflusst, wer danach
   * abstimmt - wer sieht, dass eine Antwort vorne liegt, waehlt sie eher.
   * Administratoren sehen den Stand im Dashboard unabhaengig davon.
   */
  liveResults: z.boolean().default(false),

  /** Das Ergebnis selbsttaetig auf Discord melden. */
  autoPublishResults: z.boolean().default(true),

  /**
   * Wen die Ergebnismeldung erwaehnt.
   *
   * `keine` ist die Vorgabe. `@here` in einem Kanal mit tausend Mitgliedern
   * ist tausend Benachrichtigungen; das soll jemand bewusst waehlen.
   */
  resultMention: z.enum(['keine', 'here', 'rolle']).default('keine'),

  /** Die Rolle, die erwaehnt wird, wenn `resultMention = rolle`. */
  resultMentionRoleId: z.string().nullable().default(null),
});

export type FragtSettings = z.infer<typeof fragtSettingsSchema>;

const WOCHENTAGE = [
  { value: '1', label: 'Montag' },
  { value: '2', label: 'Dienstag' },
  { value: '3', label: 'Mittwoch' },
  { value: '4', label: 'Donnerstag' },
  { value: '5', label: 'Freitag' },
  { value: '6', label: 'Samstag' },
  { value: '7', label: 'Sonntag' },
];

const fragtSettingsFields: SettingsField[] = [
  {
    key: 'channelId',
    type: 'discord-channel',
    label: 'Kanal für die Frage',
    description: 'Hier stellt SwissHub die Frage. Der Bot braucht in diesem Kanal Schreibrechte.',
    channelKinds: ['text'],
    group: 'Discord',
  },
  {
    key: 'resultChannelId',
    type: 'discord-channel',
    label: 'Kanal für das Ergebnis',
    description: 'Leer lassen, um das Ergebnis in denselben Kanal zu melden.',
    channelKinds: ['text'],
    group: 'Discord',
  },
  {
    key: 'autoPublishResults',
    type: 'boolean',
    label: 'Ergebnis automatisch melden',
    description: 'Nach Abstimmungsende erscheint das Ergebnis als eigener Beitrag.',
    group: 'Discord',
  },
  {
    key: 'resultMention',
    type: 'select',
    label: 'Erwähnung bei der Ergebnismeldung',
    description: '@here in einem grossen Kanal sind viele Benachrichtigungen - das soll eine Wahl sein.',
    options: [
      { value: 'keine', label: 'Keine' },
      { value: 'here', label: '@here' },
      { value: 'rolle', label: 'Eine Rolle' },
    ],
    group: 'Discord',
  },
  {
    key: 'resultMentionRoleId',
    type: 'discord-role',
    label: 'Welche Rolle erwähnen',
    description: 'Nur wirksam, wenn oben «Eine Rolle» gewählt ist.',
    group: 'Discord',
  },

  {
    key: 'autoPublish',
    type: 'boolean',
    label: 'Fragen automatisch veröffentlichen',
    description:
      'Zum eingestellten Termin stellt SwissHub selbsttätig eine Frage. Ohne diese Option veröffentlicht das Team von Hand.',
    group: 'Planung',
  },
  {
    key: 'selectionMode',
    type: 'select',
    label: 'Welche Frage',
    description:
      'Manuell: nur, was jemand geplant hat. Automatisch: eine freigegebene Frage aus der Bibliothek, die lange nicht dran war.',
    options: [
      { value: 'manuell', label: 'Manuell geplant' },
      { value: 'automatisch', label: 'Automatisch aus der Bibliothek' },
    ],
    group: 'Planung',
  },
  {
    key: 'publishDay',
    type: 'select',
    label: 'Wochentag',
    options: WOCHENTAGE,
    group: 'Planung',
  },
  { key: 'publishHour', type: 'number', label: 'Stunde', min: 0, max: 23, group: 'Planung' },
  { key: 'publishMinute', type: 'number', label: 'Minute', min: 0, max: 59, group: 'Planung' },
  {
    key: 'timezone',
    type: 'text',
    label: 'Zeitzone',
    description: 'Eine IANA-Zeitzone, etwa Europe/Zurich. Der Termin oben gilt in dieser Zone.',
    placeholder: 'Europe/Zurich',
    maxLength: 64,
    group: 'Planung',
  },
  {
    key: 'durationHours',
    type: 'number',
    label: 'Abstimmungsdauer (Stunden)',
    description: 'Wie lange abgestimmt werden kann. 48 Stunden geben auch dem Wochenende eine Chance.',
    min: 1,
    max: 336,
    group: 'Planung',
  },

  {
    key: 'liveResults',
    type: 'boolean',
    label: 'Zwischenstand öffentlich zeigen',
    description:
      'Aus: die Zahlen erscheinen erst nach Abstimmungsende. Ein sichtbarer Zwischenstand beeinflusst, wer danach abstimmt. Das Dashboard zeigt den Stand unabhängig davon.',
    group: 'Abstimmung',
  },
];

export const fragtModule: ModuleDefinition = registerModule({
  id: FRAGT_MODULE_ID,
  name: 'SwissHub fragt',
  description:
    'Regelmässige Fragen an die Community: Abstimmung auf Discord, festgeschriebene Ergebnisse und daraus fertige Social-Media-Grafiken.',
  icon: 'MessageCircleQuestion',
  permissionPrefix: 'fragt',
  defaultEnabled: false,
  settingsSchema: fragtSettingsSchema,
  settingsFields: fragtSettingsFields,
  permissions: [
    {
      key: FRAGT_PERMISSIONS.view,
      label: 'Modul ansehen',
      description: 'Die Übersicht, die laufende Abstimmung und die Fragenbibliothek sehen.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.questions,
      label: 'Fragen verwalten',
      description: 'Fragen anlegen, bearbeiten, duplizieren und archivieren.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.publish,
      label: 'Fragen veröffentlichen',
      description: 'Eine Frage sofort auf Discord stellen. Das sehen alle im Kanal.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.schedule,
      label: 'Planung verwalten',
      description: 'Termine zuweisen und die automatische Veröffentlichung steuern.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.close,
      label: 'Abstimmung schliessen',
      description: 'Eine laufende Abstimmung vor Ablauf beenden.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.results,
      label: 'Ergebnisse ansehen',
      description: 'Abgeschlossene Abstimmungen mit Zahlen und Beteiligungsstatistik sehen.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.studio,
      label: 'Content Studio verwenden',
      description: 'Social-Media-Entwürfe bearbeiten, exportieren und als veröffentlicht markieren.',
      module: FRAGT_MODULE_ID,
    },
    {
      key: FRAGT_PERMISSIONS.settings,
      label: 'Einstellungen verwalten',
      description: 'Kanäle, Termin, Dauer und Auswahlmodus einstellen.',
      module: FRAGT_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/fragt',
      label: 'SwissHub fragt',
      description: 'Fragen an die Community, Abstimmungen und Social-Media-Content',
      permission: FRAGT_PERMISSIONS.view,
      icon: 'MessageCircleQuestion',
      group: 'modules',
      order: 26,
      altPermissions: [FRAGT_PERMISSIONS.questions, FRAGT_PERMISSIONS.results, FRAGT_PERMISSIONS.studio],
    },
  ],
});
