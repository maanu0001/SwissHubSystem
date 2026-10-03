/**
 * Das Automation-Modul.
 *
 * Es bringt der Engine bei, was SwissHub kann: welche Ereignisse es gibt,
 * welche Aktionen ein Modul beisteuert und welche Vorlagen bereitstehen. Die
 * Engine selbst kennt nichts davon - sie erfährt es, weil diese Datei geladen
 * wird.
 *
 * Die Reihenfolge ist keine Zufälligkeit: Vorlagen prüfen beim Auflisten, ob
 * es ihre Bausteine gibt. Werden sie vor den Aktionen **und Bedingungen**
 * geladen, wäre die Vorlagenliste beim ersten Aufruf leer - und zwar
 * stillschweigend, weil `vorlageVollstaendig` eine unbekannte Bedingung wie
 * ein abgeschaltetes Modul behandelt.
 */
import './events';
import './actions';
import './conditions';
import './templates';

export * from './config';
export * from './system';
export * from './emit';
export * from './notify';
