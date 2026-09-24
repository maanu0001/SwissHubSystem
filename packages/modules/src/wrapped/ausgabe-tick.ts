import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { resolveGuildId } from '@swisshub/discord';
import { erzeugeAusgabe } from './ausgabe';
import {
  letzterAbgeschlossenerMonat,
  letztesAbgeschlossenesJahr,
  periodeVon,
  type WrappedPeriode,
} from './perioden';

const log = createLogger('wrapped:ausgabe-tick');

/**
 * Der Durchgang, der Monats- und Jahresausgaben anlegt.
 *
 * ## Warum kein Kalender und kein Zeitgeber
 *
 * Ein `setTimeout` auf den Monatswechsel ueberlebt keinen Neustart, und ein
 * Neustart am 1. um 00:03 waere genau der Fall, in dem der September nie
 * entstuende. Dieser Durchgang stellt stattdessen jedes Mal dieselbe Frage:
 * **gibt es den zuletzt abgeschlossenen Monat schon?** Ist die Antwort nein,
 * entsteht er - ob das nun am 1. um 00:01 ist oder am 4. nach einem langen
 * Ausfall.
 *
 * Das macht ihn von selbst neustartfest, wiederholbar und unabhaengig davon,
 * wie oft er laeuft.
 *
 * ## Warum zwei Arbeiter sich nicht ins Gehege kommen
 *
 * Weil `(guildId, type, periodKey)` eindeutig ist. Beide kommen bis zum
 * `INSERT`, genau einer kommt durch, der andere sieht den Verstoss und geht.
 * Siehe `erzeugeAusgabe`.
 *
 * ## Warum ein gescheiterter Versuch wiederholt wird
 *
 * Eine Ausgabe ohne Folien und mit `failedAt` ist ein halber Zustand - die
 * Zeile existiert, die Erhebung nicht. Beim naechsten Durchgang wird sie
 * erneut versucht, aber nicht oefter als einmal je Durchlauf: ein dauerhaft
 * kaputter Zeitraum soll den Job nicht jede Minute beschaeftigen.
 */

export interface AusgabeTickErgebnis {
  /** Neu angelegte Ausgaben in diesem Durchgang. */
  erzeugt: string[];
  /** Erneut versuchte, zuvor gescheiterte Ausgaben. */
  wiederholt: string[];
}

/** Wie lange nach Zeitraumende gewartet wird, bevor erzeugt wird. */
const KARENZ_MS = 60 * 60 * 1000;

/**
 * Eine Stunde Karenz.
 *
 * Die Tageswerte der Statistik entstehen nicht in derselben Sekunde, in der
 * ein Tag endet - der letzte Abschnitt im Sprachkanal wird abgerechnet,
 * wenn jemand den Kanal verlaesst. Eine Ausgabe, die um 00:00:01 erhoben
 * wird, haette den letzten Abend nicht vollstaendig. Eine Stunde spaeter
 * schon.
 */
function istReif(periode: WrappedPeriode, jetzt: Date): boolean {
  return jetzt.getTime() >= periode.end.getTime() + KARENZ_MS;
}

export async function runWrappedAusgabeTick(jetzt = new Date()): Promise<AusgabeTickErgebnis> {
  const ergebnis: AusgabeTickErgebnis = { erzeugt: [], wiederholt: [] };
  const guildId = await resolveGuildId();

  for (const periode of [letzterAbgeschlossenerMonat(jetzt), letztesAbgeschlossenesJahr(jetzt)]) {
    if (!istReif(periode, jetzt)) {
      continue;
    }
    try {
      const angelegt = await erzeugeAusgabe(guildId, periode, { jetzt });
      if (angelegt.neu) {
        ergebnis.erzeugt.push(periode.key);
        log.info('Wrapped-Ausgabe erzeugt', {
          type: periode.art,
          periodKey: periode.key,
          folien: angelegt.folien,
          uebersprungen: angelegt.uebersprungen,
        });
      }
    } catch (fehler) {
      // Die Ausgabe traegt den Grund bereits - hier geht es nur darum, dass
      // der Durchgang weiterlaeuft und das Jahr nicht am Monat haengenbleibt.
      log.error('Wrapped-Ausgabe konnte nicht erzeugt werden', {
        type: periode.art,
        periodKey: periode.key,
        fehler,
      });
    }
  }

  const gescheitert = await naechsteGescheiterte(guildId);
  if (gescheitert) {
    const periode = periodeVon(gescheitert.type, gescheitert.periodKey);
    if (periode) {
      try {
        const { fuelleErneut } = await import('./ausgabe-wiederholung');
        await fuelleErneut(gescheitert.id, guildId, periode);
        ergebnis.wiederholt.push(gescheitert.periodKey);
        log.info('Gescheiterte Wrapped-Ausgabe erneut erhoben', { periodKey: gescheitert.periodKey });
      } catch (fehler) {
        log.warn('Wiederholung gescheitert', { periodKey: gescheitert.periodKey, fehler });
      }
    }
  }

  return ergebnis;
}

/**
 * Die aelteste Ausgabe, deren Erhebung gescheitert ist.
 *
 * Genau eine je Durchgang. Waeren es alle, beschaeftigte ein dauerhaft
 * kaputter Zeitraum den Job jede Minute mit derselben vergeblichen Arbeit.
 */
async function naechsteGescheiterte(
  guildId: string,
): Promise<{ id: string; type: 'MONTHLY' | 'YEARLY'; periodKey: string } | null> {
  return prisma.wrappedEdition.findFirst({
    where: { guildId, status: 'DRAFT', generatedAt: null, failedAt: { not: null } },
    orderBy: { failedAt: 'asc' },
    select: { id: true, type: true, periodKey: true },
  });
}
