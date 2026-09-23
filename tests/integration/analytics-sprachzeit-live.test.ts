import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_live');

/**
 * Die Sprachzeit ist live.
 *
 * Bis hierher las die Statistik ausschliesslich aus den Tagesaggregaten, und
 * die bekommen ihre Sekunden erst, wenn ein Abschnitt **endet**. Wer seit
 * anderthalb Stunden im Kanal sass, stand darin mit null - sichtbar war nur
 * seine Sitzung, weil die beim Betreten gezählt wird. Genau so entstand
 * «Sprachzeit 0 h, 1 Sitzungen».
 *
 * Diese Datei prüft die andere Rechnung: abgeschlossene Zeit **plus**
 * laufende, beides auf den gewählten Zeitraum geschnitten, gegen die
 * Serverzeit. Und sie prüft die Stelle, an der so etwas erfahrungsgemäss
 * schiefgeht: den Übergang beim Verlassen, wo eine Sitzung für einen
 * Augenblick in beiden Töpfen liegen könnte.
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

/** Ein fester Zeitpunkt mitten am Tag - nichts klebt an einer Tagesgrenze. */
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

async function betritt(
  discordId: string,
  at: Date,
  channelId = KANAL,
  extras: Record<string, unknown> = {},
): Promise<string | null> {
  return analytics.starteSprachAbschnitt({
    guildId: GUILD,
    discordId,
    isBot: discordId === MUSIK_BOT,
    channelId,
    channelName: channelId === KANAL_2 ? 'Zweiter' : 'Treffpunkt',
    at,
    ...extras,
  });
}

const verlaesst = async (discordId: string, at: Date): Promise<string | null> =>
  (await analytics.beendeSprachAbschnitt(GUILD, discordId, at)).sessionId;

/** Der Scope der Statistikseite, mit fester Serverzeit. */
const scope = (jetzt: Date, id = '30d') => ({
  guildId: GUILD,
  zeitraum: analytics.aufloesen({ id, jetzt }),
  jetzt,
});

const sprachSekunden = async (jetzt: Date, id = '30d'): Promise<number> =>
  (await analytics.statistik.kennzahlen(scope(jetzt, id))).sprachSekunden.wert;

describeWithDatabase('Analytics: Sprachzeit ist live', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState","BotStatus" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
  });

  // --- Der gemeldete Fall ---------------------------------------------------

  it('zählt eine laufende Sitzung, ohne dass jemand den Kanal verlässt', async () => {
    // 12:00 betreten, 13:30 immer noch da → 1.5 h. Nicht 0 h.
    await betritt(A, T(0));

    expect(await sprachSekunden(T(90))).toBe(5400);
  });

  it('wächst weiter, solange die Sitzung läuft', async () => {
    // Genau der Ablauf aus dem Test §12: öffnen, warten, neu laden.
    await betritt(A, T(0));

    expect(await sprachSekunden(T(30))).toBe(1800);
    expect(await sprachSekunden(T(45))).toBe(2700);
    expect(await sprachSekunden(T(75))).toBe(4500);
  });

  it('führt Sitzungszahl und Sprachzeit getrennt', async () => {
    // «1 Sitzung» und «0 h» war die falsche Paarung: eine offene Sitzung
    // zählt als Sitzung **und** ihre bisherige Laufzeit gehört zur Dauer.
    await betritt(A, T(0));
    const zahlen = await analytics.statistik.kennzahlen(scope(T(30)));

    expect(zahlen.sprachSitzungen.wert).toBe(1);
    expect(zahlen.sprachSekunden.wert).toBe(1800);
  });

  // --- TEST 33: abgeschlossen plus laufend ----------------------------------

  it('TEST 33: addiert abgeschlossene und laufende Zeit', async () => {
    await betritt(A, T(-180));
    await verlaesst(A, T(-120)); // eine Stunde abgeschlossen
    await betritt(A, T(0));

    expect(await sprachSekunden(T(30))).toBe(3600 + 1800);
  });

  // --- TEST 37: der Übergang beim Verlassen ---------------------------------

  it('TEST 37: verdoppelt beim Verlassen nichts', async () => {
    /*
     * Die gefährlichste Stelle. Vor dem Verlassen wird die Zeit hier
     * gerechnet, danach steht sie im Aggregat - wären beide gleichzeitig
     * gültig, stünde die Sprachzeit plötzlich doppelt da.
     *
     * Kann nicht passieren: `schliesseOffene` setzt `leftAt` und verbucht
     * die Sekunden in derselben Aktualisierung. Ein Abschnitt ist entweder
     * offen oder verbucht.
     */
    await betritt(A, T(0));
    const vorher = await sprachSekunden(T(59.9833)); // 59 min 59 s

    await verlaesst(A, T(60));
    const nachher = await sprachSekunden(T(60));

    expect(vorher).toBe(3599);
    expect(nachher).toBe(3600);
    // Kein Sprung nach unten, kein Sprung nach oben - eine Sekunde weiter.
    expect(nachher - vorher).toBe(1);
  });

  it('bleibt nach dem Verlassen stehen', async () => {
    await betritt(A, T(0));
    await verlaesst(A, T(60));

    expect(await sprachSekunden(T(60))).toBe(3600);
    expect(await sprachSekunden(T(600))).toBe(3600);
  });

  // --- TEST 17: Kanalwechsel ------------------------------------------------

  it('TEST 17: ein Wechsel erzeugt weder Lücke noch doppelte Zeit', async () => {
    await betritt(A, T(0), KANAL);
    const sessionId = await verlaesst(A, T(30));
    await betritt(A, T(30), KANAL_2, { sessionId: sessionId ?? undefined });

    // 30 Minuten abgeschlossen in A, 15 Minuten laufend in B.
    expect(await sprachSekunden(T(45))).toBe(1800 + 900);

    const zahlen = await analytics.statistik.kennzahlen(scope(T(45)));
    expect(zahlen.sprachSitzungen.wert).toBe(1);
  });

  // --- TEST 36: mehrere gleichzeitig ---------------------------------------

  it('TEST 36: summiert die Zeit mehrerer gleichzeitig Anwesender', async () => {
    // Zwei Personen, je 30 Minuten gleichzeitig → eine Stunde Mitgliederzeit.
    await betritt(A, T(0));
    await betritt(B, T(0));

    expect(await sprachSekunden(T(30))).toBe(3600);
    const zahlen = await analytics.statistik.kennzahlen(scope(T(30)));
    expect(zahlen.wachsend).toBe(2);
  });

  // --- Zeitraumfilter -------------------------------------------------------

  it('TEST 41: schneidet die laufende Sitzung auf jeden Zeitraum', async () => {
    /*
     * Seit 40 Tagen im Kanal - eine Sitzung, die jeden Filter überspannt.
     * Jetzt ist der 23.09.2026, 12:00 UTC (14:00 Zürich).
     *
     * Jeder Zeitraum bekommt genau seinen Teil. Die Zahlen sehen zunächst
     * krumm aus, und das ist richtig so: die Aggregate rechnen in ganzen
     * **Zürcher** Kalendertagen, und «letzte 24 Stunden» holt deshalb die
     * Tageszeile des Vortags komplett. Der laufende Anteil muss dasselbe
     * Fenster abdecken - sonst zählte die eine Hälfte einen Zeitraum, den die
     * andere nicht kennt, und die Summe wäre von beidem etwas.
     *
     * Zürcher Mitternacht des 22.09. ist 21.09. um 22:00 UTC (Sommerzeit),
     * bis jetzt sind das 38 Stunden.
     */
    await betritt(A, new Date(T(0).getTime() - 40 * 86_400_000));
    const jetzt = T(0);

    const stunden = async (id: string): Promise<number> =>
      Math.round((await sprachSekunden(jetzt, id)) / 3600);

    expect(await stunden('24h')).toBe(38); // 24 h + der angebrochene Starttag
    expect(await stunden('7d')).toBe(182);
    expect(await stunden('30d')).toBe(734);
    // Ab hier begrenzt der Beitritt und nicht mehr der Filter.
    expect(await stunden('90d')).toBe(960);
    expect(await stunden('1y')).toBe(960);
  });

  it('TEST 35: rechnet «heute» ab Zürcher Mitternacht', async () => {
    /*
     * 23:30 Zürich betreten, es ist 00:30 - für heute eine halbe Stunde.
     * Eine naive UTC-Mitternacht läge im Sommer zwei Stunden daneben, und
     * der ganze Abend gehörte zum falschen Tag.
     */
    const gestern2330 = new Date(Date.UTC(2026, 8, 22, 21, 30, 0)); // 23:30 Zürich
    const heute0030 = new Date(Date.UTC(2026, 8, 22, 22, 30, 0)); // 00:30 Zürich
    await betritt(A, gestern2330);

    const werte = await analytics.statistik.heute(GUILD, false, heute0030);
    expect(werte.sprachSekunden).toBe(1800);
  });

  it('gibt einem vergangenen Vergleichszeitraum nur seinen Teil', async () => {
    /*
     * Seit vier Tagen im Kanal. Der Vergleichszeitraum von «24 Stunden» ist
     * der Tag davor - dort zählt dieser Tag, nicht die Zeit seither. Die
     * laufende Sitzung endet für ihn am Ende seines Fensters, nicht jetzt.
     *
     * Auch hier die ganzen Zürcher Kalendertage: 20.09. 22:00 UTC bis 22.09.
     * 12:00 UTC sind 38 Stunden, wie beim laufenden Zeitraum. Die beiden
     * Fenster überlappen sich dadurch - das ist keine Eigenheit der
     * laufenden Zeit, sondern die der Tagesaggregate, und beide Hälften
     * verhalten sich gleich.
     */
    await betritt(A, new Date(T(0).getTime() - 4 * 86_400_000));
    const zahlen = await analytics.statistik.kennzahlen(scope(T(0), '24h'));

    expect(zahlen.sprachSekunden.vorher).toBe(38 * 3600);
    expect(zahlen.sprachSekunden.wert).toBe(38 * 3600);

    // Der Punkt dieses Tests: der Vergleichszeitraum bekommt **seinen**
    // Ausschnitt und nicht alles bis jetzt. Vier Tage im Kanal sind 96
    // Stunden - so viel steht in keiner der beiden Zahlen.
    expect(zahlen.sprachSekunden.vorher).toBeLessThan(96 * 3600);
  });

  it('lässt einen abgeschlossenen Zeitraum nicht weiterwachsen', async () => {
    await betritt(A, new Date(T(0).getTime() - 4 * 86_400_000));
    const zahlen = await analytics.statistik.kennzahlen(scope(T(0), '24h'));

    // `wachsend` steuert das Weiterrechnen in der Oberfläche. Für den
    // laufenden Zeitraum ist es eins, für den Vergleich davor wäre es null.
    expect(zahlen.wachsend).toBe(1);
  });

  // --- «Heute» und «Gerade im Sprachkanal» ---------------------------------

  it('TEST 6: «Sprachzeit heute» ist live', async () => {
    await betritt(A, T(0));
    const werte = await analytics.statistik.heute(GUILD, false, T(45));

    expect(werte.sprachSekunden).toBe(2700);
    expect(werte.wachsend).toBe(1);
    expect(werte.imSprachkanal).toBe(1);
  });

  it('zählt jemanden mit laufender Sitzung als aktiv', async () => {
    // Sonst stünde «Sprachzeit heute 0.5 h» neben «Aktiv heute 0».
    await betritt(A, T(0));
    const werte = await analytics.statistik.heute(GUILD, false, T(30));

    expect(werte.aktive).toBe(1);
    expect((await analytics.statistik.kennzahlen(scope(T(30)))).aktiveMitglieder.wert).toBe(1);
  });

  it('meldet die Serverzeit mit, auf die sich alles bezieht', async () => {
    await betritt(A, T(0));
    const werte = await analytics.statistik.heute(GUILD, false, T(30));
    expect(werte.asOf.toISOString()).toBe(T(30).toISOString());
  });

  // --- Wer zählt ------------------------------------------------------------

  it('TEST 20: zählt einen laufenden Musik-Worker nicht mit', async () => {
    await konfiguriere({ logBots: true });
    await betritt(MUSIK_BOT, T(0));
    await betritt(A, T(0));

    // Ohne Bots - die Vorgabe der Statistik.
    expect(await sprachSekunden(T(30))).toBe(1800);
  });

  it('zählt Zeit im AFK-Kanal auch laufend nicht als Sprachzeit', async () => {
    /*
     * Dieselbe Regel wie beim Verbuchen. Stünde AFK-Zeit hier drin und dort
     * nicht, sänke die Sprachzeit in dem Moment, in dem jemand den Kanal
     * verlässt - eine Kennzahl, die rückwärts läuft.
     */
    await betritt(A, T(0), AFK_KANAL, { isAfk: true });

    expect(await sprachSekunden(T(60))).toBe(0);
    // Anwesend ist er trotzdem.
    expect((await analytics.statistik.heute(GUILD, false, T(60))).imSprachkanal).toBe(1);
  });

  it('zählt nichts, solange die Sprachaufzeichnung abgeschaltet ist', async () => {
    await konfiguriere({ logVoice: false });
    await betritt(A, T(0));

    expect(await sprachSekunden(T(60))).toBe(0);
  });

  // --- Die übrigen Oberflächen ---------------------------------------------

  it('nimmt jemanden mit laufender Sitzung in die Rangliste auf', async () => {
    // Er hat noch keine abgeschlossene Sekunde - und gehörte trotzdem schon
    // an die Spitze von «Top Sprachzeit».
    await betritt(A, T(-120));
    await betritt(B, T(-180));
    await verlaesst(B, T(-150)); // 30 Minuten abgeschlossen

    const rangliste = await analytics.statistik.topMitglieder(scope(T(0)), 'voice');
    expect(rangliste.map((zeile) => [zeile.discordId, zeile.sprachSekunden])).toEqual([
      [A, 7200],
      [B, 1800],
    ]);
    expect(rangliste[0]?.anteil).toBe(80);
  });

  it('nimmt den Kanal mit laufender Sitzung in die Kanalliste auf', async () => {
    await betritt(A, T(-60), KANAL_2);
    const kanaele = await analytics.statistik.topKanaele(scope(T(0)), 'VOICE');

    expect(kanaele.map((zeile) => [zeile.channelId, zeile.sprachSekunden])).toEqual([[KANAL_2, 3600]]);
    expect(kanaele[0]?.channelName).toBe('Zweiter');
  });

  it('zeigt die laufende Zeit im Verlauf und in der Heatmap', async () => {
    await betritt(A, T(-60));

    const punkte = await analytics.statistik.verlauf(scope(T(0)));
    expect(punkte.reduce((summe, punkt) => summe + punkt.sprachSekunden, 0)).toBe(3600);

    const bild = await analytics.statistik.heatmap(scope(T(0)));
    expect(bild.maxSprachSekunden).toBeGreaterThan(0);
    expect(bild.spitzeSprache).not.toBeNull();
  });

  it('zählt jemanden mit laufender Sitzung als Sprach-Nutzer', async () => {
    await betritt(A, T(-30));
    const art = await analytics.statistik.nutzungsart(scope(T(0)));

    expect(art.nurSprache).toBe(1);
    expect(art.beides).toBe(0);
  });

  // --- Karteileichen --------------------------------------------------------

  it('TEST 40: lässt eine verwaiste Sitzung nicht unbegrenzt weiterlaufen', async () => {
    /*
     * Die Datenbank sagt «seit zwei Tagen im Kanal», Discord sagt «gar nicht
     * verbunden». Ohne Abgleich zählte diese Sitzung für immer weiter und
     * schöbe die Statistik jeden Tag um 24 Stunden nach oben.
     *
     * Der Abgleich beim Start schliesst sie zum letzten Herzschlag - weiter
     * reicht das Wissen des Bots nicht.
     */
    const vorZweiTagen = new Date(T(0).getTime() - 2 * 86_400_000);
    await betritt(A, vorZweiTagen);
    await prisma.botStatus.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', online: false, lastHeartbeatAt: T(-60) },
      update: { lastHeartbeatAt: T(-60) },
    });

    // Niemand mehr im Kanal - der Abgleich räumt auf.
    await analytics.gleicheSprachabschnitteAb(GUILD, []);

    const vorher = await sprachSekunden(T(0));
    const spaeter = await sprachSekunden(T(600));
    expect(spaeter).toBe(vorher);
    expect((await analytics.statistik.heute(GUILD, false, T(600))).wachsend).toBe(0);
  });

  it('TEST 39: führt die Sitzung nach einem Neustart weiter, ohne zu verdoppeln', async () => {
    await betritt(A, T(-120));
    await prisma.botStatus.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', online: false, lastHeartbeatAt: T(-60) },
      update: { lastHeartbeatAt: T(-60) },
    });

    // A sitzt weiterhin im Kanal - der Abgleich schliesst bis zum letzten
    // Herzschlag und beginnt ab jetzt neu. «Jetzt» wird gesetzt und nicht der
    // Wanduhr überlassen: sonst hinge der Test davon ab, welches Datum der
    // Rechner gerade hat, und wäre ab dem 23.09.2026 rot.
    await analytics.gleicheSprachabschnitteAb(
      GUILD,
      [{ discordId: A, isBot: false, channelId: KANAL }],
      T(0),
    );

    /*
     * Die Rechnung eine halbe Stunde später:
     *
     *   T(-120) bis T(-60)  = 3600 s belegt, bis zum letzten Herzschlag
     *   T(-60)  bis T(0)    = Ausfallzeit, gehört niemandem
     *   T(0)    bis T(30)   = 1800 s laufend
     *
     * Macht 5400 - nicht 7200, also ohne die Ausfallzeit, und nicht 9000,
     * also ohne die belegte Stunde ein zweites Mal.
     */
    const zahlen = await analytics.statistik.kennzahlen(scope(T(30)));
    expect(zahlen.sprachSekunden.wert).toBe(5400);
    expect(zahlen.wachsend).toBe(1);
    // Eine Sitzung, kein zweiter offener Abschnitt.
    expect(await prisma.analyticsVoiceSegment.count({ where: { leftAt: null } })).toBe(1);
    expect(zahlen.sprachSitzungen.wert).toBe(1);
  });
});
