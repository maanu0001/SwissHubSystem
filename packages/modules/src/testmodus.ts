import { moduleIdForPermission } from './registry';
import { getModulStatus, testModusModulIds, type ModulStatus } from './module-state';

/**
 * Der Riegel vor Modulen im Testmodus.
 *
 * ## Was der Testmodus ist - und was nicht
 *
 * Er ist **kein** zweiter Berechtigungsbegriff. Er beantwortet eine Frage,
 * die die Berechtigungen nicht beantworten koennen: «darf die Community
 * dieses Modul ueberhaupt schon sehen?»
 *
 * Deshalb steht er **neben** der Berechtigungspruefung und nicht an ihrer
 * Stelle. Wer ein Modul im Testmodus oeffnen will, braucht beides:
 *
 *   - die Berechtigung des Moduls, wie immer, und
 *   - `modules.testmode.use`, den Schluessel des Teams.
 *
 * Ein gewoehnliches Mitglied hat den zweiten nicht - auch dann nicht, wenn
 * eine alte Rolle ihm zufaellig die erste gibt. Genau das ist der Punkt.
 *
 * ## Warum hier keine Modulliste steht
 *
 * Weil es keine geben darf. Das Modul ergibt sich aus dem Praefix der
 * geforderten Berechtigung (`moduleIdForPermission`), der Status aus der
 * Datenbank. Eine Sonderbehandlung je Modul waere die Stelle, an der das
 * naechste Modul vergessen wird.
 */

/** Der Schluessel, mit dem das Team Testmodule oeffnet. */
export const TESTMODUS_PERMISSION = 'modules.testmode.use';

/**
 * Darf jemand mit diesen Berechtigungen ein Modul in diesem Status benutzen?
 *
 * Rein rechnend, ohne Datenbank - damit die Regel an einer Stelle steht und
 * sich ohne Aufbau einer Umgebung pruefen laesst.
 *
 * `DEAKTIVIERT` gibt hier **true** zurueck: ein abgeschaltetes Modul ist
 * nicht die Frage dieser Funktion. Darum kuemmert sich die bestehende
 * Deaktivierungslogik, und sie bleibt unveraendert - zwei Stellen, die
 * dasselbe abschalten, waeren eine zu viel.
 */
export function darfStatusOeffnen(status: ModulStatus, hatTestmodusSchluessel: boolean): boolean {
  return status !== 'TESTMODUS' || hatTestmodusSchluessel;
}

/**
 * Dieselbe Frage fuer eine konkrete Berechtigung - mit Blick in die Datenbank.
 *
 * Gibt `true` zurueck, wenn die Berechtigung zu keinem Modul gehoert: der
 * Riegel sperrt nur, was er kennt. Eine Berechtigung ohne Modul (`admin.full`,
 * `dashboard.view`) hat keinen Testmodus, und sie deswegen zu blockieren waere
 * ein Riegel vor der eigenen Haustuer.
 */
export async function darfModulPermissionOeffnen(
  permission: string,
  hatTestmodusSchluessel: boolean,
): Promise<boolean> {
  const moduleId = moduleIdForPermission(permission);
  if (!moduleId) {
    return true;
  }
  return darfStatusOeffnen(await getModulStatus(moduleId), hatTestmodusSchluessel);
}

/**
 * Die Modul-IDs, die jemand wegen des Testmodus **nicht** sehen darf.
 *
 * Fuer die Seitenleiste: sie kennt die Modul-IDs bereits und filtert damit,
 * ohne fuer jedes Modul einzeln nachzufragen.
 */
export async function verborgeneTestModule(hatTestmodusSchluessel: boolean): Promise<Set<string>> {
  if (hatTestmodusSchluessel) {
    return new Set();
  }
  return testModusModulIds();
}
