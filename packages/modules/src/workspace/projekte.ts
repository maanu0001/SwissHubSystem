import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type {
  WorkspaceMemberRole,
  WorkspacePriority,
  WorkspaceProject,
  WorkspaceProjectStatus,
} from '@swisshub/database';
import { AppError, normalisiereFarbe, sanitizeText } from '@swisshub/shared';
import { WORKSPACE_MODULE_ID } from './config';
import { AKTIVE_PROJEKT_STATUS, fortschritt, normalisiereTags, type Fortschritt } from './typen';
import { vermerke } from './verlauf';

/**
 * Projekte.
 *
 * ## Warum ein Projekt nicht gelöscht wird
 *
 * Weil daran Aufgaben, Kommentare und ein halbes Jahr Verlauf hängen, und weil
 * «wir haben das letztes Jahr schon mal gemacht» die häufigste Frage an so ein
 * Werkzeug ist. Archivieren beantwortet sie, Löschen nicht. Es gibt deshalb
 * kein `loescheProjekt` - nur `archiviere` und `holeZurueck`.
 *
 * ## Warum die Projektleitung keine eigene Berechtigung ist
 *
 * Sie ist eine Rolle **in diesem Projekt**, keine im System. Wer ein Projekt
 * leitet, darf es bearbeiten, auch ohne `workspace.projects.edit` - aber nur
 * dieses. `darfBearbeiten` unten ist die eine Stelle, die das entscheidet, und
 * sie entscheidet es serverseitig.
 */

const TITEL_MAX = 120;
const BESCHREIBUNG_MAX = 4000;

export interface ProjektEingabe {
  titel: string;
  beschreibung?: string | null;
  status?: WorkspaceProjectStatus;
  prioritaet?: WorkspacePriority | null;
  akzent?: string | null;
  startAt?: Date | null;
  dueAt?: Date | null;
  tags?: readonly string[];
  linkedModuleId?: string | null;
}

/** Was die Oberfläche von einem Projekt braucht. */
export interface ProjektAnsicht {
  projekt: WorkspaceProject;
  mitglieder: Array<{ discordId: string; rolle: WorkspaceMemberRole }>;
  fortschritt: Fortschritt;
  offeneAufgaben: number;
}

function pruefeTitel(titel: string): string {
  const sauber = sanitizeText(titel, TITEL_MAX).trim();
  if (sauber === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Projekt braucht einen Titel.' });
  }
  return sauber;
}

/**
 * Start und Ziel in der richtigen Reihenfolge.
 *
 * Ein Zieldatum vor dem Start ist kein Tippfehler, den man stehen lassen darf:
 * daran hängen die Planung, die Fortschrittsanzeige und die relativen
 * Fälligkeiten einer Vorlage.
 */
function pruefeZeitraum(startAt: Date | null, dueAt: Date | null): void {
  if (startAt && dueAt && dueAt < startAt) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Zieldatum liegt vor dem Start.',
    });
  }
}

export async function erstelleProjekt(
  guildId: string,
  akteurDiscordId: string,
  eingabe: ProjektEingabe,
): Promise<WorkspaceProject> {
  const titel = pruefeTitel(eingabe.titel);
  const startAt = eingabe.startAt ?? null;
  const dueAt = eingabe.dueAt ?? null;
  pruefeZeitraum(startAt, dueAt);

  const projekt = await prisma.$transaction(async (tx) => {
    const angelegt = await tx.workspaceProject.create({
      data: {
        guildId,
        title: titel,
        description: eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, BESCHREIBUNG_MAX) : null,
        status: eingabe.status ?? 'PLANNED',
        priority: eingabe.prioritaet ?? null,
        // Umgewandelt, nicht durchgereicht: der Wert landet in einem `style`.
        accent: normalisiereFarbe(eingabe.akzent ?? null),
        startAt,
        dueAt,
        tags: normalisiereTags(eingabe.tags ?? []),
        linkedModuleId: eingabe.linkedModuleId ?? null,
        createdByDiscordId: akteurDiscordId,
      },
    });
    /*
     * Wer anlegt, leitet - bis jemand es ändert.
     *
     * Ein Projekt ohne Leitung wäre eines, das niemand bearbeiten darf ausser
     * den Trägern der globalen Berechtigung. In derselben Transaktion, damit es
     * diesen Zustand nicht einmal kurz gibt.
     */
    await tx.workspaceProjectMember.create({
      data: { projectId: angelegt.id, discordId: akteurDiscordId, rolle: 'LEAD' },
    });
    return angelegt;
  });

  await vermerke({
    guildId,
    art: 'project.created',
    actorDiscordId: akteurDiscordId,
    projectId: projekt.id,
    detail: titel,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_PROJECT_CREATED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: titel,
    success: true,
    metadata: { projectId: projekt.id, status: projekt.status },
  });

  return projekt;
}

export async function aendereProjekt(
  projectId: string,
  akteurDiscordId: string,
  eingabe: Partial<ProjektEingabe>,
): Promise<WorkspaceProject> {
  const vorher = await prisma.workspaceProject.findUnique({ where: { id: projectId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }

  const startAt = eingabe.startAt !== undefined ? eingabe.startAt : vorher.startAt;
  const dueAt = eingabe.dueAt !== undefined ? eingabe.dueAt : vorher.dueAt;
  pruefeZeitraum(startAt, dueAt);

  const daten: Parameters<typeof prisma.workspaceProject.update>[0]['data'] = {};
  if (eingabe.titel !== undefined) daten.title = pruefeTitel(eingabe.titel);
  if (eingabe.beschreibung !== undefined) {
    daten.description = eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, BESCHREIBUNG_MAX) : null;
  }
  if (eingabe.status !== undefined) daten.status = eingabe.status;
  if (eingabe.prioritaet !== undefined) daten.priority = eingabe.prioritaet;
  if (eingabe.akzent !== undefined) daten.accent = normalisiereFarbe(eingabe.akzent);
  if (eingabe.startAt !== undefined) daten.startAt = eingabe.startAt;
  if (eingabe.dueAt !== undefined) daten.dueAt = eingabe.dueAt;
  if (eingabe.tags !== undefined) daten.tags = normalisiereTags(eingabe.tags);
  if (eingabe.linkedModuleId !== undefined) daten.linkedModuleId = eingabe.linkedModuleId;

  const nachher = await prisma.workspaceProject.update({ where: { id: projectId }, data: daten });

  if (eingabe.status !== undefined && eingabe.status !== vorher.status) {
    await vermerke({
      guildId: vorher.guildId,
      art: 'project.status',
      actorDiscordId: akteurDiscordId,
      projectId,
      detail: `${vorher.status} → ${eingabe.status}`,
    });
  }
  if (eingabe.dueAt !== undefined && eingabe.dueAt?.getTime() !== vorher.dueAt?.getTime()) {
    await vermerke({
      guildId: vorher.guildId,
      art: 'project.due',
      actorDiscordId: akteurDiscordId,
      projectId,
      detail: eingabe.dueAt ? eingabe.dueAt.toISOString().slice(0, 10) : 'ohne Zieldatum',
    });
  }

  return nachher;
}

/**
 * Archivieren.
 *
 * Setzt `archivedAt` **und** den Status - beides, weil beides gelesen wird: die
 * Standardansichten filtern auf `archivedAt`, die Statusanzeige zeigt den
 * Status. Sie auseinanderlaufen zu lassen wäre ein Projekt, das archiviert ist
 * und «Aktiv» darüber stehen hat.
 *
 * Idempotent: ein zweiter Aufruf ändert nichts und wirft nicht.
 */
export async function archiviere(projectId: string, akteurDiscordId: string): Promise<WorkspaceProject> {
  const vorher = await prisma.workspaceProject.findUnique({ where: { id: projectId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }
  if (vorher.archivedAt) {
    return vorher;
  }

  const nachher = await prisma.workspaceProject.update({
    where: { id: projectId },
    data: {
      archivedAt: new Date(),
      archivedByDiscordId: akteurDiscordId,
      status: 'ARCHIVED',
    },
  });

  await vermerke({
    guildId: vorher.guildId,
    art: 'project.archived',
    actorDiscordId: akteurDiscordId,
    projectId,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_PROJECT_ARCHIVED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: vorher.title,
    success: true,
    metadata: { projectId },
  });

  return nachher;
}

/**
 * Zurückholen.
 *
 * Der Status geht auf `ACTIVE` und nicht auf den von vorher: welcher das war,
 * steht nirgends, und ihn zu erraten hiesse, ein Projekt als «Geplant»
 * zurückzuholen, das längst läuft. Wer es anders will, stellt es um - das ist
 * ein Klick und keine Vermutung.
 */
export async function holeZurueck(projectId: string, akteurDiscordId: string): Promise<WorkspaceProject> {
  const vorher = await prisma.workspaceProject.findUnique({ where: { id: projectId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }
  if (!vorher.archivedAt) {
    return vorher;
  }

  const nachher = await prisma.workspaceProject.update({
    where: { id: projectId },
    data: { archivedAt: null, archivedByDiscordId: null, status: 'ACTIVE' },
  });

  await vermerke({
    guildId: vorher.guildId,
    art: 'project.restored',
    actorDiscordId: akteurDiscordId,
    projectId,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_PROJECT_RESTORED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: vorher.title,
    success: true,
    metadata: { projectId },
  });

  return nachher;
}

/** Mitglieder setzen. Die Liste ersetzt die bisherige - das ist der Vorgang. */
export async function setzeMitglieder(
  projectId: string,
  akteurDiscordId: string,
  mitglieder: ReadonlyArray<{ discordId: string; rolle: WorkspaceMemberRole }>,
): Promise<void> {
  const projekt = await prisma.workspaceProject.findUnique({ where: { id: projectId } });
  if (!projekt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }
  /*
   * Mindestens eine Leitung.
   *
   * Ein Projekt ohne Leitung darf nur noch von Trägern der globalen
   * Berechtigung bearbeitet werden - und wer das versehentlich herstellt,
   * schliesst sich selbst aus. Lieber eine klare Fehlermeldung.
   */
  if (!mitglieder.some((eintrag) => eintrag.rolle === 'LEAD')) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Projekt braucht mindestens eine Projektleitung.',
    });
  }

  // Doppelte Kennungen wären zwei Zeilen für eine Person; die eindeutige
  // Bedingung in der Datenbank fängt es ohnehin, aber eine Fehlermeldung über
  // eine Verletzung einer Datenbankbedingung ist keine Auskunft.
  const eindeutig = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag.rolle]));

  await prisma.$transaction(async (tx) => {
    await tx.workspaceProjectMember.deleteMany({ where: { projectId } });
    await tx.workspaceProjectMember.createMany({
      data: [...eindeutig.entries()].map(([discordId, rolle]) => ({ projectId, discordId, rolle })),
    });
  });

  await vermerke({
    guildId: projekt.guildId,
    art: 'project.member',
    actorDiscordId: akteurDiscordId,
    projectId,
    detail: `${eindeutig.size} ${eindeutig.size === 1 ? 'Mitglied' : 'Mitglieder'}`,
  });
}

/**
 * Darf diese Person dieses Projekt bearbeiten?
 *
 * Zwei Wege, und der zweite ist der Grund, warum diese Funktion existiert: die
 * globale Berechtigung, **oder** die Leitung dieses Projekts. Die Prüfung
 * gehört serverseitig an eine Stelle; stünde sie in der Oberfläche, wäre sie
 * eine Anzeige und keine Grenze.
 */
export async function darfBearbeiten(
  projectId: string,
  discordId: string,
  hatGlobaleBerechtigung: boolean,
): Promise<boolean> {
  if (hatGlobaleBerechtigung) {
    return true;
  }
  const leitung = await prisma.workspaceProjectMember.findUnique({
    where: { projectId_discordId: { projectId, discordId } },
    select: { rolle: true },
  });
  return leitung?.rolle === 'LEAD';
}

/**
 * Die Projektliste.
 *
 * Fortschritt und Aufgabenzahlen kommen aus **einer** Gruppenabfrage und nicht
 * aus einer Schleife über die Projekte: bei dreissig Projekten wären das
 * dreissig weitere Abfragen, und die Liste würde mit jedem Projekt langsamer.
 */
export async function ladeProjekte(
  guildId: string,
  optionen: { archiviert?: boolean; status?: readonly WorkspaceProjectStatus[]; suche?: string } = {},
): Promise<ProjektAnsicht[]> {
  const suche = optionen.suche?.trim();
  const projekte = await prisma.workspaceProject.findMany({
    where: {
      guildId,
      archivedAt: optionen.archiviert ? { not: null } : null,
      ...(optionen.status ? { status: { in: [...optionen.status] } } : {}),
      ...(suche
        ? {
            OR: [
              { title: { contains: suche, mode: 'insensitive' as const } },
              { description: { contains: suche, mode: 'insensitive' as const } },
              { tags: { has: suche.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { members: { select: { discordId: true, rolle: true } } },
  });

  if (projekte.length === 0) {
    return [];
  }

  // Eine Abfrage für alle Projekte: Status je Projekt, gezählt.
  const gruppen = await prisma.workspaceTask.groupBy({
    by: ['projectId', 'status'],
    where: { projectId: { in: projekte.map((projekt) => projekt.id) } },
    _count: { _all: true },
  });

  const nachProjekt = new Map<string, Array<{ status: string; anzahl: number }>>();
  for (const gruppe of gruppen) {
    if (!gruppe.projectId) {
      continue;
    }
    const liste = nachProjekt.get(gruppe.projectId) ?? [];
    liste.push({ status: gruppe.status, anzahl: gruppe._count._all });
    nachProjekt.set(gruppe.projectId, liste);
  }

  return projekte.map((projekt) => {
    const zeilen = nachProjekt.get(projekt.id) ?? [];
    // `fortschritt` erwartet eine Liste von Status - aus den Zählungen
    // aufgefaltet, damit die Rechnung an genau einer Stelle steht.
    const status = zeilen.flatMap((zeile) =>
      Array.from({ length: zeile.anzahl }, () => zeile.status as never),
    );
    return {
      projekt,
      mitglieder: projekt.members,
      fortschritt: fortschritt(status),
      offeneAufgaben: zeilen
        .filter((zeile) => zeile.status === 'OPEN' || zeile.status === 'IN_PROGRESS')
        .reduce((summe, zeile) => summe + zeile.anzahl, 0),
    };
  });
}

/** Die aktiven Projekte - für Auswahllisten und die Übersicht. */
export async function ladeAktiveProjekte(guildId: string): Promise<WorkspaceProject[]> {
  return prisma.workspaceProject.findMany({
    where: { guildId, archivedAt: null, status: { in: [...AKTIVE_PROJEKT_STATUS] } },
    orderBy: { title: 'asc' },
    take: 200,
  });
}

export async function ladeProjekt(projectId: string): Promise<ProjektAnsicht | null> {
  const projekt = await prisma.workspaceProject.findUnique({
    where: { id: projectId },
    include: { members: { select: { discordId: true, rolle: true } } },
  });
  if (!projekt) {
    return null;
  }
  const zeilen = await prisma.workspaceTask.groupBy({
    by: ['status'],
    where: { projectId },
    _count: { _all: true },
  });
  const status = zeilen.flatMap((zeile) => Array.from({ length: zeile._count._all }, () => zeile.status));
  return {
    projekt,
    mitglieder: projekt.members,
    fortschritt: fortschritt(status),
    offeneAufgaben: zeilen
      .filter((zeile) => zeile.status === 'OPEN' || zeile.status === 'IN_PROGRESS')
      .reduce((summe, zeile) => summe + zeile._count._all, 0),
  };
}
