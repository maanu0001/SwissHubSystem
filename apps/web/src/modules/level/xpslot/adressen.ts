/**
 * Die Adressen der XP-Slot-Dateien.
 *
 * Eine Stelle, weil sonst vier Komponenten dieselbe Zeichenkette zusammenbauen
 * und die fuenfte sie falsch zusammenbaut. Ein Symbolbild kann entweder als
 * hochgeladene Datei (`bildPfad`) oder als fremde Adresse (`bildUrl`)
 * vorliegen; der Vorrang liegt bei der hochgeladenen.
 */

/** Die Auslieferungsadresse einer hochgeladenen Datei. */
export function dateiAdresse(dateiname: string): string {
  return `/api/level/xp-slot/datei/${encodeURIComponent(dateiname)}`;
}

/** Hochgeladene Datei oder fremde Adresse - oder nichts. */
export function quelle(pfad: string | null, url: string | null): string | null {
  if (pfad) {
    return dateiAdresse(pfad);
  }
  return url ?? null;
}
