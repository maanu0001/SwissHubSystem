import { z } from 'zod';
import { registerModule, registerModuleStatusBadge, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

/**
 * Workspace - das interne Arbeitsmodul des Teams.
 *
 * ## Was es löst
 *
 * Die Arbeit am Server wird in Discord-Threads, Sprachnachrichten und Köpfen
 * organisiert. Ein Turnier vorzubereiten heisst jedes Mal, sich an die
 * fünfzehn Dinge zu erinnern, die beim letzten Mal nötig waren - und eines
 * davon fällt jedes Mal hinten runter. Wer für was zuständig ist, weiss man,
 * solange es drei Leute sind.
 *
 * Dieses Modul macht daraus Projekte mit Aufgaben, Verantwortlichen und
 * Fälligkeiten, und aus den fünfzehn Dingen eine Vorlage, die man beim
 * nächsten Turnier anwendet.
 *
 * ## Was es ausdrücklich nicht ist
 *
 * Kein Jira, kein Notion, kein Asana. Es gibt keine Unteraufgaben, keine
 * Abhängigkeiten, keinen kritischen Pfad, keine Sprints, keine Zeiterfassung,
 * keine Workflow-Engine und keine Automatisierungsregeln. Vier Aufgabenstatus,
 * vier Prioritäten, fünf Projektstatus - mehr nicht.
 *
 * Das ist keine Sparsamkeit, sondern die Bedingung dafür, dass es benutzt
 * wird. Ein Werkzeug, in dem das Anlegen einer Aufgabe acht Felder verlangt,
 * bekommt am Ende drei gepflegte Projekte und daneben weiterhin die
 * Discord-Threads.
 *
 * ## Keine zweite Benutzerverwaltung
 *
 * Verantwortliche, Autoren und Projektmitglieder sind Discord-Kennungen -
 * dieselben Leute wie im übrigen System. Es gibt keine Workspace-Konten, keine
 * Einladungen und keine Profile. Wer den Server verlässt, behält seine
 * Zuweisungen in der Geschichte; die Oberfläche zeigt ihn als ehemaliges
 * Mitglied.
 *
 * ## Was es wiederverwendet statt nachzubauen
 *
 * Die Benachrichtigungen entstehen aus Domain Events über `meldeEreignis` und
 * drei Regeln in `BENACHRICHTIGUNGSREGELN` - es gibt keine zweite
 * Meldungs-Engine. Die Erinnerungen laufen im bestehenden, neustartsicheren
 * Scheduler, nicht in einem `setTimeout`. Anhänge gehen durch dieselbe
 * Upload-Prüfung wie Logo und Antragsbelege. Kommentare werden mit dem
 * zentralen Markdown-Darsteller angezeigt, der React-Elemente erzeugt und
 * niemals HTML. Das Statusabzeichen in der Seitenleiste kommt aus der
 * Abzeichen-Registry.
 *
 * ## Sichtbarkeit
 *
 * Internes Teammodul. Ohne `workspace.view` erscheint es nicht, und keine
 * seiner Seiten ist öffentlich - es gibt keinen Ordner ausserhalb der
 * Anwendungsgruppe. Der zentrale Testmodus greift ohne eigene Zeile: er hängt
 * an `requirePagePermission` und an der Modulliste der Navigation.
 */

export const WORKSPACE_MODULE_ID = 'workspace';

/**
 * Berechtigungen.
 *
 * Getrennt nach dem, was jemand tatsächlich tun soll. «Aufgaben anlegen und
 * bearbeiten» ist die Alltagsberechtigung des Teams; Projekte anzulegen, zu
 * archivieren oder Vorlagen zu pflegen sind seltenere Handlungen mit
 * grösserer Wirkung.
 *
 * `tasks.delete` ist eigens herausgezogen und `critical`: eine gelöschte
 * Aufgabe nimmt ihre Kommentare, ihre Checkliste und ihren Verlauf mit. Das
 * ist der eine Vorgang hier, der etwas unwiederbringlich entfernt - alles
 * andere archiviert.
 */
export const WORKSPACE_PERMISSIONS = {
  view: 'workspace.view',
  projectsCreate: 'workspace.projects.create',
  projectsEdit: 'workspace.projects.edit',
  projectsArchive: 'workspace.projects.archive',
  tasksCreate: 'workspace.tasks.create',
  tasksEdit: 'workspace.tasks.edit',
  tasksDelete: 'workspace.tasks.delete',
  templatesManage: 'workspace.templates.manage',
  settingsManage: 'workspace.settings.manage',
} as const;

export const workspaceSettingsSchema = z.object({
  /**
   * Ab wann eine Fälligkeit als «bald» gilt, in Tagen.
   *
   * Entscheidet nur über die Darstellung - die Farbe einer Fälligkeit, nicht
   * über Erinnerungen. Drei Tage sind der Vorschlag: lang genug, um noch etwas
   * zu tun, kurz genug, dass nicht die halbe Liste orange ist.
   */
  baldFaelligTage: z.coerce.number().int().min(1).max(30).default(3),

  /**
   * Erinnerungen überhaupt verschicken.
   *
   * Ein Schalter für das ganze Modul. Ein Team, das den Workspace als stille
   * Liste benutzt, soll ihn abschalten können, ohne an jeder Aufgabe
   * «kein Reminder» zu wählen.
   */
  erinnerungenAktiv: z.boolean().default(true),

  /**
   * Benachrichtigen, wenn eine Aufgabe auf BLOCKED geht.
   *
   * Vorgabe **aus**. Ein blockierter Zustand ist oft eine Notiz an sich selbst
   * («warte auf Antwort»), und eine Meldung an alle Beteiligten dafür wäre
   * genau die Flut, die eine Glocke unbrauchbar macht.
   */
  meldeBlockiert: z.boolean().default(false),
});

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

const workspaceSettingsFields: SettingsField[] = [
  {
    key: 'baldFaelligTage',
    type: 'number',
    label: 'Ab wann «bald fällig»',
    description:
      'Wie viele Tage vor der Fälligkeit eine Aufgabe farblich hervorgehoben wird. Betrifft nur die Darstellung, nicht die Erinnerungen.',
    min: 1,
    max: 30,
    unit: 'Tage',
    group: 'Darstellung',
  },
  {
    key: 'erinnerungenAktiv',
    type: 'boolean',
    label: 'Erinnerungen verschicken',
    description:
      'Aus: es werden keine Deadline-Erinnerungen verschickt, unabhängig davon, was an einzelnen Aufgaben eingestellt ist.',
    group: 'Benachrichtigungen',
  },
  {
    key: 'meldeBlockiert',
    type: 'boolean',
    label: 'Bei «Blockiert» benachrichtigen',
    description:
      'Aus ist die Vorgabe. Ein blockierter Zustand ist oft eine Notiz an sich selbst - eine Meldung an alle Beteiligten wäre meist eine zu viel.',
    group: 'Benachrichtigungen',
  },
];

export const workspaceModule: ModuleDefinition = registerModule({
  id: WORKSPACE_MODULE_ID,
  name: 'Workspace',
  description:
    'Interne Projekte, Aufgaben und Planung des Teams - mit Verantwortlichen, Fälligkeiten, Kanban und Vorlagen für wiederkehrende Arbeit.',
  icon: 'KanbanSquare',
  permissionPrefix: 'workspace',
  /*
   * Ausgeschaltet, bis jemand es einschaltet.
   *
   * Anders als bei einer Übersicht, die ohnehin vorhandene Daten zeigt,
   * entsteht hier etwas Neues: ein Server, der seine Arbeit anders
   * organisiert, soll den Bereich nicht in der Seitenleiste haben.
   */
  defaultEnabled: false,
  settingsSchema: workspaceSettingsSchema,
  settingsFields: workspaceSettingsFields,
  permissions: [
    {
      key: WORKSPACE_PERMISSIONS.view,
      label: 'Workspace ansehen',
      description:
        'Den Workspace öffnen: Projekte, Aufgaben, Planung und Vorlagen sehen. Ohne diese Berechtigung erscheint das Modul nicht.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.projectsCreate,
      label: 'Projekte anlegen',
      description: 'Neue Projekte erstellen, auch aus einer Vorlage.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.projectsEdit,
      label: 'Projekte bearbeiten',
      description:
        'Titel, Beschreibung, Status, Fälligkeit, Mitglieder und Meilensteine eines Projekts ändern. Die Projektleitung darf ihr eigenes Projekt ohnehin bearbeiten.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.projectsArchive,
      label: 'Projekte archivieren',
      description:
        'Projekte ins Archiv legen und zurückholen. Projekte werden nicht gelöscht - archiviert ist der Weg.',
      module: WORKSPACE_MODULE_ID,
      critical: true,
    },
    {
      key: WORKSPACE_PERMISSIONS.tasksCreate,
      label: 'Aufgaben anlegen',
      description: 'Neue Aufgaben erstellen - mit oder ohne Projekt.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.tasksEdit,
      label: 'Aufgaben bearbeiten',
      description:
        'Status, Priorität, Verantwortliche, Fälligkeit, Checkliste und Kommentare pflegen. Die Alltagsberechtigung des Teams.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.tasksDelete,
      label: 'Aufgaben löschen',
      description:
        'Eine Aufgabe endgültig entfernen - mit ihren Kommentaren, ihrer Checkliste und ihrem Verlauf. Der einzige Vorgang im Workspace, der etwas unwiederbringlich löscht.',
      module: WORKSPACE_MODULE_ID,
      critical: true,
    },
    {
      key: WORKSPACE_PERMISSIONS.templatesManage,
      label: 'Vorlagen verwalten',
      description: 'Projektvorlagen anlegen, ändern und archivieren.',
      module: WORKSPACE_MODULE_ID,
    },
    {
      key: WORKSPACE_PERMISSIONS.settingsManage,
      label: 'Workspace-Einstellungen verwalten',
      description: 'Darstellung und Benachrichtigungen des Workspace einstellen.',
      module: WORKSPACE_MODULE_ID,
    },
  ],
  navigation: [
    {
      href: '/workspace',
      label: 'Workspace',
      description: 'Projekte, Aufgaben und Planung des Teams',
      permission: WORKSPACE_PERMISSIONS.view,
      icon: 'KanbanSquare',
      /*
       * Unter «System», vor den Verwaltungseintraegen (78 und mehr).
       *
       * Nicht bei der Community: dort steht, was die Gemeinschaft benutzt. Der
       * Workspace ist die Werkstatt des Teams - wie Social Media (27) und
       * Wrapped (28), in deren Reihe er gehoert.
       */
      group: 'system',
      order: 29,
      /*
       * Die Unterseiten gehoeren zur Kopfzeile dieses Eintrags - sonst stuende
       * auf `/workspace/board` kein Titel.
       */
      titlePrefix: '/workspace',
    },
  ],
});

/**
 * Das Statusabzeichen in der Seitenleiste.
 *
 * ## Was es zeigt, und was nicht
 *
 * Nur Überfälliges, und das in Rot. Nicht die Zahl der offenen Aufgaben: die
 * ist in einem arbeitenden Team immer grösser als Null, und ein Abzeichen, das
 * immer da ist, liest man zweimal und danach nie wieder. Überfällig ist der
 * Zustand, der von selbst nicht besser wird.
 *
 * Die Zahl ist absichtlich serverweit und nicht persönlich: in der
 * Seitenleiste steht sie neben dem Modulnamen, nicht neben «Meine Aufgaben» -
 * dort gehört die persönliche hin, und dort steht sie auch.
 *
 * Der Import ist verzögert: diese Datei läuft beim Laden der Module, und ein
 * Datenbankzugriff gehört nicht in diesen Moment. Gefragt wird erst, wenn
 * jemand eine Seite aufbaut.
 */
registerModuleStatusBadge({
  moduleId: WORKSPACE_MODULE_ID,
  async resolve() {
    const { prisma } = await import('@swisshub/database');
    const { resolveGuildId } = await import('@swisshub/discord');
    const guildId = await resolveGuildId();

    // Gerechnet auf den Tagesbeginn: eine Aufgabe, die heute um 09:00 faellig
    // war, ist um 14:00 nicht ueberfaellig, solange der Tag laeuft.
    const jetzt = new Date();
    const heuteBeginn = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()));

    const ueberfaellig = await prisma.workspaceTask.count({
      where: {
        guildId,
        status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
        dueAt: { lt: heuteBeginn },
        OR: [{ projectId: null }, { project: { archivedAt: null } }],
      },
    });

    if (ueberfaellig === 0) {
      return null;
    }
    return {
      label: `${ueberfaellig} überfällig`,
      variant: 'dringend' as const,
      priority: 20,
    };
  },
});
