import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import type { WorkspacePriority, WorkspaceProject, WorkspaceTemplate } from '@swisshub/database';
import { AppError, normalisiereFarbe, sanitizeText } from '@swisshub/shared';
import { WORKSPACE_MODULE_ID } from './config';
import { normalisiereTags } from './typen';
import { vermerke } from './verlauf';

/**
 * Vorlagen.
 *
 * ## Was eine Vorlage ist, und was nicht
 *
 * Sie ist eine **Liste von Aufgaben mit relativen Fristen** - und sonst
 * nichts. Kein Workflow, keine Bedingungen, keine Genehmigungsschritte: wer
 * «Turnier» wählt, bekommt die zwölf Dinge, die bei einem Turnier immer
 * anfallen, in ein neues Projekt gelegt, mit Fristen gerechnet auf den
 * Turniertag. Ab da ist es ein gewöhnliches Projekt.
 *
 * Das ist der ganze Punkt: die wiederkehrende Arbeit ist nicht der Ablauf,
 * sondern das Erinnern an die zwölf Dinge. Ein Ablauf, der sie erzwingt, würde
 * beim ersten Turnier, das anders läuft, im Weg stehen.
 *
 * ## Warum die Frist relativ und negativ ist
 *
 * `faelligNachTagen` zählt vom **Zieldatum** des neuen Projekts, nicht vom
 * Anlegen. Bei einem Turnier ist das der Turniertag, und fast alles muss
 * vorher fertig sein - deshalb sind die Werte überwiegend negativ: `-14` heisst
 * «zwei Wochen vor dem Turnier». Positiv ist, was danach kommt: Clips
 * schneiden, Ergebnisse posten.
 *
 * Vom Anlegen zu rechnen wäre die naheliegende und falsche Wahl: ein Turnier,
 * das in drei Monaten stattfindet, hätte dann alle Fristen in der nächsten
 * Woche.
 */

const NAME_MAX = 80;
const BESCHREIBUNG_MAX = 1000;
const TITEL_MAX = 160;

export interface VorlagenAufgabe {
  titel: string;
  beschreibung?: string | null;
  prioritaet?: WorkspacePriority;
  /** Tage relativ zum Zieldatum. Negativ heisst «davor». */
  faelligNachTagen?: number | null;
}

export interface VorlagenEingabe {
  name: string;
  beschreibung?: string | null;
  projektTitel: string;
  akzent?: string | null;
  tags?: readonly string[];
  aufgaben: readonly VorlagenAufgabe[];
}

/**
 * Die vier Vorlagen, mit denen das Modul startet.
 *
 * Sie stehen hier als Daten und nicht in einer Migration: so sind sie lesbar,
 * nachvollziehbar und lassen sich mit `legeStandardvorlagenAn` nachträglich
 * ergänzen, ohne dass jemand eine Migration neu laufen lassen muss. Angelegt
 * werden sie nur, wenn es den Namen noch nicht gibt - ein Team, das «Turnier»
 * umgebaut hat, bekommt seine Fassung nicht überschrieben.
 */
export const STANDARDVORLAGEN: readonly VorlagenEingabe[] = [
  {
    name: 'Turnier',
    beschreibung:
      'Von der Ankündigung bis zu den Clips. Die Fristen rechnen auf den Turniertag - setze ihn als Zieldatum.',
    projektTitel: 'Turnier',
    tags: ['turnier'],
    aufgaben: [
      { titel: 'Format, Spiel und Modus festlegen', prioritaet: 'HIGH', faelligNachTagen: -28 },
      { titel: 'Preisgeld und Sponsoren klären', faelligNachTagen: -28 },
      { titel: 'Regelwerk schreiben und gegenlesen', prioritaet: 'HIGH', faelligNachTagen: -21 },
      { titel: 'Ankündigungsgrafik erstellen', faelligNachTagen: -21 },
      { titel: 'Turnier im System anlegen und Anmeldung öffnen', prioritaet: 'HIGH', faelligNachTagen: -14 },
      { titel: 'Ankündigung auf Discord und Social Media', prioritaet: 'HIGH', faelligNachTagen: -14 },
      { titel: 'Gameserver und Admins einplanen', faelligNachTagen: -7 },
      { titel: 'Erinnerung an die Angemeldeten', faelligNachTagen: -2 },
      { titel: 'Check-in und Bracket vorbereiten', prioritaet: 'URGENT', faelligNachTagen: -1 },
      { titel: 'Turnier durchführen', prioritaet: 'URGENT', faelligNachTagen: 0 },
      { titel: 'Ergebnisse posten und Gewinner auszeichnen', prioritaet: 'HIGH', faelligNachTagen: 1 },
      { titel: 'Clips sammeln und schneiden', faelligNachTagen: 5 },
      { titel: 'Rückblick: was lief gut, was nicht', faelligNachTagen: 7 },
    ],
  },
  {
    name: 'IRL Event',
    beschreibung: 'Ein Treffen mit Ort, Zeit und Tickets. Die Fristen rechnen auf den Veranstaltungstag.',
    projektTitel: 'IRL Event',
    tags: ['irl', 'event'],
    aufgaben: [
      { titel: 'Datum, Ort und Budget festlegen', prioritaet: 'HIGH', faelligNachTagen: -56 },
      { titel: 'Location anfragen und reservieren', prioritaet: 'URGENT', faelligNachTagen: -49 },
      { titel: 'Kosten pro Person rechnen und Ticketpreis festlegen', faelligNachTagen: -42 },
      { titel: 'Event im Kalender anlegen, Anmeldung öffnen', prioritaet: 'HIGH', faelligNachTagen: -35 },
      { titel: 'Ankündigung mit Grafik', faelligNachTagen: -35 },
      { titel: 'Verpflegung und Material organisieren', faelligNachTagen: -14 },
      { titel: 'Teilnehmerliste prüfen, Zahlungen abgleichen', prioritaet: 'HIGH', faelligNachTagen: -7 },
      { titel: 'Letzte Infos an die Angemeldeten', prioritaet: 'HIGH', faelligNachTagen: -3 },
      { titel: 'Auf- und Abbau einplanen', faelligNachTagen: -1 },
      { titel: 'Event durchführen', prioritaet: 'URGENT', faelligNachTagen: 0 },
      { titel: 'Fotos sortieren und posten', faelligNachTagen: 3 },
      { titel: 'Abrechnung abschliessen', prioritaet: 'HIGH', faelligNachTagen: 10 },
    ],
  },
  {
    name: 'Sponsoring',
    beschreibung:
      'Von der ersten Anfrage bis zur erfüllten Gegenleistung. Das Zieldatum ist der Vertragsbeginn.',
    projektTitel: 'Sponsoring',
    tags: ['sponsoring'],
    aufgaben: [
      { titel: 'Zahlen und Reichweite zusammenstellen', prioritaet: 'HIGH', faelligNachTagen: -42 },
      { titel: 'Sponsoring-Unterlagen aktualisieren', faelligNachTagen: -35 },
      { titel: 'Ansprechpartner recherchieren und anschreiben', prioritaet: 'HIGH', faelligNachTagen: -28 },
      { titel: 'Gespräch führen', faelligNachTagen: -21 },
      { titel: 'Angebot und Gegenleistungen festhalten', prioritaet: 'HIGH', faelligNachTagen: -14 },
      { titel: 'Vertrag prüfen lassen und unterschreiben', prioritaet: 'URGENT', faelligNachTagen: -7 },
      { titel: 'Logo und Nennungen einbauen', faelligNachTagen: 0 },
      { titel: 'Erste Leistungsnachweise schicken', faelligNachTagen: 30 },
      { titel: 'Zwischenbericht und Verlängerung ansprechen', faelligNachTagen: 90 },
    ],
  },
  {
    name: 'Social Media Kampagne',
    beschreibung: 'Eine Serie statt einzelner Posts. Das Zieldatum ist der Tag, an dem sie startet.',
    projektTitel: 'Kampagne',
    tags: ['social media'],
    aufgaben: [
      { titel: 'Ziel und Botschaft festlegen', prioritaet: 'HIGH', faelligNachTagen: -21 },
      { titel: 'Plattformen und Formate wählen', faelligNachTagen: -18 },
      { titel: 'Redaktionsplan schreiben', prioritaet: 'HIGH', faelligNachTagen: -14 },
      { titel: 'Grafiken und Texte erstellen', prioritaet: 'HIGH', faelligNachTagen: -7 },
      { titel: 'Gegenlesen und freigeben', faelligNachTagen: -3 },
      { titel: 'Posts einplanen', prioritaet: 'HIGH', faelligNachTagen: -1 },
      { titel: 'Start begleiten, Kommentare beantworten', prioritaet: 'URGENT', faelligNachTagen: 0 },
      { titel: 'Zahlen nach einer Woche ansehen', faelligNachTagen: 7 },
      { titel: 'Auswertung und was wir nächstes Mal anders machen', faelligNachTagen: 14 },
    ],
  },
];

function pruefeName(name: string): string {
  const sauber = sanitizeText(name, NAME_MAX).trim();
  if (sauber === '') {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Vorlage braucht einen Namen.' });
  }
  return sauber;
}

export async function erstelleVorlage(
  guildId: string,
  akteurDiscordId: string,
  eingabe: VorlagenEingabe,
): Promise<WorkspaceTemplate> {
  const name = pruefeName(eingabe.name);
  const projektTitel = sanitizeText(eingabe.projektTitel, TITEL_MAX).trim();
  if (projektTitel === '') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Vorlage braucht einen Vorschlag für den Projekttitel.',
    });
  }

  const vorlage = await prisma.workspaceTemplate.create({
    data: {
      guildId,
      name,
      description: eingabe.beschreibung ? sanitizeText(eingabe.beschreibung, BESCHREIBUNG_MAX) : null,
      projectTitle: projektTitel,
      accent: normalisiereFarbe(eingabe.akzent ?? null),
      tags: normalisiereTags(eingabe.tags ?? []),
      createdByDiscordId: akteurDiscordId,
      tasks: {
        create: eingabe.aufgaben.slice(0, 50).map((aufgabe, index) => ({
          title: sanitizeText(aufgabe.titel, TITEL_MAX).trim() || `Schritt ${index + 1}`,
          description: aufgabe.beschreibung ? sanitizeText(aufgabe.beschreibung, BESCHREIBUNG_MAX) : null,
          priority: aufgabe.prioritaet ?? 'NORMAL',
          // Die Reihenfolge kommt aus der Liste und nicht aus dem Formular:
          // zwei Einträge mit derselben Zahl wären danach Zufall.
          position: index,
          faelligNachTagen: aufgabe.faelligNachTagen ?? null,
        })),
      },
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TEMPLATE_CHANGED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: name,
    success: true,
    metadata: { templateId: vorlage.id, aufgaben: eingabe.aufgaben.length, vorgang: 'angelegt' },
  });

  return vorlage;
}

/**
 * Eine Vorlage ins Archiv legen.
 *
 * Auch hier nicht löschen: eine Vorlage ist die gesammelte Erfahrung aus
 * mehreren Durchläufen, und ein Projekt, das daraus entstand, verweist nicht
 * darauf - es hat seine Aufgaben als Kopie. Trotzdem ist der Text der Vorlage
 * das, was beim nächsten Mal wieder gebraucht wird.
 */
export async function archiviereVorlage(templateId: string, akteurDiscordId: string): Promise<void> {
  const vorlage = await prisma.workspaceTemplate.findUnique({ where: { id: templateId } });
  if (!vorlage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Vorlage gibt es nicht.' });
  }
  if (vorlage.archivedAt) {
    return;
  }
  await prisma.workspaceTemplate.update({
    where: { id: templateId },
    data: { archivedAt: new Date() },
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_TEMPLATE_CHANGED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: vorlage.name,
    success: true,
    metadata: { templateId, vorgang: 'archiviert' },
  });
}

export async function holeVorlageZurueck(templateId: string): Promise<void> {
  await prisma.workspaceTemplate.updateMany({
    where: { id: templateId },
    data: { archivedAt: null },
  });
}

export async function ladeVorlagen(
  guildId: string,
  optionen: { archiviert?: boolean } = {},
): Promise<
  Array<
    WorkspaceTemplate & {
      tasks: Array<{
        id: string;
        title: string;
        priority: WorkspacePriority;
        position: number;
        faelligNachTagen: number | null;
      }>;
    }
  >
> {
  return prisma.workspaceTemplate.findMany({
    where: { guildId, archivedAt: optionen.archiviert ? { not: null } : null },
    orderBy: { name: 'asc' },
    take: 50,
    include: {
      tasks: {
        orderBy: { position: 'asc' },
        select: { id: true, title: true, priority: true, position: true, faelligNachTagen: true },
      },
    },
  });
}

/**
 * Die Standardvorlagen anlegen - die fehlenden.
 *
 * Idempotent und nach Namen: ein zweiter Aufruf legt nichts doppelt an, und
 * ein Team, das «Turnier» umgebaut hat, behält seine Fassung. Zurückgegeben
 * wird, wie viele dazugekommen sind - damit die Oberfläche etwas Wahres sagen
 * kann und nicht «vier Vorlagen angelegt», wenn es keine war.
 */
export async function legeStandardvorlagenAn(guildId: string, akteurDiscordId: string): Promise<number> {
  const vorhanden = new Set(
    (await prisma.workspaceTemplate.findMany({ where: { guildId }, select: { name: true } })).map(
      (zeile) => zeile.name,
    ),
  );

  let angelegt = 0;
  for (const vorlage of STANDARDVORLAGEN) {
    if (vorhanden.has(vorlage.name)) {
      continue;
    }
    await erstelleVorlage(guildId, akteurDiscordId, vorlage);
    angelegt += 1;
  }
  return angelegt;
}

/**
 * Ein Projekt aus einer Vorlage.
 *
 * Die Aufgaben werden **kopiert** und nicht verknüpft: ab hier ist es ein
 * gewöhnliches Projekt, und wer darin einen Schritt streicht, ändert nicht die
 * Vorlage für alle künftigen. Eine Verknüpfung wäre der Anfang einer
 * Workflow-Engine - und die will hier niemand.
 *
 * `zielAm` ist der Tag, auf den die relativen Fristen rechnen: der Turniertag,
 * der Veranstaltungstag, der Kampagnenstart. Ohne ihn bekommen die Aufgaben
 * keine Fristen - lieber keine als zwölf falsche.
 */
export async function erstelleAusVorlage(
  templateId: string,
  akteurDiscordId: string,
  eingabe: { titel?: string; zielAm?: Date | null },
): Promise<WorkspaceProject> {
  const vorlage = await prisma.workspaceTemplate.findUnique({
    where: { id: templateId },
    include: { tasks: { orderBy: { position: 'asc' } } },
  });
  if (!vorlage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Vorlage gibt es nicht.' });
  }

  const titel = sanitizeText(eingabe.titel ?? vorlage.projectTitle, TITEL_MAX).trim();
  const zielAm = eingabe.zielAm ?? null;

  const projekt = await prisma.$transaction(async (tx) => {
    const angelegt = await tx.workspaceProject.create({
      data: {
        guildId: vorlage.guildId,
        title: titel === '' ? vorlage.projectTitle : titel,
        description: vorlage.description,
        status: 'PLANNED',
        accent: vorlage.accent,
        dueAt: zielAm,
        tags: vorlage.tags,
        createdByDiscordId: akteurDiscordId,
        members: { create: { discordId: akteurDiscordId, rolle: 'LEAD' } },
      },
    });

    if (vorlage.tasks.length > 0) {
      await tx.workspaceTask.createMany({
        data: vorlage.tasks.map((aufgabe) => ({
          guildId: vorlage.guildId,
          projectId: angelegt.id,
          title: aufgabe.title,
          description: aufgabe.description,
          priority: aufgabe.priority,
          dueAt: fristAus(zielAm, aufgabe.faelligNachTagen),
          createdByDiscordId: akteurDiscordId,
        })),
      });
    }

    return angelegt;
  });

  await vermerke({
    guildId: vorlage.guildId,
    art: 'project.created',
    actorDiscordId: akteurDiscordId,
    projectId: projekt.id,
    detail: `aus Vorlage «${vorlage.name}» · ${vorlage.tasks.length} ${vorlage.tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'}`,
  });
  await recordAudit({
    action: AUDIT_ACTIONS.WORKSPACE_PROJECT_CREATED,
    module: WORKSPACE_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: projekt.title,
    success: true,
    metadata: { projectId: projekt.id, templateId, aufgaben: vorlage.tasks.length },
  });

  return projekt;
}

/**
 * Das Datum, das sich aus einer relativen Frist ergibt.
 *
 * Gerechnet auf 12:00 UTC und nicht auf Mitternacht: eine Frist um Mitternacht
 * läge je nach Zeitzone noch im Vortag, und eine Aufgabe, die einen Tag früher
 * fällig anzeigt als geplant, ist ein Fehler, den niemand mehr findet.
 */
export function fristAus(zielAm: Date | null, tage: number | null): Date | null {
  if (!zielAm || tage === null) {
    return null;
  }
  const mittags = Date.UTC(zielAm.getUTCFullYear(), zielAm.getUTCMonth(), zielAm.getUTCDate(), 12);
  return new Date(mittags + tage * 86_400_000);
}
