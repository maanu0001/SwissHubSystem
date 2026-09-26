import { TWITCH_INTEGRATION_ID, getSecret } from '@swisshub/secrets';
import { createLogger } from '@swisshub/logger';

/**
 * Twitch - die offizielle Helix-API.
 *
 * ## Zwei Aufgaben, eine Anwendung
 *
 * 1. **Live-Status.** Mit einem App Access Token (`client_credentials`) wird
 *    `/helix/streams` abgefragt - gebuendelt, bis zu 100 Kanaele je Anfrage.
 * 2. **Inhaberschaft.** Mit dem OAuth-Code-Flow meldet sich ein Mitglied bei
 *    Twitch an; Twitch sagt uns danach, wem das Konto gehoert. Das ist der
 *    Unterschied zwischen «hat einen Kanal eingetippt» und «dieser Kanal
 *    gehoert ihm».
 *
 * ## Warum kein Benutzertoken gespeichert wird
 *
 * Weil wir keines brauchen. Fuer den Nachweis genuegt **ein** Aufruf von
 * `/helix/users` mit dem frischen Token: die Antwort ist das Konto des
 * Token-Inhabers. Danach wird das Token bei Twitch widerrufen und
 * weggeworfen.
 *
 * Ein gespeichertes Benutzertoken waere ein Zugang zum Twitch-Konto eines
 * Mitglieds, der in unserer Datenbank liegt - und den irgendwann jemand
 * widerrufen, erneuern und schuetzen muesste. Was es nicht gibt, kann nicht
 * auslaufen und nicht abfliessen.
 *
 * ## Warum nichts wirft
 *
 * Jede Funktion gibt ein Ergebnis zurueck, kein Wurf. Diese Datei wird vom
 * Bot-Job aufgerufen, und ein unbehandelter Fehler von Twitch darf den Bot
 * nicht mitnehmen. «Twitch antwortet nicht» ist ein Zustand, den der Aufrufer
 * kennen muss - keine Ausnahme.
 *
 * ## Warum der Abruf einsetzbar ist
 *
 * `Abruf` ist ein Parameter mit `globalThis.fetch` als Vorgabe. Damit laufen
 * die Tests gegen echte Codepfade, ohne Twitch anzufragen - und ohne dass ein
 * Testschalter in den Produktionscode wandert. Was hier laeuft, ist derselbe
 * Code, der auf dem Server laeuft; nur die Gegenstelle ist eine andere.
 */

const log = createLogger('streamer:twitch');

/** Wie bei Twitch nachgefragt wird. In Tests durch eine Attrappe ersetzt. */
export type Abruf = (url: string, init?: RequestInit) => Promise<Response>;

const HELIX = 'https://api.twitch.tv/helix';
const ID = 'https://id.twitch.tv/oauth2';

/** Eine Anfrage an Twitch darf nicht ewig haengen - der Job hat ein Intervall. */
const ZEITLIMIT_MS = 10_000;

/** Twitch nimmt hoechstens 100 Kennungen je Anfrage. */
export const BUENDEL_GROESSE = 100;

export type Ergebnis<T> =
  | { art: 'ok'; wert: T }
  | {
      art: 'fehler';
      grund: string;
      /** Der HTTP-Status, wenn es einen gab. */
      status?: number;
      /**
       * Lohnt ein erneuter Versuch?
       *
       * `true` bei 429, 5xx und Netzfehlern - dort ist die Ursache
       * voruebergehend. `false` bei 400 und 401: dieselbe Anfrage wird auch
       * beim zehnten Mal abgelehnt, und ein Retry verdeckt nur, dass die
       * Zugangsdaten falsch sind.
       */
      wiederholbar: boolean;
    };

export interface TwitchKanal {
  /** Die unveraenderliche Kennung - das, was gespeichert wird. */
  id: string;
  login: string;
  anzeigename: string;
  profilbildUrl: string | null;
  beschreibung: string | null;
}

export interface TwitchStream {
  /** `stream.id` - der Anker der Idempotenz einer Ankuendigung. */
  sessionId: string;
  benutzerId: string;
  login: string;
  anzeigename: string;
  titel: string | null;
  spiel: string | null;
  /** Mit `{width}`/`{height}` - einsetzen mit `vorschaubild()`. */
  vorschaubildUrl: string | null;
  zuschauer: number | null;
  sprache: string | null;
  gestartetAm: Date;
}

// --- Zugangsdaten ------------------------------------------------------------

export interface TwitchZugang {
  clientId: string;
  clientSecret: string;
}

/**
 * Die Zugangsdaten aus der zentralen Integrationsverwaltung.
 *
 * Nicht aus der Umgebung und nicht aus einer Konstante: sie stehen
 * verschluesselt in `IntegrationSecret`, wie jedes andere Geheimnis, und sind
 * unter System → Integrationen → Twitch aenderbar, ohne dass jemand die
 * Anwendung neu startet.
 */
export async function twitchZugang(): Promise<TwitchZugang | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSecret(TWITCH_INTEGRATION_ID, 'clientId').catch(() => null),
    getSecret(TWITCH_INTEGRATION_ID, 'clientSecret').catch(() => null),
  ]);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

// --- App Access Token --------------------------------------------------------

interface TokenStand {
  token: string;
  /** Wann es ungueltig wird - mit Sicherheitsabstand. */
  gueltigBis: number;
  /** An welche Zugangsdaten es gebunden ist. */
  kennung: string;
}

let tokenStand: TokenStand | null = null;

/** Nach einer Aenderung der Zugangsdaten - und bei jedem 401. */
export function verwerfeToken(): void {
  tokenStand = null;
}

/**
 * Das App Access Token, aus dem Zwischenspeicher oder frisch geholt.
 *
 * Twitch gibt es mit einer Gueltigkeit von etwa 60 Tagen zurueck. Es bei jeder
 * Abfrage neu zu holen waere eine zweite Anfrage je Durchgang - und Twitch
 * zaehlt beim Token-Endpunkt strenger als bei Helix.
 *
 * Eine Minute Sicherheitsabstand: ein Token, das in drei Sekunden ablaeuft,
 * gilt hier schon als abgelaufen. Sonst faellt die Abfrage in genau dem
 * Durchgang aus, in dem der Ablauf liegt.
 */
async function appToken(zugang: TwitchZugang, abruf: Abruf): Promise<Ergebnis<string>> {
  const kennung = `${zugang.clientId}:${zugang.clientSecret.length}:${zugang.clientSecret.slice(-4)}`;
  if (tokenStand && tokenStand.kennung === kennung && tokenStand.gueltigBis > Date.now()) {
    return { art: 'ok', wert: tokenStand.token };
  }

  const koerper = new URLSearchParams({
    client_id: zugang.clientId,
    client_secret: zugang.clientSecret,
    grant_type: 'client_credentials',
  });

  const antwort = await sicher(
    () =>
      abruf(`${ID}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: koerper.toString(),
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      }),
    'Token',
  );
  if (antwort.art === 'fehler') {
    return antwort;
  }

  const daten = antwort.wert as { access_token?: unknown; expires_in?: unknown };
  if (typeof daten.access_token !== 'string' || daten.access_token === '') {
    return { art: 'fehler', grund: 'Twitch hat kein Token geliefert.', wiederholbar: false };
  }
  const sekunden = typeof daten.expires_in === 'number' && daten.expires_in > 60 ? daten.expires_in : 3600;
  tokenStand = {
    token: daten.access_token,
    gueltigBis: Date.now() + (sekunden - 60) * 1000,
    kennung,
  };
  return { art: 'ok', wert: tokenStand.token };
}

/**
 * Einen Aufruf in ein Ergebnis verwandeln.
 *
 * Die eine Stelle, an der aus einem Wurf ein Zustand wird. Unterschieden wird
 * nach Wiederholbarkeit, weil der Aufrufer beides verschieden behandeln muss:
 * ein 429 wartet, ein 401 braucht einen Menschen.
 */
async function sicher(aufruf: () => Promise<Response>, was: string): Promise<Ergebnis<unknown>> {
  let antwort: Response;
  try {
    antwort = await aufruf();
  } catch (fehler) {
    const grund = fehler instanceof Error ? fehler.message : String(fehler);
    // Netz weg, Zeitlimit, DNS - alles voruebergehend.
    return { art: 'fehler', grund: `${was}: ${grund}`, wiederholbar: true };
  }

  if (!antwort.ok) {
    const text = await antwort.text().catch(() => '');
    /*
     * 401: das Token ist abgelaufen oder die Zugangsdaten sind falsch. Der
     * Zwischenspeicher wird verworfen, damit der naechste Durchgang ein
     * frisches Token holt - ist es danach wieder 401, liegt es an den
     * Zugangsdaten und ein Retry hilft nicht.
     */
    if (antwort.status === 401) {
      verwerfeToken();
    }
    return {
      art: 'fehler',
      grund: `${was}: HTTP ${antwort.status}${text ? ` - ${text.slice(0, 200)}` : ''}`,
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

/** Ein Helix-Aufruf mit Token und Client ID. */
async function helix(
  pfad: string,
  zugang: TwitchZugang,
  abruf: Abruf,
  was: string,
): Promise<Ergebnis<unknown>> {
  const token = await appToken(zugang, abruf);
  if (token.art === 'fehler') {
    return token;
  }
  return sicher(
    () =>
      abruf(`${HELIX}${pfad}`, {
        headers: {
          authorization: `Bearer ${token.wert}`,
          'client-id': zugang.clientId,
        },
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      }),
    was,
  );
}

// --- Kanaele -----------------------------------------------------------------

function alsKanal(eintrag: Record<string, unknown>): TwitchKanal | null {
  const id = eintrag.id;
  const login = eintrag.login;
  if (typeof id !== 'string' || typeof login !== 'string') {
    return null;
  }
  return {
    id,
    login,
    anzeigename: typeof eintrag.display_name === 'string' ? eintrag.display_name : login,
    profilbildUrl: typeof eintrag.profile_image_url === 'string' ? eintrag.profile_image_url : null,
    beschreibung:
      typeof eintrag.description === 'string' && eintrag.description !== '' ? eintrag.description : null,
  };
}

/**
 * Kanaele nachschlagen - nach Login oder nach Kennung.
 *
 * Beides in einem Aufruf, weil Twitch es so anbietet: `/users` nimmt bis zu
 * 100 `login`- und `id`-Parameter gemischt.
 */
export async function holeKanaele(
  auswahl: { logins?: readonly string[]; ids?: readonly string[] },
  abruf: Abruf = globalThis.fetch,
): Promise<Ergebnis<TwitchKanal[]>> {
  const zugang = await twitchZugang();
  if (!zugang) {
    return { art: 'fehler', grund: 'Es sind keine Twitch-Zugangsdaten hinterlegt.', wiederholbar: false };
  }

  const params = new URLSearchParams();
  for (const login of (auswahl.logins ?? []).slice(0, BUENDEL_GROESSE)) {
    params.append('login', login);
  }
  for (const kennung of (auswahl.ids ?? []).slice(0, BUENDEL_GROESSE)) {
    params.append('id', kennung);
  }
  if ([...params.keys()].length === 0) {
    return { art: 'ok', wert: [] };
  }

  const antwort = await helix(`/users?${params.toString()}`, zugang, abruf, 'Kanalabfrage');
  if (antwort.art === 'fehler') {
    return antwort;
  }
  const daten = (antwort.wert as { data?: unknown }).data;
  if (!Array.isArray(daten)) {
    return { art: 'fehler', grund: 'Kanalabfrage: unerwartete Antwort.', wiederholbar: false };
  }
  return {
    art: 'ok',
    wert: daten
      .map((eintrag) => alsKanal(eintrag as Record<string, unknown>))
      .filter((kanal): kanal is TwitchKanal => kanal !== null),
  };
}

// --- Live-Status -------------------------------------------------------------

function alsStream(eintrag: Record<string, unknown>): TwitchStream | null {
  const sessionId = eintrag.id;
  const benutzerId = eintrag.user_id;
  const gestartet = eintrag.started_at;
  if (typeof sessionId !== 'string' || typeof benutzerId !== 'string' || typeof gestartet !== 'string') {
    return null;
  }
  const zeit = new Date(gestartet);
  if (Number.isNaN(zeit.getTime())) {
    return null;
  }
  const login = typeof eintrag.user_login === 'string' ? eintrag.user_login : '';
  return {
    sessionId,
    benutzerId,
    login,
    anzeigename: typeof eintrag.user_name === 'string' ? eintrag.user_name : login,
    titel: typeof eintrag.title === 'string' && eintrag.title !== '' ? eintrag.title : null,
    spiel: typeof eintrag.game_name === 'string' && eintrag.game_name !== '' ? eintrag.game_name : null,
    vorschaubildUrl: typeof eintrag.thumbnail_url === 'string' ? eintrag.thumbnail_url : null,
    /*
     * `viewer_count` kann fehlen. Dann bleibt es `null` und die Oberflaeche
     * schreibt nichts hin - eine Null waere eine Behauptung ueber die
     * Zuschauerzahl, und zwar eine falsche.
     */
    zuschauer: typeof eintrag.viewer_count === 'number' ? eintrag.viewer_count : null,
    sprache: typeof eintrag.language === 'string' && eintrag.language !== '' ? eintrag.language : null,
    gestartetAm: zeit,
  };
}

/**
 * Wer von diesen Kanaelen ist live?
 *
 * ## Warum gebuendelt
 *
 * `/helix/streams?user_id=a&user_id=b&...` nimmt 100 Kennungen und antwortet
 * **nur** mit den laufenden Streams. Eine Anfrage je Streamer waere bei
 * dreissig Streamern und drei Minuten Intervall 14 400 Anfragen am Tag statt
 * 480 - und Twitch wuerde es irgendwann bremsen.
 *
 * Wer nicht in der Antwort steht, ist offline. Das ist keine Vermutung: Twitch
 * liefert fuer jede angefragte Kennung einen Eintrag, wenn sie streamt.
 */
export async function holeStreams(
  benutzerIds: readonly string[],
  abruf: Abruf = globalThis.fetch,
): Promise<Ergebnis<Map<string, TwitchStream>>> {
  if (benutzerIds.length === 0) {
    return { art: 'ok', wert: new Map() };
  }
  const zugang = await twitchZugang();
  if (!zugang) {
    return { art: 'fehler', grund: 'Es sind keine Twitch-Zugangsdaten hinterlegt.', wiederholbar: false };
  }

  const gefunden = new Map<string, TwitchStream>();

  for (let start = 0; start < benutzerIds.length; start += BUENDEL_GROESSE) {
    const buendel = benutzerIds.slice(start, start + BUENDEL_GROESSE);
    const params = new URLSearchParams();
    for (const kennung of buendel) {
      params.append('user_id', kennung);
    }
    params.set('first', String(BUENDEL_GROESSE));

    const antwort = await helix(`/streams?${params.toString()}`, zugang, abruf, 'Live-Abfrage');
    if (antwort.art === 'fehler') {
      /*
       * Ein Fehler mitten in den Buendeln wird **nicht** verschwiegen.
       *
       * Waeren die bisher gefundenen Streams das Ergebnis, hielte der Aufrufer
       * alle Kanaele der restlichen Buendel fuer offline - und beendete ihre
       * Sessions. Beim naechsten Durchgang waeren sie wieder live, mit neuer
       * Session und neuer Ankuendigung. Lieber gar keine Auskunft als eine
       * halbe.
       */
      return antwort;
    }
    const daten = (antwort.wert as { data?: unknown }).data;
    if (!Array.isArray(daten)) {
      return { art: 'fehler', grund: 'Live-Abfrage: unerwartete Antwort.', wiederholbar: false };
    }
    for (const eintrag of daten) {
      const stream = alsStream(eintrag as Record<string, unknown>);
      if (stream) {
        gefunden.set(stream.benutzerId, stream);
      }
    }
  }

  return { art: 'ok', wert: gefunden };
}

// --- Inhaberschaft ------------------------------------------------------------

/**
 * Die Adresse, auf die ein Mitglied geschickt wird.
 *
 * Kein `scope`: `/helix/users` gibt ohne Bereich das Konto des Token-Inhabers
 * zurueck, und mehr wird nicht gebraucht. Ein Bereich, den wir nicht brauchen,
 * ist ein Recht, das wir uns geben lassen und nie nutzen - und das jemand im
 * Zustimmungsdialog liest.
 */
export function autorisierungsAdresse(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: '',
    state,
    /*
     * `force_verify`: der Zustimmungsdialog erscheint auch dann, wenn die
     * Person schon einmal zugestimmt hat. Genau das ist hier der Zweck - wer
     * bei Twitch mit einem anderen Konto angemeldet ist, soll das sehen und
     * nicht stillschweigend das falsche Konto bestaetigen.
     */
    force_verify: 'true',
  });
  return `${ID}/authorize?${params.toString()}`;
}

export interface Inhaberschaft {
  kanal: TwitchKanal;
}

/**
 * Den Code einloesen und daraus den Kanal des Anmelders ermitteln.
 *
 * Drei Schritte, und der dritte ist der, der oft fehlt:
 *
 * 1. Code gegen ein Benutzertoken tauschen.
 * 2. Mit diesem Token `/helix/users` aufrufen - die Antwort **ist** das Konto
 *    des Anmelders. Es gibt keinen Weg, hier ein fremdes Konto zu erhalten.
 * 3. Das Token bei Twitch widerrufen und wegwerfen.
 *
 * Schritt 3 ist nicht Hoeflichkeit: ohne ihn bliebe ein gueltiger Zugang zum
 * Twitch-Konto eines Mitglieds im Speicher dieses Prozesses und in den Logs
 * jeder Zwischenstation.
 */
export async function loeseCodeEin(
  code: string,
  redirectUri: string,
  abruf: Abruf = globalThis.fetch,
): Promise<Ergebnis<Inhaberschaft>> {
  const zugang = await twitchZugang();
  if (!zugang) {
    return { art: 'fehler', grund: 'Es sind keine Twitch-Zugangsdaten hinterlegt.', wiederholbar: false };
  }

  const tausch = await sicher(
    () =>
      abruf(`${ID}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: zugang.clientId,
          client_secret: zugang.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(ZEITLIMIT_MS),
      }),
    'Code einlösen',
  );
  if (tausch.art === 'fehler') {
    return tausch;
  }
  const benutzerToken = (tausch.wert as { access_token?: unknown }).access_token;
  if (typeof benutzerToken !== 'string' || benutzerToken === '') {
    return { art: 'fehler', grund: 'Twitch hat kein Benutzertoken geliefert.', wiederholbar: false };
  }

  try {
    const antwort = await sicher(
      () =>
        abruf(`${HELIX}/users`, {
          headers: {
            authorization: `Bearer ${benutzerToken}`,
            'client-id': zugang.clientId,
          },
          signal: AbortSignal.timeout(ZEITLIMIT_MS),
        }),
      'Konto abfragen',
    );
    if (antwort.art === 'fehler') {
      return antwort;
    }
    const daten = (antwort.wert as { data?: unknown }).data;
    const erster = Array.isArray(daten) ? daten[0] : null;
    const kanal = erster ? alsKanal(erster as Record<string, unknown>) : null;
    if (!kanal) {
      return { art: 'fehler', grund: 'Twitch hat kein Konto zurückgegeben.', wiederholbar: false };
    }
    return { art: 'ok', wert: { kanal } };
  } finally {
    // Auch wenn die Kontoabfrage scheitert: das Token wird nicht behalten.
    await widerrufe(benutzerToken, zugang.clientId, abruf);
  }
}

/**
 * Ein Benutzertoken bei Twitch widerrufen.
 *
 * Scheitert das, ist es ein Protokolleintrag und kein Fehler: das Token wird
 * hier ohnehin weggeworfen und laeuft von selbst ab. Den Aufrufer daran
 * scheitern zu lassen, waere eine gescheiterte Verifikation wegen eines
 * erfolgreichen Aufraeumversuchs.
 */
async function widerrufe(token: string, clientId: string, abruf: Abruf): Promise<void> {
  try {
    await abruf(`${ID}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token }).toString(),
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  } catch (fehler) {
    log.debug('Token konnte nicht widerrufen werden', { fehler });
  }
}

/**
 * Der Verbindungstest fuer System → Integrationen.
 *
 * Holt ein App Access Token und fragt damit einen bekannten Kanal ab. Ein
 * Token allein waere ein schwacher Test - es bestaetigt die Zugangsdaten, aber
 * nicht, dass Helix antwortet.
 */
export async function testeTwitch(abruf: Abruf = globalThis.fetch): Promise<{ ok: boolean; detail: string }> {
  const zugang = await twitchZugang();
  if (!zugang) {
    return { ok: false, detail: 'Client ID oder Client Secret fehlt.' };
  }
  const token = await appToken(zugang, abruf);
  if (token.art === 'fehler') {
    return { ok: false, detail: token.grund };
  }
  // `twitch` gibt es seit dem ersten Tag und wird es geben - ein stabiler
  // Prüfstein, der nichts über unsere Streamer aussagt.
  const kanal = await holeKanaele({ logins: ['twitch'] }, abruf);
  if (kanal.art === 'fehler') {
    return { ok: false, detail: kanal.grund };
  }
  return {
    ok: kanal.wert.length > 0,
    detail:
      kanal.wert.length > 0
        ? 'App Access Token gültig, Helix antwortet.'
        : 'Token gültig, aber Helix gab keine Daten zurück.',
  };
}
