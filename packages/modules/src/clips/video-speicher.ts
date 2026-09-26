import { readdir, stat } from 'node:fs/promises';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { loescheUpload, schreibeUpload, uploadName, uploadPfad } from '../branding/storage';

const log = createLogger('clips:video');

/**
 * Hochgeladene Clipdateien.
 *
 * ## Kein eigenes Dateimanagement
 *
 * Das Ablegen, Auffinden und Löschen macht `branding/storage.ts` - dieselbe
 * zentrale Stelle, über die Logos, Levelkarten, Profilbanner und
 * Wrapped-Momente gehen, dasselbe Verzeichnis, dieselbe Namensdisziplin,
 * dieselbe Fehlerbehandlung für ein volles oder nicht beschreibbares
 * Verzeichnis. Hier steht nur, was an Video anders ist: welcher Container
 * zulässig ist, wie man ihn erkennt und wie gross eine Datei sein darf.
 *
 * Zwei Upload-Verzeichnisse wären zwei Dinge, die gesichert, überwacht und
 * beim Wiederherstellen bedacht werden müssten - und das zweite wäre das,
 * das man vergisst.
 *
 * ## Die Grundsätze der zentralen Stelle gelten unverändert
 *
 * Bei Video sogar strenger, weil die Dateien um Grössenordnungen grösser
 * sind:
 *
 *  - **Der Name entsteht serverseitig.** Zufall plus Endung aus dem erkannten
 *    Container. Der Name aus dem Browser wird verworfen; damit sind
 *    Pfadmanipulation und ausführbare Endungen ausgeschlossen, ohne dass
 *    irgendetwas bereinigt werden müsste.
 *  - **Der Typ wird an den Bytes erkannt**, nicht am `Content-Type` und nicht
 *    an der Endung. Beides kommt vom Browser und beides ist frei wählbar.
 *  - **Ausgeliefert wird über einen Route Handler** mit festem Content-Type.
 *    Das Verzeichnis liegt aussehalb von `public` und wird nie statisch
 *    bedient - eine als `.mp4` gespeicherte HTML-Datei könnte sonst als Seite
 *    auf der eigenen Domain laufen.
 *
 * ## Warum kein Transcoding
 *
 * Weil es hier nichts zu transcodieren gibt. MP4 mit H.264 und WebM mit
 * VP8/VP9 spielt jeder Browser der letzten zehn Jahre nativ; eine Umwandlung
 * würde Rechenzeit kosten, um ein Ergebnis zu erzeugen, das dem Eingang
 * gleicht.
 *
 * Wer eine Datei einreicht, die der Browser nicht abspielen kann - etwa MOV
 * mit ProRes -, bekommt sie abgelehnt. Das ist ehrlicher als eine
 * Umwandlungswarteschlange, die bei zwanzig Einreichungen am Freitagabend den
 * Server belegt und deren Ergebnis niemand prüft. Sollte Transcoding später
 * nötig werden, gehört es in einen eigenen, ressourcenbegrenzten Prozess und
 * nicht in diesen Aufruf.
 *
 * ## Warum kein Codec-Check
 *
 * Weil er nicht zuverlässig ginge. Der Container ist an den ersten Bytes
 * erkennbar, der Codec erst aus den Spurköpfen - und die vollständig zu
 * lesen hiesse, einen Demuxer zu schreiben. Ein halber Demuxer, der bei
 * ungewöhnlichen Dateien falsch liegt, wäre schlechter als der ehrliche
 * Hinweis an das Mitglied: es sieht in der Vorschau selbst, ob der Clip
 * läuft, bevor er eingereicht wird.
 */

/**
 * Die Vorgabe: 100 MB je Clip.
 *
 * Gross genug für eine Minute in 1080p, klein genug, dass zwanzig
 * Einreichungen einer Woche zusammen unter zwei Gigabyte bleiben. Der Wert
 * ist im Dashboard einstellbar; diese Konstante ist nur die Vorgabe.
 */
export const VIDEO_MAX_BYTES_VORGABE = 100 * 1024 * 1024;

/**
 * Die Obergrenze der Einstellung.
 *
 * Auch ein Administrator soll nicht 5 GB je Clip erlauben können: die Platte
 * ist geteilt, und ein volles Dateisystem nimmt die Datenbank mit. 500 MB ist
 * die Grenze, ab der eine Einreichung kein Clip mehr ist, sondern ein Film.
 */
export const VIDEO_MAX_BYTES_GRENZE = 500 * 1024 * 1024;

export type VideoContainer = 'mp4' | 'webm';

export const VIDEO_CONTENT_TYPE: Record<VideoContainer, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Was der Browser melden darf - muss zum erkannten Container passen. */
export const VIDEO_MIME_TYPES: Record<string, VideoContainer> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Den Container an den echten Bytes erkennen.
 *
 * ## MP4
 *
 * Ein MP4 beginnt mit einer Box: vier Bytes Länge, dann `ftyp`. Geprüft wird
 * `ftyp` an Position 4 - die Länge davor ist variabel und taugt nicht als
 * Signatur.
 *
 * Danach steht die Marke (`isom`, `mp42`, `avc1`, …). Sie wird gelesen, aber
 * nicht eingeschränkt: die Liste der Marken ist lang, wächst, und eine
 * unvollständige Liste würde gültige Dateien ablehnen. Dass es ein MP4 ist,
 * sagt `ftyp` schon.
 *
 * **`ftypqt  ` wird abgelehnt.** Das ist QuickTime - dieselbe Boxstruktur,
 * aber ein Container, den Browser nicht verlässlich abspielen. Ihn als MP4
 * durchzulassen hiesse, eine Datei zu speichern, die im Player schwarz bleibt.
 *
 * ## WebM
 *
 * WebM ist Matroska und beginnt mit dem EBML-Kopf `1A 45 DF A3`. Dieselbe
 * Signatur trägt auch eine `.mkv`-Datei; unterschieden wird über das
 * `DocType`-Feld, das kurz dahinter als Zeichenkette `webm` oder `matroska`
 * steht. Nur `webm` wird angenommen.
 */
export function erkenneContainer(bytes: Uint8Array): VideoContainer | null {
  if (bytes.length < 16) {
    return null;
  }

  // MP4: 'ftyp' an Position 4.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const marke = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    // QuickTime trägt dieselbe Struktur und ist kein MP4.
    if (marke === 'qt  ') {
      return null;
    }
    return 'mp4';
  }

  // WebM/Matroska: EBML-Kopf.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    /*
     * Das `DocType` steht in den ersten Bytes des Kopfes. Gesucht wird die
     * Zeichenkette in einem knappen Fenster - den EBML-Baum zu zerlegen wäre
     * für diese eine Auskunft unverhältnismässig, und weiter hinten stünden
     * beliebige Nutzdaten, in denen «webm» zufällig vorkommen kann.
     */
    const kopf = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64))).toString('latin1');
    if (kopf.includes('webm')) {
      return 'webm';
    }
    // Matroska ohne `webm`: eine .mkv-Datei. Browser spielen sie nicht zuverlässig.
    return null;
  }

  return null;
}

export interface GespeichertesVideo {
  dateiname: string;
  container: VideoContainer;
  bytes: number;
}

/**
 * Eine hochgeladene Clipdatei prüfen und ablegen.
 *
 * `maxBytes` kommt von aussen - aus der Moduleinstellung. Die Grenze wird
 * **hier** durchgesetzt und nicht im Browser: eine Prüfung im Formular ist
 * eine Bequemlichkeit für das Mitglied, keine Zusicherung.
 */
export async function speichereVideo(
  daten: Uint8Array,
  gemeldeterTyp: string | null,
  maxBytes: number,
): Promise<GespeichertesVideo> {
  if (daten.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }

  const grenze = Math.min(maxBytes, VIDEO_MAX_BYTES_GRENZE);
  if (daten.byteLength > grenze) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross - erlaubt sind ${Math.round(grenze / 1024 / 1024)} MB.`,
      internalMessage: `Video ${daten.byteLength} Bytes über der Grenze ${grenze}`,
    });
  }

  const container = erkenneContainer(daten);
  if (!container) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Nur MP4 und WebM werden unterstützt. MOV, MKV und AVI spielen Browser nicht zuverlässig ab - wandle den Clip vorher um.',
    });
  }

  /*
   * Der gemeldete Typ muss zum Inhalt passen, wenn er da ist.
   *
   * Nicht: er muss da sein. Manche Browser schicken bei Drag-and-drop einen
   * leeren `type`, und eine Datei abzulehnen, deren Bytes stimmen, wäre eine
   * Ablehnung aus Formgründen.
   */
  if (gemeldeterTyp && VIDEO_MIME_TYPES[gemeldeterTyp.toLowerCase()] !== container) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dateityp und Inhalt stimmen nicht überein.',
      internalMessage: `gemeldet ${gemeldeterTyp}, erkannt ${container}`,
    });
  }

  const dateiname = uploadName('clip', container);
  await schreibeUpload(dateiname, daten);

  log.info('Clipdatei gespeichert', { dateiname, container, bytes: daten.byteLength });
  return { dateiname, container, bytes: daten.byteLength };
}

/**
 * Die Namen, die `speichereVideo` erzeugt.
 *
 * Geprüft wird nicht, weil der Name von aussen käme - er steht in der
 * Datenbank -, sondern weil ein Tippfehler in einer Migration sonst zu einem
 * Pfad ausserhalb des Verzeichnisses würde. Ein Muster, das nur Hex und eine
 * bekannte Endung zulässt, macht daraus einen sauberen Fehlschlag.
 */
export const VIDEO_NAME_MUSTER = /^clip-[0-9a-f]{32}\.(mp4|webm)$/u;

/** Der geprüfte Pfad zu einer Clipdatei - oder `null`. */
export function videoPfad(dateiname: string): string | null {
  return uploadPfad(dateiname, VIDEO_NAME_MUSTER);
}

/** Der Container aus dem Dateinamen - für den Content-Type beim Ausliefern. */
export function videoContainer(dateiname: string): VideoContainer | null {
  const treffer = VIDEO_NAME_MUSTER.exec(dateiname);
  return treffer ? (treffer[1] as VideoContainer) : null;
}

export async function videoGroesse(dateiname: string): Promise<number | null> {
  const pfad = videoPfad(dateiname);
  if (!pfad) {
    return null;
  }
  try {
    return (await stat(pfad)).size;
  } catch {
    return null;
  }
}

/**
 * Wie alt eine Datei ist, in Millisekunden - `null`, wenn sie nicht da ist.
 *
 * Für das Aufräumen: eine Datei, die gerade erst geschrieben wurde, gehört
 * vermutlich zu einer Einreichung, die noch läuft.
 */
export async function videoAlterMs(dateiname: string, jetzt: Date): Promise<number | null> {
  const pfad = videoPfad(dateiname);
  if (!pfad) {
    return null;
  }
  try {
    return jetzt.getTime() - (await stat(pfad)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Alle abgelegten Clipdateien - für das Aufräumen.
 *
 * Nur Namen, die diesem Modul gehören: das Upload-Verzeichnis enthält auch
 * Logos, Levelkarten und Profilbanner, und ein Aufräumen, das die verwechselt,
 * wäre schlimmer als keines.
 */
export async function listeVideos(): Promise<string[]> {
  const { UPLOAD_DIR } = await import('../branding/storage');
  try {
    return (await readdir(UPLOAD_DIR)).filter((name) => VIDEO_NAME_MUSTER.test(name));
  } catch {
    // Verzeichnis noch nicht angelegt - dann gibt es auch nichts aufzuräumen.
    return [];
  }
}

/** Eine Clipdatei löschen. */
export async function loescheVideo(dateiname: string): Promise<void> {
  await loescheUpload(dateiname, VIDEO_NAME_MUSTER);
}
