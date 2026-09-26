import { AUDIT_ACTIONS, Prisma, prisma, recordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import type { FragtAbstimmung } from '@swisshub/database';
import { FRAGT_MODULE_ID, type FragtSettings } from './config';
import { getModuleSettings } from '../module-state';
import { ergebnisEmbed, ergebnisMeldung, frageEmbed } from './embed';
import { berechneErgebnis, zuSnapshot, type Ergebnis, type StimmenZeile } from './ergebnis';
import { erstelleEntwurf } from './entwurf';
import type { Handelnder } from './bibliothek';

const log = createLogger('fragt:abstimmung');

/**
 * Veroeffentlichen, abstimmen, schliessen.
 *
 * ## Die drei Stellen, an denen es schiefgehen kann
 *
 * **Doppelte Veroeffentlichung.** Zwei Durchgaenge des Planers - oder einer
 * nach einem Neustart - duerfen nicht zwei Embeds erzeugen. Verhindert wird das
 * nicht durch eine Pruefung, sondern durch die Bedingung
 * `@@unique([frageId, opensAt])` in der Datenbank: der Planer rechnet den
 * Termin deterministisch aus, beide kommen auf denselben, genau einer kommt
 * durch.
 *
 * **Doppelte Stimme.** Zwei schnelle Klicks laufen beide durch jede Pruefung.
 * Verhindert wird das durch `@@unique([abstimmungId, voterDiscordId])` und ein
 * `upsert`: eine Stimme zu aendern ist ein `update` derselben Zeile, kein
 * Loeschen-und-Einfuegen.
 *
 * **Doppeltes Schliessen.** Der Abschluss schreibt das Ergebnis fest, aendert
 * die Nachricht und legt einen Entwurf an. Zweimal ausgefuehrt waeren das zwei
 * Ergebnismeldungen im Kanal. Verhindert wird das durch ein bedingtes
 * `updateMany` auf `status: ACTIVE` - wer null Zeilen aendert, war nicht der
 * Erste und hoert auf.
 */

export interface VeroeffentlichungsEingabe {
  guildId: string;
  frageId: string;
  /**
   * Wann die Abstimmung als eroeffnet gilt.
   *
   * Vom Planer der berechnete Termin, von Hand die aktuelle Zeit. Dieser Wert
   * ist die halbe Absicherung gegen doppelte Embeds - er muss deterministisch
   * sein, nicht «jetzt», wenn er vom Planer kommt.
   */
  opensAt: Date;
  channelId: string;
  dauerStunden: number;
  zwischenstandSichtbar: boolean;
}

export type VeroeffentlichungsErgebnis =
  | { art: 'veroeffentlicht'; abstimmung: FragtAbstimmung }
  | { art: 'schon-vorhanden'; abstimmung: FragtAbstimmung };

/**
 * Eine Frage auf Discord stellen.
 *
 * ## Die Reihenfolge ist Absicht
 *
 * Erst die Zeile in der Datenbank, dann die Nachricht bei Discord. Umgekehrt
 * waere die Nachricht draussen und die Zeile fehlte - ein Embed mit Buttons,
 * die auf nichts zeigen, und beim naechsten Durchgang ein zweites daneben.
 *
 * So steht im schlechteren Fall eine Abstimmung ohne `messageId` in der
 * Datenbank. Das ist reparierbar: `stelleNachrichtSicher` holt sie beim
 * naechsten Durchgang nach, ohne eine zweite Zeile anzulegen.
 */
export async function veroeffentliche(
  eingabe: VeroeffentlichungsEingabe,
  gateway: DiscordGateway = defaultDiscord,
): Promise<VeroeffentlichungsErgebnis> {
  const frage = await prisma.fragtFrage.findUnique({
    where: { id: eingabe.frageId },
    include: { optionen: { orderBy: { position: 'asc' } } },
  });
  if (!frage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }
  if (frage.archivedAt) {
    throw new AppError('CONFLICT', { userMessage: 'Diese Frage ist archiviert.' });
  }
  if (frage.optionen.length < 2) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Frage hat zu wenige Antwortmöglichkeiten.',
    });
  }

  const closesAt = new Date(eingabe.opensAt.getTime() + eingabe.dauerStunden * 3_600_000);

  let abstimmung: FragtAbstimmung;
  let warSchonDa = false;
  try {
    abstimmung = await prisma.fragtAbstimmung.create({
      data: {
        guildId: eingabe.guildId,
        frageId: frage.id,
        // Die Kopie, nicht der Verweis: was hier steht, ist was die Leute lasen.
        frageText: frage.text,
        untertitel: frage.untertitel,
        typ: frage.typ,
        channelId: eingabe.channelId,
        opensAt: eingabe.opensAt,
        closesAt,
        zwischenstandSichtbar: eingabe.zwischenstandSichtbar,
      },
    });
  } catch (fehler) {
    /*
     * P2002: die Bedingung `@@unique([frageId, opensAt])` hat gegriffen.
     *
     * Das ist kein Fehler, sondern die Antwort: jemand anderes - ein zweiter
     * Durchgang, ein zweiter Worker - war schneller. Die vorhandene Zeile ist
     * das gewuenschte Ergebnis.
     */
    if (fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === 'P2002') {
      const vorhanden = await prisma.fragtAbstimmung.findUnique({
        where: { frageId_opensAt: { frageId: frage.id, opensAt: eingabe.opensAt } },
      });
      if (!vorhanden) {
        throw fehler;
      }
      abstimmung = vorhanden;
      warSchonDa = true;
    } else {
      throw fehler;
    }
  }

  await prisma.fragtFrage.update({
    where: { id: frage.id },
    data: { status: 'ACTIVE', geplantAt: null, zuletztGestelltAt: eingabe.opensAt },
  });

  const mitNachricht = await stelleNachrichtSicher(abstimmung, gateway);

  if (!warSchonDa) {
    log.info('Frage veroeffentlicht', {
      abstimmungId: abstimmung.id,
      frageId: frage.id,
      channelId: eingabe.channelId,
      closesAt,
    });
  }

  return warSchonDa
    ? { art: 'schon-vorhanden', abstimmung: mitNachricht }
    : { art: 'veroeffentlicht', abstimmung: mitNachricht };
}

/**
 * Dafuer sorgen, dass zu dieser Abstimmung eine Discord-Nachricht steht.
 *
 * Wird beim Veroeffentlichen aufgerufen und bei jedem Durchgang des Planers.
 * Ist `messageId` gesetzt, geschieht nichts - das ist der Normalfall und
 * kostet keine Anfrage bei Discord.
 *
 * Damit ist eine Abstimmung, deren Nachricht nicht abgeschickt werden konnte
 * (Discord nicht erreichbar), kein verlorener Fall: der naechste Durchgang holt
 * sie nach. Und weil die Bedingung `messageId === null` ist und nicht «ist die
 * Nachricht noch da», entsteht dabei keine zweite.
 */
export async function stelleNachrichtSicher(
  abstimmung: FragtAbstimmung,
  gateway: DiscordGateway = defaultDiscord,
): Promise<FragtAbstimmung> {
  if (abstimmung.messageId) {
    return abstimmung;
  }

  const optionen = await prisma.fragtOption.findMany({
    where: { frage: { abstimmungen: { some: { id: abstimmung.id } } } },
    orderBy: { position: 'asc' },
  });

  const { embed, komponenten } = frageEmbed(
    {
      abstimmungId: abstimmung.id,
      frageText: abstimmung.frageText,
      untertitel: abstimmung.untertitel,
      optionen: optionen.map((option) => ({
        id: option.id,
        label: option.label,
        position: option.position,
      })),
      closesAt: abstimmung.closesAt,
    },
    null,
  );

  const gesendet = await gateway.channels.send(abstimmung.channelId, {
    embeds: [embed],
    components: komponenten,
  });

  /*
   * Nur setzen, wenn noch nichts steht.
   *
   * `updateMany` mit `messageId: null` in der Bedingung: liefe dieser Code
   * zweimal gleichzeitig, waeren zwei Nachrichten draussen - unschoen, aber
   * nicht zu verhindern, sobald Discord zweimal gefragt wurde. Was sich
   * verhindern laesst, ist eine Datenbank, die die erste vergisst.
   */
  await prisma.fragtAbstimmung.updateMany({
    where: { id: abstimmung.id, messageId: null },
    data: { messageId: gesendet.id },
  });

  return { ...abstimmung, messageId: gesendet.id };
}

/**
 * Eine Frage von Hand stellen - sofort.
 *
 * `opensAt` ist hier «jetzt», auf die Minute abgeschnitten. Das Abschneiden ist
 * kein Schoenheitsfehler: es macht aus zwei Klicks innerhalb derselben Minute
 * denselben Termin, und damit greift die Bedingung `@@unique([frageId,
 * opensAt])` auch gegen einen Doppelklick im Dashboard.
 */
export async function veroeffentlicheVonHand(
  guildId: string,
  frageId: string,
  actor: Handelnder,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<VeroeffentlichungsErgebnis> {
  const einstellungen = await getModuleSettings<FragtSettings>(FRAGT_MODULE_ID);
  if (!einstellungen.channelId) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Es ist kein Kanal eingestellt. Wähle unter Einstellungen einen Kanal, in dem SwissHub fragen darf.',
    });
  }

  const laufend = await laufendeAbstimmung(guildId);
  if (laufend) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Es läuft bereits eine Abstimmung. Schliesse sie zuerst - zwei Fragen gleichzeitig teilen die Aufmerksamkeit.',
    });
  }

  const frage = await prisma.fragtFrage.findUnique({ where: { id: frageId } });
  if (!frage) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Frage gibt es nicht.' });
  }

  const opensAt = new Date(Math.floor(jetzt.getTime() / 60_000) * 60_000);
  const ausgang = await veroeffentliche(
    {
      guildId,
      frageId,
      opensAt,
      channelId: einstellungen.channelId,
      dauerStunden: frage.dauerStunden || einstellungen.durationHours,
      zwischenstandSichtbar: einstellungen.liveResults,
    },
    gateway,
  );

  if (ausgang.art === 'schon-vorhanden') {
    throw new AppError('CONFLICT', {
      userMessage: 'Diese Frage wurde gerade schon gestellt.',
    });
  }

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_QUESTION_PUBLISHED,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: frage.text,
    metadata: {
      frageId,
      abstimmungId: ausgang.abstimmung.id,
      channelId: einstellungen.channelId,
      automatisch: false,
    },
  });

  return ausgang;
}

export type StimmErgebnis =
  | { art: 'gezaehlt'; label: string }
  | { art: 'geaendert'; label: string; vorher: string }
  | { art: 'unveraendert'; label: string }
  | { art: 'beendet' }
  | { art: 'unbekannt' };

/**
 * Eine Stimme abgeben oder aendern.
 *
 * ## Warum `upsert` und nicht Loeschen-und-Einfuegen
 *
 * Weil zwischen dem Loeschen und dem Einfuegen ein zweiter Klick liegen kann.
 * Dann waere die alte Stimme weg und die neue zweimal da - oder gar keine. Ein
 * `upsert` auf die Bedingung `(abstimmungId, voterDiscordId)` ist eine
 * Anweisung an die Datenbank, und die Datenbank macht sie ungeteilt.
 *
 * ## Warum die Frist hier noch einmal geprueft wird
 *
 * Weil der Button stehenbleibt. Zwischen dem Ende der Abstimmung und dem
 * Durchgang, der die Buttons entfernt, liegt hoechstens eine Minute - und in
 * dieser Minute wuerde eine Stimme sonst gezaehlt. Die Serverzeit entscheidet,
 * nicht ob ein Knopf noch klickbar ist.
 */
export async function stimmeAb(
  abstimmungId: string,
  optionId: string,
  waehler: { discordId: string },
  jetzt = new Date(),
): Promise<StimmErgebnis> {
  const abstimmung = await prisma.fragtAbstimmung.findUnique({
    where: { id: abstimmungId },
    include: { frage: { include: { optionen: true } } },
  });
  if (!abstimmung) {
    return { art: 'unbekannt' };
  }
  if (abstimmung.status !== 'ACTIVE' || jetzt >= abstimmung.closesAt) {
    return { art: 'beendet' };
  }

  /*
   * Gehoert diese Antwort zu dieser Frage?
   *
   * Die Kennung kommt aus einem Button, und ein Button ist ein Wert, den man
   * nachbauen kann. Ohne diese Pruefung liesse sich mit einer fremden
   * Optionskennung eine Stimme in eine Abstimmung legen, in der diese Antwort
   * nicht steht - und die Auszaehlung fand sie nie wieder.
   */
  const option = abstimmung.frage.optionen.find((eintrag) => eintrag.id === optionId);
  if (!option) {
    return { art: 'unbekannt' };
  }

  const vorher = await prisma.fragtStimme.findUnique({
    where: { abstimmungId_voterDiscordId: { abstimmungId, voterDiscordId: waehler.discordId } },
    include: { option: true },
  });

  if (vorher?.optionId === optionId) {
    // Derselbe Knopf zweimal. Nichts zu tun - und ausdruecklich keine zweite
    // Stimme.
    return { art: 'unveraendert', label: option.label };
  }

  await prisma.fragtStimme.upsert({
    where: { abstimmungId_voterDiscordId: { abstimmungId, voterDiscordId: waehler.discordId } },
    create: { abstimmungId, optionId, voterDiscordId: waehler.discordId },
    update: { optionId },
  });

  if (vorher) {
    return { art: 'geaendert', label: option.label, vorher: vorher.option.label };
  }
  return { art: 'gezaehlt', label: option.label };
}

/** Die Stimmen einer Abstimmung, ausgezaehlt. */
export async function zaehleStimmen(abstimmungId: string): Promise<Ergebnis> {
  const [optionen, gruppen] = await Promise.all([
    prisma.fragtOption.findMany({
      where: { frage: { abstimmungen: { some: { id: abstimmungId } } } },
      orderBy: { position: 'asc' },
    }),
    prisma.fragtStimme.groupBy({
      by: ['optionId'],
      where: { abstimmungId },
      _count: { _all: true },
    }),
  ]);

  const nachOption = new Map(gruppen.map((gruppe) => [gruppe.optionId, gruppe._count._all]));
  const zeilen: StimmenZeile[] = optionen.map((option) => ({
    optionId: option.id,
    label: option.label,
    position: option.position,
    // Eine Antwort ohne Stimmen steht mit 0 da und nicht gar nicht: sonst
    // fehlte sie in der Ergebnisgrafik, und niemand wuesste, dass sie zur Wahl
    // stand.
    stimmen: nachOption.get(option.id) ?? 0,
  }));

  return berechneErgebnis(zeilen);
}

export type SchliessErgebnis =
  { art: 'geschlossen'; abstimmung: FragtAbstimmung; ergebnis: Ergebnis } | { art: 'war-schon-zu' };

/**
 * Eine Abstimmung schliessen.
 *
 * Idempotent, und das entscheidet die Datenbank: das `updateMany` unten setzt
 * `status` nur dort, wo er noch `ACTIVE` ist. Wer null Zeilen aendert, war
 * nicht der Erste - und hoert auf, bevor irgendetwas bei Discord geschieht.
 *
 * Ohne diese Bedingung waere ein Neustart des Planers zwei Ergebnismeldungen
 * im Kanal, zwei Entwuerfe und zwei Audit-Eintraege.
 */
export async function schliesse(
  abstimmungId: string,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<SchliessErgebnis> {
  const ergebnis = await zaehleStimmen(abstimmungId);
  const schnappschuss = zuSnapshot(ergebnis, jetzt);

  const geaendert = await prisma.fragtAbstimmung.updateMany({
    where: { id: abstimmungId, status: 'ACTIVE' },
    data: {
      status: 'CLOSED',
      closedAt: jetzt,
      ergebnis: schnappschuss as unknown as Prisma.InputJsonValue,
      finalVotes: ergebnis.gesamt,
    },
  });

  if (geaendert.count === 0) {
    return { art: 'war-schon-zu' };
  }

  const abstimmung = await prisma.fragtAbstimmung.findUniqueOrThrow({ where: { id: abstimmungId } });

  // Die Frage steht wieder zur Verfuegung.
  await prisma.fragtFrage.update({
    where: { id: abstimmung.frageId },
    data: { status: 'CLOSED' },
  });

  /*
   * Ab hier: Discord und der Entwurf.
   *
   * Beides nach der Transaktion und beides einzeln abgesichert. Ein Discord,
   * das gerade nicht antwortet, darf das festgeschriebene Ergebnis nicht
   * zurueckrollen - die Zahlen sind das Wichtigste, die Nachricht ist
   * nachholbar.
   */
  await aktualisiereNachricht(abstimmung, ergebnis, gateway).catch((fehler) => {
    log.warn('Abstimmungsnachricht liess sich nicht aktualisieren', { abstimmungId, fehler });
  });

  const einstellungen = await getModuleSettings<FragtSettings>(FRAGT_MODULE_ID);
  if (einstellungen.autoPublishResults) {
    await meldeErgebnis(abstimmung, ergebnis, einstellungen, gateway).catch((fehler) => {
      log.warn('Ergebnismeldung liess sich nicht senden', { abstimmungId, fehler });
    });
  }

  await erstelleEntwurf(abstimmung, ergebnis).catch((fehler) => {
    log.warn('Social-Media-Entwurf liess sich nicht anlegen', { abstimmungId, fehler });
  });

  log.info('Abstimmung geschlossen', {
    abstimmungId,
    stimmen: ergebnis.gesamt,
    gewinner: ergebnis.gewinner?.label ?? null,
    gleichstand: ergebnis.gleichstand.length,
  });

  return { art: 'geschlossen', abstimmung, ergebnis };
}

/** Von Hand schliessen - mit Audit-Eintrag. */
export async function schliesseVonHand(
  abstimmungId: string,
  actor: Handelnder,
  jetzt = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<SchliessErgebnis> {
  const ausgang = await schliesse(abstimmungId, jetzt, gateway);
  if (ausgang.art === 'war-schon-zu') {
    throw new AppError('CONFLICT', { userMessage: 'Diese Abstimmung ist bereits geschlossen.' });
  }

  await recordAudit({
    action: AUDIT_ACTIONS.FRAGT_POLL_CLOSED_MANUALLY,
    module: FRAGT_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username ?? null,
    targetLabel: ausgang.abstimmung.frageText,
    metadata: {
      abstimmungId,
      stimmen: ausgang.ergebnis.gesamt,
      vorzeitig: jetzt < ausgang.abstimmung.closesAt,
    },
  });

  return ausgang;
}

/**
 * Das Embed der Frage durch das Ergebnis ersetzen - und die Buttons entfernen.
 *
 * Dieselbe Nachricht, nicht eine neue: im Kanal soll nicht die alte Frage mit
 * klickbaren Knoepfen neben ihrem eigenen Ergebnis stehen.
 */
async function aktualisiereNachricht(
  abstimmung: FragtAbstimmung,
  ergebnis: Ergebnis,
  gateway: DiscordGateway,
): Promise<void> {
  if (!abstimmung.messageId) {
    return;
  }
  await gateway.channels.edit(abstimmung.channelId, abstimmung.messageId, {
    embeds: [ergebnisEmbed({ frageText: abstimmung.frageText, untertitel: abstimmung.untertitel }, ergebnis)],
    // Leere Liste, nicht weggelassen: Discord loescht die Komponenten nur,
    // wenn das Feld ausdruecklich leer mitkommt.
    components: [],
  });
}

/** Das Ergebnis als eigener Beitrag - einmal, und nur wenn gewuenscht. */
async function meldeErgebnis(
  abstimmung: FragtAbstimmung,
  ergebnis: Ergebnis,
  einstellungen: FragtSettings,
  gateway: DiscordGateway,
): Promise<void> {
  if (abstimmung.ergebnisMessageId) {
    return;
  }

  const kanal = einstellungen.resultChannelId ?? abstimmung.channelId;
  /*
   * Steht die Ergebnismeldung im selben Kanal wie die Frage, entfaellt sie.
   *
   * Die Nachricht der Frage zeigt dort schon das Ergebnis - ein zweiter
   * Beitrag daneben waere dasselbe zweimal. Nur ein eigener Ergebniskanal
   * bekommt eine eigene Meldung.
   */
  if (kanal === abstimmung.channelId) {
    return;
  }

  const erwaehnung =
    einstellungen.resultMention === 'here'
      ? '@here'
      : einstellungen.resultMention === 'rolle' && einstellungen.resultMentionRoleId
        ? `<@&${einstellungen.resultMentionRoleId}>`
        : null;

  const meldung = ergebnisMeldung(
    { frageText: abstimmung.frageText, untertitel: abstimmung.untertitel },
    ergebnis,
    erwaehnung,
  );

  const gesendet = await gateway.channels.send(kanal, {
    ...meldung,
    /*
     * Pings nur dort, wo sie ausdruecklich eingestellt sind.
     *
     * Ohne `allowedMentions` unterdrueckt das Gateway alles - das ist die
     * Vorgabe und richtig so. Hier steht, was die Einstellung erlaubt, und
     * sonst nichts.
     */
    ...(einstellungen.resultMention === 'here'
      ? { allowedMentions: { parse: ['everyone' as const] } }
      : einstellungen.resultMention === 'rolle' && einstellungen.resultMentionRoleId
        ? {
            allowedMentions: {
              parse: [] as Array<'users' | 'roles' | 'everyone'>,
              roles: [einstellungen.resultMentionRoleId],
            },
          }
        : {}),
  });

  await prisma.fragtAbstimmung.updateMany({
    where: { id: abstimmung.id, ergebnisMessageId: null },
    data: { ergebnisMessageId: gesendet.id },
  });
}

/**
 * Das Embed einer laufenden Abstimmung neu zeichnen.
 *
 * Nur noetig, wenn der Zwischenstand oeffentlich ist - sonst aendert sich am
 * Embed durch eine Stimme nichts, und eine Anfrage bei Discord je Klick waere
 * bei einer gut laufenden Frage ein Rate Limit.
 */
export async function aktualisiereZwischenstand(
  abstimmungId: string,
  gateway: DiscordGateway = defaultDiscord,
): Promise<void> {
  const abstimmung = await prisma.fragtAbstimmung.findUnique({ where: { id: abstimmungId } });
  if (!abstimmung?.messageId || !abstimmung.zwischenstandSichtbar || abstimmung.status !== 'ACTIVE') {
    return;
  }

  const [ergebnis, optionen] = await Promise.all([
    zaehleStimmen(abstimmungId),
    prisma.fragtOption.findMany({
      where: { frage: { abstimmungen: { some: { id: abstimmungId } } } },
      orderBy: { position: 'asc' },
    }),
  ]);

  const { embed, komponenten } = frageEmbed(
    {
      abstimmungId: abstimmung.id,
      frageText: abstimmung.frageText,
      untertitel: abstimmung.untertitel,
      optionen: optionen.map((option) => ({
        id: option.id,
        label: option.label,
        position: option.position,
      })),
      closesAt: abstimmung.closesAt,
    },
    ergebnis,
  );

  await gateway.channels.edit(abstimmung.channelId, abstimmung.messageId, {
    embeds: [embed],
    components: komponenten,
  });
}

/** Die laufende Abstimmung - hoechstens eine je Server. */
export async function laufendeAbstimmung(guildId: string): Promise<FragtAbstimmung | null> {
  return prisma.fragtAbstimmung.findFirst({
    where: { guildId, status: 'ACTIVE' },
    orderBy: { opensAt: 'desc' },
  });
}
