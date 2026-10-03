import { prisma } from '@swisshub/database';
import type { Prisma, WorkspaceProject, WorkspaceVisibility } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';

/**
 * Wer welches Projekt sehen darf.
 *
 * ## Warum das hier steht und nicht in der Oberfläche
 *
 * Weil eine Seite, die ein Projekt nicht anzeigt, es nicht versteckt. Die
 * Kennung steht in jeder URL, und eine Server Action ist ein Endpunkt. Ein
 * «privates» Projekt, dessen Kennung jemand kennt, wäre ohne diese Datei
 * vollständig lesbar - samt Aufgaben, Kommentaren und Anhängen.
 *
 * Deshalb gibt es genau zwei Formen derselben Regel:
 *
 * - `projektFilter` / `aufgabenFilter` für **Listen**: ein Stück `where`, das
 *   jede Abfrage mitträgt. Was nicht sichtbar ist, kommt nicht zurück - es
 *   wird nicht nachträglich herausgefiltert, denn eine Zählung, ein `take`
 *   oder eine Sortierung über unsichtbare Zeilen verrät sie schon.
 * - `sichereProjektSicht` / `sichereAufgabenSicht` für **einzelne Kennungen**:
 *   dieselbe Regel, angewandt auf ein Objekt.
 *
 * ## Warum «nicht gefunden» und nicht «verboten»
 *
 * Weil «verboten» bestätigt, dass es das Projekt gibt. Bei einem privaten
 * Projekt ist genau das die Auskunft, die niemand bekommen soll - wer eine
 * Kennung durchprobiert, erfährt sonst, welche existieren.
 */

/**
 * Mehrere `where`-Teile mit UND verknuepfen.
 *
 * ## Warum nicht einfach spreizen
 *
 * Weil `{ ...a, ...b }` bei Prisma **stillschweigend** ueberschreibt: bringen
 * beide Teile ein `OR` mit, gewinnt das letzte, und das erste ist weg. Genau
 * das ist hier passiert - der Sichtbarkeitsfilter und `nichtArchiviert()`
 * haben beide ein `OR`, und das Ergebnis war eine Liste, in der private
 * Aufgaben standen. Beide Teile sahen fuer sich richtig aus; nur zusammen
 * waren sie es nicht, und ohne Test faellt so etwas nie auf.
 *
 * Ein `AND` kann nichts ueberschreiben. Leere Teile fallen heraus, damit ein
 * `AND: [{}]` nicht als Bedingung auftaucht.
 */
export function undAlles<T extends object>(...teile: Array<T | undefined | null>): { AND: T[] } {
  return {
    AND: teile.filter((teil): teil is T => Boolean(teil) && Object.keys(teil as object).length > 0),
  };
}

/**
 * Wer schaut.
 *
 * `darfAlles` kommt aus der Berechtigungsprüfung des Aufrufers und nicht aus
 * dieser Datei: welche Berechtigung «alles sehen» bedeutet, entscheidet die
 * WebApp, und hier wird sie nur angewandt.
 *
 * Die Rollen stehen **nicht** im Betrachter: sie kommen aus Discord und werden
 * hier geholt. Käme sie der Aufrufer mitgeben, wäre eine erfundene Rollenliste
 * der Weg in jedes Projekt.
 */
export interface WorkspaceBetrachter {
  discordId: string;
  darfAlles: boolean;
}

/** Nur die Mitglieder - dieselbe Lesart wie «leer heisst niemand». */
const NUR_MITGLIEDER: readonly WorkspaceVisibility[] = ['PRIVATE'];

/**
 * Die Discord-Rollen des Betrachters.
 *
 * Ein Zugriff je Prüfung. Ist das Mitglied nicht auffindbar - ausgetreten,
 * Discord gerade nicht erreichbar -, gilt die leere Liste: dann sieht die
 * Person die Gruppenprojekte nicht, und das ist die richtige Richtung für
 * einen Fehlschlag.
 */
export async function rollenDesBetrachters(betrachter: WorkspaceBetrachter): Promise<string[]> {
  return betrachter.darfAlles ? [] : rollenVon(betrachter.discordId);
}

async function rollenVon(discordId: string): Promise<string[]> {
  const mitglied = await discord.members.get(discordId).catch(() => null);
  return mitglied?.roleIds ? [...mitglied.roleIds] : [];
}

/**
 * Der `where`-Teil für Projektabfragen.
 *
 * Bei `darfAlles` ein leeres Objekt - und nicht etwa ein `OR`, das alles
 * zulässt: ein leeres `where` lässt sich mit jedem anderen zusammensetzen,
 * ohne dessen Bedeutung zu verändern.
 */
export async function projektFilter(
  betrachter: WorkspaceBetrachter,
): Promise<Prisma.WorkspaceProjectWhereInput> {
  if (betrachter.darfAlles) {
    return {};
  }
  const rollen = await rollenVon(betrachter.discordId);
  return {
    OR: [
      { visibility: 'TEAM' },
      // Mitglied sticht alles: wer im Projekt steht, sieht es.
      { members: { some: { discordId: betrachter.discordId } } },
      ...(rollen.length > 0
        ? [{ visibility: 'SELECTED_GROUPS' as const, visibleRoleIds: { hasSome: rollen } }]
        : []),
    ],
  };
}

/**
 * Derselbe Filter für Aufgaben.
 *
 * Eine Aufgabe ohne Projekt ist für alle da - nicht alles ist ein Projekt, und
 * eine projektlose Aufgabe hat keine Sichtbarkeit zu erben. Eine Aufgabe **mit**
 * Projekt erbt sie vollständig: sonst wäre das Board die Lücke, durch die der
 * Titel jeder privaten Aufgabe zu lesen wäre.
 */
export async function aufgabenFilter(
  betrachter: WorkspaceBetrachter,
): Promise<Prisma.WorkspaceTaskWhereInput> {
  if (betrachter.darfAlles) {
    return {};
  }
  const filter = await projektFilter(betrachter);
  return { OR: [{ projectId: null }, { project: filter }] };
}

/** Darf dieser Betrachter dieses Projekt sehen? Ohne Datenbankzugriff. */
export function darfProjektSehen(
  projekt: Pick<WorkspaceProject, 'visibility' | 'visibleRoleIds'> & {
    members?: ReadonlyArray<{ discordId: string }>;
  },
  betrachter: WorkspaceBetrachter,
  rollen: readonly string[],
): boolean {
  if (betrachter.darfAlles) {
    return true;
  }
  if (projekt.members?.some((eintrag) => eintrag.discordId === betrachter.discordId)) {
    return true;
  }
  if (projekt.visibility === 'TEAM') {
    return true;
  }
  if (NUR_MITGLIEDER.includes(projekt.visibility)) {
    return false;
  }
  return projekt.visibleRoleIds.some((rolle) => rollen.includes(rolle));
}

const NICHT_GEFUNDEN = (): AppError =>
  new AppError('NOT_FOUND', { userMessage: 'Dieses Projekt gibt es nicht.' });

/**
 * Den Zugang zu einem Projekt sicherstellen - oder abbrechen.
 *
 * Wirft `NOT_FOUND`, wenn das Projekt nicht existiert **oder** nicht sichtbar
 * ist. Beides derselbe Fehler, mit Absicht.
 */
export async function sichereProjektSicht(projectId: string, betrachter: WorkspaceBetrachter): Promise<void> {
  if (betrachter.darfAlles) {
    return;
  }
  const projekt = await prisma.workspaceProject.findUnique({
    where: { id: projectId },
    select: {
      visibility: true,
      visibleRoleIds: true,
      members: { select: { discordId: true } },
    },
  });
  if (!projekt) {
    throw NICHT_GEFUNDEN();
  }
  const rollen = await rollenVon(betrachter.discordId);
  if (!darfProjektSehen(projekt, betrachter, rollen)) {
    throw NICHT_GEFUNDEN();
  }
}

/**
 * Dasselbe für eine Aufgabe - über ihr Projekt.
 *
 * Eine Aufgabe ohne Projekt ist sichtbar; ihre Kennung ist dann der einzige
 * Schutz, und das ist auch vorher so gewesen.
 */
export async function sichereAufgabenSicht(taskId: string, betrachter: WorkspaceBetrachter): Promise<void> {
  if (betrachter.darfAlles) {
    return;
  }
  const aufgabe = await prisma.workspaceTask.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!aufgabe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Aufgabe gibt es nicht.' });
  }
  if (aufgabe.projectId) {
    await sichereProjektSicht(aufgabe.projectId, betrachter);
  }
}
