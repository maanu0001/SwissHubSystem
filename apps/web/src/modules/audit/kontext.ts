import { systemRoutes } from '@swisshub/shared';
import { auditActionLabel } from './labels';

/**
 * Was ein Audit-Eintrag eigentlich sagt.
 *
 * ## Das Problem
 *
 * In der Datenbank steht `TICKET_STATUS_CHANGED`, eine Kennung als
 * Handelnder, eine Kennung als Ziel und ein Objekt mit Metadaten. Das ist
 * vollstaendig und nahezu unlesbar - man muss jeden Eintrag uebersetzen, und
 * um zu der Sache zu gelangen, um die es geht, sucht man sie von Hand.
 *
 * Diese Datei beantwortet je Eintrag vier Fragen:
 *
 *   Was ist passiert?  → Name und Kategorie
 *   Woran?             → der betroffene Gegenstand
 *   Was hat sich geaendert? → Vorher/Nachher
 *   Wo kann ich hin?   → Links
 *
 * ## Warum hier und nicht in der Anzeige
 *
 * Weil es sonst eine Verzweigung mit hundert Faellen mitten im JSX waere -
 * und die naechste Aktion eine hunderteinste. Hier steht es als Daten: eine
 * Tabelle von Metadaten-Schluesseln auf Ziele, und die Anzeige stellt dar,
 * was herauskommt.
 *
 * Die Metadaten kommen aus der Datenbank und sind `unknown`. Jeder Zugriff
 * prueft den Typ; ein Log, das an einem alten Eintrag scheitert, waere kein
 * Log.
 */

export type AuditKategorieId =
  | 'auth'
  | 'moderation'
  | 'tickets'
  | 'verifikation'
  | 'level'
  | 'automation'
  | 'kalender'
  | 'turniere'
  | 'kommunikation'
  | 'integrationen'
  | 'migration'
  | 'einstellungen'
  | 'mitglieder'
  | 'clips'
  | 'system';

export interface AuditKategorie {
  id: AuditKategorieId;
  label: string;
}

/**
 * Welcher Bereich - abgeleitet aus dem Praefix der Aktion.
 *
 * Die Namen der Aktionen folgen ohnehin diesem Muster; es ein zweites Mal je
 * Aktion zu pflegen, hiesse zwei Listen zu haben, die auseinanderlaufen.
 */
const BEREICH: ReadonlyArray<readonly [RegExp, AuditKategorie]> = [
  [/^(LOGIN|LOGOUT|SESSION|PERMISSION|RATE_LIMITED|PREVIEW)/u, { id: 'auth', label: 'Zugang' }],
  [/^(MODERATION|JAIL|VOTE_JAIL|APPEAL)/u, { id: 'moderation', label: 'Moderation' }],
  [/^CLIP/u, { id: 'clips', label: 'Clips' }],
  [/^TICKET/u, { id: 'tickets', label: 'Tickets' }],
  [/^VERIFICATION/u, { id: 'verifikation', label: 'Verifikation' }],
  [/^(LEVEL|XP_RAFFLE)/u, { id: 'level', label: 'Level' }],
  [/^AUTOMATION/u, { id: 'automation', label: 'Automationen' }],
  [/^CALENDAR/u, { id: 'kalender', label: 'Kalender' }],
  [/^TOURNAMENT/u, { id: 'turniere', label: 'Turniere' }],
  [/^(COMMUNICATION|SPIELERSUCHE)/u, { id: 'kommunikation', label: 'Kommunikation' }],
  [/^(INTEGRATION|PREMIUM)/u, { id: 'integrationen', label: 'Integrationen' }],
  [/^MIGRATION/u, { id: 'migration', label: 'Migration' }],
  [/^(SETTING|MODULE|ROLE_MAPPING|BRANDING|LOG_CHANNEL)/u, { id: 'einstellungen', label: 'Einstellungen' }],
  [/^(MEMBER|MEMBERS|VOICE)/u, { id: 'mitglieder', label: 'Mitglieder' }],
];

export function auditKategorie(action: string): AuditKategorie {
  for (const [muster, eintrag] of BEREICH) {
    if (muster.test(action)) {
      return eintrag;
    }
  }
  return { id: 'system', label: 'System' };
}

export interface AuditLink {
  label: string;
  href: string;
  /** Führt aus der Anwendung heraus - etwa zu Discord. */
  extern?: boolean;
}

export interface AuditAenderung {
  feld: string;
  vorher: string | null;
  nachher: string | null;
}

export interface AuditKontext {
  action: string;
  label: string;
  kategorie: AuditKategorie;
  links: AuditLink[];
  aenderungen: AuditAenderung[];
}

/** Ein Metadatenwert als Zeichenkette - oder `null`. */
function text(wert: unknown): string | null {
  if (typeof wert === 'string' && wert.trim() !== '') {
    return wert;
  }
  if (typeof wert === 'number' || typeof wert === 'boolean') {
    return String(wert);
  }
  return null;
}

/**
 * Welche Metadaten-Schluessel wohin fuehren.
 *
 * Eine Tabelle, keine Verzweigung. Eine neue verknuepfbare Sache heisst: eine
 * Zeile mehr - nicht ein weiterer Fall in einer Funktion, die schon zwanzig
 * hat.
 *
 * Erfunden wird dabei nichts: ohne die noetige Kennung entsteht kein Link.
 * Ein Knopf, der ins Leere fuehrt, ist schlimmer als kein Knopf.
 */
const ZIELE: ReadonlyArray<{
  schluessel: string;
  label: string;
  href: (wert: string) => string;
}> = [
  { schluessel: 'ticketId', label: 'Ticket öffnen', href: (wert) => systemRoutes.ticket(wert) },
  { schluessel: 'jailId', label: 'Jail öffnen', href: (wert) => systemRoutes.jail(wert) },
  { schluessel: 'automationId', label: 'Automation öffnen', href: (wert) => systemRoutes.automation(wert) },
  { schluessel: 'runId', label: 'Lauf öffnen', href: (wert) => systemRoutes.automationLauf(wert) },
  { schluessel: 'slug', label: 'Event öffnen', href: (wert) => systemRoutes.event(wert) },
  { schluessel: 'tournamentId', label: 'Turnier öffnen', href: (wert) => systemRoutes.turnier(wert) },
  { schluessel: 'memberId', label: 'Mitglied öffnen', href: (wert) => systemRoutes.mitglied(wert) },
];

/** Wohin eine Aktion fuehrt, auch ohne eigene Kennung in den Metadaten. */
const BEREICHS_ZIEL: ReadonlyArray<readonly [RegExp, AuditLink]> = [
  [/^CLIP/u, { label: 'Clip of the Week', href: systemRoutes.clips() }],
  [/^VERIFICATION/u, { label: 'Verifikation öffnen', href: systemRoutes.verifikation() }],
  [/^(INTEGRATION|PREMIUM)/u, { label: 'Integrationen öffnen', href: systemRoutes.integrationen() }],
  [/^MIGRATION/u, { label: 'Migration öffnen', href: systemRoutes.migration() }],
  [/^(JAIL|VOTE_JAIL)/u, { label: 'Jail-Übersicht', href: systemRoutes.jails() }],
  [/^MODERATION/u, { label: 'Moderation öffnen', href: systemRoutes.moderation() }],
  [/^TICKET/u, { label: 'Tickets öffnen', href: systemRoutes.tickets() }],
  [/^CALENDAR/u, { label: 'Kalender öffnen', href: systemRoutes.kalender() }],
  [/^TOURNAMENT/u, { label: 'Turniere öffnen', href: systemRoutes.turniere() }],
  [/^AUTOMATION/u, { label: 'Automationen öffnen', href: systemRoutes.automationen() }],
  [/^(LEVEL|XP_RAFFLE)/u, { label: 'Level öffnen', href: systemRoutes.gluecksrad() }],
];

/**
 * Felder, deren Vorher/Nachher sich lohnt.
 *
 * Aus `{"oldStatus":"OPEN","newStatus":"CLOSED"}` wird «Status: OPEN →
 * CLOSED». Die Rohdaten bleiben in den Details; hier steht, was jemand
 * wissen wollte.
 */
const AENDERUNGEN: ReadonlyArray<{ feld: string; vorher: string; nachher: string }> = [
  { feld: 'Status', vorher: 'oldStatus', nachher: 'newStatus' },
  { feld: 'Status', vorher: 'vorher', nachher: 'nachher' },
  { feld: 'Priorität', vorher: 'oldPriority', nachher: 'newPriority' },
  { feld: 'Wert', vorher: 'alterWert', nachher: 'neuerWert' },
  { feld: 'Wert', vorher: 'previous', nachher: 'current' },
  { feld: 'Rolle', vorher: 'oldRole', nachher: 'newRole' },
  { feld: 'Benutzername', vorher: 'oldUsername', nachher: 'newUsername' },
];

/**
 * Den Kontext eines Eintrags aufloesen.
 *
 * `guildId` kommt von aussen: sie steht in der Serverkonfiguration und nicht
 * in jedem Audit-Eintrag. Ohne sie entsteht kein Discord-Link - geraten wird
 * keiner.
 */
export function resolveAuditContext(
  eintrag: { action: string; metadata: unknown; targetDiscordId: string | null },
  optionen: { guildId?: string | null } = {},
): AuditKontext {
  const daten = (eintrag.metadata ?? {}) as Record<string, unknown>;
  const links: AuditLink[] = [];

  for (const ziel of ZIELE) {
    const wert = text(daten[ziel.schluessel]);
    if (wert) {
      links.push({ label: ziel.label, href: ziel.href(wert) });
    }
  }

  // Das Ziel des Eintrags ist eine Person, wenn eine Kennung dasteht.
  if (eintrag.targetDiscordId) {
    links.push({ label: 'Mitglied öffnen', href: systemRoutes.mitglied(eintrag.targetDiscordId) });
  }

  /*
   * Der Weg zur Discord-Nachricht.
   *
   * Nur mit allen drei Kennungen. Discords Adresse braucht Server, Kanal und
   * Nachricht - fehlt eine, gibt es keinen Link, und eine halbe Adresse waere
   * ein Knopf, der auf eine Fehlerseite fuehrt.
   */
  const messageId = text(daten.messageId);
  const channelId = text(daten.channelId);
  const guildId = optionen.guildId ?? text(daten.guildId);
  if (messageId && channelId && guildId) {
    links.push({
      label: 'Nachricht auf Discord',
      href: `https://discord.com/channels/${guildId}/${channelId}/${messageId}`,
      extern: true,
    });
  }

  if (links.length === 0) {
    const bereich = BEREICHS_ZIEL.find(([muster]) => muster.test(eintrag.action));
    if (bereich) {
      links.push(bereich[1]);
    }
  }

  const aenderungen: AuditAenderung[] = [];
  for (const regel of AENDERUNGEN) {
    const vorher = text(daten[regel.vorher]);
    const nachher = text(daten[regel.nachher]);
    if (vorher !== null || nachher !== null) {
      aenderungen.push({ feld: regel.feld, vorher, nachher });
    }
  }

  return {
    action: eintrag.action,
    label: auditActionLabel(eintrag.action),
    kategorie: auditKategorie(eintrag.action),
    // Höchstens zwei: mehr Knöpfe je Zeile machen eine Liste unruhig, ohne
    // eine Frage zu beantworten, die jemand hatte.
    links: links.slice(0, 2),
    aenderungen,
  };
}

export { auditActionLabel };
