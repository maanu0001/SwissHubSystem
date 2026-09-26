/**
 * Die Plattformen, und wie man einen Kanal darauf benennt.
 *
 * ## Warum diese Datei nichts kann
 *
 * Kein Prisma, kein `fetch`, kein `server-only`, keine Umgebung. Reine
 * Zeichenkettenarbeit und ein paar Zod-Schemas. Damit ist sie im Browser
 * benutzbar - das Bewerbungsformular prueft eine Kanaladresse waehrend des
 * Tippens nach **derselben** Regel, nach der der Server sie danach annimmt.
 *
 * Zwei Regeln waeren der Fehler: das Formular liesse etwas durch, das der
 * Server ablehnt, oder umgekehrt - und beide Male saehe es nach einem Bug im
 * Formular aus.
 *
 * ## Warum die Kennung zaehlt und nicht der Name
 *
 * `twitch.tv/nick` ist ein Name. Namen sind aenderbar, und Twitch gibt einen
 * freigewordenen Namen wieder aus. Ein Eintrag, der auf den Namen abstellt,
 * folgt nach einer Umbenennung dem naechsten Inhaber - und kuendigt dessen
 * Streams als die eines SwissHub-Mitglieds an.
 *
 * Gespeichert wird deshalb die unveraenderliche Kennung der Plattform: bei
 * Twitch die numerische `user_id`, bei YouTube die `UC...`-Kanal-ID. Was
 * jemand eintippt, ist nur der Weg dorthin.
 */
import { z } from 'zod';
import { SPRACHEN } from '../profile/angaben';

export const STREAMER_PLATTFORMEN = ['TWITCH', 'YOUTUBE'] as const;
export type StreamerPlattformId = (typeof STREAMER_PLATTFORMEN)[number];

export interface PlattformAngaben {
  id: StreamerPlattformId;
  label: string;
  /** Was im Formular als Beispiel steht. */
  beispiel: string;
  /** Wie eine Kanaladresse aus einem Handle entsteht. */
  adresse: (handle: string) => string;
  /**
   * Laesst sich die Inhaberschaft dieser Plattform automatisch beweisen?
   *
   * Twitch: ja - OAuth gibt uns das Konto zurueck, mit dem sich jemand
   * angemeldet hat. YouTube: nicht mit den Mitteln dieser Fassung; dort
   * entscheidet ein Mensch, und die Oberflaeche sagt das.
   */
  oauthMoeglich: boolean;
}

export const PLATTFORMEN: Record<StreamerPlattformId, PlattformAngaben> = {
  TWITCH: {
    id: 'TWITCH',
    label: 'Twitch',
    beispiel: 'twitch.tv/deinname',
    adresse: (handle) => `https://twitch.tv/${handle}`,
    oauthMoeglich: true,
  },
  YOUTUBE: {
    id: 'YOUTUBE',
    label: 'YouTube',
    beispiel: 'youtube.com/@deinkanal',
    adresse: (handle) =>
      handle.startsWith('UC')
        ? `https://youtube.com/channel/${handle}`
        : `https://youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`,
    oauthMoeglich: false,
  },
};

export function plattform(id: string): PlattformAngaben {
  const angaben = PLATTFORMEN[id as StreamerPlattformId];
  if (!angaben) {
    throw new Error(`Unbekannte Plattform: ${id}`);
  }
  return angaben;
}

/** Ein Twitch-Login: Buchstaben, Ziffern, Unterstrich. */
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{3,25}$/u;
/** Eine YouTube-Kanal-ID: immer `UC` und 22 weitere Zeichen. */
export const YOUTUBE_KANAL_ID = /^UC[A-Za-z0-9_-]{22}$/u;
/** Ein YouTube-Handle, ohne das `@`. */
const YOUTUBE_HANDLE = /^[A-Za-z0-9._-]{3,30}$/u;

export interface ErkannterKanal {
  plattform: StreamerPlattformId;
  /**
   * Womit bei der Plattform nachgefragt wird.
   *
   * `login` bei Twitch, `kanalId` oder `handle` bei YouTube. Die endgueltige
   * `externeId` steht erst fest, wenn die Plattform geantwortet hat - hier
   * entsteht nur eine wohlgeformte Frage.
   */
  art: 'twitchLogin' | 'youtubeKanalId' | 'youtubeHandle';
  wert: string;
}

export class KanalEingabeFehler extends Error {}

const fehler = (text: string): never => {
  throw new KanalEingabeFehler(text);
};

/**
 * Aus einer Eingabe eine wohlgeformte Frage an die Plattform machen.
 *
 * Angenommen wird, was Leute tatsaechlich hineinkopieren: die vollstaendige
 * Adresse, die Adresse ohne Schema, oder nur der Name. Alles drei ist
 * derselbe Kanal, und eine Oberflaeche, die nur eine Form akzeptiert,
 * schickt die Haelfte der Bewerber wieder weg.
 */
export function erkenneKanal(plattformId: StreamerPlattformId, eingabe: string): ErkannterKanal {
  const roh = eingabe.trim();
  if (roh === '') {
    fehler('Gib einen Kanal an.');
  }

  // Der Pfadanteil, falls eine Adresse eingegeben wurde. Ohne Schema ergaenzen,
  // damit `URL` auch `twitch.tv/name` annimmt.
  let pfad = roh;
  if (/^(https?:\/\/)?([a-z0-9-]+\.)*(twitch\.tv|youtube\.com|youtu\.be)\//iu.test(roh)) {
    try {
      const adresse = new URL(roh.startsWith('http') ? roh : `https://${roh}`);
      pfad = `${adresse.pathname}`.replace(/^\/+|\/+$/gu, '');
      /*
       * Der Rest der Adresse wird verworfen - Abfrageparameter und Fragment
       * gehoeren nicht zu einem Kanal. `twitch.tv/name?tt_medium=...` ist
       * derselbe Kanal wie `twitch.tv/name`.
       */
    } catch {
      fehler('Diese Adresse lässt sich nicht lesen.');
    }
  }

  if (plattformId === 'TWITCH') {
    // `twitch.tv/name` oder `name`. Weitere Pfadteile gehoeren nicht zu einem
    // Kanal - `twitch.tv/name/videos` ist eine Unterseite.
    const login = pfad.split('/')[0] ?? '';
    if (!TWITCH_LOGIN.test(login)) {
      fehler('Das sieht nicht wie ein Twitch-Kanal aus. Beispiel: twitch.tv/deinname');
    }
    // Twitch-Logins sind kleingeschrieben; die API antwortet sonst leer.
    return { plattform: 'TWITCH', art: 'twitchLogin', wert: login.toLowerCase() };
  }

  // YouTube kennt drei Formen, und alle drei kommen vor.
  const teile = pfad.split('/').filter((teil) => teil !== '');
  if (teile[0] === 'channel' && teile[1] && YOUTUBE_KANAL_ID.test(teile[1])) {
    return { plattform: 'YOUTUBE', art: 'youtubeKanalId', wert: teile[1] };
  }
  const erster = teile[0] ?? '';
  if (YOUTUBE_KANAL_ID.test(erster)) {
    return { plattform: 'YOUTUBE', art: 'youtubeKanalId', wert: erster };
  }
  const handle = (erster.startsWith('@') ? erster.slice(1) : erster).trim();
  if (teile[0] === 'c' || teile[0] === 'user') {
    /*
     * Die alten Formen `/c/<name>` und `/user/<name>`. Sie lassen sich nicht
     * zuverlaessig in eine Kanal-ID aufloesen - die Handle-Suche der API kennt
     * sie nicht. Besser eine klare Ansage als ein Kanal, der spaeter leer
     * bleibt.
     */
    fehler(
      'Diese alte YouTube-Adresse lässt sich nicht eindeutig zuordnen. Nimm das @handle oder die Kanal-ID (beginnt mit UC) aus deinen Kanaleinstellungen.',
    );
  }
  if (!YOUTUBE_HANDLE.test(handle)) {
    fehler('Das sieht nicht wie ein YouTube-Kanal aus. Beispiel: youtube.com/@deinkanal');
  }
  return { plattform: 'YOUTUBE', art: 'youtubeHandle', wert: handle };
}

/** Die Adresse eines Kanals, wie sie oeffentlich angezeigt wird. */
export function kanalAdresse(plattformId: StreamerPlattformId, handle: string): string {
  return plattform(plattformId).adresse(handle);
}

/**
 * Die Adresse, unter der ein Stream laeuft.
 *
 * Bei Twitch ist das der Kanal - dort laeuft immer nur ein Stream. Bei YouTube
 * ist es das Video, denn ein Kanal kann daneben anderes zeigen.
 */
export function streamAdresse(
  plattformId: StreamerPlattformId,
  handle: string,
  sessionId: string | null,
): string {
  if (plattformId === 'YOUTUBE' && sessionId) {
    return `https://www.youtube.com/watch?v=${sessionId}`;
  }
  return kanalAdresse(plattformId, handle);
}

/**
 * Die Einbettungsadresse - oder `null`.
 *
 * `null` heisst: es gibt keinen zulaessigen Weg, das hier einzubetten, und die
 * Seite zeigt stattdessen das Vorschaubild mit einem Link. Das ist der
 * wichtigere der beiden Zweige: ein `<iframe>` auf eine Adresse, die die
 * Plattform nicht dafuer vorsieht, ist fremder Code auf unserer Seite.
 *
 * Twitch verlangt den `parent`-Parameter mit dem eigenen Hostnamen - ohne ihn
 * verweigert der Player. Deshalb steht er hier und wird nicht geraten.
 */
export function embedAdresse(
  plattformId: StreamerPlattformId,
  handle: string,
  sessionId: string | null,
  elternHost: string,
): string | null {
  if (plattformId === 'TWITCH') {
    const host = elternHost.trim().toLowerCase();
    if (host === '') {
      return null;
    }
    return `https://player.twitch.tv/?channel=${encodeURIComponent(handle)}&parent=${encodeURIComponent(host)}&autoplay=false`;
  }
  if (plattformId === 'YOUTUBE' && sessionId) {
    // `youtube-nocookie.com`: derselbe Player, ohne Zaehlung fuer Besucher,
    // die hier nichts angeklickt haben.
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(sessionId)}`;
  }
  return null;
}

/**
 * Die Vorschaubildadresse von Twitch mit eingesetzten Massen.
 *
 * Twitch liefert `thumbnail_url` mit den Platzhaltern `{width}` und
 * `{height}`. Wer sie stehenlaesst, bekommt ein 404 - und eine Uebersicht
 * voller grauer Kaesten.
 */
export function vorschaubild(url: string | null, breite = 640, hoehe = 360): string | null {
  if (!url) {
    return null;
  }
  return url.replace('{width}', String(breite)).replace('{height}', String(hoehe));
}

/** Die Sprachen der Bewerbung - dieselbe Liste wie im Mitgliedsprofil. */
export const STREAMER_SPRACHEN = SPRACHEN;

const spracheSchluessel = SPRACHEN.map((eintrag) => eintrag.key);

export const bewerbungSchema = z.object({
  beschreibung: z.string().trim().max(600).default(''),
  /**
   * Mindestens eine Sprache.
   *
   * Nicht aus Ordnungsliebe: die oeffentliche Uebersicht filtert danach, und
   * ein Streamer ohne Sprache waere in jedem Sprachfilter unsichtbar.
   */
  sprachen: z
    .array(z.string())
    .min(1, 'Wähle mindestens eine Sprache.')
    .max(5)
    .refine((werte) => werte.every((wert) => spracheSchluessel.includes(wert)), 'Unbekannte Sprache.'),
  /** Schluessel aus dem zentralen Spielkatalog - hier nur als Kennungen. */
  spiele: z.array(z.string().cuid()).max(6).default([]),
  twitch: z.string().trim().max(200).default(''),
  youtube: z.string().trim().max(200).default(''),
  ankuendigungAktiv: z.boolean().default(true),
});

export type BewerbungEingabe = z.infer<typeof bewerbungSchema>;

/**
 * Mindestens ein Kanal.
 *
 * Steht nicht im Schema oben, weil es eine Aussage ueber zwei Felder
 * gleichzeitig ist und `superRefine` die Fehlermeldung an keinem von beiden
 * sinnvoll platzieren kann. Der Aufrufer prueft es und sagt es dort, wo es
 * hingehoert.
 */
export function hatKanal(eingabe: Pick<BewerbungEingabe, 'twitch' | 'youtube'>): boolean {
  return eingabe.twitch.trim() !== '' || eingabe.youtube.trim() !== '';
}
