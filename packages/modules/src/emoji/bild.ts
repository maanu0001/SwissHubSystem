import { createHash } from 'node:crypto';

/**
 * Was als Emoji-Bild durchgeht.
 *
 * ## Die Prüfung liest die Bytes, nicht den Namen
 *
 * Ein `Content-Type`-Header kommt von der Gegenstelle, eine Dateiendung vom
 * Hochladenden. Beide lassen sich behaupten. Was eine Datei ist, steht in ihren
 * ersten Bytes - und nur das wird hier geglaubt.
 *
 * Das ist nicht Theorie: eine `.png`, die eigentlich ein SVG ist, wäre ein
 * Dokument mit Skriptfähigkeit im Upload-Verzeichnis. Discord nähme sie nicht
 * an, aber bis dahin liegt sie auf dem Server.
 *
 * ## Discords Grenzen
 *
 * 256 KiB, und das ist eine harte Grenze der API. Die Kantenlänge begrenzt
 * Discord nicht ausdrücklich - es skaliert auf 128×128 herunter. Ein 4000er
 * Bild anzunehmen, das danach unleserlich ist, wäre trotzdem kein Dienst:
 * deshalb eine eigene, grosszügige Obergrenze und ein Hinweis statt einer
 * stillen Verkleinerung.
 */

/** Discords harte Grenze für ein Emoji. */
export const EMOJI_MAX_BYTES = 256 * 1024;

/** Ab hier wird gewarnt - Discord skaliert auf 128 Pixel herunter. */
export const EMOJI_EMPFOHLENE_KANTE = 128;

/** Die äusserste Kantenlänge, die noch angenommen wird. */
export const EMOJI_MAX_KANTE = 4096;

export type BildArt = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Erlaubte Arten - eine Positivliste.
 *
 * Kein SVG. Ein SVG ist ein Dokument, das Skripte und externe Verweise
 * enthalten kann; Discord nimmt es ohnehin nicht, und ein Ablageplatz dafür
 * entsteht hier nicht.
 */
export const ERLAUBTE_ARTEN: Record<BildArt, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface BildBefund {
  ok: boolean;
  grund?: string;
  art?: BildArt;
  animiert?: boolean;
  breite?: number | null;
  hoehe?: number | null;
  /** Ein Hinweis, der nichts verhindert - etwa «grösser als nötig». */
  hinweis?: string;
}

function liest(bytes: Uint8Array, start: number, laenge: number): Uint8Array | null {
  return bytes.length >= start + laenge ? bytes.subarray(start, start + laenge) : null;
}

function beginntMit(bytes: Uint8Array, muster: readonly number[], ab = 0): boolean {
  if (bytes.length < ab + muster.length) {
    return false;
  }
  return muster.every((wert, index) => bytes[ab + index] === wert);
}

/** Die Art eines Bildes an seinen ersten Bytes - oder `null`. */
export function erkenneArt(bytes: Uint8Array): BildArt | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (beginntMit(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (beginntMit(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a
  if (beginntMit(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (beginntMit(bytes, [0x52, 0x49, 0x46, 0x46]) && beginntMit(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/**
 * Ist das Bild animiert?
 *
 * Wichtig, weil Discord feste und animierte Emojis getrennt zählt: ein
 * animiertes auf einen festen Platz zu rechnen ergäbe eine Zahl, die nicht
 * stimmt, und einen Upload, der an einem vollen Kontingent scheitert.
 *
 * GIF: mehr als ein Bildsteuerblock (`21 F9 04`). Ein GIF mit genau einem ist
 * ein Einzelbild - Discord behandelt es auch so.
 *
 * WebP: die erweiterte Form (`VP8X`) mit gesetztem Animationsbit.
 */
export function istAnimiert(bytes: Uint8Array, art: BildArt): boolean {
  if (art === 'image/gif') {
    let gefunden = 0;
    for (let i = 0; i + 2 < bytes.length; i += 1) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) {
        gefunden += 1;
        if (gefunden > 1) {
          return true;
        }
      }
    }
    return false;
  }
  if (art === 'image/webp') {
    const kennung = liest(bytes, 12, 4);
    if (!kennung || String.fromCharCode(...kennung) !== 'VP8X') {
      return false;
    }
    // Im VP8X-Block ist Bit 1 des Flaggenbytes die Animation.
    const flaggen = bytes[20];
    return flaggen !== undefined && (flaggen & 0b0000_0010) !== 0;
  }
  return false;
}

/**
 * Die Kantenlängen - soweit sie sich aus dem Kopf lesen lassen.
 *
 * `null` heisst «nicht gelesen» und nicht «ungültig»: bei WebP in der
 * verlustbehafteten Grundform steckt die Grösse tiefer im Datenstrom, und
 * dafür eine Bildbibliothek zu laden wäre Aufwand für eine Zahl, die nur ein
 * Hinweis ist. Entscheidungen hängen daran nicht.
 */
export function maszeVon(bytes: Uint8Array, art: BildArt): { breite: number; hoehe: number } | null {
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (art === 'image/png' && bytes.length >= 24) {
    return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
  }
  if (art === 'image/gif' && bytes.length >= 10) {
    return { breite: sicht.getUint16(6, true), hoehe: sicht.getUint16(8, true) };
  }
  if (art === 'image/jpeg') {
    /*
     * JPEG ist eine Folge von Segmenten. Gesucht ist ein Start-of-Frame
     * (C0-CF, ohne die vier, die keine Rahmen sind); dort stehen die Masse.
     */
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marke = bytes[i + 1];
      if (marke === undefined) {
        break;
      }
      if (marke >= 0xc0 && marke <= 0xcf && marke !== 0xc4 && marke !== 0xc8 && marke !== 0xcc) {
        return { hoehe: sicht.getUint16(i + 5), breite: sicht.getUint16(i + 7) };
      }
      i += 2 + sicht.getUint16(i + 2);
    }
    return null;
  }
  if (art === 'image/webp' && bytes.length >= 30) {
    const kennung = liest(bytes, 12, 4);
    const name = kennung ? String.fromCharCode(...kennung) : '';
    if (name === 'VP8X') {
      // 24-Bit-Werte, jeweils minus eins gespeichert.
      const breite = 1 + (sicht.getUint16(24, true) | ((bytes[26] ?? 0) << 16));
      const hoehe = 1 + (sicht.getUint16(27, true) | ((bytes[29] ?? 0) << 16));
      return { breite, hoehe };
    }
    if (name === 'VP8L') {
      const roh = sicht.getUint32(21, true);
      return { breite: 1 + (roh & 0x3fff), hoehe: 1 + ((roh >> 14) & 0x3fff) };
    }
    return null;
  }
  return null;
}

/** Ein Bild annehmen oder ablehnen - mit Grund. */
export function pruefeBild(bytes: Uint8Array): BildBefund {
  if (bytes.length === 0) {
    return { ok: false, grund: 'Die Datei ist leer.' };
  }
  if (bytes.length > EMOJI_MAX_BYTES) {
    const kb = Math.round(bytes.length / 1024);
    return {
      ok: false,
      grund: `Discord nimmt höchstens ${Math.round(EMOJI_MAX_BYTES / 1024)} KB an - diese Datei hat ${kb} KB.`,
    };
  }

  const art = erkenneArt(bytes);
  if (!art) {
    return {
      ok: false,
      grund: 'Das ist kein PNG, JPEG, GIF oder WebP. Erkannt wird das an den Bytes, nicht an der Endung.',
    };
  }

  const animiert = istAnimiert(bytes, art);
  const masze = maszeVon(bytes, art);

  if (masze && (masze.breite > EMOJI_MAX_KANTE || masze.hoehe > EMOJI_MAX_KANTE)) {
    return {
      ok: false,
      grund: `Das Bild ist ${masze.breite}×${masze.hoehe} Pixel gross. Mehr als ${EMOJI_MAX_KANTE} Pixel Kantenlänge nimmt SwissHub nicht an.`,
      art,
      animiert,
    };
  }

  const hinweis =
    masze && (masze.breite > EMOJI_EMPFOHLENE_KANTE || masze.hoehe > EMOJI_EMPFOHLENE_KANTE)
      ? `Discord verkleinert auf ${EMOJI_EMPFOHLENE_KANTE}×${EMOJI_EMPFOHLENE_KANTE} Pixel. Feine Linien gehen dabei verloren.`
      : undefined;

  return {
    ok: true,
    art,
    animiert,
    breite: masze?.breite ?? null,
    hoehe: masze?.hoehe ?? null,
    ...(hinweis ? { hinweis } : {}),
  };
}

/**
 * Die Form, in der Discord ein Bild annimmt.
 *
 * Keine URL, kein Mehrteil-Upload - eine Data-URI. Genau deshalb müssen die
 * Bytes ohnehin durch diesen Prozess, und genau deshalb kann er sie vorher
 * prüfen. Wer Discord eine Adresse nennen könnte, hätte diese Prüfung nicht.
 */
export function alsDataUri(bytes: Uint8Array, art: BildArt): string {
  return `data:${art};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Die Prüfsumme, an der dasselbe Bild unter anderem Namen auffällt. */
export function pruefsummeVon(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
