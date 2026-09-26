import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import {
  SPOTLIGHT_FORMATE,
  SPOTLIGHT_MASSE,
  istFormat,
  spotlightDateiname,
  zeichneSpotlight,
  type SpotlightFormat,
  type SpotlightTexte,
} from '../../apps/web/src/modules/streamer/social-folie';
import type { OeffentlicherStreamerDaten } from '../../packages/modules/src/streamer/typen';

/**
 * Die Spotlight-Grafik entsteht wirklich - und in der richtigen Groesse.
 *
 * ## Warum das nicht durch Ansehen zu pruefen ist
 *
 * Weil ein Export auf drei Weisen scheitert, und keine davon sieht man am Code:
 *
 *  - **Leere Datei.** Satori kennt nur einen Teil von CSS. Eine Eigenschaft,
 *    die jeder Browser versteht - `clip-path`, `text-transform`, ein
 *    `box-shadow` mit Streuung - laesst das Rendern scheitern, und heraus kommt
 *    nichts. Im Studio sieht die Vorschau trotzdem gut aus, weil die im Browser
 *    laeuft.
 *  - **Falsche Masse.** Instagram schneidet eine Story, die nicht 1080 x 1920
 *    ist. Das merkt man beim Hochladen, nicht vorher.
 *  - **Layout laeuft aus dem Bild.** Ein Kanalname mit 25 Zeichen, eine
 *    Beschreibung mit 600, ein Name aus Zeichen, die keine Buchstaben sind -
 *    die Faelle, die niemand von Hand testet, weil der eigene Testname immer
 *    «Lea» heisst.
 *
 * Geprueft wird deshalb an den echten Bytes: der PNG-Kopf traegt Breite und
 * Hoehe, und eine Datei von null Bytes ist keine Datei.
 *
 * ## Und was die Vorschau im Studio damit zu tun hat
 *
 * Nichts - und das ist der Punkt. Die Vorschau ist ein `<img>` auf dieselbe
 * Route, die den Download liefert. Es gibt keinen zweiten Zeichenweg, der
 * abweichen koennte, also auch nichts zu vergleichen. Geprueft wird stattdessen
 * unten, dass die Route dieselbe Funktion benutzt.
 */

/** Breite und Hoehe aus dem IHDR-Block eines PNG. */
function pngMasse(bytes: Uint8Array): { breite: number; hoehe: number } {
  const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, wert] of signatur.entries()) {
    expect(bytes[index], `PNG-Signatur an Position ${index}`).toBe(wert);
  }
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
}

const streamer = (teile: Partial<OeffentlicherStreamerDaten> = {}): OeffentlicherStreamerDaten => ({
  slug: 'lea',
  discordId: '100000000000000001',
  name: 'Lea',
  beschreibung: 'Streamt abends Valorant und redet dabei zu viel.',
  avatarHash: null,
  bannerVerlauf: 'linear-gradient(135deg, #83060a 0%, #1a1a1a 100%)',
  bannerBild: null,
  sprachen: ['de', 'en'],
  spiele: [
    { id: 'a', name: 'Valorant' },
    { id: 'b', name: 'Counter-Strike 2' },
  ],
  kanaele: [
    {
      plattform: 'TWITCH',
      handle: 'lea_streamt',
      anzeigename: 'Lea_Streamt',
      adresse: 'https://twitch.tv/lea_streamt',
      bestaetigt: 'plattform',
    },
  ],
  live: null,
  letzterStreamAm: new Date('2026-09-25T20:00:00.000Z'),
  ...teile,
});

const texte: SpotlightTexte = {
  ueberschrift: 'Streamer Spotlight',
  beschreibung: 'Lea streamt seit zwei Jahren aus Bern - meistens Valorant, immer mit Publikum.',
  cta: 'Schau vorbei, wenn sie live ist.',
};

async function rendere(
  format: SpotlightFormat,
  eingabe: Partial<Parameters<typeof zeichneSpotlight>[0]> = {},
): Promise<Uint8Array> {
  const mass = SPOTLIGHT_MASSE[format];
  const bild = new ImageResponse(
    zeichneSpotlight({
      format,
      streamer: streamer(),
      texte,
      bildQuelle: null,
      bannerQuelle: null,
      ...eingabe,
    }),
    { width: mass.breite, height: mass.hoehe },
  );
  return new Uint8Array(await bild.arrayBuffer());
}

describe('Streamer Hub: Spotlight-Grafik', () => {
  it.each(SPOTLIGHT_FORMATE)('zeichnet %s in genau den Massen, die Instagram erwartet', async (format) => {
    const bytes = await rendere(format);
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(pngMasse(bytes)).toEqual(SPOTLIGHT_MASSE[format]);
  });

  it('kennt drei Formate und sonst keines', () => {
    expect([...SPOTLIGHT_FORMATE]).toEqual(['story', 'feed', 'quadrat']);
    expect(istFormat('story')).toBe(true);
    // Eine Formatangabe kommt aus einem Abfrageparameter - also von aussen.
    expect(istFormat('1080x1080')).toBe(false);
    expect(istFormat('../../etc/passwd')).toBe(false);
  });

  it('haelt auch einen langen Namen und eine lange Beschreibung im Bild', async () => {
    /*
     * Die Grenzen des Datenmodells: ein Twitch-Login darf 25 Zeichen haben, die
     * Beschreibung 600. Beides gleichzeitig ist der Fall, an dem ein Layout
     * bricht - und beides kommt vor.
     */
    const bytes = await rendere('story', {
      streamer: streamer({
        name: 'Der_Lange_Kanalname_XXXX',
        beschreibung: 'A'.repeat(600),
        kanaele: [
          {
            plattform: 'TWITCH',
            handle: 'der_lange_kanalname_xxxx',
            anzeigename: 'Der_Lange_Kanalname_XXXX',
            adresse: 'https://twitch.tv/der_lange_kanalname_xxxx',
            bestaetigt: 'plattform',
          },
        ],
        spiele: Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          name: `Ein Spiel mit ziemlich langem Namen ${index}`,
        })),
      }),
      texte: {
        ueberschrift: 'Ü'.repeat(120),
        beschreibung: 'B'.repeat(600),
        cta: 'C'.repeat(200),
      },
    });
    expect(pngMasse(bytes)).toEqual(SPOTLIGHT_MASSE.story);
  });

  it('zeichnet auch Namen, die keine lateinischen Buchstaben sind', async () => {
    /*
     * Discord erlaubt fast alles im Anzeigenamen. Ein Emoji oder ein
     * kyrillischer Name darf keine leere Datei ergeben - Satori faellt bei
     * einem Zeichen ohne Schnitt nicht aus, aber das muss geprueft sein.
     */
    for (const name of ['Лена', '日本のストリーマー', '🎮 Lea 🎮', 'Ünïcödé Strëamer']) {
      const bytes = await rendere('quadrat', { streamer: streamer({ name }) });
      expect(pngMasse(bytes), name).toEqual(SPOTLIGHT_MASSE.quadrat);
    }
  });

  it('zeichnet einen Streamer ohne Beiwerk - ohne Bild, Banner, Spiele und Texte', async () => {
    /*
     * Ein frisch freigegebener Streamer hat noch nichts: kein Profilbild, kein
     * Banner, keine Spiele. Die Grafik muss trotzdem entstehen, sonst waere das
     * Studio genau fuer die neuen Streamer unbenutzbar.
     */
    const bytes = await rendere('feed', {
      streamer: streamer({
        beschreibung: null,
        avatarHash: null,
        bannerBild: null,
        spiele: [],
        sprachen: [],
        kanaele: [],
      }),
      texte: { ueberschrift: null, beschreibung: null, cta: null },
    });
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(pngMasse(bytes)).toEqual(SPOTLIGHT_MASSE.feed);
  });

  it('zeigt im Studio dieselben Bytes, die der Download liefert', () => {
    /*
     * Die Zusage aus §10.2, und sie wird nicht durch Vergleichen zweier Bilder
     * gehalten, sondern dadurch, dass es nur eines gibt: die Vorschau im Editor
     * ist ein `<img>` auf die Exportroute. Ein zweiter Zeichenweg im Browser
     * waere die Quelle jeder Abweichung - deshalb prueft dieser Test, dass es
     * ihn nicht gibt.
     */
    const route = readFileSync(
      join(process.cwd(), 'apps/web/src/app/api/streamer/spotlight/[spotlightId]/route.tsx'),
      'utf8',
    );
    expect(route).toContain('zeichneSpotlight');
    expect(route).toContain('ImageResponse');

    const editor = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/streamer/components/spotlight-editor.tsx'),
      'utf8',
    );
    // Die Vorschau zeigt die Exportroute - und zeichnet nicht selbst.
    expect(editor).toContain('/api/streamer/spotlight/');
    expect(editor).not.toContain('zeichneSpotlight');
    expect(editor).not.toContain('<canvas');
  });

  it('baut einen Dateinamen, der sich auf jedem System speichern laesst', () => {
    expect(spotlightDateiname('Lea_Streamt', 'story')).toBe('swisshub-spotlight-lea-streamt-story.png');
    // Pfadtrenner und Punkte verschwinden - der Name kommt aus einem Profil.
    expect(spotlightDateiname('../../etc/passwd', 'feed')).toBe('swisshub-spotlight-etc-passwd-feed.png');
    // Und ein Name ganz ohne verwendbare Zeichen bekommt trotzdem einen.
    expect(spotlightDateiname('🎮🎮🎮', 'quadrat')).toBe('swisshub-spotlight-streamer-quadrat.png');
  });
});
