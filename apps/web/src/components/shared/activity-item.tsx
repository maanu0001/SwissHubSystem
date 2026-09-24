import {
  BadgeCheck,
  Ban,
  Blocks,
  CalendarDays,
  CircleAlert,
  Clapperboard,
  Gamepad2,
  Gavel,
  Gift,
  KeyRound,
  Lock,
  Megaphone,
  LogIn,
  ScrollText,
  Settings,
  ShieldAlert,
  Sparkles,
  Ticket,
  Trophy,
  Unlock,
  UserMinus,
  UserPlus,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';

export interface ActivityItemData {
  id: string;
  action: string;
  createdAt: Date;
  actorUsername: string | null;
  actorDiscordId?: string | null;
  actorAvatarHash?: string | null;
  targetLabel: string | null;
  reason: string | null;
  success: boolean;
}

type Tone = 'accent' | 'success' | 'info' | 'warning' | 'destructive';

const TONE_CLASSES: Record<Tone, { chip: string; dot: string }> = {
  accent: { chip: 'border-primary/25 bg-primary/10 text-primary-bright', dot: 'bg-primary-bright' },
  success: { chip: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' },
  info: { chip: 'border-info/25 bg-info/10 text-info', dot: 'bg-info' },
  warning: { chip: 'border-warning/25 bg-warning/10 text-warning', dot: 'bg-warning' },
  destructive: {
    chip: 'border-destructive/25 bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
  },
};

/**
 * Darstellung je Audit-Aktion: Icon, Farbe und Satzbau.
 *
 * Die Liste deckt alles ab, was `DASHBOARD_ACTIVITY_ACTIONS` durchlaesst -
 * geprueft in `tests/unit/dashboard-aktivitaet.test.ts`. Der Grund steht
 * weiter unten bei `FALLBACK`: «hat eine Aktion ausgefuehrt» ist kein Satz,
 * sondern das Eingestaendnis, dass niemand einen formuliert hat.
 *
 * Auch ein vom Durchgang ausgeloestes Ereignis bekommt hier einen konkreten
 * Text. «Das System hat ein Ticket automatisch geschlossen» sagt etwas; der
 * Umstand, dass kein Mensch geklickt hat, macht es nicht bedeutungslos.
 *
 * `{target}` wird durch das Ziel ersetzt. Ohne Platzhalter steht das Ziel,
 * sofern vorhanden, hinter dem Satz - deshalb enden die Saetze ohne
 * Platzhalter so, dass ein angehaengter Name nicht stoert.
 */
const ACTION_VIEW: Record<string, { icon: LucideIcon; tone: Tone; verb: string }> = {
  // --- Sicherheit und Zugang ------------------------------------------------
  LOGIN: { icon: LogIn, tone: 'info', verb: 'hat sich angemeldet' },
  LOGOUT: { icon: LogIn, tone: 'info', verb: 'hat sich abgemeldet' },
  LOGIN_DENIED: { icon: CircleAlert, tone: 'destructive', verb: 'wurde abgewiesen' },
  PERMISSION_DENIED: { icon: ShieldAlert, tone: 'warning', verb: 'hatte keine Berechtigung für {target}' },
  SESSION_REVOKED: { icon: KeyRound, tone: 'warning', verb: 'hat die Sitzung von {target} beendet' },

  // --- System ---------------------------------------------------------------
  SETTING_CHANGED: { icon: Settings, tone: 'warning', verb: 'hat Einstellungen geändert' },
  ROLE_MAPPING_CHANGED: { icon: Settings, tone: 'warning', verb: 'hat Rollen angepasst' },
  MODULE_ENABLED: { icon: Blocks, tone: 'success', verb: 'hat das Modul {target} aktiviert' },
  MODULE_DISABLED: { icon: Blocks, tone: 'warning', verb: 'hat das Modul {target} deaktiviert' },
  MODULE_SETTINGS_CHANGED: { icon: Blocks, tone: 'warning', verb: 'hat Moduleinstellungen geändert' },
  BRANDING_LOGO_UPDATED: { icon: Settings, tone: 'info', verb: 'hat das Logo aktualisiert' },
  BRANDING_LOGO_RESET: { icon: Settings, tone: 'warning', verb: 'hat das Logo zurückgesetzt' },

  // --- Moderation -----------------------------------------------------------
  MODERATION_BAN: { icon: Ban, tone: 'destructive', verb: 'hat {target} gebannt' },
  MODERATION_UNBAN: { icon: BadgeCheck, tone: 'success', verb: 'hat den Bann von {target} aufgehoben' },
  MODERATION_KICK: { icon: UserMinus, tone: 'warning', verb: 'hat {target} vom Server entfernt' },
  MODERATION_TIMEOUT: { icon: Lock, tone: 'warning', verb: 'hat {target} stummgeschaltet' },
  MODERATION_TIMEOUT_REMOVE: {
    icon: Unlock,
    tone: 'success',
    verb: 'hat die Stummschaltung von {target} aufgehoben',
  },
  MEMBER_ROLE_GRANTED: { icon: UserPlus, tone: 'success', verb: 'hat {target} eine Rolle gegeben' },
  MEMBER_ROLE_REVOKED: { icon: UserMinus, tone: 'warning', verb: 'hat {target} eine Rolle entzogen' },

  // --- Jail -----------------------------------------------------------------
  JAIL_CREATED: { icon: Lock, tone: 'accent', verb: 'hat {target} gejailt' },
  JAIL_RELEASED: { icon: Unlock, tone: 'success', verb: 'hat {target} freigelassen' },
  JAIL_FAILED: { icon: CircleAlert, tone: 'destructive', verb: 'konnte {target} nicht jailen' },
  JAIL_REAPPLIED: {
    icon: Lock,
    tone: 'warning',
    verb: 'hat den Jail von {target} nach dem Wiedereintritt erneut gesetzt',
  },
  JAIL_RECONCILED: { icon: ShieldAlert, tone: 'warning', verb: 'hat {target} abgeglichen' },
  RECONCILIATION_RUN: { icon: ShieldAlert, tone: 'info', verb: 'hat einen Abgleich ausgeführt' },
  VOTE_JAIL_STARTED: { icon: Gavel, tone: 'accent', verb: 'hat einen Vote Jail gegen {target} gestartet' },
  VOTE_JAIL_SUCCEEDED: { icon: Gavel, tone: 'accent', verb: 'Vote Jail gegen {target} war erfolgreich' },
  VOTE_JAIL_FAILED: { icon: Gavel, tone: 'info', verb: 'Vote Jail gegen {target} blieb ohne Ergebnis' },

  // --- Tickets --------------------------------------------------------------
  TICKET_CREATED: { icon: Ticket, tone: 'info', verb: 'hat das Ticket {target} eröffnet' },
  TICKET_CLAIMED: { icon: Ticket, tone: 'accent', verb: 'hat das Ticket {target} übernommen' },
  TICKET_CLOSED: { icon: Ticket, tone: 'success', verb: 'hat das Ticket {target} geschlossen' },
  TICKET_REOPENED: { icon: Ticket, tone: 'warning', verb: 'hat das Ticket {target} wieder geöffnet' },
  TICKET_AUTO_CLOSED: {
    icon: Ticket,
    tone: 'info',
    verb: 'hat das Ticket {target} mangels Antwort automatisch geschlossen',
  },
  TICKET_BLOCKED: { icon: Ban, tone: 'warning', verb: 'hat {target} für Tickets gesperrt' },
  TICKET_UNBLOCKED: {
    icon: BadgeCheck,
    tone: 'success',
    verb: 'hat die Ticketsperre für {target} aufgehoben',
  },

  // --- Entbannungsanträge ---------------------------------------------------
  APPEAL_SUBMITTED: { icon: ScrollText, tone: 'info', verb: 'hat einen Entbannungsantrag gestellt' },
  APPEAL_APPROVED: { icon: BadgeCheck, tone: 'success', verb: 'hat den Antrag von {target} angenommen' },
  APPEAL_REJECTED: { icon: CircleAlert, tone: 'warning', verb: 'hat den Antrag von {target} abgelehnt' },
  APPEAL_WITHDRAWN: { icon: ScrollText, tone: 'info', verb: 'hat den eigenen Antrag zurückgezogen' },

  // --- Verifikation ---------------------------------------------------------
  VERIFICATION_HUMAN_VERIFIED: { icon: BadgeCheck, tone: 'success', verb: 'hat {target} verifiziert' },
  VERIFICATION_AI_VERIFIED: {
    icon: BadgeCheck,
    tone: 'success',
    verb: 'hat {target} automatisch verifiziert',
  },
  VERIFICATION_REJECTED: {
    icon: CircleAlert,
    tone: 'warning',
    verb: 'hat die Verifikation von {target} abgelehnt',
  },
  VERIFICATION_TIMEOUT_KICK: {
    icon: UserMinus,
    tone: 'warning',
    verb: 'hat {target} nach abgelaufener Verifikationsfrist entfernt',
  },

  // --- Kommunikation --------------------------------------------------------
  COMMUNICATION_NEWS_SENT: { icon: Megaphone, tone: 'info', verb: 'hat Neuigkeiten in {target} gesendet' },
  COMMUNICATION_EVENT_SENT: { icon: Megaphone, tone: 'info', verb: 'hat ein Event in {target} angekündigt' },
  COMMUNICATION_POLL_SENT: { icon: Megaphone, tone: 'info', verb: 'hat eine Umfrage in {target} gestartet' },
  COMMUNICATION_MESSAGE_DELETED: {
    icon: Megaphone,
    tone: 'warning',
    verb: 'hat eine Nachricht in {target} gelöscht',
  },

  // --- Clips ----------------------------------------------------------------
  CLIP_SUBMITTED: { icon: Clapperboard, tone: 'info', verb: 'hat einen Clip eingereicht' },
  CLIP_APPROVED: { icon: Clapperboard, tone: 'success', verb: 'hat den Clip von {target} freigegeben' },
  CLIP_REJECTED: { icon: Clapperboard, tone: 'warning', verb: 'hat den Clip von {target} abgelehnt' },
  CLIP_REPORTED: { icon: CircleAlert, tone: 'warning', verb: 'hat den Clip von {target} gemeldet' },
  CLIP_COMPETITION_FINALIZED: {
    icon: Trophy,
    tone: 'success',
    verb: 'hat die Clip-Runde {target} abgeschlossen',
  },
  CLIP_COMPETITION_CANCELLED: {
    icon: Clapperboard,
    tone: 'warning',
    verb: 'hat die Clip-Runde {target} abgebrochen',
  },
  CLIP_COMPETITION_REOPENED: {
    icon: Clapperboard,
    tone: 'accent',
    verb: 'hat die Clip-Runde {target} wieder aktiviert',
  },

  // --- Turniere -------------------------------------------------------------
  TOURNAMENT_PUBLISHED: { icon: Trophy, tone: 'info', verb: 'hat das Turnier {target} veröffentlicht' },
  TOURNAMENT_STARTED: { icon: Trophy, tone: 'accent', verb: 'hat das Turnier {target} gestartet' },
  TOURNAMENT_COMPLETED: { icon: Trophy, tone: 'success', verb: 'hat das Turnier {target} beendet' },
  TOURNAMENT_CANCELLED: { icon: Trophy, tone: 'warning', verb: 'hat das Turnier {target} abgesagt' },
  TOURNAMENT_TEAM_DISQUALIFIED: {
    icon: Ban,
    tone: 'warning',
    verb: 'hat das Team {target} disqualifiziert',
  },
  TOURNAMENT_DISPUTE_RESOLVED: {
    icon: Gavel,
    tone: 'success',
    verb: 'hat den Einspruch zu {target} entschieden',
  },

  // --- Kalender -------------------------------------------------------------
  CALENDAR_EVENT_PUBLISHED: {
    icon: CalendarDays,
    tone: 'info',
    verb: 'hat den Termin {target} veröffentlicht',
  },
  CALENDAR_EVENT_CANCELLED: { icon: CalendarDays, tone: 'warning', verb: 'hat den Termin {target} abgesagt' },

  // --- Verlosungen ----------------------------------------------------------
  XP_RAFFLE_PUBLISHED: { icon: Gift, tone: 'info', verb: 'hat die Verlosung {target} gestartet' },
  XP_RAFFLE_WINNER_DRAWN: { icon: Gift, tone: 'success', verb: 'hat {target} als Gewinner gezogen' },
  XP_RAFFLE_CANCELLED: { icon: Gift, tone: 'warning', verb: 'hat die Verlosung {target} abgebrochen' },

  // --- Rückblick und Spielwahl ---------------------------------------------
  WRAPPED_PUBLISHED: {
    icon: Sparkles,
    tone: 'success',
    verb: 'hat den Jahresrückblick {target} freigegeben',
  },
  WRAPPED_UNPUBLISHED: {
    icon: Sparkles,
    tone: 'warning',
    verb: 'hat den Jahresrückblick {target} zurückgezogen',
  },
  SPIELWAHL_SESSION_CREATED: { icon: Gamepad2, tone: 'accent', verb: 'hat eine Spielwahl gestartet' },

  // --- XP -------------------------------------------------------------------
  LEVEL_XP_GRANTED: { icon: Zap, tone: 'success', verb: 'hat {target} XP gutgeschrieben' },
  LEVEL_XP_REVOKED: { icon: Zap, tone: 'warning', verb: 'hat {target} XP abgezogen' },
  LEVEL_RESET: { icon: Zap, tone: 'warning', verb: 'hat den Fortschritt von {target} zurückgesetzt' },

  // --- Automationen ---------------------------------------------------------
  AUTOMATION_APPROVAL_GRANTED: {
    icon: BadgeCheck,
    tone: 'success',
    verb: 'hat die Automation {target} freigegeben',
  },
  AUTOMATION_APPROVAL_REJECTED: {
    icon: CircleAlert,
    tone: 'warning',
    verb: 'hat die Automation {target} abgelehnt',
  },
};

/**
 * Wenn doch einmal etwas durchrutscht.
 *
 * Kein zweiter Filter, sondern die letzte Zeile: die Erlaubnisliste
 * entscheidet, was ueberhaupt geladen wird. Bleibt hier trotzdem einmal eine
 * Aktion ohne Satz, steht lieber ein unscharfer Text als eine leere Zeile -
 * und der Test schlaegt fehl, bevor es jemand auf dem Dashboard sieht.
 */
const FALLBACK = { icon: ScrollText, tone: 'info' as Tone, verb: 'hat eine Aktion ausgeführt' };

/** Eintrag im Aktivitätsfeed des Dashboards. */
export function ActivityItem({ entry }: { entry: ActivityItemData }): React.JSX.Element {
  const view = ACTION_VIEW[entry.action] ?? FALLBACK;
  const tone = entry.success ? view.tone : 'destructive';
  const Icon = entry.success ? view.icon : CircleAlert;
  const classes = TONE_CLASSES[tone];
  const [before, after] = view.verb.split('{target}');

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border', classes.chip)}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      {entry.actorDiscordId ? (
        <DiscordAvatar
          discordId={entry.actorDiscordId}
          avatarHash={entry.actorAvatarHash}
          name={entry.actorUsername ?? 'System'}
          size={24}
          className="mt-0.5"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{entry.actorUsername ?? 'System'}</span>{' '}
          <span className="text-muted-foreground">{before?.trim()}</span>
          {entry.targetLabel ? (
            <span className="font-semibold text-primary-bright"> {entry.targetLabel}</span>
          ) : null}
          {after ? <span className="text-muted-foreground"> {after.trim()}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {entry.reason ? `Grund: ${entry.reason} · ` : ''}
          {formatDateTime(entry.createdAt)}
        </p>
      </div>

      <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', classes.dot)} aria-hidden="true" />
    </li>
  );
}
