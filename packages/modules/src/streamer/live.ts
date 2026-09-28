import { appUrl } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { systemRoutes } from '@swisshub/shared';
import type { StreamerKanal, StreamerPlattform } from '@swisshub/database';
import { STREAMER_MODULE_ID, type StreamerSettings } from './config';
import { getModuleSettings } from '../module-state';
import { streamAdresse } from './plattform';
import { holeStreams, type Abruf, type TwitchStream } from './twitch';
import { holeLive, leseKontingent, type YouTubeLive } from './youtube';
import { kuendigeAn, type AnkuendigungsDaten, type SessionMitKanal } from './ankuendigung';

/**
 * Die Live-Erkennung.
 *
 * ## Der Satz, an dem alles haengt
 *
 * **«Keine Auskunft» ist nicht «offline».**
 *
 * Wer das verwechselt, baut genau den Fehler, den §7.2 verbietet: Twitch
 * antwortet einmal nicht, alle Sessions werden beendet, und beim naechsten
 * Durchgang sind alle wieder live - mit neuer Session und neuer Ankuendigung.
 * Nach einem halben Tag Netzproblemen stuenden zwanzig Ankuendigungen im Kanal.
 *
 * Deshalb: beendet wird eine Session nur, wenn die Plattform **geantwortet**
 * hat und der Kanal nicht dabei war. Ein Fehler laesst jeden Zustand stehen
 * und vermerkt sich am Kanal, damit das Dashboard erklaeren kann, warum ein
 * Streamer seit Stunden offline aussieht.
 *
 * ## Und die Karenzzeit dazu
 *
 * Auch eine erfolgreiche Antwort kann einen Kanal auslassen, der gleich wieder
 * da ist - ein Neustart des Encoders, ein Wechsel des Servers. Deshalb wird
 * nicht beim ersten Fehlen beendet, sondern erst, wenn der Kanal drei
 * Durchgaenge lang nicht mehr gemeldet wurde. Auf die Ankuendigung hat das
 * keinen Einfluss: die haengt an der Session-Kennung der Plattform, und die
 * bleibt ueber einen Unterbruch hinweg dieselbe.
 *
 * ## Warum kein `setTimeout`
 *
 * Weil ein Timer im Speicher lebt und ein Neustart ihn vergisst. Hier wird
 * jeder Durchgang neu gefragt, und die Antwort steht in der Datenbank:
 * `zuletztGeprueftAm` am Kanal sagt, wann zuletzt gefragt wurde - auch dem
 * Prozess, der gerade erst gestartet ist.
 */

const log = createLogger('streamer:live');

/** Nach wie vielen ausgelassenen Durchgaengen eine Session als beendet gilt. */
export const KARENZ_DURCHGAENGE = 3;

export interface TickBericht {
  /** Wurde ueberhaupt etwas abgefragt? */
  abgefragt: StreamerPlattform[];
  neueSessions: number;
  beendeteSessions: number;
  ankuendigungen: number;
  /** Plattform → Grund. Leer heisst: alles hat geantwortet. */
  fehler: Map<StreamerPlattform, string>;
  /** Wie viele YouTube-Kontingenteinheiten dieser Durchgang gekostet hat. */
  youtubeEinheiten: number;
}

type KanalMitProfil = StreamerKanal & {
  profil: { id: string; discordId: string; ankuendigungAktiv: boolean; status: string };
};

/**
 * Die Kanaele, die abgefragt werden.
 *
 * Nur freigegebene Streamer und nur aktive Kanaele. Ein pausierter Streamer
 * wird nicht abgefragt - das spart nicht nur Anfragen, es verhindert auch, dass
 * seine Session weiterlaeuft, waehrend er nicht sichtbar ist.
 */
async function abzufragendeKanaele(plattform: StreamerPlattform): Promise<KanalMitProfil[]> {
  return prisma.streamerKanal.findMany({
    where: { plattform, aktiv: true, profil: { status: 'APPROVED' } },
    include: {
      profil: { select: { id: true, discordId: true, ankuendigungAktiv: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Ist diese Plattform jetzt faellig?
 *
 * Gemessen am **aeltesten** `zuletztGeprueftAm` der Kanaele: solange ein Kanal
 * lange nicht gefragt wurde, ist die Plattform faellig. Ein neu hinzugekommener
 * Kanal (`null`) macht sie sofort faellig - sonst wartete ein frisch
 * freigegebener Streamer bis zum naechsten regulaeren Durchgang.
 */
export function istFaellig(
  kanaele: readonly { zuletztGeprueftAm: Date | null }[],
  intervallMinuten: number,
  jetzt: Date,
): boolean {
  if (kanaele.length === 0) {
    return false;
  }
  const aeltester = kanaele.reduce<Date | null>((aeltest, kanal) => {
    if (kanal.zuletztGeprueftAm === null) {
      return null;
    }
    if (aeltest === null) {
      return null;
    }
    return kanal.zuletztGeprueftAm < aeltest ? kanal.zuletztGeprueftAm : aeltest;
  }, new Date(8640000000000000));
  if (aeltester === null) {
    return true;
  }
  return jetzt.getTime() - aeltester.getTime() >= intervallMinuten * 60_000;
}

interface GemeldeteSession {
  externeSessionId: string;
  titel: string | null;
  spiel: string | null;
  vorschaubildUrl: string | null;
  zuschauer: number | null;
  sprache: string | null;
  gestartetAm: Date;
}

const ausTwitch = (stream: TwitchStream): GemeldeteSession => ({
  externeSessionId: stream.sessionId,
  titel: stream.titel,
  spiel: stream.spiel,
  vorschaubildUrl: stream.vorschaubildUrl,
  zuschauer: stream.zuschauer,
  sprache: stream.sprache,
  gestartetAm: stream.gestartetAm,
});

const ausYouTube = (stream: YouTubeLive): GemeldeteSession => ({
  externeSessionId: stream.videoId,
  titel: stream.titel,
  /*
   * YouTube meldet kein Spiel. Nicht raten und nicht aus dem Titel lesen - ein
   * geratenes Spiel stuende danach in einer Ankuendigung und auf einer Grafik.
   */
  spiel: null,
  vorschaubildUrl: stream.vorschaubildUrl,
  zuschauer: stream.zuschauer,
  sprache: null,
  gestartetAm: stream.gestartetAm,
});

/**
 * Eine gemeldete Session festhalten.
 *
 * `upsert` auf `(kanalId, externeSessionId)`. Gibt zurueck, ob sie neu ist -
 * nur eine neue Session ist ein Anlass fuer eine Ankuendigung.
 *
 * Eine wiedereroeffnete Session (`beendetAm` war gesetzt) gilt **nicht** als
 * neu: die Plattform meldet dieselbe Kennung, also ist es derselbe Stream, und
 * er wurde schon angekuendigt. Die Eindeutigkeit auf der Ankuendigung wuerde
 * es ohnehin verhindern - aber es hier gar nicht erst zu versuchen, spart eine
 * Abfrage und macht die Absicht lesbar.
 */
async function haltefest(
  kanal: KanalMitProfil,
  gemeldet: GemeldeteSession,
  /*
   * Die Zeit des Durchgangs, nicht die Systemzeit.
   *
   * `beendeAbgelaufene` vergleicht `zuletztGesehenAm` mit einer Grenze, die aus
   * demselben `jetzt` entsteht. Kaeme das eine aus dem Durchgang und das andere
   * aus `new Date()`, waeren es zwei Uhren - in Produktion um Millisekunden
   * verschieden, in einem Test um Stunden.
   */
  jetzt: Date,
): Promise<{ sessionId: string; neu: boolean }> {
  const bestehend = await prisma.streamerSession.findUnique({
    where: { kanalId_externeSessionId: { kanalId: kanal.id, externeSessionId: gemeldet.externeSessionId } },
    select: { id: true, zuschauerHoehepunkt: true },
  });

  const streamUrl = streamAdresse(kanal.plattform, kanal.handle, gemeldet.externeSessionId);

  if (bestehend) {
    await prisma.streamerSession.update({
      where: { id: bestehend.id },
      data: {
        titel: gemeldet.titel,
        spiel: gemeldet.spiel,
        vorschaubildUrl: gemeldet.vorschaubildUrl,
        zuschauer: gemeldet.zuschauer,
        sprache: gemeldet.sprache,
        streamUrl,
        zuletztGesehenAm: jetzt,
        // Wiedereroeffnen, falls die Karenzzeit sie schon beendet hatte.
        beendetAm: null,
        /*
         * Der Hoehepunkt waechst nur. Das ist die einzige Reichweitenzahl, die
         * wir wirklich beobachtet haben - und sie darf nicht sinken, wenn die
         * letzte Messung eines Streams niedriger ausfaellt als seine Mitte.
         */
        ...(gemeldet.zuschauer !== null &&
        (bestehend.zuschauerHoehepunkt === null || gemeldet.zuschauer > bestehend.zuschauerHoehepunkt)
          ? { zuschauerHoehepunkt: gemeldet.zuschauer }
          : {}),
      },
    });
    return { sessionId: bestehend.id, neu: false };
  }

  const angelegt = await prisma.streamerSession.create({
    data: {
      kanalId: kanal.id,
      externeSessionId: gemeldet.externeSessionId,
      titel: gemeldet.titel,
      spiel: gemeldet.spiel,
      vorschaubildUrl: gemeldet.vorschaubildUrl,
      zuschauer: gemeldet.zuschauer,
      zuschauerHoehepunkt: gemeldet.zuschauer,
      sprache: gemeldet.sprache,
      streamUrl,
      gestartetAm: gemeldet.gestartetAm,
      zuletztGesehenAm: jetzt,
    },
    select: { id: true },
  });
  return { sessionId: angelegt.id, neu: true };
}

/**
 * Sessions beenden, die lange nicht mehr gemeldet wurden.
 *
 * Nur fuer Kanaele, zu denen es eine **Antwort** gab: `gepruefte`. Wer wegen
 * eines Fehlers nicht dabei war, behaelt seinen Zustand.
 */
async function beendeAbgelaufene(
  gepruefteKanalIds: readonly string[],
  intervallMinuten: number,
  jetzt: Date,
): Promise<number> {
  if (gepruefteKanalIds.length === 0) {
    return 0;
  }
  const grenze = new Date(jetzt.getTime() - intervallMinuten * KARENZ_DURCHGAENGE * 60_000);
  const ergebnis = await prisma.streamerSession.updateMany({
    where: {
      kanalId: { in: [...gepruefteKanalIds] },
      beendetAm: null,
      zuletztGesehenAm: { lt: grenze },
    },
    data: { beendetAm: jetzt },
  });
  return ergebnis.count;
}

/** Den Kanal als geprueft vermerken - mit oder ohne Fehler. */
async function vermerkePruefung(
  kanalIds: readonly string[],
  jetzt: Date,
  fehler: string | null,
): Promise<void> {
  if (kanalIds.length === 0) {
    return;
  }
  await prisma.streamerKanal.updateMany({
    where: { id: { in: [...kanalIds] } },
    data: {
      zuletztGeprueftAm: jetzt,
      letzterFehler: fehler ? fehler.slice(0, 300) : null,
      letzterFehlerAm: fehler ? jetzt : null,
    },
  });
}

/**
 * Die Anzeigedaten fuer eine Ankuendigung.
 *
 * Aus dem **Mitgliedsprofil**, nicht aus der Plattform. Wer auf SwissHub einen
 * Anzeigenamen gewaehlt hat, soll unter diesem angekuendigt werden - sonst
 * hiesse dieselbe Person auf Discord anders als in ihrem Profil.
 */
async function ankuendigungsDaten(discordId: string): Promise<AnkuendigungsDaten> {
  const profil = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { displayName: true, publicSlug: true, visibilityProfile: true },
  });
  /*
   * Der Spiegel des Discord-Mitglieds - dieselbe Tabelle, aus der auch die
   * Mitgliedersuche und die Levelkarte ihre Namen nehmen. Ein eigener Name im
   * Streamer-Profil waere ein dritter, der irgendwann von beiden abweicht.
   */
  const mitglied = await prisma.discordMemberCache.findUnique({
    where: { discordId },
    select: { displayName: true, username: true, avatarHash: true },
  });

  const anzeigename =
    profil?.displayName?.trim() ||
    mitglied?.displayName?.trim() ||
    mitglied?.username?.trim() ||
    'Ein SwissHub-Mitglied';

  return {
    anzeigename,
    profilbildUrl: mitglied?.avatarHash
      ? `https://cdn.discordapp.com/avatars/${discordId}/${mitglied.avatarHash}.png?size=128`
      : null,
    /*
     * Der Verweis auf die oeffentliche Streamer-Seite nur, wenn es einen Slug
     * gibt **und** das Profil oeffentlich steht. Ein Knopf, der auf eine 404
     * fuehrt, ist schlechter als keiner.
     */
    swisshubUrl:
      profil?.publicSlug && profil.visibilityProfile === 'PUBLIC'
        ? appUrl(systemRoutes.streamerOeffentlichProfil(profil.publicSlug))
        : null,
  };
}

/**
 * Ein Durchgang.
 *
 * Reihenfolge: abfragen → festhalten → beenden → ankuendigen. Ankuendigen zum
 * Schluss, weil eine Ankuendigung den Zustand braucht, den die Schritte davor
 * hergestellt haben - und weil ein Fehler beim Senden nichts an der Erkennung
 * kaputtmachen darf.
 */
export async function runStreamerTick(
  jetzt: Date = new Date(),
  optionen: { abruf?: Abruf; gateway?: DiscordGateway } = {},
): Promise<TickBericht> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const settings = await getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID);

  const bericht: TickBericht = {
    abgefragt: [],
    neueSessions: 0,
    beendeteSessions: 0,
    ankuendigungen: 0,
    fehler: new Map(),
    youtubeEinheiten: 0,
  };

  // --- Twitch ----------------------------------------------------------------
  if (settings.twitchAktiv) {
    const kanaele = await abzufragendeKanaele('TWITCH');
    if (istFaellig(kanaele, settings.twitchIntervallMinuten, jetzt)) {
      bericht.abgefragt.push('TWITCH');
      const ergebnis = await holeStreams(
        kanaele.map((kanal) => kanal.externeId),
        optionen.abruf,
      );

      if (ergebnis.art === 'fehler') {
        /*
         * Kein Zustand wird angefasst - nur der Vermerk am Kanal. Dass die
         * Pruefzeit trotzdem gesetzt wird, ist Absicht: sonst waere die
         * Plattform in jeder Minute faellig und liefe bei einem laengeren
         * Ausfall in eine Endlosschleife von Fehlversuchen.
         */
        bericht.fehler.set('TWITCH', ergebnis.grund);
        await vermerkePruefung(
          kanaele.map((kanal) => kanal.id),
          jetzt,
          ergebnis.grund,
        );
        log.warn('Twitch-Abfrage gescheitert', { grund: ergebnis.grund, kanaele: kanaele.length });
      } else {
        for (const kanal of kanaele) {
          const stream = ergebnis.wert.get(kanal.externeId);
          if (stream) {
            const { neu } = await haltefest(kanal, ausTwitch(stream), jetzt);
            if (neu) {
              bericht.neueSessions += 1;
            }
          }
        }
        bericht.beendeteSessions += await beendeAbgelaufene(
          kanaele.map((kanal) => kanal.id),
          settings.twitchIntervallMinuten,
          jetzt,
        );
        await vermerkePruefung(
          kanaele.map((kanal) => kanal.id),
          jetzt,
          null,
        );
      }
    }
  }

  // --- YouTube ---------------------------------------------------------------
  if (settings.youtubeAktiv) {
    const kanaele = await abzufragendeKanaele('YOUTUBE');
    if (istFaellig(kanaele, settings.youtubeIntervallMinuten, jetzt)) {
      bericht.abgefragt.push('YOUTUBE');
      const stand = await leseKontingent(jetzt);
      const rest = Math.max(settings.youtubeKontingent - stand.einheiten, 0);

      if (rest <= 0) {
        bericht.fehler.set('YOUTUBE', 'Tageskontingent aufgebraucht.');
        await vermerkePruefung(
          kanaele.map((kanal) => kanal.id),
          jetzt,
          'Tageskontingent aufgebraucht.',
        );
      } else {
        const ergebnis = await holeLive(
          kanaele.map((kanal) => ({
            kanalId: kanal.externeId,
            /*
             * Die Uploads-Playlist ist die `UC`-Kennung mit `UU` am Anfang.
             * Hier wird sie abgeleitet und nicht gespeichert: sie ist eine
             * Funktion der Kanalkennung, und eine gespeicherte Kopie koennte
             * davon abweichen. Wer es genauer will, schaltet auf die Suche um.
             */
            uploadsPlaylistId: `UU${kanal.externeId.slice(2)}`,
          })),
          { genau: settings.youtubeGenau, kontingentRest: rest, jetzt },
          optionen.abruf,
        );
        bericht.youtubeEinheiten = ergebnis.verbrauchteEinheiten;

        const beantwortet: string[] = [];
        for (const kanal of kanaele) {
          const unbekannt = ergebnis.unbekannt.get(kanal.externeId);
          if (unbekannt) {
            // Keine Auskunft: Zustand bleibt, Grund wird vermerkt.
            await vermerkePruefung([kanal.id], jetzt, unbekannt);
            continue;
          }
          beantwortet.push(kanal.id);
          const stream = ergebnis.live.get(kanal.externeId);
          if (stream) {
            const { neu } = await haltefest(kanal, ausYouTube(stream), jetzt);
            if (neu) {
              bericht.neueSessions += 1;
            }
          }
        }
        bericht.beendeteSessions += await beendeAbgelaufene(
          beantwortet,
          settings.youtubeIntervallMinuten,
          jetzt,
        );
        await vermerkePruefung(beantwortet, jetzt, null);
        if (ergebnis.unbekannt.size > 0) {
          bericht.fehler.set('YOUTUBE', [...ergebnis.unbekannt.values()][0] ?? 'Unbekannt.');
        }
      }
    }
  }

  // --- Ankuendigen -----------------------------------------------------------
  /*
   * Nicht nur die in diesem Durchgang neuen: auch eine Session, deren
   * Ankuendigung beim letzten Mal am Discord-Fehler gescheitert ist, gehoert
   * dazu. Die Auswahl ist deshalb «offen, jung, noch nicht gesendet» und nicht
   * «gerade angelegt» - nach einem Bot-Neustart waere die zweite Liste leer,
   * und die Ankuendigung fiele ganz aus.
   */
  if (settings.ankuendigungAktiv && settings.ankuendigungChannelId !== '') {
    const offene = await prisma.streamerSession.findMany({
      where: {
        beendetAm: null,
        gestartetAm: { gte: new Date(jetzt.getTime() - 30 * 60_000) },
        kanal: { profil: { status: 'APPROVED', ankuendigungAktiv: true } },
        OR: [{ ankuendigung: null }, { ankuendigung: { messageId: null } }],
      },
      include: {
        kanal: {
          include: {
            profil: { select: { discordId: true, ankuendigungAktiv: true, status: true } },
          },
        },
      },
      orderBy: { gestartetAm: 'asc' },
      // Eine Obergrenze je Durchgang: geht etwas schief, geht es nicht
      // zwanzigmal schief.
      take: 10,
    });

    for (const session of offene) {
      const daten = await ankuendigungsDaten(session.kanal.profil.discordId);
      const ergebnis = await kuendigeAn(session as SessionMitKanal, daten, settings, jetzt, gateway);
      if (ergebnis.art === 'gesendet') {
        bericht.ankuendigungen += 1;
      }
    }
  }

  if (bericht.abgefragt.length > 0) {
    log.debug('Streamer-Durchgang', {
      abgefragt: bericht.abgefragt,
      neu: bericht.neueSessions,
      beendet: bericht.beendeteSessions,
      angekuendigt: bericht.ankuendigungen,
      fehler: [...bericht.fehler.entries()],
    });
  }
  return bericht;
}
