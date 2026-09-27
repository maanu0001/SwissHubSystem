import type { MetadataRoute } from 'next';
import { appUrl } from '@swisshub/config';

/**
 * Nicht beim Bauen erzeugen, sondern beim Abruf.
 *
 * `robots.txt` enthaelt die Adresse der Sitemap, und die kommt aus `appUrl()` -
 * also aus der Umgebung. Next erzeugt Metadaten-Routen ohne diese Zeile
 * **beim Build** vorab, und dort gibt es die Umgebung nicht: der Docker-Build
 * hat kein `AUTH_SECRET` und keine `DATABASE_URL`, und `next build` brach an
 * genau dieser Datei ab. In der Pipeline waere es schlimmer als ein Abbruch
 * gewesen - dort stehen Wegwerfwerte, und `http://localhost:3000` waere fest
 * in die ausgelieferte `robots.txt` gebrannt.
 *
 * Die Datei ist ein paar Zeilen lang; sie bei jedem Abruf zu erzeugen kostet
 * nichts.
 */
export const dynamic = 'force-dynamic';

/**
 * `robots.txt`.
 *
 * ## Was hier erlaubt ist - und warum so wenig
 *
 * SwissHub System ist eine Verwaltungsoberflaeche. Alles unter `(app)` verlangt
 * eine Anmeldung; ein Crawler bekaeme dort eine Weiterleitung und sonst nichts.
 * Was oeffentlich ist und in eine Suchmaschine gehoert, ist die Startseite und
 * sind die oeffentlichen Profile.
 *
 * Deshalb steht hier eine **Allowlist** und keine Liste von Ausnahmen: `/`
 * gesperrt, einzelne Bereiche wieder frei. Eine Blocklist waere bei der
 * naechsten internen Route unvollstaendig, und niemandem faellt es auf.
 *
 * ## Was das nicht ist
 *
 * Kein Zugriffsschutz. `robots.txt` ist eine Bitte, und ein Crawler, der sie
 * nicht liest, kommt genauso weit wie vorher - naemlich bis zur Anmeldung. Wer
 * seine Profilseite nicht in einer Suchmaschine haben will, stellt sie auf
 * «nicht indexiert»; dann sendet die Seite selbst `noindex`, und das ist die
 * Anweisung, die zaehlt.
 *
 * ## Warum die Profile trotzdem einzeln entscheiden
 *
 * `/u/` steht hier frei, weil es oeffentliche Profile gibt. Welche davon
 * indexiert werden duerfen, entscheidet jedes Profil selbst - ueber `noindex` im
 * Kopf der Seite und darueber, ob es in der Sitemap steht. `robots.txt` kennt
 * keine einzelnen Profile und soll sie nicht kennen: eine Liste aller nicht
 * indexierten Adressen waere eine oeffentliche Liste genau dieser Profile.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
        allow: [
          // Die Startseite - der Einstieg fuer jemanden, der einem Profil-Link
          // gefolgt ist und wissen will, was SwissHub ist.
          '/$',
          // Die oeffentlichen Profile.
          '/u/',
          // Die oeffentliche Streamer-Uebersicht.
          '/streamer',
          // Die oeffentliche Rangliste und die Turnierseiten.
          '/leaderboard',
          '/turniere',
        ],
      },
    ],
    sitemap: appUrl('/sitemap.xml'),
  };
}
