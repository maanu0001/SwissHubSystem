import type { NextConfig } from 'next';

/**
 * Security Header, die für jede Antwort gelten.
 * Die Content-Security-Policy wird in `src/middleware.ts` gesetzt, weil sie
 * pro Request eine Nonce enthält.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const productionHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

/**
 * Typpruefung und Lint innerhalb von `next build` abschalten - nur im Abbild.
 *
 * ## Warum
 *
 * `next build` uebersetzt zuerst und prueft danach im **selben Prozess** die
 * Typen der ganzen Anwendung. Der Heap traegt dann beides zugleich: die
 * Artefakte der Uebersetzung und das vollstaendige Typprogramm. Auf dem
 * Server ist er auf 1536 MB begrenzt - mit gutem Grund, siehe Dockerfile -,
 * und genau daran ist der Build gescheitert: «Ineffective mark-compacts near
 * heap limit», nachdem die Uebersetzung bereits durch war.
 *
 * ## Was stattdessen geschieht
 *
 * Nichts entfaellt. Das Abbild fuehrt `npm run lint` und beide
 * `tsc --noEmit`-Projekte **vor** dem Build aus, jedes in einem eigenen
 * Prozess mit eigenem Heap. Ein Typfehler bricht den Build weiterhin ab -
 * nur eine Stufe frueher. Gemessen: `tsc` allein braucht zwischen 1200 und
 * 1536 MB, die Uebersetzung allein deutlich weniger; zusammen passen sie
 * nicht.
 *
 * Ohne diese Variable - also bei jedem `npm run build` auf einem
 * Entwicklungsrechner - bleibt alles wie bisher.
 */
const geteilteBuildPruefung = process.env.SWISSHUB_SPLIT_BUILD_CHECKS === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(geteilteBuildPruefung
    ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } }
    : {}),
  poweredByHeader: false,
  // Der Entwicklungs-Indikator liegt sonst ueber der Statusleiste der Seitenleiste.
  devIndicators: { position: 'bottom-right' },
  // Die Workspace-Pakete werden als TypeScript-Quelle eingebunden.
  transpilePackages: [
    '@swisshub/auth',
    '@swisshub/config',
    '@swisshub/database',
    '@swisshub/discord',
    '@swisshub/logger',
    '@swisshub/modules',
    '@swisshub/permissions',
    '@swisshub/secrets',
    '@swisshub/shared',
  ],
  /**
   * Pakete, die der Bundler nicht anfassen soll.
   *
   * Die beiden AI-SDKs sind gross, laufen ausschliesslich serverseitig und
   * werden auf den allermeisten Seiten nie gebraucht. Sie mitzubuendeln kostet
   * beim Bauen Zeit und Arbeitsspeicher, ohne dass die ausgelieferte Anwendung
   * davon etwas haette - auf einem knapp bemessenen Server hat genau das den
   * Build zum Stillstand gebracht. Als externe Pakete bleiben sie ein
   * gewoehnliches `require` zur Laufzeit.
   */
  /*
   * `sharp` steht aus einem anderen Grund hier als die uebrigen: es ist ein
   * **natives** Modul. Gebuendelt wuerde der Bundler versuchen, eine
   * `.node`-Datei mitzunehmen, die er nicht lesen kann. Extern bleibt es ein
   * gewoehnliches `require` zur Laufzeit - und liegt im Abbild bereits, weil
   * die `web`-Stufe dieselben `node_modules` bekommt wie die `bot`-Stufe,
   * die `sharp` fuer die Levelkarte benutzt.
   */
  serverExternalPackages: ['@prisma/client', 'openai', '@anthropic-ai/sdk', 'sharp'],
  experimental: {
    // Server Actions sind nur für die eigene Origin erlaubt (CSRF).
    serverActions: {
      bodySizeLimit: '1mb',
    },
    /**
     * Wie viel Anfragekoerper die Middleware durchlaesst.
     *
     * ## Der Fehler, den diese Zeile behebt
     *
     * Sobald eine Middleware existiert - und diese Anwendung hat eine, fuer
     * die CSP-Nonce -, klont Next den Koerper jeder Anfrage, damit die
     * Middleware ihn lesen und die Route ihn danach noch einmal bekommen
     * kann. Dieser Klon hat eine Vorgabe von **10 MB**, und oberhalb davon
     * wird er nicht abgelehnt, sondern **abgeschnitten**: die Route erhaelt
     * einen halben Multipart-Koerper, `request.formData()` wirft «Failed to
     * parse body as FormData», und daraus wird ein INTERNAL - also
     * «Aktion konnte nicht ausgefuehrt werden. Bitte versuche es spaeter
     * erneut.»
     *
     * Gemessen am gebauten Server: eine 11,4 MB grosse PNG kam mit genau
     * dieser Meldung zurueck, waehrend eine 4,1 MB grosse durchging. Die
     * Pruefung in `storeLogoUpload` sah die Datei nie - sie haette sonst
     * gesagt, wie gross sie sein darf.
     *
     * Betroffen war nicht nur der Post Creator: der Clip-Upload (bis 500 MB),
     * der Level-Import (64 MB) und der Jail-Import (32 MB) erlauben seit je
     * mehr als 10 MB und konnten es nie halten.
     *
     * ## Warum diese Zahl
     *
     * Sie muss ueber der groessten Grenze liegen, die ein Bild-Upload
     * zulaesst (`GROESSTE_BILDGRENZE`, zurzeit 50 MB - der Hintergrund eines
     * Social-Media-Posts), und unter dem, was der Reverse Proxy durchlaesst
     * (`client_max_body_size 72m` in `deploy/nginx/`). Dazwischen liegen
     * 64 MB: genug Luft fuer die Multipart-Rahmen und das CSRF-Feld, und
     * weit genug unter der Proxy-Grenze, dass nicht beide zugleich greifen.
     *
     * Die drei Routen mit den wirklich grossen Dateien gehen die Middleware
     * gar nicht erst an - sie sind in `middleware.ts` ausgenommen, damit ein
     * 100-MB-Clip nicht zusaetzlich im Speicher dupliziert wird.
     *
     * Ein Test haelt beide Seiten zusammen: jede Route, die `formData()`
     * liest, muss entweder unter dieser Zahl bleiben oder ausgenommen sein.
     */
    middlewareClientMaxBodySize: '64mb',
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.discordapp.com', pathname: '/**' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers:
          process.env.NODE_ENV === 'production'
            ? [...securityHeaders, ...productionHeaders]
            : securityHeaders,
      },
      /*
       * Die mitgelieferten Mediendateien duerfen zwischengespeichert werden.
       *
       * ## Was hier nicht stimmte
       *
       * Next gibt allem unter `public/` `Cache-Control: public, max-age=0`.
       * Mit einem ETag heisst das: kein zweiter Download, aber bei **jedem**
       * Seitenaufruf eine bedingte Anfrage je Datei. Gemessen am gebauten
       * Server: das Markenzeichen wurde auf jeder Seite zweimal angefragt -
       * es steht in der Kopfzeile und im Banner. Und der XP-Slot bringt
       * achtzehn WAV-Dateien und seine Standardsymbole mit; auf einer
       * Mobilverbindung sind das achtzehn Umlaeufe, bevor der erste Klang
       * spielt.
       *
       * ## Warum verschiedene Zeiten und kein `immutable`
       *
       * Weil die Namen nicht am Inhalt haengen. `swisshub-logo-32.png` heisst
       * nach einem Austausch genauso - `immutable` waere das Versprechen,
       * dass das nie passiert, und es stimmt nicht.
       *
       *  - **Schriften** aendern sich faktisch nie: ein Jahr.
       *  - **XP-Slot-Medien** aendern sich mit einem Deploy. Eine Woche, und
       *    `stale-while-revalidate` holt die neue Fassung im Hintergrund.
       *    Ein eigenes Symbol oder einen eigenen Klang laedt die Verwaltung
       *    ohnehin hoch - der liegt dann unter `/api/level/xp-slot/datei/`
       *    mit eigenem Namen und eigener Kopfzeile.
       *  - **Marke** ist das, was jemand am ehesten austauscht: ein Tag.
       */
      { source: '/schriften/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000' }] },
      {
        source: '/xp-slot/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }],
      },
      {
        source: '/branding/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ];
  },
};

export default nextConfig;
