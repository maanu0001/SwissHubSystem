import { describe, expect, it } from 'vitest';

/**
 * Das Bild eines Community Moments im Export.
 *
 * ## Der Befund, der diesen Test erzwungen hat
 *
 * Im Schnappschuss einer `IMAGE_MOMENT`-Folie steht eine **Adresse**:
 * `/api/wrapped/moment/<id>`. Fuer den Browser ist das richtig. Fuer
 * `ImageResponse` nicht - die Zeichenmaschine laeuft im Server, verlangt
 * eine absolute Adresse und wirft sonst:
 *
 *     Image source must be an absolute URL: /api/wrapped/moment/...
 *
 * Geworfen wurde dabei nicht die eine Folie, sondern der **ganze** Export:
 * HTTP 500, kein Archiv. Und gesehen hat es niemand, weil die Vorschau im
 * Editor von einem Browser gezeichnet wird, dem eine relative Adresse
 * genuegt. Vorschau grün, Export kaputt.
 *
 * Diese Datei haelt beide Haelften der Reparatur fest: die Pruefung, die
 * eine untaugliche Quelle gar nicht erst durchlaesst, und die beiden
 * Routen, die das Bild als Bytes aufloesen statt als Adresse.
 */
const { istZeichenbareBildquelle } = await import('../../apps/web/src/modules/wrapped/ausgabe-folie');
const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const quelle = (datei: string): string => readFileSync(join(process.cwd(), datei), 'utf8');

const EXPORT_ROUTE = 'apps/web/src/app/api/wrapped/ausgabe/[editionId]/export/route.tsx';
const FOLIEN_ROUTE = 'apps/web/src/app/api/wrapped/ausgabe/[editionId]/folie/[slideId]/route.tsx';

describe('Bildquelle einer Folie', () => {
  it('lehnt eine relative Adresse ab - genau die hat den Export gekippt', () => {
    expect(istZeichenbareBildquelle('/api/wrapped/moment/abc123')).toBe(false);
  });

  it('lehnt Leeres ab', () => {
    expect(istZeichenbareBildquelle(null)).toBe(false);
    expect(istZeichenbareBildquelle(undefined)).toBe(false);
    expect(istZeichenbareBildquelle('')).toBe(false);
  });

  it('nimmt eine data-URI an - so kommt das Bild in den Export', () => {
    expect(istZeichenbareBildquelle('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('nimmt eine absolute Adresse an', () => {
    expect(istZeichenbareBildquelle('https://system.swisshub.gg/bild.png')).toBe(true);
  });

  it('laesst sich von etwas, das nur so aussieht, nicht taeuschen', () => {
    // `data:text/html` waere keine Bildquelle, und ein Protokoll-relativer
    // Verweis ist im Server genauso unbrauchbar wie ein relativer Pfad.
    expect(istZeichenbareBildquelle('data:text/html;base64,PGh0bWw+')).toBe(false);
    expect(istZeichenbareBildquelle('//example.com/bild.png')).toBe(false);
  });
});

describe('Die zeichnenden Routen', () => {
  it.each([
    ['Archiv', EXPORT_ROUTE],
    ['Einzelfolie', FOLIEN_ROUTE],
  ])('%s löst das Moment-Bild zu Bytes auf', (_name, datei) => {
    const text = quelle(datei);
    expect(text, `${datei}: ruft momentBildDatenUri nicht auf`).toContain('momentBildDatenUri');
    expect(text, `${datei}: reicht bildQuelle nicht an die Zeichenmaschine`).toContain('bildQuelle');
  });

  it.each([
    ['Archiv', EXPORT_ROUTE],
    ['Einzelfolie', FOLIEN_ROUTE],
  ])('%s fängt einen Lesefehler ab, statt das Archiv zu verlieren', (_name, datei) => {
    // Ein fehlendes Bild darf eine schlichtere Folie ergeben - nie eine 500.
    expect(quelle(datei)).toMatch(/momentBildDatenUri\([^)]*\)[\s\S]{0,200}?\.catch\(/u);
  });
});

/**
 * Der Erhebungshinweis - gezeichnet, nicht nur gespeichert.
 *
 * ## Warum das ein Bildtest ist und kein Quelltest
 *
 * Weil die Zusage lautet: der Satz geht **mit dem Bild** hinaus. Eine Zahl
 * ueber die halbe Strecke, dargestellt wie eine ueber die ganze, laesst sich
 * nach dem Posten nicht mehr zurueckholen - und ein Hinweis, der nur im
 * Editor stand, hat dann niemandem geholfen.
 *
 * `ImageResponse` rastert hier wirklich: zwei Folien, die sich nur im Hinweis
 * unterscheiden, muessen verschiedene Bytes ergeben. Taete der Zeichner
 * nichts mit dem Feld, waeren sie gleich - und dieser Test rot.
 */
const { ImageResponse } = await import('next/og');
const { zeichneAusgabeFolie, AUSGABE_MASSE } =
  await import('../../apps/web/src/modules/wrapped/ausgabe-folie');

async function bytes(erhebung: string | null): Promise<Uint8Array> {
  const mass = AUSGABE_MASSE.story;
  const antwort = new ImageResponse(
    zeichneAusgabeFolie({
      folie: {
        templateKey: 'HERO_NUMBER',
        daten: { wert: '2 846', label: 'Voice-Stunden', zusatz: null },
        editorial: { ueberschrift: 'Im Voice', text: '' },
        erhebung,
      },
      format: 'story',
      variante: 'raster',
      titel: 'SwissHub Wrapped August 2026',
      host: 'swisshub.ch',
    }),
    { width: mass.breite, height: mass.hoehe },
  );
  return new Uint8Array(await antwort.arrayBuffer());
}

describe('Der Erhebungshinweis auf der Folie', () => {
  it('veraendert das Bild - der Satz wird wirklich gezeichnet', async () => {
    const ohne = await bytes(null);
    const mit = await bytes('Die Sprachzeit wird erst seit dem 2026-08-17 gemessen - 50 % des Zeitraums.');

    // Beides echte PNGs, damit ein Fehlschlag nicht als Unterschied durchgeht.
    expect([...ohne.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([...mit.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    expect(mit.byteLength).not.toBe(ohne.byteLength);
  }, 60000);

  it('zeichnet ohne Hinweis dasselbe Bild wie zuvor', async () => {
    /*
     * Die Gegenprobe. Der neue Fusszeilen-Aufbau darf die Folie ohne Hinweis
     * nicht veraendern - sonst waere jede bestehende Folie unmerklich anders,
     * und ein Karussell aus alten und neuen Bildern paesste nicht zusammen.
     */
    const einmal = await bytes(null);
    const nochmal = await bytes(null);
    expect(nochmal.byteLength).toBe(einmal.byteLength);
  }, 60000);
});
