/**
 * SwissHub Wrapped.
 *
 * Der Jahresrueckblick eines Mitglieds. Aufgeteilt so, wie man ihn liest:
 *
 *   daten            was ein Rueckblick ueber eine Person weiss
 *   resolver         wie diese Daten entstehen
 *   szenen           welche Kapitel es gibt und wann sie etwas zu sagen haben
 *   texte            was die Kapitel sagen
 *   archetyp         welcher Typ jemand war - regelbasiert, nachvollziehbar
 *   highlight        der eine Fakt, der allein auf einem Bildschirm steht
 *   kampagne         Zeitraum, Zustand, Veroeffentlichung
 *   momentaufnahme   einmal rechnen, dann festschreiben
 *   fixtures         erfundene Personen zum Testen - ausdruecklich erfunden
 *   vorlage          Platzhalter in Texten, mit Erlaubnisliste
 */
import './config';

export * from './config';
export * from './daten';
export * from './resolver';
export * from './szenen';
export * from './texte';
export * from './archetyp';
export * from './highlight';
export * from './kampagne';
export * from './momentaufnahme';
export * from './fixtures';
export * from './vorlage';
export * from './tick';
export * from './ankuendigung';
