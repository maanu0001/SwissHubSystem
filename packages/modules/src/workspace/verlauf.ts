import { prisma } from '@swisshub/database';
import { sanitizeText } from '@swisshub/shared';
import { sichereAufgabenSicht, sichereProjektSicht, type WorkspaceBetrachter } from './sichtbarkeit';

/**
 * Der Verlauf eines Projekts oder einer Aufgabe.
 *
 * ## Warum das eine eigene kleine Datei ist
 *
 * Weil jeder Vorgang im Modul daran vorbeikommt und niemand es vergessen soll.
 * Ein `vermerke(...)` ist eine Zeile; ein eigenes `prisma.workspaceActivity
 * .create({ data: {...} })` an dreissig Stellen ist dreissig Gelegenheiten,
 * das `guildId` zu verwechseln oder den Akteur nicht zu setzen.
 *
 * ## Was hier nicht landet
 *
 * Kein Filterwechsel, kein Scrollen, kein Zwischenstand beim Tippen. Der
 * Verlauf wird gelesen, wenn jemand fragt «was ist hier eigentlich passiert» -
 * und diese Frage beantwortet eine Liste aus fuenf Eintraegen besser als eine
 * aus fuenfhundert.
 */

/** Die Arten, die vorkommen. Die Oberflaeche uebersetzt sie. */
export const VERLAUF_ARTEN = [
  'project.created',
  'project.status',
  'project.due',
  'project.member',
  'project.archived',
  'project.restored',
  'task.created',
  'task.status',
  'task.priority',
  'task.assignee',
  'task.due',
  'task.done',
  'task.reopened',
  'task.comment',
  'task.checklist',
  'milestone.changed',
] as const;

export type VerlaufArt = (typeof VERLAUF_ARTEN)[number];

export interface VermerkEingabe {
  guildId: string;
  art: VerlaufArt;
  actorDiscordId: string;
  projectId?: string | null;
  taskId?: string | null;
  /** Ein kurzer Zusatz, etwa «Offen → Erledigt». Reiner Text, gekuerzt. */
  detail?: string | null;
}

/**
 * Einen Eintrag schreiben.
 *
 * Wirft nicht. Ein Verlaufseintrag, der nicht geschrieben werden kann, darf
 * nicht den Vorgang umwerfen, den er beschreibt - sonst scheitert das
 * Verschieben einer Karte daran, dass die Geschichte dazu nicht passt.
 */
export async function vermerke(eingabe: VermerkEingabe): Promise<void> {
  try {
    await prisma.workspaceActivity.create({
      data: {
        guildId: eingabe.guildId,
        art: eingabe.art,
        actorDiscordId: eingabe.actorDiscordId,
        projectId: eingabe.projectId ?? null,
        taskId: eingabe.taskId ?? null,
        detail: eingabe.detail ? sanitizeText(eingabe.detail, 200) : null,
      },
    });
  } catch {
    // Absichtlich still: siehe oben.
  }
}

/**
 * Der Verlauf einer Aufgabe oder eines Projekts.
 *
 * Mit Obergrenze, immer. Eine Aufgabe, an der ein halbes Jahr gearbeitet
 * wurde, hat dreihundert Eintraege; die letzten dreissig sind die, die jemand
 * liest.
 */
export async function ladeVerlauf(
  bezug: { taskId: string } | { projectId: string },
  betrachter: WorkspaceBetrachter,
  grenze = 30,
): Promise<
  Array<{ id: string; art: string; detail: string | null; actorDiscordId: string; createdAt: Date }>
> {
  /*
   * Der Verlauf ist eine Erzaehlung. «X hat den Status geaendert» zu einem
   * Projekt, das man nicht sehen darf, ist dieselbe Auskunft wie das Projekt
   * selbst - nur kleingeschrieben.
   */
  if ('taskId' in bezug) {
    await sichereAufgabenSicht(bezug.taskId, betrachter);
  } else {
    await sichereProjektSicht(bezug.projectId, betrachter);
  }
  return prisma.workspaceActivity.findMany({
    where: 'taskId' in bezug ? { taskId: bezug.taskId } : { projectId: bezug.projectId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(grenze, 1), 100),
    select: { id: true, art: true, detail: true, actorDiscordId: true, createdAt: true },
  });
}
