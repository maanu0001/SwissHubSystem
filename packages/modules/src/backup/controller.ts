import 'server-only';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { CONTROLLER_OPERATIONEN, type ControllerOperation } from './typen';
import { EINGANG_DIR } from './zustand';

const log = createLogger('backup:controller');

/**
 * Eine Anforderung an den Restricted Backup Controller stellen.
 *
 * ==========================================================================
 * WAS HIER PASSIERT - UND WAS AUSDRUECKLICH NICHT
 * ==========================================================================
 *
 * Diese Funktion schreibt eine JSON-Datei. Das ist alles.
 *
 * Sie startet keinen Prozess, sie ruft keine Shell, sie fasst kein Repository
 * an. Der Controller - ein systemd-Dienst unter einem anderen Benutzer - liest
 * die Datei, prueft sie gegen eine feste Liste erlaubter Operationen und fuehrt
 * nur aus, was darin steht.
 *
 * Diese Trennung ist der Grund, weshalb eine kompromittierte WebApp hier
 * nichts erreicht:
 *
 *   - Der Operationsname wird NIE zu einem Befehl zusammengesetzt. Er waehlt
 *     auf der anderen Seite eine feste Argumentliste aus.
 *   - Der einzige Wert, der weitergegeben wird, ist ein Zeitpunkt - und er
 *     wird hier UND dort gegen ein Muster geprueft, das keinen Befehl
 *     zulaesst.
 *   - Ein produktiver Restore steht nicht in der Liste. Es gibt keinen Weg
 *     dorthin, auch nicht durch Fehler in diesem Code.
 *
 * Warum doppelt geprueft wird, hier und im Controller: die Pruefung hier gibt
 * eine verstaendliche Meldung im Dashboard; die im Controller ist die, auf die
 * es ankommt. Wer sich auf die Pruefung des Aufrufers verlaesst, hat keine
 * Sicherheitsgrenze, sondern eine Absprache.
 * ==========================================================================
 */

/**
 * Das Muster eines zulaessigen Zeitpunkts.
 *
 * Absichtlich eng: Ziffern, Bindestrich, Doppelpunkt, Punkt, ein Leerzeichen
 * oder T, und eine Zeitzone. Ein Semikolon, ein Rueckwaerts-Anfuehrungszeichen
 * oder ein `$(` kommt darin nicht vor - und damit ist dieser Wert kein Weg,
 * einen Befehl einzuschleusen, selbst wenn er irgendwo in eine Shell geriete.
 *
 * Dasselbe Muster steht im Controller. Beide muessen uebereinstimmen;
 * `tests/unit/backup-controller-operationen.test.ts` prueft das.
 */
export const ZEITPUNKT_MUSTER =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?([+-]\d{2}(:?\d{2})?|Z)?$/u;

/** Operationen, die einen Zeitpunkt annehmen. Alle anderen lehnen ihn ab. */
const NIMMT_ZEITPUNKT: ReadonlySet<ControllerOperation> = new Set<ControllerOperation>([
  'restore-test',
  'restore-probelauf',
]);

export interface AnforderungEingabe {
  operation: ControllerOperation;
  /** Nur fuer `restore-test` und `restore-probelauf`. */
  zeitpunkt?: string | null;
  /** Discord-ID des Anfordernden. Geht ins Protokoll des Controllers. */
  angefordertVon: string;
}

export interface AnforderungErgebnis {
  kennung: string;
  operation: ControllerOperation;
}

/**
 * Die Kennung einer Anforderung.
 *
 * Sie wird der DATEINAME, und deshalb wird sie hier erzeugt und nicht
 * uebernommen. Ein Wert aus einer Eingabe, der zu einem Dateinamen wird, ist
 * der Weg, ausserhalb des vorgesehenen Verzeichnisses zu schreiben - und
 * `../../etc/cron.d/boese` ist ein voellig gueltiger String.
 *
 * Zeitstempel plus Zufall: der Zeitstempel macht die Liste im
 * Ergebnisverzeichnis lesbar, der Zufall verhindert Kollisionen bei zwei
 * Anforderungen in derselben Sekunde.
 */
function kennungErzeugen(): string {
  const stempel = new Date()
    .toISOString()
    .replace(/[-:T.]/gu, '')
    .slice(0, 14);
  return `${stempel}-${randomBytes(4).toString('hex')}`;
}

export async function stelleAnforderung(eingabe: AnforderungEingabe): Promise<AnforderungErgebnis> {
  if (!CONTROLLER_OPERATIONEN.includes(eingabe.operation)) {
    throw new AppError('VALIDATION_FAILED', {
      internalMessage: `Unbekannte Operation «${String(eingabe.operation)}».`,
      userMessage: 'Diese Operation gibt es nicht.',
    });
  }

  const zeitpunkt = eingabe.zeitpunkt?.trim() ?? '';
  if (zeitpunkt !== '') {
    if (!NIMMT_ZEITPUNKT.has(eingabe.operation)) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: `Operation ${eingabe.operation} nimmt keinen Zeitpunkt.`,
        userMessage: 'Diese Operation arbeitet nicht auf einem Zeitpunkt.',
      });
    }
    if (!ZEITPUNKT_MUSTER.test(zeitpunkt)) {
      throw new AppError('VALIDATION_FAILED', {
        internalMessage: `Zeitpunkt «${zeitpunkt}» entspricht dem Muster nicht.`,
        userMessage:
          'Der Zeitpunkt muss die Form «2026-09-25 14:30:00+02» haben. Andere Zeichen sind nicht zulaessig.',
      });
    }
  }

  const kennung = kennungErzeugen();
  const anforderung = {
    operation: eingabe.operation,
    ...(zeitpunkt !== '' ? { zeitpunkt } : {}),
    angefordert_von: eingabe.angefordertVon,
    angefordert_am: new Date().toISOString(),
  };

  const ziel = join(EINGANG_DIR, `${kennung}.json`);
  try {
    // `flag: 'wx'` - nur anlegen, nie ueberschreiben. Bei einer Kollision
    // scheitert der Aufruf statt eine fremde Anforderung zu ersetzen.
    await writeFile(ziel, `${JSON.stringify(anforderung)}\n`, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    log.error('Anforderung konnte nicht abgelegt werden', { code, operation: eingabe.operation });
    if (code === 'ENOENT') {
      throw new AppError('CONFIGURATION_MISSING', {
        internalMessage: `${EINGANG_DIR} existiert nicht.`,
        userMessage:
          'Die Backup-Anlage ist nicht erreichbar. Entweder ist sie noch nicht eingerichtet, oder das Eingangsverzeichnis ist im Container nicht eingehaengt - siehe docs/BACKUP.md.',
      });
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError('INTERNAL', {
        internalMessage: `Keine Schreibrechte auf ${EINGANG_DIR}.`,
        userMessage:
          'Die WebApp darf nicht in das Eingangsverzeichnis der Backup-Anlage schreiben. Die Gruppenrechte sind zu pruefen - siehe deploy/backup/install.sh, Schritt 2.',
      });
    }
    throw new AppError('INTERNAL', {
      internalMessage: `Anforderung nicht ablegbar: ${code ?? 'unbekannt'}`,
      userMessage: 'Die Anforderung liess sich nicht ablegen.',
      cause: error,
    });
  }

  log.info('Anforderung abgelegt', { kennung, operation: eingabe.operation });
  return { kennung, operation: eingabe.operation };
}
