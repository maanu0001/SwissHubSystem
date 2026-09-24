import { AUDIT_ACTIONS, type AuditActionName } from './audit-actions';

/**
 * Was auf das Dashboard gehoert - und was nur ins Protokoll.
 *
 * ## Zwei Zwecke, eine Quelle
 *
 * Das Audit-Protokoll ist eine Beweiskette: es haelt fest, was geschehen ist,
 * vollstaendig und ohne Auswahl. «Letzte Aktivitaeten» auf dem Dashboard ist
 * etwas anderes - ein Blick darauf, was in der Gemeinschaft gerade passiert.
 * Beide lesen dieselben Zeilen; nur die Auswahl unterscheidet sich.
 *
 * Vorher gab es keine Auswahl. Das Dashboard nahm die letzten sechs Eintraege,
 * und weil ein Hintergrunddurchgang alle fuenfzehn Minuten schreibt, standen
 * dort sechsmal «system hat eine Aktion ausgefuehrt». Der Ausweg waere leicht
 * gewesen und falsch: `actorUsername !== 'system'` filtert nach dem Namen des
 * Handelnden statt nach der Bedeutung des Ereignisses - und haette mit
 * «Ticket automatisch geschlossen» genau das verworfen, was interessiert.
 *
 * ## Deshalb eine Erlaubnisliste
 *
 * Aufgezaehlt wird, was **relevant** ist. Alles Uebrige erscheint nicht -
 * auch das, was morgen dazukommt. Eine Verbotsliste waere andersherum: jedes
 * neue technische Ereignis staende erst einmal auf dem Dashboard, bis es
 * jemandem auffaellt.
 *
 * Die Liste ist gegen `AuditActionName` typisiert. Ein Tippfehler ist damit ein
 * Fehler beim Uebersetzen und nicht eine Zeile, die stillschweigend nie
 * zutrifft.
 *
 * ## Der Massstab
 *
 * Aufgenommen wird, was eine **Person** getan hat oder was eine tatsaechlich
 * bedeutsame Zustandsaenderung ist - auch wenn ein Durchgang sie ausgeloest
 * hat. Nicht aufgenommen wird, was eine wiederkehrende Pruefung ohne
 * Ergebnis, ein Lebenszeichen oder ein interner Abgleich ist.
 *
 * Bewusst **nicht** dabei, obwohl es im Protokoll steht und dort hingehoert:
 *
 *   - `RECONCILIATION_RUN`, `TICKET_RECONCILED`, `LEVEL_MILESTONES_RECONCILED`,
 *     `JAIL_RECONCILED` - Abgleiche. Sie laufen nach der Uhr, nicht nach einem
 *     Anlass.
 *   - `JAIL_PENDING_REJOIN` - ein Wartezustand. Er aendert sich genau einmal
 *     und ist danach nur noch die Abwesenheit einer Aenderung.
 *   - `LEVEL_DECAY_RUN`, `VERIFICATION_CLEANUP`, `TICKET_RETENTION_PURGED` -
 *     Aufraeumen.
 *   - `MEMBERS_SEARCHED`, `PREVIEW_STARTED`, `ANALYTICS_EXPORT`,
 *     `APPEAL_ATTACHMENT_DOWNLOADED` - Lesevorgaenge. Sie gehoeren ins
 *     Protokoll, weil jemand spaeter fragen koennte, wer was gesehen hat;
 *     auf dem Dashboard waeren sie Rauschen.
 *   - `LOGIN`, `LOGOUT` - jede Anmeldung. Bei einem aktiven Team sind das
 *     mehr Zeilen als alles andere zusammen. `LOGIN_DENIED` und
 *     `PERMISSION_DENIED` stehen dagegen drin: ein abgewiesener Zugriff ist
 *     eine Nachricht.
 */
export const DASHBOARD_ACTIVITY_ACTIONS: readonly AuditActionName[] = [
  // --- Sicherheit und Zugang ------------------------------------------------
  AUDIT_ACTIONS.LOGIN_DENIED,
  AUDIT_ACTIONS.PERMISSION_DENIED,
  AUDIT_ACTIONS.SESSION_REVOKED,

  // --- Was am System geaendert wurde ---------------------------------------
  AUDIT_ACTIONS.SETTING_CHANGED,
  AUDIT_ACTIONS.ROLE_MAPPING_CHANGED,
  AUDIT_ACTIONS.MODULE_ENABLED,
  AUDIT_ACTIONS.MODULE_DISABLED,
  AUDIT_ACTIONS.MODULE_SETTINGS_CHANGED,
  AUDIT_ACTIONS.BRANDING_LOGO_UPDATED,
  AUDIT_ACTIONS.BRANDING_LOGO_RESET,

  // --- Moderation ----------------------------------------------------------
  AUDIT_ACTIONS.MODERATION_BAN,
  AUDIT_ACTIONS.MODERATION_UNBAN,
  AUDIT_ACTIONS.MODERATION_KICK,
  AUDIT_ACTIONS.MODERATION_TIMEOUT,
  AUDIT_ACTIONS.MODERATION_TIMEOUT_REMOVE,
  AUDIT_ACTIONS.MEMBER_ROLE_GRANTED,
  AUDIT_ACTIONS.MEMBER_ROLE_REVOKED,

  // --- Jail ----------------------------------------------------------------
  AUDIT_ACTIONS.JAIL_CREATED,
  AUDIT_ACTIONS.JAIL_RELEASED,
  AUDIT_ACTIONS.JAIL_FAILED,
  AUDIT_ACTIONS.JAIL_REAPPLIED,
  AUDIT_ACTIONS.VOTE_JAIL_STARTED,
  AUDIT_ACTIONS.VOTE_JAIL_SUCCEEDED,
  AUDIT_ACTIONS.VOTE_JAIL_FAILED,

  // --- Tickets -------------------------------------------------------------
  AUDIT_ACTIONS.TICKET_CREATED,
  AUDIT_ACTIONS.TICKET_CLAIMED,
  AUDIT_ACTIONS.TICKET_CLOSED,
  AUDIT_ACTIONS.TICKET_REOPENED,
  // Ausgeloest vom Durchgang - und trotzdem eine Nachricht: ein Ticket ist
  // zugegangen, ohne dass jemand geantwortet hat.
  AUDIT_ACTIONS.TICKET_AUTO_CLOSED,
  AUDIT_ACTIONS.TICKET_BLOCKED,
  AUDIT_ACTIONS.TICKET_UNBLOCKED,

  // --- Entbannungsantraege --------------------------------------------------
  AUDIT_ACTIONS.APPEAL_SUBMITTED,
  AUDIT_ACTIONS.APPEAL_APPROVED,
  AUDIT_ACTIONS.APPEAL_REJECTED,
  AUDIT_ACTIONS.APPEAL_WITHDRAWN,

  // --- Verifikation ---------------------------------------------------------
  AUDIT_ACTIONS.VERIFICATION_HUMAN_VERIFIED,
  AUDIT_ACTIONS.VERIFICATION_AI_VERIFIED,
  AUDIT_ACTIONS.VERIFICATION_REJECTED,
  AUDIT_ACTIONS.VERIFICATION_TIMEOUT_KICK,

  // --- Kommunikation --------------------------------------------------------
  AUDIT_ACTIONS.COMMUNICATION_NEWS_SENT,
  AUDIT_ACTIONS.COMMUNICATION_EVENT_SENT,
  AUDIT_ACTIONS.COMMUNICATION_POLL_SENT,
  AUDIT_ACTIONS.COMMUNICATION_MESSAGE_DELETED,

  // --- Community: was die Leute tun ----------------------------------------
  AUDIT_ACTIONS.CLIP_SUBMITTED,
  AUDIT_ACTIONS.CLIP_APPROVED,
  AUDIT_ACTIONS.CLIP_REJECTED,
  AUDIT_ACTIONS.CLIP_REPORTED,
  AUDIT_ACTIONS.CLIP_COMPETITION_FINALIZED,
  AUDIT_ACTIONS.CLIP_COMPETITION_CANCELLED,
  AUDIT_ACTIONS.CLIP_COMPETITION_REOPENED,

  AUDIT_ACTIONS.TOURNAMENT_PUBLISHED,
  AUDIT_ACTIONS.TOURNAMENT_STARTED,
  AUDIT_ACTIONS.TOURNAMENT_COMPLETED,
  AUDIT_ACTIONS.TOURNAMENT_CANCELLED,
  AUDIT_ACTIONS.TOURNAMENT_TEAM_DISQUALIFIED,
  AUDIT_ACTIONS.TOURNAMENT_DISPUTE_RESOLVED,

  AUDIT_ACTIONS.CALENDAR_EVENT_PUBLISHED,
  AUDIT_ACTIONS.CALENDAR_EVENT_CANCELLED,

  AUDIT_ACTIONS.XP_RAFFLE_PUBLISHED,
  AUDIT_ACTIONS.XP_RAFFLE_WINNER_DRAWN,
  AUDIT_ACTIONS.XP_RAFFLE_CANCELLED,

  AUDIT_ACTIONS.WRAPPED_PUBLISHED,
  AUDIT_ACTIONS.WRAPPED_UNPUBLISHED,

  AUDIT_ACTIONS.SPIELWAHL_SESSION_CREATED,

  // --- XP von Hand ----------------------------------------------------------
  AUDIT_ACTIONS.LEVEL_XP_GRANTED,
  AUDIT_ACTIONS.LEVEL_XP_REVOKED,
  AUDIT_ACTIONS.LEVEL_RESET,

  // --- Automationen ---------------------------------------------------------
  AUDIT_ACTIONS.AUTOMATION_APPROVAL_GRANTED,
  AUDIT_ACTIONS.AUTOMATION_APPROVAL_REJECTED,
] as const;

/** Schneller Nachschlag - die Liste ist lang genug, dass `includes` sich lohnt. */
const RELEVANT = new Set<string>(DASHBOARD_ACTIVITY_ACTIONS);

/**
 * Gehoert dieses Ereignis auf das Dashboard?
 *
 * Gefiltert wird damit **in der Abfrage**, nicht nach dem Laden: wer zuerst
 * sechs Zeilen holt und dann aussortiert, bekommt bei einem lebhaften
 * Protokoll regelmaessig null.
 */
export function istDashboardRelevant(action: string): boolean {
  return RELEVANT.has(action);
}
