import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_backfill_grenze');

/**
 * Der Backfill endet, wo die Live-Aufzeichnung beginnt.
 *
 * ## Was hier schiefging
 *
 * Der Backfill ist wiederholbar, weil er den bearbeiteten Bereich vorher
 * **ausräumt** und neu schreibt. Das trägt nur, solange dort ausschliesslich
 * seine eigenen Zahlen stehen.
 *
 * Der Job rief ihn aber alle fünf Minuten mit `bis = jetzt` auf.
 * Ausgeräumt wurde **tageweise**, nachgezogen nur das Fenster der letzten
 * fünf Minuten. Damit stand die gesamte Sprachzeit des Tages alle fünf
 * Minuten wieder auf null, und die laufenden Abschnitte waren gelöscht.
 *
 * Nachrichten blieben stehen - die rührt der Backfill nie an. Genau so sah
 * es im Dashboard aus: «Nachrichten 374», «Sprachzeit 0.0 h», «Gerade im
 * Sprachkanal 0». Und beim Neuladen war der Zähler wieder auf null, weil
 * serverseitig tatsächlich nichts mehr dastand.
 *
 * Die Regel jetzt: der Lauf bearbeitet nur Tage, die **vor** dem Beginn der
 * Live-Aufzeichnung abgeschlossen waren. Danach gehört der Zeitraum der
 * Messung, und eine Messung ist besser als jede Rekonstruktion.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const B = '100000000000000002';
const KANAL = '700000000000000010';

/** Mitten am Tag, damit nichts an einer Tagesgrenze klebt. */
const T = (versatzMinuten = 0): Date => new Date(Date.UTC(2026, 8, 23, 12, 0, 0) + versatzMinuten * 60_000);
/** Tage zurück - sicher vor dem Beginn der Aufzeichnung. */
const TAGE = (zurueck: number): Date => new Date(T(0).getTime() - zurueck * 86_400_000);

async function konfiguriere(): Promise<void> {
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
    },
    'test',
  );
}

async function ereignis(type: string, subject: string, at: Date, channelId?: string): Promise<void> {
  await prisma.discordEvent.create({
    data: {
      guildId: GUILD,
      category: type.startsWith('VOICE') ? 'VOICE' : 'MEMBER',
      type,
      subjectDiscordId: subject,
      channelId: channelId ?? null,
      channelName: channelId ? 'Treffpunkt' : null,
      occurredAt: at,
    },
  });
}

const voiceSekunden = async (): Promise<number> =>
  (await prisma.analyticsDaily.aggregate({ _sum: { voiceSeconds: true } }))._sum.voiceSeconds ?? 0;

const sitzungen = async (): Promise<number> =>
  (await prisma.analyticsDaily.aggregate({ _sum: { voiceSessions: true } }))._sum.voiceSessions ?? 0;

/** Wie der Job ihn aufruft: ohne «bis», also bis jetzt. */
const laufWieImJob = async (): Promise<void> => {
  await analytics.backfill(GUILD, { maxStapel: 20 });
};

describeWithDatabase('Analytics-Backfill: die Grenze zur Live-Aufzeichnung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordEvent","AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
  });

  // --- Der gemeldete Fall ---------------------------------------------------

  it('lässt eine gemessene Stunde Sprachzeit stehen', async () => {
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-120) });
    await analytics.beendeSprachAbschnitt(GUILD, A, T(-60));
    expect(await voiceSekunden()).toBe(3600);

    await laufWieImJob();

    expect(await voiceSekunden()).toBe(3600);
    expect(await sitzungen()).toBe(1);
  });

  it('löscht keinen laufenden Abschnitt', async () => {
    // Der Grund für «Gerade im Sprachkanal: 0»: wer gerade dasitzt, hat noch
    // kein Verlassen im Protokoll und war damit aus Sicht des Backfills
    // nicht rekonstruierbar - gelöscht wurde er trotzdem.
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-2) });

    await laufWieImJob();

    expect(await prisma.analyticsVoiceSegment.count({ where: { leftAt: null } })).toBe(1);
  });

  it('bleibt auch nach mehreren Durchgängen dabei', async () => {
    // Der Job läuft alle fünf Minuten. Einmal harmlos genügt nicht.
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-120) });
    await analytics.beendeSprachAbschnitt(GUILD, A, T(-60));
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: B, channelId: KANAL, at: T(-10) });

    for (let runde = 0; runde < 5; runde += 1) {
      await laufWieImJob();
    }

    expect(await voiceSekunden()).toBe(3600);
    expect(await prisma.analyticsVoiceSegment.count({ where: { leftAt: null } })).toBe(1);
  });

  it('lässt Beitritte und Austritte des laufenden Tages stehen', async () => {
    // Dieselbe Räumung traf auch die Mitgliederzahlen.
    await analytics.zaehleBeitritt(GUILD, A, T(-120));
    await analytics.zaehleAustritt(GUILD, B, T(-90));

    await laufWieImJob();

    const tag = await prisma.analyticsDaily.findFirst({ where: { guildId: GUILD } });
    expect(tag?.joins).toBe(1);
    expect(tag?.leaves).toBe(1);
  });

  it('lässt die Nachrichten des Tages stehen', async () => {
    await analytics.zaehleNachricht({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-30) });

    await laufWieImJob();

    const tag = await prisma.analyticsDaily.findFirst({ where: { guildId: GUILD } });
    expect(tag?.messages).toBe(1);
  });

  // --- Die Grenze selbst ----------------------------------------------------

  it('kommt über den Beginn der Aufzeichnung nicht hinaus', async () => {
    await analytics.zaehleNachricht({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-30) });

    await laufWieImJob();

    const stand = await prisma.analyticsTracking.findUnique({ where: { guildId: GUILD } });
    // Höchstens bis zum Beginn des Tages, an dem die Aufzeichnung einsetzte.
    expect(stand?.backfilledUntil).not.toBeNull();
    expect(stand!.backfilledUntil!.getTime()).toBeLessThanOrEqual(T(-30).getTime());
  });

  it('zieht die abgeschlossenen Tage davor weiterhin nach', async () => {
    // Die eigentliche Aufgabe bleibt: was vor der Aufzeichnung geschah, wird
    // aus dem Ereignisprotokoll rekonstruiert.
    await ereignis('VOICE_JOIN', A, TAGE(3), KANAL);
    await ereignis('VOICE_LEAVE', A, new Date(TAGE(3).getTime() + 3600_000), KANAL);
    await ereignis('MEMBER_JOIN', B, TAGE(4));
    // Ab heute wird gemessen.
    await analytics.zaehleNachricht({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-30) });

    const ergebnis = await laufWieImJob().then(() => analytics.trackingStand(GUILD));

    expect(ergebnis?.backfilledUntil).not.toBeNull();
    expect(await voiceSekunden()).toBe(3600);
    const beitritte = await prisma.analyticsDaily.aggregate({ _sum: { joins: true } });
    expect(beitritte._sum.joins).toBe(1);
  });

  it('räumt dabei weiterhin auf, was er selbst geschrieben hat', async () => {
    /*
     * Die Wiederholbarkeit bleibt: derselbe Bereich zweimal bearbeitet ergibt
     * dieselben Zahlen. Nur räumt er jetzt ausschliesslich seine eigenen
     * Abschnitte weg - erkennbar an der Sitzungskennung.
     */
    await ereignis('VOICE_JOIN', A, TAGE(3), KANAL);
    await ereignis('VOICE_LEAVE', A, new Date(TAGE(3).getTime() + 3600_000), KANAL);
    await analytics.zaehleNachricht({ guildId: GUILD, discordId: A, channelId: KANAL, at: T(-30) });

    await laufWieImJob();
    const ersteSekunden = await voiceSekunden();

    await prisma.analyticsTracking.updateMany({ where: { guildId: GUILD }, data: { backfilledUntil: null } });
    await laufWieImJob();

    expect(await voiceSekunden()).toBe(ersteSekunden);
    expect(ersteSekunden).toBe(3600);
    // Und nicht zwei Abschnitte für dieselbe Stunde.
    expect(await prisma.analyticsVoiceSegment.count()).toBe(1);
  });

  it('fasst einen gemessenen Abschnitt auch innerhalb seines Fensters nicht an', async () => {
    /*
     * Der Fall, den die Grenze allein nicht deckt.
     *
     * Auf einer Installation, die älter ist als die Marke `voiceSince`, gibt
     * es gemessene Sprachabschnitte ohne diese Marke. Die Grenze ergibt sich
     * dann aus den Nachrichten - und die alten Abschnitte liegen mitten im
     * Fenster des Backfills.
     *
     * Er lässt sie trotzdem stehen: eine Messung trägt keine
     * Backfill-Kennung, und eine solche Kennung ist das Einzige, woran er
     * sein eigenes Werk erkennt.
     */
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: A, channelId: KANAL, at: TAGE(5) });
    await analytics.beendeSprachAbschnitt(GUILD, A, new Date(TAGE(5).getTime() + 600_000));
    const gemessen = await prisma.analyticsVoiceSegment.findFirstOrThrow();

    // Wie auf einer alten Installation: keine Sprachmarke, nur Nachrichten.
    await analytics.zaehleNachricht({ guildId: GUILD, discordId: B, channelId: KANAL, at: T(-30) });
    await prisma.analyticsTracking.updateMany({
      where: { guildId: GUILD },
      data: { voiceSince: null, backfilledUntil: null },
    });

    await laufWieImJob();

    const nachher = await prisma.analyticsVoiceSegment.findUnique({ where: { id: gemessen.id } });
    expect(nachher, 'der gemessene Abschnitt muss den Lauf überleben').not.toBeNull();
    expect(nachher?.seconds).toBe(600);
  });

  it('fasst einen gemessenen, abgeschlossenen Abschnitt nicht an', async () => {
    // Auch wenn er im Zeitfenster liegt: er trägt keine Backfill-Kennung.
    await analytics.starteSprachAbschnitt({ guildId: GUILD, discordId: A, channelId: KANAL, at: TAGE(3) });
    await analytics.beendeSprachAbschnitt(GUILD, A, new Date(TAGE(3).getTime() + 600_000));
    const vorher = await prisma.analyticsVoiceSegment.findFirstOrThrow();

    await prisma.analyticsTracking.updateMany({ where: { guildId: GUILD }, data: { backfilledUntil: null } });
    await laufWieImJob();

    const nachher = await prisma.analyticsVoiceSegment.findUnique({ where: { id: vorher.id } });
    expect(nachher).not.toBeNull();
    expect(nachher?.seconds).toBe(600);
  });
});
