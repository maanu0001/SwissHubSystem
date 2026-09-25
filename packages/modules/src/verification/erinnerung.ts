import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import { DiscordApiError, discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { fuelleVorlage } from './abschluss';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';

const logger = createLogger('verification:erinnerung');

/**
 * Erinnerungen an eine offene Verifikation.
 *
 * ## Was an die Stelle der Frist getreten ist
 *
 * Frueher lief ein Vorgang ohne Nachricht nach einer Viertelstunde ab, und
 * wer bis dahin nichts geschrieben hatte, flog vom Server. Das traf
 * zuverlaessig die Falschen: jemanden, der beitritt und das Handy weglegt,
 * jemanden im Zug, jemanden, der die Begruessung nicht gesehen hat.
 *
 * Jetzt geschieht zunaechst gar nichts. Wer nicht antwortet, bleibt
 * unverifiziert - so lange er will. In Abstaenden erinnert ihn der Bot daran,
 * und zwar so, dass Discord eine Benachrichtigung ausloest: mit einer
 * Erwaehnung. Die Nachricht selbst verschwindet gleich wieder.
 *
 * ## Was ein Ghostping hier ist - und was nicht
 *
 * Eine Erwaehnung, die nach wenigen Sekunden geloescht wird. Ob daraus auf
 * dem Geraet eine Push-Meldung wird, entscheiden Discord und die
 * Einstellungen der Person; eine Zusage ist das nicht und darf es nicht sein.
 *
 * **Die urspruengliche Verifikationsnachricht wird dabei nie angefasst.** Sie
 * ist der Ort, auf den die Erinnerung zeigt. Geloescht wird ausschliesslich
 * die Erinnerung selbst, und zwar anhand der Kennung, die das Senden
 * zurueckgegeben hat - nicht anhand einer Suche im Kanal.
 *
 * ## Warum der Zeitplan in der Datenbank steht
 *
 * `VerificationRequest.nextReminderAt` ist der ganze Plan. Kein `setTimeout`:
 * der ueberlebt kein Deployment, und einer je Person waeren bei sechstausend
 * Mitgliedern sechstausend Uhren im Arbeitsspeicher fuer eine Frage, die eine
 * Abfrage beantwortet. Ein Neustart aendert nichts, mehrere Worker stoeren
 * einander nicht - wer eine Zeile faellig sieht, schreibt den naechsten
 * Zeitpunkt bedingt fort, und genau einer kommt durch.
 *
 * `NULL` heisst «keine weitere Erinnerung». Dahin fuehrt jede
 * Beendigungsbedingung, und deshalb braucht es keinen zweiten Schalter
 * daneben.
 */

/**
 * Warum eine Erinnerungsreihe endet.
 *
 * Zur Anzeige und fuers Protokoll. Jeder dieser Gruende setzt
 * `nextReminderAt` auf `NULL`.
 */
export type ErinnerungsEnde =
  'entschieden' | 'abgeschaltet' | 'kein_kanal' | 'original_geloescht' | 'kein_mitglied';

export interface ErinnerungsErgebnis {
  requestId: string;
  discordId: string;
  /** `true`, wenn tatsaechlich eine Erwaehnung rausging. */
  gesendet: boolean;
  /** `true`, wenn die Erinnerung danach wieder entfernt wurde. */
  geloescht: boolean;
  /** Gesetzt, wenn die Reihe hier endet. */
  ende: ErinnerungsEnde | null;
}

/**
 * Die Reihe beenden.
 *
 * Bedingt auf «es gibt ueberhaupt noch einen Termin»: zwei Worker duerfen
 * sich hier begegnen, und nur einer soll das Protokoll schreiben.
 */
export async function beendeErinnerungen(requestId: string, grund: ErinnerungsEnde): Promise<boolean> {
  const { count } = await prisma.verificationRequest.updateMany({
    where: { id: requestId, nextReminderAt: { not: null } },
    data: { nextReminderAt: null },
  });
  if (count > 0) {
    logger.info('verification.reminder.ended', { requestId, grund });
  }
  return count > 0;
}

/**
 * Eine Nachricht wurde in Discord geloescht - war es eine Begruessung?
 *
 * ## Warum die Datenbank entscheidet und nicht der Inhalt
 *
 * Das Ereignis liefert eine Kennung, sonst nichts Verlaessliches: bei einer
 * Nachricht, die nicht im Zwischenspeicher des Bots liegt, fehlen Autor und
 * Text. Die Zuordnung ueber `VerificationBotMessage` braucht beides nicht -
 * entweder die Kennung steht dort als `GREETING`, oder das Ereignis geht uns
 * nichts an.
 *
 * Gibt `true` zurueck, wenn dadurch eine Erinnerungsreihe geendet hat.
 */
export async function begruessungGeloescht(messageId: string): Promise<boolean> {
  const zeile = await prisma.verificationBotMessage.findFirst({
    where: { discordMessageId: messageId, kind: 'GREETING' },
    select: { requestId: true },
  });
  if (!zeile) {
    return false;
  }
  /*
   * Die Einstellung entscheidet, nicht das Ereignis.
   *
   * Wer «auch ohne urspruengliche Nachricht erinnern» eingeschaltet hat, hat
   * genau diesen Fall gemeint - dann bleibt der Termin stehen.
   */
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<VerificationSettings>(VERIFICATION_MODULE_ID);
  if (settings.reminderContinueAfterOriginalDeleted) {
    return false;
  }
  return beendeErinnerungen(zeile.requestId, 'original_geloescht');
}

/**
 * Den ersten Termin setzen.
 *
 * Aufgerufen, sobald die Begruessung steht - vorher gibt es nichts, worauf
 * eine Erinnerung zeigen koennte. Idempotent: ein zweiter Aufruf fuer
 * denselben Vorgang verschiebt keinen bereits geplanten Termin, sonst
 * schoebe ein wiederholtes `guildMemberAdd` die Erinnerung endlos vor sich
 * her.
 */
export async function planeErsteErinnerung(
  requestId: string,
  settings: VerificationSettings,
  jetzt = new Date(),
): Promise<void> {
  if (!settings.reminderEnabled) {
    return;
  }
  const faellig = new Date(jetzt.getTime() + settings.reminderIntervalHours * 3600_000);
  await prisma.verificationRequest.updateMany({
    where: { id: requestId, nextReminderAt: null, reminderCount: 0, decidedAt: null },
    data: { nextReminderAt: faellig },
  });
}

/**
 * Steht die urspruengliche Verifikationsnachricht noch?
 *
 * Gefragt wird nach genau der Kennung, die beim Senden zurueckkam - nicht im
 * Kanalverlauf gesucht. Nach hundert weiteren Nachrichten faende eine Suche
 * sie ohnehin nicht mehr und erklaerte sie faelschlich fuer geloescht.
 *
 * Drei Antworten, und die dritte ist die wichtige:
 *
 * - `true`  - sie steht.
 * - `false` - Discord sagt 404: sie ist weg.
 * - `null`  - Discord antwortet gerade nicht. **Das ist kein «weg».** Wer
 *   beides gleich behandelt, beendet bei jeder Stoerung Reihen, die
 *   weiterlaufen sollten, und niemandem faellt es auf: es geschieht ja
 *   nichts.
 */
async function originalStehtNoch(
  request: Pick<VerificationRequest, 'greetingChannelId' | 'greetingMessageId'>,
  gateway: DiscordGateway,
): Promise<boolean | null> {
  const { greetingChannelId: kanal, greetingMessageId: nachricht } = request;
  if (!kanal || !nachricht) {
    // Nie eine gesendet - etwa weil der Kanal beim Beitritt fehlte. Das ist
    // kein Loeschen, und die Entscheidung faellt eine Ebene hoeher.
    return null;
  }
  try {
    return (await gateway.channels.message(kanal, nachricht)) !== null;
  } catch (error) {
    logger.warn('verification.reminder.original_unknown', { kanal, nachricht, error });
    return null;
  }
}

/** Den naechsten Termin setzen und die Zaehler fortschreiben. */
async function verschiebe(requestId: string, settings: VerificationSettings, jetzt: Date): Promise<void> {
  await prisma.verificationRequest.update({
    where: { id: requestId },
    data: {
      lastReminderAt: jetzt,
      nextReminderAt: new Date(jetzt.getTime() + settings.reminderIntervalHours * 3600_000),
      reminderCount: { increment: 1 },
    },
  });
}

/**
 * Eine einzelne faellige Erinnerung.
 *
 * ## Die Reihenfolge
 *
 * 1. **Termin sichern.** Bedingt fortgeschrieben, ehe irgendetwas gesendet
 *    wird. Zwei Worker, die dieselbe Zeile faellig sehen, koennen sich sonst
 *    beide fuer zustaendig halten - und die Person bekaeme zwei Erwaehnungen.
 *    Wer den Termin nicht bewegen konnte, war zu spaet und geht.
 * 2. **Beendigungsbedingungen pruefen.** Serverseitig und frisch gelesen, nie
 *    aus dem Zustand, mit dem der Durchgang begonnen hat.
 * 3. **Senden.**
 * 4. **Loeschen.** Nach der eingestellten Zeit, anhand der Kennung aus
 *    Schritt 3.
 *
 * Gibt `null` zurueck, wenn der Anspruch nicht zu holen war.
 */
export async function sendeErinnerung(
  requestId: string,
  settings: VerificationSettings,
  optionen: { gateway?: DiscordGateway; jetzt?: Date; warte?: (ms: number) => Promise<void> } = {},
): Promise<ErinnerungsErgebnis | null> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = optionen.jetzt ?? new Date();
  const warte = optionen.warte ?? ((ms: number) => new Promise((auf) => setTimeout(auf, ms)));

  /*
   * Der Anspruch. Nur wer `nextReminderAt` von faellig auf spaeter bewegt,
   * ist zustaendig - und das kann genau einer.
   */
  const { count } = await prisma.verificationRequest.updateMany({
    where: { id: requestId, nextReminderAt: { lte: jetzt } },
    data: { nextReminderAt: new Date(jetzt.getTime() + settings.reminderIntervalHours * 3600_000) },
  });
  if (count === 0) {
    return null;
  }

  const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request) {
    return null;
  }

  const ergebnis = (
    gesendet: boolean,
    geloescht: boolean,
    ende: ErinnerungsEnde | null,
  ): ErinnerungsErgebnis => ({ requestId, discordId: request.discordId, gesendet, geloescht, ende });

  // --- Beendigungsbedingungen ---------------------------------------------

  // Entschieden ist entschieden - verifiziert, abgelehnt, gebannt, weg.
  if (request.decidedAt !== null || request.status !== 'WAITING_FOR_MESSAGE') {
    await beendeErinnerungen(requestId, 'entschieden');
    return ergebnis(false, false, 'entschieden');
  }

  if (!settings.reminderEnabled) {
    await beendeErinnerungen(requestId, 'abgeschaltet');
    return ergebnis(false, false, 'abgeschaltet');
  }

  const kanal = settings.verificationChannelId;
  if (!kanal) {
    // Ohne Kanal gibt es keinen Ort fuer die Erwaehnung. Die Reihe endet
    // nicht endgueltig, sie ruht - deshalb ein eigener Grund.
    await beendeErinnerungen(requestId, 'kein_kanal');
    return ergebnis(false, false, 'kein_kanal');
  }

  /*
   * Ist die Person ueberhaupt noch da?
   *
   * `guildMemberRemove` schliesst den Vorgang, und der Fall oben faengt ihn
   * dann ab. Das Ereignis kann aber ausbleiben - ein Verbindungsabriss
   * genuegt. Deshalb wird hier zusaetzlich nachgesehen, ehe jemand erwaehnt
   * wird, den es auf dem Server nicht mehr gibt.
   */
  const mitglied = await gateway.members.get(request.discordId).catch(() => undefined);
  if (mitglied === null) {
    await beendeErinnerungen(requestId, 'kein_mitglied');
    return ergebnis(false, false, 'kein_mitglied');
  }

  const steht = await originalStehtNoch(request, gateway);
  if (steht === false && !settings.reminderContinueAfterOriginalDeleted) {
    await beendeErinnerungen(requestId, 'original_geloescht');
    return ergebnis(false, false, 'original_geloescht');
  }
  if (steht === null && !request.greetingMessageId && !settings.reminderContinueAfterOriginalDeleted) {
    // Es gab nie eine Begruessung. Ohne sie zeigt die Erinnerung auf nichts.
    await beendeErinnerungen(requestId, 'original_geloescht');
    return ergebnis(false, false, 'original_geloescht');
  }

  // --- Senden --------------------------------------------------------------

  const text = fuelleVorlage(settings.reminderMessage, request).trim();
  if (!text) {
    return ergebnis(false, false, null);
  }

  let gesendet;
  try {
    gesendet = await gateway.channels.send(kanal, {
      content: text.slice(0, 1900),
      /*
       * Genau eine Erwaehnung, und zwar diese.
       *
       * `parse: []` schaltet jede Erwaehnung ab, die sich aus dem Text
       * ergeben koennte - ein `@everyone` oder eine fremde Kennung in der
       * Vorlage bleibt damit Text. `users` erlaubt danach ausdruecklich die
       * eine, um die es geht. Ohne diese Kombination waere das
       * Vorlagenfeld im Dashboard ein Weg, den ganzen Server anzupingen.
       */
      allowedMentions: { parse: [] as never[], users: [request.discordId] },
    });
  } catch (error) {
    // Fehlende Rechte, geloeschter Kanal, Rate Limit: alles kein Grund, die
    // Reihe zu beenden. Der naechste Termin steht bereits.
    const status = error instanceof DiscordApiError ? error.status : null;
    logger.warn('verification.reminder.send_failed', { requestId, status, error });
    return ergebnis(false, false, null);
  }

  await verschiebe(requestId, settings, jetzt);

  // --- Wieder loeschen -----------------------------------------------------

  let geloescht = false;
  await warte(settings.reminderDeleteAfterSeconds * 1000);
  try {
    await gateway.channels.delete(kanal, gesendet.id, 'Verifikationserinnerung');
    geloescht = true;
  } catch (error) {
    /*
     * Bleibt sie stehen, ist das unschoen und kein Fehler.
     *
     * Was hier nicht passieren darf, ist ein zweiter Loeschversuch auf einer
     * anderen Nachricht - etwa der Begruessung. Geloescht wird ausschliesslich
     * die Kennung, die das Senden zurueckgegeben hat.
     */
    logger.warn('verification.reminder.delete_failed', { requestId, messageId: gesendet.id, error });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_REMINDER_SENT,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: 'system',
    actorUsername: 'Verifikation (Erinnerung)',
    targetDiscordId: request.discordId,
    targetLabel: request.displayName ?? request.username ?? request.discordId,
    success: true,
    metadata: {
      requestId,
      nummer: request.reminderCount + 1,
      geloescht,
      abstandStunden: settings.reminderIntervalHours,
    },
  });

  logger.info('verification.reminder.sent', {
    requestId,
    nummer: request.reminderCount + 1,
    geloescht,
  });
  return ergebnis(true, geloescht, null);
}
