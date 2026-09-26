import { prisma } from '@swisshub/database';
import { TWITCH_INTEGRATION_ID, YOUTUBE_INTEGRATION_ID, hasSecret } from '@swisshub/secrets';
import type { StreamerKanal, StreamerProfil, StreamerStatus } from '@swisshub/database';
import { STREAMER_MODULE_ID, type StreamerSettings } from './config';
import { getModuleSettings } from '../module-state';
import { leseKontingent } from './youtube';

/**
 * Die Abfragen fuer das Dashboard.
 *
 * ## Warum hier keine Zahl entsteht, die niemand erhoben hat
 *
 * Jede Kennzahl unten zaehlt Zeilen, die durch eine beobachtete Handlung
 * entstanden sind: eine Bewerbung, eine erkannte Session, eine gesendete
 * Ankuendigung, ein angelegter Spotlight. Es gibt keine geschaetzte
 * Reichweite, keine hochgerechneten Streaming-Stunden und kein Ranking.
 *
 * Die **Streaming-Stunden** sind das Beispiel, an dem sich das entscheidet: sie
 * werden aus `gestartetAm` bis `beendetAm` der Sessions gerechnet, die dieses
 * Modul selbst beobachtet hat. Fuer die Zeit davor gibt es sie nicht, und
 * `beobachtetSeit` sagt genau, ab wann. Ohne diese Angabe waere die Zahl eine
 * Behauptung ueber die ganze Vergangenheit eines Kanals.
 */

export interface StreamerKennzahlen {
  registriert: number;
  offeneBewerbungen: number;
  freigegeben: number;
  pausiert: number;
  jetztLive: number;
  /** Sessions, die dieses Modul selbst gesehen hat. */
  erkannteStreams: number;
  gesendeteAnkuendigungen: number;
  spotlights: number;
  /**
   * Beobachtete Streaming-Stunden - nur aus beendeten Sessions.
   *
   * Laufende bleiben draussen: ihre Dauer waechst noch, und eine Zahl, die
   * sich bei jedem Seitenaufruf aendert, sieht wie ein Fehler aus.
   */
  beobachteteStunden: number;
  /**
   * Ab wann beobachtet wird.
   *
   * `null` heisst: noch nie eine Session gesehen. Dann stehen die Stunden auf
   * null, und das ist richtig - nicht «keine Daten», sondern «noch nichts
   * passiert».
   */
  beobachtetSeit: Date | null;
}

export async function ladeKennzahlen(jetzt: Date = new Date()): Promise<StreamerKennzahlen> {
  const tagesbeginn = new Date(jetzt);
  tagesbeginn.setUTCHours(0, 0, 0, 0);

  const [nachStatus, jetztLive, erkannt, ankuendigungen, spotlights, beendet, aelteste] = await Promise.all([
    prisma.streamerProfil.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.streamerSession.count({ where: { beendetAm: null } }),
    prisma.streamerSession.count(),
    prisma.streamerAnkuendigung.count({ where: { gesendetAm: { not: null } } }),
    prisma.streamerSpotlight.count(),
    prisma.streamerSession.findMany({
      where: { beendetAm: { not: null } },
      select: { gestartetAm: true, beendetAm: true },
    }),
    prisma.streamerSession.findFirst({ orderBy: { gestartetAm: 'asc' }, select: { gestartetAm: true } }),
  ]);

  const zaehler = new Map<StreamerStatus, number>(
    nachStatus.map((zeile) => [zeile.status, zeile._count._all]),
  );

  let millisekunden = 0;
  for (const session of beendet) {
    if (session.beendetAm) {
      millisekunden += Math.max(session.beendetAm.getTime() - session.gestartetAm.getTime(), 0);
    }
  }

  return {
    registriert: [...zaehler.values()].reduce((summe, wert) => summe + wert, 0),
    offeneBewerbungen: zaehler.get('PENDING') ?? 0,
    freigegeben: zaehler.get('APPROVED') ?? 0,
    pausiert: zaehler.get('SUSPENDED') ?? 0,
    jetztLive,
    erkannteStreams: erkannt,
    gesendeteAnkuendigungen: ankuendigungen,
    spotlights,
    beobachteteStunden: Math.round(millisekunden / 3_600_000),
    beobachtetSeit: aelteste?.gestartetAm ?? null,
  };
}

/**
 * Ist das Modul betriebsbereit - und wenn nicht, was fehlt?
 *
 * Die Antwort steht im Dashboard, und zwar als Liste dessen, was zu tun ist.
 * Ein Modul, das nichts tut und nicht sagt warum, ist die schlechtere Variante
 * von einem, das gar nicht da ist.
 */
export interface Betriebsbereitschaft {
  twitch: { aktiv: boolean; zugangsdaten: boolean };
  youtube: {
    aktiv: boolean;
    zugangsdaten: boolean;
    kontingentVerbraucht: number;
    kontingentGrenze: number;
    genau: boolean;
  };
  ankuendigungen: { aktiv: boolean; kanal: boolean };
  oeffentlich: boolean;
  /** Was fehlt - in der Reihenfolge, in der man es erledigt. */
  offenePunkte: string[];
}

export async function ladeBereitschaft(): Promise<Betriebsbereitschaft> {
  const settings = await getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID);
  const [twitchDa, youtubeDa, kontingent] = await Promise.all([
    hasSecret(TWITCH_INTEGRATION_ID, 'clientSecret').catch(() => false),
    hasSecret(YOUTUBE_INTEGRATION_ID, 'apiKey').catch(() => false),
    leseKontingent(),
  ]);

  const offenePunkte: string[] = [];
  if (!twitchDa && !youtubeDa) {
    offenePunkte.push(
      'Keine Plattform-Zugangsdaten hinterlegt - ohne sie gibt es keine Live-Erkennung. System → Integrationen → Twitch bzw. YouTube.',
    );
  }
  if (twitchDa && !settings.twitchAktiv) {
    offenePunkte.push('Twitch-Zugangsdaten sind da, die Abfrage ist aber ausgeschaltet.');
  }
  if (settings.twitchAktiv && !twitchDa) {
    offenePunkte.push('Twitch-Abfrage ist an, es fehlen aber Client ID und Client Secret.');
  }
  if (settings.youtubeAktiv && !youtubeDa) {
    offenePunkte.push('YouTube-Abfrage ist an, es fehlt aber der API Key.');
  }
  if (settings.ankuendigungAktiv && settings.ankuendigungChannelId === '') {
    offenePunkte.push('Live-Ankündigungen sind an, es ist aber kein Kanal gewählt.');
  }
  if (!settings.ankuendigungAktiv) {
    offenePunkte.push('Live-Ankündigungen sind ausgeschaltet.');
  }
  if (settings.youtubeAktiv && settings.youtubeGenau) {
    offenePunkte.push(
      `Die genaue YouTube-Erkennung kostet 100 Einheiten je Kanal und Durchgang. Bei ${settings.youtubeIntervallMinuten} Minuten sind das ${Math.round((1440 / settings.youtubeIntervallMinuten) * 100)} Einheiten pro Kanal und Tag.`,
    );
  }

  return {
    twitch: { aktiv: settings.twitchAktiv, zugangsdaten: twitchDa },
    youtube: {
      aktiv: settings.youtubeAktiv,
      zugangsdaten: youtubeDa,
      kontingentVerbraucht: kontingent.einheiten,
      kontingentGrenze: settings.youtubeKontingent,
      genau: settings.youtubeGenau,
    },
    ankuendigungen: {
      aktiv: settings.ankuendigungAktiv,
      kanal: settings.ankuendigungChannelId !== '',
    },
    oeffentlich: settings.oeffentlichAktiv,
    offenePunkte,
  };
}

export type StreamerZeile = StreamerProfil & {
  kanaele: StreamerKanal[];
  /** Name und Bild aus dem Mitgliedsprofil - nicht kopiert, gelesen. */
  anzeigename: string;
  avatarHash: string | null;
  slug: string | null;
  /** `null` = offline. */
  liveSeit: Date | null;
};

/**
 * Die Verwaltungsliste.
 *
 * Dieselbe Funktion fuer «Bewerbungen» und «Streamer» - der Unterschied ist ein
 * Statusfilter. Zwei Funktionen waeren zwei Stellen, an denen der Name aus dem
 * Mitgliedsprofil geholt wird, und die zweite bekaeme irgendwann eine eigene
 * Fassung davon.
 */
export async function ladeStreamerListe(optionen: {
  status?: StreamerStatus[];
  suche?: string;
}): Promise<StreamerZeile[]> {
  const profile = await prisma.streamerProfil.findMany({
    where: { ...(optionen.status ? { status: { in: optionen.status } } : {}) },
    include: { kanaele: { orderBy: { plattform: 'asc' } } },
    orderBy: [{ eingereichtAm: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });
  if (profile.length === 0) {
    return [];
  }

  const discordIds = profile.map((profil) => profil.discordId);
  const [mitglieder, mitgliedsprofile, laufende] = await Promise.all([
    prisma.discordMemberCache.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true, displayName: true, username: true, avatarHash: true },
    }),
    prisma.memberProfile.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true, displayName: true, publicSlug: true },
    }),
    prisma.streamerSession.findMany({
      where: { beendetAm: null, kanal: { profilId: { in: profile.map((profil) => profil.id) } } },
      select: { gestartetAm: true, kanal: { select: { profilId: true } } },
    }),
  ]);

  const nachId = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag]));
  const profilNachId = new Map(mitgliedsprofile.map((eintrag) => [eintrag.discordId, eintrag]));
  const liveNachProfil = new Map(laufende.map((eintrag) => [eintrag.kanal.profilId, eintrag.gestartetAm]));

  const zeilen = profile.map((profil) => {
    const mitglied = nachId.get(profil.discordId);
    const mitgliedsprofil = profilNachId.get(profil.discordId);
    return {
      ...profil,
      anzeigename:
        mitgliedsprofil?.displayName?.trim() ||
        mitglied?.displayName?.trim() ||
        mitglied?.username?.trim() ||
        profil.discordId,
      avatarHash: mitglied?.avatarHash ?? null,
      slug: mitgliedsprofil?.publicSlug ?? null,
      liveSeit: liveNachProfil.get(profil.id) ?? null,
    };
  });

  const suche = (optionen.suche ?? '').trim().toLowerCase();
  if (suche === '') {
    return zeilen;
  }
  /*
   * Gesucht wird im Anzeigenamen und in den Kanalnamen - nicht in der
   * Discord-Kennung. Eine Suche nach Kennungen waere ein Werkzeug, um
   * herauszufinden, ob eine bestimmte Person Streamer ist.
   */
  return zeilen.filter((zeile) =>
    [zeile.anzeigename, ...zeile.kanaele.map((kanal) => kanal.handle)]
      .join(' ')
      .toLowerCase()
      .includes(suche),
  );
}

/** Die letzten Ankuendigungen - fuer die Seite «Live-Ankündigungen». */
export async function ladeAnkuendigungen(grenze = 50): Promise<
  Array<{
    id: string;
    gesendetAm: Date | null;
    fehler: string | null;
    versuche: number;
    plattform: string;
    handle: string;
    titel: string | null;
    gestartetAm: Date;
    anzeigename: string;
  }>
> {
  const zeilen = await prisma.streamerAnkuendigung.findMany({
    take: grenze,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      gesendetAm: true,
      fehler: true,
      versuche: true,
      session: {
        select: {
          titel: true,
          gestartetAm: true,
          kanal: { select: { plattform: true, handle: true, profil: { select: { discordId: true } } } },
        },
      },
    },
  });

  const discordIds = [...new Set(zeilen.map((zeile) => zeile.session.kanal.profil.discordId))];
  const mitglieder = await prisma.discordMemberCache.findMany({
    where: { discordId: { in: discordIds } },
    select: { discordId: true, displayName: true, username: true },
  });
  const nachId = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag]));

  return zeilen.map((zeile) => {
    const mitglied = nachId.get(zeile.session.kanal.profil.discordId);
    return {
      id: zeile.id,
      gesendetAm: zeile.gesendetAm,
      fehler: zeile.fehler,
      versuche: zeile.versuche,
      plattform: zeile.session.kanal.plattform,
      handle: zeile.session.kanal.handle,
      titel: zeile.session.titel,
      gestartetAm: zeile.session.gestartetAm,
      anzeigename: mitglied?.displayName?.trim() || mitglied?.username?.trim() || 'Unbekannt',
    };
  });
}

/**
 * Die Einstellungen des Moduls - einmal benannt.
 *
 * Die Seiten brauchen sie oft (ist die oeffentliche Seite an? welcher Kanal?),
 * und `getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID)` an jeder Stelle
 * hinzuschreiben ist dreimal dieselbe Zeile mit einem Typparameter, den man
 * vergessen kann.
 */
export async function leseStreamerEinstellungen(): Promise<StreamerSettings> {
  return getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID);
}
