import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAX_BYTES_GRENZE,
  VIDEO_MAX_BYTES_VORGABE,
  VIDEO_MIME_TYPES,
  erkenneContainer,
  videoPfad,
} from '@swisshub/modules/clips/video-speicher';

/**
 * Was als Videodatei durchgeht.
 *
 * ## Warum die Bytes entscheiden und nicht der Header
 *
 * `Content-Type` und Dateiendung kommen beide vom Browser und sind beide frei
 * wählbar. Eine HTML-Datei als `clip.mp4` mit `video/mp4` zu schicken kostet
 * nichts - und läge sie danach unter unserer Domain, liefe sie als Seite.
 *
 * Geprüft wird hier deshalb die Erkennung an echten Signaturbytes, und zwar
 * vor allem an den Fällen, die durchrutschen sollen und nicht dürfen.
 */

/** Ein MP4-Kopf: vier Byte Länge, `ftyp`, dann die Marke. */
function mp4(marke = 'isom'): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x00, 0x00, 0x00, 0x20], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  for (let i = 0; i < 4; i += 1) {
    bytes[8 + i] = marke.charCodeAt(i);
  }
  return bytes;
}

/** Ein EBML-Kopf mit DocType. */
function matroska(docType: string): Uint8Array {
  const kopf = new Uint8Array(48);
  kopf.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  // Das DocType steht als Zeichenkette im Kopf.
  for (let i = 0; i < docType.length; i += 1) {
    kopf[12 + i] = docType.charCodeAt(i);
  }
  return kopf;
}

describe('Container-Erkennung', () => {
  it('erkennt MP4 an ftyp, nicht an der Endung', () => {
    expect(erkenneContainer(mp4('isom'))).toBe('mp4');
    expect(erkenneContainer(mp4('mp42'))).toBe('mp4');
    expect(erkenneContainer(mp4('avc1'))).toBe('mp4');
  });

  it('erkennt WebM am DocType', () => {
    expect(erkenneContainer(matroska('webm'))).toBe('webm');
  });

  it('lehnt QuickTime ab, obwohl es dieselbe Boxstruktur hat', () => {
    /*
     * MOV trägt `ftyp` wie ein MP4. Als MP4 durchgelassen läge eine Datei im
     * Speicher, die im Player schwarz bleibt - und niemand wüsste, weshalb.
     */
    expect(erkenneContainer(mp4('qt  '))).toBeNull();
  });

  it('lehnt Matroska ohne webm ab', () => {
    // Eine .mkv-Datei. Browser spielen sie nicht zuverlässig ab.
    expect(erkenneContainer(matroska('matroska'))).toBeNull();
  });

  it('lehnt ab, was kein Video ist', () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect(erkenneContainer(html)).toBeNull();

    // Ein PNG - gültige Datei, falscher Ort.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(erkenneContainer(png)).toBeNull();

    // Eine ELF-Binärdatei.
    const elf = new Uint8Array(24);
    elf.set([0x7f, 0x45, 0x4c, 0x46], 0);
    expect(erkenneContainer(elf)).toBeNull();
  });

  it('lehnt eine zu kurze Datei ab, statt daneben zu lesen', () => {
    expect(erkenneContainer(new Uint8Array([0x1a, 0x45]))).toBeNull();
    expect(erkenneContainer(new Uint8Array(0))).toBeNull();
  });

  it('faellt nicht auf ein ftyp weiter hinten herein', () => {
    /*
     * Die Signatur steht an Position 4 und nirgends sonst. Eine Datei, die
     * `ftyp` erst im Inhalt trägt, ist kein MP4 - sonst liesse sich jede
     * Datei durch einen eingebauten Textschnipsel tarnen.
     */
    const getarnt = new Uint8Array(64);
    getarnt.set(new TextEncoder().encode('<html>ftypisom'), 0);
    expect(erkenneContainer(getarnt)).toBeNull();
  });
});

describe('Die Grenzen', () => {
  it('hat 100 MB als Vorgabe', () => {
    expect(VIDEO_MAX_BYTES_VORGABE).toBe(100 * 1024 * 1024);
  });

  it('laesst auch einen Administrator nicht beliebig hoch', () => {
    /*
     * Die Platte ist geteilt, und ein volles Dateisystem nimmt die Datenbank
     * mit. Die Einstellung kann die Grenze nicht überschreiten.
     */
    expect(VIDEO_MAX_BYTES_GRENZE).toBeLessThanOrEqual(500 * 1024 * 1024);
    expect(VIDEO_MAX_BYTES_GRENZE).toBeGreaterThan(VIDEO_MAX_BYTES_VORGABE);
  });

  it('kennt genau die zwei Typen, die auch erkannt werden', () => {
    expect(Object.keys(VIDEO_MIME_TYPES).sort()).toEqual(['video/mp4', 'video/webm']);
  });
});

describe('Der Dateiname', () => {
  it('nimmt nur selbst erzeugte Namen', () => {
    const gut = `clip-${'a'.repeat(32)}.mp4`;
    expect(videoPfad(gut)).toContain(gut);
    expect(videoPfad(`clip-${'f'.repeat(32)}.webm`)).not.toBeNull();
  });

  it('weist Pfadmanipulation ab', () => {
    /*
     * Der Name steht in der Datenbank und nicht im Request - aber ein
     * Tippfehler in einer Migration würde sonst zu einem Pfad ausserhalb des
     * Verzeichnisses. Ein Muster macht daraus einen sauberen Fehlschlag.
     */
    for (const name of [
      '../../../etc/passwd',
      `clip-${'a'.repeat(32)}.mp4/../../x`,
      `/etc/clip-${'a'.repeat(32)}.mp4`,
      `clip-${'a'.repeat(32)}.sh`,
      `clip-${'a'.repeat(32)}`,
      `clip-XYZ.mp4`,
      `anderes-${'a'.repeat(32)}.mp4`,
    ]) {
      expect(videoPfad(name), name).toBeNull();
    }
  });
});
