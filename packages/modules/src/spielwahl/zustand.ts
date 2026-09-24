import type { SpielwahlModus, SpielwahlStatus } from '@swisshub/database';

/**
 * Die Statusmaschine.
 *
 * ## Warum sie als Tabelle dasteht und nicht als Kette von `if`
 *
 * Weil eine Runde von mehreren Seiten gleichzeitig angefasst wird: der Host
 * drueckt «Start», im selben Moment laeuft der Timer der vorherigen Runde ab,
 * und ein dritter Tab schickt ein verspaetetes «Phase schliessen». Wer die
 * erlaubten Wege ueber den Code verteilt, hat drei Meinungen darueber, was
 * gerade gilt.
 *
 * Die Tabelle ist die einzige. Sie sagt nicht, **wer** etwas darf - das
 * entscheidet die Rolle in der Session - sondern nur, ob ein Uebergang
 * ueberhaupt existiert.
 */
export const ERLAUBTE_WECHSEL: Record<SpielwahlStatus, SpielwahlStatus[]> = {
  /* Beitreten und vorschlagen. Von hier geht es vorwaerts oder gar nicht. */
  LOBBY: ['BEREIT', 'ABGEBROCHEN'],
  /*
   * Die Kandidaten stehen. Zurueck in die Lobby ist ausdruecklich erlaubt:
   * «wir haben Anna vergessen» ist der haeufigste Grund, eine Runde
   * abzubrechen, und dafuer muss niemand von vorn anfangen.
   */
  BEREIT: ['ENTSCHEIDUNG', 'LOBBY', 'ABGEBROCHEN'],
  ENTSCHEIDUNG: ['ERGEBNIS', 'BEREIT', 'ABGEBROCHEN'],
  /*
   * Aus dem Ergebnis fuehren drei Wege: annehmen, noch eine Runde mit
   * denselben Kandidaten (zurueck nach BEREIT) oder die Vorschlagsphase
   * wieder oeffnen.
   */
  ERGEBNIS: ['ABGESCHLOSSEN', 'BEREIT', 'LOBBY', 'ABGEBROCHEN'],
  ABGESCHLOSSEN: [],
  ABGEBROCHEN: [],
};

export function darfWechseln(von: SpielwahlStatus, nach: SpielwahlStatus): boolean {
  return (ERLAUBTE_WECHSEL[von] ?? []).includes(nach);
}

/** Zustaende, in denen eine Runde noch lebt. */
export const OFFENE_ZUSTAENDE: SpielwahlStatus[] = ['LOBBY', 'BEREIT', 'ENTSCHEIDUNG', 'ERGEBNIS'];

/** Zustaende, in denen jemand beitreten kann. */
export const BEITRITT_MOEGLICH: SpielwahlStatus[] = ['LOBBY', 'BEREIT', 'ENTSCHEIDUNG', 'ERGEBNIS'];

export const STATUS_TEXT: Record<SpielwahlStatus, string> = {
  LOBBY: 'Vorschläge offen',
  BEREIT: 'Bereit zur Entscheidung',
  ENTSCHEIDUNG: 'Entscheidung läuft',
  ERGEBNIS: 'Ergebnis steht',
  ABGESCHLOSSEN: 'Abgeschlossen',
  ABGEBROCHEN: 'Abgebrochen',
};

export const MODUS_TEXT: Record<SpielwahlModus, string> = {
  ROULETTE: 'Roulette',
  VOTING: 'Abstimmung',
  ELIMINATION: 'Ausscheidung',
};

/**
 * Wie viele Kandidaten ein Modus braucht und vertraegt.
 *
 * Die Obergrenze der Ausscheidung ist keine technische: sechzehn Titel sind
 * fuenfzehn Duelle, und laenger als das haelt keine Gruppe durch, ohne dass
 * jemand das Fenster schliesst.
 */
export const KANDIDATEN_GRENZEN: Record<SpielwahlModus, { min: number; max: number }> = {
  ROULETTE: { min: 2, max: 40 },
  VOTING: { min: 2, max: 20 },
  ELIMINATION: { min: 2, max: 16 },
};

export function grenzenFuer(modus: SpielwahlModus): { min: number; max: number } {
  return KANDIDATEN_GRENZEN[modus] ?? { min: 2, max: 20 };
}
