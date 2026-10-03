'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { workspace } from '@swisshub/modules';
import { AppError, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { workspaceBetrachter } from '@/modules/workspace/daten';
import type { AuthContext } from '@swisshub/auth';

/**
 * Was im Workspace geschieht.
 *
 * ## Jede Aktion prüft serverseitig
 *
 * `defineAction` lehnt ohne die genannte Berechtigung ab, vor dem ersten
 * Zugriff auf die Datenbank. Die Oberfläche entscheidet, welche Knöpfe sie
 * zeigt; was passiert, entscheidet diese Datei. Ein Board ohne Knopf ist keine
 * Sicherung - eine Server Action ist ein Endpunkt.
 *
 * ## Die zweite Prüfung: wessen Projekt ist das
 *
 * Eine Berechtigung sagt «darf Aufgaben bearbeiten», nicht «darf **diese**
 * Aufgabe bearbeiten». Für Projekte gibt es deshalb `darfBearbeiten`: die
 * globale Berechtigung **oder** die Leitung dieses Projekts. Ohne diese zweite
 * Frage wäre jede Projektkennung aus einem Formular ein Zugriff auf ein
 * fremdes Projekt.
 *
 * ## Die Kennung des Handelnden kommt aus der Sitzung
 *
 * Immer. Eine `discordId` aus dem Formular gibt es in keiner dieser Aktionen -
 * sonst könnte jeder im Namen eines anderen eintragen.
 */

const neuLaden = (): void => {
  revalidatePath(systemRoutes.workspace());
  revalidatePath(systemRoutes.workspaceMeine());
  revalidatePath(systemRoutes.workspaceBoard());
  revalidatePath(systemRoutes.workspaceProjekte());
  revalidatePath(systemRoutes.workspaceArchiv());
};

const neuLadenProjekt = (projectId: string | null): void => {
  neuLaden();
  if (projectId) {
    revalidatePath(systemRoutes.workspaceProjekt(projectId));
  }
};

const statusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']);
const prioritaetSchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const projektStatusSchema = z.enum(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
const erinnerungSchema = z.enum(['NONE', 'ON_DUE_DATE', 'ONE_DAY', 'THREE_DAYS', 'ONE_WEEK']);
const kennungSchema = z.string().regex(/^\d{16,20}$/u);
const tagsSchema = z.array(z.string().trim().max(32)).max(10);

/*
 * Ein Datum aus einem `<input type="date">`.
 *
 * Leer heisst «keine Frist» und ist etwas anderes als «unverändert» - deshalb
 * `null` und nicht `undefined`. Gelesen wird der Tag als 12:00 Uhr: um
 * Mitternacht läge er je nach Zeitzone noch im Vortag, und eine Frist, die
 * einen Tag früher anzeigt als eingegeben, ist ein Fehler, den niemand mehr
 * findet.
 */
const datumSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .or(z.literal(''))
  .nullable()
  .transform((wert) => (wert ? new Date(`${wert}T12:00:00Z`) : null));

/**
 * Sichtbarkeit zuerst - bei **jeder** Aktion mit einer Kennung.
 *
 * Eine Berechtigung sagt «darf Aufgaben bearbeiten». Sie sagt nichts darüber,
 * ob diese Aufgabe zu einem Projekt gehört, das der Aufrufer überhaupt sehen
 * darf. Ohne diese Zeile wäre jede private Projektkennung aus einem Formular
 * ein Schreibzugriff - und, weil Fehlermeldungen auskunftsfreudig sind, auch
 * ein Lesezugriff.
 *
 * Geprüft wird im Modul (`sichtbarkeit.ts`), damit dieselbe Regel gilt wie
 * beim Lesen. Was es nicht zu sehen gibt, gibt es nicht: der Fehler ist
 * `NOT_FOUND` und nicht `FORBIDDEN`.
 */
async function pruefeSichtbarkeit(
  ctx: AuthContext,
  input: { taskId?: string | null | undefined; projectId?: string | null | undefined },
): Promise<void> {
  const betrachter = workspaceBetrachter(ctx);
  if (input.taskId) {
    await workspace.sichereAufgabenSicht(input.taskId, betrachter);
  }
  if (input.projectId) {
    await workspace.sichereProjektSicht(input.projectId, betrachter);
  }
}

/** Die Projektleitung oder die globale Berechtigung - geprüft, nicht angenommen. */
async function pruefeProjektzugriff(
  ctx: AuthContext,
  projectId: string,
  globaleBerechtigung: string,
): Promise<void> {
  // Erst sehen, dann dürfen: ein Projekt, das nicht sichtbar ist, gibt es für
  // diesen Aufrufer nicht - auch nicht als «darf nicht bearbeiten».
  await pruefeSichtbarkeit(ctx, { projectId });
  const erlaubt = await workspace.darfBearbeiten(
    projectId,
    ctx.user.discordId,
    can(ctx, globaleBerechtigung),
  );
  if (!erlaubt) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Dieses Projekt darf nur die Projektleitung bearbeiten.',
    });
  }
}

/**
 * Aufgabe **oder** Projekt - genau eines.
 *
 * Links und Anhänge hängen an einem von beiden. Beides mitzuschicken ist keine
 * zulässige Angabe; es nach einer Rangfolge aufzulösen hiesse, den Eintrag
 * irgendwo abzulegen, wo niemand ihn sucht.
 */
function bezugAus(input: {
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
}): { taskId: string } | { projectId: string } {
  if (input.taskId && input.projectId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Eintrag gehört an eine Aufgabe oder an ein Projekt.',
    });
  }
  if (input.taskId) {
    return { taskId: input.taskId };
  }
  if (input.projectId) {
    return { projectId: input.projectId };
  }
  throw new AppError('VALIDATION_FAILED', {
    userMessage: 'Es fehlt die Aufgabe oder das Projekt.',
  });
}

function neuLadenBezug(bezug: { taskId: string } | { projectId: string }): void {
  if ('taskId' in bezug) {
    revalidatePath(systemRoutes.workspaceAufgabe(bezug.taskId));
    return;
  }
  revalidatePath(systemRoutes.workspaceProjekt(bezug.projectId));
}

// --- Projekte ---------------------------------------------------------------

export const workspaceProjektErstellenAction = defineAction(
  {
    name: 'workspace.project.create',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.projectsCreate,
    schema: z.object({
      titel: z.string().trim().min(1).max(120),
      beschreibung: z.string().trim().max(4000).nullable().optional(),
      status: projektStatusSchema.optional(),
      prioritaet: prioritaetSchema.nullable().optional(),
      akzent: z.string().trim().max(40).nullable().optional(),
      startAt: datumSchema.optional(),
      dueAt: datumSchema.optional(),
      tags: tagsSchema.optional(),
      sichtbarkeit: z.enum(['TEAM', 'SELECTED_GROUPS', 'PRIVATE']).optional(),
      sichtbarFuerRollen: z.array(kennungSchema).max(25).optional(),
      discordChannelId: kennungSchema.nullable().optional(),
      discordUpdates: z.boolean().optional(),
      discordEvents: z.array(z.string().max(40)).max(40).optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    // Keine Sichtbarkeitspruefung: hier entsteht das Projekt erst, und seine
    // Sichtbarkeit ist Teil der Eingabe.
    const guildId = await resolveGuildId();
    const projekt = await workspace.erstelleProjekt(guildId, ctx.user.discordId, input);
    neuLadenProjekt(projekt.id);
    return { projectId: projekt.id };
  },
);

export const workspaceProjektAendernAction = defineAction(
  {
    name: 'workspace.project.update',
    module: workspace.WORKSPACE_MODULE_ID,
    /*
     * Zwei Stufen, und beide braucht es.
     *
     * `view` ist der Boden: ohne sie gibt es das Modul für diese Person nicht,
     * auch nicht als Endpunkt. Was darüber kommt, lässt sich nicht als feste
     * Berechtigung ausdrücken - `projects.edit` deckt **alle** Projekte,
     * die Projektleitung nur **ihr eigenes**. Deshalb `pruefeProjektzugriff`
     * im Rumpf, dieselbe Zweiteilung wie bei den Terminen im Kalender.
     */
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      projectId: z.string().min(1).max(40),
      titel: z.string().trim().min(1).max(120).optional(),
      beschreibung: z.string().trim().max(4000).nullable().optional(),
      status: projektStatusSchema.optional(),
      prioritaet: prioritaetSchema.nullable().optional(),
      akzent: z.string().trim().max(40).nullable().optional(),
      startAt: datumSchema.optional(),
      dueAt: datumSchema.optional(),
      tags: tagsSchema.optional(),
      sichtbarkeit: z.enum(['TEAM', 'SELECTED_GROUPS', 'PRIVATE']).optional(),
      sichtbarFuerRollen: z.array(kennungSchema).max(25).optional(),
      discordChannelId: kennungSchema.nullable().optional(),
      /*
       * Die Kanalmeldungen gehoeren zum Projekt, nicht in eine eigene Aktion.
       *
       * Wer das Projekt bearbeiten darf, stellt auch seine Meldungen ein -
       * das prueft `pruefeProjektzugriff` unten mit derselben Berechtigung wie
       * fuer Titel und Frist. Eine zweite Aktion mit einer zweiten
       * Berechtigung waere eine zweite Stelle, an der man es falsch machen kann.
       *
       * Unbekannte Schluessel wirft `sortiereEreignisse` im Modul weg; hier
       * steht nur eine Laengengrenze, damit niemand ein Megabyte schickt.
       */
      discordUpdates: z.boolean().optional(),
      discordEvents: z.array(z.string().max(40)).max(40).optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    const { projectId, ...rest } = input;
    await pruefeProjektzugriff(ctx, projectId, workspace.WORKSPACE_PERMISSIONS.projectsEdit);
    await workspace.aendereProjekt(projectId, ctx.user.discordId, rest);
    neuLadenProjekt(projectId);
    return { ok: true };
  },
);

export const workspaceMitgliederSetzenAction = defineAction(
  {
    name: 'workspace.project.members',
    module: workspace.WORKSPACE_MODULE_ID,
    // Wie oben: `view` als Boden, die Projektleitung als zweite Stufe im Rumpf.
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      projectId: z.string().min(1).max(40),
      mitglieder: z
        .array(z.object({ discordId: kennungSchema, rolle: z.enum(['LEAD', 'MEMBER']) }))
        .min(1)
        .max(30),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeProjektzugriff(ctx, input.projectId, workspace.WORKSPACE_PERMISSIONS.projectsEdit);
    await workspace.setzeMitglieder(input.projectId, ctx.user.discordId, input.mitglieder);
    neuLadenProjekt(input.projectId);
    return { ok: true };
  },
);

export const workspaceProjektArchivierenAction = defineAction(
  {
    name: 'workspace.project.archive',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.projectsArchive,
    schema: z.object({ projectId: z.string().min(1).max(40) }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.archiviere(input.projectId, ctx.user.discordId);
    neuLadenProjekt(input.projectId);
    return { ok: true };
  },
);

export const workspaceProjektZurueckholenAction = defineAction(
  {
    name: 'workspace.project.restore',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.projectsArchive,
    schema: z.object({ projectId: z.string().min(1).max(40) }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.holeZurueck(input.projectId, ctx.user.discordId);
    neuLadenProjekt(input.projectId);
    return { ok: true };
  },
);

// --- Aufgaben ---------------------------------------------------------------

export const workspaceAufgabeErstellenAction = defineAction(
  {
    name: 'workspace.task.create',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksCreate,
    schema: z.object({
      titel: z.string().trim().min(1).max(160),
      beschreibung: z.string().trim().max(8000).nullable().optional(),
      projectId: z.string().min(1).max(40).nullable().optional(),
      status: statusSchema.optional(),
      prioritaet: prioritaetSchema.optional(),
      startAt: datumSchema.optional(),
      dueAt: datumSchema.optional(),
      reminder: erinnerungSchema.optional(),
      tags: tagsSchema.optional(),
      zustaendige: z.array(kennungSchema).max(20).optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    /*
     * Auch beim Anlegen - wegen der Projektkennung.
     *
     * Eine Aufgabe in einem Projekt anzulegen, das man nicht sehen darf, waere
     * der bequemste Weg hinein: man schreibt sich selbst eine Aufgabe hinzu
     * und liest danach alles, was daran haengt. Ohne Projekt prueft die Hilfe
     * nichts - dann gibt es auch nichts zu pruefen.
     */
    await pruefeSichtbarkeit(ctx, input);
    const guildId = await resolveGuildId();
    const aufgabe = await workspace.erstelleAufgabe(guildId, ctx.user.discordId, input);
    neuLadenProjekt(aufgabe.projectId);
    return { taskId: aufgabe.id };
  },
);

export const workspaceAufgabeAendernAction = defineAction(
  {
    name: 'workspace.task.update',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      titel: z.string().trim().min(1).max(160).optional(),
      beschreibung: z.string().trim().max(8000).nullable().optional(),
      projectId: z.string().min(1).max(40).nullable().optional(),
      prioritaet: prioritaetSchema.optional(),
      startAt: datumSchema.optional(),
      dueAt: datumSchema.optional(),
      reminder: erinnerungSchema.optional(),
      tags: tagsSchema.optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const { taskId, ...rest } = input;
    const aufgabe = await workspace.aendereAufgabe(taskId, ctx.user.discordId, rest);
    neuLadenProjekt(aufgabe.projectId);
    revalidatePath(systemRoutes.workspaceAufgabe(taskId));
    return { ok: true };
  },
);

/**
 * Der Statuswechsel - mit dem Status, den der Absender vor sich sah.
 *
 * `erwarteterStatus` ist der Kern dieser Aktion und nicht Beiwerk: zwei Leute
 * am selben Board, und wer eine Karte zieht, die inzwischen weitergewandert
 * ist, dreht sie sonst zurück. Der Kern prüft ihn in der `WHERE`-Bedingung des
 * `UPDATE`.
 */
export const workspaceStatusSetzenAction = defineAction(
  {
    name: 'workspace.task.status',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      status: statusSchema,
      erwarteterStatus: statusSchema.optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const aufgabe = await workspace.setzeStatus(input.taskId, ctx.user.discordId, input.status, {
      ...(input.erwarteterStatus ? { erwarteterStatus: input.erwarteterStatus } : {}),
    });
    neuLadenProjekt(aufgabe.projectId);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { status: aufgabe.status };
  },
);

export const workspacePrioritaetSetzenAction = defineAction(
  {
    name: 'workspace.task.priority',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({ taskId: z.string().min(1).max(40), prioritaet: prioritaetSchema }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const aufgabe = await workspace.setzePrioritaet(input.taskId, ctx.user.discordId, input.prioritaet);
    neuLadenProjekt(aufgabe.projectId);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { ok: true };
  },
);

export const workspaceZustaendigeSetzenAction = defineAction(
  {
    name: 'workspace.task.assignees',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      discordIds: z.array(kennungSchema).max(20),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.setzeZustaendige(input.taskId, ctx.user.discordId, input.discordIds);
    neuLaden();
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { ok: true };
  },
);

export const workspaceFristSetzenAction = defineAction(
  {
    name: 'workspace.task.due',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      dueAt: datumSchema,
      reminder: erinnerungSchema.optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const aufgabe = await workspace.setzeFrist(input.taskId, ctx.user.discordId, input.dueAt, input.reminder);
    neuLadenProjekt(aufgabe.projectId);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { ok: true };
  },
);

export const workspaceAufgabeLoeschenAction = defineAction(
  {
    name: 'workspace.task.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksDelete,
    schema: z.object({ taskId: z.string().min(1).max(40) }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.loescheAufgabe(input.taskId, ctx.user.discordId);
    neuLaden();
    return { ok: true };
  },
);

// --- Mitarbeit: Kommentare, Checkliste, Links, Anhänge ----------------------

/*
 * Für alle vier gilt `tasksEdit`.
 *
 * Nicht eine eigene Berechtigung je Kleinteil: wer eine Aufgabe pflegen darf,
 * darf sie kommentieren, abhaken und einen Link dranhängen - das ist dieselbe
 * Arbeit. Eine Berechtigung «darf kommentieren» wäre eine Zeile mehr in der
 * Rechtematrix und keine Entscheidung, die jemand je anders treffen würde.
 *
 * Der Anhang-Upload läuft **nicht** hier: eine Datei lässt sich nicht über eine
 * Server Action übertragen. Er hat einen Route Handler mit derselben Kette.
 */

export const workspaceKommentarSchreibenAction = defineAction(
  {
    name: 'workspace.comment.create',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      text: z.string().trim().min(1).max(4000),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const kommentar = await workspace.schreibeKommentar(input.taskId, ctx.user.discordId, input.text);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { kommentarId: kommentar.id };
  },
);

export const workspaceKommentarLoeschenAction = defineAction(
  {
    name: 'workspace.comment.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    // `view` als Boden; welchen Kommentar jemand löschen darf, entscheidet der
    // Kern: nur den eigenen. Ein fremder Kommentar ist die Begründung einer
    // anderen Person, und die gehört nicht in fremde Hand.
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      kommentarId: z.string().min(1).max(40),
      taskId: z.string().min(1).max(40),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.loescheKommentar(input.kommentarId, ctx.user.discordId);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { ok: true };
  },
);

export const workspaceChecklisteErgaenzenAction = defineAction(
  {
    name: 'workspace.checklist.add',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40),
      text: z.string().trim().min(1).max(200),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const punkt = await workspace.ergaenzeChecklistenpunkt(input.taskId, ctx.user.discordId, input.text);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    return { punktId: punkt.id };
  },
);

export const workspaceChecklisteAbhakenAction = defineAction(
  {
    name: 'workspace.checklist.toggle',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      punktId: z.string().min(1).max(40),
      taskId: z.string().min(1).max(40),
      erledigt: z.boolean(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.hakeAb(input.punktId, input.erledigt);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    // Der Fortschritt der Aufgabe steht auch auf dem Board und in den Listen.
    neuLaden();
    return { ok: true };
  },
);

export const workspaceChecklisteLoeschenAction = defineAction(
  {
    name: 'workspace.checklist.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      punktId: z.string().min(1).max(40),
      taskId: z.string().min(1).max(40),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.loescheChecklistenpunkt(input.punktId);
    revalidatePath(systemRoutes.workspaceAufgabe(input.taskId));
    neuLaden();
    return { ok: true };
  },
);

export const workspaceLinkErgaenzenAction = defineAction(
  {
    name: 'workspace.link.add',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      taskId: z.string().min(1).max(40).nullable().optional(),
      projectId: z.string().min(1).max(40).nullable().optional(),
      titel: z.string().trim().max(120),
      // Die Adresse wird hier **nicht** per Zod geprüft, sondern im Kern:
      // `pruefeUrl` entscheidet über das Schema, lehnt Zugangsdaten ab und gibt
      // die normalisierte Adresse zurück. Zwei Prüfungen wären zwei Meinungen.
      url: z.string().trim().min(1).max(2000),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    const bezug = bezugAus(input);
    const link = await workspace.ergaenzeLink(bezug, ctx.user.discordId, input.titel, input.url);
    neuLadenBezug(bezug);
    return { linkId: link.id };
  },
);

export const workspaceLinkLoeschenAction = defineAction(
  {
    name: 'workspace.link.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      linkId: z.string().min(1).max(40),
      taskId: z.string().min(1).max(40).nullable().optional(),
      projectId: z.string().min(1).max(40).nullable().optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.loescheLink(input.linkId);
    neuLadenBezug(bezugAus(input));
    return { ok: true };
  },
);

export const workspaceAnhangLoeschenAction = defineAction(
  {
    name: 'workspace.attachment.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.tasksEdit,
    schema: z.object({
      anhangId: z.string().min(1).max(40),
      taskId: z.string().min(1).max(40).nullable().optional(),
      projectId: z.string().min(1).max(40).nullable().optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeSichtbarkeit(ctx, input);
    await workspace.loescheAnhang(input.anhangId);
    neuLadenBezug(bezugAus(input));
    return { ok: true };
  },
);

// --- Meilensteine -----------------------------------------------------------

export const workspaceMeilensteinErstellenAction = defineAction(
  {
    name: 'workspace.milestone.create',
    module: workspace.WORKSPACE_MODULE_ID,
    // Wie beim Projekt selbst: `view` als Boden, die Projektleitung als zweite
    // Stufe im Rumpf. Ein Meilenstein ist Projektplanung.
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      projectId: z.string().min(1).max(40),
      titel: z.string().trim().min(1).max(120),
      beschreibung: z.string().trim().max(2000).nullable().optional(),
      dueAt: datumSchema,
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeProjektzugriff(ctx, input.projectId, workspace.WORKSPACE_PERMISSIONS.projectsEdit);
    if (!input.dueAt) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Ein Meilenstein ohne Datum ist kein Meilenstein.',
      });
    }
    const meilenstein = await workspace.ergaenzeMeilenstein(input.projectId, ctx.user.discordId, {
      titel: input.titel,
      beschreibung: input.beschreibung ?? null,
      dueAt: input.dueAt,
    });
    neuLadenProjekt(input.projectId);
    revalidatePath(systemRoutes.workspacePlanung());
    return { meilensteinId: meilenstein.id };
  },
);

export const workspaceMeilensteinAendernAction = defineAction(
  {
    name: 'workspace.milestone.update',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      meilensteinId: z.string().min(1).max(40),
      projectId: z.string().min(1).max(40),
      titel: z.string().trim().min(1).max(120).optional(),
      beschreibung: z.string().trim().max(2000).nullable().optional(),
      dueAt: datumSchema.optional(),
      erledigt: z.boolean().optional(),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeProjektzugriff(ctx, input.projectId, workspace.WORKSPACE_PERMISSIONS.projectsEdit);
    const { meilensteinId, projectId, dueAt, ...rest } = input;
    await workspace.aendereMeilenstein(meilensteinId, ctx.user.discordId, {
      ...rest,
      // `null` wäre «Datum weg», und das gibt es bei einem Meilenstein nicht -
      // deshalb nur übernehmen, wenn tatsächlich eines kam.
      ...(dueAt ? { dueAt } : {}),
    });
    neuLadenProjekt(projectId);
    revalidatePath(systemRoutes.workspacePlanung());
    return { ok: true };
  },
);

export const workspaceMeilensteinLoeschenAction = defineAction(
  {
    name: 'workspace.milestone.delete',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.view,
    schema: z.object({
      meilensteinId: z.string().min(1).max(40),
      projectId: z.string().min(1).max(40),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await pruefeProjektzugriff(ctx, input.projectId, workspace.WORKSPACE_PERMISSIONS.projectsEdit);
    await workspace.loescheMeilenstein(input.meilensteinId);
    neuLadenProjekt(input.projectId);
    revalidatePath(systemRoutes.workspacePlanung());
    return { ok: true };
  },
);

// --- Vorlagen ---------------------------------------------------------------

export const workspaceVorlageErstellenAction = defineAction(
  {
    name: 'workspace.template.create',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.templatesManage,
    schema: z.object({
      name: z.string().trim().min(1).max(80),
      beschreibung: z.string().trim().max(1000).nullable().optional(),
      projektTitel: z.string().trim().min(1).max(160),
      akzent: z.string().trim().max(40).nullable().optional(),
      tags: tagsSchema.optional(),
      aufgaben: z
        .array(
          z.object({
            titel: z.string().trim().min(1).max(160),
            prioritaet: prioritaetSchema.optional(),
            // Rund zwei Jahre in beide Richtungen: alles darüber ist ein
            // Tippfehler und keine Planung.
            faelligNachTagen: z.coerce.number().int().min(-730).max(730).nullable().optional(),
          }),
        )
        .max(50),
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const vorlage = await workspace.erstelleVorlage(guildId, ctx.user.discordId, input);
    revalidatePath(systemRoutes.workspaceVorlagen());
    return { templateId: vorlage.id };
  },
);

export const workspaceStandardvorlagenAction = defineAction(
  {
    name: 'workspace.template.seed',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.templatesManage,
    schema: z.object({}),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx }) => {
    const guildId = await resolveGuildId();
    const angelegt = await workspace.legeStandardvorlagenAn(guildId, ctx.user.discordId);
    revalidatePath(systemRoutes.workspaceVorlagen());
    // Die Zahl zurück, damit die Oberfläche etwas Wahres sagen kann und nicht
    // «vier Vorlagen angelegt», wenn es keine war.
    return { angelegt };
  },
);

export const workspaceVorlageArchivierenAction = defineAction(
  {
    name: 'workspace.template.archive',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.templatesManage,
    schema: z.object({ templateId: z.string().min(1).max(40) }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    await workspace.archiviereVorlage(input.templateId, ctx.user.discordId);
    revalidatePath(systemRoutes.workspaceVorlagen());
    return { ok: true };
  },
);

export const workspaceVorlageZurueckholenAction = defineAction(
  {
    name: 'workspace.template.restore',
    module: workspace.WORKSPACE_MODULE_ID,
    permission: workspace.WORKSPACE_PERMISSIONS.templatesManage,
    schema: z.object({ templateId: z.string().min(1).max(40) }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ input }) => {
    await workspace.holeVorlageZurueck(input.templateId);
    revalidatePath(systemRoutes.workspaceVorlagen());
    return { ok: true };
  },
);

export const workspaceProjektAusVorlageAction = defineAction(
  {
    name: 'workspace.template.apply',
    module: workspace.WORKSPACE_MODULE_ID,
    // Ein Projekt anlegen - nicht Vorlagen verwalten. Wer aus einer Vorlage
    // startet, braucht `projects.create`, nicht `templates.manage`.
    permission: workspace.WORKSPACE_PERMISSIONS.projectsCreate,
    schema: z.object({
      templateId: z.string().min(1).max(40),
      titel: z.string().trim().max(160).optional(),
      zielAm: datumSchema,
    }),
    rateLimit: 'workspaceSchreiben',
  },
  async ({ ctx, input }) => {
    // Keine Sichtbarkeitspruefung: eine Vorlage ist kein Projekt, und das
    // Projekt daraus entsteht erst - mit der Vorgabe `TEAM`.
    const projekt = await workspace.erstelleAusVorlage(input.templateId, ctx.user.discordId, {
      ...(input.titel ? { titel: input.titel } : {}),
      zielAm: input.zielAm,
    });
    neuLadenProjekt(projekt.id);
    revalidatePath(systemRoutes.workspacePlanung());
    return { projectId: projekt.id };
  },
);
