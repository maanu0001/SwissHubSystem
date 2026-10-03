/**
 * Die Adressen der XP-Slot-Dateien.
 *
 * Eine Stelle, weil sonst vier Komponenten dieselbe Zeichenkette zusammenbauen
 * und die fuenfte sie falsch zusammenbaut. Ein Symbolbild kann entweder als
 * hochgeladene Datei (`bildPfad`) oder als fremde Adresse (`bildUrl`)
 * vorliegen; der Vorrang liegt bei der hochgeladenen.
 *
 * ## Die Standardassets
 *
 * Ohne hochgeladenes Bild nimmt das Spiel ein mitgeliefertes Symbol aus
 * `public/xp-slot/`. Das ist kein Platzhalter, sondern ein fertiger Satz: der
 * Slot sieht am Tag der Installation vollstaendig aus, ohne dass jemand acht
 * Dateien hochlaedt.
 *
 * Die Standardassets werden **nie kopiert**. Bei einem Standardsymbol steht in
 * der Datenbank gar nichts - der Rueckfall entsteht hier, beim Bauen der
 * Adresse. Darum braucht «auf Standard zuruecksetzen» auch keinen eigenen
 * Mechanismus: wer die Referenz loescht, bekommt den Standard zurueck.
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

/**
 * Die mitgelieferten Symbole, nach Symbolschluessel.
 *
 * Genau die acht Schluessel aus `vorgaben.ts`. Ein Schluessel, den es hier
 * nicht gibt, hat kein Standardbild - dann zeigt die Zelle den Namen, so wie
 * bisher. Das ist kein Fehlerfall, sondern der Rest eines Symbols, das in der
 * Vorgabe nicht vorkommt.
 */
export const STANDARD_SYMBOLE: Readonly<Record<string, string>> = {
  eins: '/xp-slot/symbole/eins.svg',
  drei: '/xp-slot/symbole/drei.svg',
  fuenf: '/xp-slot/symbole/fuenf.svg',
  zehn: '/xp-slot/symbole/zehn.svg',
  logo: '/xp-slot/symbole/logo.svg',
  wild: '/xp-slot/symbole/wild.svg',
  bonus: '/xp-slot/symbole/bonus.svg',
  premium: '/xp-slot/symbole/premium.svg',
};

/** Das Bild eines Symbols: das eigene zuerst, sonst das mitgelieferte. */
export function symbolBild(symbol: {
  key: string;
  bildPfad: string | null;
  bildUrl: string | null;
}): string | null {
  return quelle(symbol.bildPfad, symbol.bildUrl) ?? STANDARD_SYMBOLE[symbol.key] ?? null;
}

/** Hat dieses Symbol ein eigenes Bild - oder laeuft es auf dem Standard? */
export function istEigenesBild(symbol: { bildPfad: string | null; bildUrl: string | null }): boolean {
  return Boolean(symbol.bildPfad ?? symbol.bildUrl);
}

/**
 * Die mitgelieferten Klaenge, nach Slot.
 *
 * Erzeugt mit `scripts/xp-slot-standardklaenge.mjs` - kurze, synthetische
 * Toene aus dem Projekt selbst. Keine fremden Spielassets, kein CDN, keine
 * Datei, die zur Laufzeit von irgendwoher geladen wird.
 *
 * Die beiden Musikslots fehlen bewusst: eine Hintergrundschleife ist Geschmack
 * und waere als mitgelieferte Datei ein Vielfaches aller Effekte zusammen.
 * Musik bleibt etwas, das die Verwaltung hochlaedt.
 */
export const STANDARD_KLAENGE: Readonly<Record<string, string>> = {
  ui_button: '/xp-slot/klaenge/ui_button.wav',
  spin_start: '/xp-slot/klaenge/spin_start.wav',
  reel_loop: '/xp-slot/klaenge/reel_loop.wav',
  reel_stop: '/xp-slot/klaenge/reel_stop.wav',
  no_win: '/xp-slot/klaenge/no_win.wav',
  win_small: '/xp-slot/klaenge/win_small.wav',
  win_normal: '/xp-slot/klaenge/win_normal.wav',
  win_big: '/xp-slot/klaenge/win_big.wav',
  win_mega: '/xp-slot/klaenge/win_mega.wav',
  jackpot: '/xp-slot/klaenge/jackpot.wav',
  bonus_trigger: '/xp-slot/klaenge/bonus_trigger.wav',
  bonus_sweat: '/xp-slot/klaenge/bonus_sweat.wav',
  bonus_reveal: '/xp-slot/klaenge/bonus_reveal.wav',
  freespin_start: '/xp-slot/klaenge/freespin_start.wav',
  freespin_end: '/xp-slot/klaenge/freespin_end.wav',
  retrigger: '/xp-slot/klaenge/retrigger.wav',
  premium_win: '/xp-slot/klaenge/premium_win.wav',
  gamble_start: '/xp-slot/klaenge/gamble_start.wav',
  gamble_win: '/xp-slot/klaenge/gamble_win.wav',
  gamble_lose: '/xp-slot/klaenge/gamble_lose.wav',
};

/** Der Klang eines Slots: der eigene zuerst, sonst der mitgelieferte. */
export function klangQuelle(slot: string, dateiname: string | null): string | null {
  if (dateiname) {
    return dateiAdresse(dateiname);
  }
  return STANDARD_KLAENGE[slot] ?? null;
}
