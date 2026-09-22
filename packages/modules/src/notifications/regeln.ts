import { systemRoutes } from '@swisshub/shared';
import { APPEALS_PERMISSIONS } from '../appeals/config';
import { AUTOMATION_PERMISSIONS, AUTOMATION_MODULE_ID } from '../automation/config';
import { CALENDAR_MODULE_ID } from '../calendar/config';
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
