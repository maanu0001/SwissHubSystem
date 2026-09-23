import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_resolver');

/**
 * Woher die Zahlen eines Rueckblicks kommen.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Der Resolver rechnet zu grossen Teilen in SQL - Ueberschneidungen im
 * Sprachkanal, Tagesgruppen ueber Zeitzonen, gefilterte Zaehlungen. Eine
 * Nachbildung von Prisma wuerde davon nichts pruefen ausser sich selbst.
 *
 * ## Was hier besonders zaehlt
 *
 * Die Grenzen. Ein Jahresrueckblick steht und faellt damit, dass der
 * Jahreswechsel stimmt: wer am 31.12. um 23:00 in den Sprachkanal geht und
 * am 1.1. um 02:00 wieder raus, hat eine Stunde im alten Jahr und zwei im
 * neuen - nicht drei in einem davon und nicht null.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const BOT = '800000000000000001';

const zeitraum = {
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2027-01-01T00:00:00Z'),
  year: 2026,
};

const VOLL = {
  lage: 'vollstaendig' as const,
  seit: null,
  abdeckung: 1,
};
const quellen = {
  voice: VOLL,
  messages: VOLL,
  level: VOLL,
  clips: VOLL,
  events: VOLL,
  tournaments: VOLL,
  games: VOLL,
};
const kontext = { guildId: GUILD, zeitraum, quellen };

async function leeren(): Promise<void> {
  await prisma.analyticsVoiceSegment.deleteMany({});
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsMemberProfile.deleteMany({});
  await prisma.xpTransaction.deleteMany({});
  await prisma.levelProfile.deleteMany({});
  await prisma.wrappedSnapshot.deleteMany({});
  await prisma.wrappedScene.deleteMany({});
  await prisma.wrappedGenerationRun.deleteMany({});
  await prisma.wrappedCampaign.deleteMany({});
}

async function person(discordId: string, name: string, isBot = false): Promise<void> {
  await prisma.analyticsMemberProfile.create({
    data: { guildId: GUILD, discordId, username: name.toLowerCase(), displayName: name, isBot },
  });
}

async function tag(discordId: string, day: string, messages: number, voiceSeconds: number): Promise<void> {
  await prisma.analyticsUserDaily.create({
    data: {
      guildId: GUILD,
      discordId,
      day: new Date(day),
      messages,
      voiceSeconds,
      voiceSessions: voiceSeconds > 0 ? 1 : 0,
    },
  });
}

async function abschnitt(
  discordId: string,
  sessionId: string,
  channelId: string,
  channelName: string,
  von: string,
  bis: string | null,
  optionen: { isAfk?: boolean; isBot?: boolean } = {},
): Promise<void> {
  await prisma.analyticsVoiceSegment.create({
    data: {
      guildId: GUILD,
      sessionId,
      discordId,
      channelId,
      channelName,
      joinedAt: new Date(von),
      leftAt: bis ? new Date(bis) : null,
      seconds: bis ? Math.round((new Date(bis).getTime() - new Date(von).getTime()) / 1000) : null,
      isAfk: optionen.isAfk ?? false,
      isBot: optionen.isBot ?? false,
    },
  });
}

describeWithDatabase('Wrapped: Sprachzeit', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await person(ANNA, 'Anna');
    await person(BEN, 'Ben');
  });

  it('summiert die Abschnitte und erkennt die längste Sitzung', async () => {
    await abschnitt(ANNA, 's1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T20:00:00Z');
    // Dieselbe Sitzung, anderer Kanal - das ist ein Wechsel, kein Ende.
    await abschnitt(ANNA, 's1', 'c2', 'Chill', '2026-03-01T20:00:00Z', '2026-03-01T21:30:00Z');
    await abschnitt(ANNA, 's2', 'c1', 'Gaming 1', '2026-05-04T19:00:00Z', '2026-05-04T20:00:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);

    expect(daten.voice.seconds).toBe(3.5 * 3600 + 3600);
    expect(daten.voice.sessions).toBe(2);
    // Die Sitzung, nicht der Abschnitt: 2h + 1.5h gehören zusammen.
    expect(daten.voice.longestSessionSeconds).toBe(3.5 * 3600);
    expect(daten.voice.topChannels[0]).toMatchObject({ name: 'Gaming 1', seconds: 3 * 3600 });
  });

  it('schneidet Abschnitte am Jahreswechsel korrekt ab', async () => {
    /*
     * Der Fall, an dem eine naive Rechnung scheitert.
     *
     * 23:00 UTC am 31.12. bis 02:00 UTC am 1.1.: eine Stunde gehört ins alte
     * Jahr, zwei ins neue. Wer den ganzen Abschnitt dem Jahr seines Beginns
     * zuschlägt, zählt hier drei Stunden zu viel.
     */
    await abschnitt(ANNA, 'sylvester', 'c1', 'Gaming 1', '2025-12-31T23:00:00Z', '2026-01-01T02:00:00Z');
    await abschnitt(ANNA, 'neujahr', 'c1', 'Gaming 1', '2026-12-31T22:00:00Z', '2027-01-01T04:00:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);

    // 2 Stunden aus der Silvesternacht + 2 Stunden bis Mitternacht am Jahresende.
    expect(daten.voice.seconds).toBe(2 * 3600 + 2 * 3600);
  });

  it('lässt AFK-Zeit aussen vor - dieselbe Regel wie die Statistik', async () => {
    await abschnitt(ANNA, 's1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T19:00:00Z');
    await abschnitt(ANNA, 's2', 'afk', 'AFK', '2026-03-01T19:00:00Z', '2026-03-01T23:00:00Z', {
      isAfk: true,
    });

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.voice.seconds).toBe(3600);
    expect(daten.voice.topChannels.map((kanal) => kanal.name)).not.toContain('AFK');
  });

  it('verteilt die Zeit über die Stundengrenzen', async () => {
    // 22:40 bis 00:20 UTC - das sind drei Stunden-Töpfe, nicht einer.
    await abschnitt(ANNA, 's1', 'c1', 'Gaming 1', '2026-06-10T20:40:00Z', '2026-06-10T22:20:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    const summe = daten.voice.hours.reduce((a, b) => a + b, 0);
    expect(summe).toBe(100 * 60);
    // Im Sommer ist Zürich UTC+2: 22:40 bis 00:20 Zürcher Zeit.
    expect(daten.voice.hours[22]).toBe(20 * 60);
    expect(daten.voice.hours[23]).toBe(60 * 60);
    expect(daten.voice.hours[0]).toBe(20 * 60);
  });

  it('erkennt, mit wem jemand im Kanal sass', async () => {
    await abschnitt(ANNA, 'a1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T22:00:00Z');
    // Ben überschneidet sich mit zwei Stunden.
    await abschnitt(BEN, 'b1', 'c1', 'Gaming 1', '2026-03-01T20:00:00Z', '2026-03-01T23:00:00Z');
    // Gleiche Zeit, anderer Kanal - das zählt nicht.
    await abschnitt(BOT, 'x1', 'c9', 'Anderer', '2026-03-01T18:00:00Z', '2026-03-01T22:00:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);

    expect(daten.voice.mates).toHaveLength(1);
    expect(daten.voice.mates[0]).toMatchObject({ discordId: BEN, displayName: 'Ben' });
    expect(daten.voice.mates[0]?.sharedSecondsRounded).toBe(2 * 3600);
  });

  it('zählt Bots nicht als Mates', async () => {
    await person(BOT, 'Musikbot', true);
    await abschnitt(ANNA, 'a1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T22:00:00Z');
    await abschnitt(BOT, 'b1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T22:00:00Z', {
      isBot: true,
    });

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    // Der Musikbot ist niemandes bester Kumpel.
    expect(daten.voice.mates).toHaveLength(0);
  });

  it('rundet die gemeinsame Zeit gröber als sekundengenau', async () => {
    // 1 Stunde und 3 Minuten Überschneidung - gerundet auf fünf Minuten.
    await abschnitt(ANNA, 'a1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T19:03:00Z');
    await abschnitt(BEN, 'b1', 'c1', 'Gaming 1', '2026-03-01T18:00:00Z', '2026-03-01T19:03:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    const geteilt = daten.voice.mates[0]?.sharedSecondsRounded ?? -1;
    expect(geteilt).toBeGreaterThan(0);
    expect(geteilt % 300).toBe(0);
  });
});

describeWithDatabase('Wrapped: Tage, Nachrichten und Serien', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await person(ANNA, 'Anna');
  });

  it('zählt aktive Tage aus Nachrichten oder Sprachzeit', async () => {
    await tag(ANNA, '2026-03-01', 120, 7200);
    await tag(ANNA, '2026-03-02', 0, 3600);
    await tag(ANNA, '2026-03-03', 14, 0);
    // Eine Zeile mit lauter Nullen ist kein aktiver Tag.
    await tag(ANNA, '2026-03-04', 0, 0);

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.aktivitaet.activeDays).toBe(3);
    expect(daten.messages.total).toBe(134);
    expect(daten.messages.daysWithMessages).toBe(2);
    expect(daten.messages.bestDay).toMatchObject({ day: '2026-03-01', messages: 120 });
  });

  it('findet die längste Serie aufeinanderfolgender Tage', async () => {
    for (const day of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06']) {
      await tag(ANNA, day, 5, 0);
    }
    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.aktivitaet.longestStreak).toBe(3);
  });

  it('zerbricht die Serie nicht an der Zeitumstellung', async () => {
    /*
     * Am 29. März 2026 werden die Uhren vorgestellt - zwischen den beiden
     * Mitternachten liegen 23 Stunden. Eine Serie, die über den Abstand
     * zweier Zeitpunkte rechnet, reisst genau hier.
     */
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30']) {
      await tag(ANNA, day, 3, 0);
    }
    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.aktivitaet.longestStreak).toBe(3);
  });

  it('ignoriert Tage ausserhalb des Zeitraums', async () => {
    await tag(ANNA, '2025-12-31', 500, 0);
    await tag(ANNA, '2026-01-01', 10, 0);
    await tag(ANNA, '2027-01-01', 500, 0);

    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.messages.total).toBe(10);
    expect(daten.aktivitaet.activeDays).toBe(1);
  });
});

describeWithDatabase('Wrapped: Level aus dem Journal', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await person(ANNA, 'Anna');
  });

  async function buchung(xp: number, levelVorher: number, levelNachher: number, wann: string): Promise<void> {
    const profil = await prisma.levelProfile.upsert({
      where: { discordId: ANNA },
      create: { discordId: ANNA, username: 'anna', displayName: 'Anna' },
      update: {},
    });
    await prisma.xpTransaction.create({
      data: {
        profileId: profil.id,
        discordId: ANNA,
        source: 'MESSAGE',
        delta: xp,
        requestedDelta: xp,
        xpBefore: 0,
        xpAfter: xp,
        levelBefore: levelVorher,
        levelAfter: levelNachher,
        createdAt: new Date(wann),
      },
    });
  }

  it('liest Anfang und Ende aus den Buchungen des Zeitraums', async () => {
    await buchung(100, 4, 4, '2025-11-01T10:00:00Z');
    await buchung(500, 5, 7, '2026-02-01T10:00:00Z');
    await buchung(900, 7, 11, '2026-09-01T10:00:00Z');
    await buchung(100, 12, 12, '2027-02-01T10:00:00Z');

    const daten = await wrapped.sammleDaten(kontext, ANNA);

    // Nicht der aktuelle Stand, sondern der Stand im Zeitraum.
    expect(daten.level).toMatchObject({ levelStart: 5, levelEnd: 11, xpGained: 1400 });
  });

  it('gibt null zurück, wenn es im Zeitraum keine Buchung gab', async () => {
    await buchung(100, 4, 4, '2025-11-01T10:00:00Z');
    const daten = await wrapped.sammleDaten(kontext, ANNA);
    // «Level 0 → Level 0» wäre die schlechteste Art, das zu sagen.
    expect(daten.level).toBeNull();
  });

  it('zählt Abzüge nicht als Zuwachs', async () => {
    await buchung(1000, 5, 9, '2026-02-01T10:00:00Z');
    await buchung(-400, 9, 8, '2026-03-01T10:00:00Z');
    const daten = await wrapped.sammleDaten(kontext, ANNA);
    expect(daten.level?.xpGained).toBe(1000);
  });
});

describeWithDatabase('Wrapped: Datenlage', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await prisma.analyticsTracking.deleteMany({});
  });

  it('meldet eine erst später begonnene Messung als teilweise', async () => {
    await prisma.analyticsTracking.create({
      data: {
        guildId: GUILD,
        voiceSince: new Date('2025-06-01T00:00:00Z'),
        messagesSince: new Date('2026-07-01T00:00:00Z'),
      },
    });

    const lage = await wrapped.ermittleQuellen(GUILD, zeitraum);
    expect(lage.voice.lage).toBe('vollstaendig');
    expect(lage.messages.lage).toBe('teilweise');
    // Ungefähr ein halbes Jahr von zwölf Monaten.
    expect(lage.messages.abdeckung).toBeGreaterThan(0.48);
    expect(lage.messages.abdeckung).toBeLessThan(0.52);
  });

  it('meldet eine gar nicht begonnene Messung als fehlend', async () => {
    await prisma.analyticsTracking.create({
      data: { guildId: GUILD, voiceSince: new Date('2027-03-01T00:00:00Z') },
    });
    const lage = await wrapped.ermittleQuellen(GUILD, zeitraum);
    expect(lage.voice.lage).toBe('fehlt');
  });

  it('meldet Quellen ohne eine einzige Zeile als fehlend', async () => {
    const lage = await wrapped.ermittleQuellen(GUILD, zeitraum);
    expect(lage.clips.lage).toBe('fehlt');
    expect(lage.events.lage).toBe('fehlt');
    expect(lage.games.lage).toBe('fehlt');
  });
});
