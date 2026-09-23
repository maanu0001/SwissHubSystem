import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_sprachzeit');

/**
 * Die Sprachzeit - von Discord bis in die Statistik.
 *
 * Die Kette hat fünf Glieder: das Gateway meldet einen Zustandswechsel, ein
 * Abschnitt wird eröffnet, ein Abschnitt wird geschlossen, die Sekunden
 * werden auf Stunden und Tage verteilt, die Statistik liest sie. Der Bruch
 * lag nicht in einem dieser Glieder, sondern in der Lücke dazwischen: beim
 * Neustart wurde nur geschlossen und nie wieder eröffnet.
 *
 * Wer während eines Deployments im Kanal sass, hatte danach keinen offenen
 * Abschnitt mehr - und der Bot hatte seinen Beitritt nie gesehen. Seine Zeit
 * lief weiter, gezählt wurde nichts, bis er den Kanal verliess und neu
 * betrat. Nach jedem Deployment war die laufende Sprachzeit weg.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const B = '100000000000000002';
const MUSIK_BOT = '800000000000000001';

const KANAL = '700000000000000010';
const KANAL_2 = '700000000000000011';
const AFK_KANAL = '700000000000000099';

const T = (versatzMinuten = 0): Date => new Date(Date.UTC(2026, 7, 20, 12, 0, 0) + versatzMinuten * 60_000);

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

/** Betreten - wie es der Gateway-Handler tut. */
async function betritt(
  discordId: string,
  at: Date,
  channelId = KANAL,
  extras: Record<string, unknown> = {},
): Promise<string | null> {
  return analytics.starteSprachAbschnitt({
    guildId: GUILD,
    discordId,
    isBot: false,
    channelId,
    channelName: 'Treffpunkt',
    at,
    ...extras,
  });
}

async function verlaesst(discordId: string, at: Date): Promise<string | null> {
  return (await analytics.beendeSprachAbschnitt(GUILD, discordId, at)).sessionId;
}

/** Die Sekunden, die in der Tagesstatistik angekommen sind. */
async function sekundenGesamt(): Promise<number> {
  const summe = await prisma.analyticsDaily.aggregate({
    where: { guildId: GUILD },
    _sum: { voiceSeconds: true },
  });
  return summe._sum.voiceSeconds ?? 0;
}

async function sekundenVon(discordId: string): Promise<number> {
  const summe = await prisma.analyticsUserDaily.aggregate({
    where: { guildId: GUILD, discordId },
    _sum: { voiceSeconds: true },
  });
  return summe._sum.voiceSeconds ?? 0;
}

async function sitzungen(discordId: string): Promise<number> {
  const summe = await prisma.analyticsUserDaily.aggregate({
    where: { guildId: GUILD, discordId },
    _sum: { voiceSessions: true },
  });
  return summe._sum.voiceSessions ?? 0;
}

/** Den letzten Herzschlag setzen - so weit reicht das Wissen des Bots. */
async function herzschlag(at: Date): Promise<void> {
  await prisma.botStatus.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', online: false, lastHeartbeatAt: at },
    update: { lastHeartbeatAt: at },
  });
}

describeWithDatabase('Analytics: Sprachzeit', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState","BotStatus" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
  });

  // --- Betreten und Verlassen ----------------------------------------------

  it('erfasst zehn Minuten als zehn Minuten', async () => {
    await betritt(A, T(0));
    await verlaesst(A, T(10));

    expect(await sekundenGesamt()).toBe(600);
    expect(await sekundenVon(A)).toBe(600);
    expect(await sitzungen(A)).toBe(1);
  });

  it('rechnet auf die Sekunde und nicht auf ganze Minuten', async () => {
    // Ein Minutenzähler verlöre bei jedem Betreten bis zu 59 Sekunden.
    await betritt(A, T(0));
    await verlaesst(A, new Date(T(0).getTime() + 95_000));

    expect(await sekundenVon(A)).toBe(95);
  });

  it('schreibt den Abschnitt mit Anfang, Ende und Dauer fest', async () => {
    await betritt(A, T(0));
    await verlaesst(A, T(10));

    const abschnitt = await prisma.analyticsVoiceSegment.findFirstOrThrow({
      where: { guildId: GUILD, discordId: A },
    });
    expect(abschnitt.joinedAt.toISOString()).toBe(T(0).toISOString());
    expect(abschnitt.leftAt?.toISOString()).toBe(T(10).toISOString());
    expect(abschnitt.seconds).toBe(600);
  });

  it('lässt einen laufenden Abschnitt offen, statt ihn schon zu verbuchen', async () => {
    // Läuft die Zeit fortlaufend mit, wüchse ein bereits abgeschlossener Tag
    // noch nachträglich.
    await betritt(A, T(0));

    const abschnitt = await prisma.analyticsVoiceSegment.findFirstOrThrow({ where: { discordId: A } });
    expect(abschnitt.leftAt).toBeNull();
    expect(abschnitt.seconds).toBeNull();
    expect(await sekundenGesamt()).toBe(0);
  });

  // --- Kanalwechsel ---------------------------------------------------------

  it('zählt einen Kanalwechsel nicht doppelt', async () => {
    /*
     * Zehn Minuten in A, zehn in B - zwanzig insgesamt und nicht dreissig.
     * Der Abschnitt endet, die Sitzung läuft unter derselben Kennung weiter:
     * so bekommt die Kanalstatistik ihre Zeit richtig aufgeteilt und die
     * Sitzungszahl bleibt eine Sitzung.
     */
    await betritt(A, T(0), KANAL);
    const sessionId = await verlaesst(A, T(10));
    await betritt(A, T(10), KANAL_2, { sessionId: sessionId ?? undefined });
    await verlaesst(A, T(20));

    expect(await sekundenVon(A)).toBe(1200);
    expect(await sitzungen(A)).toBe(1);

    const proKanal = await prisma.analyticsChannelDaily.findMany({
      where: { guildId: GUILD },
      orderBy: { channelId: 'asc' },
    });
    expect(proKanal.map((zeile) => [zeile.channelId, zeile.voiceSeconds])).toEqual([
      [KANAL, 600],
      [KANAL_2, 600],
    ]);
  });

  it('führt beide Abschnitte eines Wechsels unter derselben Sitzung', async () => {
    await betritt(A, T(0), KANAL);
    const sessionId = await verlaesst(A, T(10));
    await betritt(A, T(10), KANAL_2, { sessionId: sessionId ?? undefined });
    await verlaesst(A, T(20));

    const abschnitte = await prisma.analyticsVoiceSegment.findMany({ where: { discordId: A } });
    expect(abschnitte).toHaveLength(2);
    expect(new Set(abschnitte.map((zeile) => zeile.sessionId)).size).toBe(1);
  });

  // --- Stumm, taub, Stream --------------------------------------------------

  it('erzeugt bei Stummschalten keinen neuen Abschnitt', async () => {
    /*
     * Discord meldet Stumm-, Taub- und Streamzustände über dasselbe
     * Ereignis wie einen Kanalwechsel. Wer daraufhin einen Abschnitt
     * beendet und einen neuen beginnt, zählt jede Sitzung in Stücke und
     * erfindet Sitzungen, die es nicht gab.
     *
     * Die Unterscheidung steht im Gateway-Handler: bleibt der Kanal
     * derselbe, geschieht hier gar nichts. Dieser Test hält fest, was das
     * für die Daten heisst.
     */
    await betritt(A, T(0));
    // Kein Aufruf - genau das ist der Punkt.
    await verlaesst(A, T(30));

    expect(await prisma.analyticsVoiceSegment.count({ where: { discordId: A } })).toBe(1);
    expect(await sitzungen(A)).toBe(1);
    expect(await sekundenVon(A)).toBe(1800);
  });

  // --- Neustart -------------------------------------------------------------

  it('zählt nach einem Neustart weiter, wer noch im Kanal sitzt', async () => {
    /*
     * Der eigentliche Fehler. A sitzt seit einer Stunde im Kanal, der Bot
     * startet neu und ist zehn Minuten weg. Danach:
     *
     * - die Stunde bis zum letzten Herzschlag ist gezählt,
     * - die zehn Minuten Ausfall sind es nicht,
     * - und ab jetzt läuft wieder ein Abschnitt.
     *
     * Vorher fehlte der letzte Punkt: A sass weiter im Kanal, aber nichts
     * zählte mehr mit.
     */
    await betritt(A, T(0));
    await herzschlag(T(60));

    const ergebnis = await analytics.gleicheSprachabschnitteAb(GUILD, [
      { discordId: A, isBot: false, channelId: KANAL, channelName: 'Treffpunkt' },
    ]);

    expect(ergebnis).toEqual({ geschlossen: 1, begonnen: 1 });
    expect(await sekundenVon(A)).toBe(3600);

    const offen = await prisma.analyticsVoiceSegment.findFirstOrThrow({
      where: { discordId: A, leftAt: null },
    });
    expect(offen.channelId).toBe(KANAL);
  });

  it('führt die Sitzung über den Neustart hinweg fort', async () => {
    // Sonst wäre jedes Deployment eine Welle neuer Sprachsitzungen in der
    // Statistik - und «Sitzungen pro Tag» sagte etwas über unsere
    // Deployments aus statt über den Server.
    await betritt(A, T(0));
    await herzschlag(T(60));
    await analytics.gleicheSprachabschnitteAb(GUILD, [{ discordId: A, isBot: false, channelId: KANAL }]);

    const abschnitte = await prisma.analyticsVoiceSegment.findMany({ where: { discordId: A } });
    expect(abschnitte).toHaveLength(2);
    expect(new Set(abschnitte.map((zeile) => zeile.sessionId)).size).toBe(1);
    expect(await sitzungen(A)).toBe(1);
  });

  it('schreibt die Ausfallzeit niemandem gut', async () => {
    // Bis jetzt zu zählen hiesse, aus drei Tagen Ausfall drei Tage
    // Sprachzeit zu machen.
    await betritt(A, T(0));
    await herzschlag(T(10));

    await analytics.gleicheSprachabschnitteAb(GUILD, [{ discordId: A, isBot: false, channelId: KANAL }]);
    // Der neue Abschnitt beginnt jetzt und ist noch offen - verbucht ist
    // ausschliesslich die belegte Zeit bis zum letzten Herzschlag.
    expect(await sekundenVon(A)).toBe(600);
  });

  it('schliesst den Abschnitt, wer während des Neustarts gegangen ist', async () => {
    await betritt(A, T(0));
    await betritt(B, T(0));
    await herzschlag(T(30));

    // Nur A sitzt noch da.
    const ergebnis = await analytics.gleicheSprachabschnitteAb(GUILD, [
      { discordId: A, isBot: false, channelId: KANAL },
    ]);

    expect(ergebnis.geschlossen).toBe(2);
    expect(ergebnis.begonnen).toBe(1);
    expect(await sekundenVon(B)).toBe(1800);
    expect(await prisma.analyticsVoiceSegment.count({ where: { discordId: B, leftAt: null } })).toBe(0);
  });

  it('beginnt für jemanden, der während des Ausfalls dazukam, eine neue Sitzung', async () => {
    await herzschlag(T(30));

    const ergebnis = await analytics.gleicheSprachabschnitteAb(GUILD, [
      { discordId: B, isBot: false, channelId: KANAL },
    ]);

    expect(ergebnis).toEqual({ geschlossen: 0, begonnen: 1 });
    expect(await sitzungen(B)).toBe(1);
  });

  it('lässt keinen Abschnitt unendlich offen', async () => {
    // Zwei Neustarts hintereinander dürfen keine zwei offenen Abschnitte
    // derselben Person hinterlassen.
    await betritt(A, T(0));
    await herzschlag(T(10));
    await analytics.gleicheSprachabschnitteAb(GUILD, [{ discordId: A, isBot: false, channelId: KANAL }]);
    await herzschlag(new Date());
    await analytics.gleicheSprachabschnitteAb(GUILD, [{ discordId: A, isBot: false, channelId: KANAL }]);

    expect(await prisma.analyticsVoiceSegment.count({ where: { discordId: A, leftAt: null } })).toBe(1);
  });

  it('schliesst beim Herunterfahren alles, auch die Anwesenden', async () => {
    // Nach einem sauberen Stopp muss niemand später schätzen.
    await betritt(A, T(0));
    await betritt(B, T(0));
    await herzschlag(T(20));

    expect(await analytics.schliesseVerwaisteAbschnitte(GUILD)).toBe(2);
    expect(await prisma.analyticsVoiceSegment.count({ where: { leftAt: null } })).toBe(0);
    expect(await sekundenGesamt()).toBe(2400);
  });

  it('erzeugt keine negative Zeit, wenn der Abschnitt jünger ist als der Herzschlag', async () => {
    // Der Bot schreibt einen Herzschlag, jemand betritt den Kanal, der Bot
    // stürzt ab: das Ende läge dann vor dem Anfang.
    await herzschlag(T(0));
    await betritt(A, T(10));

    await analytics.gleicheSprachabschnitteAb(GUILD, []);

    expect(await sekundenVon(A)).toBe(0);
    const abschnitt = await prisma.analyticsVoiceSegment.findFirstOrThrow({ where: { discordId: A } });
    expect(abschnitt.seconds).toBe(0);
  });

  // --- Wer zählt ------------------------------------------------------------

  it('zählt einen Musik-Worker nicht als Mitgliederaktivität', async () => {
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: MUSIK_BOT,
      isBot: true,
      channelId: KANAL,
      at: T(0),
    });
    await verlaesst(MUSIK_BOT, T(60));

    expect(await sekundenVon(MUSIK_BOT)).toBe(0);
    expect(await sekundenGesamt()).toBe(0);
  });

  it('nimmt einen Bot auch beim Abgleich nach dem Neustart nicht auf', async () => {
    await herzschlag(T(10));

    const ergebnis = await analytics.gleicheSprachabschnitteAb(GUILD, [
      { discordId: MUSIK_BOT, isBot: true, channelId: KANAL },
      { discordId: A, isBot: false, channelId: KANAL },
    ]);

    expect(ergebnis.begonnen).toBe(1);
    expect(await prisma.analyticsVoiceSegment.count({ where: { discordId: MUSIK_BOT } })).toBe(0);
  });

  it('zählt Zeit im AFK-Kanal als Anwesenheit, nicht als Sprachzeit', async () => {
    await betritt(A, T(0), AFK_KANAL, { isAfk: true });
    await verlaesst(A, T(60));

    expect(await sekundenVon(A)).toBe(0);
    // Der Abschnitt bleibt als Beleg stehen.
    expect(await prisma.analyticsVoiceSegment.count({ where: { discordId: A, isAfk: true } })).toBe(1);
  });

  it('zählt nichts, solange die Sprachaufzeichnung abgeschaltet ist', async () => {
    await konfiguriere({ logVoice: false });

    expect(await betritt(A, T(0))).toBeNull();
    await verlaesst(A, T(60));
    expect(await sekundenGesamt()).toBe(0);
  });

  it('zählt nichts in einem ausgenommenen Kanal', async () => {
    await konfiguriere({ ignoredChannelIds: [KANAL] });

    expect(await betritt(A, T(0), KANAL)).toBeNull();
    expect(await sekundenGesamt()).toBe(0);
  });

  // --- Die Statistik liest dieselben Zahlen ---------------------------------

  it('zeigt die neue Sprachzeit in der Statistik', async () => {
    await betritt(A, T(0));
    await verlaesst(A, T(90));
    await betritt(B, T(0));
    await verlaesst(B, T(30));

    const scope = { guildId: GUILD, zeitraum: analytics.aufloesen({ id: '30d', jetzt: T(120) }) };
    const zahlen = await analytics.statistik.kennzahlen(scope);
    expect(zahlen.sprachSekunden.wert).toBe(90 * 60 + 30 * 60);

    const rangliste = await analytics.statistik.topMitglieder(scope, 'voice');
    expect(rangliste.map((zeile) => [zeile.discordId, zeile.sprachSekunden])).toEqual([
      [A, 5400],
      [B, 1800],
    ]);
  });

  it('zeigt die laufende Sitzung als aktuelle Anwesenheit', async () => {
    await betritt(A, T(0));

    expect((await analytics.statistik.heute(GUILD)).imSprachkanal).toBe(1);

    await verlaesst(A, T(10));
    expect((await analytics.statistik.heute(GUILD)).imSprachkanal).toBe(0);
  });

  it('verteilt eine Sitzung über Mitternacht auf beide Tage', async () => {
    const abends = new Date(Date.UTC(2026, 7, 20, 21, 30, 0));
    const nachts = new Date(Date.UTC(2026, 7, 20, 23, 30, 0));
    await betritt(A, abends);
    await verlaesst(A, nachts);

    const tage = await prisma.analyticsDaily.findMany({
      where: { guildId: GUILD },
      orderBy: { day: 'asc' },
    });
    expect(tage).toHaveLength(2);
    expect(tage.reduce((summe, zeile) => summe + zeile.voiceSeconds, 0)).toBe(7200);
  });
});
