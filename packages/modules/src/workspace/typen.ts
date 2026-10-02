import type {
  WorkspaceMemberRole,
  WorkspacePriority,
  WorkspaceProjectStatus,
  WorkspaceReminder,
  WorkspaceTaskStatus,
} from '@swisshub/database';
import { sanitizeText } from '@swisshub/shared';

/**
 * Die Werte, mit denen das Modul arbeitet - und die Reihenfolgen, in denen es
 * sie zeigt.
 *
 * Die Listen stehen hier und nicht in der Oberflaeche: Board, Filter,
 * Sortierung und Tests lesen dieselbe Reihenfolge, und eine zweite Liste waere
 * die, an der ein neuer Status eines Tages fehlt.
 */

/** Die vier Spalten des Boards - in dieser Reihenfolge. */
export const BOARD_SPALTEN = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type BoardSpalte = (typeof BOARD_SPALTEN)[number];

export const AUFGABEN_STATUS: readonly WorkspaceTaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'CANCELLED',
] as const;

/** Was in «Meine Aufgaben» standardmaessig steht: alles, was noch aussteht. */
export const OFFENE_STATUS: readonly WorkspaceTaskStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as const;

/** Was nicht in den Fortschritt zaehlt - siehe `fortschritt`. */
export const ZAEHLT_NICHT: readonly WorkspaceTaskStatus[] = ['CANCELLED'] as const;

export const PRIORITAETEN: readonly WorkspacePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

/**
 * Das Gewicht einer Prioritaet beim Sortieren.
 *
 * Hoeher zuerst. Als Karte und nicht als Index in `PRIORITAETEN`, weil die
 * Reihenfolge der Liste die der **Anzeige** ist und sich aendern darf, ohne
 * dass sich die Sortierung mitdreht.
 */
export const PRIORITAET_GEWICHT: Record<WorkspacePriority, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export const PROJEKT_STATUS: readonly WorkspaceProjectStatus[] = [
  'PLANNED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const;

/** Welche Projekte in den Standardansichten stehen. */
export const AKTIVE_PROJEKT_STATUS: readonly WorkspaceProjectStatus[] = [
  'PLANNED',
  'ACTIVE',
  'PAUSED',
] as const;

export const ERINNERUNGEN: readonly WorkspaceReminder[] = [
  'NONE',
  'ON_DUE_DATE',
  'ONE_DAY',
  'THREE_DAYS',
  'ONE_WEEK',
] as const;

/** Wie viele Tage vor der Faelligkeit eine Erinnerung faellt. */
export const ERINNERUNG_TAGE: Record<WorkspaceReminder, number | null> = {
  NONE: null,
  ON_DUE_DATE: 0,
  ONE_DAY: 1,
  THREE_DAYS: 3,
  ONE_WEEK: 7,
};

/** Obergrenzen fuer Tags - an einer Stelle, weil Projekte und Aufgaben sie teilen. */
const TAG_MAX = 32;
const TAGS_MAX = 10;

/**
 * Tags auf eine Form bringen: klein, getrimmt, ohne Doppel, begrenzt.
 *
 * Kleingeschrieben, weil «Turnier» und «turnier» sonst zwei Tags waeren und
 * der Filter nach dem einen das andere nicht faende - und weil niemand beim
 * Tippen auf Grossbuchstaben achtet. Die Obergrenze ist keine Schikane: Tags
 * sind zum Filtern da, und zwanzig davon an einer Aufgabe filtern nichts mehr.
 */
export function normalisiereTags(rohwerte: readonly string[]): string[] {
  const gesehen = new Set<string>();
  for (const roh of rohwerte) {
    const tag = sanitizeText(roh, TAG_MAX).trim().toLowerCase();
    if (tag !== '') {
      gesehen.add(tag);
    }
    if (gesehen.size >= TAGS_MAX) {
      break;
    }
  }
  return [...gesehen];
}

export const MITGLIED_ROLLEN: readonly WorkspaceMemberRole[] = ['LEAD', 'MEMBER'] as const;

/**
 * Wie dringend eine Faelligkeit aussieht.
 *
 * Vier Stufen, und die Abstufung ist Absicht: waere alles ab morgen rot,
 * stuende die halbe Liste in Alarmfarbe und niemand saehe mehr, was wirklich
 * ueberfaellig ist.
 */
export type Faelligkeitsstufe = 'ohne' | 'normal' | 'bald' | 'heute' | 'ueberfaellig';

/**
 * Die Stufe einer Faelligkeit.
 *
 * `baldTage` kommt aus den Moduleinstellungen. Gerechnet wird gegen den
 * **Tagesbeginn**: eine Aufgabe, die heute um 09:00 faellig war, ist um 14:00
 * nicht «ueberfaellig» im Sinne von «gestern vergessen», sondern heute faellig -
 * und soll nicht rot sein, solange der Tag laeuft.
 */
export function faelligkeitsstufe(dueAt: Date | null, jetzt: Date, baldTage: number): Faelligkeitsstufe {
  if (!dueAt) {
    return 'ohne';
  }
  const tagesbeginn = (datum: Date): number =>
    Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate());
  const tageBis = Math.round((tagesbeginn(dueAt) - tagesbeginn(jetzt)) / 86_400_000);

  if (tageBis < 0) {
    return 'ueberfaellig';
  }
  if (tageBis === 0) {
    return 'heute';
  }
  return tageBis <= baldTage ? 'bald' : 'normal';
}

export interface Fortschritt {
  /** Aufgaben, die zaehlen - ohne abgebrochene. */
  gesamt: number;
  erledigt: number;
  /** 0 bis 100. Ohne zaehlende Aufgaben: 0. */
  prozent: number;
}

/**
 * Der Fortschritt eines Projekts - aus seinen Aufgaben.
 *
 * Keine Zahl, die jemand von Hand pflegt: eine gepflegte Prozentangabe ist
 * nach zwei Wochen falsch, und niemand merkt es. Abgebrochene Aufgaben zaehlen
 * nicht mit - sonst stiege der Fortschritt, indem man Arbeit wegwirft, und
 * ein Projekt mit zehn abgebrochenen Aufgaben waere «zu 50 Prozent fertig».
 */
export function fortschritt(status: readonly WorkspaceTaskStatus[]): Fortschritt {
  const zaehlende = status.filter((eintrag) => !ZAEHLT_NICHT.includes(eintrag));
  const erledigt = zaehlende.filter((eintrag) => eintrag === 'DONE').length;
  return {
    gesamt: zaehlende.length,
    erledigt,
    prozent: zaehlende.length === 0 ? 0 : Math.round((erledigt / zaehlende.length) * 100),
  };
}
