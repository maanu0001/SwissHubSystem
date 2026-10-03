import { createLogger } from '@swisshub/logger';
import { getTemplate, stelleSystemautomationSicher } from '@swisshub/automation';

const log = createLogger('automation:system');

/**
 * Systemautomationen, die SwissHub mitbringt.
 *
 * ## Warum sie als Zeile existieren und nicht nur als Vorlage
 *
 * Eine Vorlage ist ein Angebot: sie liegt in der Auswahl und wird zu einer
 * Automation, wenn jemand sie nimmt. Das ist für «Willkommensnachricht»
 * richtig - nicht jeder Server will eine.
 *
 * Die **Systemeinladung** ist anders: `/automation` soll sie vorfinden, ohne
 * dass jemand im Builder gewesen ist. Deshalb entsteht beim Start eine Zeile
 * mit `kind: 'SYSTEM'` und einem `systemKey` - nicht löschbar, aber
 * konfigurierbar und abschaltbar.
 *
 * ## Warum sie **aus** beginnt
 *
 * Weil sie Direktnachrichten schickt und weil die freigegebenen Rollen leer
 * sind - die kennt nur der Server. Eine Automation, die ab dem ersten
 * Deployment DMs verschicken könnte, wäre eine Entscheidung, die niemand
 * getroffen hat. Das Team öffnet sie, trägt die Rollen ein, liest den Text
 * und schaltet sie ein; `stelleSystemautomationSicher` überschreibt `enabled`
 * beim Auffrischen ausdrücklich nicht.
 *
 * ## Warum aus der Vorlage und nicht doppelt geschrieben
 *
 * Der Inhalt - Bedingungen, Schritte, Text - steht in `templates.ts`. Hier
 * steht nur, dass es sie als Zeile geben soll. Zweimal denselben Ablauf zu
 * schreiben hiesse, dass die Vorlage im Builder und die Systemautomation
 * irgendwann verschiedene Texte verschicken.
 */

/** Der Schlüssel der Systemeinladung. Steht in `Automation.systemKey`. */
export const SYSTEM_EINLADUNG_KEY = 'system_invite';

/** Welche Vorlage ihren Inhalt liefert. */
const SYSTEM_AUTOMATIONEN: ReadonlyArray<{ systemKey: string; vorlage: string }> = [
  { systemKey: SYSTEM_EINLADUNG_KEY, vorlage: 'system-einladung' },
];

/**
 * Die Systemautomationen dieser Gilde abgleichen.
 *
 * Idempotent: zweimal gerufen ändert nichts. Wirft nicht - ein Bot, der
 * deswegen nicht startet, wäre ein schlechter Handel. Was fehlschlägt, steht
 * im Protokoll.
 */
export async function stelleSystemautomationenSicher(guildId: string): Promise<void> {
  for (const eintrag of SYSTEM_AUTOMATIONEN) {
    const vorlage = getTemplate(eintrag.vorlage);
    if (!vorlage) {
      // Kann nur passieren, wenn die Vorlagen nicht geladen wurden - dann ist
      // etwas anderes kaputt, und ein erfundener Ersatz würde es verdecken.
      log.warn('Vorlage für Systemautomation fehlt', eintrag);
      continue;
    }

    try {
      await stelleSystemautomationSicher({
        guildId,
        systemKey: eintrag.systemKey,
        name: vorlage.name,
        description: vorlage.description,
        triggerType: vorlage.triggerType,
        triggerConfig: vorlage.triggerConfig,
        conditions: vorlage.conditions ?? null,
        steps: vorlage.steps,
        /*
         * Einer nach dem anderen, je Mitglied.
         *
         * Zwei gleichzeitige Einladungen an dieselbe Person wären zwei
         * identische Direktnachrichten. Der Schlüssel ist die Kennung des
         * Betroffenen; ohne Betroffenen gibt es keinen Schlüssel und damit
         * keine Einschränkung.
         */
        concurrency: 'SKIP_IF_RUNNING',
        concurrencyKey: '{{event.subjectId}}',
        maxRunsPerMinute: 10,
      });
    } catch (error) {
      log.warn('Systemautomation konnte nicht abgeglichen werden', { ...eintrag, error });
    }
  }
}
