import { randomBytes } from 'node:crypto';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarTicket, CalendarTicketStatus, Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict } from '@swisshub/shared';
import { CALENDAR_MODULE_ID, CALENDAR_PERMISSIONS } from './config';
import type { CalendarActor } from './schemas';

const logger = createLogger('calendar:tickets');

/**
 * Tickets - wer tatsächlich kommt.
 *
 * ## Die Trennung, um die es geht
 *
 * Eine `CalendarRegistration` ist ab jetzt die **Bestellung**: wer bestellt
 * hat, wie viele Plätze, was es kostet, ob bezahlt wurde. Ein
 * `CalendarTicket` ist eine **Person**, die kommt.
 *
 * Das ist keine Formalie. Vorher war beides dieselbe Zeile, und wer jemanden
 * mitbringen wollte, hatte keinen Ort dafür. Der naheliegende Ausweg wäre ein
 * Feld `plusOneName` gewesen - und der zweite Schritt `plusTwoName`. Danach
 * ist «wie viele kommen?» keine Abfrage mehr, sondern eine Fallunterscheidung,
 * und «wer ist Gast A?» gar nicht mehr beantwortbar.
 *
 * ## Mitglied oder Gast
 *
 * Genau eines von beidem. Für einen Gast wird **kein** Konto angelegt, keine
 * Discord-Kennung erfunden und kein Platzhaltermitglied erzeugt: ein Gast ist
 * ein Name auf einer Liste, und mehr behauptet das Datenmodell nicht über ihn.
 *
 * ## Was am Ticket hängt und was an der Bestellung
 *
 * Bezahlt wird die **Bestellung** - eine Zahlung, ein Betrag, eine
 * Bestätigung. Eingecheckt wird das **Ticket**: drei Leute derselben
 * Bestellung treffen zu drei verschiedenen Zeiten ein, und der Einlass muss
 * einzeln abhaken können.
 */

/** Höchstens so viele Tickets je Bestellung. */
export const MAX_TICKETS_JE_BESTELLUNG = 10;

/**
 * Der Ausweis eines Tickets.
 *
 * 32 zufällige Bytes als Hex - 64 Zeichen aus `randomBytes`, also aus der
 * Zufallsquelle des Betriebssystems und nicht aus `Math.random`. Wer ihn hat,
 * hat das Ticket; deshalb darf er sich weder hochzählen noch aus der
 * Bestellnummer ableiten lassen.
 *
 * Ausdrücklich getrennt vom TWINT-Code: der bezahlt, dieser lässt ein.
 */
export function ticketToken(): string {
  return randomBytes(32).toString('hex');
}

/** Eine Person, die kommt - so, wie sie ins Formular eingegeben wird. */
export interface TicketEingabe {
  /** Gesetzt, wenn das Ticket einem Mitglied gehört. */
  memberDiscordId?: string | null;
  memberUsername?: string | null;
  guestFirstName?: string | null;
  guestLastName?: string | null;
  guestEmail?: string | null;
  guestDiscordName?: string | null;
  note?: string | null;
}

/**
 * Der Name, unter dem ein Ticket in Listen steht.
 *
 * Beim Mitglied der gespeicherte Anzeigename, beim Gast Vor- und Nachname.
 * Fällt beides aus, bleibt die Kennung - einen Namen zu erfinden wäre
 * schlimmer als keiner.
 */
export function ticketName(ticket: {
  memberDiscordId: string | null;
  memberUsername: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
}): string {
  if (ticket.memberDiscordId) {
    return ticket.memberUsername ?? ticket.memberDiscordId;
  }
  return [ticket.guestFirstName, ticket.guestLastName].filter(Boolean).join(' ') || 'Gast';
}

/** Mitglied oder Gast - die eine Unterscheidung, die überall auftaucht. */
export function ticketArt(ticket: { memberDiscordId: string | null }): 'MITGLIED' | 'GAST' {
  return ticket.memberDiscordId ? 'MITGLIED' : 'GAST';
}

/**
 * Eine Ticketeingabe in das, was in die Datenbank geht.
 *
 * Wirft, wenn weder Mitglied noch Gastname da ist. Das prüft auch das
 * Eingabeschema - hier steht es ein zweites Mal, weil diese Funktion auch aus
 * dem Bot oder einem Skript aufgerufen werden kann und dann allein dasteht.
 */
export function ticketDaten(
  eingabe: TicketEingabe,
  position: number,
): Omit<Prisma.CalendarTicketUncheckedCreateInput, 'registrationId' | 'eventId'> {
  const mitglied = eingabe.memberDiscordId?.trim() || null;
  const vorname = eingabe.guestFirstName?.trim() || null;

  if (!mitglied && !vorname) {
    throw conflict('Bitte für jedes Ticket entweder ein Mitglied oder einen Gastnamen angeben.');
  }

  return {
    token: ticketToken(),
    position,
    status: 'ACTIVE',
    memberDiscordId: mitglied,
    memberUsername: mitglied ? (eingabe.memberUsername?.trim().slice(0, 64) ?? null) : null,
    /*
     * Gastfelder nur beim Gast.
     *
     * Ein Ticket, das einem Mitglied gehoert und daneben einen Gastnamen
     * traegt, waere zwei Personen in einer Zeile - und die Liste zeigte
     * irgendwann die falsche.
     */
    guestFirstName: mitglied ? null : vorname,
    guestLastName: mitglied ? null : eingabe.guestLastName?.trim().slice(0, 80) || null,
    guestEmail: mitglied ? null : eingabe.guestEmail?.trim().slice(0, 200) || null,
    guestDiscordName: mitglied ? null : eingabe.guestDiscordName?.trim().slice(0, 64) || null,
    note: eingabe.note?.trim().slice(0, 300) || null,
  };
}

/** Die Zustände, die einen Platz belegen. */
export const BELEGENDE_TICKETS: CalendarTicketStatus[] = ['ACTIVE'];

/**
 * Wie viele Plätze ein Termin gerade belegt hat.
 *
 * Gezählt werden **Tickets**, nicht Bestellungen: fünfzig Bestellungen können
 * achtzig Tickets enthalten. Und nur die einer Bestellung, die einen Platz
 * hält - eine stornierte Anmeldung belegt nichts, eine auf der Warteliste
 * noch nicht.
 *
 * Nimmt wahlweise eine Transaktion entgegen. Die Kapazitätsprüfung ruft sie
 * unter der Zeilensperre des Termins auf; ausserhalb wäre die Zahl in dem
 * Moment veraltet, in dem sie zurückkommt.
 */
export async function belegteTickets(
  eventId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return tx.calendarTicket.count({
    where: {
      eventId,
      status: 'ACTIVE',
      registration: { status: 'CONFIRMED' },
    },
  });
}

/** Wie viele Tickets auf der Warteliste stehen. */
export async function wartendeTickets(
  eventId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return tx.calendarTicket.count({
    where: { eventId, status: 'ACTIVE', registration: { status: 'WAITLIST' } },
  });
}

/**
 * Die definitiven Teilnehmer eines Termins.
 *
 * ## Was «definitiv» heisst
 *
 * Ein Ticket ist aktiv, seine Bestellung hält einen Platz, **und** die
 * Zahlung ist erledigt - entweder weil sie bestätigt wurde, weil sie erlassen
 * wurde, oder weil der Termin nichts kostet.
 *
 * Ausdrücklich **nicht** dabei: `PENDING`. Eine Anmeldung, auf die noch
 * niemand geschaut hat, ist eine Reservierung und keine Zusage. Ebenso wenig
 * `REFUNDED` - wer sein Geld zurückbekommen hat, kommt nicht.
 *
 * ## Warum das eine eigene Zahl ist
 *
 * Weil «Teilnehmer» bisher drei Dinge bedeuten konnte: belegte Plätze,
 * Bestellungen, tatsächlich zugesagte Leute. Wer am Abend Stühle stellt,
 * braucht die dritte Zahl, und wer die Kasse macht, die Differenz zur ersten.
 */
export const DEFINITIVE_ZAHLUNGSZUSTAENDE = ['NOT_REQUIRED', 'VERIFIED', 'WAIVED'] as const;

export async function definitiveTeilnehmer(
  eventId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return tx.calendarTicket.count({
    where: {
      eventId,
      status: 'ACTIVE',
      registration: {
        status: 'CONFIRMED',
        paymentStatus: { in: [...DEFINITIVE_ZAHLUNGSZUSTAENDE] },
      },
    },
  });
}

/** Ist dieses eine Ticket definitiv? Dieselbe Regel, auf einer Zeile. */
export function ticketIstDefinitiv(ticket: {
  status: CalendarTicketStatus;
  registration: { status: string; paymentStatus: string };
}): boolean {
  return (
    ticket.status === 'ACTIVE' &&
    ticket.registration.status === 'CONFIRMED' &&
    (DEFINITIVE_ZAHLUNGSZUSTAENDE as readonly string[]).includes(ticket.registration.paymentStatus)
  );
}

// ---------------------------------------------------------------------------
// Gäste ändern
// ---------------------------------------------------------------------------

/** Wer ein Ticket ändern darf - der Besteller selbst oder die Verwaltung. */
export interface TicketActor extends CalendarActor {
  can(permission: string): boolean;
}

async function ladeTicket(ticketId: string) {
  const ticket = await prisma.calendarTicket.findUnique({
    where: { id: ticketId },
    include: {
      registration: { select: { id: true, discordId: true, status: true, paymentStatus: true } },
      event: { select: { id: true, title: true, slug: true } },
    },
  });
  if (!ticket) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Ticket gibt es nicht.' });
  }
  return ticket;
}

/**
 * Darf diese Person dieses Ticket anfassen?
 *
 * Zwei Wege: sie hat bestellt, oder sie hat die Berechtigung dafür. Ein
 * Besteller, der die Namen seiner eigenen Gäste nicht mehr korrigieren kann,
 * wäre eine Supportanfrage je Tippfehler.
 */
function verlangeTicketZugriff(
  actor: TicketActor,
  ticket: { registration: { discordId: string } },
  permission: string,
  was: string,
): void {
  if (ticket.registration.discordId === actor.discordId) {
    return;
  }
  if (actor.can(permission)) {
    return;
  }
  throw new AppError('FORBIDDEN', {
    userMessage: `Du darfst ${was} nicht.`,
    internalMessage: `calendar: ${actor.discordId} ohne ${permission} an fremdem Ticket`,
  });
}

/**
 * Einen Gast ändern oder ersetzen.
 *
 * ## Warum das ohne neue Zahlung geht
 *
 * Weil sich nichts ändert, was bezahlt wurde: dieselbe Bestellung, dieselbe
 * Anzahl, derselbe Betrag, derselbe Platz. Es kommt nur jemand anderes. Dafür
 * eine Stornierung und eine neue Bestellung zu verlangen hiesse, den Platz
 * dazwischen freizugeben - und bei einem ausgebuchten Abend wäre er weg.
 *
 * ## Warum nach dem Check-in Schluss ist
 *
 * Weil dann jemand im Raum steht. Den Namen auf einem eingecheckten Ticket zu
 * ändern hiesse, im Nachhinein zu behaupten, es sei jemand anderes gewesen.
 */
export async function aendereTicket(
  actor: TicketActor,
  ticketId: string,
  eingabe: TicketEingabe,
): Promise<CalendarTicket> {
  const ticket = await ladeTicket(ticketId);
  verlangeTicketZugriff(actor, ticket, CALENDAR_PERMISSIONS.guestsManage, 'dieses Ticket ändern');

  if (ticket.status === 'CANCELLED') {
    throw conflict('Dieses Ticket ist storniert.');
  }
  if (ticket.checkedInAt) {
    throw conflict('Dieses Ticket ist bereits eingecheckt und lässt sich nicht mehr ändern.');
  }

  const vorher = ticketName(ticket);
  const daten = ticketDaten(eingabe, ticket.position);
  const aktualisiert = await prisma.calendarTicket.update({
    where: { id: ticketId },
    data: {
      memberDiscordId: daten.memberDiscordId ?? null,
      memberUsername: daten.memberUsername ?? null,
      guestFirstName: daten.guestFirstName ?? null,
      guestLastName: daten.guestLastName ?? null,
      guestEmail: daten.guestEmail ?? null,
      guestDiscordName: daten.guestDiscordName ?? null,
      note: daten.note ?? null,
      /*
       * Der Token bleibt.
       *
       * Er ist der Ausweis fuer **diesen Platz**, nicht fuer diese Person.
       * Ihn beim Namenswechsel neu zu erzeugen hiesse, einen schon
       * verschickten Ticketcode ungueltig zu machen - und der Gast, der ihn
       * auf dem Telefon hat, staende vor der Tuer.
       */
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_TICKET_UPDATED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: ticket.event.title,
    success: true,
    metadata: {
      eventId: ticket.eventId,
      registrationId: ticket.registrationId,
      ticketId,
      vorher,
      nachher: ticketName(aktualisiert),
      art: ticketArt(aktualisiert),
    },
  });
  logger.info('calendar.ticket.updated', { ticketId, eventId: ticket.eventId });
  return aktualisiert;
}

/**
 * Ein einzelnes Ticket stornieren.
 *
 * Der Platz wird frei, die Zeile bleibt. `ticketCount` an der Bestellung wird
 * mitgeführt, damit die Kapazitätsprüfung die Zusammenfassung und die Tickets
 * nicht auseinanderlaufen sieht.
 *
 * **Der Betrag bleibt stehen.** Eine bereits bestätigte Zahlung über drei
 * Tickets wird nicht zu einer über zwei: das Geld ist gekommen, und ob davon
 * etwas zurückgeht, entscheidet ein Mensch ausserhalb von SwissHub. Eine
 * automatisch reduzierte Summe wäre eine Rückzahlung, die niemand veranlasst
 * hat.
 */
export async function storniereTicket(
  actor: TicketActor,
  ticketId: string,
  grund: string | null,
  jetzt = new Date(),
): Promise<{ ticket: CalendarTicket; verbleibend: number }> {
  const ticket = await ladeTicket(ticketId);
  verlangeTicketZugriff(actor, ticket, CALENDAR_PERMISSIONS.ordersManage, 'dieses Ticket stornieren');

  if (ticket.status === 'CANCELLED') {
    return { ticket, verbleibend: ticket.registration.status === 'CANCELLED' ? 0 : 1 };
  }
  if (ticket.checkedInAt) {
    throw conflict('Dieses Ticket ist bereits eingecheckt.');
  }

  const ergebnis = await prisma.$transaction(async (tx) => {
    // Die Terminzeile sperren: das Stornieren gibt einen Platz frei, und
    // zwischen «frei» und «vergeben» soll niemand hineinlaufen.
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${ticket.eventId} FOR UPDATE`;

    const storniert = await tx.calendarTicket.update({
      where: { id: ticketId },
      data: { status: 'CANCELLED', cancelledAt: jetzt },
    });

    const verbleibend = await tx.calendarTicket.count({
      where: { registrationId: ticket.registrationId, status: 'ACTIVE' },
    });

    await tx.calendarRegistration.update({
      where: { id: ticket.registrationId },
      data: {
        ticketCount: verbleibend,
        /*
         * Das letzte Ticket nimmt die Bestellung mit.
         *
         * Eine Bestellung ohne Teilnehmer ist keine Bestellung - sie stuende
         * in der Liste, haette einen Betrag und niemanden, der kommt.
         */
        ...(verbleibend === 0 ? { status: 'CANCELLED' as const, cancelledAt: jetzt } : {}),
      },
    });

    return { ticket: storniert, verbleibend };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_TICKET_CANCELLED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: ticket.event.title,
    success: true,
    metadata: {
      eventId: ticket.eventId,
      registrationId: ticket.registrationId,
      ticketId,
      name: ticketName(ticket),
      grund,
      verbleibend: ergebnis.verbleibend,
      /*
       * Der Hinweis fuer die Kasse. SwissHub zahlt nichts zurueck und
       * behauptet auch nicht, es getan zu haben - aber im Protokoll steht,
       * dass hier jemand nachsehen sollte.
       */
      zahlungGeprueft: ticket.registration.paymentStatus === 'VERIFIED',
    },
  });
  logger.info('calendar.ticket.cancelled', { ticketId, verbleibend: ergebnis.verbleibend });
  return ergebnis;
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export interface CheckInErgebnis {
  ticket: CalendarTicket;
  /** `false`, wenn das Ticket schon eingecheckt war. */
  geaendert: boolean;
  name: string;
  art: 'MITGLIED' | 'GAST';
  /** Wer die Bestellung gemacht hat - beim Gast die Antwort auf «zu wem?». */
  bestelltVon: string;
}

/**
 * Ein Ticket einchecken.
 *
 * ## Warum nur definitive Tickets hereinkommen
 *
 * Weil `PENDING` heisst: jemand hat sich angemeldet und niemand hat den
 * Zahlungseingang geprüft. Diese Person einzulassen hiesse, die manuelle
 * Bestätigung an der Tür zu überspringen - und genau dafür gibt es sie.
 *
 * Der Weg daran vorbei ist nicht verschlossen, sondern ausdrücklich: wer
 * `calendar.payments.verify` hat, bestätigt die Zahlung an Ort und Stelle und
 * checkt danach ein. Ein «Trotzdem einlassen»-Knopf ohne diesen Schritt wäre
 * ein zweiter Weg zum selben Ziel, und der eine würde protokolliert.
 *
 * ## Warum ein zweiter Scan kein Fehler ist
 *
 * Er meldet «war schon eingecheckt» samt Zeitpunkt. Am Einlass steht jemand
 * mit einem Telefon in der Hand; eine rote Fehlermeldung, weil ein Ticket
 * zweimal gescannt wurde, hilft dort niemandem.
 */
export async function checkeEin(
  actor: TicketActor,
  ticketId: string,
  jetzt = new Date(),
): Promise<CheckInErgebnis> {
  if (!actor.can(CALENDAR_PERMISSIONS.checkIn)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst keinen Check-in durchführen.',
      internalMessage: `calendar: ${actor.discordId} ohne ${CALENDAR_PERMISSIONS.checkIn}`,
    });
  }

  const ticket = await ladeTicket(ticketId);
  const beschreibung = {
    name: ticketName(ticket),
    art: ticketArt(ticket),
    bestelltVon: ticket.registration.discordId,
  };

  if (ticket.status === 'CANCELLED') {
    throw conflict('Dieses Ticket ist storniert.');
  }
  if (ticket.registration.status === 'CANCELLED') {
    throw conflict('Diese Anmeldung ist storniert.');
  }
  if (ticket.registration.status === 'WAITLIST') {
    throw conflict('Diese Anmeldung steht auf der Warteliste.');
  }
  if (!ticketIstDefinitiv(ticket)) {
    throw conflict(
      'Für diese Anmeldung ist die Zahlung noch nicht bestätigt. Bitte zuerst den Zahlungseingang prüfen und bestätigen.',
    );
  }
  if (ticket.checkedInAt) {
    return { ticket, geaendert: false, ...beschreibung };
  }

  /*
   * Bedingt auf «noch nicht eingecheckt».
   *
   * Zwei Leute am Einlass, ein Ticket, zwei Telefone. Wer es als Erster von
   * NULL wegsetzt, hat eingecheckt - und im Protokoll steht ein Name und
   * nicht zwei.
   */
  const { count } = await prisma.calendarTicket.updateMany({
    where: { id: ticketId, checkedInAt: null },
    data: {
      checkedInAt: jetzt,
      checkedInByDiscordId: actor.discordId,
      checkedInByUsername: actor.username,
    },
  });
  if (count !== 1) {
    return { ticket: await ladeTicket(ticketId), geaendert: false, ...beschreibung };
  }

  const nachher = await ladeTicket(ticketId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_TICKET_CHECKED_IN,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: ticket.event.title,
    ...(ticket.memberDiscordId ? { targetDiscordId: ticket.memberDiscordId } : {}),
    success: true,
    metadata: {
      eventId: ticket.eventId,
      registrationId: ticket.registrationId,
      ticketId,
      name: beschreibung.name,
      art: beschreibung.art,
    },
  });
  return { ticket: nachher, geaendert: true, ...beschreibung };
}

/** Einen Check-in zurücknehmen - jemand hat das falsche Ticket gescannt. */
export async function nimmCheckInZurueck(actor: TicketActor, ticketId: string): Promise<CalendarTicket> {
  if (!actor.can(CALENDAR_PERMISSIONS.checkIn)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst keinen Check-in durchführen.',
      internalMessage: `calendar: ${actor.discordId} ohne ${CALENDAR_PERMISSIONS.checkIn}`,
    });
  }
  const ticket = await ladeTicket(ticketId);
  if (!ticket.checkedInAt) {
    return ticket;
  }

  const zurueck = await prisma.calendarTicket.update({
    where: { id: ticketId },
    data: { checkedInAt: null, checkedInByDiscordId: null, checkedInByUsername: null },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_TICKET_CHECKIN_REVOKED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: ticket.event.title,
    success: true,
    metadata: {
      eventId: ticket.eventId,
      ticketId,
      name: ticketName(ticket),
      warEingechecktAm: ticket.checkedInAt.toISOString(),
      warEingechecktVon: ticket.checkedInByUsername,
    },
  });
  return zurueck;
}

/**
 * Ein Ticket über seinen Token finden - der Weg eines Scans.
 *
 * Gibt `null` statt zu werfen: ein Token, den es nicht gibt, ist am Einlass
 * eine Auskunft («dieses Ticket kennen wir nicht») und kein Ausnahmefall.
 */
export async function ticketZuToken(token: string) {
  if (!/^[0-9a-f]{64}$/u.test(token)) {
    return null;
  }
  return prisma.calendarTicket.findUnique({
    where: { token },
    include: {
      registration: {
        select: {
          id: true,
          discordId: true,
          username: true,
          displayName: true,
          status: true,
          paymentStatus: true,
          paymentAmountCents: true,
        },
      },
      event: { select: { id: true, title: true, slug: true, startAt: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Die beiden Perspektiven
// ---------------------------------------------------------------------------

/**
 * Dieselben Daten, zwei Fragen.
 *
 * **Bestellungen** beantwortet «wer schuldet was» - die Kassensicht. Eine
 * Zeile je Bestellung, mit Betrag und Zahlungsstand.
 *
 * **Teilnehmende** beantwortet «wer kommt» - die Einlasssicht. Eine Zeile je
 * Person, und bei jedem Gast steht, zu wem er gehört.
 *
 * Zwei Abfragen statt einer mit Schalter: die eine lädt Bestellungen und
 * hängt Tickets an, die andere lädt Tickets und hängt die Bestellung an. Wer
 * das zusammenlegte, bekäme eine Funktion, die je nach Aufrufer etwas anderes
 * bedeutet.
 */

export interface BestellZeile {
  registrationId: string;
  bestellerDiscordId: string;
  bestellerName: string;
  status: string;
  waitlistPosition: number | null;
  registeredAt: Date;
  ticketCount: number;
  betragRappen: number;
  waehrung: string;
  zahlung: string;
  definitiv: boolean;
  verifiedAt: Date | null;
  verifiedByUsername: string | null;
  grund: string | null;
  tickets: Array<{
    ticketId: string;
    name: string;
    art: 'MITGLIED' | 'GAST';
    status: CalendarTicketStatus;
    checkedInAt: Date | null;
    guestEmail: string | null;
    guestDiscordName: string | null;
    note: string | null;
  }>;
}

export interface TeilnehmerTicketZeile {
  ticketId: string;
  registrationId: string;
  name: string;
  art: 'MITGLIED' | 'GAST';
  /** Der Besteller - bei einem Gast die Antwort auf «gehört zu wem?». */
  bestellerDiscordId: string;
  bestellerName: string;
  status: CalendarTicketStatus;
  zahlung: string;
  definitiv: boolean;
  checkedInAt: Date | null;
  checkedInByUsername: string | null;
  guestEmail: string | null;
  guestDiscordName: string | null;
  note: string | null;
  position: number;
}

const bestellerName = (zeile: {
  displayName: string | null;
  username: string | null;
  discordId: string;
}): string => zeile.displayName ?? zeile.username ?? zeile.discordId;

/**
 * Die Bestellungen eines Termins.
 *
 * Der Aufrufer prüft die Berechtigung - diese Funktion tut es nicht, und
 * genau deshalb darf sie nie ungeprüft aufgerufen werden.
 */
export async function ladeBestellungen(eventId: string): Promise<BestellZeile[]> {
  const zeilen = await prisma.calendarRegistration.findMany({
    where: { eventId },
    orderBy: [{ status: 'asc' }, { registeredAt: 'asc' }],
    include: {
      tickets: { orderBy: { position: 'asc' } },
      event: { select: { entryFeeCurrency: true } },
    },
  });

  return zeilen.map((zeile) => ({
    registrationId: zeile.id,
    bestellerDiscordId: zeile.discordId,
    bestellerName: bestellerName(zeile),
    status: zeile.status,
    waitlistPosition: zeile.waitlistPosition,
    registeredAt: zeile.registeredAt,
    // Die gezaehlten Tickets, nicht die mitgefuehrte Zahl - siehe
    // `zahlungsKennzahlen`.
    ticketCount: zeile.tickets.filter((ticket) => ticket.status === 'ACTIVE').length,
    betragRappen: zeile.paymentAmountCents,
    waehrung: zeile.paymentCurrency ?? zeile.event.entryFeeCurrency,
    zahlung: zeile.paymentStatus,
    definitiv:
      zeile.status === 'CONFIRMED' &&
      (DEFINITIVE_ZAHLUNGSZUSTAENDE as readonly string[]).includes(zeile.paymentStatus),
    verifiedAt: zeile.paymentVerifiedAt,
    verifiedByUsername: zeile.paymentVerifiedByUsername,
    grund: zeile.paymentReason,
    tickets: zeile.tickets.map((ticket) => ({
      ticketId: ticket.id,
      name: ticketName(ticket),
      art: ticketArt(ticket),
      status: ticket.status,
      checkedInAt: ticket.checkedInAt,
      guestEmail: ticket.guestEmail,
      guestDiscordName: ticket.guestDiscordName,
      note: ticket.note,
    })),
  }));
}

/** Die einzelnen Teilnehmenden eines Termins. */
export async function ladeTeilnehmende(eventId: string): Promise<TeilnehmerTicketZeile[]> {
  const zeilen = await prisma.calendarTicket.findMany({
    where: { eventId },
    orderBy: [{ createdAt: 'asc' }, { position: 'asc' }],
    include: {
      registration: {
        select: {
          id: true,
          discordId: true,
          username: true,
          displayName: true,
          status: true,
          paymentStatus: true,
        },
      },
    },
  });

  return zeilen.map((ticket) => ({
    ticketId: ticket.id,
    registrationId: ticket.registrationId,
    name: ticketName(ticket),
    art: ticketArt(ticket),
    bestellerDiscordId: ticket.registration.discordId,
    bestellerName: bestellerName(ticket.registration),
    status: ticket.status,
    zahlung: ticket.registration.paymentStatus,
    definitiv: ticketIstDefinitiv(ticket),
    checkedInAt: ticket.checkedInAt,
    checkedInByUsername: ticket.checkedInByUsername,
    guestEmail: ticket.guestEmail,
    guestDiscordName: ticket.guestDiscordName,
    note: ticket.note,
    position: ticket.position,
  }));
}

/**
 * Die eigene Bestellung samt Tickets.
 *
 * Was ein Mitglied über seine eigene Anmeldung sehen darf - und nur das:
 * keine Angabe darüber, wer bestätigt hat, kein Adminvermerk. `null`, wenn es
 * keine gibt oder sie storniert ist.
 */
export async function meineBestellung(eventId: string, discordId: string) {
  const zeile = await prisma.calendarRegistration.findUnique({
    where: { eventId_discordId: { eventId, discordId } },
    include: {
      tickets: { orderBy: { position: 'asc' } },
      event: { select: { entryFeeCurrency: true, entryFeeCents: true } },
    },
  });
  if (!zeile || zeile.status === 'CANCELLED') {
    return null;
  }

  return {
    registrationId: zeile.id,
    status: zeile.status,
    waitlistPosition: zeile.waitlistPosition,
    zahlung: zeile.paymentStatus,
    betragRappen: zeile.paymentAmountCents,
    waehrung: zeile.paymentCurrency ?? zeile.event.entryFeeCurrency,
    preisJeTicketRappen: zeile.event.entryFeeCents,
    tickets: zeile.tickets
      .filter((ticket) => ticket.status === 'ACTIVE')
      .map((ticket) => ({
        ticketId: ticket.id,
        name: ticketName(ticket),
        art: ticketArt(ticket),
        /*
         * Der Token geht an den Besteller - es ist sein Ticket.
         *
         * Er steht aber in keiner Adminliste und in keiner oeffentlichen
         * Ansicht: wer ihn hat, kommt herein.
         */
        token: ticket.token,
        checkedInAt: ticket.checkedInAt,
        guestFirstName: ticket.guestFirstName,
        guestLastName: ticket.guestLastName,
        guestEmail: ticket.guestEmail,
        guestDiscordName: ticket.guestDiscordName,
        note: ticket.note,
        istIch: ticket.memberDiscordId === discordId,
      })),
  };
}
