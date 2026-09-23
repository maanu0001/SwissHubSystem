/**
 * Die Woche - nach ISO und in Zuercher Zeit.
 *
 * ## Warum nicht selbst gerechnet
 *
 * Wochennummern sind eine der Stellen, an denen selbstgebaute Rechnungen
 * zuverlaessig falsch werden: der Jahreswechsel liegt mitten in einer Woche,
 * der 1. Januar gehoert manchmal zur Woche 52 des Vorjahres, und ein Jahr hat
 * mal 52 und mal 53 Wochen.
 *
 * ISO 8601 legt das fest: eine Woche beginnt am Montag, und die Woche 1 ist
 * die mit dem ersten Donnerstag des Jahres. Genau das steht hier - einmal,
 * mit Begruendung, statt an vier Stellen ungefaehr.
 *
 * ## Warum Zuerich
 *
 * Weil der Server in der Schweiz steht und «Montag» dort Montag heisst. Um
 * 00:30 Uhr Zuercher Zeit ist es in UTC noch Sonntag - eine Runde, die nach
 * UTC-Wochen rechnet, hiesse dann eine Woche zu frueh.
 *
 * Gespeichert wird trotzdem UTC. Zuerich ist die Zone der Anzeige und der
 * Wochengrenzen, nicht die der Datenbank.
 */

export const ZONE = 'Europe/Zurich';

/** Die Zuercher Wanduhrzeit eines Zeitpunkts, aufgeschluesselt. */
function zuercherTeile(zeitpunkt: Date): {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  wochentag: number;
} {
  const formatierer = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const teile = Object.fromEntries(
    formatierer.formatToParts(zeitpunkt).map((teil) => [teil.type, teil.value]),
  );
  // Montag = 1 … Sonntag = 7, wie in ISO 8601.
  const tage = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    jahr: Number(teile.year),
    monat: Number(teile.month),
    tag: Number(teile.day),
    stunde: Number(teile.hour === '24' ? '0' : teile.hour),
    minute: Number(teile.minute),
    wochentag: tage.indexOf(String(teile.weekday)) + 1,
  };
}

/**
 * Der UTC-Zeitpunkt zu einer Zuercher Wanduhrzeit.
 *
 * Ueber den Versatz und nicht ueber eine Bibliothek: `Date.UTC` liefert den
 * Zeitpunkt, als waere die Angabe UTC; die Differenz zur tatsaechlichen
 * Zuercher Darstellung dieses Zeitpunkts ist der Versatz. Zweimal angewandt,
 * weil der Versatz selbst vom Zeitpunkt abhaengt - an den beiden
 * Umstellungstagen im Jahr.
 */
export function ausZuercherZeit(
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number,
): Date {
  const angenommen = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0, 0);
  let ergebnis = new Date(angenommen);
  for (let runde = 0; runde < 2; runde += 1) {
    const gezeigt = zuercherTeile(ergebnis);
    const abweichung =
      Date.UTC(gezeigt.jahr, gezeigt.monat - 1, gezeigt.tag, gezeigt.stunde, gezeigt.minute) -
      Date.UTC(jahr, monat - 1, tag, stunde, minute);
    if (abweichung === 0) {
      break;
    }
    ergebnis = new Date(ergebnis.getTime() - abweichung);
  }
  return ergebnis;
}

export interface Kalenderwoche {
  /** `2026-W39` - mit Jahr, weil die Woche 39 jedes Jahr wiederkommt. */
  key: string;
  jahr: number;
  woche: number;
  /** Montag, 00:00 Zuercher Zeit, als UTC-Zeitpunkt. */
  beginn: Date;
}

/** Die ISO-Kalenderwoche eines Zeitpunkts, in Zuercher Zeit. */
export function kalenderwoche(zeitpunkt: Date): Kalenderwoche {
  const { jahr, monat, tag, wochentag } = zuercherTeile(zeitpunkt);

  /*
   * Der Donnerstag entscheidet.
   *
   * ISO 8601 ordnet eine Woche dem Jahr zu, in dem ihr Donnerstag liegt.
   * Deshalb wird vom aktuellen Tag auf den Donnerstag derselben Woche
   * gerechnet und erst dort das Jahr gelesen - sonst bekaeme der 31.
   * Dezember 2025, der zur Woche 1 von 2026 gehoert, die Nummer 53.
   */
  const alsUtc = Date.UTC(jahr, monat - 1, tag);
  const donnerstag = new Date(alsUtc + (4 - wochentag) * 86_400_000);
  const isoJahr = donnerstag.getUTCFullYear();
  const jahresbeginn = Date.UTC(isoJahr, 0, 1);
  const woche = Math.floor((donnerstag.getTime() - jahresbeginn) / 86_400_000 / 7) + 1;

  const montag = new Date(alsUtc - (wochentag - 1) * 86_400_000);
  const beginn = ausZuercherZeit(
    montag.getUTCFullYear(),
    montag.getUTCMonth() + 1,
    montag.getUTCDate(),
    0,
    0,
  );

  return { key: `${isoJahr}-W${String(woche).padStart(2, '0')}`, jahr: isoJahr, woche, beginn };
}

/**
 * Ein Zeitpunkt innerhalb einer Woche, aus Wochentag und Uhrzeit.
 *
 * `wochentag` ist 1 (Montag) bis 7 (Sonntag). Die Rechnung laeuft ueber die
 * Zuercher Wanduhr: «Freitag 20:00» heisst 20:00 Uhr in Zuerich, im Sommer
 * wie im Winter, auch wenn das in UTC zwei verschiedene Stunden sind.
 */
export function inDerWoche(woche: Kalenderwoche, wochentag: number, stunde: number, minute: number): Date {
  const montag = zuercherTeile(woche.beginn);
  const ziel = new Date(Date.UTC(montag.jahr, montag.monat - 1, montag.tag) + (wochentag - 1) * 86_400_000);
  return ausZuercherZeit(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, ziel.getUTCDate(), stunde, minute);
}

/**
 * Jahr und Woche aus dem Schluessel `2026-W39`.
 *
 * Der Schluessel traegt beides bereits. Zwei zusaetzliche Spalten waeren
 * dieselbe Angabe ein zweites Mal - und damit die Moeglichkeit, dass sie
 * einmal auseinanderlaufen.
 */
export function ausSchluessel(key: string): { jahr: number; woche: number } {
  const treffer = /^(\d{4})-W(\d{2})$/u.exec(key);
  return treffer ? { jahr: Number(treffer[1]), woche: Number(treffer[2]) } : { jahr: 0, woche: 0 };
}
