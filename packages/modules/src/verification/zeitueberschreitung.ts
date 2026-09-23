import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { abschlussHinweis, raeumeVerifikationskanal, fuelleVorlage } from './abschluss';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';
import { writeLog } from './discord';
import { entscheide } from './service';

const logger = createLogger('verification:zeitueberschreitung');

/**
 * Wer nicht antwortet, verlässt den Server wieder.
 *
 * ## Wem die Frist gilt
 *
 * **Der Person, nicht der Moderation.** Gezählt wird ausschliesslich, solange
 * ein Vorgang auf eine Nachricht wartet. Sobald eine vorliegt, wartet er auf
 * eine Entscheidung - und wer geschrieben hat, darf nicht dafür bezahlen,
 * dass niemand aus dem Team gerade Zeit hat.
 *
 * Das ist keine zusätzliche Prüfung, sondern der Zustand selbst: die fällige
 * Abfrage kennt nur `WAITING_FOR_MESSAGE`. Schreibt jemand um 14:59, wechselt
 * sein Vorgang noch in der Sekunde nach `WAITING_FOR_REVIEW` und ist für
 * diese Abfrage nicht mehr vorhanden. Läuft die Zeitsteuerung trotzdem
 * gleichzeitig los, scheitert sie am Riegel: `entscheide` setzt `decidedAt`
 * bedingt, und genau einer kommt durch.
 *
 * ## Kein Zeitgeber im Arbeitsspeicher
 *
 * Die Frist steht nirgends als laufende Uhr. Sie ergibt sich aus `joinedAt`
 * in der Datenbank und der Frist in den Einstellungen - beides übersteht
 * jeden Neustart und jeden Absturz. Ein `setTimeout` über eine Viertelstunde
 * wäre nach dem ersten Deployment weg, und niemand hätte es bemerkt.
 *
 * Eine eigene Deadline-Spalte braucht es dafür nicht: sie wäre eine zweite
 * Wahrheit neben `joinedAt`, und eine geänderte Frist erreichte die
 * laufenden Vorgänge nicht mehr.
 *
 * ## Die Reihenfolge
 *
 * 1. **Anspruch sichern.** `entscheide` ist die atomare Klammer um alles
 *    Weitere. Erst wenn sie gewonnen ist, geschieht überhaupt etwas -
 *    dadurch kann kein zweiter Durchgang und kein zweiter Worker dieselbe
 *    Person zweimal anschreiben oder zweimal kicken.
 * 2. **Nachricht.** Vor dem Kick, denn danach teilt der Bot mit der Person
 *    keinen Server mehr und Discord verweigert das Öffnen des Kanals.
 * 3. **Aufräumen.** Über den Kanal, nicht über das Mitglied - es spielt
 *    keine Rolle, ob die Person den Server noch sieht.
 * 4. **Kick.**
 * 5. **Audit.** Mit dem Ausgang jedes einzelnen Schritts.
 *
 * Scheitert einer der Schritte, laufen die übrigen weiter. Eine geschlossene
 * Direktnachricht ist eine Einstellung, die der Person zusteht, und kein
 * Grund, sie im Server zu lassen.
 */

/**
 * Was aus der Nachricht wurde.
 *
 * Drei Zustände und nicht zwei: «nicht versucht» ist etwas anderes als
 * «fehlgeschlagen». Wer die Vorlage geleert oder den Kick abgeschaltet hat,
 * soll im Audit Log nicht lesen, die Zustellung sei gescheitert.
 */
export type NachrichtStand = 'GESENDET' | 'FEHLGESCHLAGEN' | 'NICHT_VERSUCHT';

export interface ZeitueberschreitungErgebnis {
  requestId: string;
  discordId: string;
  dm: NachrichtStand;
  gekickt: boolean;
  aufraeumen: string;
}

/**
 * Ein einzelner abgelaufener Vorgang.
 *
 * Gibt `null` zurück, wenn der Anspruch nicht zu holen war - dann hat ihn
 * jemand anderes: ein zweiter Worker, ein Moderator, oder die Person selbst
 * mit einer Nachricht in der letzten Sekunde.
 */
export async function behandleZeitueberschreitung(
  request: Pick<VerificationRequest, 'id' | 'discordId' | 'username' | 'displayName'>,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway; now?: Date } = {},
): Promise<ZeitueberschreitungErgebnis | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const now = options.now ?? new Date();

  const entschieden = await entscheide(
    request.id,
    {
      status: 'EXPIRED',
      by: 'SYSTEM',
      reason: `Keine Antwort innerhalb von ${settings.expireAfterMinutes} Minuten.`,
    },
    now,
  );
  if (!entschieden) {
    logger.info('verification.timeout.claim_lost', { requestId: request.id });
    return null;
  }
  logger.info('verification.timeout.claimed', { requestId: request.id });

  // Ohne Kick gibt es nichts zu erklären - dann geht auch keine Nachricht
  // raus.
  const dm: NachrichtStand = settings.kickOnExpire
    ? await sendeAbschiedsnachricht(entschieden, settings, gateway)
    : 'NICHT_VERSUCHT';

  // Aufräumen über den Kanal, nicht über das Mitglied: die Kennungen stehen
  // in der Datenbank, und ob die Person den Server noch sieht, spielt für
  // das Löschen einer Nachricht keine Rolle.
  const aufraeumen = await raeumeVerifikationskanal(entschieden, settings, { gateway });
  logger.info('verification.timeout.cleanup', {
    requestId: request.id,
    status: aufraeumen.status,
    geloescht: aufraeumen.geloescht,
  });

  let gekickt = false;
  if (settings.kickOnExpire) {
    try {
      await gateway.members.kick(
        request.discordId,
        `Verifikation nicht innerhalb von ${settings.expireAfterMinutes} Minuten abgeschlossen`,
      );
      gekickt = true;
      logger.info('verification.timeout.kicked', { requestId: request.id });
    } catch (error) {
      // Kein Grund, den Ablauf zurückzunehmen: entschieden ist entschieden,
      // und der fehlgeschlagene Kick steht im Audit Log.
      logger.warn('verification.timeout.kick_failed', { requestId: request.id, error });
    }
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_TIMEOUT_KICK,
    module: VERIFICATION_MODULE_ID,
    // Ausdrücklich das System und kein erfundener Moderator: niemand hat
    // hier einen Knopf gedrückt.
    actorDiscordId: 'system',
    actorUsername: 'Verifikation (Zeitsteuerung)',
    targetDiscordId: request.discordId,
    targetLabel: request.displayName ?? request.username ?? request.discordId,
    success: gekickt || !settings.kickOnExpire,
    metadata: {
      requestId: request.id,
      grund: `Keine Antwort innerhalb von ${settings.expireAfterMinutes} Minuten`,
      fristMinuten: settings.expireAfterMinutes,
      dm,
      kick: settings.kickOnExpire ? (gekickt ? 'ERFOLGT' : 'FEHLGESCHLAGEN') : 'ABGESCHALTET',
      aufraeumen: aufraeumen.status,
      aufraeumenHinweis: abschlussHinweis({
        meldung: { gesendet: false, bereitsGemeldet: false },
        aufraeumen,
      }),
    },
  });

  // Derselbe Weg wie bei jeder anderen Entscheidung: der Protokollkanal ist
  // eine Einstellung, und es gibt genau eine Funktion, die dorthin schreibt.
  await writeLog(entschieden, settings, gateway).catch((error: unknown) => {
    logger.warn('verification.timeout.log_failed', { requestId: request.id, error });
  });

  return {
    requestId: request.id,
    discordId: request.discordId,
    dm,
    gekickt,
    aufraeumen: aufraeumen.status,
  };
}

/**
 * Die Nachricht vor dem Kick.
 *
 * Sie erklärt den Grund und enthält den Weg zurück - sonst wäre ein Kick von
 * einem Bann nicht zu unterscheiden, und genau das soll er sein: kein Bann.
 *
 * `FEHLGESCHLAGEN` ist der Normalfall bei jemandem, der Direktnachrichten
 * abgeschaltet hat, und **kein Fehler** - der Kick geschieht trotzdem.
 */
async function sendeAbschiedsnachricht(
  request: VerificationRequest,
  settings: VerificationSettings,
  gateway: DiscordGateway,
): Promise<NachrichtStand> {
  const vorlage = settings.timeoutDmMessage.trim();
  if (!vorlage) {
    return 'NICHT_VERSUCHT';
  }

  const einladung = await einladungslink(settings, gateway);
  const text = fuelleVorlage(vorlage, {
    discordId: request.discordId,
    username: request.username,
    displayName: request.displayName,
  })
    // Ein leerer Platzhalter ist schlimmer als keiner: er hinterliesse eine
    // Zeile, die auf nichts zeigt.
    .replaceAll('{invite}', einladung ?? '')
    .trim();

  if (!text) {
    return 'NICHT_VERSUCHT';
  }

  try {
    const zugestellt = await gateway.channels.sendDirect(request.discordId, {
      content: text.slice(0, 1900),
      allowedMentions: { parse: [] as never[] },
    });
    logger.info(zugestellt ? 'verification.timeout.dm_sent' : 'verification.timeout.dm_failed', {
      requestId: request.id,
      mitEinladung: einladung !== null,
    });
    return zugestellt ? 'GESENDET' : 'FEHLGESCHLAGEN';
  } catch (error) {
    logger.warn('verification.timeout.dm_failed', { requestId: request.id, error });
    return 'FEHLGESCHLAGEN';
  }
}

/**
 * Der Einladungslink - eingestellt oder bestehend, nie neu erzeugt.
 *
 * Eine eigene Einladung je Zeitüberschreitung wäre eine Flut von Links, die
 * niemand mehr zuordnen kann, und sie bräuchte ein Recht, das der Bot nicht
 * haben muss. Gesucht wird deshalb unter den Einladungen, die es ohnehin
 * gibt, und genommen wird die dauerhafteste: unbefristet und ohne
 * Nutzungsgrenze. Eine, die in zwei Stunden abläuft, wäre in der Nachricht
 * schlimmer als keine.
 *
 * Findet sich keine - oder fehlt dem Bot `MANAGE_GUILD`, um überhaupt
 * nachzusehen -, kommt `null` zurück und die Nachricht geht ohne Link raus.
 * Sie erklärt dann immer noch, warum jemand gehen musste.
 */
async function einladungslink(
  settings: VerificationSettings,
  gateway: DiscordGateway,
): Promise<string | null> {
  if (settings.rejoinInviteUrl) {
    return settings.rejoinInviteUrl;
  }

  try {
    const vorhandene = await gateway.guild.invites();
    const dauerhaft = vorhandene.find((eintrag) => eintrag.expiresAt === null && eintrag.maxUses === 0);
    const gewaehlt = dauerhaft ?? vorhandene.find((eintrag) => eintrag.expiresAt === null);
    return gewaehlt ? `https://discord.gg/${gewaehlt.code}` : null;
  } catch (error) {
    logger.warn('verification.timeout.invite_unavailable', { error });
    return null;
  }
}
