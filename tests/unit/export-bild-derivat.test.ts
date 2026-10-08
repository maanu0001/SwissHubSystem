import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as Modules from '@swisshub/modules';

/**
 * Was ein Export an Bytes anfasst.
 *
 * ## Warum es diese Datei gibt
 *
 * Weil eine hoehere Upload-Grenze nicht allein eine groessere Zahl sein kann.
 * Ein Export traegt die Bilder **im Speicher**: Satori bekommt keine Adresse,
 * sondern eine `data:`-URI, und die ist base64 - ein Drittel groesser als die
 * Datei. Ein Post kann elf Bilder fuehren. Bei 40 bis 50 MB je Datei waeren
 * das ueber ein halbes Gigabyte an Zeichenketten, und dazu je Bild die
 * entpackte Bitmap: 8000 x 8000 Pixel sind 256 MB, ganz gleich, wie klein die
 * Datei war.
 *
 * Gespeichert bleibt deshalb das Original - gezeichnet wird mit einem Abbild
 * in der Groesse, die ein Export von 1080 x 1920 ueberhaupt nutzen kann.
 */
let uploadDir: string;
let branding: (typeof Modules)['branding'];

beforeAll(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), 'swisshub-derivat-'));
  process.env.SWISSHUB_UPLOAD_DIR = uploadDir;
  branding = (await import('@swisshub/modules')).branding;
});

afterAll(() => {
  delete process.env.SWISSHUB_UPLOAD_DIR;
});

/** Ein echtes PNG - keine Attrappe, weil hier wirklich dekodiert wird. */
async function echtesPng(kante: number): Promise<Buffer> {
  return sharp({
    create: { width: kante, height: kante, channels: 4, background: { r: 200, g: 30, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function ablegen(kante: number): Promise<string> {
  const bytes = await echtesPng(kante);
  const gespeichert = await branding.storeLogoUpload(new Uint8Array(bytes), 'image/png', 'socialpost');
  return gespeichert.fileName;
}

describe('Bilder fuer den Export', () => {
  it('verkleinert ein grosses Bild auf Exportmass', async () => {
    const name = await ablegen(4000);
    const datei = await branding.leseBildFuerExport(name);
    expect(datei).not.toBeNull();
    const masse = await sharp(datei!.data).metadata();
    expect(Math.max(masse.width ?? 0, masse.height ?? 0)).toBeLessThanOrEqual(2160);
  }, 30_000);

  it('laesst ein kleines Bild unangetastet', async () => {
    /*
     * `withoutEnlargement` allein genuegt nicht als Zusage - ein erneutes
     * Kodieren wuerde die Bytes trotzdem veraendern. Wer unter dem Mass
     * liegt, soll denselben Weg gehen wie vorher.
     */
    const name = await ablegen(800);
    const original = await branding.readUpload(name);
    const datei = await branding.leseBildFuerExport(name);
    expect(datei?.data.equals(original!.data)).toBe(true);
  }, 30_000);

  it('gibt das Original zurueck, wenn die Verkleinerung scheitert', async () => {
    /*
     * Ein Bild nicht zu zeichnen, weil die Verkleinerung gescheitert ist,
     * waere ein Rueckschritt gegenueber dem Zustand davor: der Aufrufer hat
     * einen Weg fuer «kein Bild», aber keinen fuer «halbes Bild».
     *
     * Nachgestellt mit einem Namen, dessen Datei gueltig heisst, aber kein
     * dekodierbares Bild enthaelt.
     */
    const name = branding.uploadName('socialpost', 'png');
    await branding.schreibeUpload(
      name,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    );
    const datei = await branding.leseBildFuerExport(name);
    expect(datei?.data.byteLength).toBe(12);
  });

  it('meldet ein fehlendes Bild als fehlend und nicht als Fehler', async () => {
    const datei = await branding.leseBildFuerExport(branding.uploadName('socialpost', 'png'));
    expect(datei).toBeNull();
  });

  it('wird vom Post-Export wirklich benutzt', async () => {
    const { readFileSync } = await import('node:fs');
    const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/socialmedia/bilder.ts'), 'utf8');
    // Sonst waere die Verkleinerung da und niemand ginge durch sie hindurch.
    expect(quelle).toContain('leseBildFuerExport');
    expect(quelle).not.toContain('branding.readUpload(');
  });
});
