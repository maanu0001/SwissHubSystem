import { z } from 'zod';
import { teileIn } from '@swisshub/shared';
import { VERGLEICHS_OPERATOREN, vergleiche } from './conditions';
import { istErlaubterPfad, leseWert, render } from './context';
import { registerCondition, type ValidationIssue } from './registry';
import { STANDARD_ZEITZONE } from './core-triggers';

/**
 * Die Bedingungen, die kein Modul brauchen.
 *
 * Vier Stück - und die decken erfahrungsgemäss das meiste ab, was jemand
 * fragen will:
 *
 * - `wert`     ein Feld aus dem Ereignis gegen einen Wert
 * - `rolle`    hat das betroffene Mitglied eine bestimmte Rolle?
 * - `istBot`   ist das betroffene Konto ein Bot?
 * - `zeit`     liegt jetzt in einem Zeitfenster?
 *
 * Alles Modulspezifische - «hat dieses Turnier bereits begonnen» - trägt das
 * jeweilige Modul selbst ein.
 *
 * Jede Bedingung hier ist **lesend**. Das ist keine Stilfrage: der Probelauf
 * (§23) prüft Bedingungen echt und lässt nur Aktionen aus. Eine Bedingung mit
 * Nebenwirkung machte ihn gefährlich statt hilfreich.
 */

// --- Wert vergleichen -------------------------------------------------------

export const wertConfigSchema = z.object({
  pfad: z.string().min(1).max(120),
  operator: z.enum(VERGLEICHS_OPERATOREN),
  wert: z.string().max(500).optional(),
});

registerCondition({
  id: 'wert',
  label: 'Wert vergleichen',
  description: 'Vergleicht ein Feld aus dem Ereignis mit einem Wert.',
  group: 'Ereignis',
  configSchema: wertConfigSchema,
  fields: [
    {
      key: 'pfad',
      label: 'Feld',
      description: 'Zum Beispiel payload.level oder event.subjectId.',
      type: 'text',
      required: true,
      placeholder: 'payload.level',
    },
    {
      key: 'operator',
      label: 'Vergleich',
      type: 'select',
      required: true,
      options: VERGLEICHS_OPERATOREN.map((operator) => ({ value: operator, label: operator })),
      default: 'eq',
    },
    { key: 'wert', label: 'Wert', type: 'text', supportsTemplate: true },
  ],
  async evaluate(config, context) {
    const { pfad, operator, wert } = config as z.infer<typeof wertConfigSchema>;
    // Derselbe Freigabepfad wie bei den Platzhaltern: eine Bedingung darf
    // nicht mehr sehen als eine Nachricht (§44).
    if (!istErlaubterPfad(pfad)) {
      return false;
    }
    const links = leseWert(context, pfad);
    const rechts = wert === undefined ? undefined : render(wert, context).text;
    return vergleiche(links, operator, rechts);
  },
  async validate(config): Promise<ValidationIssue[]> {
    const geprueft = wertConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Der Vergleich ist unvollständig.' }];
    }
    if (!istErlaubterPfad(geprueft.data.pfad)) {
      return [
        {
          severity: 'error',
          message: `Das Feld «${geprueft.data.pfad}» ist nicht zugänglich.`,
        },
      ];
    }
    return [];
  },
});

// --- Rolle ------------------------------------------------------------------

export const rolleConfigSchema = z.object({
  roleId: z.string().regex(/^\d{17,20}$/u, 'muss eine Discord-Rollen-ID sein'),
  /** Wessen Rollen geprüft werden. Standard: das betroffene Mitglied. */
  wen: z.enum(['subject', 'actor']).default('subject'),
});

function betroffener(
  wen: 'subject' | 'actor',
  context: { event: { subjectId: string | null; actorId: string | null } },
): string | null {
  return wen === 'actor' ? context.event.actorId : context.event.subjectId;
}

registerCondition({
  id: 'rolle',
  label: 'Hat eine Rolle',
  description: 'Prüft, ob das betroffene Mitglied eine bestimmte Rolle trägt.',
  group: 'Mitglied',
  configSchema: rolleConfigSchema,
  fields: [
    { key: 'roleId', label: 'Rolle', type: 'discord-role', required: true },
    {
      key: 'wen',
      label: 'Wen prüfen',
      type: 'select',
      options: [
        { value: 'subject', label: 'Das betroffene Mitglied' },
        { value: 'actor', label: 'Wer es ausgelöst hat' },
      ],
      default: 'subject',
    },
  ],
  async evaluate(config, context) {
    const { roleId, wen } = config as z.infer<typeof rolleConfigSchema>;
    const discordId = betroffener(wen, context);
    if (!discordId) {
      return false;
    }
    const mitglied = await context.gateway.members.get(discordId);
    // Wer den Server verlassen hat, trägt keine Rolle mehr.
    return Boolean(mitglied?.roleIds.includes(roleId));
  },
  async validate(config, umgebung): Promise<ValidationIssue[]> {
    const geprueft = rolleConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Es ist keine Rolle gewählt.' }];
    }
    if (!umgebung.rollenIds.has(geprueft.data.roleId)) {
      return [{ severity: 'error', message: 'Diese Rolle gibt es auf dem Server nicht (mehr).' }];
    }
    return [];
  },
});

// --- Bot --------------------------------------------------------------------

export const istBotConfigSchema = z.object({
  wen: z.enum(['subject', 'actor']).default('subject'),
});

registerCondition({
  id: 'istBot',
  label: 'Ist ein Bot',
  description: 'Trifft zu, wenn das betroffene Konto ein Bot ist.',
  group: 'Mitglied',
  configSchema: istBotConfigSchema,
  fields: [
    {
      key: 'wen',
      label: 'Wen prüfen',
      type: 'select',
      options: [
        { value: 'subject', label: 'Das betroffene Mitglied' },
        { value: 'actor', label: 'Wer es ausgelöst hat' },
      ],
      default: 'subject',
    },
  ],
  async evaluate(config, context) {
    const { wen } = config as z.infer<typeof istBotConfigSchema>;
    const discordId = betroffener(wen, context);
    if (!discordId) {
      return false;
    }
    const mitglied = await context.gateway.members.get(discordId);
    return Boolean(mitglied?.isBot);
  },
});

// --- Zeitfenster ------------------------------------------------------------

export const zeitfensterConfigSchema = z.object({
  von: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u, 'muss die Form HH:MM haben'),
  bis: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u, 'muss die Form HH:MM haben'),
  wochentage: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  zeitzone: z.string().min(1).max(64).default(STANDARD_ZEITZONE),
});

registerCondition({
  id: 'zeitfenster',
  label: 'Innerhalb eines Zeitfensters',
  description: 'Trifft zu, wenn der Lauf in ein Zeitfenster fällt - etwa nur abends.',
  group: 'Zeit',
  configSchema: zeitfensterConfigSchema,
  fields: [
    { key: 'von', label: 'Von', type: 'time', required: true, placeholder: '18:00' },
    { key: 'bis', label: 'Bis', type: 'time', required: true, placeholder: '23:00' },
    { key: 'wochentage', label: 'Nur an diesen Tagen', type: 'weekdays' },
    { key: 'zeitzone', label: 'Zeitzone', type: 'text', default: STANDARD_ZEITZONE },
  ],
  async evaluate(config, context) {
    const { von, bis, wochentage, zeitzone } = config as z.infer<typeof zeitfensterConfigSchema>;
    let teile: ReturnType<typeof teileIn>;
    try {
      teile = teileIn(context.now, zeitzone);
    } catch {
      // Unbekannte Zeitzone: die Bedingung lässt sich nicht beantworten und
      // gilt damit als nicht erfüllt.
      return false;
    }

    if (wochentage && wochentage.length > 0 && !wochentage.includes(teile.wochentag)) {
      return false;
    }

    const jetzt = teile.stunde * 60 + teile.minute;
    const start = minuten(von);
    const ende = minuten(bis);

    // Ein Fenster über Mitternacht (22:00 bis 02:00) ist keines, das «von
    // kleiner bis» erfüllt - es ist die Vereinigung zweier Stücke.
    return start <= ende ? jetzt >= start && jetzt <= ende : jetzt >= start || jetzt <= ende;
  },
});

function minuten(hhmm: string): number {
  const [stunde, minute] = hhmm.split(':');
  return Number(stunde) * 60 + Number(minute);
}

// --- Abklingzeit ------------------------------------------------------------

export const abklingConfigSchema = z.object({
  minuten: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30),
  /** Je Mitglied oder für die ganze Automation. */
  bezug: z.enum(['mitglied', 'automation']).default('mitglied'),
});

/**
 * «Nicht öfter als» - die Bedingung, die eine Automation höflich macht.
 *
 * ## Warum das keine Ratengrenze ist
 *
 * `maxRunsPerMinute` schützt den Server: zu viele Läufe in kurzer Zeit werden
 * verworfen, egal wen sie betreffen. Diese Bedingung schützt **das Mitglied**:
 * «dieser Person höchstens einmal pro Woche schreiben». Das ist eine fachliche
 * Frage, und sie gehört deshalb dorthin, wo fachliche Fragen stehen - in die
 * Bedingungen, sichtbar und einstellbar, nicht in eine Grenze im Hintergrund.
 *
 * Ohne sie wäre eine Systemeinladung ein Werkzeug, mit dem jemand versehentlich
 * zehnmal dieselbe Direktnachricht schickt.
 *
 * ## Woran gemessen wird
 *
 * An den **tatsächlichen Läufen** dieser Automation (`AutomationRun`), nicht
 * an einem eigenen Zähler. Ein zweiter Zähler wäre ein zweiter Ort, an dem
 * dasselbe steht - und der, der nach einem Neustart nicht mehr stimmt.
 *
 * Gezählt werden nur Läufe mit Status `SUCCESS`. Ein übersprungener oder
 * gescheiterter Lauf hat niemandem geschrieben und darf die Abklingzeit nicht
 * starten - sonst sperrt sich die Bedingung selbst aus, und zwar genau dann,
 * wenn gerade etwas nicht geklappt hat.
 *
 * Probeläufe zählen nicht (`dryRun: false`) - ein Probelauf wirkt nicht, also
 * soll er auch nicht blockieren.
 *
 * ## Warum sie lesend ist
 *
 * Wie jede Bedingung hier: der Probelauf prüft Bedingungen echt und lässt nur
 * Aktionen aus. Eine Bedingung, die beim Prüfen etwas vermerkt, machte ihn
 * gefährlich.
 */
registerCondition({
  id: 'abklingzeit',
  label: 'Nicht öfter als',
  description:
    'Trifft zu, wenn diese Automation für dieses Mitglied in der angegebenen Zeit noch nicht gelaufen ist.',
  group: 'Zeit',
  configSchema: abklingConfigSchema,
  fields: [
    {
      key: 'minuten',
      label: 'Abstand',
      description: 'Frühestens so viele Minuten nach dem letzten Lauf wieder.',
      type: 'number',
      required: true,
      min: 1,
      max: 60 * 24 * 30,
      unit: 'Minuten',
      default: 60 * 24 * 7,
    },
    {
      key: 'bezug',
      label: 'Gilt je',
      type: 'select',
      options: [
        { value: 'mitglied', label: 'Betroffenes Mitglied' },
        { value: 'automation', label: 'Die ganze Automation' },
      ],
      default: 'mitglied',
    },
  ],
  async evaluate(config, context) {
    const { minuten, bezug } = config as z.infer<typeof abklingConfigSchema>;
    const seit = new Date(context.now.getTime() - minuten * 60_000);

    if (bezug === 'mitglied') {
      const subjekt = context.event.subjectId;
      if (!subjekt) {
        /*
         * Kein Mitglied, also keine Abklingzeit je Mitglied.
         *
         * `true` und nicht `false`: die Bedingung fragt «ist der Abstand
         * eingehalten», und ohne Mitglied gibt es keinen Abstand zu verletzen.
         * `false` hiesse, eine Automation ohne Betroffenen liefe nie - und das
         * wäre eine Sperre, die niemand eingestellt hat.
         */
        return true;
      }
      const letzte = await zaehleLaeufe(context.automationId, seit, subjekt);
      return letzte === 0;
    }

    const letzte = await zaehleLaeufe(context.automationId, seit, null);
    return letzte === 0;
  },
});

/**
 * Wie viele wirksame Läufe es seit `seit` gab.
 *
 * Mit `subjekt` nur die, die dieses Mitglied betrafen. Die Kennung steht im
 * festgehaltenen Kontext des Laufs (`context.event.subjectId`), weil
 * `AutomationRun` keine eigene Spalte dafür hat - eine Spalte dafür wäre eine
 * Migration für eine Frage, die sich so beantworten lässt.
 */
async function zaehleLaeufe(automationId: string, seit: Date, subjekt: string | null): Promise<number> {
  const { prisma } = await import('@swisshub/database');
  const laeufe = await prisma.automationRun.findMany({
    where: {
      automationId,
      dryRun: false,
      status: 'SUCCESS',
      createdAt: { gte: seit },
    },
    select: { context: true },
    take: 200,
  });

  if (!subjekt) {
    return laeufe.length;
  }
  return laeufe.filter((lauf) => {
    const gespeichert = lauf.context as { event?: { subjectId?: unknown } } | null;
    return gespeichert?.event?.subjectId === subjekt;
  }).length;
}
