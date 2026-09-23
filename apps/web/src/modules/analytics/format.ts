/**
 * Zahlenformate der Statistik - als reine Daten-Funktionen.
 *
 * Eine Stelle, damit dieselbe Zahl auf der Seite und im Export gleich
 * aussieht.
 */

export function zahl(wert: number): string {
  return wert.toLocaleString('de-CH');
}

/** Sekunden als `184 h 22 min` - Stunden bleiben der Hauptwert. */
export function dauer(sekunden: number): string {
  if (sekunden <= 0) {
    return '0 h';
  }
  const stunden = Math.floor(sekunden / 3600);
  const minuten = Math.round((sekunden % 3600) / 60);
  if (stunden === 0) {
    return `${minuten} min`;
  }
  return minuten > 0 ? `${zahl(stunden)} h ${minuten} min` : `${zahl(stunden)} h`;
}

/**
 * Stunden mit einer Nachkommastelle - für Kennzahlkarten.
 *
 * Vorher wurde auf ganze Stunden gerundet, und eine halbe Stunde im
 * Sprachkanal stand damit als `0 h` auf der Seite: eine Null, die nach
 * «nichts passiert» aussieht, obwohl jemand da war. Unter einer Stunde war
 * die Kennzahl schlicht unbrauchbar.
 *
 * Eine Nachkommastelle ist die Auflösung, die zur Sache passt: sechs Minuten
 * sind ein Zehntel, und mehr Stellen behaupteten eine Genauigkeit, die
 * niemand ablesen will. Sie steht immer da - auch bei `1.0 h`, denn eine
 * Spalte, in der mal eine und mal keine Nachkommastelle erscheint, liest
 * sich schlechter als eine gleichmässige.
 *
 * Gerundet wird **erst hier**. Gezählt und summiert wird in Sekunden; wer
 * früher auf Stunden umrechnet, verliert bei jedem Zwischenschritt ein
 * bisschen und wundert sich am Ende über die Summe.
 */
export function stunden(sekunden: number): string {
  const wert = Math.max(0, sekunden) / 3600;
  return `${wert.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
}

export function prozent(wert: number | null): string {
  return wert === null ? '–' : `${wert.toLocaleString('de-CH', { minimumFractionDigits: 1 })} %`;
}

/** Eine Spanne wie `2 h 18 min` für «Zeit bis zur ersten Äusserung». */
export function spanne(sekunden: number | null): string {
  return sekunden === null ? '–' : dauer(sekunden);
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function spitzenzeit(spitze: { wochentag: number; stunde: number } | null): string {
  if (!spitze) {
    return '–';
  }
  return `${WOCHENTAGE[spitze.wochentag]}, ${String(spitze.stunde).padStart(2, '0')}:00 Uhr`;
}
