import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { meldeEreignis } from '../automation/emit';
import { WORKSPACE_MODULE_ID, type WorkspaceSettings } from './config';
import { ERINNERUNG_TAGE, OFFENE_STATUS } from './typen';

const logger = createLogger('workspace:erinnerungen');

/**
 * Erinnerungen an Fristen.
 *
 * ## Warum ein Job und kein Timer
 *
 * Weil ein `setTimeout` auf eine Frist in drei Wochen einen Prozess voraussetzt,
 * der drei Wochen lebt. Jeder Neustart - ein Deploy, ein Absturz - würde ihn
 * vergessen, und zwar lautlos: die Erinnerung käme nie, und niemand könnte
 * sagen, woran es lag. Der Job läuft im bestehenden, neustartsicheren
 * Scheduler des Bots und fragt jedes Mal den Zustand aus der Datenbank.
 *
 * ## Warum `reminderSentAt` der Schlüssel ist
 *
 * Er ist der Merker «für diese Frist wurde erinnert». Ohne ihn würde derselbe
 * Job die Erinnerung bei jedem Lauf noch einmal schicken - bei einem
 * Minutentakt wäre das eine Meldung je Minute bis zur Frist. Gesetzt wird er
 * in einem `updateMany` **mit** der Bedingung, dass er noch leer ist: zwei
 * gleichzeitige Läufe schicken damit nicht beide.
 *
 * Geleert wird er überall dort, wo sich `dueAt` ändert - sonst käme zur neuen
 * Frist keine Meldung.
 *
 * ## Warum keine neue Benachrichtigungsengine
 *
 * Der Job meldet ein Domain Event. Was daraus wird - eine Zeile in der Glocke,
 * ein Schritt in einer Automation -, entscheiden die bestehenden Regeln. Eine
 * zweite Zustellung hier wäre eine zweite Vorstellung davon, wer etwas erfahren
 * soll.
 */

/** Wie viele Aufgaben ein Lauf höchstens anfasst. */
const PRO_LAUF = 50;

/** Der Beginn des Tages, in dem ein Zeitpunkt liegt - als Millisekunden. */
function tagesBeginn(wert: Date): number {
  return Date.UTC(wert.getUTCFullYear(), wert.getUTCMonth(), wert.getUTCDate());
}

export interface ErinnerungsErgebnis {
  /** Aufgaben, für die eine Erinnerung gemeldet wurde. */
  gemeldet: number;
  /** Aufgaben, die fällig wären, aber keine Zuständigen haben. */
  ohneZustaendige: number;
}

/**
 * Die fälligen Erinnerungen verschicken.
 *
 * `jetzt` ist einspeisbar, damit ein Test nicht warten muss - und damit er die
 * Grenzfälle an der Vorwarnzeit genau treffen kann.
 */
export async function verschickeErinnerungen(optionen: { jetzt?: Date } = {}): Promise<ErinnerungsErgebnis> {
  const jetzt = optionen.jetzt ?? new Date();

  if (!(await isModuleEnabled(WORKSPACE_MODULE_ID))) {
    return { gemeldet: 0, ohneZustaendige: 0 };
  }
  const einstellungen = await getModuleSettings<WorkspaceSettings>(WORKSPACE_MODULE_ID);
  if (!einstellungen.erinnerungenAktiv) {
    return { gemeldet: 0, ohneZustaendige: 0 };
  }

  /*
   * Der Vorfilter ist grob, die Entscheidung fein.
   *
   * Gesucht werden Aufgaben mit Erinnerung, offener Frist und ohne Merker, und
   * zwar nur solche, deren Frist höchstens eine Woche weg ist - das ist die
   * längste Vorwarnzeit, die es gibt. Ob eine einzelne Aufgabe tatsächlich
   * dran ist, entscheidet danach ihre eigene Vorwarnzeit.
   *
   * Eine SQL-Bedingung je Erinnerungsart wäre fünf `OR`-Zweige mit gerechneten
   * Daten darin - unlesbar, und bei fünfzig Zeilen kein messbarer Gewinn.
   */
  const spaetesteVorwarnung = Math.max(...Object.values(ERINNERUNG_TAGE).map((tage) => tage ?? 0));
  const kandidaten = await prisma.workspaceTask.findMany({
    where: {
      reminder: { not: 'NONE' },
      reminderSentAt: null,
      status: { in: [...OFFENE_STATUS] },
      dueAt: { not: null, lte: new Date(jetzt.getTime() + (spaetesteVorwarnung + 1) * 86_400_000) },
      OR: [{ projectId: null }, { project: { archivedAt: null } }],
    },
    include: {
      assignees: { select: { discordId: true } },
      project: { select: { title: true } },
    },
    orderBy: { dueAt: 'asc' },
    take: PRO_LAUF,
  });

  let gemeldet = 0;
  let ohneZustaendige = 0;

  for (const aufgabe of kandidaten) {
    const vorwarnung = ERINNERUNG_TAGE[aufgabe.reminder];
    if (vorwarnung === null || !aufgabe.dueAt) {
      continue;
    }
    /*
     * Gerechnet auf Tagesgrenzen, nicht auf dem Zeitstempel.
     *
     * «Drei Tage vorher» heisst: **am** Tag drei Tage davor, nicht drei mal
     * vierundzwanzig Stunden davor. Sonst käme die Erinnerung an eine Aufgabe,
     * die um 23:00 fällig ist, um 23:00 des Vortages - und wäre damit nutzlos.
     *
     * Es ist dieselbe Rechnung wie in `faelligkeitsstufe`: zwei Vorstellungen
     * davon, wann ein Tag beginnt, wären eine Erinnerung, die zu einem anderen
     * Tag gehört als die Farbe in der Liste.
     */
    if (tagesBeginn(jetzt) < tagesBeginn(aufgabe.dueAt) - vorwarnung * 86_400_000) {
      continue;
    }

    /*
     * Erst den Merker setzen, dann melden.
     *
     * Die Bedingung `reminderSentAt: null` steht im `UPDATE`: wer zuerst
     * kommt, meldet, und der zweite Lauf findet nichts mehr. Umgekehrt - erst
     * melden, dann merken - wäre bei einem Fehler dazwischen eine Meldung ohne
     * Merker, und die käme beim nächsten Lauf wieder.
     *
     * Der Preis ist der umgekehrte Fall: ein Fehler beim Melden lässt den
     * Merker gesetzt, und die Erinnerung entfällt. Das ist die richtige
     * Richtung - eine ausgefallene Erinnerung ist ein verpasster Hinweis, eine
     * stündlich wiederholte ist ein Grund, die Glocke nie mehr zu öffnen.
     */
    const treffer = await prisma.workspaceTask.updateMany({
      where: { id: aufgabe.id, reminderSentAt: null },
      data: { reminderSentAt: jetzt },
    });
    if (treffer.count === 0) {
      continue;
    }

    if (aufgabe.assignees.length === 0) {
      // Niemand zuständig: es gibt keinen Empfänger. Gezählt wird es
      // trotzdem - eine Aufgabe mit Frist und ohne Zuständige ist genau das,
      // was die Übersicht als Warnung zeigt.
      ohneZustaendige += 1;
      continue;
    }

    for (const zustaendig of aufgabe.assignees) {
      await meldeEreignis(
        'workspace.reminder',
        {
          taskId: aufgabe.id,
          titel: aufgabe.title,
          discordId: zustaendig.discordId,
          projektTitel: aufgabe.project?.title ?? null,
          dueAt: aufgabe.dueAt.toISOString(),
          tageBisFrist: Math.round((aufgabe.dueAt.getTime() - jetzt.getTime()) / 86_400_000),
        },
        {
          guildId: aufgabe.guildId,
          // Kein Akteur: niemand hat das ausgelöst, die Zeit ist vergangen.
          // Mit Akteur würde die Verteilung die Meldung an diese Person
          // unterdrücken - sie unterdrückt Meldungen über die eigene Tat.
          actorId: null,
          subjectId: zustaendig.discordId,
          entityId: aufgabe.id,
        },
      );
      gemeldet += 1;
    }
  }

  if (gemeldet > 0 || ohneZustaendige > 0) {
    logger.info('Workspace-Erinnerungen verschickt', { gemeldet, ohneZustaendige });
  }
  return { gemeldet, ohneZustaendige };
}
