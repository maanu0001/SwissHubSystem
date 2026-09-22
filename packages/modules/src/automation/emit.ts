import { publish } from '@swisshub/automation';
import { resolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { isModuleEnabled } from '../module-state';
import { AUTOMATION_MODULE_ID } from './config';

const logger = createLogger('automation:emit');

/**
 * Der eine Weg, auf dem ein Modul ein Ereignis meldet.
 *
 * Warum nicht direkt `publish()`? Drei Gründe, und alle drei würden sonst an
 * jeder Aufrufstelle einzeln stehen:
 *
 * 1. **Die Gilde.** Ein Modul hat sie selten zur Hand; hier wird sie einmal
 *    aufgelöst.
 * 2. **Der Schalter.** Ist das Automation-Modul aus, wird nichts in die
 *    Ereignistabelle geschrieben. Ohne diese Prüfung füllte sie sich auf
 *    jedem Server, der die Engine nie eingeschaltet hat.
 * 3. **Es wirft nie.** Eine Freischaltung soll nicht scheitern, weil die
 *    Meldung darüber scheitert. Das Melden ist die Nebensache; was das Modul
 *    getan hat, ist die Hauptsache und bereits getan.
 *
 * Deshalb gilt an jeder Aufrufstelle: `void meldeEreignis(...)` oder
 * `await` - beides ist richtig, und keines kann den Ablauf umwerfen.
 *
 * ## Zwei Empfänger, ein Weg
 *
 * Hier hängen zwei Dinge: die **Automation Engine** (über die
 * Ereignistabelle) und die **Glocke** im Dashboard. Beide arbeiten mit
 * denselben Domain Events - deshalb hängen sie an derselben Stelle und nicht
 * an zwei Discord-Listenern mit zwei Vorstellungen davon, was «ein neues
 * Ticket» ist.
 *
 * Der Modulschalter gilt bewusst nur für die Engine. Eine Glocke, die auf
 * einem Server ohne Automationen stumm bliebe, wäre ein Fehler, den niemand
 * meldet: sie sähe genauso aus wie eine, für die es nichts zu melden gibt.
 */
export async function meldeEreignis(
  type: string,
  payload: Record<string, unknown>,
  kopf: {
    guildId?: string;
    actorId?: string | null;
    subjectId?: string | null;
    entityId?: string | null;
    occurredAt?: Date;
  } = {},
): Promise<void> {
  let eventId: string | null = null;
  try {
    const guildId = kopf.guildId ?? (await resolveGuildId());
    if (await isModuleEnabled(AUTOMATION_MODULE_ID)) {
      const ergebnis = await publish({
        type,
        guildId,
        payload,
        actorId: kopf.actorId ?? null,
        subjectId: kopf.subjectId ?? null,
        entityId: kopf.entityId ?? null,
        ...(kopf.occurredAt ? { occurredAt: kopf.occurredAt } : {}),
      });
      eventId = ergebnis.eventId;
    }
  } catch (error) {
    // Auch hier nicht werfen: `publish` wirft schon nicht, aber das Auflösen
    // der Gilde und die Modulabfrage könnten es.
    logger.warn('Ereignis konnte nicht gemeldet werden', { type, error });
  }

  await benachrichtige(type, payload, kopf, eventId);
}

/**
 * Die Glocke füllen.
 *
 * Getrennt vom Rest und mit eigenem `try`: eine Meldung, die nicht
 * zugestellt werden kann, darf weder das Ereignis noch die Arbeit des Moduls
 * umwerfen.
 *
 * Der Import ist verzögert. Diese Datei wird beim Laden der Module
 * ausgeführt, und der Benachrichtigungsdienst zieht die Permission Engine
 * und die Datenbank nach sich - beides gehört nicht in diesen Moment.
 *
 * Die Kennung des Ereignisses ist der Schlüssel gegen Doppel. Fehlt sie -
 * weil die Engine aus ist und es gar keine Ereigniszeile gibt -, tritt ein
 * Ersatzschlüssel aus Art, Objekt und Minute an ihre Stelle: gröber, aber
 * er fängt genau den Fall ab, gegen den er da ist, nämlich denselben Vorgang
 * zweimal hintereinander.
 */
async function benachrichtige(
  type: string,
  payload: Record<string, unknown>,
  kopf: { actorId?: string | null; subjectId?: string | null; entityId?: string | null },
  eventId: string | null,
): Promise<void> {
  try {
    const { GEMELDETE_EREIGNISSE, verteileBenachrichtigungen } = await import('../notifications');
    if (!GEMELDETE_EREIGNISSE.has(type)) {
      return;
    }
    await verteileBenachrichtigungen({
      eventId: eventId ?? ersatzSchluessel(type, kopf.entityId ?? kopf.subjectId ?? null),
      type,
      payload,
      actorId: kopf.actorId ?? null,
      subjectId: kopf.subjectId ?? null,
      entityId: kopf.entityId ?? null,
    });
  } catch (error) {
    logger.warn('Benachrichtigungen konnten nicht verteilt werden', { type, error });
  }
}

function ersatzSchluessel(type: string, objekt: string | null): string {
  const minute = Math.floor(Date.now() / 60_000);
  return `ohne-ereignis:${type}:${objekt ?? 'unbekannt'}:${minute}`;
}
