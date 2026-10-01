import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '@swisshub/database';
import { UPLOAD_DIR } from '../branding/storage';
import { EMOJI_MAX_BYTES } from './bild';

/**
 * Wo die Bytes eines Vorschlags liegen: in der Datenbank.
 *
 * ## Warum nicht im Upload-Verzeichnis
 *
 * Weil der Bot dort nicht schreiben darf, und zwar mit Absicht. Das Volume ist
 * fuer ihn `:ro` gemountet - «schreiben tut ausschliesslich die WebApp», so
 * steht es in `docker-compose.prod.yml`, und das ist eine gute Regel: der Bot
 * liest dort Hintergrundbilder, er hat keinen Grund, Dateien anzulegen. Ein
 * Vorschlag aus `/emoji_request` lief deshalb in `EROFS` und meldete «Das
 * Upload-Verzeichnis auf dem Server ist nicht beschreibbar».
 *
 * Der naheliegende Ausweg waere, dem Bot das Volume schreibbar zu geben. Das
 * waere die falsche Richtung: eine Zusicherung aufgeben, um einen Sonderfall
 * zu bedienen. Die richtige Frage ist, warum diese Bytes ueberhaupt eine Datei
 * sind.
 *
 * ## Warum die Datenbank hier passt - und sonst nicht
 *
 * Normalerweise gehoeren Bilder nicht in eine Datenbank: sie sind grosse,
 * unbestimmte Mengen, sie blaehen Sicherungen auf und sie kommen in jeder
 * unbedachten Abfrage mit. Hier ist alle drei Sorgen gegenstandslos:
 *
 *  - **Gross sind sie nicht.** Discord nimmt ein Emoji nur bis 256 KiB an, und
 *    `pruefeBild` setzt diese Grenze durch, bevor hier etwas landet.
 *  - **Unbestimmt sind sie nicht.** Ein Vorschlag lebt Tage, nicht Jahre; die
 *    Bytes verschwinden, sobald entschieden ist.
 *  - **Mitkommen koennen sie nicht.** Sie liegen in `EmojiAntragBild`, einer
 *    eigenen Tabelle. Eine Liste von Vorschlaegen laedt sie nicht mit.
 *
 * Dafuer loest es das eigentliche Problem: Bot und WebApp teilen die Datenbank
 * ohnehin. Es gibt keinen zweiten Ort mehr, der eingerichtet, gemountet und
 * berechtigt sein muss - und keine Waisen-Datei, wenn ein Eintrag verschwindet.
 *
 * ## Der Altbestand
 *
 * Vorschlaege von vor der Umstellung haben ihre Bytes als Datei im
 * Upload-Verzeichnis, geschrieben von der WebApp. Sie werden weiterhin von dort
 * gelesen. Neu geschrieben wird dort nichts.
 */

/**
 * Was von einem Prisma-Client hier gebraucht wird.
 *
 * Strukturell und nicht der ganze Client: eine Transaktion (`tx`) hat kein
 * `$transaction`, und ein Typ, der es verlangte, liesse sich nicht mit einer
 * Transaktion aufrufen - genau dem Fall, fuer den der Parameter da ist.
 */
type BildSchreiber = Pick<typeof prisma, 'emojiAntragBild'>;

const UNTERORDNER = 'emoji';

function verzeichnis(): string {
  return join(resolve(UPLOAD_DIR), UNTERORDNER);
}

/**
 * Der absolute Pfad zu einer Datei des Altbestands - oder `null`.
 *
 * `null` heisst «nicht in diesem Verzeichnis». Der Name kommt aus der
 * Datenbank, also aus eigener Hand; geprueft wird er trotzdem. Ein
 * `../../etc/passwd` in einer Spalte ist unwahrscheinlich und waere dann genau
 * einmal fatal.
 */
export function emojiDateiPfad(dateiName: string): string | null {
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/u.test(dateiName)) {
    return null;
  }
  const ziel = resolve(verzeichnis(), dateiName);
  return ziel.startsWith(resolve(verzeichnis()) + '/') ? ziel : null;
}

/**
 * Bytes zu einem Vorschlag ablegen.
 *
 * `create` und nicht `upsert`: ein Vorschlag bekommt seine Bytes genau einmal,
 * beim Einreichen. Ein zweiter Aufruf waere ein Fehler im Ablauf und soll
 * auffallen, statt still zu ueberschreiben.
 */
export async function legeAb(
  antragId: string,
  bytes: Uint8Array,
  /**
   * Die laufende Transaktion, wenn der Eintrag gerade erst entstanden ist.
   *
   * Ohne sie wuerde dieser Schreibvorgang den Fremdschluessel auf eine Zeile
   * setzen, die aus seiner Sicht noch nicht existiert.
   */
  tx?: BildSchreiber,
): Promise<void> {
  if (bytes.byteLength > EMOJI_MAX_BYTES) {
    // Doppelt geprueft - `pruefeBild` tut es vorher schon. Diese Zusicherung
    // steht hier, weil die Spalte sie traegt: was hier durchkommt, ist klein.
    throw new Error(`Emoji-Bild zu gross: ${bytes.byteLength} > ${EMOJI_MAX_BYTES}`);
  }
  await (tx ?? prisma).emojiAntragBild.create({
    data: { antragId, daten: Buffer.from(bytes) },
  });
}

/**
 * Die Bytes eines Vorschlags zuruecklesen.
 *
 * `null` heisst «nicht mehr da» - und das ist der Normalfall bei einem
 * entschiedenen Vorschlag, dessen Bytes aufgeraeumt wurden. Wer hier wuerfe,
 * liesse eine Uebersicht an einem erwarteten Zustand scheitern.
 *
 * Erst die Datenbank, dann die Datei: der Altbestand liegt noch im
 * Upload-Verzeichnis, und ein Vorschlag von vorletzter Woche soll sich
 * weiterhin annehmen lassen.
 */
export async function liesAb(antragId: string, dateiName?: string | null): Promise<Uint8Array | null> {
  const reihe = await prisma.emojiAntragBild.findUnique({ where: { antragId } });
  if (reihe) {
    return new Uint8Array(reihe.daten);
  }
  return dateiName ? liesAltbestand(dateiName) : null;
}

/** Die Bytes einer Datei des Altbestands - oder `null`. */
async function liesAltbestand(dateiName: string): Promise<Uint8Array | null> {
  const pfad = emojiDateiPfad(dateiName);
  if (!pfad) {
    return null;
  }
  try {
    return new Uint8Array(await readFile(pfad));
  } catch {
    return null;
  }
}

/**
 * Die Bytes wegraeumen - in der Datenbank und, falls vorhanden, als Datei.
 *
 * Beides, weil ein Vorschlag des Altbestands beides haben kann: einen
 * Dateinamen aus der Zeit davor und keine Reihe. Fehlt eines von beiden, ist
 * das Ziel schon erreicht, also kein Fehler.
 *
 * Die Datei zu loeschen, scheitert im Bot an demselben `:ro`-Mount, das der
 * Anlass dieser Umstellung war - deshalb still: ein Aufraeumen, das nicht
 * gelingt, darf eine Annahme nicht zuruecknehmen. Die WebApp raeumt dieselbe
 * Datei beim naechsten Zugriff weg.
 */
export async function raeumeAuf(antragId: string, dateiName?: string | null): Promise<void> {
  await prisma.emojiAntragBild.deleteMany({ where: { antragId } });
  if (!dateiName) {
    return;
  }
  const pfad = emojiDateiPfad(dateiName);
  if (!pfad) {
    return;
  }
  await rm(pfad, { force: true }).catch(() => undefined);
}

/**
 * Ist der Speicher fuer Vorschlaege bereit?
 *
 * Nicht «gibt es die Tabelle» - das weiss Prisma -, sondern: antwortet die
 * Datenbank auf sie. Gefragt wird lesend, mit einer Kennung, die als Vorschlag
 * nie vorkommt: ein Schreibversuch braeuchte einen echten Vorschlag, und eine
 * Pruefung soll keine Zeile hinterlassen.
 *
 * `{ ok: false, grund }` statt eines Wurfs: der Aufrufer ist eine
 * Gesundheitspruefung, und die soll einen Satz anzeigen, nicht abbrechen. Ein
 * Speicher, der gerade nicht erreichbar ist, ist kein Grund fuer einen Bot,
 * der nicht mehr hochfaehrt - alles andere am Server laeuft ja weiter.
 */
export async function pruefeSpeicher(): Promise<{ ok: boolean; grund?: string }> {
  try {
    await prisma.emojiAntragBild.findUnique({
      where: { antragId: '__pruefung__' },
      select: { antragId: true },
    });
    return { ok: true };
  } catch (fehler) {
    return {
      ok: false,
      grund: `Die Tabelle der Vorschlagsbilder ist nicht erreichbar: ${
        fehler instanceof Error ? fehler.message : 'unbekannter Fehler'
      }`,
    };
  }
}
