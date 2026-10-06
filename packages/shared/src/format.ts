/**
 * Zahlenformatierung, die auf Server und im Browser dasselbe liefert.
 */
/**
 * Zahl mit Schweizer Tausendertrennung.
 *
 * Bewusst von Hand statt über `toLocaleString('de-CH')`: Node und die Browser
 * verwenden unterschiedliche ICU-Fassungen und setzen mal den geraden
 * Apostroph (`'`), mal den typografischen (`’`). Wird derselbe Wert einmal auf
 * dem Server und einmal im Browser gerendert, weichen die beiden Fassungen
 * voneinander ab und React meldet einen Hydration-Fehler. Hier kommt überall
 * dasselbe heraus - so wie es auch der alte Bot schrieb.
 */
export function formatSwissNumber(value: number): string {
  const rounded = Math.trunc(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();

  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) {
      out += '’';
    }
    out += digits[index];
  }
  return negative ? `-${out}` : out;
}

/** Prozentwert mit zwei Nachkommastellen - ebenfalls laufzeitunabhängig. */
export function formatSwissPercent(fraction: number): string {
  const percent = fraction * 100;
  const [whole, decimals = '00'] = percent.toFixed(2).split('.');
  return `${formatSwissNumber(Number(whole))}.${decimals} %`;
}

/**
 * Geldbetrag aus Rappen.
 *
 * Gerechnet wird ausschliesslich in der kleinsten Einheit - Gleitkomma hat
 * bei Geld nichts verloren. Formatiert wird in Schweizer Schreibweise:
 * volle Franken als «CHF 5.–», Rappen als «CHF 5.50».
 */
export function formatChf(minor: number): string {
  const franken = Math.trunc(minor / 100);
  const rappen = Math.abs(minor % 100);
  const vorzeichen = minor < 0 ? '-' : '';
  if (rappen === 0) {
    return `${vorzeichen}CHF ${formatSwissNumber(Math.abs(franken))}.–`;
  }
  return `${vorzeichen}CHF ${formatSwissNumber(Math.abs(franken))}.${String(rappen).padStart(2, '0')}`;
}

/**
 * Geldbetrag in einer beliebigen Waehrung (§25).
 *
 * `formatChf` bleibt, was es ist - die Schweizer Schreibweise mit dem
 * Gedankenstrich -, und fuer CHF faellt diese Funktion auch darauf zurueck.
 * Gebraucht wird sie dort, wo die Waehrung am Angebot haengt statt im Code:
 * das Datenmodell kennt `currency` seit je, nur die Anzeige tat so, als
 * gaebe es nur Franken.
 */
export function formatGeldbetrag(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (code === 'CHF' || code === '') {
    return formatChf(minor);
  }
  const ganz = Math.trunc(Math.abs(minor) / 100);
  const rest = Math.abs(minor % 100);
  const vorzeichen = minor < 0 ? '-' : '';
  return `${vorzeichen}${code} ${formatSwissNumber(ganz)}.${String(rest).padStart(2, '0')}`;
}
