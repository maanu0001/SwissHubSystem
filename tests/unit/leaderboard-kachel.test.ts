import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RangKarte, RangZeile } from '../../apps/web/src/app/leaderboard/rang';

/**
 * Die ganze Kachel ist das Ziel, nicht nur der Name.
 *
 * Geprueft wird am gerenderten Markup und nicht an der Quelle: dass eine
 * Datei das Wort `Link` enthaelt, sagt nichts darueber, ob der Avatar
 * innerhalb des Links steht. Genau das ist aber die Zusage - wer auf das
 * Bild oder die Zahl klickt, soll dort landen, wo auch der Name hinfuehrt.
 *
 * Die Gegenprobe gehoert dazu: wer kein oeffentliches Profil hat, darf
 * keinen Link bekommen. Ein toter Link auf eine Sperrseite waere schlechter
 * als gar keiner.
 */

const EINTRAG = {
  rank: 1,
  discordId: '900000000000000001',
  displayName: 'Mara',
  avatarHash: null,
  level: 12,
  xp: 34_500,
  progress: 0.4,
} as unknown as Parameters<typeof RangKarte>[0]['eintrag'];

/** Alles zwischen dem oeffnenden und dem schliessenden Anker. */
function imLink(html: string): string | null {
  const anfang = html.indexOf('<a ');
  if (anfang === -1) {
    return null;
  }
  return html.slice(anfang, html.lastIndexOf('</a>'));
}

describe.each([
  ['Karte', RangKarte],
  ['Zeile', RangZeile],
])('Leaderboard: die ganze %s fuehrt zum Profil', (_name, Komponente) => {
  it('legt den Link um die ganze Kachel - Avatar, Name und Zahlen', () => {
    const html = renderToStaticMarkup(createElement(Komponente, { eintrag: EINTRAG, slug: 'mara' }));
    const inhalt = imLink(html);

    expect(inhalt).not.toBeNull();
    expect(html).toContain('href="/u/mara"');
    // Der Name steht im Link - das war schon vorher so.
    expect(inhalt).toContain('Mara');
    // Und das Bild und die Zahlen eben auch - das ist das Neue.
    expect(inhalt).toContain('<img');
    expect(inhalt).toContain('Level 12');
  });

  it('beschriftet den Link fuer die Vorlesehilfe mit dem Namen', () => {
    // Ohne Beschriftung liest ein Screenreader den ganzen Kachelinhalt als
    // Linktext vor - «eins Mara Level zwoelf vierunddreissigtausend».
    const html = renderToStaticMarkup(createElement(Komponente, { eintrag: EINTRAG, slug: 'mara' }));
    expect(html).toContain('aria-label="Öffentliches Profil von Mara"');
  });

  it('verlinkt nicht, wo es kein oeffentliches Profil gibt', () => {
    const html = renderToStaticMarkup(createElement(Komponente, { eintrag: EINTRAG, slug: null }));
    expect(html).not.toContain('<a ');
    // Und sieht dann auch nicht anklickbar aus.
    expect(html).not.toContain('cursor-pointer');
  });
});
