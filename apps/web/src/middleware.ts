import { NextResponse, type NextRequest } from 'next/server';

/**
 * Wohin ein eingebetteter Clip zeigen darf.
 *
 * Genau die Hosts, aus denen `erkenneClip()` Einbettungsadressen baut -
 * nicht mehr.
 */
const EINBETTUNGS_HOSTS = [
  'https://clips.twitch.tv',
  'https://player.twitch.tv',
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://medal.tv',
] as const;

/**
 * Content-Security-Policy mit Request-Nonce.
 *
 * Next.js übernimmt die Nonce automatisch für eigene Skripte, sobald sie im
 * CSP-Header des Requests steht. Dadurch braucht es kein `unsafe-inline` für
 * Skripte - die wirksamste Massnahme gegen XSS.
 */
/**
 * Die einzige Seite, die in einen Rahmen darf - und nur in einen eigenen.
 *
 * Die Werkbank im Wrapped Studio stellt die Buehne in ein `iframe`, damit
 * `vw`, `dvh` und die Breakpoints darin die des gewaehlten Geraets sind.
 * Das geht nur, wenn genau diese Seite sich einbetten laesst.
 *
 * `'self'` und nicht mehr: eine fremde Seite darf sie weiterhin nicht in
 * einen Rahmen stellen. Alle uebrigen Seiten bleiben bei `'none'` - die
 * Ausnahme ist eine Zeile lang und endet hier.
 */
const RAHMENFAEHIG = /^\/wrapped-buehne(\/|$)/;

/**
 * Die oeffentliche Spielauswahl - die einzigen Seiten, die eine Gastkennung
 * brauchen, bevor sie gezeichnet werden.
 */
const SPIELWAHL = /^\/was-spielen-wir(\/|$)/;

/** Der Name des Gast-Cookies. Dasselbe wie `COOKIE.spielwahlGast`. */
const GAST_COOKIE = 'swisshub_spielwahl_gast';

/** Die Form einer Gastkennung. Dasselbe wie `spielwahl.GAST_MUSTER`. */
const GAST_MUSTER = /^gast:[0-9a-f]{32}$/u;

/** Sieben Tage, wie `GAST_COOKIE_TAGE` in `server/gast.ts`. */
const GAST_COOKIE_SEKUNDEN = 7 * 24 * 60 * 60;

/**
 * Die Gastkennung muss **vor** der Seite entstehen.
 *
 * ## Das Problem, das das loest
 *
 * Das CSRF-Token einer oeffentlichen Aktion ist ein HMAC ueber die
 * Gastkennung. Die Seite leitet es ab und gibt es den Knoepfen mit; die
 * Aktion prueft es gegen die Kennung aus dem Cookie.
 *
 * Eine Server Component darf in Next.js keine Cookies setzen. Wer also zum
 * **ersten** Mal kam, hatte keine Kennung, die Seite schickte ein leeres
 * Token mit, und die erste Handlung - eine Runde eroeffnen, einer Runde
 * beitreten - wurde mit «CSRF-Token ungueltig» abgewiesen. Erst nach einem
 * Neuladen passte beides zusammen. Genau der Fall, den ein Statuscode nicht
 * zeigt: die Seite antwortet mit 200 und der erste Klick geht ins Leere.
 *
 * Die Middleware ist die einzige Stelle, die vor dem Rendern laeuft **und**
 * Cookies setzen darf. Sie vergibt die Kennung deshalb hier - die Seite liest
 * weiterhin nur, und die Aktion prueft weiterhin dasselbe.
 *
 * ## Was dabei nicht passiert
 *
 * Kein zweites System: dasselbe Cookie, dasselbe Muster, dieselbe Laufzeit
 * wie in `server/gast.ts`, und `sicherGastKennung()` bleibt der Weg fuer
 * jeden, der ohne diese Seiten ankommt. Dass die drei Werte uebereinstimmen,
 * prueft ein Test - die Middleware laeuft in der Edge-Laufzeit und darf die
 * Modul-Schicht mit ihrer Datenbankanbindung nicht laden, genau wie bei
 * `EINBETTUNGS_HOSTS` oben.
 *
 * Keine Anmeldung, kein Profil, keine Spur: in der Kennung stehen 16
 * Zufallsbytes und nichts sonst, sie ist `httpOnly`, und sie entsteht nur auf
 * den Seiten, auf denen man gleich mitmachen koennen soll.
 */
function neueGastkennung(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `gast:${Array.from(bytes, (wert) => wert.toString(16).padStart(2, '0')).join('')}`;
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const darfInRahmen = RAHMENFAEHIG.test(request.nextUrl.pathname);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Bilder von beliebigen https-Adressen.
    //
    // Banner werden im Dashboard als https-Adresse eingetragen (geprüft in
    // `bannerUrlSchema`) und anschliessend von Discord ausgeliefert. Ohne
    // diese Freigabe zeigte die Vorschau ein Banner, das nicht auf Discords
    // CDN liegt, schlicht nicht an - die Vorschau verschwieg damit, was nach
    // dem Senden tatsächlich erscheint. Skripte bleiben davon unberührt:
    // `script-src` ist weiterhin an die Nonce gebunden.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    /*
     * Die Player von Twitch, YouTube und Medal.
     *
     * Ohne diese Zeile griffe `default-src 'self'`, und ein eingebetteter
     * Clip zeigte einen leeren Rahmen. Freigegeben sind vier Hosts und sonst
     * keiner: ein `frame-src https:` waere die Einladung, irgendeine Adresse
     * in einen Rahmen zu stellen - und Rahmen fuellen den Bildschirm.
     *
     * Die Liste steht auch in `packages/modules/src/clips/provider.ts` als
     * `EINBETTUNGS_HOSTS`. Hier kann sie nicht von dort kommen: die
     * Middleware laeuft in der Edge-Laufzeit und darf die Modul-Schicht mit
     * ihrer Datenbankanbindung nicht laden. Dass beide Listen
     * uebereinstimmen, prueft ein Test.
     */
    `frame-src 'self' ${EINBETTUNGS_HOSTS.join(' ')}`,
    /*
     * Videos: nur eigene Dateien und `blob:`.
     *
     * `'self'` fuer die hochgeladenen Clips, die `/api/clips/datei/<name>`
     * ausliefert. `blob:` fuer die Vorschau im Einreich-Assistenten: der
     * Browser spielt die gewaehlte Datei dort lokal ueber
     * `URL.createObjectURL`, damit man vor dem Upload sieht, ob der Clip
     * laeuft. Ohne diese Zeile griffe `default-src 'self'`, die Vorschau
     * bliebe schwarz - und niemand koennte erraten, warum.
     *
     * Kein `https:`: ein Video von einer fremden Adresse gibt es hier nicht.
     * Die Player der Anbieter laufen im Rahmen und haengen an `frame-src`.
     */
    "media-src 'self' blob:",
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    "form-action 'self'",
    `frame-ancestors ${darfInRahmen ? "'self'" : "'none'"}`,
    "base-uri 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  /*
   * Die Kennung noch in **diese** Anfrage hinein.
   *
   * Die Reihenfolge ist der ganze Trick: `request.cookies.set` schreibt in
   * den `cookie`-Kopf der Anfrage, und `new Headers(request.headers)` nimmt
   * ihn danach mitsamt der neuen Kennung auf. Daraus liest `cookies()` beim
   * Rendern - und nur so traegt schon der erste Seitenaufruf ein Token, das
   * zur Kennung passt. Umgekehrt herum waere die Kennung erst beim zweiten
   * Aufruf da, und genau das war der Fehler.
   */
  const vorhandeneKennung = request.cookies.get(GAST_COOKIE)?.value;
  const neueKennung =
    SPIELWAHL.test(request.nextUrl.pathname) && !(vorhandeneKennung && GAST_MUSTER.test(vorhandeneKennung))
      ? neueGastkennung()
      : null;
  if (neueKennung) {
    request.cookies.set(GAST_COOKIE, neueKennung);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (neueKennung) {
    // Und an die Antwort, damit der Browser sie behaelt - mit denselben
    // Eigenschaften wie in `server/gast.ts`.
    response.cookies.set(GAST_COOKIE, neueKennung, {
      httpOnly: true,
      secure: !isDevelopment,
      sameSite: 'lax',
      path: '/',
      maxAge: GAST_COOKIE_SEKUNDEN,
    });
  }
  response.headers.set('content-security-policy', csp);
  /*
   * `X-Frame-Options` kennt kein Muster und steht global auf `DENY`.
   *
   * Aeltere Browser richten sich danach und ignorieren `frame-ancestors`.
   * Fuer die eine rahmenfaehige Seite wird der Kopf deshalb hier auf
   * `SAMEORIGIN` gesetzt - er ueberschreibt den aus `next.config.ts`.
   */
  if (darfInRahmen) {
    response.headers.set('x-frame-options', 'SAMEORIGIN');
  }
  return response;
}

export const config = {
  matcher: [
    // Statische Assets und Bilder brauchen keine CSP-Verarbeitung.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|branding/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
