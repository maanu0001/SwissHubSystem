import type { PermissionDefinition } from '@swisshub/permissions';

/**
 * Berechtigungen des Moderation Center.
 *
 * `moderation.view` und `moderation.execute` gab es schon; sie bleiben, was
 * sie waren - die Sicht auf die Historie und das allgemeine Recht zu
 * moderieren. Was dazukommt, ist die Aufteilung nach Massnahme: ein Bann ist
 * etwas anderes als ein Timeout, und wer das eine darf, muss nicht das andere
 * duerfen.
 *
 * Jail bleibt bei seinen eigenen Berechtigungen. Ein zweiter Schluessel fuer
 * dieselbe Handlung waere eine zweite Wahrheit.
 */
export const MODERATION_PERMISSIONS = {
  view: 'moderation.view',
  execute: 'moderation.execute',

  ban: 'moderation.ban',
  unban: 'moderation.unban',
  kick: 'moderation.kick',
  timeout: 'moderation.timeout',
  timeoutRemove: 'moderation.timeout.remove',

  /*
   * Das oeffentliche Profil sperren und entsperren.
   *
   * Getrennt, aus demselben Grund wie Bann und Bann-Aufhebung: sperren ist
   * eine Massnahme, entsperren nimmt die Entscheidung eines anderen zurueck.
   * Wer das eine darf, muss deshalb nicht das andere duerfen.
   *
   * Beide im Moderationsmodul und nicht im Mitgliederbereich: es ist eine
   * Massnahme gegen ein Mitglied, sie steht in derselben Akte wie Bann und
   * Timeout, und sie laeuft durch dieselbe Rangfolgepruefung.
   */
  profileLock: 'moderation.profile.lock',
  profileUnlock: 'moderation.profile.unlock',

  historyView: 'moderation.history.view',
  notesCreate: 'moderation.notes.create',
  settingsManage: 'moderation.settings',
} as const;

const eintrag = (
  key: string,
  label: string,
  description: string,
  critical = false,
): PermissionDefinition => ({
  key,
  label,
  description,
  module: 'moderation',
  ...(critical ? { critical } : {}),
});

export const MODERATION_CENTER_PERMISSIONS: PermissionDefinition[] = [
  eintrag(
    MODERATION_PERMISSIONS.ban,
    'Bannen',
    'Mitglieder vom Server bannen. Ein Bann gilt, bis ihn jemand aufhebt.',
    true,
  ),
  eintrag(MODERATION_PERMISSIONS.unban, 'Bann aufheben', 'Einen bestehenden Bann aufheben.', true),
  eintrag(
    MODERATION_PERMISSIONS.kick,
    'Kicken',
    'Mitglieder vom Server entfernen. Sie können sofort wiederkommen.',
    true,
  ),
  eintrag(
    MODERATION_PERMISSIONS.timeout,
    'Timeout setzen',
    'Mitglieder für eine begrenzte Zeit stummschalten (Discord-Timeout, höchstens 28 Tage).',
  ),
  eintrag(
    MODERATION_PERMISSIONS.timeoutRemove,
    'Timeout aufheben',
    'Einen laufenden Timeout vorzeitig beenden.',
  ),
  eintrag(
    MODERATION_PERMISSIONS.profileLock,
    'Öffentliches Profil sperren',
    'Die öffentliche Profilseite eines Mitglieds vom Netz nehmen. Intern bleibt das Mitglied verwaltbar, und das Mitglied selbst sieht sein Profil weiterhin.',
    true,
  ),
  eintrag(
    MODERATION_PERMISSIONS.profileUnlock,
    'Profilsperre aufheben',
    'Eine bestehende Sperre des öffentlichen Profils aufheben.',
  ),
  eintrag(
    MODERATION_PERMISSIONS.historyView,
    'Moderationsakte ansehen',
    'Die vollständige Moderationshistorie eines Mitglieds einsehen.',
  ),
  eintrag(
    MODERATION_PERMISSIONS.notesCreate,
    'Moderationsnotiz schreiben',
    'Eine interne Notiz in der Moderationsakte hinterlegen.',
  ),
  eintrag(
    MODERATION_PERMISSIONS.settingsManage,
    'Moderations-Einstellungen',
    'Die Einstellungen des Moderationsbereichs ändern.',
    true,
  ),
];
