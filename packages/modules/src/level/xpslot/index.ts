/**
 * Der XP-Slot.
 *
 * Ein Spielautomat innerhalb des Level-Moduls - kein eigenes Modul. Der
 * Einsatz sind XP, der Gewinn sind XP, und beides geht durch `applyXpWithin`,
 * die einzige Stelle im System, an der sich ein XP-Stand aendert.
 *
 * Die Dateien in der Reihenfolge, in der man sie liest:
 *
 *  - `regeln.ts` - Spielfeld, Linien, Ziehung. Rein rechnend.
 *  - `auswertung.ts` - wie aus einem Spielfeld ein Gewinn wird. Rein rechnend.
 *  - `rtp.ts` - die Quote, exakt aufgezaehlt aus derselben Auswertung.
 *  - `vorgaben.ts` - die acht Symbole, die Einsaetze, die Klangslots.
 *  - `konfiguration.ts` - Lesen und Schreiben, Eventmodus als Schicht.
 *  - `limits.ts` - Tages- und Sitzungsgrenzen.
 *  - `freispiele.ts` - die Pakete des Teams.
 *  - `spin.ts` - der Ablauf eines Spins, in einer Transaktion.
 *  - `bonus.ts` - Bonusrunde und Risikoleiter.
 *  - `premium.ts` - der Weg eines Premium-Gewinns ins Premium-System.
 *  - `feed.ts` - die Meldung grosser Gewinne auf Discord.
 *  - `testlauf.ts` - der Testmodus der Verwaltung, ohne jede Folge.
 *  - `statistik.ts`, `historie.ts` - Kennzahlen und Verlauf.
 *  - `klaenge.ts`, `klang-speicher.ts` - Sound-Pakete und Dateien.
 *  - `verwaltung.ts` - alles, was die Verwaltung aendern darf.
 *  - `ansicht.ts` - was der Browser bekommt.
 */

export * from './regeln';
export * from './auswertung';
export * from './rtp';
export * from './vorgaben';
export * from './konfiguration';
export * from './limits';
export * from './freispiele';
export * from './spin';
export * from './bonus';
export * from './premium';
export * from './feed';
export * from './testlauf';
export * from './statistik';
export * from './historie';
export * from './klaenge';
export * from './klang-speicher';
export * from './verwaltung';
export * from './ansicht';
