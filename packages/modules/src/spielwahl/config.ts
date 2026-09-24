import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const SPIELWAHL_MODULE_ID = 'spielwahl';

/** SwissHub-Rot, wie in den uebrigen Modulen. */
export const SPIELWAHL_ACCENT_COLOR = 0x83060a;

/**
 * Berechtigungen.
 *
 * Bewusst duenn. Eine gemeinsame Spielauswahl ist keine Verwaltungsaufgabe -
 * wer sie eroeffnet, fuehrt sie, und das ergibt sich aus der Session und
 * nicht aus einer Rolle. Rechte braucht es nur fuer die drei Fragen, die
 * darueber hinausgehen: darf jemand ueberhaupt mitmachen, darf er eine
 * eroeffnen, und darf jemand von aussen eingreifen.
 */
export const SPIELWAHL_PERMISSIONS = {
  /** Sessions sehen und beitreten, vorschlagen, abstimmen. */
  view: 'spielwahl.view',
  /** Eine Session eroeffnen. */
  create: 'spielwahl.create',
  /** Fremde Sessions schliessen - Moderation, nicht Alltag. */
  manage: 'spielwahl.manage',
  /** Die Vorgaben des Moduls einstellen. */
  settings: 'spielwahl.settings',
} as const;

export type SpielwahlPermission = (typeof SPIELWAHL_PERMISSIONS)[keyof typeof SPIELWAHL_PERMISSIONS];

/**
 * Die Vorgaben des Servers.
 *
 * Sie sind die Voreinstellung fuer eine neue Session, nicht ihre Fessel: was
 * hier steht, findet der Host im Formular vor und kann es aendern. Die
 * Grenzen dagegen gelten - `maxTeilnehmerGrenze` ist eine Obergrenze und
 * keine Empfehlung.
 */
export const spielwahlSettingsSchema = z.object({
  /** Wie viele Spiele eine Person vorschlagen darf. */
  vorschlaegeProPerson: z.coerce.number().int().min(1).max(10).default(3),
  /** Hoechstzahl Teilnehmer je Session - die harte Grenze. */
  maxTeilnehmerGrenze: z.coerce.number().int().min(2).max(50).default(12),
  /** Wie lange eine Abstimmung standardmaessig laeuft. */
  abstimmdauerSek: z.coerce.number().int().min(10).max(300).default(45),
  /** Freie Vorschlaege ausserhalb des Katalogs zulassen. */
  freieVorschlaege: z.boolean().default(true),

  /**
   * Wie viele Sessions eine Person gleichzeitig offen haben darf.
   *
   * Eine halboffene Session ist kein Schaden, zwanzig davon sind Unordnung -
   * und jede haelt einen Einladungslink am Leben.
   */
  offeneProPerson: z.coerce.number().int().min(1).max(10).default(3),

  /**
   * Nach wie vielen Stunden ohne Abschluss eine Session verfaellt.
   *
   * Eine Runde, die am Freitagabend begonnen und nie beendet wurde, soll am
   * Samstag nicht mehr auf dem Server stehen und schon gar nicht ueber ihren
   * Einladungslink erreichbar sein.
   */
  verfallStunden: z.coerce.number().int().min(1).max(168).default(12),

  /** Sessions auf Discord ankuendigen, wenn ein Kanal gewaehlt ist. */
  announcementChannelId: z.string().nullable().default(null),
});

export type SpielwahlSettings = z.infer<typeof spielwahlSettingsSchema>;

const spielwahlSettingsFields: SettingsField[] = [
  {
    key: 'vorschlaegeProPerson',
    type: 'number',
    label: 'Vorschläge pro Person',
    description:
      'Wie viele Spiele eine Person in eine Runde einbringen darf. Voreinstellung für neue Sessions.',
    min: 1,
    max: 10,
    unit: 'Spiele',
    group: 'Ablauf',
  },
  {
    key: 'maxTeilnehmerGrenze',
    type: 'number',
    label: 'Höchstzahl Teilnehmer',
    description:
      'Die harte Grenze. Ein Host kann darunter bleiben, nicht darüber - die Bühne wird sonst unlesbar.',
    min: 2,
    max: 50,
    group: 'Ablauf',
  },
  {
    key: 'abstimmdauerSek',
    type: 'duration',
    label: 'Abstimmungsdauer',
    description:
      'Wie lange eine Abstimmung standardmässig läuft. Der Server entscheidet, nicht die Uhr im Browser.',
    min: 10,
    max: 300,
    presets: [20, 30, 45, 60, 90],
    group: 'Ablauf',
  },
  {
    key: 'freieVorschlaege',
    type: 'boolean',
    label: 'Vorschläge ausserhalb des Katalogs',
    description:
      'Erlaubt Titel, die nicht in der Spieleliste stehen. Sie erscheinen ohne Cover - ein Bild aus einer Eingabe wird nirgends geladen.',
    group: 'Ablauf',
  },
  {
    key: 'offeneProPerson',
    type: 'number',
    label: 'Offene Sessions pro Person',
    description: 'Wie viele Runden jemand gleichzeitig offen haben darf.',
    min: 1,
    max: 10,
    group: 'Grenzen',
  },
  {
    key: 'verfallStunden',
    type: 'number',
    label: 'Verfall nach (Stunden)',
    description:
      'Eine Runde ohne Abschluss verfällt nach dieser Zeit; ihr Einladungslink führt danach ins Leere.',
    min: 1,
    max: 168,
    group: 'Grenzen',
  },
  {
    key: 'announcementChannelId',
    type: 'discord-channel',
    label: 'Ankündigungskanal',
    description:
      'Wohin eine Session gestellt wird, wenn der Host es möchte. Ohne Kanal bleibt die Runde beim Einladungslink.',
    channelKinds: ['text'],
    group: 'Discord',
  },
];

/**
 * Was vor dem Einschalten stimmen muss.
 *
 * Die eine Voraussetzung ist der Spielekatalog. Ohne Spiele gibt es nichts
 * auszuwaehlen, und das Modul waere eine Buehne ohne Stuecke - gepflegt wird
 * die Liste unter Spielersuche, und zwar genau einmal fuer alle Module.
 */
async function spielwahlHealthChecks(kontext?: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const { prisma } = await import('@swisshub/database');
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<SpielwahlSettings>(SPIELWAHL_MODULE_ID);
  const checks: ModuleHealthCheck[] = [];

  const spiele = await prisma.spielersucheGame.count({ where: { enabled: true } });
  if (spiele === 0) {
    checks.push({
      label: 'Spielekatalog',
      status: 'error',
      detail:
        'Kein aktives Spiel im Katalog. Ohne Spiele laesst sich nichts auswaehlen - die Liste wird unter Spielersuche gepflegt, dieselbe, die Turniere und Clips verwenden.',
      fixHref: '/spielersuche/spiele',
    });
  } else if (spiele < 4) {
    checks.push({
      label: 'Spielekatalog',
      status: 'warning',
      detail: `Nur ${spiele} aktive Spiele. Eine Auswahl mit drei Moeglichkeiten ist keine.`,
      fixHref: '/spielersuche/spiele',
    });
  } else {
    checks.push({ label: 'Spielekatalog', status: 'ok', detail: `${spiele} Spiele stehen zur Auswahl.` });
  }

  const kanal = settings.announcementChannelId;
  if (kanal && kontext) {
    const gefunden = kontext.channels.find((eintrag) => eintrag.id === kanal);
    checks.push(
      gefunden && !gefunden.deleted
        ? {
            label: 'Ankuendigungen',
            status: 'ok',
            detail: `Runden koennen nach #${gefunden.name} gestellt werden.`,
          }
        : {
            label: 'Ankuendigungen',
            status: 'warning',
            detail: 'Der gewaehlte Kanal existiert auf Discord nicht mehr.',
            fixHref: `/modules/${SPIELWAHL_MODULE_ID}`,
          },
    );
  }

  /*
   * Runden, die niemand mehr beendet.
   *
   * Sie schaden nicht, aber jede haelt einen Einladungslink am Leben. Bleibt
   * die Zahl ueber Tage stehen, laeuft der Aufraeum-Durchgang des Bots nicht.
   */
  const verfallen = await prisma.spielwahlSession.count({
    where: {
      status: { in: ['LOBBY', 'BEREIT', 'ENTSCHEIDUNG', 'ERGEBNIS'] },
      expiresAt: { lt: new Date() },
    },
  });
  if (verfallen > 0) {
    checks.push({
      label: 'Verfallene Runden',
      status: 'warning',
      detail: `${verfallen} Runden sind abgelaufen und warten auf das Aufraeumen. Bleibt die Zahl stehen, laeuft der Bot nicht.`,
    });
  }

  return checks;
}

export const spielwahlModule: ModuleDefinition = registerModule({
  id: SPIELWAHL_MODULE_ID,
  name: 'Was spielen wir?',
  description:
    'Die gemeinsame Spielauswahl: vorschlagen, dann Roulette, Abstimmung oder Ausscheidungsduell - gleichzeitig für alle, auf jedem Gerät.',
  icon: 'Dices',
  permissionPrefix: 'spielwahl',
  defaultEnabled: false,
  settingsSchema: spielwahlSettingsSchema,
  settingsFields: spielwahlSettingsFields,
  healthChecks: spielwahlHealthChecks,
  permissions: [
    {
      key: SPIELWAHL_PERMISSIONS.view,
      label: 'Mitmachen',
      description: 'Einer Runde beitreten, Spiele vorschlagen und abstimmen.',
      module: SPIELWAHL_MODULE_ID,
    },
    {
      key: SPIELWAHL_PERMISSIONS.create,
      label: 'Runde eröffnen',
      description: 'Eine gemeinsame Spielauswahl starten und als Host führen.',
      module: SPIELWAHL_MODULE_ID,
    },
    {
      key: SPIELWAHL_PERMISSIONS.manage,
      label: 'Fremde Runden schliessen',
      description:
        'Eine Runde beenden, die einem anderen gehört. Für Moderation gedacht, nicht für den Alltag.',
      module: SPIELWAHL_MODULE_ID,
    },
    {
      key: SPIELWAHL_PERMISSIONS.settings,
      label: 'Einstellungen verwalten',
      description: 'Vorgaben, Grenzen und den Ankündigungskanal des Moduls einstellen.',
      module: SPIELWAHL_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/was-spielen-wir',
      label: 'Was spielen wir?',
      description: 'Gemeinsam entscheiden, was heute Abend läuft',
      permission: SPIELWAHL_PERMISSIONS.view,
      icon: 'Dices',
      group: 'modules',
      order: 26,
      altPermissions: [SPIELWAHL_PERMISSIONS.create, SPIELWAHL_PERMISSIONS.manage],
    },
  ],
});
