import 'server-only';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@swisshub/logger';
import type { BackupLauf, BackupZustand, ControllerErgebnis, Wiederherstellungspunkt } from './typen';

const log = createLogger('backup:zustand');

/**
 * Wo die Backup-Anlage ihren Zustand ablegt.
 *
 * Die WebApp liest hier ausschliesslich. Bei Docker ist das Verzeichnis
 * schreibgeschuetzt eingehaengt (`:ro`) - damit ist «nur lesen» nicht eine
 * Absicht dieses Codes, sondern eine Eigenschaft der Umgebung.
 */
export const ZUSTAND_DIR = process.env.SWISSHUB_BACKUP_STATE_DIR ?? '/var/lib/swisshub-backup/state';

/**
 * Wohin die WebApp eine Anforderung legt.
 *
 * Das EINZIGE Verzeichnis, in das sie schreiben darf. Siehe den Kopf von
 * `deploy/backup/bin/swisshub-backup-controller`.
 */
export const EINGANG_DIR = process.env.SWISSHUB_BACKUP_SPOOL_DIR ?? '/var/lib/swisshub-backup/spool/eingang';

export const ERGEBNIS_DIR =
  process.env.SWISSHUB_BACKUP_RESULT_DIR ?? '/var/lib/swisshub-backup/spool/ergebnis';

/**
 * Eine Zustandsdatei lesen.
 *
 * Gibt `null` zurueck, wenn sie fehlt oder unlesbar ist - und das ist ein
 * gewoehnlicher Zustand, kein Fehler: die Dateien entstehen von aussen, und
 * vor dem ersten Lauf gibt es sie nicht. Eine Oberflaeche, die daran
 * scheitert, waere genau dann kaputt, wenn man sie zum ersten Mal oeffnet.
 */
async function datei<T>(name: string): Promise<T | null> {
  try {
    const inhalt = await readFile(join(ZUSTAND_DIR, `${name}.json`), 'utf8');
    return JSON.parse(inhalt) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // ENOENT ist normal. Alles andere - kaputtes JSON, fehlende Rechte -
      // gehoert ins Protokoll, damit es nicht als «noch nie gelaufen»
      // erscheint.
      log.warn('Zustandsdatei nicht lesbar', { name, code });
    }
    return null;
  }
}

/** Die Laufhistorie aus `laeufe.jsonl`, neueste zuerst. */
async function laeufeLesen(grenze = 200): Promise<BackupLauf[]> {
  try {
    const inhalt = await readFile(join(ZUSTAND_DIR, 'laeufe.jsonl'), 'utf8');
    const zeilen = inhalt.split('\n').filter((zeile) => zeile.trim() !== '');
    const ergebnis: BackupLauf[] = [];
    // Von hinten: die neuesten stehen am Ende, und mehr als `grenze` braucht
    // niemand.
    for (let index = zeilen.length - 1; index >= 0 && ergebnis.length < grenze; index -= 1) {
      try {
        ergebnis.push(JSON.parse(zeilen[index] as string) as BackupLauf);
      } catch {
        // Eine abgebrochene Zeile kostet genau diese Zeile. Die Datei wird
        // angehaengt geschrieben; die letzte kann unvollstaendig sein.
      }
    }
    return ergebnis;
  } catch {
    return [];
  }
}

/**
 * Der gesamte Zustand.
 *
 * Eine Funktion und nicht sieben: die Uebersicht braucht fast alles, und
 * sieben getrennte Aufrufe waeren sieben Gelegenheiten, einen zu vergessen.
 */
export async function leseBackupZustand(): Promise<BackupZustand> {
  try {
    await stat(ZUSTAND_DIR);
  } catch {
    return {
      erreichbar: false,
      grund:
        `Das Zustandsverzeichnis ${ZUSTAND_DIR} ist nicht erreichbar. Entweder ist die ` +
        'Backup-Anlage noch nicht eingerichtet (siehe deploy/backup/install.sh), oder das ' +
        'Verzeichnis ist im Container nicht eingehaengt (siehe docs/BACKUP.md).',
    };
  }

  const namen = [
    'wiederherstellungspunkte',
    'wal',
    'verify',
    'restore-test',
    'geheimnisse',
    'geheimnisse-geprueft',
    'extern',
    'monitor',
    'dateien',
    'letzte-wiederherstellung',
    'letzter-alarm',
  ] as const;

  const [werte, laeufe, letzte] = await Promise.all([
    Promise.all(namen.map((name) => datei<unknown>(name))),
    laeufeLesen(),
    letzteLaeufeLesen(),
  ]);

  const zustand: BackupZustand = { erreichbar: true, laeufe };
  namen.forEach((name, index) => {
    const wert = werte[index];
    if (wert !== null) {
      (zustand as Record<string, unknown>)[name] = wert;
    }
  });
  Object.assign(zustand, letzte);
  return zustand;
}

/**
 * Die `letzter-erfolg-*` und `letzter-fehler-*` Dateien.
 *
 * Ihre Namen stehen nicht fest: sie entstehen je Art eines Laufs, und eine
 * neue Art soll nicht bedeuten, dass hier etwas nachgetragen werden muss.
 */
async function letzteLaeufeLesen(): Promise<Record<string, unknown>> {
  const ergebnis: Record<string, unknown> = {};
  try {
    const eintraege = await readdir(ZUSTAND_DIR);
    const passend = eintraege.filter(
      (name) =>
        (name.startsWith('letzter-erfolg-') || name.startsWith('letzter-fehler-')) && name.endsWith('.json'),
    );
    await Promise.all(
      passend.map(async (name) => {
        const schluessel = name.slice(0, -'.json'.length);
        const wert = await datei<unknown>(schluessel);
        if (wert !== null) {
          ergebnis[schluessel] = wert;
        }
      }),
    );
  } catch {
    // Kein Verzeichnis, keine Eintraege - der Aufrufer hat das oben schon
    // geprueft.
  }
  return ergebnis;
}

/** Die Ergebnisse der Anforderungen, neueste zuerst. */
export async function leseErgebnisse(grenze = 20): Promise<ControllerErgebnis[]> {
  try {
    const eintraege = await readdir(ERGEBNIS_DIR);
    const dateien = eintraege.filter((name) => name.endsWith('.json') && !name.startsWith('.'));
    const gelesen = await Promise.all(
      dateien.map(async (name) => {
        try {
          const pfad = join(ERGEBNIS_DIR, name);
          const [inhalt, angaben] = await Promise.all([readFile(pfad, 'utf8'), stat(pfad)]);
          return { ergebnis: JSON.parse(inhalt) as ControllerErgebnis, zeit: angaben.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    return gelesen
      .filter((eintrag): eintrag is { ergebnis: ControllerErgebnis; zeit: number } => eintrag !== null)
      .sort((a, b) => b.zeit - a.zeit)
      .slice(0, grenze)
      .map((eintrag) => eintrag.ergebnis);
  } catch {
    return [];
  }
}

/** Laeuft gerade eine Anforderung? Fuer die Anzeige laufender Arbeit. */
export async function leseLaufende(): Promise<ControllerErgebnis[]> {
  const alle = await leseErgebnisse(50);
  return alle.filter((eintrag) => eintrag.status === 'laeuft');
}

/**
 * Die Dateisicherung, die zu einem Datenbankzeitpunkt passt.
 *
 * DIE REGEL, UM DIE ES GEHT: Die Uploads werden unter serverseitig erzeugten
 * Namen genau einmal geschrieben und danach nie geaendert. Daraus folgt, dass
 * eine Dateisicherung, die NICHT AELTER ist als der Zielzeitpunkt der
 * Datenbank, jede Datei enthaelt, auf die diese Datenbank verweist.
 *
 * Umgekehrt gilt es nicht: eine aeltere Dateisicherung laesst Verweise ins
 * Leere zeigen - ein wiederhergestelltes Ticket mit einem Verlauf, den es
 * nicht mehr gibt.
 *
 * Gesucht wird deshalb die AELTESTE, die nicht aelter ist: sie ist der
 * genaueste Treffer. Eine juengere enthaelt zusaetzlich Dateien, die zum
 * Zielzeitpunkt noch nicht existierten - harmlos, aber unnoetig.
 */
export function passendeDateisicherung(
  punkte: Wiederherstellungspunkt[],
  zielzeitpunkt: Date,
): Wiederherstellungspunkt | null {
  const geeignet = punkte
    .filter((punkt) => punkt.art === 'dateien' && punkt.beginn !== null)
    .map((punkt) => ({ punkt, zeit: new Date(punkt.beginn as string) }))
    .filter((eintrag) => !Number.isNaN(eintrag.zeit.getTime()) && eintrag.zeit >= zielzeitpunkt)
    .sort((a, b) => a.zeit.getTime() - b.zeit.getTime());
  return geeignet[0]?.punkt ?? null;
}

/**
 * Liegt ein Zeitpunkt im ansteuerbaren Bereich?
 *
 * Erreichbar ist, was NACH dem Ende des aeltesten noch vorhandenen
 * Basis-Backups liegt - alles davor nicht, auch wenn WAL dafuer da waere.
 * Das ist die Frage, die vor jeder Point-in-Time-Recovery zu klaeren ist, und
 * die Antwort darauf gehoert in die Oberflaeche und nicht in eine
 * Fehlermeldung von pgBackRest.
 */
export function istAnsteuerbar(
  punkte: Wiederherstellungspunkt[],
  zielzeitpunkt: Date,
): { moeglich: boolean; grund?: string; frueheste?: Date } {
  const datenbank = punkte
    .filter((punkt) => punkt.art === 'datenbank' && punkt.ende !== null)
    .map((punkt) => new Date(punkt.ende as string))
    .filter((zeit) => !Number.isNaN(zeit.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const frueheste = datenbank[0];
  if (!frueheste) {
    return {
      moeglich: false,
      grund:
        'Es gibt kein Basis-Backup der Datenbank. Ohne eines ist kein Zeitpunkt erreichbar - ' +
        'die WAL-Kette allein ergibt keine Datenbank.',
    };
  }
  if (zielzeitpunkt < frueheste) {
    return {
      moeglich: false,
      frueheste,
      grund:
        `Der Zeitpunkt liegt vor dem Ende des aeltesten Basis-Backups (${frueheste.toISOString()}). ` +
        'Erreichbar ist nur, was danach liegt.',
    };
  }
  if (zielzeitpunkt > new Date()) {
    return { moeglich: false, frueheste, grund: 'Der Zeitpunkt liegt in der Zukunft.' };
  }
  return { moeglich: true, frueheste };
}
