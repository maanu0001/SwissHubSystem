import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_zeitraum');

/**
 * Die Sprachzeit gehört zum gewählten Zeitraum.
 *
 * ## Der Fehler, gegen den diese Datei geschrieben ist
 *
 * Die Kennzahl «Sprachzeit» bewegte sich beim Wechsel von 24 Stunden auf 7
 * und 30 Tage nicht. Nicht weil der Filter nicht ankam - er kam bis in den
 * Server-Loader -, sondern weil er dort auf **ganze Zürcher Kalendertage**
 * aufgerundet wurde:
 *
 *     where: { day: { gte: tag(von), lte: tag(bis) } }
 *
 * Ein Zeitraum, der um 14:37 beginnt, holte damit den Starttag ab
 * Mitternacht. «24 Stunden» waren bis zu 48, «7 Tage» acht Tage, «30 Tage»
 * einunddreissig. Auf einem Server, dessen Sprachzeit in den letzten ein,
 * zwei Kalendertagen liegt, deckten alle drei Filter denselben Zeitraum ab -
 * und zeigten dieselbe Zahl.
 *
 * ## Was jetzt gilt
 *
 * `sprachSekundenImFenster` rechnet aus `AnalyticsVoiceSegment` und schneidet
 * am Fensterrand ab:
 *
 *     LEAST(COALESCE(leftAt, jetzt), bis) - GREATEST(joinedAt, von)
 *
 * Jede Prüfung hier ist eine Seite dieser Formel: eine Sitzung ganz im
 * Fenster, eine, die davor beginnt, eine, die danach endet, eine, die das
 * Fenster vollständig überspannt - und der Fall, um den es eigentlich geht:
 * drei Filter, drei verschiedene Zahlen.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die Formel in SQL steht. Eine Nachbildung von Prisma würde die Rechnung
 * nicht ausführen, sondern behaupten.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const B = '100000000000000002';
const BOT = '800000000000000001';
const KANAL = '700000000000000010';
const AFK = '700000000000000099';

/** Mitten am Tag - nichts klebt an einer Tagesgrenze. */
const JETZT = new Date(Date.UTC(2026, 8, 23, 12, 0, 0));
const STUNDE = 3600_000;
const TAG = 24 * STUNDE;

/** `vorStunden(30)` - ein Zeitpunkt 30 Stunden vor `JETZT`. */
const vorStunden = (stunden: number): Date => new Date(JETZT.getTime() - stunden * STUNDE);

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

/**
 * Ein abgeschlossener Abschnitt, direkt in die Tabelle.
 *
 * Direkt und nicht über `starteSprachAbschnitt`/`beendeSprachAbschnitt`, weil
 * hier die **Auswertung** geprüft wird und nicht die Aufzeichnung: es soll
 * genau ein Abschnitt mit genau diesen Grenzen liegen, ohne dass ein
 * Heartbeat oder ein Abgleich dazwischenkommt. Dass die Aufzeichnung selbst
 * stimmt, prüft `analytics-sprachzeit.test.ts`.
 */
async function abschnitt(
  discordId: string,
  von: Date,
  bis: Date | null,
  extras: { isAfk?: boolean; isBot?: boolean } = {},
): Promise<void> {
  await prisma.analyticsVoiceSegment.create({
    data: {
      guildId: GUILD,
      sessionId: `test-${discordId}-${von.getTime()}`,
      discordId,
      isBot: extras.isBot ?? false,
      channelId: extras.isAfk ? AFK : KANAL,
      channelName: extras.isAfk ? 'AFK' : 'Treffpunkt',
      isAfk: extras.isAfk ?? false,
      joinedAt: von,
      leftAt: bis,
      seconds: bis ? Math.round((bis.getTime() - von.getTime()) / 1000) : null,
    },
  });
}

const scope = (id: string) => ({
  guildId: GUILD,
  zeitraum: analytics.aufloesen({ id, jetzt: JETZT }),
  jetzt: JETZT,
});

/** Die Kennzahl, wie sie auf der Seite steht - in Stunden. */
async function stunden(id: string): Promise<number> {
  const zahlen = await analytics.statistik.kennzahlen(scope(id));
  return zahlen.sprachSekunden.wert / 3600;
}

describeWithDatabase('Analytics: Sprachzeit folgt dem Zeitraumfilter', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsVoiceSegment","AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsMemberProfile","AnalyticsTracking","AuditLog" RESTART IDENTITY CASCADE',
    );
    await konfiguriere();
  });

  // --- Der eigentliche Fall -------------------------------------------------

  it('gibt 24h, 7 Tagen und 30 Tagen verschiedene Werte', async () => {
    /*
     * Eine Stunde je Tag, dreissig Tage lang - immer zur selben Uhrzeit, und
     * zwar so, dass sie sicher in jedes Fenster fällt.
     *
     * Erwartung: 24h → 1 h, 7 Tage → 7 h, 30 Tage → 30 h. Vorher waren es
     * dreimal fast dasselbe, weil die Fenster auf Kalendertage aufgerundet
     * wurden.
     */
    for (let tag = 0; tag < 30; tag += 1) {
      const beginn = new Date(JETZT.getTime() - tag * TAG - 6 * STUNDE);
      await abschnitt(A, beginn, new Date(beginn.getTime() + STUNDE));
    }

    expect(await stunden('24h')).toBe(1);
    expect(await stunden('7d')).toBe(7);
    expect(await stunden('30d')).toBe(30);
  });

  it('bewegt die Zahl bei jedem Filterwechsel', async () => {
    // Dieselbe Aussage ohne Rechnung: streng steigend.
    for (let tag = 0; tag < 40; tag += 1) {
      const beginn = new Date(JETZT.getTime() - tag * TAG - 6 * STUNDE);
      await abschnitt(A, beginn, new Date(beginn.getTime() + 30 * 60_000));
    }

    const werte = await Promise.all(['24h', '7d', '30d', '90d'].map((id) => stunden(id)));
    for (let i = 1; i < werte.length; i += 1) {
      expect(werte[i], `Filter ${i} muss mehr zeigen als ${i - 1}`).toBeGreaterThan(werte[i - 1]!);
    }
  });

  it('holt bei 24 Stunden nicht den ganzen Vortag mit', async () => {
    /*
     * Der Kern des Fehlers, in einem Fall.
     *
     * Es ist 12:00 UTC. Ein Abschnitt lag gestern von 02:00 bis 03:00 UTC -
     * also vor mehr als 24 Stunden, aber am Zürcher Vortag. Die alte Rechnung
     * holte den Vortag komplett und zählte ihn mit.
     */
    await abschnitt(A, vorStunden(34), vorStunden(33));

    expect(await stunden('24h')).toBe(0);
    // Im Siebentagefenster liegt er sehr wohl.
    expect(await stunden('7d')).toBe(1);
  });

  // --- Die Überlappungsformel ----------------------------------------------

  it('zählt eine Sitzung vollständig, die ganz im Fenster liegt', async () => {
    await abschnitt(A, vorStunden(10), vorStunden(8));
    expect(await stunden('24h')).toBe(2);
  });

  it('zählt von einer Sitzung, die vor dem Fenster beginnt, nur den Teil darin', async () => {
    // 30 Stunden bis 20 Stunden vor jetzt: im 24h-Fenster liegen 4 Stunden.
    await abschnitt(A, vorStunden(30), vorStunden(20));
    expect(await stunden('24h')).toBe(4);
    // Und im Siebentagefenster die ganzen zehn.
    expect(await stunden('7d')).toBe(10);
  });

  it('zählt von einer laufenden Sitzung nur bis jetzt', async () => {
    // Offen, seit zwei Stunden. Nicht bis zum Ende des Fensters - Sekunden,
    // die noch nicht vergangen sind, gibt es nicht.
    await abschnitt(A, vorStunden(2), null);
    expect(await stunden('24h')).toBe(2);
    expect(await stunden('30d')).toBe(2);
  });

  it('zählt von einer Sitzung, die das ganze Fenster überspannt, genau das Fenster', async () => {
    // Seit 40 Tagen im Kanal, immer noch drin.
    await abschnitt(A, new Date(JETZT.getTime() - 40 * TAG), null);

    expect(await stunden('24h')).toBe(24);
    expect(await stunden('7d')).toBe(24 * 7);
    expect(await stunden('30d')).toBe(24 * 30);
    // Ab hier begrenzt der Beitritt: 40 Tage sind 960 Stunden.
    expect(await stunden('90d')).toBe(960);
  });

  it('zählt eine Sitzung nicht, die vor dem Fenster endete', async () => {
    await abschnitt(A, vorStunden(50), vorStunden(48));
    expect(await stunden('24h')).toBe(0);
    expect(await stunden('7d')).toBe(2);
  });

  it('erzeugt keine negative Zeit bei einem Abschnitt hinter dem Fenster', async () => {
    /*
     * Ein Abschnitt in der Zukunft kann durch eine falsch gestellte Uhr
     * entstehen. Er darf nichts abziehen - `GREATEST`/`LEAST` sorgen dafür,
     * dass die Differenz nie unter null geht.
     */
    await abschnitt(A, new Date(JETZT.getTime() + 2 * STUNDE), new Date(JETZT.getTime() + 3 * STUNDE));
    expect(await stunden('24h')).toBe(0);
    expect(await stunden('30d')).toBe(0);
  });

  it('summiert mehrere Personen im selben Fenster', async () => {
    await abschnitt(A, vorStunden(3), vorStunden(2));
    await abschnitt(B, vorStunden(3), vorStunden(1));
    expect(await stunden('24h')).toBe(3);
  });

  // --- Leere Daten ----------------------------------------------------------

  it('zeigt ohne Daten null, nicht null-ish', async () => {
    for (const id of ['24h', '7d', '30d', '90d', '1y', 'all']) {
      expect(await stunden(id), id).toBe(0);
    }
  });

  it('zeigt null, wenn es nur Abschnitte aus dem AFK-Kanal gibt', async () => {
    // Dieselbe Regel wie beim Verbuchen: Zeit im AFK-Kanal ist Anwesenheit,
    // keine Aktivität.
    await abschnitt(A, vorStunden(5), vorStunden(1), { isAfk: true });
    expect(await stunden('24h')).toBe(0);
  });

  it('zählt einen Bot nur, wenn er ausdrücklich mitgezählt wird', async () => {
    await abschnitt(BOT, vorStunden(4), vorStunden(2), { isBot: true });
    expect(await stunden('24h')).toBe(0);

    const mitBots = await analytics.statistik.kennzahlen({
      ...scope('24h'),
      mitBots: true,
    });
    expect(mitBots.sprachSekunden.wert / 3600).toBe(2);
  });

  // --- Zeitgrenzen ----------------------------------------------------------

  it('zählt eine Sitzung über Mitternacht in einem Stück', async () => {
    /*
     * Zürcher Mitternacht liegt im Sommer bei 22:00 UTC des Vortags. Eine
     * Sitzung darüber hinweg ist für die **Kennzahl** eine Strecke und keine
     * zwei - die Aufteilung auf Kalendertage betrifft nur die Balken.
     */
    const von = new Date(Date.UTC(2026, 8, 22, 21, 30, 0));
    const bis = new Date(Date.UTC(2026, 8, 22, 23, 30, 0));
    await abschnitt(A, von, bis);
    expect(await stunden('24h')).toBe(2);
  });

  it('rechnet auf Sekunden und nicht auf Stundenraster', async () => {
    // Sieben Minuten sind 420 Sekunden - nicht null und nicht eine Stunde.
    await abschnitt(A, vorStunden(1), new Date(JETZT.getTime() - 53 * 60_000));
    const zahlen = await analytics.statistik.kennzahlen(scope('24h'));
    expect(zahlen.sprachSekunden.wert).toBe(420);
  });

  // --- Vergleichszeitraum ---------------------------------------------------

  it('gibt dem Vergleichszeitraum sein eigenes Fenster', async () => {
    /*
     * Der Vergleichszeitraum von «24 Stunden» ist der Tag davor. Die beiden
     * Fenster berühren sich und überlappen nicht - vorher taten sie es, weil
     * beide den angebrochenen Starttag ganz holten.
     */
    await abschnitt(A, vorStunden(5), vorStunden(4)); // im Fenster
    await abschnitt(A, vorStunden(30), vorStunden(29)); // im Vergleichsfenster

    const zahlen = await analytics.statistik.kennzahlen(scope('24h'));
    expect(zahlen.sprachSekunden.wert).toBe(3600);
    expect(zahlen.sprachSekunden.vorher).toBe(3600);
  });

  it('teilt eine überspannende Sitzung sauber zwischen Fenster und Vergleich', async () => {
    // Seit 40 Stunden drin: 24 im Fenster, 16 im Vergleichsfenster.
    await abschnitt(A, vorStunden(40), null);
    const zahlen = await analytics.statistik.kennzahlen(scope('24h'));
    expect(zahlen.sprachSekunden.wert / 3600).toBe(24);
    expect(zahlen.sprachSekunden.vorher! / 3600).toBe(16);
  });

  // --- Nachrichten: derselbe Zeitraum, feinste verfügbare Auflösung ---------

  it('holt bei 24 Stunden nicht die Nachrichten von vorgestern', async () => {
    /*
     * Nachrichten sind Zeitpunkte, keine Strecken - dafür gibt es keine
     * Segmenttabelle. Die feinste Wahrheit ist `AnalyticsHourly`, und die
     * genügt: der Fehler am Rand liegt unter einer Stunde statt bei bis zu
     * einem Tag.
     */
    const stundeVon = (h: number): Date => {
      const wert = new Date(JETZT.getTime() - h * STUNDE);
      wert.setUTCMinutes(0, 0, 0);
      return wert;
    };
    await prisma.analyticsHourly.createMany({
      data: [
        { guildId: GUILD, hourStart: stundeVon(2), messages: 10 },
        { guildId: GUILD, hourStart: stundeVon(20), messages: 5 },
        // Vor mehr als 24 Stunden - darf im 24h-Fenster nicht auftauchen.
        { guildId: GUILD, hourStart: stundeVon(30), messages: 100 },
      ],
    });

    const h24 = await analytics.statistik.kennzahlen(scope('24h'));
    expect(h24.nachrichten.wert).toBe(15);

    const d7 = await analytics.statistik.kennzahlen(scope('7d'));
    expect(d7.nachrichten.wert).toBe(115);
  });

  // --- Die abgeleiteten Zahlen ---------------------------------------------

  it('leitet Sprachzeit je Tag aus derselben Summe ab', async () => {
    await abschnitt(A, vorStunden(7 * 24), null);
    const zahlen = await analytics.statistik.kennzahlen(scope('7d'));

    expect(zahlen.sprachSekunden.wert / 3600).toBe(24 * 7);
    // 168 Stunden auf 7 Tage sind 24 Stunden am Tag.
    expect(zahlen.sprachSekundenProTag).toBe(24 * 3600);
  });
});
