/**
 * SwissHub fragt.
 *
 * Aufgeteilt nach Zustaendigkeit, nicht nach Schicht: `bibliothek` verwaltet
 * Vorlagen, `abstimmung` fuehrt einen Vorgang durch, `ergebnis` rechnet,
 * `planung` entscheidet wann und was, `entwurf` bereitet Social Media vor.
 *
 * `ergebnis` und `typen` haengen an nichts - keine Datenbank, kein Discord.
 * Das ist Absicht: es sind die Teile, an denen die Zahlen entstehen, und sie
 * sollen einzeln pruefbar sein.
 */
import './config';

export * from './config';
export * from './typen';
export * from './ergebnis';
export * from './embed';
export * from './bibliothek';
export * from './abstimmung';
export * from './planung';
export * from './entwurf';
export * from './abfragen';
export * from './tick';
export * from './seed';
