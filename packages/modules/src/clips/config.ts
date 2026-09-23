import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const CLIPS_MODULE_ID = 'clips';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const CLIPS_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen.
 *
 * Bewusst getrennt in «mitmachen» und «verwalten». Ansehen, Einreichen und
 * Abstimmen sind fuer die Gemeinschaft gedacht und lassen sich jeder Rolle
 * geben; Moderation und Verwaltung sind Teamarbeit.
 *
 * Kein Bezug auf Rollennamen: wie die Rolle heisst, die das darf, entscheidet
 * der Server unter Server → Berechtigungen.
 */
export const CLIPS_PERMISSIONS = {
  view: 'clips.view',
  submit: 'clips.submit',
  vote: 'clips.vote',

  moderate: 'clips.moderate',
  manage: 'clips.manage',
  settings: 'clips.settings',
} as const;

export type ClipsPermission = (typeof CLIPS_PERMISSIONS)[keyof typeof CLIPS_PERMISSIONS];

// Die Auswahlliste liefert Zeichenketten -  macht daraus Zahlen,
// statt an der Form der Eingabe zu scheitern.
const wochentag = z.coerce.number().int().min(1).max(7);
const stunde = z.coerce.number().int().min(0).max(23);
const minute = z.coerce.number().int().min(0).max(59);

export const clipsSettingsSchema = z.object({
  /*
   * Wann eine Runde laeuft.
   *
   * Als Wochentag und Uhrzeit, nicht als Datum: die Runde wiederholt sich
   * jede Woche, und ein Datum waere nach sieben Tagen falsch. Gerechnet wird
   * in Zuercher Zeit - «Freitag 20:00» heisst im Sommer wie im Winter 20:00
   * Uhr in Zuerich.
   */
  submissionStartDay: wochentag.default(1),
  submissionStartHour: stunde.default(0),
  submissionStartMinute: minute.default(0),
  submissionEndDay: wochentag.default(5),
  submissionEndHour: stunde.default(20),
  submissionEndMinute: minute.default(0),
  votingEndDay: wochentag.default(7),
  votingEndHour: stunde.default(20),
  votingEndMinute: minute.default(0),

  /** Jede Woche selbsttaetig eine neue Runde eroeffnen. */
  autoCreateWeekly: z.boolean().default(true),

  votesPerMember: z.number().int().min(1).max(20).default(3),
  submissionsPerMember: z.number().int().min(1).max(10).default(1),

  /**
   * Eigene Clips waehlen.
   *
   * Standardmaessig aus. Wer fuer sich selbst stimmen darf, tut es, und dann
   * misst der Wettbewerb nicht mehr, was der Gemeinschaft gefallen hat.
   */
  allowSelfVote: z.boolean().default(false),
  /**
   * Stimmen waehrend des Votings anzeigen.
   *
   * Standardmaessig aus. Sichtbare Zwischenstaende ziehen die Stimmen zum
   * Fuehrenden - wer schon vorn liegt, gewinnt dadurch weiter. Nach dem
   * Abschluss stehen die Zahlen ohnehin.
   */
  showVoteCounts: z.boolean().default(false),
  /** Clips schon waehrend der Einreichungsphase zeigen. */
  showClipsDuringSubmission: z.boolean().default(true),

  announcementChannelId: z.string().nullable().default(null),
  announceStart: z.boolean().default(true),
  announceVoting: z.boolean().default(true),
  announceWinner: z.boolean().default(true),
  /**
   * Jeden freigegebenen Clip einzeln auf Discord stellen.
   *
   * Standardmaessig aus: bei dreissig Einreichungen sind das dreissig
   * Nachrichten in einem Kanal, in dem sonst drei am Tag stehen.
   */
  announceApprovedClips: z.boolean().default(false),
});

export type ClipsSettings = z.infer<typeof clipsSettingsSchema>;

const WOCHENTAGE = [
  { value: '1', label: 'Montag' },
  { value: '2', label: 'Dienstag' },
  { value: '3', label: 'Mittwoch' },
  { value: '4', label: 'Donnerstag' },
  { value: '5', label: 'Freitag' },
  { value: '6', label: 'Samstag' },
  { value: '7', label: 'Sonntag' },
];

const clipsSettingsFields: SettingsField[] = [
  {
    key: 'autoCreateWeekly',
    type: 'boolean',
    label: 'Wöchentliche Runde automatisch eröffnen',
    description: 'Jede Woche entsteht eine neue Runde. Ohne diese Option legt das Team sie selbst an.',
    group: 'Ablauf',
  },
  {
    key: 'submissionStartDay',
    type: 'select',
    label: 'Einreichungen ab',
    description: 'Wochentag, an dem eine neue Runde öffnet.',
    options: WOCHENTAGE,
    group: 'Ablauf',
  },
  {
    key: 'submissionStartHour',
    type: 'number',
    label: 'Einreichungen ab (Stunde)',
    min: 0,
    max: 23,
    group: 'Ablauf',
  },
  {
    key: 'submissionEndDay',
    type: 'select',
    label: 'Einreichungen bis',
    description: 'Danach beginnt das Voting.',
    options: WOCHENTAGE,
    group: 'Ablauf',
  },
  {
    key: 'submissionEndHour',
    type: 'number',
    label: 'Einreichungen bis (Stunde)',
    min: 0,
    max: 23,
    group: 'Ablauf',
  },
  {
    key: 'votingEndDay',
    type: 'select',
    label: 'Voting bis',
    description: 'Danach wird der Gewinner ermittelt.',
    options: WOCHENTAGE,
    group: 'Ablauf',
  },
  { key: 'votingEndHour', type: 'number', label: 'Voting bis (Stunde)', min: 0, max: 23, group: 'Ablauf' },

  {
    key: 'votesPerMember',
    type: 'number',
    label: 'Stimmen pro Mitglied',
    description: 'Wie viele Clips ein Mitglied je Runde wählen darf. Pro Clip zählt höchstens eine Stimme.',
    min: 1,
    max: 20,
    group: 'Abstimmung',
  },
  {
    key: 'submissionsPerMember',
    type: 'number',
    label: 'Einreichungen pro Mitglied',
    min: 1,
    max: 10,
    group: 'Abstimmung',
  },
  {
    key: 'allowSelfVote',
    type: 'boolean',
    label: 'Eigene Clips wählen erlauben',
    description: 'Standardmässig aus - sonst misst der Wettbewerb nicht mehr, was der Community gefällt.',
    group: 'Abstimmung',
  },
  {
    key: 'showVoteCounts',
    type: 'boolean',
    label: 'Stimmen während des Votings anzeigen',
    description:
      'Standardmässig aus. Sichtbare Zwischenstände ziehen die Stimmen zum Führenden. Nach dem Abschluss stehen die Zahlen ohnehin.',
    group: 'Abstimmung',
  },
  {
    key: 'showClipsDuringSubmission',
    type: 'boolean',
    label: 'Clips schon während der Einreichungsphase zeigen',
    group: 'Abstimmung',
  },

  {
    key: 'announcementChannelId',
    type: 'discord-channel',
    channelKinds: ['text'],
    label: 'Ankündigungs-Channel',
    description: 'Wohin Start, Voting und Gewinner gemeldet werden.',
    group: 'Discord',
  },
  { key: 'announceStart', type: 'boolean', label: 'Start der Runde ankündigen', group: 'Discord' },
  { key: 'announceVoting', type: 'boolean', label: 'Beginn des Votings ankündigen', group: 'Discord' },
  { key: 'announceWinner', type: 'boolean', label: 'Gewinner ankündigen', group: 'Discord' },
  {
    key: 'announceApprovedClips',
    type: 'boolean',
    label: 'Jeden freigegebenen Clip posten',
    description:
      'Standardmässig aus: bei dreissig Einreichungen sind das dreissig Nachrichten in einem Kanal, in dem sonst drei am Tag stehen.',
    group: 'Discord',
  },
];

async function clipsHealthChecks(kontext?: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const einstellungen = `/modules/${CLIPS_MODULE_ID}`;

  const kanal = settings.announcementChannelId;
  const braucht = settings.announceStart || settings.announceVoting || settings.announceWinner;

  if (!kanal && braucht) {
    checks.push({
      label: 'Ankündigungen',
      status: 'warning',
      detail:
        'Ankündigungen sind eingeschaltet, aber es ist kein Channel gewählt. Start, Voting und Gewinner werden dadurch nirgends gemeldet.',
      fixHref: einstellungen,
    });
  } else if (kanal && kontext) {
    const gefunden = kontext.channels.find((eintrag) => eintrag.id === kanal);
    checks.push(
      gefunden && !gefunden.deleted
        ? { label: 'Ankündigungen', status: 'ok', detail: `Gehen nach #${gefunden.name}.` }
        : {
            label: 'Ankündigungen',
            status: 'warning',
            detail: 'Der gewählte Channel existiert auf Discord nicht mehr.',
            fixHref: einstellungen,
          },
    );
  }

  /*
   * Ein Ablauf, der nie zum Voting kommt.
   *
   * Steht das Ende der Einreichungen nach dem Ende des Votings, laeuft eine
   * Runde in einen Zustand, aus dem sie nicht herauskommt. Das faellt sonst
   * erst am Sonntagabend auf.
   */
  const einreichEnde = settings.submissionEndDay * 1440 + settings.submissionEndHour * 60;
  const votingEnde = settings.votingEndDay * 1440 + settings.votingEndHour * 60;
  checks.push(
    einreichEnde < votingEnde
      ? { label: 'Ablauf', status: 'ok', detail: 'Einreichungen, dann Voting - in dieser Reihenfolge.' }
      : {
          label: 'Ablauf',
          status: 'error',
          detail:
            'Das Voting endet vor oder gleichzeitig mit den Einreichungen. So kommt eine Runde nie zu einer Abstimmung.',
          fixHref: einstellungen,
        },
  );

  return checks;
}

export const clipsModule: ModuleDefinition = registerModule({
  id: CLIPS_MODULE_ID,
  name: 'Clip of the Week',
  description:
    'Der wöchentliche Clip-Wettbewerb der Community: einreichen, entdecken, abstimmen - mit Gewinner-Ankündigung auf Discord und Hall of Fame.',
  icon: 'Clapperboard',
  permissionPrefix: 'clips',
  defaultEnabled: false,
  settingsSchema: clipsSettingsSchema,
  settingsFields: clipsSettingsFields,
  healthChecks: clipsHealthChecks,
  permissions: [
    {
      key: CLIPS_PERMISSIONS.view,
      label: 'Clips ansehen',
      description: 'Den laufenden Wettbewerb, die freigegebenen Clips und die Hall of Fame sehen.',
      module: CLIPS_MODULE_ID,
    },
    {
      key: CLIPS_PERMISSIONS.submit,
      label: 'Clips einreichen',
      description: 'Einen eigenen Clip ins Rennen schicken.',
      module: CLIPS_MODULE_ID,
    },
    {
      key: CLIPS_PERMISSIONS.vote,
      label: 'Abstimmen',
      description: 'Während der Abstimmungsphase Stimmen vergeben.',
      module: CLIPS_MODULE_ID,
    },
    {
      key: CLIPS_PERMISSIONS.moderate,
      label: 'Einreichungen moderieren',
      description: 'Clips freigeben, ablehnen, aus einer Runde nehmen und Meldungen bearbeiten.',
      module: CLIPS_MODULE_ID,
    },
    {
      key: CLIPS_PERMISSIONS.manage,
      label: 'Runden verwalten',
      description: 'Runden anlegen, Zeiten ändern, abschliessen oder abbrechen.',
      module: CLIPS_MODULE_ID,
    },
    {
      key: CLIPS_PERMISSIONS.settings,
      label: 'Einstellungen verwalten',
      description: 'Ablauf, Stimmen und Ankündigungen des Moduls einstellen.',
      module: CLIPS_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/clips',
      label: 'Clip of the Week',
      description: 'Der wöchentliche Clip-Wettbewerb der Community',
      permission: CLIPS_PERMISSIONS.view,
      icon: 'Clapperboard',
      group: 'modules',
      order: 25,
      altPermissions: [CLIPS_PERMISSIONS.submit, CLIPS_PERMISSIONS.moderate, CLIPS_PERMISSIONS.manage],
    },
  ],
});
