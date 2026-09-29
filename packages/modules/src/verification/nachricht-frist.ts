import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { DiscordApiError, discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';

const logger = createLogger('verification:nachricht-frist');

/**
 * Die Begruessung raeumt sich nach einer Weile selbst weg.
 *
 * ## Das Problem, und nur dieses
 *
 * Ein Bot-Konto tritt bei, bekommt seine Begruessung und tut danach nichts
 * mehr. Ein totes Konto ebenso. Die Nachricht bleibt stehen - eine
 * Aufforderung an jemanden, der sie nie lesen wird -, und bei einem Server
 * mit Zulauf besteht der Verifikationskanal nach einem halben Jahr fast nur
 * noch aus ihnen.
 *
 * ## Was hier ausdruecklich nicht passiert
 *
 * Niemand wird gekickt, gebannt oder freigeschaltet, weil eine Frist abliegt.
 * Es gibt frueher einmal eine solche Frist gegeben - sie warf nach einer
 * Viertelstunde vom Server -, und sie ist ersatzlos entfallen, weil sie
 * zuverlaessig die Falschen traf. Hier wird eine Nachricht geloescht, sonst
 * nichts: der Vorgang steht danach unveraendert auf `WAITING_FOR_MESSAGE`,
 * die Rolle bleibt, die Person bleibt, und wer drei Tage spaeter doch noch
 * schreibt, wird ganz normal geprueft.
 *
 * ## Warum der Termin in der Datenbank steht
 *
 * `VerificationBotMessage.deleteAt` ist der ganze Plan - wie bei den
 * Erinnerungen und aus demselben Grund: ein `setTimeout` ueberlebt kein
 * Deployment, und einer je Nachricht waeren bei einem Server mit Zulauf
 * tausende Uhren im Arbeitsspeicher fuer eine Frage, die eine Abfrage
 * beantwortet. Nach einem Neustart laeuft der naechste Durchgang und holt
 * nach, was faellig geworden ist.
 *
 * ## Warum der Termin beim Senden gerechnet wird
 *
 * Und nicht bei jedem Durchgang aus `createdAt` plus der aktuellen
 * Einstellung. Wer das Intervall von 72 auf 6 Stunden stellt, wuerde sonst
 * beim naechsten Durchgang alles loeschen, was aelter als sechs Stunden ist -
 * auf einen Schlag, ohne es gewollt zu haben. Was gesendet wurde, traegt
 * seinen Termin bei sich.
 *
 * ## Warum das Loeschen die Erinnerungen nicht beendet
 *
 * Verschwindet die Begruessung, endet normalerweise die Erinnerungsreihe -
 * sie zeigt auf eine Nachricht, die es nicht mehr gibt. Dahinter steht die
 * Annahme, dass ein **Mensch** aufgeraeumt hat.
 *
 * Hier raeumt SwissHub selbst auf, und dann gilt die Annahme nicht. Waere es
 * anders, waeren die beiden Intervalle nicht unabhaengig: bei «Erinnerung
 * alle 24 Stunden, Loeschung nach 72» hoerten die Erinnerungen nach 72
 * Stunden auf, ohne dass das jemand eingestellt haette. Deshalb wird
 * `deletedAt` gesetzt, **bevor** geloescht wird, und `begruessungGeloescht`
 * uebergeht Zeilen, die das tragen.
 */

/** Hoechstens so viele Nachrichten je Durchgang - der Rest folgt im naechsten. */
const JE_DURCHGANG = 50;

export interface LoeschErgebnis {
  /** Wie viele tatsaechlich entfernt wurden. */
  geloescht: number;
  /** Wie viele bereits weg waren. Kein Fehler - das war das Ziel. */
  schonWeg: number;
  /** Wie viele nicht entfernt werden konnten. */
  fehlgeschlagen: number;
}

/**
 * Den Termin fuer eine frisch gesendete Begruessung setzen.
 *
 * Gibt den Zeitpunkt zurueck, oder `null`, wenn keiner gesetzt wurde - weil
 * das Auto-Delete aus ist oder die Zeile nicht gefunden wurde.
 *
 * Bedingt auf «hat noch keinen Termin»: ein zweiter Aufruf fuer dieselbe
 * Nachricht verschiebt nichts. Wirft nie - eine Nachricht ohne Termin ist der
 * Zustand von vorher und kein Schaden.
 */
export async function planeBegruessungsLoeschung(
  requestId: string,
  discordMessageId: string,
  settings: VerificationSettings,
  jetzt = new Date(),
): Promise<Date | null> {
  if (!settings.greetingAutoDeleteEnabled) {
    return null;
  }
  const faellig = new Date(jetzt.getTime() + settings.greetingAutoDeleteSeconds * 1000);
  const { count } = await prisma.verificationBotMessage
    .updateMany({
      where: { requestId, discordMessageId, kind: 'GREETING', deleteAt: null, deletedAt: null },
      data: { deleteAt: faellig },
    })
    .catch((error: unknown) => {
      logger.warn('verification.greeting.schedule_failed', { requestId, discordMessageId, error });
      return { count: 0 };
    });
  return count > 0 ? faellig : null;
}

/**
 * Alle faelligen Begruessungen entfernen.
 *
 * ## Der Riegel gegen doppeltes Loeschen
 *
 * Zwischen «gefunden» und «geloescht» liegt ein Netzaufruf, und in der Zeit
 * kann ein zweiter Durchgang - oder ein zweiter Worker - dieselbe Zeile
 * finden. Deshalb wird `deletedAt` **vor** dem Loeschen bedingt gesetzt: wer
 * sie als Erster von NULL wegsetzt, hat den Auftrag, und genau einer kommt
 * durch. Der andere findet `count === 0` und geht weiter.
 *
 * ## Warum eine bereits geloeschte Nachricht kein Fehler ist
 *
 * Discord antwortet dann mit 404 «Unknown Message», und das ist genau der
 * Zustand, den wir herstellen wollten - jemand war schneller, von Hand oder
 * mit einem anderen Werkzeug. Der Vermerk bleibt stehen, es gibt keinen
 * zweiten Versuch und keine Warnung im Protokoll. Alles andere waere
 * Fehlerlaerm fuer einen Erfolg.
 */
export async function loescheFaelligeBegruessungen(
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<LoeschErgebnis> {
  const faellig = await prisma.verificationBotMessage.findMany({
    where: { kind: 'GREETING', deletedAt: null, deleteAt: { lte: jetzt } },
    select: { id: true, requestId: true, channelId: true, discordMessageId: true },
    orderBy: { deleteAt: 'asc' },
    take: JE_DURCHGANG,
  });

  const ergebnis: LoeschErgebnis = { geloescht: 0, schonWeg: 0, fehlgeschlagen: 0 };

  for (const zeile of faellig) {
    const beansprucht = await prisma.verificationBotMessage.updateMany({
      where: { id: zeile.id, deletedAt: null },
      data: { deletedAt: jetzt },
    });
    if (beansprucht.count !== 1) {
      continue;
    }

    try {
      await gateway.channels.delete(
        zeile.channelId,
        zeile.discordMessageId,
        'Verifikationsnachricht: Frist abgelaufen',
      );
      ergebnis.geloescht += 1;
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        ergebnis.schonWeg += 1;
        continue;
      }
      ergebnis.fehlgeschlagen += 1;
      /*
       * Der Vermerk wird zurueckgenommen, damit der naechste Durchgang es
       * erneut versucht. Ein voruebergehender Ausfall bei Discord oder ein
       * kurz fehlendes Recht soll die Nachricht nicht fuer immer als
       * «geloescht» gelten lassen, waehrend sie im Kanal steht.
       */
      await prisma.verificationBotMessage
        .updateMany({ where: { id: zeile.id, deletedAt: jetzt }, data: { deletedAt: null } })
        .catch(() => undefined);
      logger.warn('verification.greeting.auto_delete_failed', {
        requestId: zeile.requestId,
        messageId: zeile.discordMessageId,
        error,
      });
    }
  }

  if (ergebnis.geloescht > 0 || ergebnis.schonWeg > 0) {
    logger.info('verification.greeting.auto_deleted', { ...ergebnis });
    /*
     * Ein Eintrag je Durchgang, nicht je Nachricht.
     *
     * Was jemanden interessiert, ist «SwissHub hat heute Nacht zwoelf alte
     * Begruessungen entfernt» - nicht zwoelf Zeilen mit je einer
     * Nachrichtenkennung. Und keine Person als Ziel: hier hat niemand
     * gehandelt, hier ist eine Frist abgelaufen.
     */
    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_GREETING_AUTO_DELETED,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'SwissHub',
      metadata: { ...ergebnis },
    });
  }
  return ergebnis;
}
