import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type { DiscordGateway } from '@swisshub/discord';

useTestSchema('test_streamer_live');

/**
 * Live-Erkennung und Ankuendigung, vom ersten Durchgang bis zum Ende.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die ganze Absicherung aus zwei Eindeutigkeitsbedingungen besteht:
 *
 *   - `@@unique([kanalId, externeSessionId])` - eine Session je Stream
 *   - `StreamerAnkuendigung.sessionId @unique` - eine Ankuendigung je Session
 *
 * Beides gibt es in einer Nachbildung von Prisma nicht. Ein Test dagegen wuerde
 * bestaetigen, dass die Nachbildung tut, was man ihr beigebracht hat.
 *
 * ## Was hier tatsaechlich schiefgehen kann
 *
 * Alles aus §9.3, und jedes davon ist ein Kanal voller Ankuendigungen:
 *
 *   - **Bot-Neustart** - zweite Ankuendigung fuer denselben Stream
 *   - **Erneute API-Meldung** - dasselbe
 *   - **Kurzer Unterbruch** - Session beendet, neue Session, neue Ankuendigung
 *   - **API-Fehler** - alle Sessions beendet, beim naechsten Durchgang alle neu
 *   - **Ruhezeit** - drei Neustarts am Abend, drei Ankuendigungen
 *
 * Und §7.2, der Satz, an dem alles haengt: **keine Auskunft ist nicht offline.**
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');

const { prisma } = await import('@swisshub/database');
const { streamer, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const secrets = await import('@swisshub/secrets');

const KANAL_ID = '200000000000000001';
const LEA = '100000000000000001';
const BEN = '100000000000000002';

/** Twitchs Kennung des Kanals - nicht der Name, siehe `plattform.ts`. */
const LEA_TWITCH = '10000001';
const BEN_TWITCH = '10000002';

/** 26.09.2026, 20:00 UTC - der Stream beginnt. */
const START = new Date('2026-09-26T20:00:00.000Z');

interface TwitchAntwort {
  /** Welche Kennungen als live gemeldet werden - und mit welcher `stream.id`. */
  live: Array<{ benutzerId: string; sessionId: string; zuschauer?: number | null }>;
  /** Statt einer Antwort ein Netzfehler. */
  wirft?: string;
  /** Statt einer Antwort ein HTTP-Status. */
  status?: number;
}

/**
 * Eine Twitch-Attrappe.
 *
 * Bedient zwei Endpunkte: das Token und `/helix/streams`. Sie zaehlt mit, wie
 * oft gefragt wurde - das ist die Gegenprobe zur Buendelung.
 */
function twitch(antwort: TwitchAntwort): {
  abruf: (url: string, init?: RequestInit) => Promise<Response>;
  streamAbfragen: string[];
} {
  const streamAbfragen: string[] = [];
  const abruf = async (url: string): Promise<Response> => {
    if (url.includes('id.twitch.tv')) {
      return new Response(JSON.stringify({ access_token: 'attrappe-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    streamAbfragen.push(url);
    if (antwort.wirft) {
      throw new Error(antwort.wirft);
    }
    if (antwort.status) {
      return new Response('{"error":"nope"}', { status: antwort.status });
    }
    return new Response(
      JSON.stringify({
        data: antwort.live.map((eintrag) => ({
          id: eintrag.sessionId,
          user_id: eintrag.benutzerId,
          user_login: `kanal_${eintrag.benutzerId}`,
          user_name: `Kanal ${eintrag.benutzerId}`,
          title: 'Feierabend-Runde',
          game_name: 'Valorant',
          thumbnail_url: 'https://cdn/live_a-{width}x{height}.jpg',
          ...(eintrag.zuschauer === null ? {} : { viewer_count: eintrag.zuschauer ?? 42 }),
          language: 'de',
          started_at: START.toISOString(),
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { abruf, streamAbfragen };
}

/** Ein Gateway, das mitschreibt. */
function gateway(scheitert?: string): {
  send: ReturnType<typeof vi.fn>;
  modul: DiscordGateway;
} {
  const send = vi.fn(async (channelId: string) => {
    if (scheitert) {
      throw new Error(scheitert);
    }
    return { id: `msg-${send.mock.calls.length}`, channelId };
  });
  return { send, modul: { channels: { send, edit: vi.fn() } } as unknown as DiscordGateway };
}

async function einstellungen(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(streamer.STREAMER_MODULE_ID, true, 'test');
  await setModuleSettings(
    streamer.STREAMER_MODULE_ID,
    {
      twitchAktiv: true,
      twitchIntervallMinuten: 3,
      youtubeAktiv: false,
      ankuendigungAktiv: true,
      ankuendigungChannelId: KANAL_ID,
      cooldownMinuten: 0,
      maxProTag: 20,
      ...teile,
    },
    'test',
  );
}

/** Ein freigegebener Streamer mit einem bestaetigten Twitch-Kanal. */
async function streamerAnlegen(discordId: string, externeId: string, name: string): Promise<string> {
  await prisma.discordMemberCache.create({
    data: { discordId, username: name.toLowerCase(), displayName: name },
  });
  await prisma.memberProfile.create({
    data: { discordId, displayName: name, publicSlug: name.toLowerCase(), visibilityProfile: 'PUBLIC' },
  });
  const profil = await prisma.streamerProfil.create({
    data: { discordId, status: 'APPROVED', sprachen: ['de'], ankuendigungAktiv: true },
  });
  await prisma.streamerKanal.create({
    data: {
      profilId: profil.id,
      plattform: 'TWITCH',
      externeId,
      handle: `kanal_${externeId}`,
      anzeigename: name,
      verifikation: 'OAUTH',
      aktiv: true,
    },
  });
  return profil.id;
}

const ankuendigungen = async (): Promise<number> =>
  prisma.streamerAnkuendigung.count({ where: { messageId: { not: null } } });

describeWithDatabase('Streamer Hub: Live-Erkennung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    // Das App Access Token lebt im Modulzustand - zwischen zwei Faellen ist es
    // ein anderer Lauf, und der soll es frisch holen.
    streamer.verwerfeToken();
    await prisma.streamerAnkuendigung.deleteMany();
    await prisma.streamerSession.deleteMany();
    await prisma.streamerKanal.deleteMany();
    await prisma.streamerProfil.deleteMany();
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await prisma.streamerApiVerbrauch.deleteMany();
    await secrets.setSecret('twitch', 'clientId', 'abcdefghij0123456789', { actorDiscordId: 'test' });
    await secrets.setSecret('twitch', 'clientSecret', 'kein-echtes-secret-nur-ein-testwert', {
      actorDiscordId: 'test',
    });
    await einstellungen();
  });

  it('kuendigt einen Stream genau einmal an - auch nach drei weiteren Durchgaengen', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    const bot = gateway();

    const erster = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(erster.neueSessions).toBe(1);
    expect(erster.ankuendigungen).toBe(1);
    expect(bot.send).toHaveBeenCalledTimes(1);

    /*
     * Drei weitere Durchgaenge mit derselben Antwort. Das ist der Fall
     * «erneute API-Meldung»: Twitch meldet denselben Stream, solange er
     * laeuft - alle drei Minuten, stundenlang.
     */
    for (const minuten of [4, 8, 12]) {
      await streamer.runStreamerTick(new Date(START.getTime() + minuten * 60_000), {
        abruf,
        gateway: bot.modul,
      });
    }
    expect(bot.send).toHaveBeenCalledTimes(1);
    expect(await prisma.streamerSession.count()).toBe(1);
    expect(await ankuendigungen()).toBe(1);
  });

  it('kuendigt nach einem Bot-Neustart nicht erneut an', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });

    const vorher = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), { abruf, gateway: vorher.modul });
    expect(vorher.send).toHaveBeenCalledTimes(1);

    /*
     * Ein Neustart ist fuer diesen Code: neuer Prozess, leerer Speicher,
     * dieselbe Datenbank. Genau das wird hier nachgestellt - das Token wird
     * verworfen, das Gateway ist ein neues.
     */
    streamer.verwerfeToken();
    const nachher = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 5 * 60_000), {
      abruf,
      gateway: nachher.modul,
    });
    expect(nachher.send).not.toHaveBeenCalled();
    expect(await ankuendigungen()).toBe(1);
  });

  it('haelt bei einem Twitch-Ausfall jeden Zustand - und beendet nichts', async () => {
    /*
     * Der Fehler, den §7.2 verbietet. Ohne diese Regel: Twitch antwortet
     * einmal nicht, alle Sessions werden beendet, beim naechsten Durchgang
     * sind alle wieder live - mit neuer Session und neuer Ankuendigung. Nach
     * einem halben Tag Netzproblemen stuenden zwanzig Ankuendigungen im Kanal.
     */
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const bot = gateway();
    const gut = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: gut.abruf,
      gateway: bot.modul,
    });

    const kaputt = twitch({ live: [], wirft: 'fetch failed' });
    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 30 * 60_000), {
      abruf: kaputt.abruf,
      gateway: bot.modul,
    });

    expect(bericht.fehler.get('TWITCH')).toMatch(/fetch failed/u);
    expect(bericht.beendeteSessions).toBe(0);
    // Die Session lebt weiter - und der Grund steht am Kanal, damit das
    // Dashboard erklaeren kann, warum jemand seit Stunden offline aussieht.
    const session = await prisma.streamerSession.findFirstOrThrow();
    expect(session.beendetAm).toBeNull();
    const kanal = await prisma.streamerKanal.findFirstOrThrow();
    expect(kanal.letzterFehler).toMatch(/fetch failed/u);
    expect(kanal.letzterFehlerAm).not.toBeNull();
  });

  it('haelt einen kurzen Unterbruch aus, ohne zweimal anzukuendigen', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const bot = gateway();
    const live = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    const leer = twitch({ live: [] });

    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: live.abruf,
      gateway: bot.modul,
    });

    // Ein Durchgang, in dem der Kanal fehlt: Encoder neu gestartet, Server
    // gewechselt. Die Karenzzeit sind drei Durchgaenge - hier ist es einer.
    const unterbruch = await streamer.runStreamerTick(new Date(START.getTime() + 4 * 60_000), {
      abruf: leer.abruf,
      gateway: bot.modul,
    });
    expect(unterbruch.beendeteSessions).toBe(0);

    // Und er ist wieder da, mit derselben `stream.id` - Twitch behaelt sie
    // ueber einen Unterbruch hinweg.
    const wieder = await streamer.runStreamerTick(new Date(START.getTime() + 7 * 60_000), {
      abruf: live.abruf,
      gateway: bot.modul,
    });
    expect(wieder.neueSessions).toBe(0);
    expect(bot.send).toHaveBeenCalledTimes(1);
    expect(await prisma.streamerSession.count()).toBe(1);
  });

  it('beendet eine Session erst nach der Karenzzeit', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const bot = gateway();
    const live = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    const leer = twitch({ live: [] });

    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: live.abruf,
      gateway: bot.modul,
    });

    /*
     * Drei Durchgaenge à drei Minuten sind neun Minuten. Die Grenze ist
     * `zuletztGesehenAm < jetzt - intervall * KARENZ_DURCHGAENGE`, also neun
     * Minuten nach dem letzten Sehen - deshalb wird hier zehn Minuten spaeter
     * gefragt.
     */
    const beendet = await streamer.runStreamerTick(new Date(START.getTime() + 11 * 60_000), {
      abruf: leer.abruf,
      gateway: bot.modul,
    });
    expect(beendet.beendeteSessions).toBe(1);
    const session = await prisma.streamerSession.findFirstOrThrow();
    expect(session.beendetAm).not.toBeNull();
  });

  it('haelt die Ruhezeit je Streamer ein', async () => {
    /*
     * Gegen den, der dreimal am Abend neu startet. Jeder Neustart ist bei
     * Twitch eine neue `stream.id` - also eine neue Session, die fuer sich
     * genommen ankuendigungswuerdig waere.
     */
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    await einstellungen({ cooldownMinuten: 180 });
    const bot = gateway();

    const erste = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: 'stream-1' }] });
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: erste.abruf,
      gateway: bot.modul,
    });
    expect(bot.send).toHaveBeenCalledTimes(1);

    // Neuer Stream, zwanzig Minuten spaeter. Neue Session - aber Ruhezeit.
    const zweite = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: 'stream-2' }] });
    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 20 * 60_000), {
      abruf: zweite.abruf,
      gateway: bot.modul,
    });
    expect(bericht.neueSessions).toBe(1);
    expect(bericht.ankuendigungen).toBe(0);
    expect(bot.send).toHaveBeenCalledTimes(1);
  });

  it('kuendigt nichts an, wenn Ankuendigungen aus sind oder kein Kanal gewaehlt ist', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });

    await einstellungen({ ankuendigungAktiv: false });
    const aus = gateway();
    const ohne = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: aus.modul,
    });
    // Die Erkennung laeuft weiter - nur gesendet wird nichts.
    expect(ohne.neueSessions).toBe(1);
    expect(aus.send).not.toHaveBeenCalled();

    await einstellungen({ ankuendigungAktiv: true, ankuendigungChannelId: '' });
    const leer = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 4 * 60_000), {
      abruf,
      gateway: leer.modul,
    });
    expect(leer.send).not.toHaveBeenCalled();
  });

  it('kuendigt einen Streamer nicht an, der das nicht will', async () => {
    const profilId = await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    await prisma.streamerProfil.update({ where: { id: profilId }, data: { ankuendigungAktiv: false } });
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(bericht.neueSessions).toBe(1);
    expect(bot.send).not.toHaveBeenCalled();
  });

  it('fragt einen pausierten Streamer nicht ab', async () => {
    const profilId = await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    await streamerAnlegen(BEN, BEN_TWITCH, 'Ben');
    await prisma.streamerProfil.update({ where: { id: profilId }, data: { status: 'SUSPENDED' } });

    const { abruf, streamAbfragen } = twitch({
      live: [
        { benutzerId: LEA_TWITCH, sessionId: 'stream-lea' },
        { benutzerId: BEN_TWITCH, sessionId: 'stream-ben' },
      ],
    });
    const bot = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), { abruf, gateway: bot.modul });

    // Eine Abfrage fuer alle Kanaele - und die des pausierten Streamers steht
    // nicht darin.
    expect(streamAbfragen).toHaveLength(1);
    expect(streamAbfragen[0]).toContain(BEN_TWITCH);
    expect(streamAbfragen[0]).not.toContain(LEA_TWITCH);
    expect(bot.send).toHaveBeenCalledTimes(1);
  });

  it('versucht eine gescheiterte Ankuendigung erneut - ohne die erste zu verdoppeln', async () => {
    /*
     * Discord war weg. Die Zeile bleibt **stehen**, mit Fehler und
     * Versuchszaehler: sie zu loeschen waere naheliegend und falsch, denn dann
     * koennte ein zweiter Durchgang senden, waehrend der erste noch wartet.
     */
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });

    const kaputt = gateway('503 Service Unavailable');
    const erster = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: kaputt.modul,
    });
    expect(erster.ankuendigungen).toBe(0);
    const offen = await prisma.streamerAnkuendigung.findFirstOrThrow();
    expect(offen.messageId).toBeNull();
    expect(offen.versuche).toBe(1);
    expect(offen.fehler).toMatch(/503/u);

    const gut = gateway();
    const zweiter = await streamer.runStreamerTick(new Date(START.getTime() + 4 * 60_000), {
      abruf,
      gateway: gut.modul,
    });
    expect(zweiter.ankuendigungen).toBe(1);
    expect(gut.send).toHaveBeenCalledTimes(1);
    expect(await prisma.streamerAnkuendigung.count()).toBe(1);
  });

  it('kuendigt einen Stream nicht mehr an, der schon eine Stunde laeuft', async () => {
    /*
     * War der Bot drei Stunden aus, ist «X ist jetzt live» fuer einen Stream,
     * der bald endet, kein Dienst an der Gemeinschaft - sondern Laerm.
     */
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421' }] });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 90 * 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(bericht.neueSessions).toBe(1);
    expect(bericht.ankuendigungen).toBe(0);
    expect(bot.send).not.toHaveBeenCalled();
  });

  it('nennt keine Zuschauerzahl, die Twitch nicht geliefert hat', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({
      live: [{ benutzerId: LEA_TWITCH, sessionId: '48215309421', zuschauer: null }],
    });
    const bot = gateway();
    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), { abruf, gateway: bot.modul });

    const session = await prisma.streamerSession.findFirstOrThrow();
    expect(session.zuschauer).toBeNull();
    expect(session.zuschauerHoehepunkt).toBeNull();
    expect(JSON.stringify(bot.send.mock.calls)).not.toContain('Zuschauer');
  });

  it('laesst den Zuschauerhoehepunkt nicht sinken', async () => {
    /*
     * Die einzige Reichweitenzahl, die wir wirklich beobachtet haben. Sie darf
     * nicht fallen, wenn die letzte Messung eines Streams niedriger ausfaellt
     * als seine Mitte - sonst stuende in der Statistik ein Hoehepunkt, den es
     * so nie gab.
     */
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const bot = gateway();
    const hoch = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: 's1', zuschauer: 120 }] });
    const tief = twitch({ live: [{ benutzerId: LEA_TWITCH, sessionId: 's1', zuschauer: 8 }] });

    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf: hoch.abruf,
      gateway: bot.modul,
    });
    await streamer.runStreamerTick(new Date(START.getTime() + 4 * 60_000), {
      abruf: tief.abruf,
      gateway: bot.modul,
    });

    const session = await prisma.streamerSession.findFirstOrThrow();
    expect(session.zuschauer).toBe(8);
    expect(session.zuschauerHoehepunkt).toBe(120);
  });

  it('fragt eine Plattform nicht oefter als ihr Intervall - einen neuen Kanal aber sofort', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf, streamAbfragen } = twitch({ live: [] });
    const bot = gateway();

    await streamer.runStreamerTick(new Date(START.getTime() + 60_000), { abruf, gateway: bot.modul });
    expect(streamAbfragen).toHaveLength(1);

    // Eine Minute spaeter, Intervall drei Minuten: nicht faellig.
    const zu_frueh = await streamer.runStreamerTick(new Date(START.getTime() + 120_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(zu_frueh.abgefragt).toEqual([]);
    expect(streamAbfragen).toHaveLength(1);

    /*
     * Und ein frisch freigegebener Kanal macht die Plattform sofort faellig -
     * sein `zuletztGeprueftAm` ist `null`. Sonst wartete er bis zum naechsten
     * regulaeren Durchgang, und das faellt beim Freigeben auf.
     */
    await streamerAnlegen(BEN, BEN_TWITCH, 'Ben');
    const neu = await streamer.runStreamerTick(new Date(START.getTime() + 150_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(neu.abgefragt).toEqual(['TWITCH']);
    expect(streamAbfragen).toHaveLength(2);
  });

  it('haelt die Tagesobergrenze ein', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    await streamerAnlegen(BEN, BEN_TWITCH, 'Ben');
    await einstellungen({ maxProTag: 1, cooldownMinuten: 0 });

    const { abruf } = twitch({
      live: [
        { benutzerId: LEA_TWITCH, sessionId: 'stream-lea' },
        { benutzerId: BEN_TWITCH, sessionId: 'stream-ben' },
      ],
    });
    const bot = gateway();
    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });

    expect(bericht.neueSessions).toBe(2);
    expect(bericht.ankuendigungen).toBe(1);
    expect(bot.send).toHaveBeenCalledTimes(1);
  });

  it('meldet einen Fehler statt halber Auskunft, wenn Helix ablehnt', async () => {
    await streamerAnlegen(LEA, LEA_TWITCH, 'Lea');
    const { abruf } = twitch({ live: [], status: 401 });
    const bot = gateway();

    const bericht = await streamer.runStreamerTick(new Date(START.getTime() + 60_000), {
      abruf,
      gateway: bot.modul,
    });
    expect(bericht.fehler.get('TWITCH')).toMatch(/401/u);
    expect(bericht.neueSessions).toBe(0);
    // Kein Wurf: der Bot bleibt am Leben, auch wenn Twitch es nicht ist.
    expect(bericht.beendeteSessions).toBe(0);
  });
});
