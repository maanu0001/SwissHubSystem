import { registerModule, type ModuleDefinition } from '../registry';

export const BACKUP_MODULE_ID = 'backup';

/**
 * Berechtigungen der Sicherung.
 *
 * Fein geschnitten, weil die Stufen unterschiedlich weit reichen. «Den Zustand
 * ansehen» ist eine Auskunft; «einen produktiven Restore autorisieren» verwirft
 * Daten. Wer das eine darf, soll damit nicht das andere duerfen.
 *
 * Die Reihenfolge unten ist die Reihenfolge der Folgen:
 *
 *   view           liest. Kann nichts kaputt machen.
 *   run            startet eine Sicherung. Kostet Rechenzeit und Platz.
 *   settings       aendert Aufbewahrung und Grenzwerte. Wirkt auf die Zukunft.
 *   points         sieht Wiederherstellungspunkte samt Zeitpunkten.
 *   test           startet einen Restore-Test. Isoliert, aber teuer.
 *   restore_request fordert einen produktiven Restore AN. Loest nichts aus.
 *   restore_approve gibt ihn FREI. Die scharfe Berechtigung.
 *
 * Bewusst KEINE Berechtigung «Restore ausfuehren»: das tut die WebApp nicht.
 * Ausgefuehrt wird auf der Kommandozeile mit `swisshub-recovery`, von einem
 * Menschen, der die Freigabe vorzeigt. Eine Oberflaeche, die einen Knopf
 * «Produktion zuruecksetzen» haette, waere genau der Knopf, den irgendwann
 * jemand versehentlich drueckt.
 */
export const BACKUP_PERMISSIONS = {
  view: 'backup.view',
  run: 'backup.run',
  settings: 'backup.settings',
  points: 'backup.points',
  test: 'backup.test',
  restoreRequest: 'backup.restore_request',
  restoreApprove: 'backup.restore_approve',
} as const;

export type BackupPermission = (typeof BACKUP_PERMISSIONS)[keyof typeof BACKUP_PERMISSIONS];

/**
 * Das Modul.
 *
 * `core: true` und `defaultEnabled: true`: anders als bei einem
 * Gemeinschaftsmodul ist «ausgeschaltet» hier kein sinnvoller Zustand. Ein
 * Backup-Bereich, den jemand aus Versehen abschaltet, nimmt der Anlage die
 * einzige Oberflaeche, an der man ihre Fehlschlaege sieht - und ein
 * Fehlschlag, den niemand sieht, ist der, der im Ernstfall zaehlt.
 *
 * Ohne `settings`: die Backup-Konfiguration liegt ausdruecklich AUSSERHALB der
 * Reichweite der WebApp, in `/etc/swisshub-backup/`. Das ist eine
 * Sicherheitseigenschaft und kein fehlendes Feature - eine kompromittierte
 * WebApp darf die Aufbewahrung nicht verkuerzen und das Backup-Ziel nicht
 * umlenken. Was sich gefahrlos verstellen laesst, geht ueber den Controller
 * und ist dort einzeln geprueft.
 */
export const backupModule: ModuleDefinition = registerModule({
  id: BACKUP_MODULE_ID,
  name: 'Backup & Recovery',
  description:
    'Zustand der Sicherungen, verfuegbare Wiederherstellungspunkte, Pruefungen, Restore-Tests und die Freigabe produktiver Wiederherstellungen.',
  icon: 'DatabaseBackup',
  permissionPrefix: 'backup',
  core: true,
  defaultEnabled: true,
  configVersion: 1,
  permissions: [
    {
      key: BACKUP_PERMISSIONS.view,
      label: 'Backup-Status ansehen',
      description:
        'Zustand der Sicherungen, Historie und Warnungen einsehen. Keine Werte von Schluesseln oder Zugangsdaten.',
      module: BACKUP_MODULE_ID,
    },
    {
      key: BACKUP_PERMISSIONS.run,
      label: 'Backup manuell starten',
      description:
        'Eine Sicherung ausser der Reihe anstossen. Kostet Rechenzeit und Speicherplatz, verliert aber nichts.',
      module: BACKUP_MODULE_ID,
    },
    {
      key: BACKUP_PERMISSIONS.settings,
      label: 'Backup-Einstellungen bearbeiten',
      description:
        'Aufbewahrungsfristen, Grenzwerte und Benachrichtigungen aendern. Speicherziele und Schluessel bleiben ausserhalb der WebApp.',
      module: BACKUP_MODULE_ID,
      critical: true,
    },
    {
      key: BACKUP_PERMISSIONS.points,
      label: 'Wiederherstellungspunkte ansehen',
      description:
        'Welche Sicherungen es gibt und welche Zeitpunkte erreichbar sind. Eigene Berechtigung, weil daraus hervorgeht, wann das System wie viele Daten hielt.',
      module: BACKUP_MODULE_ID,
    },
    {
      key: BACKUP_PERMISSIONS.test,
      label: 'Restore-Test ausfuehren',
      description:
        'Eine Sicherung in einer isolierten Testumgebung wiederherstellen. Beruehrt die Produktion nicht, belastet den Server aber deutlich.',
      module: BACKUP_MODULE_ID,
    },
    {
      key: BACKUP_PERMISSIONS.restoreRequest,
      label: 'Produktiven Restore anfordern',
      description:
        'Eine produktive Wiederherstellung zur Freigabe anmelden. Loest allein nichts aus - es braucht eine zweite Person.',
      module: BACKUP_MODULE_ID,
      critical: true,
    },
    {
      key: BACKUP_PERMISSIONS.restoreApprove,
      label: 'Produktiven Restore autorisieren',
      description:
        'Die zweite Zustimmung zu einer produktiven Wiederherstellung. Danach darf sie auf der Kommandozeile ausgefuehrt werden und verwirft alles nach dem Zielzeitpunkt.',
      module: BACKUP_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/system/backup',
      label: 'Backup & Recovery',
      description: 'Sicherungen, Wiederherstellungspunkte und der Notfallplan',
      permission: BACKUP_PERMISSIONS.view,
      icon: 'DatabaseBackup',
      group: 'system',
      // Vor «Integrationen» (80) und nach «Discord-Sync» (79): der Bereich
      // gehoert zu den Grundlagen des Betriebs und nicht ans Ende der Liste.
      order: 77,
    },
  ],
});
