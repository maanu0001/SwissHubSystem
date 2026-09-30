import { zuercherMitternacht, zuercherTeile } from '../analytics/zeit';
import { ausSchluessel, kalenderwoche } from '../clips/woche';

/**
 * Wochen, Monate und Jahre - fachlich, nicht nach UTC.
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

/**
 * ## Die Woche als dritte Art
 *
 * Eine Kalenderwoche nach ISO 8601: Montag bis Sonntag, und das Jahr ist das
 * des Donnerstags. Die Rechnung dafuer steht nicht hier, sondern in
 * `clips/woche.ts` - dieselbe, nach der Clip of the Week seine Runden
 * schneidet. Wochennummern sind genau die Stelle, an der eine zweite,
 * ungefaehr gleiche Rechnung irgendwann im Dezember auseinanderlaeuft: der
 * 31. Dezember 2025 gehoert zu `2026-W01`, und wer das selbst herleitet,
 * schreibt `2025-W53`.
 *
 * Deshalb importiert, nicht nachgebaut. Nebenbei heisst ein Wochenschluessel
 * im ganzen System dasselbe - `2026-W39` ist in beiden Modulen dieselbe
 * Woche.
 */

export type WrappedPeriodenArt = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface WrappedPeriode {
  art: WrappedPeriodenArt;
  /** `2026-W39`, `2026-09` oder `2026`. */
  key: string;
  /** Beginn in UTC - Zuercher Mitternacht des ersten Tages. */
  start: Date;
  /** Ende in UTC, ausschliesslich - Zuercher Mitternacht des ersten Tages danach. */
  end: Date;
  /** Bei Wochenausgaben das ISO-Jahr - das des Donnerstags, nicht des Montags. */
  jahr: number;
  /** `1`-`12` bei Monatsausgaben, `null` sonst. */
  monat: number | null;
  /** `1`-`53` bei Wochenausgaben, `null` sonst. */
  woche: number | null;
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
const WOCHEN_MUSTER = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/u;

const TAG_MS = 86_400_000;

/** Der Monatsschluessel eines Zeitpunkts - in Zuercher Zeit. */
export function monatsSchluessel(zeitpunkt: Date): string {
  const teile = zuercherTeile(zeitpunkt);
  return `${teile.jahr}-${String(teile.monat).padStart(2, '0')}`;
}

/** Der Wochenschluessel eines Zeitpunkts - `2026-W39`, in Zuercher Zeit. */
export function wochenSchluessel(zeitpunkt: Date): string {
  return kalenderwoche(zeitpunkt).key;
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
  if (art === 'WEEKLY') {
    if (!WOCHEN_MUSTER.test(key)) {
      return null;
    }
    const { jahr, woche } = ausSchluessel(key);

    /*
     * Vom 4. Januar aus.
     *
     * Der 4. Januar liegt nach ISO 8601 immer in der Woche 1 - egal, auf
     * welchen Wochentag er faellt. Von seinem Montag aus sind es genau
     * `(woche - 1)` Wochen bis zum gesuchten Montag.
     *
     * Gerechnet wird das auf **Kalendertagen** in UTC und erst danach in
     * Zuercher Zeit uebersetzt: sieben mal 24 Stunden sind in der Woche
     * einer Zeitumstellung nicht sieben Tage, und ein Montag, der auf
     * Sonntag 23:00 rutscht, ergaebe eine Ausgabe mit dem falschen Namen.
     */
    const vierterJanuar = zuercherMitternacht(`${jahr}-01-04`);
    const montagDerErsten = kalenderwoche(vierterJanuar).beginn;
    const gesucht = new Date(montagDerErsten.getTime() + (woche - 1) * 7 * TAG_MS);

    /*
     * Und dann gegengeprueft.
     *
     * Ein Jahr hat 52 oder 53 Wochen. `2026-W53` besteht das Muster oben,
     * ist aber keine Woche des Jahres 2026 - der gerechnete Montag liegt
     * dann bereits in 2027. Statt die Zahl der Wochen eines Jahres ein
     * zweites Mal herzuleiten, wird gefragt, welche Woche der gefundene
     * Montag traegt: stimmt sie nicht mit dem Schluessel ueberein, gab es
     * die Woche nicht.
     */
    const tatsaechlich = kalenderwoche(gesucht);
    if (tatsaechlich.key !== key) {
      return null;
    }

    return {
      art,
      key,
      start: tatsaechlich.beginn,
      // Der Montag darauf - ueber den Kalender, aus demselben Grund.
      end: kalenderwoche(new Date(tatsaechlich.beginn.getTime() + 7 * TAG_MS + 12 * 3600_000)).beginn,
      jahr,
      monat: null,
      woche,
    };
  }

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
      woche: null,
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
    woche: null,
  };
}

/** Wie der Zeitraum heisst: «KW 39 2026», «September 2026» oder «2026». */
export function periodenLabel(periode: WrappedPeriode): string {
  if (periode.woche !== null) {
    return `KW ${periode.woche} ${periode.jahr}`;
  }
  return periode.monat === null ? String(periode.jahr) : `${MONATE[periode.monat - 1]} ${periode.jahr}`;
}

/** Der Name eines Monats - `1` ist Januar. */
export function monatsName(monat: number): string {
  return MONATE[Math.min(12, Math.max(1, Math.trunc(monat))) - 1] as string;
}

/**
 * Die zuletzt abgeschlossene Kalenderwoche.
 *
 * Am Montag um 00:01 Zuercher Zeit ist das die Woche, die gerade zu Ende
 * ging. Am Sonntag um 23:59 ist es die davor - die laufende Woche hat dann
 * schliesslich noch einen Tag.
 */
export function letzteAbgeschlosseneWoche(jetzt: Date = new Date()): WrappedPeriode {
  const laufend = kalenderwoche(jetzt);
  // Zwoelf Stunden vor dem Montag liegt sicher im Sonntag der Vorwoche, auch
  // am Umstellungswochenende.
  const vorwoche = kalenderwoche(new Date(laufend.beginn.getTime() - 12 * 3600_000));
  return periodeVon('WEEKLY', vorwoche.key) as WrappedPeriode;
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
