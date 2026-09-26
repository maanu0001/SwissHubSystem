/**
 * Menschliche Namen fuer die Audit-Aktionen.
 *
 * ## Warum eine vollstaendige Liste
 *
 * Es gab schon eine - mit dreissig Eintraegen fuer zweihundertsechsundzwanzig
 * Aktionen. Alles ohne Eintrag stand als `TICKET_STATUS_CHANGED` in der
 * Liste, und wer das Log las, uebersetzte im Kopf. Eine Aktion ohne Namen ist
 * schlimmer als keine Aktion: sie sieht aus wie ein Fehler.
 *
 * Aus einem Muster abzuleiten waere kuerzer gewesen und haette Deutsch
 * ergeben, das niemand schreiben wuerde («Ticket Status Geaendert»). Also
 * ausgeschrieben, einmal, an einer Stelle.
 *
 * Der technische Schluessel verschwindet dadurch nicht - er steht in den
 * Details jedes Eintrags.
 */
export const AUDIT_LABELS: Readonly<Record<string, string>> = {
  // --- Anmeldung und Sitzung ------------------------------------------------
  LOGIN: 'Anmeldung',
  LOGIN_DENIED: 'Anmeldung abgelehnt',
  LOGOUT: 'Abmeldung',
  SESSION_REVOKED: 'Sitzung beendet',
  PERMISSION_DENIED: 'Berechtigung verweigert',
  RATE_LIMITED: 'Zu viele Anfragen',
  PREVIEW_STARTED: 'Vorschau gestartet',
  PREVIEW_ENDED: 'Vorschau beendet',

  // --- Einstellungen und Module ---------------------------------------------
  SETTING_CHANGED: 'Einstellung geändert',
  ROLE_MAPPING_CHANGED: 'Rollenzuordnung geändert',
  MODULE_ENABLED: 'Modul eingeschaltet',
  MODULE_DISABLED: 'Modul ausgeschaltet',
  MODULE_SETTINGS_CHANGED: 'Moduleinstellungen geändert',
  BRANDING_LOGO_UPDATED: 'Logo aktualisiert',
  BRANDING_LOGO_RESET: 'Logo zurückgesetzt',
  RECONCILIATION_RUN: 'Abgleich ausgeführt',
  DISCORD_ACTION_FAILED: 'Discord-Aktion fehlgeschlagen',
  LOG_CHANNEL_CONFIG_CHANGED: 'Log-Kanal geändert',
  LOG_CHANNEL_DISABLED: 'Log-Kanal abgeschaltet',
  LOG_CHANNEL_TEST_SENT: 'Log-Testnachricht gesendet',

  // --- Moderation ------------------------------------------------------------
  MODERATION_BAN: 'Gebannt',
  MODERATION_UNBAN: 'Bann aufgehoben',
  MODERATION_KICK: 'Gekickt',
  MODERATION_TIMEOUT: 'Timeout gesetzt',
  MODERATION_TIMEOUT_REMOVE: 'Timeout aufgehoben',
  MODERATION_NOTE: 'Notiz zur Akte',
  MODERATION_EXTERNAL_ACTION_DETECTED: 'Massnahme ausserhalb erkannt',

  // --- Jail ------------------------------------------------------------------
  JAIL_CREATED: 'Jail verhängt',
  JAIL_RELEASED: 'Jail beendet',
  JAIL_PURGED: 'Alle Jails aufgehoben',
  JAIL_FAILED: 'Jail fehlgeschlagen',
  JAIL_RECONCILED: 'Jail abgeglichen',
  JAIL_PENDING_REJOIN: 'Jail wartet auf Wiedereintritt',
  JAIL_REAPPLIED: 'Jail erneut verhängt',
  JAIL_REAPPLY_FAILED: 'Erneutes Jail fehlgeschlagen',
  JAIL_IMPORT_UPLOADED: 'Jail-Import hochgeladen',
  JAIL_IMPORT_CONFIRMED: 'Jail-Import bestätigt',
  JAIL_IMPORT_COMPLETED: 'Jail-Import abgeschlossen',
  JAIL_IMPORT_FAILED: 'Jail-Import fehlgeschlagen',
  JAIL_IMPORT_DISCARDED: 'Jail-Import verworfen',
  VOTE_JAIL_STARTED: 'Abstimmung über Jail gestartet',
  VOTE_JAIL_SUCCEEDED: 'Abstimmung über Jail angenommen',
  VOTE_JAIL_FAILED: 'Abstimmung über Jail ohne Ergebnis',
  VOTE_JAIL_BLOCKED: 'Abstimmung über Jail blockiert',

  // --- Mitglieder ------------------------------------------------------------
  MEMBERS_SEARCHED: 'Mitglieder gesucht',
  MEMBER_ROLE_GRANTED: 'Rolle vergeben',
  MEMBER_ROLE_REVOKED: 'Rolle entzogen',
  MEMBER_NOTE_CREATED: 'Mitgliedsnotiz erstellt',
  MEMBER_NOTE_UPDATED: 'Mitgliedsnotiz geändert',
  MEMBER_NOTE_DELETED: 'Mitgliedsnotiz gelöscht',

  // --- Verifikation ----------------------------------------------------------
  VERIFICATION_STARTED: 'Verifikation begonnen',
  VERIFICATION_MESSAGE_RECEIVED: 'Verifikationsnachricht erhalten',
  VERIFICATION_AI_STARTED: 'AI-Prüfung gestartet',
  VERIFICATION_AI_VERIFIED: 'Durch die AI freigeschaltet',
  VERIFICATION_HUMAN_VERIFIED: 'Freigeschaltet',
  VERIFICATION_REJECTED: 'Verifikation abgelehnt',
  VERIFICATION_EXPIRED: 'Verifikation abgelaufen',
  VERIFICATION_TIMEOUT_KICK: 'Nach Ablauf entfernt',
  VERIFICATION_REMINDER_SENT: 'An Verifikation erinnert',
  VERIFICATION_LEFT_SERVER: 'Während der Verifikation gegangen',
  VERIFICATION_CLEANUP: 'Verifikationskanal aufgeräumt',
  VERIFICATION_SUCCESS_POSTED: 'Freischaltung gemeldet',
  VERIFICATION_SUCCESS_POST_FAILED: 'Meldung der Freischaltung fehlgeschlagen',
  VERIFICATION_ERROR: 'Fehler in der Verifikation',

  // --- Tickets ---------------------------------------------------------------
  TICKET_CREATED: 'Ticket eröffnet',
  TICKET_CLAIMED: 'Ticket übernommen',
  TICKET_CLOSED: 'Ticket geschlossen',
  TICKET_REOPENED: 'Ticket wieder geöffnet',
  TICKET_AUTO_CLOSED: 'Ticket automatisch geschlossen',
  TICKET_ARCHIVED: 'Ticket archiviert',
  TICKET_DELETED: 'Ticket gelöscht',
  TICKET_STATUS_CHANGED: 'Ticketstatus geändert',
  TICKET_PRIORITY_CHANGED: 'Ticketpriorität geändert',
  TICKET_PARTICIPANT_ADDED: 'Person zum Ticket hinzugefügt',
  TICKET_PARTICIPANT_REMOVED: 'Person aus dem Ticket entfernt',
  TICKET_BLOCKED: 'Für Tickets gesperrt',
  TICKET_UNBLOCKED: 'Ticketsperre aufgehoben',
  TICKET_TRANSCRIPT_CREATED: 'Ticketverlauf gesichert',
  TICKET_RECONCILED: 'Tickets abgeglichen',
  TICKET_RETENTION_PURGED: 'Alte Tickets gelöscht',
  TICKET_CHANNEL_FAILED: 'Ticketkanal fehlgeschlagen',
  TICKET_CATEGORY_CREATED: 'Ticketkategorie erstellt',
  TICKET_CATEGORY_UPDATED: 'Ticketkategorie geändert',
  TICKET_CATEGORY_DELETED: 'Ticketkategorie gelöscht',
  TICKET_PANEL_CREATED: 'Ticket-Panel erstellt',
  TICKET_PANEL_UPDATED: 'Ticket-Panel geändert',
  TICKET_PANEL_DELETED: 'Ticket-Panel gelöscht',
  TICKET_PANEL_PUBLISHED: 'Ticket-Panel veröffentlicht',

  // --- Einsprüche ------------------------------------------------------------
  APPEAL_SUBMITTED: 'Einspruch eingereicht',
  APPEAL_ASSIGNED: 'Einspruch zugewiesen',
  APPEAL_APPROVED: 'Einspruch angenommen',
  APPEAL_REJECTED: 'Einspruch abgelehnt',
  APPEAL_CLOSED: 'Einspruch geschlossen',
  APPEAL_WITHDRAWN: 'Einspruch zurückgezogen',
  APPEAL_EXPIRED: 'Einspruch abgelaufen',
  APPEAL_STATUS_CHANGED: 'Einspruchstatus geändert',
  APPEAL_PRIORITY_CHANGED: 'Einspruchpriorität geändert',
  APPEAL_DECISION_PROPOSED: 'Entscheidung vorgeschlagen',
  APPEAL_APPLICANT_REPLIED: 'Antragsteller hat geantwortet',
  APPEAL_STAFF_MESSAGE: 'Nachricht an den Antragsteller',
  APPEAL_INTERNAL_COMMENT: 'Interner Kommentar',
  APPEAL_ATTACHMENT_DOWNLOADED: 'Anhang heruntergeladen',
  APPEAL_UNBAN_ATTEMPTED: 'Entbannung versucht',
  APPEAL_UNBAN_SUCCEEDED: 'Entbannung erfolgreich',
  APPEAL_UNBAN_FAILED: 'Entbannung fehlgeschlagen',

  // --- Level und XP ----------------------------------------------------------
  LEVEL_XP_GRANTED: 'XP gutgeschrieben',
  LEVEL_XP_REVOKED: 'XP abgezogen',
  LEVEL_RESET: 'Level zurückgesetzt',
  LEVEL_DECAY_RUN: 'Inaktivitätsabzug gelaufen',
  LEVEL_GAME_CANCELLED: 'XP-Spiel abgebrochen',
  LEVEL_CARD_BANNER_CHANGED: 'Kartenhintergrund geändert',
  LEVEL_CUSTOM_CARD_CHANGED: 'Eigene Levelkarte geändert',
  LEVEL_MILESTONE_CREATED: 'Meilenstein erstellt',
  LEVEL_MILESTONE_UPDATED: 'Meilenstein geändert',
  LEVEL_MILESTONE_DELETED: 'Meilenstein gelöscht',
  LEVEL_MILESTONES_RECONCILED: 'Meilensteine abgeglichen',
  LEVEL_IMPORT_STARTED: 'Level-Import gestartet',
  LEVEL_IMPORT_CONFIRMED: 'Level-Import bestätigt',
  LEVEL_IMPORT_COMPLETED: 'Level-Import abgeschlossen',
  LEVEL_IMPORT_FAILED: 'Level-Import fehlgeschlagen',
  LEVEL_IMPORT_DISCARDED: 'Level-Import verworfen',
  XP_RAFFLE_CREATED: 'XP-Verlosung erstellt',
  XP_RAFFLE_UPDATED: 'XP-Verlosung geändert',
  XP_RAFFLE_DELETED: 'XP-Verlosung gelöscht',
  XP_RAFFLE_PUBLISHED: 'XP-Verlosung veröffentlicht',
  XP_RAFFLE_CANCELLED: 'XP-Verlosung abgebrochen',
  XP_RAFFLE_ENTRY_OPENED: 'Teilnahme geöffnet',
  XP_RAFFLE_ENTRY_CLOSED: 'Teilnahme geschlossen',
  XP_RAFFLE_ENTRY_REMOVED: 'Teilnahme entfernt',
  XP_RAFFLE_DRAW_STARTED: 'Ziehung gestartet',
  XP_RAFFLE_WINNER_DRAWN: 'Gewinn gezogen',
  XP_RAFFLE_WINNER_CONFIRMED: 'Gewinn bestätigt',
  XP_RAFFLE_REDRAW: 'Neu gezogen',
  XP_RAFFLE_REFUND: 'Einsatz erstattet',
  XP_RAFFLE_ANNOUNCEMENT_REPUBLISHED: 'Ankündigung erneut veröffentlicht',

  // --- Kalender --------------------------------------------------------------
  CALENDAR_EVENT_CREATED: 'Event erstellt',
  CALENDAR_EVENT_UPDATED: 'Event geändert',
  CALENDAR_EVENT_DELETED: 'Event gelöscht',
  CALENDAR_EVENT_PUBLISHED: 'Event veröffentlicht',
  CALENDAR_EVENT_CANCELLED: 'Event abgesagt',
  CALENDAR_ANNOUNCED: 'Event angekündigt',
  CALENDAR_REMINDER_SENT: 'Erinnerung gesendet',
  CALENDAR_PARTICIPANTS_NOTIFIED: 'Teilnehmende benachrichtigt',
  CALENDAR_REGISTRATION_REMOVED: 'Anmeldung entfernt',
  CALENDAR_CATEGORY_SAVED: 'Eventkategorie gespeichert',

  // --- Turniere --------------------------------------------------------------
  TOURNAMENT_CREATED: 'Turnier erstellt',
  TOURNAMENT_PUBLISHED: 'Turnier veröffentlicht',
  TOURNAMENT_STARTED: 'Turnier gestartet',
  TOURNAMENT_PAUSED: 'Turnier pausiert',
  TOURNAMENT_COMPLETED: 'Turnier abgeschlossen',
  TOURNAMENT_CANCELLED: 'Turnier abgesagt',
  TOURNAMENT_ARCHIVED: 'Turnier archiviert',
  TOURNAMENT_BRACKET_GENERATED: 'Turnierbaum erstellt',
  TOURNAMENT_BRACKET_RESEEDED: 'Turnierbaum neu gesetzt',
  TOURNAMENT_MATCH_RESULT_OVERRIDDEN: 'Matchergebnis korrigiert',
  TOURNAMENT_DISPUTE_RESOLVED: 'Einspruch im Turnier entschieden',
  TOURNAMENT_REGISTRATION_APPROVED: 'Turnieranmeldung angenommen',
  TOURNAMENT_REGISTRATION_REMOVED: 'Turnieranmeldung entfernt',
  TOURNAMENT_TEAM_UPDATED: 'Team geändert',
  TOURNAMENT_TEAM_DISQUALIFIED: 'Team disqualifiziert',
  TOURNAMENT_STAFF_CHANGED: 'Turnierleitung geändert',
  TOURNAMENT_PRIZE_UPDATED: 'Preise geändert',
  TOURNAMENT_BLOCKED: 'Für Turniere gesperrt',
  TOURNAMENT_UNBLOCKED: 'Turniersperre aufgehoben',

  // --- Automationen ----------------------------------------------------------
  AUTOMATION_CREATED: 'Automation erstellt',
  AUTOMATION_UPDATED: 'Automation geändert',
  AUTOMATION_DELETED: 'Automation gelöscht',
  AUTOMATION_ENABLED: 'Automation eingeschaltet',
  AUTOMATION_DISABLED: 'Automation ausgeschaltet',
  AUTOMATION_EXECUTED: 'Automation ausgeführt',
  AUTOMATION_APPROVAL_GRANTED: 'Automation freigegeben',
  AUTOMATION_APPROVAL_REJECTED: 'Freigabe verweigert',

  // --- Kommunikation ---------------------------------------------------------
  COMMUNICATION_NEWS_SENT: 'Neuigkeiten gesendet',
  COMMUNICATION_EVENT_SENT: 'Event gesendet',
  COMMUNICATION_POLL_SENT: 'Umfrage gesendet',
  COMMUNICATION_MESSAGE_EDITED: 'Nachricht bearbeitet',
  COMMUNICATION_MESSAGE_DELETED: 'Nachricht gelöscht',
  COMMUNICATION_DRAFT_SAVED: 'Entwurf gespeichert',
  COMMUNICATION_SEND_FAILED: 'Senden fehlgeschlagen',
  COMMUNICATION_SETTINGS_CHANGED: 'Kommunikationseinstellungen geändert',

  // --- Spielekatalog ---------------------------------------------------------
  GAME_CREATED: 'Spiel angelegt',
  GAME_UPDATED: 'Spiel geändert',
  GAME_ARCHIVED: 'Spiel archiviert',
  GAME_RESTORED: 'Spiel zurückgeholt',

  /*
   * --- Spielersuche ----------------------------------------------------------
   *
   * Das Modul gibt es nicht mehr; diese Namen schon. Sie stehen in
   * vorhandenen Protokollzeilen, und das Audit Log ist eine Beweiskette -
   * wer sie entfernte, machte Monate an Eintraegen unleserlich.
   */
  SPIELERSUCHE_CREATED: 'Spielersuche erstellt',
  SPIELERSUCHE_JOINED: 'Spielersuche beigetreten',
  SPIELERSUCHE_LEFT: 'Spielersuche verlassen',
  SPIELERSUCHE_CLOSED: 'Spielersuche geschlossen',
  SPIELERSUCHE_EXPIRED: 'Spielersuche abgelaufen',
  SPIELERSUCHE_FAILED: 'Spielersuche fehlgeschlagen',
  SPIELERSUCHE_GAME_CREATED: 'Spiel erstellt',
  SPIELERSUCHE_GAME_UPDATED: 'Spiel geändert',
  SPIELERSUCHE_GAME_DELETED: 'Spiel gelöscht',
  SPIELERSUCHE_ONBOARDING_SENT: 'Einführung gesendet',
  SPIELERSUCHE_IMPORT_STARTED: 'Import gestartet',
  SPIELERSUCHE_IMPORT_CONFIRMED: 'Import bestätigt',
  SPIELERSUCHE_IMPORT_COMPLETED: 'Import abgeschlossen',
  SPIELERSUCHE_IMPORT_FAILED: 'Import fehlgeschlagen',
  SPIELERSUCHE_IMPORT_DISCARDED: 'Import verworfen',

  // --- Sprachkanäle ----------------------------------------------------------
  VOICE_HUB_CHANGED: 'Voice Hub geändert',
  VOICE_OWNER_CHANGED: 'Talk übergeben',
  VOICE_PRESET_CHANGED: 'Voice-Vorlage geändert',
  VOICE_TALK_DELETED: 'Talk gelöscht',

  // --- Premium ---------------------------------------------------------------
  PREMIUM_CHECKOUT_STARTED: 'Bezahlvorgang gestartet',
  PREMIUM_PLAN_UPDATED: 'Premium-Plan geändert',
  PREMIUM_SUBSCRIPTION_GIFTED: 'Premium verschenkt',
  PREMIUM_SUBSCRIPTION_CANCELLED: 'Abonnement gekündigt',
  PREMIUM_SUBSCRIPTION_RESUMED: 'Abonnement fortgesetzt',
  PREMIUM_MANUAL_SYNC: 'Premium von Hand abgeglichen',
  PREMIUM_STUEBLI_REMOVED: 'Stübli entfernt',
  PREMIUM_STUEBLI_REPAIR: 'Stübli repariert',

  // --- Integrationen ---------------------------------------------------------
  INTEGRATION_SETTINGS_UPDATED: 'Integration geändert',
  INTEGRATION_SECRET_UPDATED: 'Zugangsdaten hinterlegt',
  INTEGRATION_SECRET_DELETED: 'Zugangsdaten entfernt',
  INTEGRATION_TESTED: 'Integration geprüft',
  INTEGRATION_ENV_IMPORTED: 'Konfiguration übernommen',
  INTEGRATION_BOT_CREATED: 'Bot hinterlegt',
  INTEGRATION_BOT_UPDATED: 'Bot geändert',
  INTEGRATION_BOT_DELETED: 'Bot entfernt',
  INTEGRATION_BOT_TOKEN_ROTATED: 'Bot-Token erneuert',

  // --- Migration -------------------------------------------------------------
  MIGRATION_CREATED: 'Migration angelegt',
  MIGRATION_STARTED: 'Migration gestartet',
  MIGRATION_IMPORTED: 'Daten eingelesen',
  MIGRATION_MAPPED: 'Zuordnung gespeichert',
  MIGRATION_DRY_RUN: 'Probelauf',
  MIGRATION_APPLIED: 'Migration übernommen',
  MIGRATION_COMPLETED: 'Migration abgeschlossen',
  MIGRATION_ROLLED_BACK: 'Migration zurückgenommen',
  MIGRATION_FAILED: 'Migration fehlgeschlagen',
  MIGRATION_EXPORTED: 'Migration exportiert',

  // --- Clips -----------------------------------------------------------------
  CLIP_COMPETITION_CREATED: 'Clip-Runde eröffnet',
  PROFILE_AWARD_GRANTED: 'Auszeichnung verliehen',
  PROFILE_AWARD_REVOKED: 'Auszeichnung entzogen',
  PROFILE_AWARD_TYPE_CREATED: 'Auszeichnung angelegt',
  PROFILE_AWARD_TYPE_UPDATED: 'Auszeichnung bearbeitet',
  PROFILE_AWARD_TYPE_ARCHIVED: 'Auszeichnung archiviert',
  PROFILE_AWARD_TYPE_RESTORED: 'Auszeichnung zurückgeholt',
  PROFILE_AWARD_TYPE_DELETED: 'Auszeichnung entfernt',
  PROFILE_ADMIN_EDITED: 'Fremdes Profil bearbeitet',
  PROFILE_THEME_CHANGED: 'Profil-Design gewechselt',
  PROFILE_COMPUTED_AWARD_EDITED: 'Gerechnete Auszeichnung angepasst',
  PROFILE_COMPUTED_AWARD_ARCHIVED: 'Gerechnete Auszeichnung abgeschaltet',
  PROFILE_COMPUTED_AWARD_RESTORED: 'Gerechnete Auszeichnung wieder aktiv',
  PROFILE_COMPUTED_AWARD_RESET: 'Gerechnete Auszeichnung zurückgesetzt',
  MODERATION_PROFILE_LOCK: 'Öffentliches Profil gesperrt',
  MODERATION_PROFILE_UNLOCK: 'Profilsperre aufgehoben',
  CLIP_WINNER_REWARDED: 'Clip-Gewinner belohnt',
  CLIP_COMPETITION_FINALIZED: 'Clip-Runde abgeschlossen',
  CLIP_COMPETITION_CANCELLED: 'Clip-Runde abgebrochen',
  CLIP_COMPETITION_REOPENED: 'Clip-Runde wieder aktiviert',
  CLIP_COMPETITION_UPDATED: 'Clip-Runde geändert',
  CLIP_SUBMITTED: 'Clip eingereicht',
  CLIP_APPROVED: 'Clip freigegeben',
  CLIP_REJECTED: 'Clip abgelehnt',
  CLIP_REMOVED: 'Clip entfernt',
  CLIP_REPORTED: 'Clip gemeldet',
  CLIP_REPORT_RESOLVED: 'Clip-Meldung bearbeitet',

  // --- SwissHub Wrapped ------------------------------------------------------
  WRAPPED_CAMPAIGN_CREATED: 'Rückblick angelegt',
  WRAPPED_CAMPAIGN_UPDATED: 'Rückblick geändert',
  WRAPPED_SCENES_UPDATED: 'Szenen des Rückblicks geändert',
  WRAPPED_GENERATION_STARTED: 'Momentaufnahmen gestartet',
  WRAPPED_GENERATION_FINISHED: 'Momentaufnahmen abgeschlossen',
  WRAPPED_PUBLISHED: 'Rückblick veröffentlicht',
  WRAPPED_UNPUBLISHED: 'Rückblick zurückgezogen',
  WRAPPED_ARCHIVED: 'Rückblick archiviert',
  WRAPPED_SNAPSHOT_REBUILT: 'Momentaufnahme neu erzeugt',

  // Die periodischen Ausgaben - Monat und Jahr. «Ausgabe» und nicht
  // «Rückblick»: die Zeilen darüber gehören dem persönlichen Jahresrückblick,
  // und im Protokoll nebeneinander wäre sonst nicht zu erkennen, welches von
  // beiden gemeint ist.
  WRAPPED_EDITION_CREATED: 'Wrapped-Ausgabe erhoben',
  WRAPPED_EDITION_REGENERATED: 'Wrapped-Ausgabe neu erhoben',
  WRAPPED_EDITION_FINALIZED: 'Wrapped-Ausgabe eingefroren',
  WRAPPED_EDITION_UNLOCKED: 'Wrapped-Ausgabe entsperrt',
  WRAPPED_EDITION_PUBLISHED: 'Wrapped-Ausgabe als veröffentlicht markiert',
  WRAPPED_SLIDE_ENABLED: 'Folie eingeschaltet',
  WRAPPED_SLIDE_DISABLED: 'Folie ausgeschaltet',
  WRAPPED_MOMENT_CREATED: 'Community Moment erfasst',
  WRAPPED_MOMENT_UPDATED: 'Community Moment geändert',
  WRAPPED_MOMENT_DELETED: 'Community Moment gelöscht',

  SPIELWAHL_SESSION_CREATED: 'Spielwahl eröffnet',
  SPIELWAHL_SESSION_CLOSED: 'Spielwahl beendet',
  SPIELWAHL_PARTICIPANT_REMOVED: 'Aus der Spielwahl entfernt',
  SPIELWAHL_HOST_TRANSFERRED: 'Spielwahl übergeben',

  // --- Statistik -------------------------------------------------------------
  ANALYTICS_EXPORT: 'Statistik exportiert',
  ANALYTICS_MEDIA_DOWNLOAD: 'Datei aus dem Archiv geladen',
};

/**
 * Der Name einer Aktion - oder der Schluessel, wenn es keinen gibt.
 *
 * Der Rueckfall ist Absicht: eine neu hinzugefuegte Aktion soll im Log
 * auftauchen, auch bevor jemand ihr einen Namen gegeben hat. Ein Test haelt
 * fest, dass die Liste vollstaendig ist - damit dieser Rueckfall die Ausnahme
 * bleibt und nicht der Normalfall wird.
 */
export function auditActionLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}
