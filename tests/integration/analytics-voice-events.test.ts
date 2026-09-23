import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_voice_events');

/**
 * Der Voice-Handler des Bots - die Stelle, an der die Sprachzeit entsteht.
 *
 * Alles dahinter war geprüft: die Abschnitte, die Aggregate, die Statistik,
 * die laufende Zeit. Nur der Anfang der Kette nicht - der Zuhörer am
 * Gateway-Ereignis. Genau dort gingen die Daten verloren.
 *
 * Geprüft wird hier gegen eine echte Datenbank und gegen dieselben Objekte,
 * die discord.js liefert: der Handler bekommt zwei `VoiceState`, und danach
 * muss in `AnalyticsVoiceSegment` das Richtige stehen.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { registerAnalyticsEvents } = await import('../../apps/bot/src/analytics-events');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const MUSIK_BOT = '800000000000000001';
const KANAL = '700000000000000010';
const KANAL_2 = '700000000000000011';
const AFK_KANAL = '700000000000000099';

async function konfiguriere(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(analytics.ANALYTICS_MODULE_ID, true, 'test');
  await setModuleSettings(
    analytics.ANALYTICS_MODULE_ID,
    {
      logMessages: true,
      storeMessageContent: false,
      logVoice: true,
      logMembers: true,
      logAdmin: true,
      logBots: false,
      ignoredChannelIds: [],
      retentionDays: 90,
      mediaRetentionDays: 30,
      archiveMedia: false,
      mediaQuotaMb: 2048,
      maxMediaFileMb: 8,
      ...teile,
    },
    'test',
  );
}

function fakeClient() {
  const behandler = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const client = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const liste = behandler.get(event) ?? [];
      liste.push(handler);
      behandler.set(event, liste);
      return client;
    },
  };
  const feuere = async (event: string, ...args: unknown[]): Promise<void> => {
    for (const handler of behandler.get(event) ?? []) {
      await handler(...args);
    }
    // Der Handler arbeitet bewusst im Hintergrund weiter - eine Statistik
    // darf kein Gateway-Ereignis aufhalten.
    await new Promise((resolve) => setTimeout(resolve, 120));
  };
  return { client, feuere };
}

/**
 * Ein `VoiceState`, wie discord.js ihn liefert.
 *
 * Wichtig ist, was **fehlt**: `member` ist `null`. Auf einem Server mit
 * tausenden Mitgliedern schickt Discord die Mitgliederliste nicht mit, und
 * discord.js hat den Betreffenden dann schlicht nicht im Zwischenspeicher.
 * Genau dieser Zustand ist der Normalfall, nicht die Ausnahme.
 */
function zustand(
  discordId: string,
  channelId: string | null,
  optionen: { mitMitglied?: boolean; istBot?: boolean; afk?: string | null } = {},
) {
  const mitglied = optionen.mitMitglied
    ? {
        id: discordId,
        displayName: `Anzeige ${discordId}`,
        user: { id: discordId, username: `user-${discordId}`, bot: optionen.istBot ?? false, avatar: null },
      }
    : null;

  return {
    id: discordId,
    channelId,
    member: mitglied,
    guild: { id: GUILD, afkChannelId: optionen.afk ?? AFK_KANAL },
    channel: channelId
      ? { id: channelId, name: channelId === KANAL_2 ? 'Zweiter' : 'Treffpunkt', parentId: null }
      : null,
  };
}

const offeneAbschnitte = () =>
  prisma.analyticsVoiceSegment.findMany({ where: { guildId: GUILD, leftAt: null } });

describeWithDatabase('Analytics: der Voice-Handler des Bots', () => {
  beforeAll(() => {
    pushSchema();
  });

  let bot: ReturnType<typeof fakeClient>;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","DiscordEvent","ModuleState","BotStatus" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
    bot = fakeClient();
    registerAnalyticsEvents(bot.client as never, () => true, true);
  });

  it('eröffnet beim Betreten einen Abschnitt', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));

    const offen = await offeneAbschnitte();
    expect(offen).toHaveLength(1);
    expect(offen[0]?.discordId).toBe(A);
    expect(offen[0]?.channelId).toBe(KANAL);
  });

  it('eröffnet ihn auch, wenn das Mitglied nicht im Zwischenspeicher steht', async () => {
    /*
     * Der Normalfall auf einem grossen Server: Discord schickt die
     * Mitgliederliste nicht mit, und `member` ist `null`. Wer daraus
     * schliesst, es sei niemand da, zeichnet dort gar nichts auf - und
     * genau das ist auf einem Server mit tausenden Mitgliedern jede
     * einzelne Sitzung.
     */
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));

    const offen = await offeneAbschnitte();
    expect(offen).toHaveLength(1);
    expect(offen[0]?.discordId).toBe(A);
    expect(offen[0]?.isBot).toBe(false);
  });

  it('schliesst ihn beim Verlassen und verbucht die Sekunden', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));
    await prisma.analyticsVoiceSegment.updateMany({
      data: { joinedAt: new Date(Date.now() - 3600_000) },
    });

    await bot.feuere('voiceStateUpdate', zustand(A, KANAL), zustand(A, null));

    expect(await offeneAbschnitte()).toHaveLength(0);
    const summe = await prisma.analyticsDaily.aggregate({ _sum: { voiceSeconds: true } });
    expect(summe._sum.voiceSeconds).toBeGreaterThanOrEqual(3595);
  });

  it('führt einen Kanalwechsel als eine Sitzung fort', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));
    await bot.feuere('voiceStateUpdate', zustand(A, KANAL), zustand(A, KANAL_2));

    const alle = await prisma.analyticsVoiceSegment.findMany({ where: { guildId: GUILD } });
    expect(alle).toHaveLength(2);
    expect(new Set(alle.map((zeile) => zeile.sessionId)).size).toBe(1);
    expect(await offeneAbschnitte()).toHaveLength(1);

    const tag = await prisma.analyticsDaily.findFirst();
    expect(tag?.voiceSessions).toBe(1);
  });

  it('erzeugt bei Stummschalten keinen zweiten Abschnitt', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));
    // Derselbe Kanal, nur ein anderer Zustand - Discord meldet dasselbe
    // Ereignis wie bei einem Wechsel.
    await bot.feuere('voiceStateUpdate', zustand(A, KANAL), zustand(A, KANAL));

    expect(await prisma.analyticsVoiceSegment.count({ where: { guildId: GUILD } })).toBe(1);
  });

  it('zeichnet einen Musik-Worker nicht als Mitgliederzeit auf', async () => {
    await bot.feuere(
      'voiceStateUpdate',
      zustand(MUSIK_BOT, null, { mitMitglied: true, istBot: true }),
      zustand(MUSIK_BOT, KANAL, { mitMitglied: true, istBot: true }),
    );

    expect(await offeneAbschnitte()).toHaveLength(0);
  });

  it('merkt sich den AFK-Kanal als solchen', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, AFK_KANAL));

    const offen = await offeneAbschnitte();
    expect(offen).toHaveLength(1);
    expect(offen[0]?.isAfk).toBe(true);
  });

  it('schreibt das Ereignis in die Zeitleiste', async () => {
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));

    const ereignis = await prisma.discordEvent.findFirst({ where: { category: 'VOICE' } });
    expect(ereignis?.type).toBe('VOICE_JOIN');
    expect(ereignis?.subjectDiscordId).toBe(A);
  });

  it('zeichnet nichts auf, solange die Sprachaufzeichnung abgeschaltet ist', async () => {
    await konfiguriere({ logVoice: false });
    await bot.feuere('voiceStateUpdate', zustand(A, null), zustand(A, KANAL));

    expect(await offeneAbschnitte()).toHaveLength(0);
  });
});
