/**
 * Wer den Spielekatalog pflegen darf.
 *
 * Die Berechtigung gehoert zu «Was spielen wir?» - dort steht die Verwaltung.
 * Ihr Name steht trotzdem hier und nicht in `spielwahl/config.ts`: der
 * Katalogdienst muss sie pruefen, und ein Import aus der Spielwahl waere
 * genau die Kopplung, die dieser Teil vermeiden soll.
 *
 * Eingetragen wird sie im Modul «Was spielen wir?», damit sie im Dashboard
 * dort auftaucht, wo man sie sucht.
 */
export const GAMES_PERMISSION = 'spielwahl.games.manage';
