import type {
  WorkspaceMemberRole,
  WorkspacePriority,
  WorkspaceProjectStatus,
  WorkspaceReminder,
  WorkspaceTaskStatus,
} from '@swisshub/database';
import type { workspace } from '@swisshub/modules';

/**
 * Die deutschen Beschriftungen - und die Farben dazu.
 *
 * ## Warum sie hier stehen und nicht im Modulkern
 *
 * Weil sie Darstellung sind. Der Kern kennt `IN_PROGRESS`; dass das «In
 * Arbeit» heisst und in welcher Farbe, entscheidet die Oberfläche. Eine
 * Beschriftung im Kern würde auch im Bot und in den Tests mitgeschleppt, wo
 * niemand sie braucht.
 *
 * ## Warum nur drei Farben für fünf Prioritäten
 *
 * Weil eine Liste, in der jede Zeile farbig ist, keine Hervorhebung kennt.
 * `NORMAL` ist der Normalfall und bleibt grau - sichtbar ist, was davon
 * abweicht.
 */

export const AUFGABEN_STATUS_LABEL: Record<WorkspaceTaskStatus, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Arbeit',
  BLOCKED: 'Blockiert',
  DONE: 'Erledigt',
  CANCELLED: 'Abgebrochen',
};

export const PROJEKT_STATUS_LABEL: Record<WorkspaceProjectStatus, string> = {
  PLANNED: 'Geplant',
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  ARCHIVED: 'Archiviert',
};

export const PRIORITAET_LABEL: Record<WorkspacePriority, string> = {
  LOW: 'Niedrig',
  NORMAL: 'Normal',
  HIGH: 'Hoch',
  URGENT: 'Dringend',
};

/**
 * Die beiden Projektrollen.
 *
 * `MEMBER` hiess hier «Mitglied» - ein Wort, das nach Zugehoerigkeit klingt
 * und damit nach Berechtigung. Gemeint war immer die Gegenrolle zur Leitung:
 * wer mitarbeitet, ohne das Projekt zu fuehren. «Unterstuetzung» sagt das,
 * und es sagt gleichzeitig, dass es um Arbeit geht und nicht um Zugang.
 */
export const ROLLE_LABEL: Record<WorkspaceMemberRole, string> = {
  LEAD: 'Projektleitung',
  MEMBER: 'Unterstützung',
};

export const ERINNERUNG_LABEL: Record<WorkspaceReminder, string> = {
  NONE: 'Keine Erinnerung',
  ON_DUE_DATE: 'Am Fälligkeitstag',
  ONE_DAY: 'Einen Tag vorher',
  THREE_DAYS: 'Drei Tage vorher',
  ONE_WEEK: 'Eine Woche vorher',
};

/** Die Klassen eines Status-Abzeichens. */
export const STATUS_FARBE: Record<WorkspaceTaskStatus, string> = {
  OPEN: 'bg-secondary text-secondary-foreground',
  IN_PROGRESS: 'bg-primary/15 text-primary',
  BLOCKED: 'bg-destructive/15 text-destructive',
  DONE: 'bg-success/15 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/** `null` heisst «keine Farbe» - und das ist für `NORMAL` die richtige Antwort. */
export const PRIORITAET_FARBE: Record<WorkspacePriority, string | null> = {
  URGENT: 'bg-destructive/15 text-destructive',
  HIGH: 'bg-warning/15 text-warning',
  NORMAL: null,
  LOW: 'text-muted-foreground',
};

/**
 * Wie eine Fälligkeit aussieht.
 *
 * Abgestuft und nicht binär: wäre alles ab morgen rot, stünde die halbe Liste
 * in Alarmfarbe und niemand sähe mehr, was wirklich überfällig ist.
 */
export const FAELLIGKEIT_FARBE: Record<workspace.Faelligkeitsstufe, string> = {
  ohne: 'text-muted-foreground',
  normal: 'text-muted-foreground',
  bald: 'text-warning',
  heute: 'text-warning font-medium',
  ueberfaellig: 'text-destructive font-medium',
};

/** Ein Datum, wie es in einer Liste steht - ohne Uhrzeit, wenn es keine braucht. */
export function fristText(dueAt: Date | null): string {
  if (!dueAt) {
    return 'ohne Frist';
  }
  return dueAt.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  });
}

export function zeitpunktText(wert: Date): string {
  return wert.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });
}

/** Für `<input type="date">`: der Tag in der Zeitzone der Anzeige. */
export function datumFuerFeld(wert: Date | null): string {
  if (!wert) {
    return '';
  }
  // `sv-SE` liefert `YYYY-MM-DD` - das Format, das das Feld erwartet, ohne
  // dass dafür von Hand an Monatsgrenzen gerechnet werden muss.
  return wert.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
}

/** Was im Aktivitätsverlauf steht - je Art ein Satzanfang. */
export const VERLAUF_LABEL: Record<string, string> = {
  'project.created': 'Projekt angelegt',
  'project.status': 'Projektstatus geändert',
  'project.due': 'Zieldatum geändert',
  'project.member': 'Mitglieder geändert',
  'project.archived': 'Projekt archiviert',
  'project.restored': 'Projekt zurückgeholt',
  'task.created': 'Aufgabe angelegt',
  'task.status': 'Status geändert',
  'task.priority': 'Priorität geändert',
  'task.assignee': 'Zuständige geändert',
  'task.due': 'Frist geändert',
  'task.done': 'Aufgabe erledigt',
  'task.reopened': 'Aufgabe wieder geöffnet',
  'task.comment': 'Kommentar geschrieben',
  'task.checklist': 'Checkliste geändert',
  'milestone.changed': 'Meilenstein geändert',
};
