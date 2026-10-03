import { createLogger } from '@swisshub/logger';
import { listSystemVorlagen, stelleSystemautomationSicher } from '@swisshub/automation';

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

/*
 * Welche Vorlagen Systemautomationen sind, steht an den Vorlagen.
 *
 * Hier stand einmal eine zweite Liste, die Schlüssel und Vorlagen-Kennung
 * einander zuordnete. Sie war die Stelle, an der die beiden auseinanderlaufen
 * konnten: eine umbenannte Vorlage, und der Abgleich fand nichts mehr - was
 * nur als Warnung im Protokoll auftauchte. Jetzt trägt die Vorlage ihren
 * `systemKey` selbst, und `listSystemVorlagen()` ist die einzige Liste.
 */

/**
 * Die Systemautomationen dieser Gilde abgleichen.
 *
 * Idempotent: zweimal gerufen ändert nichts. Wirft nicht - ein Bot, der
 * deswegen nicht startet, wäre ein schlechter Handel. Was fehlschlägt, steht
 * im Protokoll.
 */
export async function stelleSystemautomationenSicher(guildId: string): Promise<void> {
  const vorlagen = listSystemVorlagen();
  if (vorlagen.length === 0) {
    // Kann nur passieren, wenn die Vorlagen nicht geladen wurden - dann ist
    // etwas anderes kaputt, und ein erfundener Ersatz würde es verdecken.
    log.warn('Keine Systemvorlagen angemeldet');
    return;
  }

  for (const vorlage of vorlagen) {
    try {
      await stelleSystemautomationSicher({
        guildId,
        systemKey: vorlage.systemKey,
        name: vorlage.name,
        description: vorlage.description,
        triggerType: vorlage.triggerType,
        triggerConfig: vorlage.triggerConfig,
        conditions: vorlage.conditions ?? null,
        steps: vorlage.steps,
        concurrency: vorlage.concurrency,
        concurrencyKey: vorlage.concurrencyKey ?? null,
        maxRunsPerMinute: vorlage.maxRunsPerMinute,
      });
    } catch (error) {
      log.warn('Systemautomation konnte nicht abgeglichen werden', {
        systemKey: vorlage.systemKey,
        error,
      });
    }
  }
}
