import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { FRAGT_MODULE_ID, type FragtSettings } from './config';
import { getModuleSettings } from '../module-state';
import { laufendeAbstimmung, schliesse, stelleNachrichtSicher, veroeffentliche } from './abstimmung';
import { faelligerTermin, waehleFrage } from './planung';

const log = createLogger('fragt:tick');

/**
 * Ein Durchgang der Zeitsteuerung.
 *
 * Drei Schritte, jeder fuer sich wiederholbar:
 *
 *   1. faellige Abstimmungen schliessen
 *   2. Nachrichten nachholen, die beim Veroeffentlichen nicht abgingen
 *   3. veroeffentlichen, wenn ein Termin faellig ist
 *
 * ## Warum Schliessen vor Veroeffentlichen
 *
 * Weil dieses Modul hoechstens eine laufende Abstimmung zulaesst. Stuende das
 * Veroeffentlichen zuerst, wuerde eine Frage, deren Abstimmung genau jetzt
 * ablaeuft, die naechste um einen Durchgang verzoegern - jede Woche eine Minute
 * mehr.
 *
 * ## Warum kein `setTimeout`
 *
 * Weil ein Timer im Speicher lebt und ein Neustart ihn vergisst. Hier wird
 * jeder Durchgang neu gefragt: was ist faellig? Die Antwort steht in der
 * Datenbank, und sie ist nach einem Neustart dieselbe.
 *
 * Der Durchgang laeuft ueber `createJobRunner` in `apps/bot/src/jobs.ts` -
 * derselbe Weg wie bei Clips, Turnieren und dem Kalender. Kein eigener
 * Zeitplan.
 */

export interface FragtTickErgebnis {
  geschlossen: number;
  veroeffentlicht: number;
  nachrichtenNachgeholt: number;
}

export async function runFragtTick(
  guildId: string,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<FragtTickErgebnis> {
  const einstellungen = await getModuleSettings<FragtSettings>(FRAGT_MODULE_ID);

  // --- 1. Faellige Abstimmungen schliessen ---------------------------------
  const faellig = await prisma.fragtAbstimmung.findMany({
    where: { guildId, status: 'ACTIVE', closesAt: { lte: jetzt } },
    select: { id: true },
  });

  let geschlossen = 0;
  for (const abstimmung of faellig) {
    /*
     * Einzeln und mit eigenem Fehlerfang.
     *
     * Eine Abstimmung, deren Discord-Nachricht sich nicht aendern laesst, darf
     * die naechste nicht aufhalten - und `schliesse` hat das Ergebnis dann
     * schon festgeschrieben.
     */
    try {
      const ausgang = await schliesse(abstimmung.id, jetzt, gateway);
      if (ausgang.art === 'geschlossen') {
        geschlossen += 1;
      }
    } catch (fehler) {
      log.error('Abstimmung liess sich nicht schliessen', { abstimmungId: abstimmung.id, fehler });
    }
  }

  // --- 2. Fehlende Nachrichten nachholen -----------------------------------
  //
  // Eine Abstimmung ohne `messageId` ist eine, deren Embed nicht abging -
  // Discord war nicht erreichbar, der Bot startete neu. Ohne diesen Schritt
  // liefe sie stumm bis zum Ablauf, und niemand koennte abstimmen.
  const stumme = await prisma.fragtAbstimmung.findMany({
    where: { guildId, status: 'ACTIVE', messageId: null },
  });

  let nachrichtenNachgeholt = 0;
  for (const abstimmung of stumme) {
    try {
      await stelleNachrichtSicher(abstimmung, gateway);
      nachrichtenNachgeholt += 1;
    } catch (fehler) {
      log.warn('Nachricht liess sich nicht nachholen', { abstimmungId: abstimmung.id, fehler });
    }
  }

  // --- 3. Veroeffentlichen, wenn faellig -----------------------------------
  let veroeffentlicht = 0;
  if (einstellungen.autoPublish && einstellungen.channelId) {
    veroeffentlicht = await veroeffentlicheWennFaellig(guildId, einstellungen, jetzt, gateway);
  }

  if (geschlossen > 0 || veroeffentlicht > 0 || nachrichtenNachgeholt > 0) {
    log.info('SwissHub fragt fortgeschrieben', { geschlossen, veroeffentlicht, nachrichtenNachgeholt });
  }

  return { geschlossen, veroeffentlicht, nachrichtenNachgeholt };
}

async function veroeffentlicheWennFaellig(
  guildId: string,
  einstellungen: FragtSettings,
  jetzt: Date,
  gateway: DiscordGateway,
): Promise<number> {
  const termin = faelligerTermin(jetzt, einstellungen);
  if (!termin) {
    return 0;
  }

  /*
   * Hoechstens eine laufende Abstimmung.
   *
   * Zwei Fragen gleichzeitig im Kanal teilen die Aufmerksamkeit, und in der
   * Ergebnisgrafik waere nicht mehr klar, welche gemeint ist. Wer eine zweite
   * will, stellt sie von Hand - dort ist es eine Entscheidung.
   */
  const laufend = await laufendeAbstimmung(guildId);
  if (laufend) {
    return 0;
  }

  const frage = await waehleFrage(guildId, termin, einstellungen.selectionMode);
  if (!frage) {
    /*
     * Nichts zu stellen ist kein Fehler.
     *
     * Im Modus «manuell» heisst es: niemand hat etwas geplant. Im Modus
     * «automatisch»: die Bibliothek hat keine freigegebene Frage mehr. Beides
     * gehoert ins Log, damit es im Dashboard erklaerbar ist - aber nicht als
     * Fehler, den jemand nachts repariert.
     */
    log.info('Kein Kandidat fuer den faelligen Termin', {
      termin,
      modus: einstellungen.selectionMode,
    });
    return 0;
  }

  const ausgang = await veroeffentliche(
    {
      guildId,
      frageId: frage.id,
      opensAt: termin,
      channelId: einstellungen.channelId!,
      dauerStunden: frage.dauerStunden || einstellungen.durationHours,
      zwischenstandSichtbar: einstellungen.liveResults,
    },
    gateway,
  );

  if (ausgang.art === 'schon-vorhanden') {
    // Ein anderer Durchgang war schneller. Genau das soll die Bedingung in der
    // Datenbank bewirken - kein Fehler, keine zweite Nachricht.
    return 0;
  }

  /*
   * Die automatische Veroeffentlichung steht im Audit Log.
   *
   * Ohne Handelnden: es war niemand. Ein erfundener Akteur waere schlimmer als
   * keiner - und die Durchgaenge, die nichts finden, stehen bewusst nicht dort.
   */
  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_PUBLISHED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: null,
    actorUsername: 'SwissHub (automatisch)',
    targetLabel: frage.text,
    metadata: {
      frageId: frage.id,
      abstimmungId: ausgang.abstimmung.id,
      termin: termin.toISOString(),
      modus: einstellungen.selectionMode,
      automatisch: true,
    },
  });

  return 1;
}
