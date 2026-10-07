import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { loescheUpload, schreibeUpload, uploadName, uploadPfad } from '../../branding/storage';

const log = createLogger('level:xpslot:klang');

/**
 * Die Klaenge des XP-Slots.
 *
 * ## Kein zweites Dateimanagement
 *
 * Das Ablegen, Auffinden und Loeschen macht `branding/storage.ts` - dieselbe
 * zentrale Stelle, ueber die Logos, Levelkarten, Profilbanner, Wrapped-
 * Momente und Clipvideos gehen, dasselbe Verzeichnis, dieselbe
 * Namensdisziplin, dieselbe Fehlerbehandlung fuer ein volles oder nicht
 * beschreibbares Verzeichnis. Hier steht nur, was an Ton anders ist: welche
 * Container zulaessig sind, wie man sie erkennt und wie gross eine Datei sein
 * darf. Genau dieselbe Aufteilung wie bei `clips/video-speicher.ts`.
 *
 * ## Die Grundsaetze der zentralen Stelle gelten unveraendert
 *
 *  - **Der Name entsteht serverseitig.** Zufall plus Endung aus dem erkannten
 *    Container. Der Name aus dem Browser wird verworfen; damit sind
 *    Pfadmanipulation und ausfuehrbare Endungen ausgeschlossen, ohne dass
 *    irgendetwas bereinigt werden muesste.
 *  - **Der Typ wird an den Bytes erkannt**, nicht am `Content-Type` und nicht
 *    an der Endung. Beides kommt vom Browser und beides ist frei waehlbar.
 *  - **Ausgeliefert wird ueber einen Route Handler** mit festem Content-Type.
 *    Das Verzeichnis liegt ausserhalb von `public` und wird nie statisch
 *    bedient - eine als `.mp3` gespeicherte HTML-Datei koennte sonst als
 *    Seite auf der eigenen Domain laufen.
 *
 * ## Warum kein SVG und kein MIDI
 *
 * Dieselbe Begruendung wie bei den Bildern: ein Format, das Skripte oder
 * Verweise enthalten kann, muesste zuverlaessig bereinigt werden. Solange
 * diese Bereinigung nicht existiert, ist das Weglassen die ehrlichere
 * Loesung. Was bleibt, spielt jeder Browser der letzten zehn Jahre nativ.
 */

/** 3 MB je Klang - genug fuer einen Jingle, zu wenig fuer ein Album. */
export const KLANG_MAX_BYTES = 3 * 1024 * 1024;

/**
 * 8 MB fuer die Schleifen.
 *
 * Hintergrundmusik und die Freispielmusik laufen als Schleife und sind
 * deshalb laenger. Die groessere Grenze gilt nur fuer diese beiden Slots -
 * ein Walzenstopp braucht keine acht Megabyte.
 */
export const MUSIK_MAX_BYTES = 8 * 1024 * 1024;

export type KlangFormat = 'mp3' | 'ogg' | 'wav' | 'm4a';

export const KLANG_CONTENT_TYPE: Record<KlangFormat, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/** Die Endung, unter der eine Datei abgelegt wird. */
const ENDUNG: Record<KlangFormat, string> = { mp3: 'mp3', ogg: 'ogg', wav: 'wav', m4a: 'm4a' };

export const KLANG_MIME_TYPES: Record<string, KlangFormat> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
};

/**
 * Format anhand der Datei-Signatur.
 *
 * Dieselbe Erkennung wie `clips/video-speicher.erkenneTonformat`, hier aber
 * mit dem Container als Rueckgabe statt mit einem Namen fuer eine Meldung -
 * und mit einer Unterscheidung, die dort fehlt: eine MP4-Datei mit Bildspur
 * wird abgelehnt, denn ein Walzenstopp ist kein Video.
 */
export function erkenneKlangformat(bytes: Uint8Array): KlangFormat | null {
  if (bytes.length < 12) {
    return null;
  }
  const anfang = Buffer.from(bytes.subarray(0, 12)).toString('latin1');

  // WAV: 'RIFF' .... 'WAVE'.
  if (anfang.startsWith('RIFF') && anfang.slice(8, 12) === 'WAVE') {
    return 'wav';
  }
  // MP3: ID3-Kopf oder direkt ein Frame-Synchronisationswort.
  if (anfang.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) {
    return 'mp3';
  }
  // Ogg - Vorbis oder Opus.
  if (anfang.startsWith('OggS')) {
    return 'ogg';
  }
  /*
   * M4A ist ein MP4-Container mit nur einer Tonspur und traegt die Marke
   * `M4A `. Ein gewoehnliches MP4 (`isom`, `mp42`) faellt hier durch: es
   * koennte eine Bildspur haben, und die wuerde ein `<audio>`-Element still
   * ignorieren - eine Datei, die laedt und nichts tut.
   */
  if (anfang.slice(4, 8) === 'ftyp' && anfang.slice(8, 12).startsWith('M4A')) {
    return 'm4a';
  }
  return null;
}

export interface GespeicherterKlang {
  dateiname: string;
  format: KlangFormat;
  bytes: number;
}

/** Speichert einen Klang und gibt den erzeugten Dateinamen zurueck. */
export async function speichereKlang(
  data: Uint8Array,
  gemeldeterTyp: string | null,
  grenze: number = KLANG_MAX_BYTES,
): Promise<GespeicherterKlang> {
  if (data.byteLength === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Datei ist leer.' });
  }
  if (data.byteLength > grenze) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Datei ist zu gross (maximal ${Math.round(grenze / 1024 / 1024)} MB).`,
    });
  }

  const format = erkenneKlangformat(data);
  if (!format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur MP3, OGG, WAV und M4A werden unterstützt.',
    });
  }
  /*
   * Der gemeldete Typ muss zum erkannten passen.
   *
   * Nicht, weil der Header vertrauenswuerdig waere - er entscheidet nichts.
   * Aber ein Widerspruch zwischen Header und Inhalt ist ein Hinweis darauf,
   * dass etwas anderes hochgeladen wird als gedacht, und dann ist eine
   * Absage richtiger als ein Klang, den niemand erwartet hat.
   */
  if (gemeldeterTyp && KLANG_MIME_TYPES[gemeldeterTyp.toLowerCase()] !== format) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dateityp und Inhalt stimmen nicht überein.',
    });
  }

  const dateiname = uploadName('slotsound', ENDUNG[format]);
  await schreibeUpload(dateiname, data);
  log.info('Klang gespeichert', { dateiname, bytes: data.byteLength, format });

  return { dateiname, format, bytes: data.byteLength };
}

/** Die Namen, die diese Anwendung fuer Klaenge erzeugt. */
export const KLANG_NAME_MUSTER = /^slotsound-[0-9a-f]{32}\.(mp3|ogg|wav|m4a)$/u;

export function klangPfad(dateiname: string): string | null {
  return uploadPfad(dateiname, KLANG_NAME_MUSTER);
}

export function klangFormat(dateiname: string): KlangFormat | null {
  const treffer = KLANG_NAME_MUSTER.exec(dateiname);
  return treffer ? (treffer[1] as KlangFormat) : null;
}

export async function loescheKlang(dateiname: string): Promise<void> {
  await loescheUpload(dateiname, KLANG_NAME_MUSTER);
}

/** Die Namen, die diese Anwendung fuer Symbolbilder erzeugt. */
export const SYMBOLBILD_MUSTER = /^slotsymbol-[0-9a-f]{32}\.(png|jpg|webp)$/u;

export function symbolbildPfad(dateiname: string): string | null {
  return uploadPfad(dateiname, SYMBOLBILD_MUSTER);
}

export async function loescheSymbolbild(dateiname: string): Promise<void> {
  await loescheUpload(dateiname, SYMBOLBILD_MUSTER);
}

/**
 * Welche dieser Symbolbilder liegen nicht mehr auf der Platte?
 *
 * ## Der Fehler, den das behebt
 *
 * Ein Symbol mit einer Bildreferenz, deren Datei fehlt, war dauerhaft kaputt:
 * die Ausliefer-Route antwortet mit 404, der Browser zeigt ein leeres Feld,
 * und der Rueckfall auf das mitgelieferte Standardbild greift nie - er haengt
 * daran, dass **keine** Referenz da ist, nicht daran, dass sie ins Leere
 * zeigt. Nachgestellt, indem eine Datei weggenommen wurde: 404, und das
 * Symbol blieb leer, waehrend die uebrigen weiterliefen. Genau das Bild von
 * «es funktionieren nicht mehr alle».
 *
 * Eine Referenz ins Leere entsteht leichter, als es klingt: ein Upload-Ordner,
 * der neu angelegt wurde, eine Datei, die beim Aufraeumen mitging, eine
 * Wiederherstellung der Datenbank ohne die Dateien daneben.
 *
 * ## Warum pruefen und nicht reparieren
 *
 * Diese Funktion loescht nichts. Sie sagt nur, was fehlt - die Oberflaeche
 * entscheidet dann: das Spiel nimmt das Standardbild, die Verwaltung sagt es
 * ausdruecklich. Eine Referenz stillschweigend aus der Datenbank zu raeumen
 * waere derselbe Fehler in Gruen: dann waere das eigene Bild weg, und niemand
 * wuesste, dass es je eines gab.
 */
export async function fehlendeSymbolbilder(
  dateinamen: ReadonlyArray<string | null | undefined>,
): Promise<Set<string>> {
  const zuPruefen = [...new Set(dateinamen.filter((name): name is string => Boolean(name)))];
  const fehlend = new Set<string>();
  await Promise.all(
    zuPruefen.map(async (name) => {
      const pfad = symbolbildPfad(name);
      if (!pfad) {
        // Ein Name, den diese Anwendung nie erzeugt hat - der ist ebenso
        // wenig auslieferbar wie eine fehlende Datei.
        fehlend.add(name);
        return;
      }
      try {
        await access(pfad, constants.R_OK);
      } catch {
        fehlend.add(name);
      }
    }),
  );
  return fehlend;
}
