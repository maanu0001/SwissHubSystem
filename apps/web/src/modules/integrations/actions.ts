'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { conflict, forbidden } from '@swisshub/shared';
import { ai, premium, streamer } from '@swisshub/modules';
import {
  AI_INTEGRATION_ID,
  DISCORD_INTEGRATION_ID,
  PAYMENT_INTEGRATION_ID,
  TWITCH_INTEGRATION_ID,
  YOUTUBE_INTEGRATION_ID,
  checkBot,
  createBot,
  deleteBot,
  deleteSecret,
  getField,
  getIntegration,
  getSecret,
  httpsOderLeer,
  importFromEnvironment,
  refreshIntegrationRuntime,
  rotateBotToken,
  setSecret,
  snowflakeOderLeer,
  updateBot,
  validateBotToken,
  validateOAuthCredentials,
  writeStatus,
} from '@swisshub/secrets';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { defineAction } from '@/server/action';

/**
 * Server Actions der Integrationsverwaltung.
 *
 * Drei Regeln, die jede Aktion hier einhält:
 *
 * 1. **Kein Geheimnis kommt zurück.** Was eine Aktion zurückgibt, geht an den
 *    Browser. Zurück kommt daher höchstens eine Maske - nie ein Wert, auch
 *    nicht der eben gespeicherte.
 * 2. **Kein Geheimnis geht ins Protokoll.** Der Audit-Eintrag nennt
 *    Integration, Feld, Handelnden und Zeitpunkt (§13).
 * 3. **Der Handelnde wird zweimal geprüft.** Einmal von `defineAction` gegen
 *    die deklarierte Permission, einmal im Rumpf gegen die feinere - denn
 *    «Einstellungen ändern» und «Bot-Token austauschen» sind nicht dasselbe.
 */

const P = {
  view: 'integrations.view',
  manage: 'integrations.manage',
  secrets: 'integrations.secrets.manage',
  discord: 'integrations.discord.manage',
  ai: 'integrations.ai.manage',
} as const;

function revalidateIntegrations(): void {
  revalidatePath('/system/integrationen');
  revalidatePath('/system/integrationen/discord');
  revalidatePath('/system/integrationen/ai');
  revalidatePath('/system/integrationen/bots');
  revalidatePath('/system/integrationen/twitch');
  revalidatePath('/system/integrationen/youtube');
  revalidatePath('/dashboard');
}

/**
 * Die feinere Prüfung im Rumpf.
 *
 * `defineAction` hat bereits `integrations.secrets.manage` verlangt. Hier
 * kommt die anbieterbezogene dazu: wer nur die AI verwalten darf, soll nicht
 * über denselben Endpunkt den Bot-Token austauschen können.
 */
function pruefeAnbieter(ctx: AuthContext, integrationId: string): void {
  const noetig =
    integrationId === DISCORD_INTEGRATION_ID || integrationId.startsWith('bot:')
      ? P.discord
      : integrationId === AI_INTEGRATION_ID
        ? P.ai
        : P.manage;
  if (!can(ctx, noetig)) {
    throw forbidden(
      `integrations: ${ctx.user.discordId} fehlt ${noetig}`,
      'Dir fehlt die Berechtigung für diese Integration.',
    );
  }
}

async function protokolliere(
  ctx: AuthContext,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  metadata: Record<string, unknown>,
  success = true,
): Promise<void> {
  await safeRecordAudit({
    action,
    module: 'integrations',
    actorDiscordId: ctx.user.discordId,
    actorUsername: ctx.user.username,
    success,
    // Ausdruecklich nur Bezeichner. Kein Wert, kein alter Wert, kein Hinweis
    // auf den Inhalt.
    metadata,
  });
}

// --- Geheimnisse ----------------------------------------------------------

export const setSecretAction = defineAction(
  {
    name: 'integrations.setSecret',
    permission: P.secrets,
    schema: z.object({
      integrationId: z.string().min(1).max(64),
      key: z.string().min(1).max(64),
      /**
       * Bewusst kein `.trim()`.
       *
       * Ein Schlüssel, der auf ein Leerzeichen endet, ist ein Schlüssel mit
       * einem Leerzeichen am Ende - ihn stillschweigend zu ändern macht ihn
       * ungültig, und der Fehler wäre später nicht zu finden (§51).
       */
      value: z.string().min(1).max(4000),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    pruefeAnbieter(ctx, input.integrationId);

    const feld = getField(input.integrationId, input.key);
    if (!feld && !input.integrationId.startsWith('bot:')) {
      throw conflict('Dieses Feld gibt es nicht.');
    }
    if (feld) {
      const geprueft = feld.schema.safeParse(feld.type === 'number' ? Number(input.value) : input.value);
      if (!geprueft.success) {
        throw conflict(`${feld.label}: ${geprueft.error.issues[0]?.message ?? 'ungültig'}`);
      }
    }

    // Der Bot-Token wird vor der Übernahme geprüft (§17). Ein ungültiger
    // Token erreicht die Datenbank gar nicht - der bestehende bleibt stehen.
    if (input.integrationId === DISCORD_INTEGRATION_ID && input.key === 'botToken') {
      const geprueft = await validateBotToken(input.value);
      if (!geprueft.ok) {
        await protokolliere(
          ctx,
          AUDIT_ACTIONS.INTEGRATION_SECRET_UPDATED,
          { integration: input.integrationId, feld: input.key, grund: 'abgelehnt' },
          false,
        );
        return { ok: false as const, fehler: geprueft.fehler ?? 'Token ungültig.' };
      }
    }

    const { display } = await setSecret(input.integrationId, input.key, input.value, {
      actorDiscordId: ctx.user.discordId,
    });
    await refreshIntegrationRuntime({ force: true });
    if (input.integrationId === AI_INTEGRATION_ID) {
      ai.resetAiClients();
    }

    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_SECRET_UPDATED, {
      integration: input.integrationId,
      feld: input.key,
    });
    /*
     * Zahlungen bekommen zusaetzlich einen eigenen Protokolleintrag (§51).
     *
     * Nicht statt des allgemeinen, sondern daneben: wer das Audit Log nach
     * «was ist mit unseren Zahlungen passiert» durchsucht, soll nicht alle
     * Integrationsaenderungen durchsehen muessen. Und die drei Vorgaenge
     * unterscheiden sich in ihrer Schwere - ein Anbieterwechsel ist eine
     * andere Nachricht als ein erneuertes Secret.
     *
     * Der **Wert** steht in keinem der beiden Eintraege. Bei `provider` und
     * `mode` ist er die Nachricht selbst und kein Geheimnis; bei allem
     * anderen steht nur, welches Feld sich geaendert hat.
     */
    if (input.integrationId === PAYMENT_INTEGRATION_ID) {
      if (input.key === 'provider') {
        await protokolliere(ctx, AUDIT_ACTIONS.PAYMENT_PROVIDER_CHANGED, {
          anbieter: input.value,
        });
      } else if (input.key === 'mode') {
        await protokolliere(ctx, AUDIT_ACTIONS.PAYMENT_MODE_CHANGED, { modus: input.value });
      } else {
        await protokolliere(ctx, AUDIT_ACTIONS.PAYMENT_CREDENTIAL_CHANGED, { feld: input.key });
      }
    }
    revalidateIntegrations();
    // `display` ist die Maske, nicht der Wert.
    return { ok: true as const, display };
  },
);

export const deleteSecretAction = defineAction(
  {
    name: 'integrations.deleteSecret',
    permission: P.secrets,
    schema: z.object({
      integrationId: z.string().min(1).max(64),
      key: z.string().min(1).max(64),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    pruefeAnbieter(ctx, input.integrationId);
    const entfernt = await deleteSecret(input.integrationId, input.key, {
      actorDiscordId: ctx.user.discordId,
    });
    await refreshIntegrationRuntime({ force: true });
    if (input.integrationId === AI_INTEGRATION_ID) {
      ai.resetAiClients();
    }
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_SECRET_DELETED, {
      integration: input.integrationId,
      feld: input.key,
    });
    revalidateIntegrations();
    return { entfernt };
  },
);

// --- Nicht geheime Einstellungen ------------------------------------------

export const saveAiSettingsAction = defineAction(
  {
    name: 'integrations.saveAiSettings',
    permission: P.ai,
    schema: z.object({
      enabled: z.boolean(),
      provider: z.enum(['anthropic', 'openai']),
      model: z.string().trim().min(1).max(120),
      baseUrl: httpsOderLeer,
      timeoutMs: z.number().int().min(1000).max(120_000),
      maxTokens: z.number().int().min(16).max(8192),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    // Die Base URL prueft `httpsOderLeer` im Schema - eine zweite Pruefung
    // hier waere eine zweite Stelle, an der sie auseinanderlaufen koennte.
    const settings = await ai.writeAiSettings(input, ctx.user.discordId);
    ai.resetAiClients();
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_SETTINGS_UPDATED, {
      integration: AI_INTEGRATION_ID,
      // Anbieter und Modell sind keine Geheimnisse - sie stehen bewusst hier,
      // weil sonst niemand nachvollziehen könnte, was umgestellt wurde.
      provider: settings.provider,
      model: settings.model,
      enabled: settings.enabled,
    });
    revalidateIntegrations();
    return settings;
  },
);

// --- Verbindungstests ------------------------------------------------------

export const testIntegrationAction = defineAction(
  {
    name: 'integrations.test',
    permission: P.manage,
    schema: z.object({ integrationId: z.string().min(1).max(64) }),
    rateLimit: 'integrationTest',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    pruefeAnbieter(ctx, input.integrationId);
    const definition = getIntegration(input.integrationId);
    if (!definition?.testable) {
      throw conflict('Diese Integration lässt sich nicht testen.');
    }

    let ergebnis: { ok: boolean; detail: string };

    if (input.integrationId === DISCORD_INTEGRATION_ID) {
      const token = await getSecret(DISCORD_INTEGRATION_ID, 'botToken');
      const clientId = await getSecret(DISCORD_INTEGRATION_ID, 'clientId');
      const clientSecret = await getSecret(DISCORD_INTEGRATION_ID, 'clientSecret');

      const bot = token ? await validateBotToken(token) : { ok: false, fehler: 'Kein Bot-Token hinterlegt.' };
      const oauth =
        clientId && clientSecret
          ? await validateOAuthCredentials(clientId, clientSecret)
          : { ok: false, fehler: 'Client ID oder Client Secret fehlt.' };

      ergebnis = {
        ok: bot.ok && oauth.ok,
        detail: [
          bot.ok
            ? `Bot verbunden${bot.identity ? ` als ${bot.identity.username}` : ''}.`
            : `Bot: ${bot.fehler}`,
          oauth.ok ? 'OAuth-Zugangsdaten gültig.' : `OAuth: ${oauth.fehler}`,
        ].join(' '),
      };
    } else if (input.integrationId === AI_INTEGRATION_ID) {
      ergebnis = await ai.testAiConnection();
    } else if (input.integrationId === TWITCH_INTEGRATION_ID) {
      /*
       * Der Test holt ein App Access Token und fragt damit einen Kanal ab.
       *
       * Nicht nur das Token: das bestaetigt die Zugangsdaten, aber nicht, dass
       * Helix antwortet - und genau darauf verlaesst sich die Live-Erkennung.
       * Abgefragt wird `twitch`, ein Kanal, der niemandem hier gehoert.
       */
      ergebnis = await streamer.testeTwitch();
    } else if (input.integrationId === YOUTUBE_INTEGRATION_ID) {
      /*
       * Kostet eine Kontingenteinheit, und die wird gebucht wie jede andere.
       *
       * Ein Test, der nichts abfragt, wuerde einen abgelaufenen Schluessel
       * nicht finden; ein Test, der seinen Verbrauch nicht bucht, wuerde die
       * Kontingentrechnung des Moduls unterlaufen. Die Antwort nennt deshalb
       * auch den Tagesstand.
       */
      ergebnis = await streamer.testeYouTube();
    } else if (input.integrationId === PAYMENT_INTEGRATION_ID) {
      /*
       * Erreichbarkeit und Zugangsdaten - keine Zahlung (§20).
       *
       * Bei Stripe ein Aufruf auf `/v1/balance`: er sagt, ob der Schluessel
       * gilt, und bewegt keinen Rappen. Dazu prueft er, ob Schluessel und
       * Modus zusammenpassen - ein Livekey bei Modus TEST ist die
       * gefaehrlichere Verwechslung, weil dann echt kassiert wird, waehrend
       * das Dashboard «Test» anzeigt.
       */
      ergebnis = await premium.testeVerbindung();
    } else {
      throw conflict('Für diese Integration gibt es keinen Test.');
    }

    await writeStatus(input.integrationId, ergebnis.ok ? 'CONNECTED' : 'ERROR', ergebnis.detail);
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_TESTED, {
      integration: input.integrationId,
      erfolgreich: ergebnis.ok,
    });
    if (input.integrationId === PAYMENT_INTEGRATION_ID) {
      /*
       * `detail` darf ins Protokoll, weil `testeVerbindung` nur Codes und
       * Saetze liefert - nie den Rohtext des Anbieters. Manche Anbieter
       * spiegeln den gesendeten Schluessel in ihrer Fehlermeldung zurueck,
       * und der stuende dann hier.
       */
      await protokolliere(ctx, AUDIT_ACTIONS.PAYMENT_CONNECTION_TESTED, {
        erfolgreich: ergebnis.ok,
        detail: ergebnis.detail,
      });
    }
    revalidateIntegrations();
    return ergebnis;
  },
);

// --- Übernahme aus der Umgebung -------------------------------------------

export const importEnvAction = defineAction(
  {
    name: 'integrations.importEnv',
    permission: P.secrets,
    schema: z.object({
      felder: z
        .array(z.object({ integrationId: z.string().min(1).max(64), key: z.string().min(1).max(64) }))
        .min(1)
        .max(50),
      ueberschreiben: z.boolean().default(false),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    for (const feld of input.felder) {
      pruefeAnbieter(ctx, feld.integrationId);
    }
    const ergebnis = await importFromEnvironment(input.felder, {
      actorDiscordId: ctx.user.discordId,
      ueberschreiben: input.ueberschreiben,
    });
    await refreshIntegrationRuntime({ force: true });
    ai.resetAiClients();
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_ENV_IMPORTED, {
      // Nur Feldnamen. Der Wert wurde gelesen, verschluesselt und abgelegt -
      // gesehen hat ihn niemand (§41).
      uebernommen: ergebnis.uebernommen,
      uebersprungen: ergebnis.uebersprungen,
      fehlgeschlagen: ergebnis.fehlgeschlagen.map((eintrag) => eintrag.feld),
    });
    revalidateIntegrations();
    return ergebnis;
  },
);

// --- Bots ------------------------------------------------------------------

export const createBotAction = defineAction(
  {
    name: 'integrations.createBot',
    permission: P.discord,
    schema: z.object({
      // Nur Worker. Der Systembot entsteht beim Start und ist zugleich der
      // Musik-Controller; ein Controller mit eigener Anwendung entfaellt.
      kind: z.literal('MUSIC_WORKER'),
      label: z.string().trim().min(1).max(60),
      slug: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[A-Z0-9_]+$/u, 'nur Grossbuchstaben, Ziffern und Unterstriche'),
      clientId: snowflakeOderLeer,
      position: z.number().int().min(0).max(99).default(0),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const bot = await createBot(
      {
        kind: input.kind,
        label: input.label,
        slug: input.slug,
        clientId: input.clientId === '' ? null : input.clientId,
        position: input.position,
      },
      ctx.user.discordId,
    );
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_BOT_CREATED, { bot: bot.slug });
    revalidateIntegrations();
    return bot;
  },
);

export const updateBotAction = defineAction(
  {
    name: 'integrations.updateBot',
    permission: P.discord,
    schema: z.object({
      id: z.string().min(1).max(64),
      label: z.string().trim().min(1).max(60).optional(),
      clientId: snowflakeOderLeer.optional(),
      position: z.number().int().min(0).max(99).optional(),
      enabled: z.boolean().optional(),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const bot = await updateBot(
      input.id,
      {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId === '' ? null : input.clientId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
      ctx.user.discordId,
    );
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_BOT_UPDATED, { bot: bot.slug });
    revalidateIntegrations();
    return bot;
  },
);

export const deleteBotAction = defineAction(
  {
    name: 'integrations.deleteBot',
    permission: P.discord,
    schema: z.object({ id: z.string().min(1).max(64) }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await deleteBot(input.id, ctx.user.discordId);
    await refreshIntegrationRuntime({ force: true });
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_BOT_DELETED, { bot: input.id });
    revalidateIntegrations();
    return { entfernt: true };
  },
);

export const rotateBotTokenAction = defineAction(
  {
    name: 'integrations.rotateBotToken',
    permission: P.secrets,
    schema: z.object({
      id: z.string().min(1).max(64),
      token: z.string().min(20).max(200),
    }),
    rateLimit: 'integrationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (!can(ctx, P.discord)) {
      throw forbidden(
        `integrations: ${ctx.user.discordId} fehlt ${P.discord}`,
        'Dir fehlt die Berechtigung für Discord-Zugangsdaten.',
      );
    }
    const ergebnis = await rotateBotToken(input.id, input.token, ctx.user.discordId);
    if (ergebnis.ok) {
      await refreshIntegrationRuntime({ force: true });
    }
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_BOT_TOKEN_ROTATED, { bot: input.id }, ergebnis.ok);
    revalidateIntegrations();
    return {
      ok: ergebnis.ok,
      ...(ergebnis.fehler ? { fehler: ergebnis.fehler } : {}),
      ...(ergebnis.identity ? { username: ergebnis.identity.username } : {}),
    };
  },
);

export const checkBotAction = defineAction(
  {
    name: 'integrations.checkBot',
    permission: P.manage,
    schema: z.object({ id: z.string().min(1).max(64) }),
    rateLimit: 'integrationTest',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (!can(ctx, P.discord)) {
      throw forbidden(
        `integrations: ${ctx.user.discordId} fehlt ${P.discord}`,
        'Dir fehlt die Berechtigung für Discord-Zugangsdaten.',
      );
    }
    const ergebnis = await checkBot(input.id);
    await protokolliere(ctx, AUDIT_ACTIONS.INTEGRATION_TESTED, { bot: input.id, erfolgreich: ergebnis.ok });
    revalidateIntegrations();
    return {
      ok: ergebnis.ok,
      ...(ergebnis.fehler ? { fehler: ergebnis.fehler } : {}),
      ...(ergebnis.identity ? { username: ergebnis.identity.username } : {}),
    };
  },
);
