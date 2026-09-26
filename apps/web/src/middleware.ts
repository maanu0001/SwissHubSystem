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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
