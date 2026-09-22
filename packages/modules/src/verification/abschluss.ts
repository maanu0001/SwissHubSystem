import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { VerificationRequest } from '@swisshub/database';
import {
  DISCORD_ERROR_CODES,
  DiscordApiError,
  discord as defaultDiscord,
  missingPermissions,
  type DiscordGateway,
  type DiscordPermissionName,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';

const logger = createLogger('verification:abschluss');

/**
 * Was nach der Entscheidung geschieht.
 *
 * Zwei Dinge, und beide sind **Folgearbeit**: die Meldung im Ergebniskanal
 * und das Aufräumen des Verifikationskanals. Entschieden ist zu diesem
 * Zeitpunkt bereits - die Rollen sind vergeben oder der Bann ist gesetzt.
 *
 * Genau deshalb wirft hier nichts. Eine Discord-Störung beim Melden oder
 * Aufräumen darf keine erfolgreiche Verifikation zurücknehmen: das Ergebnis
 * wäre ein Mitglied ohne Rollen, und das ist schlimmer als eine fehlende
 * Ankündigung. Was schiefgeht, steht im Vorgang, im Protokoll und im Audit
 * Log - und lässt sich dort sehen, statt still zu verschwinden.
 *
 * An einer Stelle, weil es vier Aufrufer gibt: der Knopf im Moderationskanal,
 * die Entscheidung im Dashboard, die AI-Freischaltung und der Ban-Pfad. Vier
 * Kopien dieser Reihenfolge liefen garantiert auseinander.
 */

/** Wie viele Seiten des Kanalverlaufs das Aufräumen höchstens liest. */
const HOECHSTENS_SEITEN = 10;

/** Nachrichten je Seite - Discords Maximum. */
const SEITENGROESSE = 100;

export type AufraeumStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export interface AufraeumErgebnis {
  status: AufraeumStatus;
  /** Wie viele Nachrichten entfernt wurden. */
  geloescht: number;
  /** Wie viele bereits weg waren - kein Fehler, sondern das Ziel. */
  schonWeg: number;
  /** Wie viele nicht entfernt werden konnten. */
  fehlgeschlagen: number;
  grund?: string;
}

/**
 * Den Verifikationskanal von den Spuren einer Person befreien.
 *
 * **Nur ihre.** Gelöscht wird, was dieser Person gehört: ihre eigenen
 * Nachrichten und die an sie gerichtete Begrüssung des Bots. Der Kanal wird
 * nicht geleert, und keine fremde Nachricht wird angefasst - weder die eines
 * anderen wartenden Mitglieds noch eine beliebige andere des Bots.
 *
 * ## Woher die Nachrichten kommen
 *
 * Zwei Quellen, und die Reihenfolge ist Absicht:
 *
 * 1. **Die festgehaltenen Kennungen.** Jede Nachricht im Verifikationskanal
 *    wird beim Eingang als `VerificationMessage` erfasst; die Begrüssung des
 *    Bots steht seit ihrem Senden am Vorgang. Das ist der genaue Weg: er
 *    braucht keine Suche und kann nichts verwechseln.
 * 2. **Ein begrenzter Blick in den Kanal.** Er schliesst die Lücke, die
 *    Quelle 1 offenlässt: Nachrichten aus einer Zeit, in der der Bot nicht
 *    lief, wurden nie erfasst. Gelesen wird seitenweise zurück bis zum
 *    Beitritt der Person, höchstens `HOECHSTENS_SEITEN` Seiten - ein Kanal
 *    mit zehntausend Nachrichten soll das Aufräumen nicht zu einem
 *    Dauerlauf machen.
 *
 * Keine Textsuche. Ein «die Nachricht enthält den Benutzernamen» fände die
 * Begrüssung einer anderen Person, sobald jemand seinen Namen ändert oder
 * zwei Namen sich ähneln - und löschte sie.
 *
 * ## Warum einzeln gelöscht wird
 *
 * Discords Sammellöschung nimmt nur Nachrichten, die jünger als vierzehn
 * Tage sind, und nur in einem Rutsch je Kanal. Eine Verifikation kann
 * Wochen alt sein; die Begrüssung wäre dann genau die Nachricht, die
 * stehenbliebe. Einzeln gelöscht wird alles, unabhängig vom Alter - und die
 * Zahlen sind klein: es geht um die Nachrichten einer Person, nicht um einen
 * Kanal.
 */
export async function raeumeVerifikationskanal(
  request: VerificationRequest,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway } = {},
): Promise<AufraeumErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;
  const kanal = settings.verificationChannelId;

  if (!settings.cleanupEnabled) {
    return { status: 'SKIPPED', geloescht: 0, schonWeg: 0, fehlgeschlagen: 0, grund: 'abgeschaltet' };
  }
  if (!kanal) {
    return { status: 'SKIPPED', geloescht: 0, schonWeg: 0, fehlgeschlagen: 0, grund: 'kein Kanal' };
  }

  /*
   * Die Rechte zuerst.
   *
   * Ohne «Nachrichten verwalten» endete jede einzelne Löschung mit einem
   * 403 - zwanzig Anfragen, zwanzig Fehler, und im Protokoll stünde
   * zwanzigmal dasselbe. Einmal fragen und sauber abbrechen ist die
   * bessere Auskunft.
   */
  const fehlend = await fehlendeRechte(kanal, gateway);
  if (fehlend.length > 0) {
    const grund = `Dem Bot fehlt im Verifikationskanal: ${fehlend.join(', ')}.`;
    await schreibeAufraeumStand(request.id, 'FAILED', grund);
    logger.warn('Aufräumen nicht möglich - fehlende Rechte', { requestId: request.id, fehlend });
    return { status: 'FAILED', geloescht: 0, schonWeg: 0, fehlgeschlagen: 0, grund };
  }

  const kennungen = await sammleKennungen(request, kanal, gateway);

  let geloescht = 0;
  let schonWeg = 0;
  let fehlgeschlagen = 0;

  for (const messageId of kennungen.ids) {
    const ausgang = await loescheEinzeln(kanal, messageId, gateway);
    if (ausgang === 'geloescht') {
      geloescht += 1;
    } else if (ausgang === 'schon-weg') {
      schonWeg += 1;
    } else {
      fehlgeschlagen += 1;
    }
  }

  const status: AufraeumStatus =
    fehlgeschlagen > 0 || kennungen.stand !== 'vollstaendig' ? 'PARTIAL' : 'COMPLETED';
  const grund =
    fehlgeschlagen > 0
      ? `${fehlgeschlagen} Nachricht(en) konnten nicht entfernt werden.`
      : kennungen.stand === 'unlesbar'
        ? 'Der Kanalverlauf liess sich nicht lesen - entfernt wurde nur, was festgehalten war.'
        : kennungen.stand === 'grenze'
          ? 'Der Kanalverlauf wurde nur bis zur Lesegrenze geprüft.'
          : undefined;

  await schreibeAufraeumStand(request.id, status, grund);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.VERIFICATION_CLEANUP,
    module: VERIFICATION_MODULE_ID,
    actorDiscordId: 'system',
    actorUsername: 'Verifikation',
    targetDiscordId: request.discordId,
    targetLabel: request.displayName ?? request.username ?? request.discordId,
    success: status === 'COMPLETED',
    metadata: {
      requestId: request.id,
      status,
      geloescht,
      schonWeg,
      fehlgeschlagen,
      // Bewusst nur Zahlen und Kennungen. Was in den Nachrichten stand, geht
      // das Protokoll nichts an.
      ausVerlauf: kennungen.ausVerlauf,
      verlauf: kennungen.stand,
    },
  });

  logger.info('Verifikationskanal aufgeräumt', {
    requestId: request.id,
    status,
    geloescht,
    schonWeg,
    fehlgeschlagen,
  });

  return { status, geloescht, schonWeg, fehlgeschlagen, grund };
}

/**
 * Wie weit der Blick in den Kanal gekommen ist.
 *
 * Die Unterscheidung ist keine Feinheit: «bis zur Lesegrenze» heisst, es kann
 * noch etwas geben; «gar nicht gelesen» heisst, niemand weiss es. Beides als
 * dasselbe zu melden hiesse, im zweiten Fall eine Auskunft zu geben, die
 * nicht stimmt.
 */
type Verlaufsstand = 'vollstaendig' | 'grenze' | 'unlesbar';

interface Kennungen {
  ids: string[];
  /** Wie viele davon erst der Blick in den Kanal gefunden hat. */
  ausVerlauf: number;
  stand: Verlaufsstand;
}

async function sammleKennungen(
  request: VerificationRequest,
  kanal: string,
  gateway: DiscordGateway,
): Promise<Kennungen> {
  const ids = new Set<string>();

  // 1. Die erfassten Nachrichten der Person.
  const erfasst = await prisma.verificationMessage.findMany({
    where: { requestId: request.id },
    select: { discordMessageId: true },
  });
  for (const zeile of erfasst) {
    ids.add(zeile.discordMessageId);
  }

  /*
   * Die Kennungen der Bot-Nachrichten werden frisch gelesen.
   *
   * Der übergebene Vorgang stammt aus der Entscheidung; die Nachricht an die
   * frisch freigeschaltete Person entsteht erst danach. Im Objekt in der Hand
   * des Aufrufers steht sie deshalb noch nicht - und genau sie bliebe sonst
   * im Kanal stehen.
   */
  const marken =
    (await prisma.verificationRequest
      .findUnique({
        where: { id: request.id },
        select: {
          greetingChannelId: true,
          greetingMessageId: true,
          welcomeChannelId: true,
          welcomeMessageId: true,
        },
      })
      .catch(() => null)) ?? request;

  /*
   * Die Begrüssung - aber nur, wenn sie in diesem Kanal steht.
   *
   * Der Kanal kann seit dem Senden umgestellt worden sein. Die alte
   * Begrüssung liegt dann weiterhin im alten Kanal, und dort aufzuräumen
   * hiesse, in einem Kanal zu löschen, über den gerade niemand entschieden
   * hat.
   */
  if (marken.greetingMessageId && (marken.greetingChannelId ?? kanal) === kanal) {
    ids.add(marken.greetingMessageId);
  }

  /*
   * Und die Nachricht an die frisch freigeschaltete Person - aus demselben
   * Grund. Sie ist die zweite Bot-Nachricht dieses Vorgangs; beliebige
   * andere Bot-Nachrichten im Kanal bleiben unberuehrt, weil nur diese
   * beiden Kennungen am Vorgang stehen.
   */
  if (marken.welcomeMessageId && (marken.welcomeChannelId ?? kanal) === kanal) {
    ids.add(marken.welcomeMessageId);
  }

  const vorVerlauf = ids.size;
  const stand = await ergaenzeAusVerlauf(request, kanal, gateway, ids);

  return { ids: [...ids], ausVerlauf: ids.size - vorVerlauf, stand };
}

/**
 * Der begrenzte Blick in den Kanal.
 *
 * Gelesen wird zurück bis zum Beitritt der Person - alles davor kann ihr
 * nicht gehören. Die Seitengrenze ist die zweite Bremse: sie greift in einem
 * Kanal, in dem seit dem Beitritt sehr viel geschrieben wurde.
 *
 * Der Rückgabewert sagt, wie weit es gekommen ist: bis zum Beitritt
 * (`vollstaendig`), nur bis zur Seitengrenze (`grenze`), oder gar nicht
 * (`unlesbar`). Was nicht gelesen werden konnte, wird gemeldet - und nicht
 * als «alles geprüft» ausgegeben.
 */
async function ergaenzeAusVerlauf(
  request: VerificationRequest,
  kanal: string,
  gateway: DiscordGateway,
  ids: Set<string>,
): Promise<Verlaufsstand> {
  const grenze = request.joinedAt;
  let before: string | undefined;

  for (let seite = 0; seite < HOECHSTENS_SEITEN; seite += 1) {
    let zeilen;
    try {
      zeilen = await gateway.channels.history(kanal, { limit: SEITENGROESSE, before });
    } catch (error) {
      logger.warn('Kanalverlauf konnte nicht gelesen werden', { requestId: request.id, error });
      // Was schon gelesen wurde, bleibt gültig - nur weiter kommt es nicht.
      return seite === 0 ? 'unlesbar' : 'grenze';
    }
    if (zeilen.length === 0) {
      return 'vollstaendig';
    }

    for (const zeile of zeilen) {
      if (zeile.authorId === request.discordId && !zeile.authorIsBot) {
        ids.add(zeile.id);
      }
    }

    const aelteste = zeilen[zeilen.length - 1];
    if (!aelteste) {
      return 'vollstaendig';
    }
    // Vor dem Beitritt kann nichts von dieser Person stammen.
    if (aelteste.createdAt.getTime() < grenze.getTime()) {
      return 'vollstaendig';
    }
    before = aelteste.id;
  }

  return 'grenze';
}

type LoeschAusgang = 'geloescht' | 'schon-weg' | 'fehler';

/**
 * Eine Nachricht entfernen.
 *
 * Eine bereits verschwundene Nachricht ist ein Erfolg, kein Fehler: das Ziel
 * - sie steht nicht mehr da - ist erreicht. Genau das macht das Aufräumen
 * wiederholbar: ein zweiter Durchlauf findet nichts mehr vor und meldet
 * trotzdem «erledigt».
 */
async function loescheEinzeln(
  kanal: string,
  messageId: string,
  gateway: DiscordGateway,
): Promise<LoeschAusgang> {
  try {
    await gateway.channels.delete(kanal, messageId, 'Verifikation abgeschlossen');
    return 'geloescht';
  } catch (error) {
    if (istSchonWeg(error)) {
      return 'schon-weg';
    }
    logger.warn('Nachricht konnte nicht entfernt werden', { kanal, messageId, error });
    return 'fehler';
  }
}

function istSchonWeg(error: unknown): boolean {
  if (!(error instanceof DiscordApiError)) {
    return false;
  }
  return (
    error.status === 404 ||
    error.discordCode === DISCORD_ERROR_CODES.UNKNOWN_MESSAGE ||
    error.discordCode === DISCORD_ERROR_CODES.UNKNOWN_CHANNEL
  );
}

/** Die drei Rechte, ohne die im Kanal nichts aufzuräumen ist. */
const NOETIGE_RECHTE: readonly DiscordPermissionName[] = [
  'VIEW_CHANNEL',
  'READ_MESSAGE_HISTORY',
  'MANAGE_MESSAGES',
];

const RECHT_NAME: Record<string, string> = {
  VIEW_CHANNEL: 'Kanal ansehen',
  READ_MESSAGE_HISTORY: 'Nachrichtenverlauf lesen',
  MANAGE_MESSAGES: 'Nachrichten verwalten',
};

/**
 * Welche der nötigen Rechte dem Bot im Kanal fehlen.
 *
 * Lässt sich die Frage nicht beantworten - Discord antwortet nicht -, gilt
 * nichts als fehlend: dann wird es versucht, und die einzelnen Löschungen
 * sagen, woran es lag. Eine Vermutung wäre hier die schlechtere Auskunft.
 */
async function fehlendeRechte(kanal: string, gateway: DiscordGateway): Promise<string[]> {
  let rechte: bigint;
  try {
    rechte = await gateway.channels.botPermissions(kanal);
  } catch (error) {
    logger.warn('Kanalrechte konnten nicht geprüft werden', { kanal, error });
    return [];
  }
  return missingPermissions(rechte, NOETIGE_RECHTE).map((recht) => RECHT_NAME[recht] ?? recht);
}

async function schreibeAufraeumStand(
  requestId: string,
  status: AufraeumStatus,
  grund?: string,
): Promise<void> {
  await prisma.verificationRequest
    .update({
      where: { id: requestId },
      data: { cleanupAt: new Date(), cleanupStatus: status, cleanupError: grund?.slice(0, 300) ?? null },
    })
    .catch(() => undefined);
}

// --- Die Meldung nach erfolgreicher Verifikation -----------------------------

export interface MeldungsErgebnis {
  gesendet: boolean;
  /** Bereits zuvor gesendet - der zweite Klick meldet nicht noch einmal. */
  bereitsGemeldet: boolean;
  grund?: string;
}

/**
 * Die Platzhalter der Vorlage.
 *
 * Genau drei, und sie werden ersetzt, nicht ausgewertet. Eine Vorlage, die
 * beliebige Ausdrücke auswertete, wäre eine Ausführungsumgebung in einem
 * Textfeld - und jeder, der Moduleinstellungen ändern darf, hätte sie.
 *
 * Was nicht in der Liste steht, bleibt wörtlich stehen. Das ist die
 * ehrlichere Antwort als ein leerer String: wer sich vertippt, sieht es.
 */
export function fuelleVorlage(
  vorlage: string,
  person: { discordId: string; username: string | null; displayName: string | null },
): string {
  const anzeige = person.displayName ?? person.username ?? person.discordId;
  return vorlage
    .replaceAll('{user}', `<@${person.discordId}>`)
    .replaceAll('{username}', person.username ?? anzeige)
    .replaceAll('{displayName}', anzeige);
}

/** `#3BA55D` → `0x3BA55D`. Ungültige Angaben fallen auf die Modulfarbe zurück. */
function farbe(wert: string): number {
  const treffer = /^#?([0-9A-Fa-f]{6})$/u.exec(wert.trim());
  return treffer ? Number.parseInt(treffer[1]!, 16) : 0x3ba55d;
}

/**
 * Melden, dass jemand verifiziert wurde.
 *
 * **Genau einmal.** Die Kennung der gesendeten Nachricht steht danach am
 * Vorgang, und sie ist zugleich die Bedingung: ist sie gesetzt, wird nicht
 * noch einmal gemeldet. Ein zweiter Klick auf denselben Knopf, eine
 * wiederholt zugestellte Interaktion, ein Wiederholungslauf - alle drei
 * finden die Marke vor und tun nichts.
 *
 * **Nur bei Erfolg.** Der Aufrufer entscheidet das nicht: hier wird der
 * Status geprüft. Ein abgelehnter oder noch offener Vorgang erzeugt keine
 * Meldung, auch wenn ihn jemand versehentlich hierher reicht.
 *
 * **Wirft nie.** Scheitert das Senden, bleibt die Verifikation erfolgreich -
 * die Rollen sind vergeben. Der Fehlschlag steht im Audit Log und im
 * Rückgabewert; die Oberfläche kann ihn zeigen.
 */
export async function sendeErfolgsmeldung(
  request: VerificationRequest,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway } = {},
): Promise<MeldungsErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;

  if (request.status !== 'VERIFIED') {
    return { gesendet: false, bereitsGemeldet: false, grund: 'nicht verifiziert' };
  }
  if (!settings.postVerificationChannelId) {
    return { gesendet: false, bereitsGemeldet: false, grund: 'kein Kanal' };
  }
  if (request.successMessageId) {
    return { gesendet: false, bereitsGemeldet: true };
  }

  /*
   * Der Riegel steht in der Datenbank, nicht im Speicher.
   *
   * Zwei gleichzeitige Interaktionen laufen in zwei Prozessen - Bot und
   * WebApp. Eine Prüfung in JavaScript entschiede das Rennen nicht. Die
   * bedingte Aktualisierung schon: wer `successMessageAt` als Erster von
   * NULL wegsetzt, darf senden, und genau einer kommt durch.
   */
  const beansprucht = await prisma.verificationRequest.updateMany({
    where: { id: request.id, successMessageId: null, successMessageAt: null },
    data: { successMessageAt: new Date(), successChannelId: settings.postVerificationChannelId },
  });
  if (beansprucht.count === 0) {
    return { gesendet: false, bereitsGemeldet: true };
  }

  const person = {
    discordId: request.discordId,
    username: request.username,
    displayName: request.displayName,
  };

  try {
    const gesendet = await gateway.channels.send(settings.postVerificationChannelId, {
      // Die Erwähnung steht im `content`, nicht im Embed: eine Erwähnung
      // innerhalb eines Embeds wird verlinkt, benachrichtigt aber nicht.
      ...(settings.postVerificationMention ? { content: `<@${request.discordId}>` } : {}),
      embeds: [
        {
          title: fuelleVorlage(settings.postVerificationTitle, person).slice(0, 256),
          description: fuelleVorlage(settings.postVerificationMessage, person).slice(0, 4000),
          color: farbe(settings.postVerificationColor),
          timestamp: new Date().toISOString(),
        },
      ],
      // Ausdrücklich nur die betroffene Person - ein `@everyone` in der
      // Vorlage bleibt wirkungslos.
      allowedMentions: settings.postVerificationMention
        ? { parse: [] as never[], users: [request.discordId] }
        : { parse: [] as never[] },
    });

    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { successMessageId: gesendet.id },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_SUCCESS_POSTED,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'Verifikation',
      targetDiscordId: request.discordId,
      targetLabel: request.displayName ?? request.username ?? request.discordId,
      success: true,
      metadata: {
        requestId: request.id,
        channelId: settings.postVerificationChannelId,
        messageId: gesendet.id,
      },
    });

    return { gesendet: true, bereitsGemeldet: false };
  } catch (error) {
    /*
     * Die Marke wird zurückgenommen.
     *
     * Sonst bliebe ein Vorgang als «gemeldet» stehen, der nie gemeldet
     * wurde - und ein zweiter Versuch käme nicht mehr durch. Die
     * Verifikation selbst bleibt davon unberührt: sie ist erfolgt.
     */
    await prisma.verificationRequest
      .update({ where: { id: request.id }, data: { successMessageAt: null, successChannelId: null } })
      .catch(() => undefined);

    const grund = error instanceof Error ? error.message : 'Unbekannter Fehler';
    logger.error('Erfolgsmeldung konnte nicht gesendet werden', { requestId: request.id, error });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.VERIFICATION_SUCCESS_POST_FAILED,
      module: VERIFICATION_MODULE_ID,
      actorDiscordId: 'system',
      actorUsername: 'Verifikation',
      targetDiscordId: request.discordId,
      targetLabel: request.displayName ?? request.username ?? request.discordId,
      success: false,
      metadata: {
        requestId: request.id,
        channelId: settings.postVerificationChannelId,
        grund: grund.slice(0, 200),
      },
    });

    return { gesendet: false, bereitsGemeldet: false, grund };
  }
}

// --- Der eine Weg nach einer Entscheidung ------------------------------------

export interface AbschlussErgebnis {
  meldung: MeldungsErgebnis;
  aufraeumen: AufraeumErgebnis;
}

/**
 * Alles, was nach einer Entscheidung noch zu tun ist.
 *
 * Vier Aufrufer gibt es - der Knopf im Moderationskanal, die Entscheidung im
 * Dashboard, die AI-Freischaltung und der Ban-Pfad -, und sie sollen
 * dasselbe tun. Vier Kopien dieser Reihenfolge liefen garantiert
 * auseinander: die eine räumte auf, die andere nicht, und nach dem Ban
 * bliebe alles stehen.
 *
 * Die Reihenfolge: **erst melden, dann aufräumen.** Das Melden liest den
 * Vorgang, das Aufräumen verändert Discord - und die Meldung soll nicht
 * daran hängen, dass zwanzig Löschungen vorher durchgingen.
 *
 * **Wirft nie.** Beides ist Folgearbeit; entschieden ist bereits.
 */
export async function nachEntscheidung(
  request: VerificationRequest,
  settings: VerificationSettings,
  options: { gateway?: DiscordGateway } = {},
): Promise<AbschlussErgebnis> {
  const meldung =
    request.status === 'VERIFIED'
      ? await sendeErfolgsmeldung(request, settings, options).catch((error: unknown) => {
          logger.warn('Erfolgsmeldung gescheitert', { requestId: request.id, error });
          return { gesendet: false, bereitsGemeldet: false, grund: 'unerwarteter Fehler' };
        })
      : { gesendet: false, bereitsGemeldet: false, grund: 'keine Freischaltung' };

  const aufraeumen = await raeumeVerifikationskanal(request, settings, options).catch((error: unknown) => {
    logger.warn('Aufräumen gescheitert', { requestId: request.id, error });
    return {
      status: 'FAILED' as const,
      geloescht: 0,
      schonWeg: 0,
      fehlgeschlagen: 0,
      grund: 'unerwarteter Fehler',
    };
  });

  return { meldung, aufraeumen };
}

/**
 * Ein Satz für die Oberfläche - oder `null`, wenn alles glatt lief.
 *
 * Die Moderation soll erfahren, wenn die Meldung nicht ankam oder der Kanal
 * nicht aufgeräumt werden konnte. Sie soll aber nicht bei jedem sauberen
 * Durchlauf eine Bestätigung lesen müssen, die nichts sagt.
 */
export function abschlussHinweis(ergebnis: AbschlussErgebnis): string | null {
  const teile: string[] = [];
  if (ergebnis.meldung.grund && !ergebnis.meldung.bereitsGemeldet) {
    if (ergebnis.meldung.grund !== 'kein Kanal' && ergebnis.meldung.grund !== 'keine Freischaltung') {
      teile.push('Die Meldung im Ergebniskanal konnte nicht gesendet werden.');
    }
  }
  if (ergebnis.aufraeumen.status === 'FAILED') {
    teile.push(ergebnis.aufraeumen.grund ?? 'Der Verifikationskanal konnte nicht aufgeräumt werden.');
  } else if (ergebnis.aufraeumen.status === 'PARTIAL') {
    teile.push(ergebnis.aufraeumen.grund ?? 'Der Verifikationskanal wurde nur teilweise aufgeräumt.');
  }
  return teile.length > 0 ? teile.join(' ') : null;
}
