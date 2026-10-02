import { prisma } from '@swisshub/database';
import type { WorkspaceTaskStatus , Prisma} from '@swisshub/database';
import { nichtArchiviert } from './aufgaben';
import { BOARD_SPALTEN, OFFENE_STATUS, type BoardSpalte } from './typen';

/**
 * Die Zahlen der Übersicht - und das Board.
 *
 * ## Warum vier Zahlen und nicht zwölf
 *
 * Weil eine Übersicht aus zwölf Zahlen keine Übersicht ist. Die vier hier
 * beantworten je eine Frage, die jemand morgens tatsächlich hat: *läuft etwas
 * aus dem Ruder* (überfällig), *was ist diese Woche dran* (bald fällig), *wie
 * viel liegt bei mir* (meine offenen), *woran arbeiten wir* (aktive Projekte).
 *
 * ## Warum gezählt und nicht geladen
 *
 * Für eine Kachel mit einer Zahl darin braucht niemand dreihundert Zeilen im
 * Speicher. Die Zählungen laufen parallel, weil sie nichts voneinander wissen
 * müssen.
 */

export interface Uebersichtszahlen {
  /** Offene Aufgaben mit Frist in der Vergangenheit. */
  ueberfaellig: number;
  /** Offene Aufgaben, deren Frist innerhalb der Vorwarnzeit liegt. */
  baldFaellig: number;
  /** Offene Aufgaben, für die der Betrachter zuständig ist. */
  meineOffenen: number;
  /** Projekte, die nicht archiviert und nicht abgeschlossen sind. */
  aktiveProjekte: number;
  /** Offene Aufgaben ohne Zuständige - sie fallen sonst niemandem auf. */
  ohneZustaendige: number;
}

export async function ladeUebersichtszahlen(
  guildId: string,
  discordId: string,
  optionen: { jetzt?: Date; baldTage?: number } = {},
): Promise<Uebersichtszahlen> {
  const jetzt = optionen.jetzt ?? new Date();
  const baldTage = optionen.baldTage ?? 3;

  /*
   * Gerechnet wird auf Tagesgrenzen, nicht auf dem Zeitstempel.
   *
   * Sonst wäre eine Aufgabe, die heute um 09:00 fällig war, ab 09:01
   * «überfällig» - und die Kachel stünde den halben Tag auf einer Zahl, die
   * nur heisst, dass der Vormittag vorbei ist.
   */
  const heuteBeginn = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()));
  const baldEnde = new Date(heuteBeginn.getTime() + (baldTage + 1) * 86_400_000);

  // Aufgaben archivierter Projekte zählen nicht mit - sie stehen in keiner
  // Ansicht, und eine Zahl, die auf nichts Auffindbares zeigt, ist Ballast.
  const offen: Prisma.WorkspaceTaskWhereInput = {
    guildId,
    status: { in: [...OFFENE_STATUS] },
    ...nichtArchiviert(),
  };

  const [ueberfaellig, baldFaellig, meineOffenen, aktiveProjekte, ohneZustaendige] = await Promise.all([
    prisma.workspaceTask.count({ where: { ...offen, dueAt: { lt: heuteBeginn } } }),
    prisma.workspaceTask.count({ where: { ...offen, dueAt: { gte: heuteBeginn, lt: baldEnde } } }),
    prisma.workspaceTask.count({ where: { ...offen, assignees: { some: { discordId } } } }),
    prisma.workspaceProject.count({
      where: { guildId, archivedAt: null, status: { in: ['PLANNED', 'ACTIVE', 'PAUSED'] } },
    }),
    prisma.workspaceTask.count({ where: { ...offen, assignees: { none: {} } } }),
  ]);

  return { ueberfaellig, baldFaellig, meineOffenen, aktiveProjekte, ohneZustaendige };
}

export interface BoardKarte {
  id: string;
  titel: string;
  status: WorkspaceTaskStatus;
  prioritaet: string;
  dueAt: Date | null;
  projektTitel: string | null;
  zustaendige: string[];
  checklisteGesamt: number;
  checklisteOffen: number;
}

export type Board = Record<BoardSpalte, BoardKarte[]>;

/**
 * Das Board - vier Spalten.
 *
 * In **einer** Abfrage, nicht vier: vier Abfragen wären viermal derselbe Weg
 * zur Datenbank, und beim Umsortieren im Browser müsste jede davon einzeln
 * wieder stimmen. «Abgebrochen» hat keine Spalte - es ist ein Ausgang und
 * keine Ablage; eine fünfte Spalte dafür machte die Entscheidung beiläufig.
 *
 * Die Obergrenze je Spalte ist eine Bremse gegen eine Seite, die mit dem
 * Backlog wächst: ein Board mit vierhundert Karten lädt niemand zum Ansehen.
 */
export async function ladeBoard(
  guildId: string,
  optionen: { projectId?: string | null; zustaendig?: string; proSpalte?: number } = {},
): Promise<Board> {
  const proSpalte = Math.min(Math.max(optionen.proSpalte ?? 50, 1), 200);

  const zeilen = await prisma.workspaceTask.findMany({
    where: {
      guildId,
      status: { in: [...BOARD_SPALTEN] },
      ...(optionen.projectId !== undefined ? { projectId: optionen.projectId } : {}),
      ...(optionen.zustaendig ? { assignees: { some: { discordId: optionen.zustaendig } } } : {}),
      ...nichtArchiviert(),
    },
    include: {
      assignees: { select: { discordId: true } },
      project: { select: { title: true } },
      checklist: { select: { erledigt: true } },
    },
    // Je Spalte begrenzt wird unten; hier eine Obergrenze über alles, damit
    // auch ein sehr schiefes Board die Abfrage nicht sprengt.
    take: proSpalte * BOARD_SPALTEN.length,
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
  });

  // Ausgeschrieben statt über `Object.fromEntries` zusammengesetzt: dort
  // müsste eine Typzusicherung behaupten, dass alle vier Spalten da sind -
  // hier sieht man es.
  const board: Board = { OPEN: [], IN_PROGRESS: [], BLOCKED: [], DONE: [] };
  for (const zeile of zeilen) {
    const spalte = zeile.status as BoardSpalte;
    const liste = board[spalte];
    if (!liste || liste.length >= proSpalte) {
      continue;
    }
    liste.push({
      id: zeile.id,
      titel: zeile.title,
      status: zeile.status,
      prioritaet: zeile.priority,
      dueAt: zeile.dueAt,
      projektTitel: zeile.project?.title ?? null,
      zustaendige: zeile.assignees.map((eintrag) => eintrag.discordId),
      checklisteGesamt: zeile.checklist.length,
      checklisteOffen: zeile.checklist.filter((eintrag) => !eintrag.erledigt).length,
    });
  }
  return board;
}
