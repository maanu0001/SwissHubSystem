import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { socialmedia } from '@swisshub/modules';
import { zeichnePost } from '@/modules/socialmedia/post-folie';
import { ladeSchriften, ladeSignet, SCHNITTE, SCHRIFT } from '@/modules/socialmedia/mitgeliefert';

/**
 * Was die Posts hochwertig aussehen laesst - und was es kaputtmachen wuerde.
 *
 * ## Der Fund, der diese Datei erklaert
 *
 * `next/og` bringt genau **eine** Schriftdatei mit: Noto Sans Regular. Ohne
 * eigene Schnitte wird `fontWeight: 800` nicht genaehert, sondern
 * stillschweigend verworfen - gemessen an zwei Renderlaeufen desselben Textes
 * in 400 und in 800, die byteweise dasselbe PNG ergaben.
 *
 * Das ist der Grund, aus dem die Grafiken flach wirkten, und es ist zugleich
 * die Art Fehler, die unbemerkt zurueckkommt: entfernt jemand die
 * `fonts`-Angabe an einer Route, faellt kein Test um, kein Build bricht, und
 * im Bild sieht man es nur, wenn man weiss, worauf man achten muss. Deshalb
 * steht es hier.
 */

const KOMPONENTEN = join(process.cwd(), 'apps/web/src/modules/socialmedia');
const ROUTEN = join(process.cwd(), 'apps/web/src/app/api/social-media/post/[postId]');

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');

const INHALT = {
  titel: 'SwissHub Cup Oktober',
  untertitel: 'Counter-Strike 2',
  text: 'Anmeldung bis Freitag\nMaximal 16 Teams',
  cta: 'Jetzt anmelden',
  fusszeile: 'swisshub.gg',
  branding: true,
};

function markup(
  design: socialmedia.PostDesign,
  bilder: Record<string, string> = {},
  format: socialmedia.PostFormat = 'quadrat',
): string {
  const typ = socialmedia.postTyp('info')!;
  return renderToStaticMarkup(
    zeichnePost({
      typId: typ.id,
      typLabel: typ.label,
      block: typ.block,
      design,
      format,
      inhalt: INHALT,
      bilder,
      baum: null,
    }),
  );
}

/** Die Werte einer Stileigenschaft über alle Flächen des Markups. */
function werte(quelle: string, eigenschaft: string): string[] {
  return [...quelle.matchAll(new RegExp(`${eigenschaft}\\s*:\\s*([^;"]+)`, 'gu'))].map((t) =>
    (t[1] ?? '').trim(),
  );
}

describe('Post-Export: die Schriftschnitte', () => {
  it('liefert alle drei Schnitte als lesbare Dateien', async () => {
    const schriften = await ladeSchriften();
    expect(schriften, 'die Schriften liessen sich nicht laden').toBeDefined();
    expect(schriften?.map((eintrag) => eintrag.weight)).toEqual([...SCHNITTE]);
    for (const eintrag of schriften ?? []) {
      expect(eintrag.name).toBe(SCHRIFT);
      // Eine TrueType-Datei beginnt mit 0x00010000 - eine leere oder als
      // Textdatei eingecheckte Schrift faellt hier auf, nicht erst im Bild.
      expect(eintrag.data.subarray(0, 4).toString('hex'), eintrag.weight.toString()).toBe('00010000');
      expect(eintrag.data.byteLength).toBeGreaterThan(50_000);
    }
  });

  it('reicht die Schnitte an beide Renderwege', () => {
    // Ohne diese Angabe faellt `next/og` auf seine einzige mitgelieferte
    // Schrift zurueck und verwirft jedes Gewicht. Nichts bricht dabei - das
    // Bild wird nur flach.
    for (const route of ['route.tsx', 'zip/route.tsx']) {
      const quelle = lies(join(ROUTEN, route));
      expect(quelle, route).toContain('ladeSchriften');
      expect(quelle, route).toContain('fonts: schriften');
    }
  });

  it('nutzt im gezeichneten Post mehr als ein Gewicht', () => {
    // Die Hierarchie selbst: ohne verschiedene Schnitte unterscheidet sich
    // eine Ueberschrift von ihrem Fliesstext nur noch in der Groesse.
    const gewichte = new Set(werte(markup('clean'), 'font-weight'));
    expect(gewichte.size).toBeGreaterThanOrEqual(2);
    expect(gewichte).toContain('800');
  });
});

describe('Post-Export: das SwissHub-Signet', () => {
  it('liegt als Datei bereit und kommt als data-URI', async () => {
    const signet = await ladeSignet();
    expect(signet).toMatch(/^data:image\/png;base64,/u);
    expect((signet ?? '').length).toBeGreaterThan(10_000);
  });

  it('steht ohne Zutun auf dem Post', () => {
    // `branding` ist standardmaessig an - ein Post des Servers traegt das
    // Zeichen des Servers, ohne dass jemand es einschalten muss.
    const ohneAngabe = socialmedia.leseInhalt({
      postType: 'info',
      renderConfig: { titel: 'Ohne Angabe' },
    } as Parameters<typeof socialmedia.leseInhalt>[0]);
    expect(ohneAngabe.branding).toBe(true);
  });

  it('zeichnet das Signet, wenn es da ist - und sonst die Wortmarke', () => {
    const mitSignet = markup('clean', { signet: 'data:image/png;base64,AAAA' });
    expect(mitSignet).toContain('data:image/png;base64,AAAA');

    // Ohne Signet darf kein Post ohne Zeichen dastehen.
    expect(markup('clean')).toContain('SWISSHUB');
  });

  it('laesst einem hochgeladenen Logo den Vortritt', () => {
    // Neben einem fremden Zeichen waere das Signet eine Behauptung ueber die
    // Urheberschaft, die der Post nicht aufstellt.
    const beides = markup('clean', {
      logo: 'data:image/png;base64,LOGO',
      signet: 'data:image/png;base64,SIGNET',
    });
    expect(beides).toContain('LOGO');
    expect(beides).not.toContain('SIGNET');
  });
});

describe('Post-Export: der Inhalt kommt an, wie er getippt wurde', () => {
  const lese = (renderConfig: Record<string, unknown>): socialmedia.PostInhalt =>
    socialmedia.leseInhalt({ postType: 'info', renderConfig } as Parameters<
      typeof socialmedia.leseInhalt
    >[0]);

  it('behaelt die Zeilenumbrueche im Textfeld', () => {
    /*
     * Der Fehler, den diese Zusicherung festhaelt.
     *
     * `sanitizeText` faltet ohne `keepNewlines` jede Folge von Leerraum zu
     * einem Leerzeichen. Das Textfeld heisst im Editor «Eine Zeile je Punkt»,
     * und die Zeichenquelle macht aus jeder Zeile einen Aufzaehlungspunkt -
     * beim Speichern wurden daraus still und leise drei Zeilen in einer.
     *
     * Im Editor sah man nichts davon: dort stand der Text ja noch so da, wie
     * er getippt wurde. Sichtbar war es erst im fertigen Export.
     */
    const inhalt = lese({ titel: 'Titel', text: 'Erste Zeile\nZweite Zeile\nDritte Zeile' });
    expect(inhalt.text).toBe('Erste Zeile\nZweite Zeile\nDritte Zeile');
    expect(inhalt.text?.split('\n')).toHaveLength(3);
  });

  it('faltet Leerraum in einzeiligen Feldern weiterhin zusammen', () => {
    // Die Ausnahme gilt genau einem Feld. Eine Ueberschrift mit einem
    // Zeilenumbruch darin waere ein Umbruch, den das Layout nicht gewaehlt hat.
    const inhalt = lese({ titel: 'Ein\nTitel   mit  Luft', fusszeile: 'Fuss\nzeile' });
    expect(inhalt.titel).toBe('Ein Titel mit Luft');
    expect(inhalt.fusszeile).toBe('Fuss zeile');
  });
});

describe('Post-Export: keine Zufallsoptik', () => {
  it('legt keinen Lichthof mehr hinter das Spotlight-Motiv', () => {
    /*
     * Hier lagen vier konzentrische Kreise in Akzentfarbe mit Deckkraft
     * zwischen 0.06 und 0.18. Sie sollten Licht andeuten; Satori kennt aber
     * keinen Radialgradienten, und im Bild waren es vier Ringe mit sichtbaren
     * Kanten, die nichts gliederten.
     */
    const flaechen = markup('spotlight');
    const schwach = werte(flaechen, 'opacity').filter((wert) => Number(wert) > 0 && Number(wert) < 0.3);
    expect(schwach, 'halbdurchsichtige Dekorflaechen sind zurueck').toEqual([]);
  });

  it('haelt den Keil in Bold unter dem Inhalt', () => {
    // Bei 0.52 und 12 Grad schnitt seine Kante mitten durch die letzte Zeile
    // der Ueberschrift und durch die Aufzaehlung.
    const quelle = lies(join(KOMPONENTEN, 'post-folie.tsx'));
    const anteil = /top: Math\.round\(buehne\.hoehe \* (0\.\d+)\)/u.exec(quelle)?.[1];
    expect(Number(anteil)).toBeGreaterThanOrEqual(0.65);
    expect(quelle).not.toContain('rotate(-12deg)');
  });

  it('verzichtet auf die volle Pille beim Handlungsaufruf', () => {
    // `borderRadius: 999` ist die Form, die jeder Baukasten vorgibt - und
    // genau deshalb sieht sie nach Baukasten aus.
    const radien = werte(markup('clean'), 'border-radius');
    expect(radien).not.toContain('999px');
  });
});

describe('Post-Export: die drei Formate sind nicht dasselbe Layout', () => {
  it('setzt je Format eigene Raender und Typogroessen', () => {
    const [quadrat, feed, story] = (['quadrat', 'feed', 'story'] as const).map((format) =>
      markup('clean', {}, format),
    );
    const rand = (quelle: string): string | undefined => werte(quelle, 'padding-left')[0];
    expect(new Set([rand(quadrat!), rand(feed!), rand(story!)]).size).toBe(3);

    const titel = (quelle: string): number =>
      Math.max(...werte(quelle, 'font-size').map((wert) => Number.parseFloat(wert)));
    // Die Story traegt die groesste Ueberschrift - sie hat die meiste Flaeche.
    expect(titel(story!)).toBeGreaterThan(titel(quadrat!));
  });
});
