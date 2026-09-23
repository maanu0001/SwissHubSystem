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
  serverExternalPackages: ['@prisma/client', 'openai', '@anthropic-ai/sdk'],
  experimental: {
    // Server Actions sind nur für die eigene Origin erlaubt (CSRF).
    serverActions: {
      bodySizeLimit: '1mb',
    },
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
    ];
  },
};

export default nextConfig;
