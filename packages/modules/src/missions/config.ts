import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const MISSIONS_MODULE_ID = 'missions';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const MISSIONS_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen.
 *
 * Getrennt in «mitmachen» und «verwalten», wie bei Clip of the Week:
 * Missionen ansehen ist fuer die Gemeinschaft, Missionen anlegen ist
 * Teamarbeit. Keine Rollennamen im Code - wer was darf, entscheidet der
 * Server unter Server → Berechtigungen.
 */
export const MISSIONS_PERMISSIONS = {
  view: 'missions.view',
  manage: 'missions.manage',
  settings: 'missions.settings',
} as const;

export type MissionsPermission = (typeof MISSIONS_PERMISSIONS)[keyof typeof MISSIONS_PERMISSIONS];

const wochentag = z.coerce.number().int().min(1).max(7);
const stunde = z.coerce.number().int().min(0).max(23);

export const missionsSettingsSchema = z.object({
  /**
   * Wann eine Missionswoche beginnt.
   *
   * Als Wochentag und Stunde, nicht als Datum: die Woche wiederholt sich,
   * und ein Datum waere nach sieben Tagen falsch. Gerechnet wird in
   * Zuercher Zeit - «Montag 00:00» heisst im Sommer wie im Winter 00:00 in
   * Zuerich, und die Sommerzeitumstellung verschiebt keine Mission.
   */
  wochenstartTag: wochentag.default(1),
  wochenstartStunde: stunde.default(0),

  announcementChannelId: z.string().nullable().default(null),
  /** Wenn eine Mission beginnt. Eine Nachricht, nicht eine pro Mitglied. */
  announceStart: z.boolean().default(true),
  /** Wenn eine Mission endet - mit dem Ergebnis. */
  announceAbschluss: z.boolean().default(true),
});

export type MissionsSettings = z.infer<typeof missionsSettingsSchema>;

const WOCHENTAGE = [
  { value: '1', label: 'Montag' },
  { value: '2', label: 'Dienstag' },
  { value: '3', label: 'Mittwoch' },
  { value: '4', label: 'Donnerstag' },
  { value: '5', label: 'Freitag' },
  { value: '6', label: 'Samstag' },
  { value: '7', label: 'Sonntag' },
];

const missionsSettingsFields: SettingsField[] = [
  {
    key: 'wochenstartTag',
    type: 'select',
    label: 'Missionswoche beginnt am',
    description: 'Eine neue Wochenmission aus einer Vorlage startet an diesem Tag.',
    options: WOCHENTAGE,
    group: 'Ablauf',
  },
  {
    key: 'wochenstartStunde',
    type: 'number',
    label: 'Missionswoche beginnt um (Stunde)',
    description: 'Zürcher Zeit. Die Sommerzeitumstellung verschiebt keine Mission.',
    min: 0,
    max: 23,
    group: 'Ablauf',
  },
  {
    key: 'announcementChannelId',
    type: 'discord-channel',
    channelKinds: ['text'],
    label: 'Ankündigungs-Channel',
    description: 'Wohin Start und Ergebnis einer Mission gemeldet werden.',
    group: 'Discord',
  },
  {
    key: 'announceStart',
    type: 'boolean',
    label: 'Start einer Mission ankündigen',
    description: 'Eine Nachricht je Mission - kein Fortschritt einzelner Mitglieder.',
    group: 'Discord',
  },
  {
    key: 'announceAbschluss',
    type: 'boolean',
    label: 'Ergebnis einer Mission ankündigen',
    description: 'Wenn eine Mission endet: wie viele es geschafft haben.',
    group: 'Discord',
  },
];

async function missionsHealthChecks(kontext?: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { getModuleSettings } = await import('../module-state');
  const { prisma } = await import('@swisshub/database');
  const settings = await getModuleSettings<MissionsSettings>(MISSIONS_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];
  const einstellungen = `/modules/${MISSIONS_MODULE_ID}`;

  const kanal = settings.announcementChannelId;
  const braucht = settings.announceStart || settings.announceAbschluss;
  if (!kanal && braucht) {
    checks.push({
      label: 'Ankündigungen',
      status: 'warning',
      detail:
        'Ankündigungen sind eingeschaltet, aber es ist kein Channel gewählt. Es wird nirgends etwas gemeldet.',
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
   * Ein Modul ohne Vorlagen ist ein leeres Modul.
   *
   * Nicht als Fehler: es ist am ersten Tag richtig so. Aber es ist die
   * Auskunft, die jemand braucht, der sich fragt, warum nichts passiert.
   */
  const vorlagen = await prisma.missionVorlage.count({ where: { aktiv: true } });
  checks.push(
    vorlagen > 0
      ? { label: 'Vorlagen', status: 'ok', detail: `${vorlagen} Vorlagen stehen bereit.` }
      : {
          label: 'Vorlagen',
          status: 'warning',
          detail: 'Es gibt noch keine Vorlage. Ohne Vorlage muss jede Mission von Hand angelegt werden.',
          fixHref: '/missionen/vorlagen',
        },
  );

  return checks;
}

export const missionsModule: ModuleDefinition = registerModule({
  id: MISSIONS_MODULE_ID,
  name: 'Community Missions',
  description:
    'Wochenmissionen und Community Challenges: gemeinsame Ziele, die aus dem entstehen, was auf dem Server ohnehin passiert.',
  icon: 'Target',
  permissionPrefix: 'missions',
  defaultEnabled: false,
  settingsSchema: missionsSettingsSchema,
  settingsFields: missionsSettingsFields,
  healthChecks: missionsHealthChecks,
  permissions: [
    {
      key: MISSIONS_PERMISSIONS.view,
      label: 'Missionen ansehen',
      description: 'Die laufenden Missionen, den eigenen Fortschritt und die Community Challenge sehen.',
      module: MISSIONS_MODULE_ID,
    },
    {
      key: MISSIONS_PERMISSIONS.manage,
      label: 'Missionen verwalten',
      description: 'Missionen und Vorlagen anlegen, ändern, abbrechen.',
      module: MISSIONS_MODULE_ID,
    },
    {
      key: MISSIONS_PERMISSIONS.settings,
      label: 'Einstellungen verwalten',
      description: 'Wochenbeginn und Ankündigungen des Moduls einstellen.',
      module: MISSIONS_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/missionen',
      label: 'Community Missions',
      description: 'Wochenmissionen und Community Challenges',
      permission: MISSIONS_PERMISSIONS.view,
      icon: 'Target',
      group: 'modules',
      order: 26,
      altPermissions: [MISSIONS_PERMISSIONS.manage],
    },
  ],
});
