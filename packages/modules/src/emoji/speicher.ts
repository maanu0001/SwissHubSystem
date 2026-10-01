import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppError } from '@swisshub/shared';
import { UPLOAD_DIR } from '../branding/storage';
import { ERLAUBTE_ARTEN, type BildArt } from './bild';

/**
 * Wo die Bytes eines Vorschlags liegen.
 *
 * Dasselbe Verfahren wie bei den Antragsanhängen und dem Medienarchiv, und
 * bewusst kein zweites:
 *
 * 1. **Nichts liegt öffentlich.** Das Verzeichnis liegt ausserhalb von
 *    `public`. Der Weg zu einer Datei führt über eine Route, die vorher prüft,
 *    ob der Abrufende sie sehen darf.
 * 2. **Kein erratbarer Pfad.** Der Speichername entsteht aus Zufall, nie aus
 *    dem Namen beim Hochladen - ein Name aus fremder Hand wird hier nirgends zu
 *    einem Pfad.
 * 3. **Angenommen ist nicht aufbewahrt.** Sobald das Emoji auf Discord liegt,
 *    liegen die Bytes dort. Die Kopie hier wird gelöscht; der Eintrag bleibt
 *    und nennt die Emoji-Kennung.
 */

const UNTERORDNER = 'emoji';

function verzeichnis(): string {
  return join(resolve(UPLOAD_DIR), UNTERORDNER);
}

/**
 * Der absolute Pfad zu einer gespeicherten Datei - oder `null`.
 *
 * `null` heisst «nicht in diesem Verzeichnis». Der Name kommt aus der
 * Datenbank, also aus eigener Hand; geprüft wird er trotzdem. Ein
 * `../../etc/passwd` in einer Spalte ist unwahrscheinlich und wäre dann
 * genau einmal fatal.
 */
export function emojiDateiPfad(dateiName: string): string | null {
  if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/u.test(dateiName)) {
    return null;
  }
  const ziel = resolve(verzeichnis(), dateiName);
  return ziel.startsWith(resolve(verzeichnis()) + '/') ? ziel : null;
}

/** Bytes ablegen und den Speichernamen zurückgeben. */
export async function legeAb(bytes: Uint8Array, art: BildArt): Promise<string> {
  const endung = ERLAUBTE_ARTEN[art];
  const dateiName = `${randomBytes(16).toString('hex')}.${endung}`;
  try {
    await mkdir(verzeichnis(), { recursive: true });
    await writeFile(join(verzeichnis(), dateiName), bytes, { mode: 0o640 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new AppError('INTERNAL', {
      userMessage:
        code === 'ENOSPC'
          ? 'Auf dem Server ist kein Platz mehr frei.'
          : 'Das Upload-Verzeichnis auf dem Server ist nicht beschreibbar.',
      internalMessage: `${code ?? 'unbekannt'} beim Schreiben nach ${verzeichnis()}`,
    });
  }
  return dateiName;
}

/**
 * Die Bytes zurücklesen.
 *
 * `null` heisst «nicht mehr da» - und das ist der Normalfall bei einem
 * angenommenen Vorschlag, dessen Kopie aufgeräumt wurde. Wer hier würfe,
 * liesse eine Übersicht an einem erwarteten Zustand scheitern.
 */
export async function liesAb(dateiName: string): Promise<Uint8Array | null> {
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

/** Die Bytes wegräumen. Fehlt die Datei schon, ist das Ziel erreicht. */
export async function raeumeAuf(dateiName: string): Promise<void> {
  const pfad = emojiDateiPfad(dateiName);
  if (!pfad) {
    return;
  }
  await rm(pfad, { force: true });
}
