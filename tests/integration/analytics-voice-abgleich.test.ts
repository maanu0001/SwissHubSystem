import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_voice_abgleich');

/**
 * Der laufende Abgleich gegen Discord.
 *
 * Die Sprachabschnitte entstanden bis hierher ausschliesslich aus
 * Gateway-Ereignissen. Das setzt voraus, dass kein einziges verlorengeht -
 * und diese Annahme trägt nicht:
 *
 * - Wer während eines Neustarts im Kanal sitzt, löst kein Betreten aus.
 * - Eine wiederaufgenommene Verbindung lässt die Ereignisse der Zwischenzeit
 *   aus.
 * - Die Momentaufnahme beim Start füllt die Lücke genau einmal. Greift sie
 *   daneben - ein Zwischenspeicher, der noch nicht gefüllt war -, bleibt die
 *   Datenbank bei «niemand im Sprachkanal», obwohl der Server voll ist, und
 *   **nichts holt das je nach**.
 *
 * Genau dieser Zustand stand im Dashboard: «Gerade im Sprachkanal: 0» und
 * «0 Sitzungen», während durchgehend Leute im Voice waren.
 *
 * Dieser Abgleich holt es nach, und zwar immer wieder.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const B = '100000000000000002';
const KANAL = '700000000000000010';
const KANAL_2 = '700000000000000011';

const T = (versatzMinuten = 0): Date => new Date(Date.UTC(2026, 8, 23, 12, 0, 0) + versatzMinuten * 60_000);

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

/** Wie der Bot die Anwesenheit meldet. */
type Anwesend = Parameters<typeof analytics.gleicheAnwesenheitAb>[1][number];

const imKanal = (discordId: string, channelId = KANAL): Anwesend => ({
  discordId,
  isBot: false,
  channelId,
  channelName: channelId === KANAL_2 ? 'Zweiter' : 'Treffpunkt',
});

const offene = () =>
  prisma.analyticsVoiceSegment.findMany({
    where: { guildId: GUILD, leftAt: null },
    orderBy: { discordId: 'asc' },
  });

describeWithDatabase('Analytics: laufender Abgleich der Sprachanwesenheit', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState","BotStatus" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
  });

  // --- Der Fall aus dem Dashboard ------------------------------------------

  it('eröffnet einen Abschnitt für jemanden, der ohne Ereignis im Kanal sitzt', async () => {
    // Die Datenbank kennt niemanden, Discord meldet zwei Leute.
    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A), imKanal(B)], T(0));

    expect(ergebnis).toEqual({ eroeffnet: 2, geschlossen: 0, fortgesetzt: 0 });
    expect((await offene()).map((zeile) => zeile.discordId)).toEqual([A, B]);
  });

  it('lässt die Sprachzeit danach wachsen', async () => {
    // Der eigentliche Zweck: ab jetzt zählt die Zeit, ohne dass jemand den
    // Kanal verlassen und neu betreten muss.
    await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(0));

    const scope = {
      guildId: GUILD,
      zeitraum: analytics.aufloesen({ id: '24h', jetzt: T(30) }),
      jetzt: T(30),
    };
    expect((await analytics.statistik.kennzahlen(scope)).sprachSekunden.wert).toBe(1800);
    expect((await analytics.statistik.heute(GUILD, false, T(30))).imSprachkanal).toBe(1);
  });

  it('behauptet keine Zeit vor dem Abgleich', async () => {
    // Wie lange jemand schon dasass, weiss niemand - also wird es nicht
    // erfunden. Gezählt wird ab dem Zeitpunkt, an dem es belegt ist.
    await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(0));

    const abschnitt = (await offene())[0];
    expect(abschnitt?.joinedAt.toISOString()).toBe(T(0).toISOString());
  });

  // --- Nichts anfassen, was stimmt -----------------------------------------

  it('lässt einen passenden Abschnitt unangetastet weiterlaufen', async () => {
    /*
     * Der Normalfall - jede Minute. Würde der Abgleich den Abschnitt
     * schliessen und neu eröffnen, ginge bei jedem Durchgang die bisherige
     * Dauer verloren, und die Sprachzeit käme nie über eine Minute hinaus.
     */
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: KANAL,
      at: T(0),
    });

    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(30));

    expect(ergebnis).toEqual({ eroeffnet: 0, geschlossen: 0, fortgesetzt: 0 });
    const abschnitt = (await offene())[0];
    expect(abschnitt?.joinedAt.toISOString()).toBe(T(0).toISOString());
    // Und die Zeit ist weiterhin vollständig da.
    const scope = {
      guildId: GUILD,
      zeitraum: analytics.aufloesen({ id: '24h', jetzt: T(30) }),
      jetzt: T(30),
    };
    expect((await analytics.statistik.kennzahlen(scope)).sprachSekunden.wert).toBe(1800);
  });

  it('erzeugt bei wiederholtem Lauf keine zweite Sitzung', async () => {
    await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(0));
    await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(1));
    await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(2));

    expect(await prisma.analyticsVoiceSegment.count({ where: { guildId: GUILD } })).toBe(1);
    const tag = await prisma.analyticsDaily.findFirst();
    expect(tag?.voiceSessions).toBe(1);
  });

  // --- Karteileichen --------------------------------------------------------

  it('schliesst einen Abschnitt, zu dem niemand mehr im Kanal sitzt', async () => {
    // Das Verlassen ging verloren - ohne Abgleich zählte diese Sitzung
    // weiter, solange der Bot läuft.
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: KANAL,
      at: T(0),
    });

    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [], T(60));

    expect(ergebnis).toEqual({ eroeffnet: 0, geschlossen: 1, fortgesetzt: 0 });
    expect(await offene()).toHaveLength(0);
    // Die belegte Stunde bleibt verbucht.
    const summe = await prisma.analyticsDaily.aggregate({ _sum: { voiceSeconds: true } });
    expect(summe._sum.voiceSeconds).toBe(3600);
  });

  // --- Unbeobachteter Wechsel ----------------------------------------------

  it('setzt einen unbeobachteten Kanalwechsel als dieselbe Sitzung fort', async () => {
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: KANAL,
      at: T(0),
    });

    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A, KANAL_2)], T(30));

    expect(ergebnis).toEqual({ eroeffnet: 0, geschlossen: 0, fortgesetzt: 1 });
    const alle = await prisma.analyticsVoiceSegment.findMany({ where: { guildId: GUILD } });
    expect(alle).toHaveLength(2);
    expect(new Set(alle.map((zeile) => zeile.sessionId)).size).toBe(1);

    // Eine Sitzung, und die Zeit ist weder verloren noch doppelt.
    const tag = await prisma.analyticsDaily.findFirst();
    expect(tag?.voiceSessions).toBe(1);
    const scope = {
      guildId: GUILD,
      zeitraum: analytics.aufloesen({ id: '24h', jetzt: T(60) }),
      jetzt: T(60),
    };
    expect((await analytics.statistik.kennzahlen(scope)).sprachSekunden.wert).toBe(3600);
  });

  // --- Die bestehenden Regeln gelten ---------------------------------------

  it('eröffnet nichts, solange die Sprachaufzeichnung abgeschaltet ist', async () => {
    await konfiguriere({ logVoice: false });
    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [imKanal(A)], T(0));

    expect(ergebnis.eroeffnet).toBe(0);
    expect(await offene()).toHaveLength(0);
  });

  it('schliesst auch bei abgeschalteter Aufzeichnung, was offensteht', async () => {
    // Sonst bliebe ein Abschnitt für immer stehen, nur weil jemand die
    // Aufzeichnung abgeschaltet hat.
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: KANAL,
      at: T(0),
    });
    await konfiguriere({ logVoice: false });

    await analytics.gleicheAnwesenheitAb(GUILD, [], T(60));
    expect(await offene()).toHaveLength(0);
  });

  it('lässt einen aufgezeichneten Bot in Ruhe weiterlaufen', async () => {
    // Mit «Bots mit aufzeichnen» gehört der Bot dazu. Würde der Abgleich ihn
    // nicht als anwesend sehen, schlösse er dessen Abschnitt jede Minute neu.
    await konfiguriere({ logBots: true });
    const BOT = '800000000000000002';
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: BOT,
      channelId: KANAL,
      isBot: true,
      at: T(0),
    });

    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [{ ...imKanal(BOT), isBot: true }], T(30));

    expect(ergebnis).toEqual({ eroeffnet: 0, geschlossen: 0, fortgesetzt: 0 });
    const abschnitt = (await offene())[0];
    expect(abschnitt?.joinedAt.toISOString()).toBe(T(0).toISOString());
  });

  it('nimmt einen Bot nicht auf', async () => {
    const ergebnis = await analytics.gleicheAnwesenheitAb(
      GUILD,
      [{ ...imKanal('800000000000000001'), isBot: true }],
      T(0),
    );

    expect(ergebnis.eroeffnet).toBe(0);
    expect(await offene()).toHaveLength(0);
  });

  it('kommt mit einer leeren Anwesenheit und leerer Datenbank ohne Wirkung aus', async () => {
    const ergebnis = await analytics.gleicheAnwesenheitAb(GUILD, [], T(0));
    expect(ergebnis).toEqual({ eroeffnet: 0, geschlossen: 0, fortgesetzt: 0 });
  });
});
