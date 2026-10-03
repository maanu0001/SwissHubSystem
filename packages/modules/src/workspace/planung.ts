import { prisma } from '@swisshub/database';
import type { Prisma, WorkspaceMilestone, WorkspacePriority } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { nichtArchiviert } from './aufgaben';
import { meldeImProjektkanal } from './kanalmeldung';
import {
  aufgabenFilter,
  projektFilter,
  sichereProjektSicht,
  undAlles,
  type WorkspaceBetrachter,
} from './sichtbarkeit';
import { OFFENE_STATUS } from './typen';
import { vermerke } from './verlauf';

/**
 * Die Planung: was in einem Zeitraum liegt.
 *
 * ## Warum alles drei in einer Liste
 *
 * Weil die Frage «was ist im Juni» nicht nach Aufgaben fragt, sondern nach
 * Terminen. Eine Aufgabenfrist, ein Meilenstein und ein Projektziel sind für
 * den Fragenden dasselbe: ein Datum, an dem etwas fertig sein muss. Drei
 * getrennte Listen nebeneinander müsste er selbst zusammenlegen - und würde
 * dabei genau den Termin übersehen, der nicht in der Liste stand, auf die er
 * gerade schaute.
 *
 * ## Warum keine neue Kalender-Engine
 *
 * Weil es eine gibt. Die Tagesgrenzen kommen aus den bestehenden
 * Zeitzonen-Helfern des Systems - dieselben, die der Kalender benutzt. Eine
 * eigene Rechnung mit 86 400 000 Millisekunden läge an den beiden
 * Umstellungstagen daneben, und zwar lautlos.
 *
 * Mit `calendar.listEventsInRange` wird das hier **nicht** zusammengelegt: das
 * sind Termine mit Anmeldung, Tickets und Discord-Ankündigung. Ein
 * Meilenstein ist keiner davon.
 */

const MEILENSTEIN_TITEL_MAX = 120;
const MEILENSTEIN_TEXT_MAX = 2000;

export type TerminArt = 'aufgabe' | 'meilenstein' | 'projektziel';

export interface Termin {
  art: TerminArt;
  id: string;
  titel: string;
  /** Der Tag, an dem es fällig ist. */
  faelligAm: Date;
  erledigt: boolean;
  projectId: string | null;
  projektTitel: string | null;
  /** Nur bei Aufgaben - sonst `null`. */
  prioritaet: WorkspacePriority | null;
  akzent: string | null;
}

/**
 * Was zwischen zwei Zeitpunkten fällig ist.
 *
 * `von` inklusive, `bis` exklusive - wie überall im System, wo Zeiträume
 * aneinandergrenzen. Sonst stünde ein Termin um Mitternacht in zwei Monaten.
 */
export async function ladeTermine(
  guildId: string,
  betrachter: WorkspaceBetrachter,
  von: Date,
  bis: Date,
  optionen: { nurOffene?: boolean } = {},
): Promise<Termin[]> {
  /*
   * Drei Abfragen, ein Filter.
   *
   * Der Kalender ist die unauffaelligste Luecke: er zeigt Aufgaben,
   * Meilensteine **und** Projektziele - drei Wege zum Titel eines privaten
   * Projekts. Alle drei tragen deshalb denselben Filter, und ein vierter Weg
   * muesste ihn ebenso tragen.
   */
  const [aufgabenSicht, projektSicht] = await Promise.all([
    aufgabenFilter(betrachter),
    projektFilter(betrachter),
  ]);
  const [aufgaben, meilensteine, projekte] = await Promise.all([
    prisma.workspaceTask.findMany({
      // Mit UND: Sichtbarkeit und «nicht archiviert» haben beide ein `OR`.
      where: undAlles<Prisma.WorkspaceTaskWhereInput>(
        aufgabenSicht,
        {
          guildId,
          dueAt: { gte: von, lt: bis },
          ...(optionen.nurOffene ? { status: { in: [...OFFENE_STATUS] } } : {}),
        },
        nichtArchiviert(),
      ),
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        priority: true,
        projectId: true,
        project: { select: { title: true, accent: true } },
      },
      take: 300,
    }),
    prisma.workspaceMilestone.findMany({
      where: {
        dueAt: { gte: von, lt: bis },
        // Der Filter steckt im Projekt, weil ein Meilenstein immer eines hat.
        project: undAlles<Prisma.WorkspaceProjectWhereInput>(projektSicht, {
          guildId,
          archivedAt: null,
        }),
        ...(optionen.nurOffene ? { erledigt: false } : {}),
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        erledigt: true,
        projectId: true,
        project: { select: { title: true, accent: true } },
      },
      take: 200,
    }),
    prisma.workspaceProject.findMany({
      where: undAlles<Prisma.WorkspaceProjectWhereInput>(projektSicht, {
        guildId,
        archivedAt: null,
        dueAt: { gte: von, lt: bis },
      }),
      select: { id: true, title: true, dueAt: true, status: true, accent: true },
      take: 100,
    }),
  ]);

  const termine: Termin[] = [
    ...aufgaben.map((zeile) => ({
      art: 'aufgabe' as const,
      id: zeile.id,
      titel: zeile.title,
      faelligAm: zeile.dueAt!,
      erledigt: zeile.status === 'DONE',
      projectId: zeile.projectId,
      projektTitel: zeile.project?.title ?? null,
      prioritaet: zeile.priority,
      akzent: zeile.project?.accent ?? null,
    })),
    ...meilensteine.map((zeile) => ({
      art: 'meilenstein' as const,
      id: zeile.id,
      titel: zeile.title,
      faelligAm: zeile.dueAt,
      erledigt: zeile.erledigt,
      projectId: zeile.projectId,
      projektTitel: zeile.project.title,
      prioritaet: null,
      akzent: zeile.project.accent,
    })),
    ...projekte.map((zeile) => ({
      art: 'projektziel' as const,
      id: zeile.id,
      titel: zeile.title,
      faelligAm: zeile.dueAt!,
      erledigt: zeile.status === 'COMPLETED',
      projectId: zeile.id,
      projektTitel: null,
      prioritaet: null,
      akzent: zeile.accent,
    })),
  ];

  /*
   * Nach Datum, dann nach Art.
   *
   * Die Art als zweites Kriterium, weil ein Meilenstein am selben Tag über den
   * Aufgaben steht, die darauf zulaufen - das ist die Reihenfolge, in der man
   * den Tag liest.
   */
  const rang: Record<TerminArt, number> = { projektziel: 0, meilenstein: 1, aufgabe: 2 };
  return termine.sort((a, b) => {
    const unterschied = a.faelligAm.getTime() - b.faelligAm.getTime();
    return unterschied !== 0 ? unterschied : rang[a.art] - rang[b.art];
  });
}

// --- Meilensteine -----------------------------------------------------------

/**
 * Ein Meilenstein.
 *
 * ## Warum er nicht einfach eine Aufgabe ist
 *
 * Weil er nichts ist, was jemand tut. «Anmeldung offen» ist ein Zeitpunkt, an
 * dem ein Zustand erreicht sein muss - ihm einen Zuständigen und eine
 * Checkliste zu geben hiesse, ihn mit den Aufgaben zu verwechseln, die auf ihn
 * zulaufen. Deshalb hat er Titel, Datum und ein Häkchen, und sonst nichts; und
 * deshalb zählt er nicht in den Fortschritt, der aus Aufgaben kommt.
 */
export async function ergaenzeMeilenstein(
  projectId: string,
  akteurDiscordId: string,
  eingabe: { titel: string; beschreibung?: string | null; dueAt: Date },
): Promise<WorkspaceMilestone> {
  const projekt = await prisma.workspaceProject.findUnique({
    where: { id: projectId },
    select: { id: true, guildId: true, archivedAt: true },
  });
  if (!projekt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }
  if (projekt.archivedAt) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieses Projekt ist archiviert.',
    });
  }

  const titel = sanitizeText(eingabe.titel, MEILENSTEIN_TITEL_MAX).trim();
  if (titel === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Meilenstein braucht einen Titel.' });
  }

  const meilenstein = await prisma.workspaceMilestone.create({
    data: {
      projectId,
      title: titel,
      description: eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, MEILENSTEIN_TEXT_MAX) : null,
      dueAt: eingabe.dueAt,
    },
  });

  await vermerke({
    guildId: projekt.guildId,
    art: 'milestone.changed',
    actorDiscordId: akteurDiscordId,
    projectId,
    detail: `${titel} · ${eingabe.dueAt.toISOString().slice(0, 10)}`,
  });

  return meilenstein;
}

export async function aendereMeilenstein(
  meilensteinId: string,
  akteurDiscordId: string,
  eingabe: { titel?: string; beschreibung?: string | null; dueAt?: Date; erledigt?: boolean },
): Promise<WorkspaceMilestone> {
  const vorher = await prisma.workspaceMilestone.findUnique({
    where: { id: meilensteinId },
    include: { project: { select: { guildId: true } } },
  });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Meilenstein gibt es nicht.' });
  }

  const daten: Parameters<typeof prisma.workspaceMilestone.update>[0]['data'] = {};
  if (eingabe.titel !== undefined) {
    const titel = sanitizeText(eingabe.titel, MEILENSTEIN_TITEL_MAX).trim();
    if (titel === '') {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Der Meilenstein braucht einen Titel.',
      });
    }
    daten.title = titel;
  }
  if (eingabe.beschreibung !== undefined) {
    daten.description = eingabe.beschreibung
      ? sanitizeText(eingabe.beschreibung, MEILENSTEIN_TEXT_MAX)
      : null;
  }
  if (eingabe.dueAt !== undefined) daten.dueAt = eingabe.dueAt;
  if (eingabe.erledigt !== undefined) daten.erledigt = eingabe.erledigt;

  const nachher = await prisma.workspaceMilestone.update({
    where: { id: meilensteinId },
    data: daten,
  });

  // Ein Häkchen allein ist keine Planungsänderung - nur Datum und Titel sind
  // es. Sonst stünde im Verlauf jedes Abhaken.
  if (eingabe.dueAt !== undefined || eingabe.titel !== undefined) {
    await vermerke({
      guildId: vorher.project.guildId,
      art: 'milestone.changed',
      actorDiscordId: akteurDiscordId,
      projectId: vorher.projectId,
      detail: `${nachher.title} · ${nachher.dueAt.toISOString().slice(0, 10)}`,
    });
  }

  /*
   * Ein erreichter Meilenstein ist die Nachricht, die ein Team lesen will.
   *
   * Nur beim Wechsel auf erledigt - nicht bei jedem Speichern, und nicht beim
   * Zuruecknehmen: «Meilenstein wieder offen» ist eine Korrektur und keine
   * Mitteilung.
   */
  if (eingabe.erledigt === true && !vorher.erledigt) {
    await meldeImProjektkanal(vorher.projectId, {
      ereignis: 'milestone.done',
      titel: nachher.title,
      pfad: `/workspace/projekte/${vorher.projectId}`,
    });
  }

  return nachher;
}

export async function loescheMeilenstein(meilensteinId: string): Promise<void> {
  const meilenstein = await prisma.workspaceMilestone.findUnique({ where: { id: meilensteinId } });
  if (!meilenstein) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Meilenstein gibt es nicht.' });
  }
  await prisma.workspaceMilestone.delete({ where: { id: meilensteinId } });
}

export async function ladeMeilensteine(
  projectId: string,
  betrachter: WorkspaceBetrachter,
): Promise<WorkspaceMilestone[]> {
  await sichereProjektSicht(projectId, betrachter);
  return prisma.workspaceMilestone.findMany({
    where: { projectId },
    orderBy: { dueAt: 'asc' },
    take: 50,
  });
}
