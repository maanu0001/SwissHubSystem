import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_streamer_statistik');

/**
 * Die Zahlen - und dass keine darunter erfunden ist.
 *
 * ## Worum es in §12 geht
 *
 * «Statistiken dürfen nur aus tatsächlich erfassten Daten entstehen. Keine
 * rückwirkenden Streaming-Stunden erfinden.» Das ist keine Formalie: die
 * Kennzahlen stehen auf der Uebersicht des Moduls, und wer sie liest, glaubt
 * sie. Eine Zahl, die aus einer Schaetzung entsteht, ist dort nicht als
 * Schaetzung erkennbar.
 *
 * Drei Regeln, die daraus folgen und hier geprueft werden:
 *
 *  1. **Stunden nur aus beendeten Sessions.** Eine laufende waechst noch; eine
 *     Zahl, die sich bei jedem Seitenaufruf aendert, sieht wie ein Fehler aus.
 *  2. **`beobachtetSeit` sagt, ab wann.** Ohne diese Angabe waeren «12 Stunden»
 *     eine Aussage ueber die Zeit vor der Installation des Moduls - und die
 *     kennt es nicht.
 *  3. **Angekuendigt zaehlt nur, was gesendet wurde.** Ein belegter Platz, aus
 *     dem keine Nachricht wurde, ist keine Ankuendigung.
 */
const { prisma } = await import('@swisshub/database');
const { streamer } = await import('@swisshub/modules');

const LEA = '100000000000000001';
const JETZT = new Date('2026-09-26T22:00:00.000Z');

async function kanalAnlegen(): Promise<string> {
  const profil = await prisma.streamerProfil.create({
    data: { discordId: LEA, status: 'APPROVED', sprachen: ['de'] },
  });
  const kanal = await prisma.streamerKanal.create({
    data: {
      profilId: profil.id,
      plattform: 'TWITCH',
      externeId: '10000001',
      handle: 'lea_streamt',
      aktiv: true,
    },
  });
  return kanal.id;
}

describeWithDatabase('Streamer Hub: Kennzahlen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.streamerAnkuendigung.deleteMany();
    await prisma.streamerSession.deleteMany();
    await prisma.streamerKanal.deleteMany();
    await prisma.streamerProfil.deleteMany();
  });

  it('meldet ohne jede Session null Stunden und kein Beobachtungsfenster', async () => {
    const kennzahlen = await streamer.ladeKennzahlen(JETZT);
    expect(kennzahlen.beobachteteStunden).toBe(0);
    /*
     * `null` und nicht ein Datum: «noch nie eine Session gesehen» ist etwas
     * anderes als «seit heute beobachtet, aber nichts passiert». Die Oberflaeche
     * schreibt darum keinen Zeitraum hin, den es nicht gibt.
     */
    expect(kennzahlen.beobachtetSeit).toBeNull();
    expect(kennzahlen.erkannteStreams).toBe(0);
    expect(kennzahlen.gesendeteAnkuendigungen).toBe(0);
  });

  it('zaehlt nur beendete Sessions in die Stunden', async () => {
    const kanalId = await kanalAnlegen();
    // Zwei Stunden, beendet.
    await prisma.streamerSession.create({
      data: {
        kanalId,
        externeSessionId: 'fertig',
        gestartetAm: new Date('2026-09-25T18:00:00.000Z'),
        beendetAm: new Date('2026-09-25T20:00:00.000Z'),
        zuletztGesehenAm: new Date('2026-09-25T20:00:00.000Z'),
      },
    });
    // Und eine, die noch laeuft: fuenf Stunden bisher - und keine davon zaehlt.
    await prisma.streamerSession.create({
      data: {
        kanalId,
        externeSessionId: 'laeuft',
        gestartetAm: new Date('2026-09-26T17:00:00.000Z'),
        zuletztGesehenAm: JETZT,
      },
    });

    const kennzahlen = await streamer.ladeKennzahlen(JETZT);
    expect(kennzahlen.beobachteteStunden).toBe(2);
    expect(kennzahlen.jetztLive).toBe(1);
    // Erkannt wurden trotzdem beide - das ist eine andere Aussage.
    expect(kennzahlen.erkannteStreams).toBe(2);
    expect(kennzahlen.beobachtetSeit).toEqual(new Date('2026-09-25T18:00:00.000Z'));
  });

  it('zaehlt einen belegten, aber nicht gesendeten Platz nicht als Ankuendigung', async () => {
    /*
     * Die Zeile entsteht, bevor gesendet wird - sie **ist** die Belegung des
     * Platzes. Wuerde sie mitgezaehlt, stuende in der Uebersicht eine
     * Ankuendigung, die in keinem Kanal steht.
     */
    const kanalId = await kanalAnlegen();
    const session = await prisma.streamerSession.create({
      data: {
        kanalId,
        externeSessionId: 'stream-1',
        gestartetAm: JETZT,
        zuletztGesehenAm: JETZT,
      },
    });
    await prisma.streamerAnkuendigung.create({
      data: { sessionId: session.id, channelId: '200000000000000001', fehler: 'Discord war weg.' },
    });

    expect((await streamer.ladeKennzahlen(JETZT)).gesendeteAnkuendigungen).toBe(0);

    await prisma.streamerAnkuendigung.updateMany({
      data: { messageId: 'msg-1', gesendetAm: JETZT, fehler: null },
    });
    expect((await streamer.ladeKennzahlen(JETZT)).gesendeteAnkuendigungen).toBe(1);
  });

  it('rechnet eine Session mit verdrehten Zeiten nicht negativ', async () => {
    /*
     * Kann es geben: die Plattform nennt einen Startzeitpunkt, die Karenzzeit
     * beendet die Session mit der Zeit des Durchgangs, und zwischen beiden liegt
     * eine Zeitumstellung oder eine falsch gestellte Uhr. Eine negative Dauer
     * wuerde von der Gesamtsumme abgezogen - und niemand koennte erklaeren,
     * warum die Stunden gesunken sind.
     */
    const kanalId = await kanalAnlegen();
    await prisma.streamerSession.create({
      data: {
        kanalId,
        externeSessionId: 'verdreht',
        gestartetAm: new Date('2026-09-26T20:00:00.000Z'),
        beendetAm: new Date('2026-09-26T18:00:00.000Z'),
        zuletztGesehenAm: new Date('2026-09-26T18:00:00.000Z'),
      },
    });
    expect((await streamer.ladeKennzahlen(JETZT)).beobachteteStunden).toBe(0);
  });

  it('nennt im Bereitschaftsbericht, was fehlt - und behauptet nichts', async () => {
    /*
     * Ohne Zugangsdaten gibt es keine Live-Erkennung. Ein Modul, das nichts tut
     * und nicht sagt warum, ist die schlechtere Variante von einem, das gar
     * nicht da ist.
     */
    const bereit = await streamer.ladeBereitschaft();
    expect(bereit.twitch.zugangsdaten).toBe(false);
    expect(bereit.youtube.zugangsdaten).toBe(false);
    expect(bereit.offenePunkte.length).toBeGreaterThan(0);
    // Und kein Punkt behauptet, etwas sei eingerichtet.
    expect(bereit.offenePunkte.join(' ')).not.toMatch(/eingerichtet\b/u);
  });
});
