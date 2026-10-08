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
 *
 * ## Warum diese Dateien hier liegen und nicht irgendwo im Netz
 *
 * Sie werden mit der Anwendung ausgeliefert, von derselben Domain, mit dem
 * Cache-Kopf aus `next.config.ts` (eine Woche, danach im Hintergrund
 * erneuert). Damit sind sie aus jedem Land erreichbar, solange SwissHub
 * selbst erreichbar ist - es gibt keinen fremden Dienst, der sie wegnehmen,
 * befristen oder das Einbetten verbieten kann. Genau daran war eine
 * eingetragene Adresse vorher gescheitert.
 *
 * ## Warum 384 Pixel
 *
 * Nachgemessen am gebauten Server, wie gross ein Symbol tatsaechlich
 * dargestellt wird: auf dem Desktop eine Zelle von 95 Pixeln bei doppelter
 * Pixeldichte, also 190 echte Pixel; auf einem Handy mit dreifacher Dichte
 * 54 x 3 = 162. 384 deckt beides doppelt ab und laesst Luft fuer eine
 * dichtere Anzeige, ohne dass jemand 1254 Pixel laedt, um 95 zu zeigen.
 *
 * Die Vorlagen hatten 1254 Pixel und 20,9 MB; diese acht Dateien sind
 * zusammen 514 KB. Sichtbar ist das kein Unterschied - gerechnet schon.
 */
export const STANDARD_SYMBOLE: Readonly<Record<string, string>> = {
  eins: '/xp-slot/symbole/eins.png',
  drei: '/xp-slot/symbole/drei.png',
  fuenf: '/xp-slot/symbole/fuenf.png',
  zehn: '/xp-slot/symbole/zehn.png',
  logo: '/xp-slot/symbole/logo.png',
  wild: '/xp-slot/symbole/wild.png',
  bonus: '/xp-slot/symbole/bonus.png',
  premium: '/xp-slot/symbole/premium.png',
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
 * Erzeugt mit `scripts/xp-slot-standardklaenge.mjs` - synthetische Toene aus
 * dem Projekt selbst. Keine fremden Spielassets, kein CDN, keine Datei, die
 * zur Laufzeit von irgendwoher geladen wird.
 *
 * ## Jeder Slot ist belegt - auch die Musik
 *
 * Die beiden Musikschleifen fehlten hier einmal, mit der Begruendung, Musik
 * sei Geschmack und gehoere hochgeladen. Das Ergebnis war ein Automat, der
 * in der Stille stand: jeder Effekt kam aus dem Nichts, und niemand lud eine
 * Datei hoch, weil niemand merkte, dass eine fehlte. Jetzt ist jeder Slot
 * dieser Liste belegt, und wer eine andere Stimmung will, ersetzt sie.
 */
export const STANDARD_KLAENGE: Readonly<Record<string, string>> = {
  ui_button: '/xp-slot/klaenge/ui_button.wav',
  musik: '/xp-slot/klaenge/musik.wav',
  spin_start: '/xp-slot/klaenge/spin_start.wav',
  reel_loop: '/xp-slot/klaenge/reel_loop.wav',
  reel_stop: '/xp-slot/klaenge/reel_stop.wav',
  no_win: '/xp-slot/klaenge/no_win.wav',
  win_small: '/xp-slot/klaenge/win_small.wav',
  win_normal: '/xp-slot/klaenge/win_normal.wav',
  win_big: '/xp-slot/klaenge/win_big.wav',
  win_mega: '/xp-slot/klaenge/win_mega.wav',
  jackpot: '/xp-slot/klaenge/jackpot.wav',
  premium_win: '/xp-slot/klaenge/premium_win.wav',
  bonus_trigger: '/xp-slot/klaenge/bonus_trigger.wav',
  bonus_sweat: '/xp-slot/klaenge/bonus_sweat.wav',
  bonus_reveal: '/xp-slot/klaenge/bonus_reveal.wav',
  freespin_start: '/xp-slot/klaenge/freespin_start.wav',
  freespin_loop: '/xp-slot/klaenge/freespin_loop.wav',
  freespin_end: '/xp-slot/klaenge/freespin_end.wav',
  retrigger: '/xp-slot/klaenge/retrigger.wav',
  gamble_start: '/xp-slot/klaenge/gamble_start.wav',
  gamble_spin: '/xp-slot/klaenge/gamble_spin.wav',
  gamble_tension: '/xp-slot/klaenge/gamble_tension.wav',
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
