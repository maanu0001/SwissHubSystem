import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type { DiscordGateway } from '@swisshub/discord';

useTestSchema('test_streamer_youtube');

/**
 * YouTube: Live-Erkennung und Kontingentrechnung.
 *
 * ## Warum YouTube eine eigene Datei bekommt
 *
 * Weil dort ein Zustand vorkommt, den es bei Twitch nicht gibt: **keine
 * Auskunft**. Das Tageskontingent ist endlich, und wenn es aufgebraucht ist,
 * weiss die Anwendung ueber einen Kanal schlicht nichts mehr. Dieser Zustand
 * darf nicht zu «offline» werden - sonst endete jede Session um die Tagesmitte,
 * und am naechsten Morgen begaenne fuer jeden Kanal eine neue mit einer
 * zweiten Ankuendigung.
 *
 * ## Und warum der Verbrauch in der Datenbank steht
 *
 * Ein Zaehler im Speicher stuende bei jedem Bot-Neustart auf null. Dann waere
 * das Kontingent mittags erschoepft, die Live-Erkennung still, und im Dashboard
 * staende nichts darueber. Geprueft wird deshalb, dass gebucht wird - und dass
 * **vor** dem Aufruf gebucht wird, denn eine gescheiterte Anfrage kostet bei
 * Google trotzdem.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');

const { prisma } = await import('@swisshub/database');
const { streamer, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const secrets = await import('@swisshub/secrets');

const LEA = '100000000000000001';
const LEA_KANAL = 'UCBR8-60-B28hp2BmDPdntcQ';
const LEA_PLAYLIST = 'UUBR8-60-B28hp2BmDPdntcQ';
const VIDEO = 'dQw4w9WgXcQ';
const START = new Date('2026-09-26T20:00:00.000Z');

interface Fall {
  /** Video-Kennungen, die die Uploads-Playlist meldet. */
  playlist?: string[];
  /** Was `videos.list` zu einer Kennung sagt. */
  videos?: Record<string, { zustand: string; start?: string | null; ende?: string | null }>;
  /** Ein HTTP-Status statt einer Antwort - mit Text, damit `quota` erkannt wird. */
  status?: { code: number; text: string };
}

function youtube(fall: Fall): {
  abruf: (url: string, init?: RequestInit) => Promise<Response>;
  pfade: string[];
} {
  const pfade: string[] = [];
  const abruf = async (url: string): Promise<Response> => {
    pfade.push(new URL(url).pathname);
    if (fall.status) {
      return new Response(fall.status.text, { status: fall.status.code });
    }
    const json = (koerper: unknown): Response =>
      new Response(JSON.stringify(koerper), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (url.includes('/playlistItems')) {
      return json({ items: (fall.playlist ?? []).map((id) => ({ contentDetails: { videoId: id } })) });
    }
    if (url.includes('/search')) {
      return json({ items: (fall.playlist ?? []).map((id) => ({ id: { videoId: id } })) });
    }
    if (url.includes('/videos')) {
      const ids = new URL(url).searchParams.get('id')?.split(',') ?? [];
      return json({
        items: ids
          .filter((id) => fall.videos?.[id])
          .map((id) => {
            const eintrag = fall.videos![id]!;
            return {
              id,
              snippet: {
                channelId: LEA_KANAL,
                title: 'Feierabend-Runde',
                liveBroadcastContent: eintrag.zustand,
                thumbnails: { high: { url: 'https://i.ytimg.com/vi/x/hq.jpg' } },
              },
              liveStreamingDetails: {
                ...(eintrag.start === null ? {} : { actualStartTime: eintrag.start ?? START.toISOString() }),
                ...(eintrag.ende ? { actualEndTime: eintrag.ende } : {}),
                concurrentViewers: '17',
              },
            };
          }),
      });
    }
    return json({ items: [] });
  };
  return { abruf, pfade };
}

function gateway(): { send: ReturnType<typeof vi.fn>; modul: DiscordGateway } {
  const send = vi.fn(async (channelId: string) => ({ id: `msg-${send.mock.calls.length}`, channelId }));
  return { send, modul: { channels: { send, edit: vi.fn() } } as unknown as DiscordGateway };
}

async function einstellungen(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(streamer.STREAMER_MODULE_ID, true, 'test');
  await setModuleSettings(
    streamer.STREAMER_MODULE_ID,
    {
      twitchAktiv: false,
      youtubeAktiv: true,
      youtubeIntervallMinuten: 15,
      youtubeKontingent: 10_000,
      youtubeGenau: false,
      ankuendigungAktiv: true,
      ankuendigungChannelId: '200000000000000001',
      cooldownMinuten: 0,
      ...teile,
    },
    'test',
  );
}

async function kanalAnlegen(): Promise<void> {
  await prisma.discordMemberCache.create({
    data: { discordId: LEA, username: 'lea', displayName: 'Lea' },
  });
  const profil = await prisma.streamerProfil.create({
    data: { discordId: LEA, status: 'APPROVED', sprachen: ['de'], ankuendigungAktiv: true },
  });
  await prisma.streamerKanal.create({
    data: {
      profilId: profil.id,
      plattform: 'YOUTUBE',
      externeId: LEA_KANAL,
      handle: LEA_KANAL,
      anzeigename: 'Lea',
      verifikation: 'MANUELL',
      aktiv: true,
    },
  });
}

describeWithDatabase('Streamer Hub: YouTube', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.streamerAnkuendigung.deleteMany();
    await prisma.streamerSession.deleteMany();
    await prisma.streamerKanal.deleteMany();
    await prisma.streamerProfil.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await prisma.streamerApiVerbrauch.deleteMany();
    await secrets.setSecret('youtube', 'apiKey', 'kein-echter-google-schluessel-testwert', {
      actorDiscordId: 'test',
    });
    await einstellungen();
  });

  it('erkennt einen laufenden Stream ueber die Uploads-Playlist - zwei Einheiten', async () => {
    await kanalAnlegen();
    const { abruf, pfade } = youtube({
      playlist: [VIDEO],
      videos: { [VIDEO]: { zustand: 'live' } },
    });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });

    expect(bericht.neueSessions).toBe(1);
    expect(bericht.ankuendigungen).toBe(1);
    // Der guenstige Weg: Playlist plus Videoabfrage. Keine Suche.
    expect(pfade.some((pfad) => pfad.endsWith('/search'))).toBe(false);
    expect(bericht.youtubeEinheiten).toBe(2);
    expect((await streamer.leseKontingent(new Date(START.getTime() + 60_000))).einheiten).toBe(2);
  });

  it('bucht den Verbrauch auf den Tag des Durchgangs, nicht auf den heutigen', async () => {
    /*
     * Zwei Uhren an derselben Grenze.
     *
     * `runStreamerTick` liest den Kontingentstand mit `leseKontingent(jetzt)`
     * und rechnet daraus den freien Rest aus. Buchte der Verbrauch danach auf
     * `new Date()`, waere die Rechnung um Mitternacht UTC falsch: der Durchgang
     * laese das leere Kontingent des neuen Tages und schriebe in den alten.
     * Heraus kaeme eine Sperre, die niemand erwartet - und die Rechnung ist
     * genau dafuer da, sie zu verhindern.
     *
     * Dieser Test ist die Gegenprobe dazu: der Durchgang laeuft mit einem
     * Zeitpunkt in der Vergangenheit, und der heutige Tag muss danach leer
     * sein. Ohne den weitergegebenen Zeitpunkt steht der Verbrauch dort.
     */
    await kanalAnlegen();
    const { abruf } = youtube({ playlist: [VIDEO], videos: { [VIDEO]: { zustand: 'live' } } });
    const durchgang = new Date(START.getTime() + 60_000);

    await streamer.runStreamerTick(durchgang, { abruf, gateway: gateway().modul });

    expect((await streamer.leseKontingent(durchgang)).einheiten).toBe(2);
    expect((await streamer.leseKontingent(new Date())).einheiten).toBe(0);
  });

  it('nennt einen beendeten Stream nicht live, auch wenn die API noch «live» sagt', async () => {
    /*
     * Nach dem Ende eines Streams zieht `liveBroadcastContent` mit
     * Verzoegerung nach. Wer nur darauf hoert, kuendigt einen Stream an, der
     * gerade zu Ende ist - und die Session laeuft danach weiter.
     */
    await kanalAnlegen();
    const { abruf } = youtube({
      playlist: [VIDEO],
      videos: { [VIDEO]: { zustand: 'live', ende: START.toISOString() } },
    });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(bericht.neueSessions).toBe(0);
    expect(bot.send).not.toHaveBeenCalled();
  });

  it('nennt einen geplanten Stream nicht live', async () => {
    await kanalAnlegen();
    const { abruf } = youtube({
      playlist: [VIDEO],
      // `upcoming` und ohne tatsaechlichen Start: eine Ankuendigung waere eine
      // Behauptung ueber etwas, das noch nicht laeuft.
      videos: { [VIDEO]: { zustand: 'upcoming', start: null } },
    });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(bericht.neueSessions).toBe(0);
  });

  it('behaelt bei erschoepftem Kontingent den letzten Zustand statt offline zu melden', async () => {
    await kanalAnlegen();
    const bot = gateway();

    // Erst live werden.
    const live = youtube({ playlist: [VIDEO], videos: { [VIDEO]: { zustand: 'live' } } });
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: live.abruf,
      gateway: bot.modul,
    });
    expect(await prisma.streamerSession.count()).toBe(1);

    // Dann ist das Kontingent weg. Google antwortet 403 mit `quotaExceeded`.
    const leer = youtube({
      status: { code: 403, text: '{"error":{"errors":[{"reason":"quotaExceeded"}]}}' },
    });
    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 100 * 60_000), {
      abruf: leer.abruf,
      gateway: bot.modul,
    });

    expect(bericht.fehler.get('YOUTUBE')).toMatch(/kontingent/iu);
    expect(bericht.beendeteSessions).toBe(0);
    const session = await prisma.streamerSession.findFirstOrThrow();
    expect(session.beendetAm).toBeNull();
    const kanal = await prisma.streamerKanal.findFirstOrThrow();
    expect(kanal.letzterFehler).toMatch(/kontingent/iu);
  });

  it('fragt nicht mehr, wenn das eingestellte Kontingent aufgebraucht ist', async () => {
    /*
     * Die Grenze ist eine Einstellung, nicht Googles Antwort: wer ein kleineres
     * Kontingent hat als die Standardzuteilung, soll nicht erst in ein 403
     * laufen. Gebucht ist hier schon alles - der Durchgang darf gar nicht
     * anfangen.
     */
    await kanalAnlegen();
    await einstellungen({ youtubeKontingent: 100 });
    await prisma.streamerApiVerbrauch.create({
      data: { plattform: 'YOUTUBE', tag: START.toISOString().slice(0, 10), einheiten: 100, abfragen: 50 },
    });

    const { abruf, pfade } = youtube({ playlist: [VIDEO], videos: { [VIDEO]: { zustand: 'live' } } });
    const bot = gateway();
    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });

    expect(pfade).toEqual([]);
    expect(bericht.fehler.get('YOUTUBE')).toMatch(/kontingent/iu);
  });

  it('bucht den Verbrauch auch dann, wenn der Aufruf scheitert', async () => {
    /*
     * Eine Anfrage, die fehlschlaegt, kostet bei Google trotzdem. Ein Zaehler,
     * der nur Erfolge zaehlt, laeuft dem echten Verbrauch nach und fuehrt in
     * eine Sperre, die niemand erwartet.
     */
    await kanalAnlegen();
    const { abruf } = youtube({ status: { code: 500, text: 'kaputt' } });
    const bot = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), { abruf, gateway: bot.modul });

    const stand = await streamer.leseKontingent(new Date(START.getTime() + 60_000));
    expect(stand.einheiten).toBeGreaterThan(0);
    expect(stand.abfragen).toBeGreaterThan(0);
  });

  it('kostet im genauen Modus hundert Einheiten und nimmt die Suche', async () => {
    await kanalAnlegen();
    await einstellungen({ youtubeGenau: true });
    const { abruf, pfade } = youtube({
      playlist: [VIDEO],
      videos: { [VIDEO]: { zustand: 'live' } },
    });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });

    expect(pfade.some((pfad) => pfad.endsWith('/search'))).toBe(true);
    expect(pfade.some((pfad) => pfad.endsWith('/playlistItems'))).toBe(false);
    // 100 fuer die Suche plus 1 fuer die Videoabfrage - das ist der Preis, den
    // der Einstellungstext nennt.
    expect(bericht.youtubeEinheiten).toBe(101);
  });

  it('schlaegt einen Kanal fuer eine Einheit nach - nicht fuer hundert', async () => {
    /*
     * `forHandle` gibt es seit 2023. Wer diese Auflösung durch eine Suche
     * ersetzt, verhundertfacht die Kosten jeder Registrierung - und merkt es
     * erst, wenn das Kontingent mittags weg ist.
     */
    const abruf = async (url: string): Promise<Response> => {
      expect(new URL(url).pathname).toMatch(/\/channels$/u);
      expect(new URL(url).searchParams.get('forHandle')).toBe('@swisshub');
      return new Response(
        JSON.stringify({
          items: [
            {
              id: LEA_KANAL,
              snippet: { title: 'SwissHub', customUrl: '@swisshub' },
              contentDetails: { relatedPlaylists: { uploads: LEA_PLAYLIST } },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const ergebnis = await streamer.holeKanal({ handle: 'swisshub' }, abruf);
    expect(ergebnis.art).toBe('ok');
    if (ergebnis.art === 'ok') {
      expect(ergebnis.wert?.id).toBe(LEA_KANAL);
      expect(ergebnis.wert?.uploadsPlaylistId).toBe(LEA_PLAYLIST);
    }
    expect((await streamer.leseKontingent()).einheiten).toBe(1);
  });
});
