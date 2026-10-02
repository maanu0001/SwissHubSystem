import { systemRoutes } from '@swisshub/shared';
import { APPEALS_PERMISSIONS } from '../appeals/config';
import { AUTOMATION_PERMISSIONS, AUTOMATION_MODULE_ID } from '../automation/config';
import { CALENDAR_MODULE_ID } from '../calendar/config';
import { CLIPS_MODULE_ID, CLIPS_PERMISSIONS } from '../clips/config';
import { TICKETS_MODULE_ID, TICKET_PERMISSIONS } from '../tickets/config';
import { VERIFICATION_MODULE_ID, VERIFICATION_PERMISSIONS } from '../verification/config';
import type { Benachrichtigungsart, Benachrichtigungsregel } from './types';

/**
 * Welche Ereignisse eine Meldung wert sind.
 *
 * Die Auswahl ist bewusst knapp. Massstab ist nicht «ist das interessant?»,
 * sondern «muss jemand deswegen etwas tun?». Ein Mitglied, das aufsteigt, ist
 * interessant; ein Ticket, das seit zwanzig Minuten unbearbeitet offensteht,
 * ist Arbeit.
 *
 * Jede Regel nennt ihren Empfängerkreis über eine Berechtigung, die es
 * ohnehin gibt - und die Seite, auf die der Deep Link führt, verlangt
 * dieselbe. Damit kann keine Meldung auf etwas zeigen, das ihr Empfänger
 * nicht öffnen darf.
 */

const text = (payload: Record<string, unknown>, feld: string): string | null => {
  const wert = payload[feld];
  return typeof wert === 'string' && wert !== '' ? wert : null;
};

const zahl = (payload: Record<string, unknown>, feld: string): number | null => {
  const wert = payload[feld];
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
};

export const BENACHRICHTIGUNGSARTEN: Benachrichtigungsart[] = [
  { kind: 'ticket.neu', label: 'Neues Ticket', icon: 'Ticket' },
  { kind: 'verifikation.offen', label: 'Verifikation offen', icon: 'ShieldCheck' },
  { kind: 'automation.fehler', label: 'Automation gescheitert', icon: 'AlertTriangle' },
  { kind: 'appeal.eskaliert', label: 'Antrag eskaliert', icon: 'Gavel' },
  { kind: 'kalender.anmeldung', label: 'Neue Anmeldung', icon: 'CalendarDays' },
  { kind: 'clip.offen', label: 'Clip wartet auf Freigabe', icon: 'Clapperboard' },
  { kind: 'clip.entschieden', label: 'Dein Clip wurde geprüft', icon: 'Clapperboard' },
  { kind: 'clip.gewonnen', label: 'Clip of the Week gewonnen', icon: 'Trophy' },
  { kind: 'workspace.zugewiesen', label: 'Aufgabe zugewiesen', icon: 'CircleCheck' },
  { kind: 'workspace.erwaehnt', label: 'In einem Kommentar erwähnt', icon: 'MessageSquare' },
  { kind: 'workspace.frist', label: 'Frist rückt näher', icon: 'AlarmClock' },
  { kind: 'workspace.blockiert', label: 'Aufgabe blockiert', icon: 'ShieldAlert' },
];

export const BENACHRICHTIGUNGSREGELN: Benachrichtigungsregel[] = [
  {
    // Ein neues Ticket ist die Meldung, auf die es im Support ankommt: es
    // wartet, bis jemand es übernimmt.
    eventType: 'ticket.opened',
    kind: 'ticket.neu',
    empfaenger: {
      art: 'berechtigung',
      permission: TICKET_PERMISSIONS.supportView,
      moduleId: TICKETS_MODULE_ID,
    },
    bauen({ payload }) {
      const ticketId = text(payload, 'ticketId');
      if (!ticketId) {
        return null;
      }
      const nummer = zahl(payload, 'nummer');
      const kategorie = text(payload, 'kategorie');
      return {
        titel: nummer === null ? 'Neues Ticket' : `Neues Ticket #${String(nummer).padStart(4, '0')}`,
        text: kategorie,
        route: systemRoutes.ticket(ticketId),
      };
    },
  },
  {
    // Ein offener Vorgang blockiert jemanden am Server-Eingang. Er gehört zu
    // den wenigen Dingen, die von selbst nicht besser werden.
    eventType: 'verification.requested',
    kind: 'verifikation.offen',
    empfaenger: {
      art: 'berechtigung',
      permission: VERIFICATION_PERMISSIONS.review,
      moduleId: VERIFICATION_MODULE_ID,
    },
    bauen({ payload }) {
      const name = text(payload, 'displayName') ?? text(payload, 'username');
      return {
        titel: 'Neue Verifikation offen',
        text: name ? `${name} wartet auf eine Entscheidung.` : 'Jemand wartet auf eine Entscheidung.',
        route: systemRoutes.verifikation(),
        // Eine Zeile für die Warteschlange, nicht eine je Person: nach einer
        // Beitrittswelle stünden sonst vierzig gleiche Meldungen da.
        gruppe: 'verifikation.offen',
      };
    },
  },
  {
    eventType: 'automation.failed',
    kind: 'automation.fehler',
    empfaenger: {
      art: 'berechtigung',
      permission: AUTOMATION_PERMISSIONS.view,
      moduleId: AUTOMATION_MODULE_ID,
    },
    bauen({ payload }) {
      const automationId = text(payload, 'automationId');
      const runId = text(payload, 'runId');
      const name = text(payload, 'automationName') ?? 'Eine Automation';
      return {
        titel: `${name} ist gescheitert`,
        text: text(payload, 'fehler'),
        route: runId ? systemRoutes.automationLauf(runId) : systemRoutes.automationen(),
        // Eine Automation, die im Minutentakt scheitert, ist ein Problem -
        // aber ein einziges. Fünfzig Zeilen daraus zu machen, verdeckt es.
        gruppe: automationId ? `automation.fehler:${automationId}` : null,
      };
    },
  },
  {
    // Eskaliert heisst: die bisherige Bearbeitung reicht nicht. Genau dafür
    // ist eine Meldung da.
    eventType: 'appeal.escalated',
    kind: 'appeal.eskaliert',
    empfaenger: { art: 'berechtigung', permission: APPEALS_PERMISSIONS.decide },
    bauen({ payload }) {
      const appealId = text(payload, 'appealId');
      const fall = text(payload, 'fallnummer');
      return {
        titel: 'Entbannungsantrag eskaliert',
        text: fall ? `Fall ${fall}` : null,
        route: appealId ? `/appeals/${encodeURIComponent(appealId)}` : '/appeals',
      };
    },
  },
  {
    // Persönlich: die Person, die den Termin angelegt hat, erfährt von einer
    // Anmeldung. Sonst niemand - eine Anmeldung ist keine Staff-Meldung.
    eventType: 'calendar.registration_created',
    kind: 'kalender.anmeldung',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'organizerDiscordId') },
    bauen({ payload }) {
      const slug = text(payload, 'slug');
      const titel = text(payload, 'titel') ?? 'Dein Event';
      const status = text(payload, 'status');
      return {
        titel: 'Neue Anmeldung',
        text: status === 'WAITLISTED' ? `${titel} · Warteliste` : titel,
        route: slug ? systemRoutes.event(slug) : systemRoutes.kalender(),
        // Zwanzig Anmeldungen sind eine Meldung mit einer Zahl.
        gruppe: slug ? `kalender.anmeldung:${slug}` : null,
      };
    },
  },
  {
    /*
     * Ein eingereichter Clip wartet auf eine Entscheidung.
     *
     * Wie ein neues Ticket: er liegt da, bis jemand ihn ansieht, und bis
     * dahin fehlt er im Voting. Alle Einreichungen einer Runde teilen sich
     * eine Zeile - dreissig Meldungen am Montag waeren dreissig Gruende, die
     * Glocke nicht mehr zu oeffnen.
     */
    eventType: 'clips.submitted',
    kind: 'clip.offen',
    empfaenger: {
      art: 'berechtigung',
      permission: CLIPS_PERMISSIONS.moderate,
      moduleId: CLIPS_MODULE_ID,
    },
    bauen({ payload }) {
      const competitionId = text(payload, 'competitionId');
      return {
        titel: 'Clip wartet auf Freigabe',
        text: text(payload, 'titel'),
        route: systemRoutes.clipModeration(),
        gruppe: competitionId ? `clip.offen:${competitionId}` : null,
      };
    },
  },
  {
    // Die Freigabe geht ausschliesslich an die Person, die eingereicht hat.
    eventType: 'clips.approved',
    kind: 'clip.entschieden',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      return {
        titel: 'Dein Clip ist im Rennen',
        text: text(payload, 'titel'),
        route: systemRoutes.clips(),
      };
    },
  },
  {
    /*
     * Die Ablehnung - mit der Begruendung im Text.
     *
     * Sie ist der Grund, weshalb diese Meldung ueberhaupt noetig ist: wer
     * nichts hoert, sucht seinen Clip am Samstag vergeblich im Voting.
     */
    eventType: 'clips.rejected',
    kind: 'clip.entschieden',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const notiz = text(payload, 'notiz');
      const titel = text(payload, 'titel');
      return {
        titel: 'Dein Clip wurde abgelehnt',
        text: notiz ?? titel,
        route: systemRoutes.clips(),
      };
    },
  },
  {
    // Der Sieg. Eine Meldung im Jahr, die niemand ueberliest.
    eventType: 'clips.winner',
    kind: 'clip.gewonnen',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const key = text(payload, 'key');
      const stimmen = zahl(payload, 'stimmen');
      return {
        titel: 'Du hast Clip of the Week gewonnen',
        text:
          stimmen === null
            ? text(payload, 'titel')
            : `${text(payload, 'titel') ?? 'Dein Clip'} · ${stimmen} ${stimmen === 1 ? 'Stimme' : 'Stimmen'}`,
        route: key ? systemRoutes.clipRunde(key) : systemRoutes.hallOfFame(),
      };
    },
  },
  {
    /*
     * Eine Aufgabe, die jemandem zugewiesen wurde.
     *
     * Die Meldung mit dem besten Verhaeltnis von Aufwand zu Nutzen in diesem
     * Modul: ohne sie erfaehrt man von einer neuen Aufgabe erst, wenn man von
     * selbst ins Board schaut - und genau das tut man an dem Tag nicht, an dem
     * man viel zu tun hat.
     *
     * Persoenlich, nicht an eine Berechtigung: zustaendig ist eine Person.
     */
    eventType: 'workspace.task_assigned',
    kind: 'workspace.zugewiesen',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const taskId = text(payload, 'taskId');
      if (!taskId) {
        return null;
      }
      const frist = text(payload, 'dueAt');
      return {
        titel: 'Neue Aufgabe für dich',
        text: frist
          ? `${text(payload, 'titel') ?? 'Eine Aufgabe'} · fällig ${frist.slice(0, 10)}`
          : text(payload, 'titel'),
        route: systemRoutes.workspaceAufgabe(taskId),
      };
    },
  },
  {
    // Eine Erwaehnung ist eine Frage an eine bestimmte Person. Ohne Meldung
    // waere sie ein Zettel in einer Schublade, die niemand oeffnet.
    eventType: 'workspace.mention',
    kind: 'workspace.erwaehnt',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const taskId = text(payload, 'taskId');
      if (!taskId) {
        return null;
      }
      return {
        titel: `Erwähnt: ${text(payload, 'titel') ?? 'eine Aufgabe'}`,
        text: text(payload, 'auszug'),
        route: systemRoutes.workspaceAufgabe(taskId),
      };
    },
  },
  {
    /*
     * Die Frist rueckt naeher.
     *
     * Vom Scheduler gemeldet, einmal je Frist - der Merker an der Aufgabe
     * verhindert Wiederholungen, und `dedupeKey` im Dienst faengt den Rest.
     * Keine Gruppe: zwei Fristen am selben Tag sind zwei Dinge zu tun, und sie
     * zu einer Zeile zusammenzufassen hiesse, eine davon zu verstecken.
     */
    eventType: 'workspace.reminder',
    kind: 'workspace.frist',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const taskId = text(payload, 'taskId');
      if (!taskId) {
        return null;
      }
      const tage = zahl(payload, 'tageBisFrist');
      const wann =
        tage === null
          ? null
          : tage <= 0
            ? 'heute fällig'
            : tage === 1
              ? 'morgen fällig'
              : `fällig in ${tage} Tagen`;
      const projekt = text(payload, 'projektTitel');
      return {
        titel: text(payload, 'titel') ?? 'Eine Aufgabe wird fällig',
        text: [wann, projekt].filter((teil) => teil !== null).join(' · ') || null,
        route: systemRoutes.workspaceAufgabe(taskId),
      };
    },
  },
  {
    /*
     * Eine Aufgabe ist blockiert.
     *
     * Nur, wenn die Moduleinstellung es verlangt - der Dienst meldet das
     * Ereignis sonst gar nicht. Vorgabe aus: auf einem Team, das «Blockiert»
     * als Ablage benutzt, waere es eine Meldung am Tag ohne Anlass.
     */
    eventType: 'workspace.task_blocked',
    kind: 'workspace.blockiert',
    empfaenger: { art: 'person', discordId: (payload) => text(payload, 'discordId') },
    bauen({ payload }) {
      const taskId = text(payload, 'taskId');
      if (!taskId) {
        return null;
      }
      return {
        titel: 'Aufgabe blockiert',
        text: text(payload, 'titel'),
        route: systemRoutes.workspaceAufgabe(taskId),
      };
    },
  },
];

/** Die Ereignisse, für die es überhaupt eine Regel gibt. */
export const GEMELDETE_EREIGNISSE: ReadonlySet<string> = new Set(
  BENACHRICHTIGUNGSREGELN.map((regel) => regel.eventType),
);

/** Die Arten als Nachschlagewerk - die Oberfläche fragt darüber nach Symbolen. */
export const ART_NACH_KIND: ReadonlyMap<string, Benachrichtigungsart> = new Map(
  BENACHRICHTIGUNGSARTEN.map((art) => [art.kind, art]),
);

export const CALENDAR_MODULE_ID_FUER_MELDUNGEN = CALENDAR_MODULE_ID;
