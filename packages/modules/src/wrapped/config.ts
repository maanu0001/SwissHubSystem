import { z } from 'zod';
import { systemRoutes } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { ModuleHealthCheck } from '../health/types';
import type { SettingsField } from '../settings/fields';

/**
 * SwissHub Wrapped als Modul.
 *
 * Es registriert sich wie jedes andere: Berechtigungen, Einstellungen,
 * Navigation, Gesundheitspruefungen. Nichts daran ist ein Sonderweg - der
 * Unterschied liegt darin, was es zeigt, nicht darin, wie es eingebunden ist.
 *
 * Standardmaessig aus. Ein Rueckblick, der ungefragt in der Seitenleiste
 * steht, bevor je eine Kampagne angelegt wurde, waere ein leeres Versprechen.
 */

export const WRAPPED_MODULE_ID = 'wrapped';

/** Das Markenrot als Zahl - fuer Discord-Embeds. */
export const WRAPPED_ACCENT_COLOR = 0x83060a;

export const WRAPPED_PERMISSIONS = {
  /** Den eigenen Rueckblick ansehen. */
  viewOwn: 'wrapped.view_own',
  /** Das Studio betreten. */
  studioView: 'wrapped.studio.view',
  /** Kampagne und Szenen bearbeiten. */
  studioEdit: 'wrapped.studio.edit',
  /** Vorschau - auch als andere Person. */
  preview: 'wrapped.preview',
  /** Momentaufnahmen erzeugen. */
  generate: 'wrapped.generate',
  /** Veroeffentlichen und zurueckziehen. */
  publish: 'wrapped.publish',
} as const;

export type WrappedPermission = (typeof WRAPPED_PERMISSIONS)[keyof typeof WRAPPED_PERMISSIONS];

export const wrappedSettingsSchema = z.object({
  /**
   * Wie viele Momentaufnahmen ein Durchgang auf einmal erzeugt.
   *
   * Die Rechnung je Person ist nicht billig - unter anderem eine Abfrage
   * ueber die Ueberschneidungen im Sprachkanal. Ein Stapel von hundert
   * laeuft in Sekunden durch und laesst die Datenbank zwischendurch
   * atmen; tausend auf einmal wuerden sie fuer alle anderen spuerbar
   * blockieren.
   */
  batchSize: z.coerce.number().int().min(10).max(500).default(100),
  /** Wie viele Fehler je Durchgang festgehalten werden. */
  maxErrors: z.coerce.number().int().min(10).max(500).default(100),
  /** Den Hinweis im Dashboard zeigen, solange eine Kampagne veroeffentlicht ist. */
  showDashboardTeaser: z.boolean().default(true),
});

export type WrappedSettings = z.infer<typeof wrappedSettingsSchema>;

const wrappedSettingsFields: SettingsField[] = [
  {
    key: 'batchSize',
    label: 'Momentaufnahmen je Stapel',
    description:
      'Wie viele Mitglieder ein Durchgang auf einmal verarbeitet. Kleiner heisst schonender für die Datenbank, grösser heisst schneller.',
    type: 'select',
    options: [
      { value: '50', label: '50 - sehr schonend' },
      { value: '100', label: '100 - Vorgabe' },
      { value: '250', label: '250 - schnell' },
      { value: '500', label: '500 - nur auf starker Hardware' },
    ],
    group: 'Erzeugung',
  },
  {
    key: 'maxErrors',
    label: 'Festgehaltene Fehler',
    description: 'Wie viele gescheiterte Momentaufnahmen je Durchgang mit Begründung gespeichert werden.',
    type: 'number',
    group: 'Erzeugung',
  },
  {
    key: 'showDashboardTeaser',
    label: 'Hinweis im Dashboard',
    description:
      'Zeigt Mitgliedern auf der Startseite, dass ihr Rückblick bereitsteht. Nach dem Ansehen wird der Hinweis kleiner.',
    type: 'boolean',
    group: 'Darstellung',
  },
];

/**
 * Was am Rueckblick gerade nicht stimmt.
 *
 * Bewusst zurueckhaltend: solange keine Kampagne existiert, ist nichts
 * kaputt - es ist nur nichts eingerichtet. Ein Modul, das ohne Anlass rot
 * leuchtet, bringt jemandem bei, die Farbe zu ignorieren.
 */
async function wrappedHealthChecks(): Promise<ModuleHealthCheck[]> {
  const { prisma } = await import('@swisshub/database');
  const checks: ModuleHealthCheck[] = [];

  const [kampagnen, laufend, veroeffentlicht] = await Promise.all([
    prisma.wrappedCampaign.count(),
    prisma.wrappedGenerationRun.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.wrappedCampaign.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' } }),
  ]);

  checks.push({
    label: 'Kampagnen',
    status: 'ok',
    detail:
      kampagnen === 0
        ? 'Noch kein Rückblick angelegt. Im Studio lässt sich einer als Entwurf anlegen und gefahrlos testen.'
        : `${kampagnen} angelegt${veroeffentlicht ? `, «${veroeffentlicht.title}» ist veröffentlicht` : ''}.`,
  });

  if (laufend) {
    const anteil = laufend.total > 0 ? Math.round((laufend.processed / laufend.total) * 100) : 0;
    checks.push({
      label: 'Momentaufnahmen',
      status: 'warning',
      detail: `Ein Durchgang läuft: ${laufend.processed} von ${laufend.total} (${anteil} %).`,
    });
  }

  /*
   * Ohne Analytics gibt es nichts zu erzaehlen.
   *
   * Sprachzeit und Nachrichten sind die zwei Saeulen des Rueckblicks; fehlen
   * sie, bleiben Intro, Typ und Finale - und das ist keine Geschichte. Das
   * gehoert an die Oberflaeche, bevor jemand eine Kampagne veroeffentlicht.
   */
  const tracking = await prisma.analyticsTracking.findFirst();
  if (!tracking?.voiceSince && !tracking?.messagesSince) {
    checks.push({
      label: 'Datengrundlage',
      status: 'error',
      detail:
        'Das Analytics-Modul misst weder Sprachzeit noch Nachrichten. Ohne diese Daten hat ein Rückblick nichts zu erzählen.',
    });
  }

  return checks;
}

export const wrappedModule: ModuleDefinition = registerModule({
  id: WRAPPED_MODULE_ID,
  name: 'SwissHub Wrapped',
  description:
    'Der persönliche Jahresrückblick eines Mitglieds - als erzählte Geschichte statt als Statistikseite. Mit Studio zum Vorbereiten, Testen und Veröffentlichen.',
  icon: 'Gift',
  permissionPrefix: 'wrapped',
  defaultEnabled: false,
  settingsSchema: wrappedSettingsSchema,
  settingsFields: wrappedSettingsFields,
  healthChecks: wrappedHealthChecks,
  permissions: [
    {
      key: WRAPPED_PERMISSIONS.viewOwn,
      label: 'Eigenen Rückblick ansehen',
      description: 'Den eigenen SwissHub Wrapped öffnen, sobald er veröffentlicht ist.',
      module: WRAPPED_MODULE_ID,
    },
    {
      key: WRAPPED_PERMISSIONS.studioView,
      label: 'Studio sehen',
      description: 'Kampagnen, Szenen, Datenlage und Fortschritt einsehen.',
      module: WRAPPED_MODULE_ID,
    },
    {
      key: WRAPPED_PERMISSIONS.studioEdit,
      label: 'Studio bearbeiten',
      description: 'Kampagne anlegen, Zeitraum und Texte setzen, Szenen ein- und ausschalten.',
      module: WRAPPED_MODULE_ID,
    },
    {
      key: WRAPPED_PERMISSIONS.preview,
      label: 'Vorschau',
      description:
        'Den Rückblick als Testperson oder mit Testdaten ansehen. Verändert nichts und löst nichts aus.',
      module: WRAPPED_MODULE_ID,
    },
    {
      key: WRAPPED_PERMISSIONS.generate,
      label: 'Momentaufnahmen erzeugen',
      description: 'Den Durchgang starten, der die Daten aller Mitglieder festschreibt.',
      module: WRAPPED_MODULE_ID,
    },
    {
      key: WRAPPED_PERMISSIONS.publish,
      label: 'Veröffentlichen',
      description: 'Einen fertigen Rückblick für die Mitglieder freigeben, zurückziehen oder archivieren.',
      module: WRAPPED_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: systemRoutes.wrappedStudio(),
      label: 'Wrapped Studio',
      description: 'Jahresrückblick vorbereiten, testen und veröffentlichen',
      permission: WRAPPED_PERMISSIONS.studioView,
      icon: 'Gift',
      group: 'system',
      order: 45,
    },
  ],
});
