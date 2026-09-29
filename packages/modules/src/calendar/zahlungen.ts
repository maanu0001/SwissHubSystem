import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarEvent, CalendarPaymentStatus, CalendarRegistration } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict } from '@swisshub/shared';
import { CONTENT_TYPE, deleteUpload, readUpload, storeLogoUpload } from '../branding/storage';
import { CALENDAR_MODULE_ID, CALENDAR_PERMISSIONS } from './config';
import { requireEvent } from './service';
import type { CalendarActor } from './schemas';

/**
 * Wie gross ein QR-Code hoechstens sein darf.
 *
 * Zwei Megabyte sind fuer einen QR-Code reichlich - ein PNG mit 1000 Pixeln
 * Kantenlaenge wiegt ein paar Dutzend Kilobyte. Wer mehr hochlaedt, hat ein
 * Foto ausgewaehlt und keinen Code.
 */
export const MAX_QR_BYTES = 2 * 1024 * 1024;

const logger = createLogger('calendar:zahlungen');

/**
 * Eintritt, TWINT und die manuelle Bestätigung.
 *
 * ## Die eine Regel, aus der alles andere folgt
 *
 * **SwissHub sieht keine Kontobewegung.** Es gibt keine Schnittstelle zur
 * Bank, keinen Rückkanal von TWINT und keinen Weg, an dem eine Zahlung
 * ankäme. Was es gibt, ist ein Bild mit einem QR-Code und ein Mensch, der
 * nachher aufs Konto schaut.
 *
 * Daraus folgt alles Weitere:
 *
 *  - Es gibt **keinen** Übergang von `PENDING` nach `VERIFIED`, der nicht
 *    durch `bestaetigeZahlung` führt, und die verlangt eine berechtigte
 *    Person. Kein Zeitablauf, kein Durchgang, keine Anmeldung setzt ihn.
 *  - Eine Anmeldung, die einen Preis trägt, ist **vorläufig**. Sie hält
 *    einen Platz - aber sie sagt nirgends «bezahlt».
 *  - «Erlassen» ist nicht «bezahlt». Zwei verschiedene Werte, weil es zwei
 *    verschiedene Sachverhalte sind: beim einen ist Geld gekommen, beim
 *    anderen wurde auf welches verzichtet. Wer beides gleich führt, sucht
 *    später in der Kasse nach einem Betrag, den nie jemand geschickt hat.
 *
 * ## Warum der Platz schon bei PENDING reserviert ist
 *
 * Weil die Reihenfolge sonst grausam wäre: bezahlen, und danach erfahren,
 * dass der Abend voll ist. Die Anmeldung belegt den Platz sofort - über den
 * bestehenden `CalendarRegistrationStatus`, an dem sich nichts geändert hat -
 * und der Zahlungsstatus sagt daneben, ob die Teilnahme schon definitiv ist.
 *
 * ## Was geschieht, wenn ein Termin nachträglich Geld kostet
 *
 * Nichts - für die, die schon angemeldet sind. Ihr Zahlungsstand bleibt
 * `NOT_REQUIRED`, weil er zu dem Zeitpunkt richtig war: sie haben sich für
 * einen kostenlosen Abend eingetragen. Sie rückwirkend auf `PENDING` zu
 * setzen hiesse, von Leuten Geld zu verlangen, die keines zugesagt haben,
 * und die Liste zeigte eine offene Forderung, die niemand gestellt hat.
 *
 * Wer das doch will, schreibt die Betroffenen an - das ist eine
 * Unterhaltung und keine Datenbankoperation.
 */

/** Was die Übersicht an Zahlen braucht. */
export interface ZahlungsKennzahlen {
  /** Alle Anmeldungen, die einen Platz oder einen Wartelistenplatz haben. */
  angemeldet: number;
  ausstehend: number;
  bestaetigt: number;
  erlassen: number;
  storniert: number;
  erstattet: number;
  /** Summe der bestätigten Beträge in Rappen. Erlassene zählen nicht mit. */
  eingegangenRappen: number;
  /** Summe der noch ausstehenden Beträge in Rappen. */
  offenRappen: number;
}

export interface ZahlungsZeile {
  registrationId: string;
  discordId: string;
  name: string;
  status: CalendarRegistration['status'];
  waitlistPosition: number | null;
  registeredAt: Date;
  betragRappen: number;
  waehrung: string;
  zahlung: CalendarPaymentStatus;
  verifiedAt: Date | null;
  verifiedByUsername: string | null;
  grund: string | null;
}

/** Wer verwaltet - und was er darf. */
export interface ZahlungsActor extends CalendarActor {
  can(permission: string): boolean;
}

/**
 * Ein Betrag in Rappen als Text.
 *
 * `CHF 15.–` wenn es glatt aufgeht, `CHF 15.50` sonst. Die Schreibweise mit
 * dem Gedankenstrich ist die schweizerische; sie steht hier und nicht in
 * jeder Komponente einzeln, damit der Preis im Formular, in der Anmeldung
 * und in der Teilnehmerliste gleich aussieht.
 */
export function betragText(rappen: number, waehrung = 'CHF'): string {
  const ganz = Math.trunc(rappen / 100);
  const rest = Math.abs(rappen % 100);
  return rest === 0
    ? `${waehrung} ${ganz.toLocaleString('de-CH')}.–`
    : `${waehrung} ${ganz.toLocaleString('de-CH')}.${String(rest).padStart(2, '0')}`;
}

/** Kostet dieser Termin etwas? Die eine Stelle, an der das entschieden wird. */
export function kostenpflichtig(event: Pick<CalendarEvent, 'entryFeeEnabled' | 'entryFeeCents'>): boolean {
  return event.entryFeeEnabled && event.entryFeeCents > 0;
}

/**
 * Der Zahlungsstatus, mit dem eine frische Anmeldung startet.
 *
 * Bei einem kostenpflichtigen Termin `PENDING` - ausdrücklich nicht
 * `VERIFIED`, und das ist der ganze Punkt: die Anmeldung allein beweist
 * nichts über eine Zahlung.
 */
export function startStatus(
  event: Pick<CalendarEvent, 'entryFeeEnabled' | 'entryFeeCents'>,
): CalendarPaymentStatus {
  return kostenpflichtig(event) ? 'PENDING' : 'NOT_REQUIRED';
}

/** Gilt die Teilnahme als definitiv? */
export function teilnahmeDefinitiv(
  registration: Pick<CalendarRegistration, 'status' | 'paymentStatus'>,
): boolean {
  if (registration.status !== 'CONFIRMED') {
    return false;
  }
  return (
    registration.paymentStatus === 'NOT_REQUIRED' ||
    registration.paymentStatus === 'VERIFIED' ||
    registration.paymentStatus === 'WAIVED'
  );
}

function verlange(actor: ZahlungsActor, permission: string, was: string): void {
  if (!actor.can(permission)) {
    throw new AppError('FORBIDDEN', {
      userMessage: `Du darfst ${was} nicht.`,
      internalMessage: `calendar: ${actor.discordId} ohne ${permission}`,
    });
  }
}

async function ladeAnmeldung(registrationId: string): Promise<
  CalendarRegistration & {
    event: Pick<CalendarEvent, 'id' | 'title' | 'slug' | 'entryFeeCurrency'>;
  }
> {
  const zeile = await prisma.calendarRegistration.findUnique({
    where: { id: registrationId },
    include: { event: { select: { id: true, title: true, slug: true, entryFeeCurrency: true } } },
  });
  if (!zeile) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Anmeldung gibt es nicht.' });
  }
  return zeile;
}

/**
 * Die Zahlung einer Anmeldung bestätigen.
 *
 * ## Warum das eine bedingte Aktualisierung ist
 *
 * Zwei Admins schauen zur selben Zeit auf dieselbe Liste und drücken beide.
 * Ein Vorher-Lesen entschiede dieses Rennen nicht - beide läsen `PENDING`,
 * beide schrieben `VERIFIED`, und im Protokoll stünde zweimal dieselbe
 * Bestätigung mit zwei verschiedenen Namen. Die Bedingung im `updateMany`
 * entscheidet es: wer den Status als Erster von `PENDING` wegsetzt, hat
 * bestätigt, und genau einer kommt durch.
 *
 * ## Warum ein zweiter Aufruf trotzdem gutgeht
 *
 * Er meldet «war schon bestätigt» statt eines Fehlers. Für die aufrufende
 * Person hat sich der gewünschte Zustand eingestellt; ihr eine rote Meldung
 * zu zeigen, weil eine Kollegin schneller war, hilft niemandem.
 */
export interface ZahlungsErgebnis {
  registration: CalendarRegistration;
  /** `false`, wenn der Status schon vorher so war. */
  geaendert: boolean;
}

export async function bestaetigeZahlung(
  actor: ZahlungsActor,
  registrationId: string,
  jetzt = new Date(),
): Promise<ZahlungsErgebnis> {
  verlange(actor, CALENDAR_PERMISSIONS.paymentsVerify, 'Zahlungen bestätigen');
  const vorher = await ladeAnmeldung(registrationId);

  if (vorher.paymentStatus === 'VERIFIED') {
    return { registration: vorher, geaendert: false };
  }
  if (vorher.paymentStatus === 'NOT_REQUIRED') {
    throw conflict('Für dieses Event wird kein Eintritt erhoben - es gibt nichts zu bestätigen.');
  }
  if (vorher.status === 'CANCELLED') {
    throw conflict('Diese Anmeldung ist storniert. Bitte zuerst die Teilnahme wiederherstellen.');
  }

  const { count } = await prisma.calendarRegistration.updateMany({
    where: { id: registrationId, paymentStatus: vorher.paymentStatus },
    data: {
      paymentStatus: 'VERIFIED',
      paymentVerifiedAt: jetzt,
      paymentVerifiedByDiscordId: actor.discordId,
      paymentVerifiedByUsername: actor.username,
      paymentReason: null,
    },
  });
  if (count !== 1) {
    // Jemand war schneller. Der gewuenschte Zustand steht - mehr wollte der
    // Aufrufer nicht.
    return { registration: await ladeAnmeldung(registrationId), geaendert: false };
  }

  const nachher = await ladeAnmeldung(registrationId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PAYMENT_VERIFIED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: nachher.discordId,
    targetLabel: nachher.displayName ?? nachher.username ?? nachher.discordId,
    success: true,
    /*
     * Betrag und Termin - sonst nichts. Keine Kontonummer, keine Referenz,
     * kein Zahlungsbeleg: was hier steht, ist «wer hat wann bestaetigt, dass
     * fuer diesen Termin so viel eingegangen ist».
     */
    metadata: {
      eventId: nachher.eventId,
      eventTitel: nachher.event.title,
      registrationId,
      betragRappen: nachher.paymentAmountCents,
      waehrung: nachher.paymentCurrency ?? nachher.event.entryFeeCurrency,
      vorher: vorher.paymentStatus,
    },
  });
  logger.info('calendar.payment.verified', { registrationId, eventId: nachher.eventId });

  await meldeBestaetigung(nachher, 'VERIFIED', actor);
  return { registration: nachher, geaendert: true };
}

/**
 * Die Teilnahme ohne Zahlung freigeben.
 *
 * Crew, Sponsor, Gast, Gewinn - es gibt genug Gründe, jemanden hereinzulassen,
 * ohne dass Geld fliesst. Was es nicht gibt, ist ein Grund, das als «bezahlt»
 * zu führen: `WAIVED` ist ein eigener Wert, er steht in der Liste als
 * «erlassen», und er zählt in keiner Summe der eingegangenen Beträge mit.
 */
export async function erlasseZahlung(
  actor: ZahlungsActor,
  registrationId: string,
  grund: string | null,
  jetzt = new Date(),
): Promise<ZahlungsErgebnis> {
  verlange(actor, CALENDAR_PERMISSIONS.paymentsWaive, 'Zahlungen erlassen');
  const vorher = await ladeAnmeldung(registrationId);

  if (vorher.paymentStatus === 'WAIVED') {
    return { registration: vorher, geaendert: false };
  }
  if (vorher.paymentStatus === 'NOT_REQUIRED') {
    throw conflict('Für dieses Event wird kein Eintritt erhoben - es gibt nichts zu erlassen.');
  }

  const { count } = await prisma.calendarRegistration.updateMany({
    where: { id: registrationId, paymentStatus: vorher.paymentStatus },
    data: {
      paymentStatus: 'WAIVED',
      paymentVerifiedAt: jetzt,
      paymentVerifiedByDiscordId: actor.discordId,
      paymentVerifiedByUsername: actor.username,
      paymentReason: grund?.slice(0, 200) ?? null,
    },
  });
  if (count !== 1) {
    return { registration: await ladeAnmeldung(registrationId), geaendert: false };
  }

  const nachher = await ladeAnmeldung(registrationId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PAYMENT_WAIVED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: nachher.discordId,
    targetLabel: nachher.displayName ?? nachher.username ?? nachher.discordId,
    success: true,
    metadata: {
      eventId: nachher.eventId,
      eventTitel: nachher.event.title,
      registrationId,
      betragRappen: nachher.paymentAmountCents,
      grund: nachher.paymentReason,
      vorher: vorher.paymentStatus,
    },
  });
  logger.info('calendar.payment.waived', { registrationId, eventId: nachher.eventId });

  await meldeBestaetigung(nachher, 'WAIVED', actor);
  return { registration: nachher, geaendert: true };
}

/**
 * Eine Bestätigung oder einen Erlass zurücknehmen.
 *
 * Jemand hat auf den falschen Knopf gedrückt, oder die Zahlung ging zurück.
 * Der Weg dahin ist ausdrücklich vorgesehen und ausdrücklich protokolliert -
 * eine stille Statusänderung gibt es nicht, und `zielStatus` entscheidet, ob
 * daraus wieder eine offene Zahlung wird oder eine Erstattung.
 */
export async function nimmBestaetigungZurueck(
  actor: ZahlungsActor,
  registrationId: string,
  zielStatus: 'PENDING' | 'REFUNDED',
  grund: string | null,
): Promise<ZahlungsErgebnis> {
  verlange(actor, CALENDAR_PERMISSIONS.paymentsRevoke, 'Zahlungsbestätigungen zurücknehmen');
  const vorher = await ladeAnmeldung(registrationId);

  if (vorher.paymentStatus !== 'VERIFIED' && vorher.paymentStatus !== 'WAIVED') {
    throw conflict('Diese Anmeldung ist nicht bestätigt - es gibt nichts zurückzunehmen.');
  }

  const { count } = await prisma.calendarRegistration.updateMany({
    where: { id: registrationId, paymentStatus: vorher.paymentStatus },
    data: {
      paymentStatus: zielStatus,
      /*
       * Wer und wann bleiben stehen.
       *
       * Sie auf NULL zu setzen hiesse, die Spur zu verwischen: dass diese
       * Anmeldung einmal bestaetigt war und von wem, ist genau die Auskunft,
       * die man bei einer Ruecknahme braucht. Was der aktuelle Stand ist,
       * sagt `paymentStatus`.
       */
      paymentReason: grund?.slice(0, 200) ?? null,
    },
  });
  if (count !== 1) {
    return { registration: await ladeAnmeldung(registrationId), geaendert: false };
  }

  const nachher = await ladeAnmeldung(registrationId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PAYMENT_REVOKED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: nachher.discordId,
    targetLabel: nachher.displayName ?? nachher.username ?? nachher.discordId,
    success: true,
    metadata: {
      eventId: nachher.eventId,
      eventTitel: nachher.event.title,
      registrationId,
      vorher: vorher.paymentStatus,
      nachher: zielStatus,
      grund: nachher.paymentReason,
    },
  });
  logger.info('calendar.payment.revoked', { registrationId, vorher: vorher.paymentStatus, zielStatus });
  return { registration: nachher, geaendert: true };
}

/**
 * Die bestätigte Person benachrichtigen - über das, was schon da ist.
 *
 * Kein eigener Versand, keine zweite Nachrichtenmaschine: das Ereignis geht
 * in die bestehende Automation, und ob daraus eine Discord-Nachricht wird,
 * entscheidet, wer dort eine Regel angelegt hat. Ohne Regel geschieht nichts,
 * und das ist richtig - eine erzwungene Nachricht an jeden Bestätigten wäre
 * eine Entscheidung, die dieses Modul nicht zu treffen hat.
 *
 * Wirft nie: eine Bestätigung ist gültig, auch wenn die Meldung darüber
 * scheitert.
 */
async function meldeBestaetigung(
  registration: CalendarRegistration & { event: { title: string; slug: string } },
  art: 'VERIFIED' | 'WAIVED',
  actor: ZahlungsActor,
): Promise<void> {
  try {
    const { meldeEreignis } = await import('../automation/emit');
    const event = await prisma.calendarEvent.findUnique({
      where: { id: registration.eventId },
      select: { guildId: true },
    });
    await meldeEreignis(
      'calendar.payment_verified',
      {
        eventId: registration.eventId,
        registrationId: registration.id,
        discordId: registration.discordId,
        titel: registration.event.title,
        slug: registration.event.slug,
        art,
        betragRappen: registration.paymentAmountCents,
      },
      {
        ...(event?.guildId ? { guildId: event.guildId } : {}),
        actorId: actor.discordId,
        subjectId: registration.discordId,
        entityId: registration.eventId,
      },
    );
  } catch (error) {
    logger.warn('calendar.payment.notify_failed', { registrationId: registration.id, error });
  }
}

/**
 * Die Kennzahlen über der Teilnehmerliste.
 *
 * Als Gruppierung in der Datenbank und nicht als sechs Zählungen: sechs
 * Abfragen für sechs Zahlen über derselben Tabelle sind fünf zu viel.
 */
export async function zahlungsKennzahlen(eventId: string): Promise<ZahlungsKennzahlen> {
  const zeilen = await prisma.calendarRegistration.findMany({
    where: { eventId },
    select: { status: true, paymentStatus: true, paymentAmountCents: true },
  });

  const kennzahlen: ZahlungsKennzahlen = {
    angemeldet: 0,
    ausstehend: 0,
    bestaetigt: 0,
    erlassen: 0,
    storniert: 0,
    erstattet: 0,
    eingegangenRappen: 0,
    offenRappen: 0,
  };

  for (const zeile of zeilen) {
    if (zeile.status === 'CANCELLED') {
      kennzahlen.storniert += 1;
      // Eine stornierte Anmeldung zaehlt weder als angemeldet noch als offen:
      // von ihr erwartet niemand mehr Geld.
      continue;
    }
    kennzahlen.angemeldet += 1;

    switch (zeile.paymentStatus) {
      case 'PENDING':
        kennzahlen.ausstehend += 1;
        kennzahlen.offenRappen += zeile.paymentAmountCents;
        break;
      case 'VERIFIED':
        kennzahlen.bestaetigt += 1;
        kennzahlen.eingegangenRappen += zeile.paymentAmountCents;
        break;
      case 'WAIVED':
        // Zaehlt als freigegeben, aber ausdruecklich nicht als eingegangen.
        kennzahlen.erlassen += 1;
        break;
      case 'REFUNDED':
        kennzahlen.erstattet += 1;
        break;
      default:
        break;
    }
  }
  return kennzahlen;
}

/** Die Filter der Zahlungsübersicht. */
export type ZahlungsFilter = 'alle' | 'ausstehend' | 'bestaetigt' | 'erlassen' | 'storniert' | 'erstattet';

/**
 * Die Anmeldungen eines Termins mit ihrem Zahlungsstand.
 *
 * ## Warum das nicht die öffentliche Teilnehmerliste ist
 *
 * Weil hier Angaben stehen, die niemanden ausser der Organisation etwas
 * angehen: wer noch nicht bezahlt hat, wer freigestellt wurde und warum. Die
 * öffentliche Liste bleibt, was sie war - Namen und sonst nichts. Wer diese
 * Funktion aufruft, hat vorher `paymentsView` geprüft; sie ist kein Ersatz
 * dafür, aber sie ist auch nirgends an eine Seite gebunden, die ohne
 * Prüfung erreichbar wäre.
 */
export async function ladeZahlungsliste(
  eventId: string,
  optionen: { filter?: ZahlungsFilter; suche?: string } = {},
): Promise<ZahlungsZeile[]> {
  const filter = optionen.filter ?? 'alle';
  const suche = optionen.suche?.trim().toLowerCase() ?? '';

  const zeilen = await prisma.calendarRegistration.findMany({
    where: {
      eventId,
      ...(filter === 'storniert' ? { status: 'CANCELLED' } : {}),
      ...(filter === 'ausstehend' ? { status: { not: 'CANCELLED' }, paymentStatus: 'PENDING' } : {}),
      ...(filter === 'bestaetigt' ? { status: { not: 'CANCELLED' }, paymentStatus: 'VERIFIED' } : {}),
      ...(filter === 'erlassen' ? { status: { not: 'CANCELLED' }, paymentStatus: 'WAIVED' } : {}),
      ...(filter === 'erstattet' ? { paymentStatus: 'REFUNDED' } : {}),
    },
    orderBy: [{ status: 'asc' }, { registeredAt: 'asc' }],
    include: { event: { select: { entryFeeCurrency: true } } },
  });

  return zeilen
    .map((zeile) => ({
      registrationId: zeile.id,
      discordId: zeile.discordId,
      name: zeile.displayName ?? zeile.username ?? zeile.discordId,
      status: zeile.status,
      waitlistPosition: zeile.waitlistPosition,
      registeredAt: zeile.registeredAt,
      betragRappen: zeile.paymentAmountCents,
      waehrung: zeile.paymentCurrency ?? zeile.event.entryFeeCurrency,
      zahlung: zeile.paymentStatus,
      verifiedAt: zeile.paymentVerifiedAt,
      verifiedByUsername: zeile.paymentVerifiedByUsername,
      grund: zeile.paymentReason,
    }))
    .filter((zeile) => {
      if (!suche) {
        return true;
      }
      /*
       * Gesucht wird im Anzeigenamen, im Benutzernamen und in der Kennung.
       *
       * In JavaScript und nicht in der Datenbank: es geht um die Teilnehmer
       * eines Abends, also um Dutzende und nicht um Zehntausende. Eine
       * Volltextspalte dafuer anzulegen waere Aufwand fuer eine Liste, die
       * auf einen Bildschirm passt.
       */
      return zeile.name.toLowerCase().includes(suche) || zeile.discordId.includes(suche);
    });
}

// ---------------------------------------------------------------------------
// Der TWINT-QR-Code
// ---------------------------------------------------------------------------

/**
 * Den QR-Code eines Termins speichern.
 *
 * Nutzt dieselbe Ablage wie Logo, Spielcover und Profilbanner: Dateiname
 * serverseitig erzeugt, Format an den echten Bytes erkannt, Verzeichnis
 * ausserhalb des statisch bedienten Bereichs. Kein SVG - eine SVG-Datei kann
 * Skripte enthalten, und solange niemand sie zuverlässig bereinigt, ist das
 * Weglassen die ehrlichere Lösung. Kein PDF: ein QR-Code, den man mit dem
 * Telefon scannt, muss ein Bild sein.
 */
export async function speichereZahlungsQr(
  actor: ZahlungsActor,
  eventId: string,
  data: Uint8Array,
  declaredMimeType: string | null,
): Promise<{ fileName: string }> {
  verlange(actor, CALENDAR_PERMISSIONS.paymentsManage, 'die Zahlungsangaben dieses Events ändern');
  const event = await requireEvent(eventId);

  const gespeichert = await storeLogoUpload(data, declaredMimeType, 'twintqr', {
    maxBytes: MAX_QR_BYTES,
    // Ein QR-Code unter 120 Pixeln ist auf einem Telefon nicht mehr zu
    // scannen; ueber 4096 ist er ein Foto und kein Code.
    minSize: 120,
    maxSize: 4096,
  });

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: { paymentQrPath: gespeichert.fileName },
  });

  if (event.paymentQrPath && event.paymentQrPath !== gespeichert.fileName) {
    await deleteUpload(event.paymentQrPath).catch((error: unknown) =>
      logger.warn('calendar.qr.old_delete_failed', { eventId, error }),
    );
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PAYMENT_SETTINGS_CHANGED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId, geaendert: ['twintQr'], bytes: gespeichert.bytes, format: gespeichert.format },
  });
  return { fileName: gespeichert.fileName };
}

/** Den QR-Code wieder entfernen. */
export async function entferneZahlungsQr(actor: ZahlungsActor, eventId: string): Promise<void> {
  verlange(actor, CALENDAR_PERMISSIONS.paymentsManage, 'die Zahlungsangaben dieses Events ändern');
  const event = await requireEvent(eventId);
  if (!event.paymentQrPath) {
    return;
  }

  await prisma.calendarEvent.update({ where: { id: eventId }, data: { paymentQrPath: null } });
  await deleteUpload(event.paymentQrPath).catch(() => undefined);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_PAYMENT_SETTINGS_CHANGED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: event.title,
    success: true,
    metadata: { eventId, geaendert: ['twintQr'], entfernt: true },
  });
}

/**
 * Den QR-Code lesen.
 *
 * `null`, wenn keiner hinterlegt ist oder die Datei fehlt - etwa nach einem
 * neu angelegten Upload-Volume. Die Oberfläche zeigt dann die Hinweise ohne
 * Bild statt eines kaputten Rahmens.
 */
export async function leseZahlungsQr(eventId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { paymentQrPath: true },
  });
  if (!event?.paymentQrPath) {
    return null;
  }
  const datei = await readUpload(event.paymentQrPath);
  if (!datei) {
    logger.warn('calendar.qr.missing_on_disk', { eventId });
    return null;
  }
  return { data: datei.data, contentType: CONTENT_TYPE[datei.format] };
}
