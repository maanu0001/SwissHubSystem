import { prisma } from '@swisshub/database';
import { YOUTUBE_INTEGRATION_ID, getSecret } from '@swisshub/secrets';
import { createLogger } from '@swisshub/logger';
import { YOUTUBE_KANAL_ID } from './plattform';
import type { Abruf, Ergebnis } from './twitch';

/**
 * YouTube - die Data API v3, und ihr Kontingent.
 *
 * ## Warum diese Datei ungemuetlicher ist als die von Twitch
 *
 * Weil YouTube nicht in Anfragen rechnet, sondern in **Kontingenteinheiten**,
 * und weil der naheliegende Weg der teuerste ist. Ein Google-Projekt bekommt
 * standardmaessig 10 000 Einheiten pro Tag. Damit:
 *
 * | Weg                                          | Kosten je Kanal/Durchgang |
 * | -------------------------------------------- | ------------------------- |
 * | `search.list?eventType=live`                 | **100**                   |
 * | `playlistItems.list` + `videos.list`         | **2**                     |
 *
 * Bei einem Kanal und 15-Minuten-Intervall sind das 9 600 gegen 192 Einheiten
 * pro Tag. Der teure Weg ist also bei **einem** Streamer schon fast am
 * Tagesende - bei fuenf ist er es um 9 Uhr morgens.
 *
 * Deshalb ist der guenstige Weg die Vorgabe: ein Livestream erscheint in der
 * Uploads-Playlist des Kanals, und `videos.list` sagt fuer eine Video-ID, ob
 * sie gerade laeuft. Der teure Weg bleibt einstellbar, weil die Playlist einen
 * neu gestarteten Stream gelegentlich um eine Minute verspaetet zeigt - wer das
 * nicht will und das Kontingent hat, schaltet um. Was er dafuer bezahlt, steht
 * im Einstellungstext.
 *
 * ## Warum der Verbrauch in der Datenbank steht
 *
 * Weil ein Zaehler im Speicher bei jedem Bot-Neustart auf null stuende. Dann
 * waere das Kontingent mittags aufgebraucht, die Live-Erkennung still, und im
 * Dashboard staende nichts darueber.
 *
 * ## Was diese Datei nicht behauptet
 *
 * Sie behauptet nicht, geplante Livestreams zu erkennen, und sie nennt einen
 * beendeten Stream nicht «live». `liveBroadcastContent` unterscheidet `live`,
 * `upcoming` und `none`; live ist nur, was `live` **und** einen tatsaechlichen
 * Startzeitpunkt **und** keinen Endzeitpunkt hat. Alle drei Bedingungen, weil
 * die API nach dem Ende eines Streams eine Weile braucht, bis
 * `liveBroadcastContent` nachzieht.
 */

const log = createLogger('streamer:youtube');

const API = 'https://www.googleapis.com/youtube/v3';
const ZEITLIMIT_MS = 10_000;

/** Was ein Aufruf kostet - so rechnet Google ab. */
export const KOSTEN = {
  channelsList: 1,
  playlistItemsList: 1,
  videosList: 1,
  searchList: 100,
} as const;

/** YouTube nimmt hoechstens 50 Video-Kennungen je `videos.list`. */
const VIDEO_BUENDEL = 50;

export interface YouTubeKanal {
  /** Die `UC...`-Kennung - das, was gespeichert wird. */
  id: string;
  /** Der Handle ohne `@`, wenn die API einen kennt. */
  handle: string | null;
  titel: string;
  profilbildUrl: string | null;
  beschreibung: string | null;
  /**
   * Die Uploads-Playlist des Kanals.
   *
   * Der guenstige Weg zur Live-Erkennung laeuft darueber. Sie ist die
   * `UC`-Kennung mit `UU` am Anfang, aber die API sagt es selbst - und darauf
   * wird gehoert, statt es zu raten.
   */
  uploadsPlaylistId: string | null;
}

export interface YouTubeLive {
  /** Die Video-ID - der Anker der Idempotenz einer Ankuendigung. */
  videoId: string;
  kanalId: string;
  titel: string | null;
  vorschaubildUrl: string | null;
  /** Nur wenn die API sie liefert - sie tut es nicht immer. */
  zuschauer: number | null;
  gestartetAm: Date;
}

// --- Zugang ------------------------------------------------------------------

export async function youtubeSchluessel(): Promise<string | null> {
  return getSecret(YOUTUBE_INTEGRATION_ID, 'apiKey').catch(() => null);
}

// --- Kontingent ---------------------------------------------------------------

/**
 * Der Tag, auf den gerechnet wird - UTC.
 *
 * Google setzt das Kontingent um Mitternacht Pacific Time zurueck. UTC ist die
 * vorsichtigere Annahme: der Tag wechselt hier frueher als dort, also wird
 * nie mehr verbraucht, als Google zaehlt - hoechstens weniger.
 */
export function heute(jetzt: Date = new Date()): string {
  return jetzt.toISOString().slice(0, 10);
}

export interface Kontingentstand {
  tag: string;
  einheiten: number;
  abfragen: number;
}

export async function leseKontingent(jetzt: Date = new Date()): Promise<Kontingentstand> {
  const tag = heute(jetzt);
  const zeile = await prisma.streamerApiVerbrauch.findUnique({
    where: { plattform_tag: { plattform: 'YOUTUBE', tag } },
  });
  return { tag, einheiten: zeile?.einheiten ?? 0, abfragen: zeile?.abfragen ?? 0 };
}

/**
 * Verbrauch buchen.
 *
 * Gebucht wird **vor** dem Aufruf, nicht danach. Eine Anfrage, die
 * fehlschlaegt, kostet bei Google trotzdem - und ein Zaehler, der nur
 * Erfolge zaehlt, laeuft dem echten Verbrauch nach und fuehrt in eine Sperre,
 * die niemand erwartet.
 */
export async function bucheVerbrauch(einheiten: number, jetzt: Date = new Date()): Promise<void> {
  const tag = heute(jetzt);
  await prisma.streamerApiVerbrauch.upsert({
    where: { plattform_tag: { plattform: 'YOUTUBE', tag } },
    create: { plattform: 'YOUTUBE', tag, einheiten, abfragen: 1 },
    update: { einheiten: { increment: einheiten }, abfragen: { increment: 1 } },
  });
}

// --- Aufrufe -----------------------------------------------------------------

async function ruf(
  pfad: string,
  params: URLSearchParams,
  kosten: number,
  abruf: Abruf,
  was: string,
): Promise<Ergebnis<unknown>> {
  const schluessel = await youtubeSchluessel();
  if (!schluessel) {
    return { art: 'fehler', grund: 'Es ist kein YouTube API Key hinterlegt.', wiederholbar: false };
  }
  params.set('key', schluessel);

  await bucheVerbrauch(kosten).catch((fehler) => {
    // Der Zaehler ist wichtig, aber nicht wichtiger als die Abfrage selbst.
    log.warn('Kontingentverbrauch konnte nicht gebucht werden', { fehler });
  });

  let antwort: Response;
  try {
    antwort = await abruf(`${API}${pfad}?${params.toString()}`, {
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  } catch (fehler) {
    const grund = fehler instanceof Error ? fehler.message : String(fehler);
    return { art: 'fehler', grund: `${was}: ${grund}`, wiederholbar: true };
  }

  if (!antwort.ok) {
    const text = await antwort.text().catch(() => '');
    /*
     * 403 mit `quotaExceeded` ist der Fall, um den es hier geht: er ist bis
     * Mitternacht nicht wiederholbar. Ein 403 aus einem anderen Grund -
     * gesperrter Schluessel, API nicht aktiviert - ist es auch nicht.
     */
    const kontingentErschoepft = antwort.status === 403 && /quota/iu.test(text);
    return {
      art: 'fehler',
      grund: kontingentErschoepft
        ? 'YouTube-Kontingent für heute erschöpft.'
        : `${was}: HTTP ${antwort.status}${text ? ` - ${text.slice(0, 200)}` : ''}`,
      status: antwort.status,
      wiederholbar: antwort.status === 429 || antwort.status >= 500,
    };
  }

  try {
    return { art: 'ok', wert: await antwort.json() };
  } catch {
    return { art: 'fehler', grund: `${was}: Antwort war kein JSON.`, wiederholbar: true };
  }
}

function alsKanal(eintrag: Record<string, unknown>): YouTubeKanal | null {
  const id = eintrag.id;
  if (typeof id !== 'string' || !YOUTUBE_KANAL_ID.test(id)) {
    return null;
  }
  const snippet = (eintrag.snippet ?? {}) as Record<string, unknown>;
  const details = (eintrag.contentDetails ?? {}) as Record<string, unknown>;
  const listen = (details.relatedPlaylists ?? {}) as Record<string, unknown>;
  const bilder = (snippet.thumbnails ?? {}) as Record<string, unknown>;
  const mittel = (bilder.medium ?? bilder.default ?? {}) as Record<string, unknown>;
  const handleRoh = typeof snippet.customUrl === 'string' ? snippet.customUrl : null;
  return {
    id,
    handle: handleRoh ? handleRoh.replace(/^@/u, '') : null,
    titel: typeof snippet.title === 'string' ? snippet.title : id,
    profilbildUrl: typeof mittel.url === 'string' ? mittel.url : null,
    beschreibung:
      typeof snippet.description === 'string' && snippet.description !== ''
        ? snippet.description.slice(0, 600)
        : null,
    uploadsPlaylistId: typeof listen.uploads === 'string' ? listen.uploads : null,
  };
}

/**
 * Einen Kanal nachschlagen - nach Kennung oder nach Handle.
 *
 * Beides kostet **eine** Einheit. `forHandle` gibt es seit 2023 in der API;
 * davor brauchte eine Handle-Auflösung eine Suche fuer 100 Einheiten. Wer
 * diese Funktion durch eine Suche ersetzt, verhundertfacht die Kosten der
 * Registrierung.
 */
export async function holeKanal(
  auswahl: { kanalId?: string; handle?: string },
  abruf: Abruf = globalThis.fetch,
): Promise<Ergebnis<YouTubeKanal | null>> {
  const params = new URLSearchParams({ part: 'id,snippet,contentDetails' });
  if (auswahl.kanalId) {
    params.set('id', auswahl.kanalId);
  } else if (auswahl.handle) {
    params.set('forHandle', `@${auswahl.handle.replace(/^@/u, '')}`);
  } else {
    return { art: 'ok', wert: null };
  }

  const antwort = await ruf('/channels', params, KOSTEN.channelsList, abruf, 'Kanalabfrage');
  if (antwort.art === 'fehler') {
    return antwort;
  }
  const eintraege = (antwort.wert as { items?: unknown }).items;
  const erster = Array.isArray(eintraege) ? eintraege[0] : null;
  return { art: 'ok', wert: erster ? alsKanal(erster as Record<string, unknown>) : null };
}

/** Die neuesten Videos einer Playlist - eine Einheit. */
async function holePlaylistVideos(
  playlistId: string,
  anzahl: number,
  abruf: Abruf,
): Promise<Ergebnis<string[]>> {
  const params = new URLSearchParams({
    part: 'contentDetails',
    playlistId,
    maxResults: String(Math.min(Math.max(anzahl, 1), 10)),
  });
  const antwort = await ruf('/playlistItems', params, KOSTEN.playlistItemsList, abruf, 'Playlist');
  if (antwort.art === 'fehler') {
    return antwort;
  }
  const eintraege = (antwort.wert as { items?: unknown }).items;
  if (!Array.isArray(eintraege)) {
    return { art: 'ok', wert: [] };
  }
  const ids: string[] = [];
  for (const eintrag of eintraege) {
    const details = ((eintrag as Record<string, unknown>).contentDetails ?? {}) as Record<string, unknown>;
    if (typeof details.videoId === 'string') {
      ids.push(details.videoId);
    }
  }
  return { art: 'ok', wert: ids };
}

/**
 * Welche dieser Videos laufen gerade live?
 *
 * Die eine Stelle, die «live» entscheidet - und sie verlangt drei Dinge
 * gleichzeitig:
 *
 * - `snippet.liveBroadcastContent === 'live'`
 * - `liveStreamingDetails.actualStartTime` ist gesetzt
 * - `liveStreamingDetails.actualEndTime` ist **nicht** gesetzt
 *
 * Nur das erste zu pruefen reicht nicht: nach dem Ende eines Streams zieht
 * `liveBroadcastContent` mit Verzoegerung nach, und ein beendeter Stream waere
 * minutenlang «live». Nur das zweite zu pruefen reicht auch nicht - eine
 * Aufzeichnung hat ebenfalls einen `actualStartTime`.
 */
async function holeLiveVideos(videoIds: readonly string[], abruf: Abruf): Promise<Ergebnis<YouTubeLive[]>> {
  if (videoIds.length === 0) {
    return { art: 'ok', wert: [] };
  }
  const gefunden: YouTubeLive[] = [];

  for (let start = 0; start < videoIds.length; start += VIDEO_BUENDEL) {
    const buendel = videoIds.slice(start, start + VIDEO_BUENDEL);
    const params = new URLSearchParams({
      part: 'snippet,liveStreamingDetails',
      id: buendel.join(','),
      maxResults: String(VIDEO_BUENDEL),
    });
    const antwort = await ruf('/videos', params, KOSTEN.videosList, abruf, 'Videoabfrage');
    if (antwort.art === 'fehler') {
      return antwort;
    }
    const eintraege = (antwort.wert as { items?: unknown }).items;
    if (!Array.isArray(eintraege)) {
      continue;
    }
    for (const roh of eintraege) {
      const eintrag = roh as Record<string, unknown>;
      const snippet = (eintrag.snippet ?? {}) as Record<string, unknown>;
      const live = (eintrag.liveStreamingDetails ?? {}) as Record<string, unknown>;
      if (snippet.liveBroadcastContent !== 'live') {
        continue;
      }
      if (typeof live.actualStartTime !== 'string' || typeof live.actualEndTime === 'string') {
        continue;
      }
      const gestartet = new Date(live.actualStartTime);
      if (Number.isNaN(gestartet.getTime())) {
        continue;
      }
      const videoId = eintrag.id;
      const kanalId = snippet.channelId;
      if (typeof videoId !== 'string' || typeof kanalId !== 'string') {
        continue;
      }
      const bilder = (snippet.thumbnails ?? {}) as Record<string, unknown>;
      const gross = (bilder.maxres ?? bilder.high ?? bilder.medium ?? {}) as Record<string, unknown>;
      const zuschauerRoh = live.concurrentViewers;
      gefunden.push({
        videoId,
        kanalId,
        titel: typeof snippet.title === 'string' && snippet.title !== '' ? snippet.title : null,
        vorschaubildUrl: typeof gross.url === 'string' ? gross.url : null,
        /*
         * `concurrentViewers` ist ein **String** in der Antwort, und es fehlt,
         * wenn der Kanal die Zahl verbirgt. Dann bleibt es `null` - eine Null
         * waere eine Behauptung ueber die Zuschauerzahl.
         */
        zuschauer:
          typeof zuschauerRoh === 'string' && /^\d+$/u.test(zuschauerRoh) ? Number(zuschauerRoh) : null,
        gestartetAm: gestartet,
      });
    }
  }

  return { art: 'ok', wert: gefunden };
}

/** Der teure Weg: die Suche. 100 Einheiten je Kanal. */
async function sucheLive(kanalId: string, abruf: Abruf): Promise<Ergebnis<string[]>> {
  const params = new URLSearchParams({
    part: 'id',
    channelId: kanalId,
    eventType: 'live',
    type: 'video',
    maxResults: '2',
  });
  const antwort = await ruf('/search', params, KOSTEN.searchList, abruf, 'Live-Suche');
  if (antwort.art === 'fehler') {
    return antwort;
  }
  const eintraege = (antwort.wert as { items?: unknown }).items;
  if (!Array.isArray(eintraege)) {
    return { art: 'ok', wert: [] };
  }
  const ids: string[] = [];
  for (const eintrag of eintraege) {
    const kennung = ((eintrag as Record<string, unknown>).id ?? {}) as Record<string, unknown>;
    if (typeof kennung.videoId === 'string') {
      ids.push(kennung.videoId);
    }
  }
  return { art: 'ok', wert: ids };
}

export interface LiveAbfrage {
  kanalId: string;
  uploadsPlaylistId: string | null;
}

export interface LiveErgebnis {
  /** Kanalkennung → laufender Stream. Wer fehlt, ist offline. */
  live: Map<string, YouTubeLive>;
  /**
   * Kanaele, zu denen es **keine Auskunft** gibt.
   *
   * Der Unterschied zu «offline» ist der wichtigste dieser Datei: ein Kanal,
   * dessen Abfrage gescheitert ist, behaelt seinen letzten Zustand. Wuerde er
   * als offline gelten, endete seine Session - und beim naechsten Durchgang
   * begaenne eine neue, mit einer zweiten Ankuendigung.
   */
  unbekannt: Map<string, string>;
  verbrauchteEinheiten: number;
}

/**
 * Die Live-Abfrage fuer mehrere Kanaele.
 *
 * Bricht ab, sobald das Kontingent erschoepft ist - die restlichen Kanaele
 * landen dann in `unbekannt` und behalten ihren Zustand. Das ist der Grund,
 * warum es `unbekannt` gibt: bei YouTube ist «wir wissen es heute nicht mehr»
 * ein normaler Betriebszustand und kein Fehler.
 */
export async function holeLive(
  kanaele: readonly LiveAbfrage[],
  optionen: { genau: boolean; kontingentRest: number },
  abruf: Abruf = globalThis.fetch,
): Promise<LiveErgebnis> {
  const live = new Map<string, YouTubeLive>();
  const unbekannt = new Map<string, string>();
  let verbraucht = 0;

  for (const kanal of kanaele) {
    const kosten = optionen.genau
      ? KOSTEN.searchList + KOSTEN.videosList
      : KOSTEN.playlistItemsList + KOSTEN.videosList;

    if (verbraucht + kosten > optionen.kontingentRest) {
      unbekannt.set(kanal.kanalId, 'Tageskontingent aufgebraucht.');
      continue;
    }

    let videoIds: Ergebnis<string[]>;
    if (optionen.genau) {
      videoIds = await sucheLive(kanal.kanalId, abruf);
    } else if (kanal.uploadsPlaylistId) {
      videoIds = await holePlaylistVideos(kanal.uploadsPlaylistId, 5, abruf);
    } else {
      /*
       * Ohne Uploads-Playlist gibt es den guenstigen Weg nicht. Nicht
       * stillschweigend auf die Suche ausweichen: das waere das
       * Fuenfzigfache der Kosten, die der Betreiber eingestellt hat.
       */
      unbekannt.set(kanal.kanalId, 'Keine Uploads-Playlist bekannt - Kanal neu verbinden.');
      continue;
    }
    verbraucht += optionen.genau ? KOSTEN.searchList : KOSTEN.playlistItemsList;

    if (videoIds.art === 'fehler') {
      unbekannt.set(kanal.kanalId, videoIds.grund);
      if (videoIds.grund.includes('Kontingent')) {
        // Ist es aufgebraucht, ist es fuer alle aufgebraucht.
        for (const rest of kanaele) {
          if (!live.has(rest.kanalId) && !unbekannt.has(rest.kanalId)) {
            unbekannt.set(rest.kanalId, 'Tageskontingent aufgebraucht.');
          }
        }
        break;
      }
      continue;
    }
    if (videoIds.wert.length === 0) {
      // Keine Videos heisst: nichts laeuft. Das ist eine Auskunft.
      continue;
    }

    const videos = await holeLiveVideos(videoIds.wert, abruf);
    verbraucht += KOSTEN.videosList;
    if (videos.art === 'fehler') {
      unbekannt.set(kanal.kanalId, videos.grund);
      continue;
    }
    const treffer = videos.wert.find((eintrag) => eintrag.kanalId === kanal.kanalId);
    if (treffer) {
      live.set(kanal.kanalId, treffer);
    }
  }

  return { live, unbekannt, verbrauchteEinheiten: verbraucht };
}

/**
 * Der Verbindungstest fuer System → Integrationen.
 *
 * Kostet eine Einheit und fragt einen Kanal ab, den es gibt. Ein Test, der
 * nichts abfragt, wuerde einen abgelaufenen Schluessel nicht finden.
 */
export async function testeYouTube(
  abruf: Abruf = globalThis.fetch,
): Promise<{ ok: boolean; detail: string }> {
  const schluessel = await youtubeSchluessel();
  if (!schluessel) {
    return { ok: false, detail: 'Kein API Key hinterlegt.' };
  }
  // Der YouTube-eigene Kanal - es gibt ihn seit 2005.
  const kanal = await holeKanal({ kanalId: 'UCBR8-60-B28hp2BmDPdntcQ' }, abruf);
  if (kanal.art === 'fehler') {
    return { ok: false, detail: kanal.grund };
  }
  const stand = await leseKontingent();
  return {
    ok: kanal.wert !== null,
    detail:
      kanal.wert !== null
        ? `API antwortet. Heute verbraucht: ${stand.einheiten} Einheiten in ${stand.abfragen} Abfragen.`
        : 'API antwortet, gab aber keinen Kanal zurück.',
  };
}
