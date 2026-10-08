import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';

const log = createLogger('branding:storage');

/**
 * Speicherung hochgeladener Branding-Dateien.
 *
 * Grundsätze:
 *  - Dateinamen werden ausschliesslich serverseitig erzeugt (Zufall + Endung
 *    aus dem erkannten Format). Der Name aus dem Browser wird nie verwendet -
 *    damit sind Path Traversal und ausführbare Endungen ausgeschlossen.
 *  - Der Typ wird an den echten Bytes erkannt, nicht am Content-Type-Header
 *    oder an der Endung.
 *  - Ausgeliefert wird über einen Route Handler mit festem Content-Type; das
 *    Verzeichnis liegt ausserhalb von `public` und wird nie statisch bedient.
 */
export const UPLOAD_DIR = process.env.SWISSHUB_UPLOAD_DIR ?? '/var/lib/swisshub/uploads';

/**
 * Die Vorgabe, wenn ein Aufrufer keine eigene Grenze mitgibt.
 *
 * Steht hier nur noch als Rueckfall - die wirklichen Grenzen stehen in
 * `UPLOAD_GRENZEN`, je Namensraum.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type LogoFormat = 'png' | 'jpeg' | 'webp';

export const ACCEPTED_MIME_TYPES: Record<string, LogoFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
};

const EXTENSION: Record<LogoFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

export const CONTENT_TYPE: Record<LogoFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Format anhand der Datei-Signatur bestimmen.
 *
 * SVG wird bewusst nicht unterstützt: eine SVG-Datei kann Skripte enthalten
 * und müsste dafür zuverlässig bereinigt werden. Solange diese Bereinigung
 * nicht existiert, ist das Weglassen die ehrlichere Lösung.
 */
export function detectImageFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length < 12) {
    return null;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Bildabmessungen aus dem Header lesen.
 *
 * Bewusst ohne Bildbibliothek: es genügt, offensichtlich unbrauchbare Uploads
 * (1x1-Pixel, riesige Dateien) abzulehnen. `null` bedeutet "nicht ermittelbar"
 * und ist kein Fehler.
 */
export function readImageSize(
  bytes: Uint8Array,
  format: LogoFormat,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (format === 'png') {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (format === 'webp' && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38) {
      // Nur das einfache VP8L/VP8X-Layout; sonst nicht ermittelbar.
      if (bytes[15] === 0x58) {
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width, height };
      }
      return null;
    }
    if (format === 'jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StoredUpload {
  /** Reiner Dateiname ohne Pfadanteile. */
  fileName: string;
  format: LogoFormat;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Kurzer Inhaltshash - dient als Cache-Busting-Parameter. */
  version: string;
}

/**
 * Namensraum eines Uploads.
 *
 * Der Präfix steckt im erzeugten Dateinamen und wird beim Lesen wieder
 * geprüft. Dadurch lässt sich ein Logo nicht als Levelkarten-Hintergrund
 * ausliefern und umgekehrt.
 */
export const UPLOAD_KINDS = [
  'logo',
  'levelcard',
  'usercard',
  'gamecover',
  'profilbanner',
  'wrappedmoment',
  /** Der TWINT-QR-Code eines kostenpflichtigen Kalendertermins. */
  'twintqr',
  /*
   * Hochgeladene Clipdateien.
   *
   * Sie sind um Groessenordnungen groesser als alles andere hier und tragen
   * andere Endungen - die Formatkenntnis liegt deshalb in
   * `clips/video-speicher.ts`. Der Namensraum steht trotzdem hier, weil es
   * genau eine Liste geben soll, die sagt, welche Praefixe im
   * Upload-Verzeichnis vorkommen duerfen.
   */
  'clip',
  /**
   * Anhaenge im Workspace.
   *
   * Dieselbe Pruefung wie jedes andere Bild hier: der erkannte Inhalt
   * entscheidet ueber die Endung, der Name aus dem Browser wird nie
   * verwendet. Damit ist eine ausfuehrbare Datei als Anhang strukturell
   * ausgeschlossen - es gibt keinen Weg, auf dem sie einen Namen bekaeme.
   */
  'workspace',
  /**
   * Die Symbolbilder des XP-Slots.
   *
   * Dieselbe Pruefung wie jedes andere Bild hier - PNG, JPG oder WEBP,
   * erkannt an den Bytes. Transparenz bleibt erhalten, weil nichts
   * umgewandelt wird.
   */
  'slotsymbol',
  /**
   * Die Klaenge des XP-Slots.
   *
   * Andere Endungen als die Bilder, deshalb liegt die Formatkenntnis in
   * `level/xpslot/klang-speicher.ts` - wie bei den Clipvideos. Der
   * Namensraum steht trotzdem hier, weil es genau eine Liste geben soll,
   * die sagt, welche Praefixe im Upload-Verzeichnis vorkommen duerfen.
   */
  'slotsound',
  /**
   * Bilder des Post Creators - Motiv, Hintergrund, Logo, Sponsorenzeichen.
   *
   * Dieselbe Pruefung wie jedes andere Bild hier: PNG, JPG oder WEBP, erkannt
   * an den Bytes. Ein eigener Namensraum und nicht `logo`, damit sich ein
   * Postmotiv von einem Serverlogo unterscheiden laesst - wer die Bilder eines
   * Moduls aufraeumt, soll nicht die eines anderen treffen.
   */
  'socialpost',
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Was ein Namensraum an Datei und an Massen zulaesst. */
export interface UploadGrenze {
  maxBytes: number;
  minSize: number;
  maxSize: number;
}

const MB = 1024 * 1024;

/**
 * Die Grenzen je Namensraum - an einer Stelle.
 *
 * ## Warum die Zahlen so aussehen
 *
 * Sie sind nicht grosszuegig, sie sind **realistisch**. Ein Bild, das heute
 * aus einem Grafikprogramm kommt, hat 3000 bis 6000 Pixel Kantenlaenge und
 * als PNG mit Transparenz schnell zweistellige Megabyte. Eine Grenze von
 * 2 MB lehnt damit nicht den Missbrauch ab, sondern den Normalfall - und der
 * Mensch davor haelt die Anwendung fuer kaputt, nicht seine Datei fuer gross.
 *
 * Nach oben begrenzt bleibt es trotzdem, und zwar verschieden je Zweck:
 *
 * - **socialpost** traegt die Last eines Exports in 1080 x 1920 und soll
 *   hochwertige Vorlagen annehmen - 40 MB und 8000 Pixel, fuer den
 *   Hintergrund 50 MB (siehe `SOCIALPOST_HINTERGRUND_BYTES`).
 * - **slotsymbol** sitzt im Spiel in einer Zelle von rund 100 Pixeln. Gross
 *   genug fuer jedes vernuenftige Original (12 MB, 4096 Pixel), aber kein
 *   Grund fuer ein Plakat.
 * - **twintqr** ist ein QR-Code. Vier Megabyte sind dafuer schon viel.
 * - **clip** und die beiden Altlasten-Importe stehen nicht hier: sie tragen
 *   keine Bilder und kennen ihre Grenzen selbst.
 *
 * ## Warum nicht einfach 100 MB fuer alles
 *
 * Weil die Grenze zwei Dinge zugleich tut: sie laesst den Normalfall durch
 * **und** sie sagt, was dieser Namensraum ist. «Bis 100 MB» sagt nichts.
 *
 * Diese Zahlen muessen ausserdem zu `middlewareClientMaxBodySize` in
 * `next.config.ts` passen - sonst kappt Next den Koerper, bevor die Pruefung
 * hier ihn je sieht. Ein Test haelt beides zusammen.
 */
export const UPLOAD_GRENZEN: Readonly<Record<UploadKind, UploadGrenze>> = {
  logo: { maxBytes: 8 * MB, minSize: 16, maxSize: 4096 },
  levelcard: { maxBytes: 16 * MB, minSize: 100, maxSize: 6000 },
  usercard: { maxBytes: 16 * MB, minSize: 100, maxSize: 6000 },
  gamecover: { maxBytes: 12 * MB, minSize: 64, maxSize: 4096 },
  profilbanner: { maxBytes: 12 * MB, minSize: 400, maxSize: 6000 },
  wrappedmoment: { maxBytes: 16 * MB, minSize: 400, maxSize: 8000 },
  twintqr: { maxBytes: 4 * MB, minSize: 120, maxSize: 4096 },
  // Traegt keine Bilder - die Grenze steht in `clips/video-speicher.ts`.
  clip: { maxBytes: 8 * MB, minSize: 16, maxSize: 4096 },
  workspace: { maxBytes: 16 * MB, minSize: 16, maxSize: 8000 },
  slotsymbol: { maxBytes: 12 * MB, minSize: 32, maxSize: 4096 },
  // Traegt keine Bilder - die Grenzen stehen in `xpslot/klang-speicher.ts`.
  slotsound: { maxBytes: 8 * MB, minSize: 16, maxSize: 4096 },
  socialpost: { maxBytes: 40 * MB, minSize: 64, maxSize: 8000 },
};

/**
 * Der Hintergrund eines Posts - die eine Ausnahme nach oben.
 *
 * ## Warum ueberhaupt eine Ausnahme
 *
 * Ein Motiv, ein Logo, ein Partnerzeichen sind Ausschnitte. Ein Hintergrund
 * ist die ganze Flaeche: er fuellt 1080 x 1920 vollstaendig aus, traegt
 * Verlaeufe ueber die komplette Diagonale und kommt deshalb regelmaessig als
 * unkomprimiertes Original aus dem Grafikprogramm. Das sind die Dateien, die
 * an einer Grenze haengenbleiben, die fuer ein Logo gedacht war.
 *
 * ## Warum kein eigener Namensraum
 *
 * Weil der Namensraum im Dateinamen steckt und entscheidet, als was eine
 * Datei ausgeliefert werden darf. Ein Hintergrund **ist** ein Postbild - er
 * soll im selben Topf liegen, von derselben Aufraeumung erfasst werden und
 * durch dieselbe Pruefung gehen. Verschieden ist genau eine Zahl, und die
 * steht hier, neben der Tabelle, statt verstreut an der Aufrufstelle.
 */
export const SOCIALPOST_HINTERGRUND_BYTES = 50 * MB;

/**
 * Die groesste Bilddatei, die irgendein Namensraum annimmt.
 *
 * Die Ausnahme oben zaehlt mit: `middlewareClientMaxBodySize` muss ueber
 * **allem** liegen, was eine Route annehmen kann, nicht nur ueber dem
 * Tabellenwert. Ein Test haelt beides zusammen.
 */
export const GROESSTE_BILDGRENZE = Math.max(
  SOCIALPOST_HINTERGRUND_BYTES,
  ...Object.values(UPLOAD_GRENZEN).map((grenze) => grenze.maxBytes),
);

/**
 * Ein neuer Dateiname.
 *
 * Zufall plus die Endung, die aus dem **erkannten** Inhalt kommt. Der Name
 * aus dem Browser wird nie verwendet: damit sind Pfadmanipulation und
 * ausführbare Endungen ausgeschlossen, ohne dass irgendetwas bereinigt
 * werden müsste.
 */
export function uploadName(kind: UploadKind, extension: string): string {
  return `${kind}-${randomBytes(16).toString('hex')}.${extension}`;
}

/**
 * Der geprüfte absolute Pfad zu einer Datei im Upload-Verzeichnis.
 *
 * `muster` beschreibt die Namen, die der Aufrufer selbst erzeugt - Bilder und
 * Videos haben verschiedene Endungen, aber dieselbe Namensdisziplin. Danach
 * noch die Einschlussprüfung über `resolve`: ein Muster kann irren, ein
 * Pfadvergleich nicht.
 *
 * `null` heisst «dieser Name gehört nicht hierher» - nie ein Pfad, der
 * ausserhalb liegt.
 */
export function uploadPfad(fileName: string, muster: RegExp): string | null {
  if (!muster.test(fileName)) {
    return null;
  }
  const ziel = resolve(UPLOAD_DIR, fileName);
  return ziel.startsWith(resolve(UPLOAD_DIR) + '/') ? ziel : null;
}

/**
 * Schreibt eine Datei in das Upload-Verzeichnis.
 *
 * Die Fehlerbehandlung ist der Grund, warum das hier steht und nicht an jeder
 * Aufrufstelle: die drei Fälle unten sind die, die im Betrieb wirklich
 * auftreten, und sie sind ohne Meldung kaum zu erraten.
 */
export async function schreibeUpload(fileName: string, data: Uint8Array): Promise<void> {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    // `mode` 0o640: lesbar für den Dienst, für niemanden ausführbar.
    await writeFile(join(UPLOAD_DIR, fileName), data, { mode: 0o640 });
  } catch (error) {
    // Der häufigste Fall im Betrieb: das Verzeichnis existiert, gehört aber
    // root (frisch angelegtes Docker-Volume), während der Dienst als
    // unprivilegierter Benutzer läuft. Ohne diese Meldung wäre nur ein
    // generischer Fehler sichtbar und die Ursache kaum zu erraten.
    const code = (error as NodeJS.ErrnoException).code;
    log.error('Upload-Verzeichnis nicht beschreibbar', { error, uploadDir: UPLOAD_DIR, code });

    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new AppError('INTERNAL', {
        userMessage:
          'Das Upload-Verzeichnis auf dem Server ist nicht beschreibbar. Bitte die Rechte von SWISSHUB_UPLOAD_DIR prüfen.',
        internalMessage: `${code} beim Schreiben nach ${UPLOAD_DIR}`,
      });
    }
    if (code === 'ENOSPC') {
      throw new AppError('INTERNAL', {
        userMessage: 'Auf dem Server ist kein Speicherplatz mehr frei.',
        internalMessage: `ENOSPC beim Schreiben nach ${UPLOAD_DIR}`,
      });
    }
    throw new AppError('INTERNAL', {
      userMessage: 'Die Datei konnte auf dem Server nicht gespeichert werden.',
      internalMessage: `${code ?? 'unbekannt'} beim Schreiben nach ${UPLOAD_DIR}`,
    });
  }
}

/**
 * Löscht eine Datei - still, wenn sie nicht da ist.
 *
 * Denn das ist der Zustand, den der Aufrufer herstellen wollte. Ein Fehler
 * hier würde eine Löschung in der Datenbank zurückrollen und einen Eintrag
 * stehen lassen, den niemand mehr sehen soll.
 */
export async function loescheUpload(fileName: string, muster: RegExp): Promise<void> {
  const ziel = uploadPfad(fileName, muster);
  if (!ziel) {
    log.warn('Upload mit unerwartetem Namen nicht geloescht', { fileName });
    return;
  }
  try {
    await rm(ziel, { force: true });
  } catch (error) {
    log.warn('Upload liess sich nicht loeschen', { fileName, error });
  }
}

/**
 * Speichert einen Upload und gibt den erzeugten Dateinamen zurück.
 * Wirft `VALIDATION_FAILED`, wenn die Datei nicht akzeptiert wird.
 */
export async function storeLogoUpload(
  data: Uint8Array,
  declaredMimeType: string | null,
  kind: UploadKind = 'logo',
  limits: { maxBytes?: number; minSize?: number; maxSize?: number } = {},
): Promise<StoredUpload> {
  if (data.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }
  /*
   * Die Grenze kommt aus der Tabelle - der Aufrufer darf sie uebersteuern.
   *
   * Vorher stand in jeder Aufrufstelle eine eigene Zahl, und sie wichen
   * voneinander ab, ohne dass irgendwo stand warum: 2 MB fuer ein
   * Slot-Symbol, 8 fuer ein Postmotiv, 5 fuer einen Anhang. Jetzt steht die
   * Zahl bei dem Namensraum, zu dem sie gehoert.
   */
  const grenze = UPLOAD_GRENZEN[kind];
  const maxBytes = limits.maxBytes ?? grenze?.maxBytes ?? MAX_UPLOAD_BYTES;
  if (data.byteLength > maxBytes) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross. Maximal erlaubt: ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    });
  }

  // Der echte Inhalt entscheidet - der gemeldete Content-Type muss lediglich
  // dazu passen. Eine als PNG deklarierte HTML-Datei fällt hier durch.
  const format = detectImageFormat(data);
  if (!format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur PNG, JPG und WEBP werden unterstützt.',
    });
  }
  if (declaredMimeType && ACCEPTED_MIME_TYPES[declaredMimeType.toLowerCase()] !== format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dateityp und Inhalt stimmen nicht überein.',
    });
  }

  const minSize = limits.minSize ?? grenze?.minSize ?? 16;
  const maxSize = limits.maxSize ?? grenze?.maxSize ?? 4096;
  const size = readImageSize(data, format);
  if (size && (size.width < minSize || size.height < minSize)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Bild ist zu klein (mindestens ${minSize}x${minSize}).`,
    });
  }
  if (size && (size.width > maxSize || size.height > maxSize)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Bild ist zu gross (maximal ${maxSize}x${maxSize}).`,
    });
  }

  const fileName = uploadName(kind, EXTENSION[format]);
  await schreibeUpload(fileName, data);

  const version = createHash('sha256').update(data).digest('hex').slice(0, 12);
  log.info('Upload gespeichert', { fileName, bytes: data.byteLength, format, kind });

  return {
    fileName,
    format,
    bytes: data.byteLength,
    width: size?.width ?? null,
    height: size?.height ?? null,
    version,
  };
}

/**
 * Liest eine gespeicherte Datei.
 *
 * Der Dateiname wird streng geprüft und der aufgelöste Pfad muss innerhalb des
 * Upload-Verzeichnisses liegen - `../` kann damit nicht ausbrechen.
 *
 * ## Warum ein unmoeglicher Name `null` ergibt und keinen Fehler
 *
 * Weil der Rueckgabewert schon sagt, was hier schiefgehen kann: «die Datei
 * gibt es nicht». Ein Name, der nicht hierher gehoert, ist derselbe Fall -
 * und zwar aus Sicht jedes Aufrufers.
 *
 * Gemessen am gebauten Server: `/api/social-media/asset/..%2f..%2fetc%2fpasswd`
 * antwortete mit **500**. Ausgebrochen ist nichts, die Pruefung hielt - sie
 * warf nur, und niemand fing es. Ein 500 auf eine fremde Eingabe ist zweimal
 * falsch: die Person sieht einen Serverfehler statt «gibt es nicht», und
 * jeder Versuch hinterlaesst eine Fehlerzeile mit Stapelabbild im Protokoll.
 * Wer genug davon abschickt, fuellt damit die Platte.
 *
 * Dass ein Test den Fehler bereits mit `.catch(() => null)` umging, war der
 * Hinweis darauf, dass die Form nicht stimmte.
 */
export async function readUpload(fileName: string): Promise<{ data: Buffer; format: LogoFormat } | null> {
  let format: LogoFormat;
  try {
    format = assertSafeFileName(fileName);
  } catch {
    return null;
  }
  const target = resolve(UPLOAD_DIR, fileName);
  if (!target.startsWith(resolve(UPLOAD_DIR) + '/')) {
    return null;
  }
  try {
    return { data: await readFile(target), format };
  } catch {
    return null;
  }
}

/**
 * Die groesste Pixelzahl, die ein Dekoder hier anfassen darf.
 *
 * 8000 x 8000 ist das, was `UPLOAD_GRENZEN` an Kantenlaenge zulaesst - mehr
 * kann gar nicht gespeichert worden sein. Die Zahl steht trotzdem hier, weil
 * sie eine **zweite** Verteidigung ist: eine Datei kann klein sein und sich
 * beim Entpacken zu etwas Riesigem ausdehnen (eine Dekompressionsbombe), und
 * dann entscheidet nicht die Byte-Grenze, sondern diese.
 */
const MAX_DEKODIER_PIXEL = 64_000_000;

/**
 * Ein Bild in Exportgroesse - nicht das Original.
 *
 * ## Warum es das gibt
 *
 * Weil ein Export die Bytes **im Speicher** traegt. Satori bekommt keine
 * Adresse, sondern eine `data:`-URI (siehe `socialmedia/bilder.ts`), und eine
 * solche URI ist base64 - also ein Drittel groesser als die Datei. Ein Post
 * kann elf Bilder fuehren: Motiv, Hintergrund, Logo, zwei Teamzeichen, das
 * Signet und bis zu sechs Partnerzeichen. Bei 40 bis 50 MB je Datei waeren
 * das im schlimmsten Fall ueber ein halbes Gigabyte an Zeichenketten, und
 * dazu je Bild die entpackte Bitmap: 8000 x 8000 Pixel sind 256 MB, ganz
 * gleich, wie klein die Datei war.
 *
 * Das ist der Grund, warum eine hoehere Upload-Grenze nicht allein eine
 * groessere Zahl sein kann. Angenommen wird das Original - gezeichnet wird
 * mit einem Abbild in der Groesse, die der Export ueberhaupt nutzen kann.
 *
 * ## Warum 2160 Pixel
 *
 * Der groesste Export ist 1080 x 1920. Das Doppelte deckt jeden Zuschnitt
 * und jede Vergroesserung innerhalb der Flaeche ab; darueber liegende Pixel
 * sind Bytes, die niemand je sieht. `withoutEnlargement` sorgt dafuer, dass
 * ein kleineres Bild nicht kuenstlich aufgeblasen wird - es bleibt, wie es
 * ist, und geht denselben Weg wie vorher.
 *
 * ## Was bei einem Fehler geschieht
 *
 * Das Original. Ein Bild nicht zu zeichnen, weil die Verkleinerung
 * gescheitert ist, waere ein Rueckschritt gegenueber dem Zustand davor - und
 * der Aufrufer hat bereits einen Weg fuer «kein Bild», aber keinen fuer
 * «halbes Bild».
 */
export async function leseBildFuerExport(
  fileName: string,
  maxKante = 2160,
): Promise<{ data: Buffer; format: LogoFormat } | null> {
  const datei = await readUpload(fileName);
  if (!datei) {
    return null;
  }
  try {
    // Erst hier laden: `sharp` ist ein natives Modul, und es soll nicht beim
    // Hochfahren im Weg stehen, wenn nie jemand exportiert.
    const { default: sharp } = await import('sharp');
    const bild = sharp(datei.data, { limitInputPixels: MAX_DEKODIER_PIXEL });
    const masse = await bild.metadata();
    if ((masse.width ?? 0) <= maxKante && (masse.height ?? 0) <= maxKante) {
      return datei;
    }
    const verkleinert = await bild
      .resize({ width: maxKante, height: maxKante, fit: 'inside', withoutEnlargement: true })
      .toFormat(datei.format === 'jpeg' ? 'jpeg' : datei.format)
      .toBuffer();
    return { data: verkleinert, format: datei.format };
  } catch (error) {
    log.warn('Bild liess sich nicht verkleinern - Original wird verwendet', { fileName, error });
    return datei;
  }
}

export async function deleteUpload(fileName: string): Promise<void> {
  try {
    assertSafeFileName(fileName);
  } catch {
    return;
  }
  const target = resolve(UPLOAD_DIR, fileName);
  if (!target.startsWith(resolve(UPLOAD_DIR) + '/')) {
    return;
  }
  await rm(target, { force: true });
}

/**
 * Erlaubt ausschliesslich die selbst erzeugten Namen.
 *
 * Exportiert, damit andere Module gegen **diese** Pruefung pruefen koennen,
 * statt eine eigene zu schreiben: der Post Creator nimmt Bildnamen aus einem
 * Formular an und muss wissen, ob sie aus diesem Verzeichnis stammen. Eine
 * zweite Pruefung waere die, die beim naechsten neuen Namensraum nicht
 * nachgezogen wird.
 */
export function assertSafeFileName(fileName: string): LogoFormat {
  // Der Namensraum steht in `UPLOAD_KINDS`; die Pruefung leitet sich davon
  // ab, damit ein neuer Namensraum nicht an zwei Stellen nachgetragen werden
  // muss - und die zweite dann vergessen wird.
  const match = new RegExp(`^(${UPLOAD_KINDS.join('|')})-[0-9a-f]{32}\\.(png|jpg|webp)$`, 'u').exec(fileName);
  if (!match) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Ungültiger Dateiname.' });
  }
  const extension = match[2];
  return extension === 'jpg' ? 'jpeg' : (extension as LogoFormat);
}

/**
 * Laesst sich im Upload-Verzeichnis schreiben?
 *
 * ## Warum das eine eigene Frage ist
 *
 * Weil die Antwort einmal «nein» war und man es erst erfuhr, als jemand etwas
 * hochladen wollte. Die haeufige Ursache steht oben bei `schreibeUpload`: ein
 * frisch angelegtes Docker-Volume gehoert root, der Dienst laeuft
 * unprivilegiert. Das ist in einer Minute behoben - aber nur, wenn es jemand
 * sieht, und niemand sieht es, solange niemand hochlaedt.
 *
 * ## Warum sie nichts abbricht und nichts schreibt
 *
 * `access` und keine Probedatei: eine Pruefung soll nichts hinterlassen. Und
 * sie wirft nicht, weil ein nicht beschreibbares Verzeichnis ein Grund fuer
 * einen Hinweis in der Oberflaeche ist und nicht fuer einen Prozess, der nicht
 * mehr hochfaehrt - der Rest des Servers funktioniert ja.
 *
 * ## Im Bot ist «nein» die richtige Antwort
 *
 * Dort ist das Volume absichtlich nur lesbar gemountet: der Bot liest
 * Hintergrundbilder, geschrieben wird ausschliesslich von der WebApp. Diese
 * Funktion gehoert deshalb in eine Pruefung der WebApp; im Bot waere ihr
 * «nein» kein Fehler, sondern die Zusicherung.
 */
export async function uploadVerzeichnisBeschreibbar(): Promise<{ ok: boolean; pfad: string }> {
  const pfad = resolve(UPLOAD_DIR);
  try {
    // Erst anlegen: fehlt es noch, ist «nicht beschreibbar» keine Auskunft
    // ueber die Rechte, sondern nur darueber, dass noch nichts da ist.
    await mkdir(pfad, { recursive: true });
    await access(pfad, constants.W_OK);
    return { ok: true, pfad };
  } catch {
    return { ok: false, pfad };
  }
}
