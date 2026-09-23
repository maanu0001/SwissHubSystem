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
] as const;

/**
 * Content-Security-Policy mit Request-Nonce.
 *
 * Next.js übernimmt die Nonce automatisch für eigene Skripte, sobald sie im
 * CSP-Header des Requests steht. Dadurch braucht es kein `unsafe-inline` für
 * Skripte - die wirksamste Massnahme gegen XSS.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV !== 'production';

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
     * Die Player von Twitch und YouTube.
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
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
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
