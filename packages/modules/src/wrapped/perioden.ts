import { zuercherMitternacht, zuercherTeile } from '../analytics/zeit';

/**
 * Monate und Jahre - fachlich, nicht nach UTC.
 *
 * ## Warum das nicht `new Date(jahr, monat, 1)` ist
 *
 * Ein SwissHub-Monat beginnt um Mitternacht in Zuerich, und Zuerich liegt je
 * nach Jahreszeit eine oder zwei Stunden vor UTC. Der September 2026 beginnt
 * also am 31. August um 22:00 UTC und endet am 30. September um 22:00 UTC -
 * der Oktober dagegen beginnt am 30. September um 22:00 und endet am 31.
 * Oktober um **23:00**, weil dazwischen die Uhr zurueckgestellt wird.
 *
 * Wer mit einem festen Versatz rechnet, verliert an zwei Tagen im Jahr eine
 * Stunde Sprachzeit oder zaehlt sie doppelt. Deshalb kommen alle Grenzen aus
 * `zuercherMitternacht` - derselben Funktion, mit der die Statistik ihre
 * Tagesgrenzen setzt.
 *
 * ## Warum «abgeschlossen» und nicht «aktuell»
 *
 * Eine Ausgabe entsteht erst, wenn der Zeitraum vorbei ist. Ein Rueckblick
 * auf einen laufenden Monat waere am 3. eine Ansammlung kleiner Zahlen und
 * am 30. eine andere - und die Bilder, die jemand am 3. exportiert haette,
 * stimmten nicht mehr.
 */

export type WrappedPeriodenArt = 'MONTHLY' | 'YEARLY';

export interface WrappedPeriode {
  art: WrappedPeriodenArt;
  /** `2026-09` oder `2026`. */
  key: string;
  /** Beginn in UTC - Zuercher Mitternacht des ersten Tages. */
  start: Date;
  /** Ende in UTC, ausschliesslich - Zuercher Mitternacht des ersten Tages danach. */
  end: Date;
  jahr: number;
  /** `1`-`12` bei Monatsausgaben, `null` bei Jahresausgaben. */
  monat: number | null;
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

const MONATS_MUSTER = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const JAHRES_MUSTER = /^\d{4}$/u;

/** Der Monatsschluessel eines Zeitpunkts - in Zuercher Zeit. */
export function monatsSchluessel(zeitpunkt: Date): string {
  const teile = zuercherTeile(zeitpunkt);
  return `${teile.jahr}-${String(teile.monat).padStart(2, '0')}`;
}

/** Der Jahresschluessel eines Zeitpunkts - in Zuercher Zeit. */
export function jahresSchluessel(zeitpunkt: Date): string {
  return String(zuercherTeile(zeitpunkt).jahr);
}

/**
 * Der Zeitraum zu einem Schluessel.
 *
 * Gibt `null` zurueck, wenn der Schluessel keiner ist. Das ist kein
 * Ausnahmefall, sondern der Normalfall bei einer Kennung aus der Adresszeile -
 * und ein `null` laesst sich abfangen, eine Ausnahme mitten im Rendern nicht.
 */
export function periodeVon(art: WrappedPeriodenArt, key: string): WrappedPeriode | null {
  if (art === 'MONTHLY') {
    const treffer = MONATS_MUSTER.exec(key);
    if (!treffer) {
      return null;
    }
    const jahr = Number(treffer[1]);
    const monat = Number(treffer[2]);
    return {
      art,
      key,
      start: zuercherMitternacht(`${treffer[1]}-${treffer[2]}-01`),
      // Der erste Tag des Folgemonats - im Dezember also der 1. Januar des
      // naechsten Jahres.
      end: zuercherMitternacht(
        monat === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(monat + 1).padStart(2, '0')}-01`,
      ),
      jahr,
      monat,
    };
  }

  if (!JAHRES_MUSTER.test(key)) {
    return null;
  }
  const jahr = Number(key);
  return {
    art,
    key,
    start: zuercherMitternacht(`${jahr}-01-01`),
    end: zuercherMitternacht(`${jahr + 1}-01-01`),
    jahr,
    monat: null,
  };
}

/** Wie der Zeitraum heisst: «September 2026» oder «2026». */
export function periodenLabel(periode: WrappedPeriode): string {
  return periode.monat === null ? String(periode.jahr) : `${MONATE[periode.monat - 1]} ${periode.jahr}`;
}

/** Der Name eines Monats - `1` ist Januar. */
export function monatsName(monat: number): string {
  return MONATE[Math.min(12, Math.max(1, Math.trunc(monat))) - 1] as string;
}

/**
 * Der zuletzt abgeschlossene Monat.
 *
 * Am 1. Oktober um 00:01 Zuercher Zeit ist das der September. Am 30.
 * September um 23:59 ist es noch der August - der September laeuft dann
 * schliesslich noch.
 */
export function letzterAbgeschlossenerMonat(jetzt: Date = new Date()): WrappedPeriode {
  const teile = zuercherTeile(jetzt);
  const jahr = teile.monat === 1 ? teile.jahr - 1 : teile.jahr;
  const monat = teile.monat === 1 ? 12 : teile.monat - 1;
  return periodeVon('MONTHLY', `${jahr}-${String(monat).padStart(2, '0')}`) as WrappedPeriode;
}

/** Das zuletzt abgeschlossene Jahr. */
export function letztesAbgeschlossenesJahr(jetzt: Date = new Date()): WrappedPeriode {
  return periodeVon('YEARLY', String(zuercherTeile(jetzt).jahr - 1)) as WrappedPeriode;
}

/** Ist dieser Zeitraum vorbei? */
export function istAbgeschlossen(periode: WrappedPeriode, jetzt: Date = new Date()): boolean {
  return jetzt.getTime() >= periode.end.getTime();
}

/**
 * Die Monate eines Jahres - fuer die Jahresauswertung.
 *
 * Das Jahres-Wrapped rechnet nicht aus zwoelf fertigen Monatsausgaben; es
 * wertet den ganzen Zeitraum aus. Diese Liste dient allein dazu, *innerhalb*
 * der Jahresdaten nach Monaten zu gruppieren - etwa fuer «der staerkste
 * Monat». Die Grenzen kommen dabei aus derselben Rechnung wie oben, damit
 * die Summe der zwoelf Monate genau das Jahr ergibt.
 */
export function monateEines(jahr: number): WrappedPeriode[] {
  return Array.from(
    { length: 12 },
    (_, index) => periodeVon('MONTHLY', `${jahr}-${String(index + 1).padStart(2, '0')}`) as WrappedPeriode,
  );
}
