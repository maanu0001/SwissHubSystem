import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type {
  WorkspacePriority,
  WorkspaceReminder,
  WorkspaceTask,
  WorkspaceTaskStatus,
  Prisma,
} from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { meldeEreignis } from '../automation/emit';
import { getModuleSettings } from '../module-state';
import { WORKSPACE_MODULE_ID, type WorkspaceSettings } from './config';
import { PRIORITAET_GEWICHT, normalisiereTags } from './typen';
import { meldeImProjektkanal } from './kanalmeldung';
import { aufgabenFilter, undAlles, type WorkspaceBetrachter } from './sichtbarkeit';
import { vermerke } from './verlauf';

/**
 * Aufgaben.
 *
 * ## Warum ein Statuswechsel den alten Status mitbringt
 *
 * Weil zwei Leute dasselbe Board offen haben. Wer eine Karte von «Offen» nach
 * «In Arbeit» zieht, hat auf seinem Bildschirm «Offen» gesehen - und wenn sie
 * dort inzwischen nicht mehr steht, weil jemand anderes sie gerade erledigt
 * hat, ist dieser Zug keine Verschiebung mehr, sondern ein Zurückdrehen. Das
 * `erwarteterStatus` unten ist genau diese Prüfung, und sie läuft als
 * Bedingung **im** `UPDATE`: zwischen Lesen und Schreiben ist dann kein
 * Zeitfenster mehr, in dem sie zutreffen und das Schreiben trotzdem falsch
 * sein kann.
 *
 * Wer den Status ohne Erwartung setzt (ein Formular, eine Vorlage), lässt das
 * Feld weg - dort gibt es keinen Bildschirm, der veralten konnte.
 *
 * ## Warum `reminderSentAt` am Fälligkeitsdatum hängt
 *
 * Es ist der Merker «für diese Frist wurde erinnert». Verschiebt sich die
 * Frist, ist die alte Erinnerung verbraucht und die neue noch nicht
 * geschehen - bliebe der Merker stehen, käme zur neuen Frist keine Meldung.
 * Deshalb wird er überall dort geleert, wo `dueAt` sich ändert, und nicht nur
 * im Formular, das daran gerade gedacht hat.
 */

/**
 * «Nicht in einem archivierten Projekt» - als Bedingung.
 *
 * Steht hier und nicht an vier Stellen, weil die Sonderbehandlung leicht
 * vergessen wird: eine Aufgabe **ohne** Projekt ist nicht archiviert, sie hat
 * nur kein Projekt. Ohne das erste Glied des `OR` fiele sie aus jeder Liste
 * und aus jeder Zahl der Übersicht.
 */
export function nichtArchiviert(): Prisma.WorkspaceTaskWhereInput {
  return { OR: [{ projectId: null }, { project: { archivedAt: null } }] };
}

const TITEL_MAX = 160;
const BESCHREIBUNG_MAX = 8000;

export interface AufgabeEingabe {
  titel: string;
  beschreibung?: string | null;
  projectId?: string | null;
  status?: WorkspaceTaskStatus;
  prioritaet?: WorkspacePriority;
  startAt?: Date | null;
  dueAt?: Date | null;
  reminder?: WorkspaceReminder;
  tags?: readonly string[];
  zustaendige?: readonly string[];
  linkedModuleId?: string | null;
}

function pruefeTitel(titel: string): string {
  const sauber = sanitizeText(titel, TITEL_MAX).trim();
  if (sauber === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Aufgabe braucht einen Titel.' });
  }
  return sauber;
}

/**
 * Gehört das Projekt zu dieser Gilde?
 *
 * Die Projektkennung kommt aus einem Auswahlfeld, und ein Auswahlfeld ist eine
 * Zeichenkette im Formular - wer eine fremde Kennung einsetzt, hängte seine
 * Aufgabe sonst in ein Projekt, das er nicht sehen darf. Geprüft wird deshalb
 * hier und nicht in der Oberfläche.
 */
async function pruefeProjekt(projectId: string | null, guildId: string): Promise<string | null> {
  if (!projectId) {
    return null;
  }
  const projekt = await prisma.workspaceProject.findFirst({
    where: { id: projectId, guildId },
    select: { id: true, archivedAt: true },
  });
  if (!projekt) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });
  }
  if (projekt.archivedAt) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieses Projekt ist archiviert. Hol es zuerst zurück.',
    });
  }
  return projekt.id;
}

/** Discord-Kennungen aus einem Formular: nur Ziffern, ohne Doppel, begrenzt. */
function saubereKennungen(rohwerte: readonly string[]): string[] {
  const gesehen = new Set<string>();
  for (const roh of rohwerte) {
    const kennung = roh.trim();
    // Eine Discord-Kennung ist eine Snowflake. Alles andere ist keine, und es
    // als Zustaendigen abzulegen hiesse, eine Aufgabe an niemanden zu haengen.
    if (/^\d{16,20}$/u.test(kennung)) {
      gesehen.add(kennung);
    }
    if (gesehen.size >= 20) {
      break;
    }
  }
  return [...gesehen];
}

export async function erstelleAufgabe(
  guildId: string,
  akteurDiscordId: string,
  eingabe: AufgabeEingabe,
): Promise<WorkspaceTask> {
  const titel = pruefeTitel(eingabe.titel);
  const projectId = await pruefeProjekt(eingabe.projectId ?? null, guildId);
  /*
   * Ohne Angabe ist die anlegende Person zustaendig.
   *
   * ## Warum eine Vorgabe und nicht «niemand»
   *
   * Weil eine Aufgabe ohne Zustaendige niemandem gehoert, und weil der
   * haeufigste Fall «ich mache das» ist. Eine Aufgabe, die man sich notiert
   * und dann im Board nicht unter «Meine Aufgaben» findet, ist eine Aufgabe,
   * die man zweimal anlegt.
   *
   * ## Warum `undefined` und `[]` verschieden sind
   *
   * `undefined` heisst «nicht gesagt» - dann gilt die Vorgabe. `[]` heisst
   * «ausdruecklich niemand», und das ist eine Entscheidung, die bestehen
   * bleibt: eine Aufgabe fuer das Team insgesamt, die sich jemand nimmt.
   * Waeren beide Faelle gleich, liesse sich die Vorgabe nicht abwaehlen.
   */
  const gewuenscht = eingabe.zustaendige ?? [akteurDiscordId];
  const zustaendige = saubereKennungen(gewuenscht);

  const aufgabe = await prisma.workspaceTask.create({
    data: {
      guildId,
      title: titel,
      description: eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, BESCHREIBUNG_MAX) : null,
      projectId,
      status: eingabe.status ?? 'OPEN',
      priority: eingabe.prioritaet ?? 'NORMAL',
      startAt: eingabe.startAt ?? null,
      dueAt: eingabe.dueAt ?? null,
      reminder: eingabe.reminder ?? 'NONE',
      tags: normalisiereTags(eingabe.tags ?? []),
      linkedModuleId: eingabe.linkedModuleId ?? null,
      createdByDiscordId: akteurDiscordId,
      assignees: { create: zustaendige.map((discordId) => ({ discordId })) },
    },
  });

  await vermerke({
    guildId,
    art: 'task.created',
    actorDiscordId: akteurDiscordId,
    projectId,
    taskId: aufgabe.id,
    detail: titel,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TASK_CREATED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: titel,
    success: true,
    metadata: { taskId: aufgabe.id, projectId },
  });
  await meldeZuweisungen(aufgabe, zustaendige, akteurDiscordId);
  // In den Kanal des Projekts, falls einer eingetragen ist - und ohne den
  // Vorgang abzubrechen, wenn Discord gerade nicht mitspielt.
  await meldeImProjektkanal(aufgabe.projectId, {
    ereignis: 'task.created',
    titel: aufgabe.title,
    felder: [
      { name: 'Priorität', value: aufgabe.priority },
      ...(aufgabe.dueAt ? [{ name: 'Fällig', value: tagesdatum(aufgabe.dueAt) }] : []),
      ...(zustaendige.length > 0 ? [{ name: 'Zuständig', value: erwaehnungen(zustaendige) }] : []),
    ],
    pfad: `/workspace/aufgaben/${aufgabe.id}`,
    akteurDiscordId: akteurDiscordId,
  });

  return aufgabe;
}

/**
 * Meldet jede **neue** Zuständigkeit - einzeln, und nicht an einen selbst.
 *
 * Einzeln, weil der Empfänger einer Meldung genau eine Person ist; eine
 * Meldung mit drei Empfängern im Rumpf müsste die Verteilung erst wieder
 * auseinandernehmen. Und nicht an einen selbst, weil niemand erfahren muss,
 * dass er sich gerade eine Aufgabe zugewiesen hat.
 */
async function meldeZuweisungen(
  aufgabe: WorkspaceTask,
  neue: readonly string[],
  akteurDiscordId: string,
): Promise<void> {
  for (const discordId of neue) {
    if (discordId === akteurDiscordId) {
      continue;
    }
    await meldeEreignis(
      'workspace.task_assigned',
      {
        taskId: aufgabe.id,
        titel: aufgabe.title,
        discordId,
        projectId: aufgabe.projectId,
        prioritaet: aufgabe.priority,
        dueAt: aufgabe.dueAt?.toISOString() ?? null,
      },
      {
        guildId: aufgabe.guildId,
        actorId: akteurDiscordId,
        subjectId: discordId,
        entityId: aufgabe.id,
      },
    );
  }
}

/**
 * «Blockiert» melden - wenn der Server es will.
 *
 * Es ist der eine Statuswechsel, aus dem Arbeit für jemand anderen folgt:
 * blockiert heisst, dass hier ohne Zutun nichts weitergeht. Trotzdem ist die
 * Einstellung standardmaessig **aus**: auf einem Team, das «Blockiert» als
 * Ablage für Angefangenes benutzt, waere es eine Meldung am Tag ohne Anlass -
 * und eine Glocke, in der solche Meldungen stehen, oeffnet nach zwei Wochen
 * niemand mehr.
 *
 * Gemeldet wird je **anderer** Zustaendiger, so wie bei der Zuweisung: wer
 * selbst blockiert hat, weiss es.
 */
async function meldeBlockiert(aufgabe: WorkspaceTask, akteurDiscordId: string): Promise<void> {
  const einstellungen = await getModuleSettings<WorkspaceSettings>(WORKSPACE_MODULE_ID);
  if (!einstellungen.meldeBlockiert) {
    return;
  }

  const zustaendige = await prisma.workspaceTaskAssignee.findMany({
    where: { taskId: aufgabe.id, discordId: { not: akteurDiscordId } },
    select: { discordId: true },
  });

  for (const eintrag of zustaendige) {
    await meldeEreignis(
      'workspace.task_blocked',
      {
        taskId: aufgabe.id,
        titel: aufgabe.title,
        discordId: eintrag.discordId,
        projectId: aufgabe.projectId,
      },
      {
        guildId: aufgabe.guildId,
        actorId: akteurDiscordId,
        subjectId: eintrag.discordId,
        entityId: aufgabe.id,
      },
    );
  }
}

export interface StatusWechsel {
  /**
   * Der Status, den der Absender vor sich sah.
   *
   * Weggelassen heisst «ich habe keinen Bildschirm, der veralten konnte».
   */
  erwarteterStatus?: WorkspaceTaskStatus;
}

/**
 * Status setzen.
 *
 * `doneAt` hängt am Status und wird nicht getrennt gepflegt: eine Aufgabe, die
 * auf «Erledigt» steht und kein Datum hat, fehlte in jeder Auswertung, und
 * eine wieder geöffnete mit altem Datum stünde darin fälschlich drin.
 */
export async function setzeStatus(
  taskId: string,
  akteurDiscordId: string,
  status: WorkspaceTaskStatus,
  optionen: StatusWechsel = {},
): Promise<WorkspaceTask> {
  const vorher = await prisma.workspaceTask.findUnique({ where: { id: taskId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  if (vorher.status === status) {
    return vorher;
  }

  const erledigt = status === 'DONE';
  // Die Erwartung steht als Bedingung im UPDATE, nicht als `if` davor: nur so
  // kann zwischen Prüfung und Schreiben nichts dazwischenkommen.
  const treffer = await prisma.workspaceTask.updateMany({
    where: {
      id: taskId,
      ...(optionen.erwarteterStatus ? { status: optionen.erwarteterStatus } : {}),
    },
    data: {
      status,
      doneAt: erledigt ? new Date() : null,
    },
  });

  if (treffer.count === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Die Aufgabe wurde zwischenzeitlich von jemand anderem geändert. Lade die Seite neu.',
      internalMessage: `erwartet ${optionen.erwarteterStatus ?? '-'}, vorgefunden ${vorher.status}`,
    });
  }

  const nachher = await prisma.workspaceTask.findUniqueOrThrow({ where: { id: taskId } });

  await vermerke({
    guildId: vorher.guildId,
    art: erledigt ? 'task.done' : vorher.status === 'DONE' ? 'task.reopened' : 'task.status',
    actorDiscordId: akteurDiscordId,
    projectId: vorher.projectId,
    taskId,
    detail: `${vorher.status} → ${status}`,
  });

  if (status === 'BLOCKED') {
    await meldeBlockiert(vorher, akteurDiscordId);
  }

  /*
   * Welcher Wechsel welche Meldung ist.
   *
   * Frueher gingen nur «erledigt» und «blockiert» in den Kanal, weil «offen →
   * in Arbeit» der Alltag ist und ein Kanal, der den Alltag meldet, zum Board
   * wird. Jetzt entscheidet das Projekt selbst: jede Art steht einzeln in der
   * Auswahl, und die Vorgabe sind weiterhin nur die beiden. Hier wird nur noch
   * benannt, was geschehen ist.
   */
  const ereignis = erledigt
    ? 'task.done'
    : status === 'BLOCKED'
      ? 'task.blocked'
      : vorher.status === 'DONE'
        ? 'task.reopened'
        : status === 'IN_PROGRESS'
          ? 'task.started'
          : null;

  if (ereignis) {
    await meldeImProjektkanal(vorher.projectId, {
      ereignis,
      titel: nachher.title,
      ...(status === 'BLOCKED' ? { beschreibung: 'Die Aufgabe kommt nicht weiter.' } : {}),
      felder: [{ name: 'Status', value: `${vorher.status} → ${status}` }],
      pfad: `/workspace/aufgaben/${taskId}`,
      akteurDiscordId: akteurDiscordId,
    });
  }

  return nachher;
}

export async function setzePrioritaet(
  taskId: string,
  akteurDiscordId: string,
  prioritaet: WorkspacePriority,
): Promise<WorkspaceTask> {
  const vorher = await prisma.workspaceTask.findUnique({ where: { id: taskId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  if (vorher.priority === prioritaet) {
    return vorher;
  }
  const nachher = await prisma.workspaceTask.update({
    where: { id: taskId },
    data: { priority: prioritaet },
  });
  await vermerke({
    guildId: vorher.guildId,
    art: 'task.priority',
    actorDiscordId: akteurDiscordId,
    projectId: vorher.projectId,
    taskId,
    detail: `${vorher.priority} → ${prioritaet}`,
  });
  return nachher;
}

/** Zuständige setzen. Die Liste ersetzt die bisherige. */
export async function setzeZustaendige(
  taskId: string,
  akteurDiscordId: string,
  discordIds: readonly string[],
): Promise<void> {
  const aufgabe = await prisma.workspaceTask.findUnique({
    where: { id: taskId },
    include: { assignees: { select: { discordId: true } } },
  });
  if (!aufgabe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }

  const gewuenscht = saubereKennungen(discordIds);
  const bisher = new Set(aufgabe.assignees.map((eintrag) => eintrag.discordId));
  const neue = gewuenscht.filter((discordId) => !bisher.has(discordId));
  const weg = [...bisher].filter((discordId) => !gewuenscht.includes(discordId));

  if (neue.length === 0 && weg.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (weg.length > 0) {
      await tx.workspaceTaskAssignee.deleteMany({ where: { taskId, discordId: { in: weg } } });
    }
    if (neue.length > 0) {
      await tx.workspaceTaskAssignee.createMany({
        data: neue.map((discordId) => ({ taskId, discordId })),
      });
    }
  });

  await vermerke({
    guildId: aufgabe.guildId,
    art: 'task.assignee',
    actorDiscordId: akteurDiscordId,
    projectId: aufgabe.projectId,
    taskId,
    detail:
      gewuenscht.length === 0
        ? 'niemand zuständig'
        : `${gewuenscht.length} ${gewuenscht.length === 1 ? 'Person' : 'Personen'}`,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TASK_ASSIGNED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: aufgabe.title,
    success: true,
    metadata: { taskId, neue, entfernt: weg },
  });
  await meldeZuweisungen(aufgabe, neue, akteurDiscordId);
  await meldeImProjektkanal(aufgabe.projectId, {
    ereignis: 'task.assigned',
    titel: aufgabe.title,
    felder: [
      {
        name: 'Verantwortlich',
        value: gewuenscht.length === 0 ? 'niemand' : erwaehnungen(gewuenscht),
      },
      ...(weg.length > 0 ? [{ name: 'Entfernt', value: erwaehnungen(weg) }] : []),
    ],
    pfad: `/workspace/aufgaben/${taskId}`,
    akteurDiscordId: akteurDiscordId,
  });
}

/** Frist setzen oder entfernen. Leert den Erinnerungsmerker - siehe Kopf. */
export async function setzeFrist(
  taskId: string,
  akteurDiscordId: string,
  dueAt: Date | null,
  reminder?: WorkspaceReminder,
): Promise<WorkspaceTask> {
  const vorher = await prisma.workspaceTask.findUnique({ where: { id: taskId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  if (vorher.startAt && dueAt && dueAt < vorher.startAt) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Frist liegt vor dem Start.' });
  }

  const nachher = await prisma.workspaceTask.update({
    where: { id: taskId },
    data: {
      dueAt,
      ...(reminder !== undefined ? { reminder } : {}),
      reminderSentAt: null,
    },
  });

  await vermerke({
    guildId: vorher.guildId,
    art: 'task.due',
    actorDiscordId: akteurDiscordId,
    projectId: vorher.projectId,
    taskId,
    detail: dueAt ? dueAt.toISOString().slice(0, 10) : 'ohne Frist',
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TASK_DUE_CHANGED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: vorher.title,
    success: true,
    metadata: { taskId, vorher: vorher.dueAt?.toISOString() ?? null, nachher: dueAt?.toISOString() ?? null },
  });

  /*
   * Drei Arten statt einer: gesetzt, verschoben, entfernt.
   *
   * «Frist geaendert» fuer alle drei waere im Kanal die unnuetzeste Meldung
   * ueberhaupt - man muesste jedes Mal klicken, um zu sehen, ob die Aufgabe
   * jetzt frueher oder gar nicht mehr faellig ist. Steht der alte Wert dabei,
   * eruebrigt sich das Klicken.
   */
  const fristEreignis = !dueAt ? 'due.cleared' : vorher.dueAt ? 'due.changed' : 'due.set';
  await meldeImProjektkanal(vorher.projectId, {
    ereignis: fristEreignis,
    titel: vorher.title,
    felder: [
      ...(vorher.dueAt ? [{ name: 'Bisher', value: tagesdatum(vorher.dueAt) }] : []),
      { name: dueAt ? 'Neu fällig' : 'Frist', value: dueAt ? tagesdatum(dueAt) : 'entfernt' },
    ],
    pfad: `/workspace/aufgaben/${taskId}`,
    akteurDiscordId: akteurDiscordId,
  });

  return nachher;
}

/** Ein Datum als Tag - die Uhrzeit interessiert bei einer Frist nicht. */
function tagesdatum(wert: Date): string {
  return wert.toISOString().slice(0, 10);
}

/**
 * Kennungen als Erwaehnungen.
 *
 * `<@id>` zeigt in Discord den Namen - ohne dass wir ihn hier nachschlagen
 * und ohne dass er veraltet, wenn jemand ihn aendert. Gepingt wird trotzdem
 * niemand: das verhindert `allowedMentions` in der Kanalmeldung.
 */
function erwaehnungen(discordIds: readonly string[]): string {
  return discordIds
    .slice(0, 10)
    .map((discordId) => `<@${discordId}>`)
    .join(', ');
}

/**
 * Felder einer Aufgabe ändern.
 *
 * Nur die mitgegebenen - `undefined` heisst «unverändert», `null` heisst
 * «leeren». Ohne diese Unterscheidung würde jedes Teilformular die Felder
 * löschen, die es nicht anzeigt. Status, Priorität, Zuständige und Frist haben
 * eigene Funktionen oben, weil an jedem davon mehr hängt als ein Spaltenwert.
 */
export async function aendereAufgabe(
  taskId: string,
  akteurDiscordId: string,
  eingabe: Partial<Omit<AufgabeEingabe, 'status' | 'zustaendige'>>,
): Promise<WorkspaceTask> {
  const vorher = await prisma.workspaceTask.findUnique({ where: { id: taskId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }

  const daten: Parameters<typeof prisma.workspaceTask.update>[0]['data'] = {};
  if (eingabe.titel !== undefined) daten.title = pruefeTitel(eingabe.titel);
  if (eingabe.beschreibung !== undefined) {
    daten.description = eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, BESCHREIBUNG_MAX) : null;
  }
  if (eingabe.projectId !== undefined) {
    daten.projectId = await pruefeProjekt(eingabe.projectId, vorher.guildId);
  }
  if (eingabe.prioritaet !== undefined) daten.priority = eingabe.prioritaet;
  if (eingabe.startAt !== undefined) daten.startAt = eingabe.startAt;
  if (eingabe.reminder !== undefined) daten.reminder = eingabe.reminder;
  if (eingabe.tags !== undefined) daten.tags = normalisiereTags(eingabe.tags);
  if (eingabe.linkedModuleId !== undefined) daten.linkedModuleId = eingabe.linkedModuleId;
  if (eingabe.dueAt !== undefined) {
    daten.dueAt = eingabe.dueAt;
    // Dieselbe Regel wie in `setzeFrist`: neue Frist, neuer Merker.
    if (eingabe.dueAt?.getTime() !== vorher.dueAt?.getTime()) {
      daten.reminderSentAt = null;
    }
  }

  const startAt = eingabe.startAt !== undefined ? eingabe.startAt : vorher.startAt;
  const dueAt = eingabe.dueAt !== undefined ? eingabe.dueAt : vorher.dueAt;
  if (startAt && dueAt && dueAt < startAt) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Frist liegt vor dem Start.' });
  }

  const nachher = await prisma.workspaceTask.update({ where: { id: taskId }, data: daten });

  if (eingabe.prioritaet !== undefined && eingabe.prioritaet !== vorher.priority) {
    await vermerke({
      guildId: vorher.guildId,
      art: 'task.priority',
      actorDiscordId: akteurDiscordId,
      projectId: nachher.projectId,
      taskId,
      detail: `${vorher.priority} → ${eingabe.prioritaet}`,
    });
  }
  if (eingabe.dueAt !== undefined && eingabe.dueAt?.getTime() !== vorher.dueAt?.getTime()) {
    await vermerke({
      guildId: vorher.guildId,
      art: 'task.due',
      actorDiscordId: akteurDiscordId,
      projectId: nachher.projectId,
      taskId,
      detail: eingabe.dueAt ? eingabe.dueAt.toISOString().slice(0, 10) : 'ohne Frist',
    });
  }

  return nachher;
}

/**
 * Eine Aufgabe löschen.
 *
 * Bei Aufgaben ist Löschen zulässig, bei Projekten nicht - der Unterschied ist
 * nicht Bequemlichkeit, sondern was daran hängt: eine falsch angelegte Aufgabe
 * ist ein Tippfehler, der weg soll, und «Abgebrochen» gibt es für den anderen
 * Fall. Die Berechtigung dafür ist als eingriffsstark markiert.
 */
export async function loescheAufgabe(taskId: string, akteurDiscordId: string): Promise<void> {
  const aufgabe = await prisma.workspaceTask.findUnique({ where: { id: taskId } });
  if (!aufgabe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  await prisma.workspaceTask.delete({ where: { id: taskId } });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TASK_DELETED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: aufgabe.title,
    success: true,
    metadata: { taskId, projectId: aufgabe.projectId, status: aufgabe.status },
  });
}

export interface AufgabeMitBezug {
  aufgabe: WorkspaceTask;
  zustaendige: string[];
  projektTitel: string | null;
  checklisteOffen: number;
  checklisteGesamt: number;
}

export interface AufgabenFilter {
  projectId?: string | null;
  status?: readonly WorkspaceTaskStatus[];
  prioritaet?: readonly WorkspacePriority[];
  zustaendig?: string;
  /** `true`: nur Aufgaben ohne Zuständige. */
  ohneZustaendige?: boolean;
  suche?: string;
  bisFrist?: Date;
  /** Aufgaben archivierter Projekte bleiben standardmässig draussen. */
  mitArchivierten?: boolean;
  grenze?: number;
}

/**
 * Aufgaben laden.
 *
 * Die Sortierung passiert hier und nicht in der Datenbank: «dringend zuerst,
 * dann nach Frist» verlangt eine Reihenfolge über die Prioritätsstufen, die
 * das Enum alphabetisch nicht hergibt (`HIGH` vor `LOW` vor `NORMAL`). Bei
 * einer nach oben begrenzten Liste ist das günstiger als ein `CASE` im SQL.
 */
export async function ladeAufgaben(
  guildId: string,
  betrachter: WorkspaceBetrachter,
  filter: AufgabenFilter = {},
): Promise<AufgabeMitBezug[]> {
  const suche = filter.suche?.trim();
  /*
   * Aufgaben erben die Sichtbarkeit ihres Projekts.
   *
   * Ohne diesen Filter waere das Board die Luecke: der Titel jeder Aufgabe
   * eines privaten Projekts stuende darin, samt Frist und Zustaendigen. Dass
   * die Projektseite selbst gesperrt ist, haette dann nichts genuetzt.
   */
  const sicht = await aufgabenFilter(betrachter);
  const zeilen = await prisma.workspaceTask.findMany({
    /*
     * Drei Teile mit je einem eigenen `OR` - Sichtbarkeit, «nicht
     * archiviert», Suche. Gespreizt in dasselbe Objekt haette jeder den
     * vorigen ueberschrieben, lautlos. Deshalb `undAlles`.
     */
    where: undAlles<Prisma.WorkspaceTaskWhereInput>(
      sicht,
      {
        guildId,
        ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
        ...(filter.status ? { status: { in: [...filter.status] } } : {}),
        ...(filter.prioritaet ? { priority: { in: [...filter.prioritaet] } } : {}),
        ...(filter.zustaendig ? { assignees: { some: { discordId: filter.zustaendig } } } : {}),
        ...(filter.ohneZustaendige ? { assignees: { none: {} } } : {}),
        ...(filter.bisFrist ? { dueAt: { not: null, lte: filter.bisFrist } } : {}),
      },
      filter.mitArchivierten ? null : nichtArchiviert(),
      suche
        ? {
            OR: [
              { title: { contains: suche, mode: 'insensitive' as const } },
              { description: { contains: suche, mode: 'insensitive' as const } },
              { tags: { has: suche.toLowerCase() } },
            ],
          }
        : null,
    ),
    include: {
      assignees: { select: { discordId: true } },
      project: { select: { title: true } },
      checklist: { select: { erledigt: true } },
    },
    take: Math.min(Math.max(filter.grenze ?? 300, 1), 500),
    orderBy: { updatedAt: 'desc' },
  });

  return zeilen
    .map((zeile) => ({
      aufgabe: zeile,
      zustaendige: zeile.assignees.map((eintrag) => eintrag.discordId),
      projektTitel: zeile.project?.title ?? null,
      checklisteGesamt: zeile.checklist.length,
      checklisteOffen: zeile.checklist.filter((eintrag) => !eintrag.erledigt).length,
    }))
    .sort(vergleiche);
}

/**
 * «Was als Nächstes»: Frist zuerst, dann Priorität.
 *
 * Erst die Frist, weil ein Termin morgen dringender ist als eine wichtige
 * Aufgabe ohne Datum - und Aufgaben ohne Frist hinten, weil sie sonst die
 * Liste füllen, ohne je abzulaufen.
 */
function vergleiche(a: AufgabeMitBezug, b: AufgabeMitBezug): number {
  const fristA = a.aufgabe.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const fristB = b.aufgabe.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (fristA !== fristB) {
    return fristA - fristB;
  }
  const gewichtA = PRIORITAET_GEWICHT[a.aufgabe.priority] ?? 0;
  const gewichtB = PRIORITAET_GEWICHT[b.aufgabe.priority] ?? 0;
  if (gewichtA !== gewichtB) {
    return gewichtB - gewichtA;
  }
  return b.aufgabe.updatedAt.getTime() - a.aufgabe.updatedAt.getTime();
}

export async function ladeAufgabe(
  taskId: string,
  betrachter: WorkspaceBetrachter,
): Promise<AufgabeMitBezug | null> {
  /*
   * Die Sichtbarkeit steckt im `where`, nicht in einer Pruefung danach.
   *
   * Eine Aufgabe eines Projekts, das dieser Betrachter nicht sehen darf, ergibt
   * damit `null` - dasselbe wie «gibt es nicht», und die Seite macht daraus ein
   * 404. Eine Fehlerseite waere eine Auskunft: sie sagt, dass da etwas ist.
   */
  const sicht = await aufgabenFilter(betrachter);
  const zeile = await prisma.workspaceTask.findFirst({
    where: undAlles<Prisma.WorkspaceTaskWhereInput>(sicht, { id: taskId }),
    include: {
      assignees: { select: { discordId: true } },
      project: { select: { title: true } },
      checklist: { select: { erledigt: true } },
    },
  });
  if (!zeile) {
    return null;
  }
  return {
    aufgabe: zeile,
    zustaendige: zeile.assignees.map((eintrag) => eintrag.discordId),
    projektTitel: zeile.project?.title ?? null,
    checklisteGesamt: zeile.checklist.length,
    checklisteOffen: zeile.checklist.filter((eintrag) => !eintrag.erledigt).length,
  };
}
