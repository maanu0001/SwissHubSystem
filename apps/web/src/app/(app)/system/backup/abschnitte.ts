import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { backup } from '@swisshub/modules';
import type { BackupAbschnitt } from '@/modules/backup/components/abschnitts-nav';

/**
 * Die Reiterleiste von Backup & Recovery.
 *
 * An einer Stelle, weil sie auf sechs Seiten erscheint - und weil sechs
 * Kopien davon beim naechsten Abschnitt zu fuenf Kopien und einer Luecke
 * werden.
 *
 * Gefiltert wird nach Berechtigung, damit niemand auf einen Reiter klickt und
 * eine 403-Seite bekommt. Das ist Bequemlichkeit und keine Sicherheit - jede
 * Seite prueft serverseitig selbst.
 */
export function backupAbschnitte(
  context: AuthContext,
  zaehler: { offeneFreigaben?: number; befunde?: number } = {},
): BackupAbschnitt[] {
  const P = backup.BACKUP_PERMISSIONS;
  const abschnitte: BackupAbschnitt[] = [
    {
      href: '/system/backup',
      label: 'Übersicht',
      ...(zaehler.befunde ? { warnung: true } : {}),
    },
    { href: '/system/backup/historie', label: 'Historie' },
  ];

  if (can(context, P.points)) {
    abschnitte.push({
      href: '/system/backup/recovery',
      label: 'Recovery Center',
      ...(zaehler.offeneFreigaben ? { badge: zaehler.offeneFreigaben } : {}),
    });
  }
  if (can(context, P.settings) || can(context, P.view)) {
    abschnitte.push({ href: '/system/backup/einstellungen', label: 'Einstellungen' });
  }
  abschnitte.push({ href: '/system/backup/notfall', label: 'Notfall' });
  return abschnitte;
}
