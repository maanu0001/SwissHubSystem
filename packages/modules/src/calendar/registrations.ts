import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type {
  CalendarEvent,
  CalendarRegistration,
  CalendarRegistrationStatus,
  Prisma,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, forbidden, notFound } from '@swisshub/shared';
import { CALENDAR_MODULE_ID } from './config';
import { requireEvent } from './service';
import { kostenpflichtig, startStatus } from './zahlungen';
import {
  MAX_TICKETS_JE_BESTELLUNG,
  belegteTickets,
  definitiveTeilnehmer,
  offenerBetrag,
  ticketDaten,
  zahlungFuerNeueTickets,
  wartendeTickets,
  type TicketEingabe,
} from './tickets';
import type { CalendarActor } from './schemas';

const logger = createLogger('calendar:registrations');

/**
 * Anmeldungen zu einem Termin.
 *
 * Der Kern ist eine einzige Frage: ist noch ein Platz frei? Wer sie ohne
 * Sperre beantwortet, beantwortet sie fuer zwei gleichzeitige Anmeldungen
 * zweimal mit «ja» - und der Abend ist um eine Person ueberbucht. Deshalb
 * wird die Terminzeile gesperrt, bevor gezaehlt wird; ab da entscheidet nur
 * dieser Vorgang. Dasselbe Vorgehen wie bei der Turnieranmeldung.
 *
 * Die Eindeutigkeit `(eventId, discordId)` in der Datenbank ist die zweite
 * Sicherung: sie faengt den Doppelklick auch dann, wenn zwei Anfragen sich
 * exakt ueberlagern.
 */

export interface AnmeldeErgebnis {
  registration: CalendarRegistration;
  /** Auf der Warteliste gelandet statt bestaetigt. */
  waitlisted: boolean;
  position: number | null;
}

/**
 * Die Belegung eines Termins.
 *
 * ## Warum hier Tickets gezaehlt werden und keine Anmeldungen
 *
 * Weil eine Anmeldung seit den Mehrfachtickets kein Platz mehr ist, sondern
 * eine **Bestellung**: fuenfzig Bestellungen koennen achtzig Leute sein. Wer
 * hier Zeilen zaehlte, saehe einen halb leeren Saal und liesse weitere
 * dreissig Leute herein.
 *
 * `confirmed` heisst deshalb ab jetzt «belegte Plaetze» - und die Felder
 * heissen weiter so, weil die halbe Oberflaeche sie liest und eine Umbenennung
 * an dreissig Stellen nichts besser machte. Wer die Zahl der **Personen mit
 * Zusage** braucht, nimmt `definitiv`.
 */
export interface Belegung {
  /** Belegte Plaetze - aktive Tickets bestaetigter Bestellungen. */
  confirmed: number;
  /** Tickets auf der Warteliste. */
  waitlist: number;
  capacity: number;
  /** `null` bei unbegrenzt. */
  freeSeats: number | null;
  full: boolean;
  /**
   * Definitive Teilnehmer - Tickets, deren Bestellung bezahlt, erlassen oder
   * kostenlos ist. Ausdruecklich ohne `PENDING`.
   */
  definitiv: number;
  /** Wie viele Bestellungen dahinterstehen. */
  bestellungen: number;
}

export async function belegung(eventId: string): Promise<Belegung> {
  const event = await requireEvent(eventId);
  const [confirmed, waitlist, definitiv, bestellungen] = await Promise.all([
    belegteTickets(eventId),
    wartendeTickets(eventId),
    definitiveTeilnehmer(eventId),
    prisma.calendarRegistration.count({ where: { eventId, status: { not: 'CANCELLED' } } }),
  ]);
  const capacity = event.capacity;
  return {
    confirmed,
    waitlist,
    capacity,
    freeSeats: capacity > 0 ? Math.max(0, capacity - confirmed) : null,
    full: capacity > 0 && confirmed >= capacity,
    definitiv,
    bestellungen,
  };
}

/** Warum eine Anmeldung gerade nicht geht - oder `null`, wenn sie geht. */
export function anmeldungGesperrt(event: CalendarEvent, now = new Date()): string | null {
  if (!event.registrationEnabled) {
    return 'Für dieses Event gibt es keine Anmeldung.';
  }
  if (event.status === 'CANCELLED') {
    return 'Dieses Event wurde abgesagt.';
  }
  if (event.status === 'COMPLETED') {
    return 'Dieses Event ist bereits vorbei.';
  }
  if (event.status === 'DRAFT') {
    return 'Dieses Event ist noch nicht veröffentlicht.';
  }
  if (event.registrationClosesAt && event.registrationClosesAt <= now) {
    return 'Die Anmeldefrist ist abgelaufen.';
  }
  // Ein Termin, der laengst begonnen hat, nimmt niemanden mehr auf - auch
  // ohne ausdruecklichen Anmeldeschluss.
  if (event.startAt <= now) {
    return 'Dieses Event hat bereits begonnen.';
  }
  return null;
}

/** Warum eine Abmeldung gerade nicht geht - oder `null`. */
export function abmeldungGesperrt(event: CalendarEvent, now = new Date()): string | null {
  if (!event.allowSelfCancel) {
    return 'Für dieses Event ist keine eigenständige Abmeldung vorgesehen. Bitte melde dich bei der Organisation.';
  }
  if (event.cancelDeadlineAt && event.cancelDeadlineAt <= now) {
    return 'Die Frist für eine Abmeldung ist abgelaufen.';
  }
  if (event.status === 'COMPLETED') {
    return 'Dieses Event ist bereits vorbei.';
  }
  return null;
}

async function pruefeAntworten(
  eventId: string,
  antworten: Record<string, string>,
): Promise<Map<string, string>> {
  const fragen = await prisma.calendarQuestion.findMany({
    where: { eventId },
    orderBy: { position: 'asc' },
  });
  const ergebnis = new Map<string, string>();
  for (const frage of fragen) {
    const wert = (antworten[frage.id] ?? '').trim();
    if (!wert) {
      if (frage.required) {
        throw conflict(`Bitte beantworte «${frage.label}».`);
      }
      continue;
    }
    if (frage.choices.length > 0 && !frage.choices.includes(wert)) {
      throw conflict(`«${wert}» ist bei «${frage.label}» nicht zur Auswahl.`);
    }
    ergebnis.set(frage.id, wert.slice(0, 500));
  }
  return ergebnis;
}

export interface TeilnehmerIdentitaet {
  discordId: string;
  username?: string | null;
  displayName?: string | null;
}

/**
 * Sich anmelden - fuer sich allein oder mit Begleitung.
 *
 * ## Was eine Anmeldung jetzt ist
 *
 * Eine **Bestellung** ueber ein oder mehrere Tickets. `tickets` beschreibt,
 * wer kommt; fehlt die Angabe, entsteht wie bisher genau ein Ticket auf die
 * anmeldende Person. Damit bleibt jeder bestehende Aufruf gueltig - auch der
 * aus dem Bot.
 *
 * ## Was ausdruecklich nicht aus dem Browser kommt
 *
 * Der Preis. Er wird hier aus dem Termin und der Ticketzahl gerechnet, und
 * zwar unter derselben Sperre, unter der auch die Plaetze gezaehlt werden.
 * Ein Gesamtbetrag aus einem Formularfeld waere ein Preisschild, das sich der
 * Kaeufer selbst schreibt.
 *
 * ## Alles oder nichts
 *
 * Passen drei Tickets nicht mehr hinein, geht die **ganze** Bestellung auf
 * die Warteliste - nicht zwei hinein und eines heraus. Eine halb bestaetigte
 * Bestellung haette einen Gesamtbetrag, der zu nichts passt, und einen
 * Besteller, der nicht weiss, wen er mitbringen darf.
 */
export async function register(
  identity: TeilnehmerIdentitaet,
  eventId: string,
  antworten: Record<string, string> = {},
  now = new Date(),
  optionen: { tickets?: TicketEingabe[] } = {},
): Promise<AnmeldeErgebnis> {
  const event = await requireEvent(eventId);
  const gesperrt = anmeldungGesperrt(event, now);
  if (gesperrt) {
    throw conflict(gesperrt);
  }
  const geprueft = await pruefeAntworten(eventId, antworten);

  /*
   * Ohne Angabe: ein Ticket auf die anmeldende Person.
   *
   * Das ist der alte Weg, und er muss weiter funktionieren - der
   * Discord-Knopf bei kostenlosen Terminen geht genau hier durch.
   */
  const ticketEingaben: TicketEingabe[] =
    optionen.tickets && optionen.tickets.length > 0
      ? optionen.tickets
      : [
          {
            memberDiscordId: identity.discordId,
            memberUsername: identity.displayName ?? identity.username ?? null,
          },
        ];

  if (ticketEingaben.length > MAX_TICKETS_JE_BESTELLUNG) {
    throw conflict(`Es lassen sich höchstens ${MAX_TICKETS_JE_BESTELLUNG} Tickets auf einmal reservieren.`);
  }
  // Die Zeilen fuer die Datenbank - samt Tokens - vor der Transaktion bauen.
  // `randomBytes` unter einer Zeilensperre waere Arbeit, die dort nichts
  // verloren hat.
  const ticketZeilen = ticketEingaben.map((eingabe, index) => ticketDaten(eingabe, index));

  const ergebnis = await prisma.$transaction(async (tx) => {
    // Ab hier entscheidet nur dieser Vorgang, ob noch Plaetze frei sind.
    // Ohne diese Zeile koennten zwei gleichzeitige Anmeldungen beide die
    // letzten Plaetze bekommen.
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;

    const frisch = await tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
    const vorhanden = await tx.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId, discordId: identity.discordId } },
    });
    if (vorhanden && vorhanden.status !== 'CANCELLED') {
      throw conflict('Du bist bereits angemeldet.');
    }

    /*
     * Gezaehlt werden Tickets, nicht Zeilen.
     *
     * Und der Vergleich ist `belegt + gewuenscht > kapazitaet`, nicht
     * `belegt >= kapazitaet`: bei 98 von 100 belegten Plaetzen ist noch
     * Platz - aber nicht fuer drei.
     */
    const belegt = await belegteTickets(eventId, tx);
    const voll = frisch.capacity > 0 && belegt + ticketZeilen.length > frisch.capacity;

    if (voll && !frisch.waitlistEnabled) {
      throw conflict(
        frisch.capacity - belegt > 0
          ? `Für so viele Tickets ist kein Platz mehr frei - es sind noch ${frisch.capacity - belegt} übrig.`
          : 'Dieses Event ist ausgebucht.',
      );
    }

    const status: CalendarRegistrationStatus = voll ? 'WAITLIST' : 'CONFIRMED';
    const daten = {
      eventId,
      discordId: identity.discordId,
      username: identity.username?.slice(0, 64) ?? null,
      displayName: identity.displayName?.slice(0, 64) ?? null,
      status,
      /*
       * Die Wartelistenposition zaehlt Bestellungen, nicht Tickets.
       *
       * «Platz 3 auf der Warteliste» heisst: zwei Bestellungen sind vor dir.
       * Tickets zu zaehlen ergaebe eine Zahl, die springt, sobald jemand vor
       * einem zwei Gaeste mitbringt - und die niemandem sagt, wann er dran
       * ist.
       */
      waitlistPosition: voll
        ? (await tx.calendarRegistration.count({ where: { eventId, status: 'WAITLIST' } })) + 1
        : null,
      registeredAt: now,
      cancelledAt: null,
      // Eine erneute Anmeldung nach einer Abmeldung ist eine neue Anmeldung,
      // kein wiederhergestelltes Nachruecken.
      promotedAt: null,
      promotionNotifiedAt: null,

      /*
       * Der Zahlungsstand einer frischen Anmeldung.
       *
       * `PENDING`, sobald der Termin etwas kostet - ausdruecklich nicht
       * `VERIFIED`. Dass jemand das Formular abgeschickt hat, sagt nichts
       * darueber, ob Geld angekommen ist; SwissHub sieht keine
       * Kontobewegung und darf deshalb keine behaupten. Bis ein Mensch
       * bestaetigt, ist die Teilnahme vorlaeufig.
       *
       * Der Betrag wird mitgeschrieben und nicht aus dem Termin gelesen:
       * aendert die Organisation den Preis nachtraeglich, schuldet niemand
       * rueckwirkend mehr. Was in der Liste steht, ist das, was die Person
       * gesehen hat.
       *
       * Auch eine Anmeldung, die auf der Warteliste landet, traegt den
       * Preis. Sie wird spaeter vielleicht nachgerueckt, und dann soll dort
       * nicht ploetzlich eine Null stehen.
       */
      paymentStatus: startStatus(frisch),
      /*
       * Der Gesamtbetrag: Ticketzahl mal Eintritt, hier gerechnet.
       *
       * Ganzzahlig, weil in Rappen; und aus dem Termin, nicht aus der
       * Anfrage. Ein Betrag, den der Browser mitschickt, ist ein Preis, den
       * der Kaeufer bestimmt.
       */
      paymentAmountCents: kostenpflichtig(frisch) ? frisch.entryFeeCents * ticketZeilen.length : 0,
      paymentCurrency: kostenpflichtig(frisch) ? frisch.entryFeeCurrency : null,
      ticketCount: ticketZeilen.length,
      /*
       * Eine erneute Anmeldung nach einer Stornierung beginnt bei null.
       *
       * Sonst behielte jemand, der einmal bestaetigt und dann storniert
       * wurde, seine Bestaetigung ueber die neue Anmeldung hinweg - und
       * haette beim naechsten Mal umsonst teilgenommen.
       */
      paymentVerifiedAt: null,
      paymentVerifiedByDiscordId: null,
      paymentVerifiedByUsername: null,
      paymentReason: null,
    };

    const eintrag = vorhanden
      ? await tx.calendarRegistration.update({ where: { id: vorhanden.id }, data: daten })
      : await tx.calendarRegistration.create({ data: daten });

    /*
     * Die Tickets ersetzen.
     *
     * Eine erneute Anmeldung nach einer Stornierung ist eine neue Bestellung
     * mit neuen Teilnehmern - und mit neuen Tokens. Die alten stehen zum Teil
     * schon auf einem Telefon; sie weiter gelten zu lassen hiesse, einen
     * zurueckgegebenen Platz zweimal zu vergeben.
     */
    await tx.calendarTicket.deleteMany({ where: { registrationId: eintrag.id } });
    /*
     * Preis und Zahlungsstand kommen aus `frisch` - dem Termin, wie er unter
     * der Sperre aussieht -, nicht aus der Anfrage und nicht aus der Fassung,
     * die vor der Transaktion gelesen wurde. Ein kostenloses Ticket ist
     * sofort erledigt, ein kostenpflichtiges bleibt offen, bis ein Mensch den
     * Eingang bestaetigt.
     */
    const ticketZahlung = zahlungFuerNeueTickets(frisch, now);
    for (const zeile of ticketZeilen) {
      await tx.calendarTicket.create({
        data: { ...zeile, ...ticketZahlung, registrationId: eintrag.id, eventId },
      });
    }

    // Antworten ersetzen - eine erneute Anmeldung soll nicht die alten
    // Angaben behalten.
    await tx.calendarAnswer.deleteMany({ where: { registrationId: eintrag.id } });
    if (geprueft.size > 0) {
      await tx.calendarAnswer.createMany({
        data: [...geprueft].map(([questionId, value]) => ({
          registrationId: eintrag.id,
          questionId,
          value,
        })),
      });
    }

    return { registration: eintrag, waitlisted: voll, position: eintrag.waitlistPosition };
  });

  const { meldeEreignis } = await import('../automation/emit');
  await meldeEreignis(
    'calendar.registration_created',
    {
      eventId,
      registrationId: ergebnis.registration.id,
      discordId: identity.discordId,
      titel: event.title,
      status: ergebnis.registration.status,
      // Ergaenzt, damit eine Meldung auf den Termin zeigen kann und weiss,
      // wer davon erfahren soll: die Person, die ihn angelegt hat.
      slug: event.slug,
      organizerDiscordId: event.createdByDiscordId,
    },
    {
      guildId: event.guildId,
      actorId: identity.discordId,
      subjectId: identity.discordId,
      entityId: eventId,
    },
  );

  logger.info('Anmeldung eingegangen', {
    eventId,
    discordId: identity.discordId,
    status: ergebnis.registration.status,
  });
  return ergebnis;
}

export interface NachkaufErgebnis {
  registration: CalendarRegistration;
  /** Wie viele Tickets dazugekommen sind. */
  ergaenzt: number;
  /** Was durch diesen Nachkauf zusaetzlich zu bezahlen ist - in Rappen. */
  zusatzbetragRappen: number;
  /** Was insgesamt offen ist, inklusive aelterer unbezahlter Tickets. */
  offenRappen: number;
}

/**
 * Weitere Tickets zu einer bestehenden Anmeldung.
 *
 * ## Warum keine zweite Bestellung
 *
 * Weil `(eventId, discordId)` eindeutig ist - eine zweite Bestellung derselben
 * Person zu demselben Termin laesst die Datenbank gar nicht zu. Und das ist
 * richtig so: zwei Bestellungen haetten zwei Betraege, zwei Zahlungsstaende
 * und zwei Zeilen in der Kassenliste fuer einen Menschen, der einmal
 * ueberweist. Die bestehende Bestellung waechst.
 *
 * ## Warum die neuen Tickets nicht bezahlt sind
 *
 * Auch dann nicht, wenn die Bestellung bereits bestaetigt ist. SwissHub sieht
 * keine Kontobewegung; dass jemand zwei Tickets bezahlt hat, sagt nichts
 * darueber, ob er das dritte auch bezahlt hat. Die neuen Tickets entstehen
 * mit `settledStatus = null` und werden erst definitiv, wenn ein Mensch den
 * Eingang bestaetigt.
 *
 * **Die bereits bezahlten Tickets behalten ihren Stand.** Sie bleiben
 * definitiv, und ihr `settledAt` wird nicht angefasst - sonst nahme ein
 * Nachkauf den Leuten ihre Zusage, die laengst bezahlt haben.
 *
 * Die Bestellung selbst geht dabei von `VERIFIED` zurueck auf `PENDING`: es
 * steht wieder Geld aus, und «bestaetigt» waere in dem Moment eine falsche
 * Auskunft. `paymentVerifiedAt` und `paymentVerifiedByUsername` bleiben
 * stehen - sie sind die Spur der ersten Bestaetigung, nicht der aktuelle
 * Stand.
 *
 * ## Kapazitaet
 *
 * Erneut geprueft, unter derselben Zeilensperre wie eine Neuanmeldung, und
 * **nur fuer die neuen Plaetze**: die bestehenden sind bereits reserviert und
 * werden nicht noch einmal gegengerechnet. Passt die gewuenschte Zahl nicht
 * ganz, wird abgelehnt - ein halber Nachkauf hinterliesse einen Betrag, der
 * zu nichts passt.
 *
 * Eine Bestellung auf der **Warteliste** kann nicht nachkaufen: sie haelt
 * noch keinen Platz, und `rueckeNach` prueft, ob eine Bestellung als Ganzes
 * hineinpasst. Sie waehrend des Wartens wachsen zu lassen hiesse, ihre
 * Chancen still zu verschlechtern.
 */
export async function ergaenzeTickets(
  identity: TeilnehmerIdentitaet,
  eventId: string,
  tickets: TicketEingabe[],
  now = new Date(),
): Promise<NachkaufErgebnis> {
  const event = await requireEvent(eventId);
  const gesperrt = anmeldungGesperrt(event, now);
  if (gesperrt) {
    throw conflict(gesperrt);
  }
  if (tickets.length === 0) {
    throw conflict('Bitte mindestens ein Ticket angeben.');
  }

  // Wie bei der Neuanmeldung: die Tokens vor der Sperre erzeugen.
  const neueZeilen = tickets.map((eingabe, index) => ticketDaten(eingabe, index));

  const ergebnis = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;
    const frisch = await tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });

    const bestellung = await tx.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId, discordId: identity.discordId } },
    });
    if (!bestellung || bestellung.status === 'CANCELLED') {
      throw conflict('Du bist für dieses Event nicht angemeldet.');
    }
    if (bestellung.status === 'WAITLIST') {
      throw conflict(
        'Deine Anmeldung steht auf der Warteliste. Weitere Tickets lassen sich erst hinzufügen, wenn du nachgerückt bist.',
      );
    }

    const bisher = await tx.calendarTicket.count({
      where: { registrationId: bestellung.id, status: 'ACTIVE' },
    });
    if (bisher + neueZeilen.length > MAX_TICKETS_JE_BESTELLUNG) {
      throw conflict(
        `Eine Anmeldung umfasst höchstens ${MAX_TICKETS_JE_BESTELLUNG} Tickets - du hast bereits ${bisher}.`,
      );
    }

    // Nur die neuen Plaetze gegenrechnen: die bestehenden stecken schon in
    // `belegt`.
    const belegt = await belegteTickets(eventId, tx);
    if (frisch.capacity > 0 && belegt + neueZeilen.length > frisch.capacity) {
      const frei = Math.max(0, frisch.capacity - belegt);
      throw conflict(
        frei > 0
          ? `So viele Plätze sind nicht mehr frei - es sind noch ${frei} übrig.`
          : 'Dieses Event ist ausgebucht.',
      );
    }

    /*
     * Die Position setzt hinter dem letzten bestehenden Ticket auf - auch
     * hinter stornierten. Zwei Tickets mit derselben Position waeren zwei
     * Zeilen, die sich in jeder sortierten Ansicht abwechseln koennen.
     */
    const letzte = await tx.calendarTicket.aggregate({
      where: { registrationId: bestellung.id },
      _max: { position: true },
    });
    const ab = (letzte._max.position ?? -1) + 1;
    const ticketZahlung = zahlungFuerNeueTickets(frisch, now);

    for (const [index, zeile] of neueZeilen.entries()) {
      await tx.calendarTicket.create({
        data: {
          ...zeile,
          ...ticketZahlung,
          position: ab + index,
          registrationId: bestellung.id,
          eventId,
        },
      });
    }

    const zusatz = ticketZahlung.priceCents * neueZeilen.length;
    const offen = await offenerBetrag(bestellung.id, tx);

    const aktualisiert = await tx.calendarRegistration.update({
      where: { id: bestellung.id },
      data: {
        ticketCount: bisher + neueZeilen.length,
        // Der Gesamtbetrag waechst um die neuen Tickets.
        paymentAmountCents: { increment: zusatz },
        ...(zusatz > 0 && bestellung.paymentStatus !== 'PENDING'
          ? {
              /*
               * Wieder offen - denn es ist wieder etwas offen.
               *
               * `paymentVerifiedAt` und `paymentVerifiedByUsername` bleiben
               * stehen: sie sagen, wer die erste Zahlung bestaetigt hat, und
               * genau das will man bei einem Nachkauf wissen. Der aktuelle
               * Stand steht in `paymentStatus`.
               */
              paymentStatus: 'PENDING' as const,
              paymentCurrency: frisch.entryFeeCurrency,
            }
          : {}),
      },
    });

    return {
      registration: aktualisiert,
      ergaenzt: neueZeilen.length,
      zusatzbetragRappen: zusatz,
      offenRappen: offen,
    };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_TICKETS_ADDED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: identity.discordId,
    actorUsername: identity.username ?? null,
    targetLabel: event.title,
    success: true,
    metadata: {
      eventId,
      registrationId: ergebnis.registration.id,
      ergaenzt: ergebnis.ergaenzt,
      zusatzbetragRappen: ergebnis.zusatzbetragRappen,
      gesamtTickets: ergebnis.registration.ticketCount,
    },
  });
  logger.info('Tickets ergaenzt', {
    eventId,
    discordId: identity.discordId,
    ergaenzt: ergebnis.ergaenzt,
  });

  // Die Discord-Ankuendigung zieht der Aufrufer nach - genau wie bei
  // `register`. Sie hier zu holen hiesse, den Discord-Versand in den
  // Modulkern zu ziehen.
  return ergebnis;
}

export interface AbmeldeErgebnis {
  registration: CalendarRegistration;
  /** Wer durch die Abmeldung nachgerueckt ist. */
  nachgerueckt: CalendarRegistration | null;
}

/**
 * Sich selbst abmelden.
 *
 * Wird dadurch ein Platz frei, rueckt in derselben Transaktion die erste
 * wartende Person nach. Das getrennt zu tun hiesse, dass zwischen Freiwerden
 * und Nachruecken jemand anders den Platz nehmen koennte - und die Warteliste
 * waere eine Empfehlung statt einer Reihenfolge.
 */
export async function unregister(
  discordId: string,
  eventId: string,
  now = new Date(),
): Promise<AbmeldeErgebnis> {
  const event = await requireEvent(eventId);
  const gesperrt = abmeldungGesperrt(event, now);
  if (gesperrt) {
    throw conflict(gesperrt);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;

    const vorhanden = await tx.calendarRegistration.findUnique({
      where: { eventId_discordId: { eventId, discordId } },
    });
    if (!vorhanden || vorhanden.status === 'CANCELLED') {
      throw conflict('Du bist für dieses Event nicht angemeldet.');
    }

    const abgemeldet = await tx.calendarRegistration.update({
      where: { id: vorhanden.id },
      data: { status: 'CANCELLED', cancelledAt: now, waitlistPosition: null },
    });
    /*
     * Die Tickets gehen mit.
     *
     * Der Zustand der Bestellung allein genuegt nicht: `belegteTickets`
     * zaehlt Tickets und filtert ueber die Bestellung, aber die Ticketzeilen
     * selbst wuerden weiter als aktiv gelten - und ein stornierter Platz
     * liesse sich nicht von einem belegten unterscheiden, sobald jemand
     * direkt auf die Tickets schaut. Zwei Wahrheiten ueber denselben Platz
     * sind eine zu viel.
     */
    await tx.calendarTicket.updateMany({
      where: { registrationId: vorhanden.id, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });

    // Nur ein frei gewordener bestaetigter Platz laesst jemanden nachruecken.
    // Wer von der Warteliste abspringt, gibt keinen Platz frei - dann muss
    // aber die Reihenfolge dahinter aufschliessen.
    const nachgerueckt = vorhanden.status === 'CONFIRMED' ? await rueckeNach(tx, eventId, now) : null;
    await nummeriereWarteliste(tx, eventId);

    return { registration: abgemeldet, nachgerueckt };
  });
}

/**
 * Die erste wartende Person auf einen frei gewordenen Platz setzen.
 *
 * Erwartet eine bereits gesperrte Terminzeile - die Sperre ist der Grund,
 * weshalb hier nicht zwei Personen auf denselben Platz nachruecken.
 */
async function rueckeNach(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<CalendarRegistration | null> {
  const event = await tx.calendarEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.capacity <= 0) {
    return null;
  }
  const belegt = await belegteTickets(eventId, tx);
  const frei = event.capacity - belegt;
  if (frei <= 0) {
    return null;
  }

  /*
   * Die erste Bestellung, die **ganz** hineinpasst.
   *
   * Nicht einfach die erste auf der Warteliste: wird ein Platz frei und die
   * naechste Bestellung braucht drei, geht sie nicht - und wuerde man sie
   * trotzdem nachruecken lassen, waere der Abend ueberbucht.
   *
   * Uebersprungen wird sie deshalb, und die naechste passende kommt zum Zug.
   * Das ist nicht ganz «wer zuerst kam»; die Alternative waere, den freien
   * Platz leer zu lassen, bis zufaellig genug auf einmal frei wird. Bei einem
   * Community-Abend ist ein besetzter Platz mehr wert als eine strenge
   * Reihenfolge - und die uebersprungene Bestellung bleibt vorn, sobald
   * genug frei ist.
   */
  const naechster = await tx.calendarRegistration.findFirst({
    where: { eventId, status: 'WAITLIST', ticketCount: { lte: frei } },
    orderBy: [{ waitlistPosition: 'asc' }, { registeredAt: 'asc' }],
  });
  if (!naechster) {
    return null;
  }
  return tx.calendarRegistration.update({
    where: { id: naechster.id },
    data: { status: 'CONFIRMED', waitlistPosition: null, promotedAt: now },
  });
}

/** Luecken in der Warteliste schliessen, damit die Plaetze 1..n durchlaufen. */
async function nummeriereWarteliste(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const wartende = await tx.calendarRegistration.findMany({
    where: { eventId, status: 'WAITLIST' },
    orderBy: [{ waitlistPosition: 'asc' }, { registeredAt: 'asc' }],
    select: { id: true, waitlistPosition: true },
  });
  for (const [index, eintrag] of wartende.entries()) {
    const soll = index + 1;
    if (eintrag.waitlistPosition !== soll) {
      await tx.calendarRegistration.update({
        where: { id: eintrag.id },
        data: { waitlistPosition: soll },
      });
    }
  }
}

/**
 * Eine Anmeldung durch die Verwaltung entfernen.
 *
 * Derselbe Weg wie eine Abmeldung, nur ohne die Fristen: die gelten fuer die
 * Teilnehmer, nicht fuer die Organisation.
 */
export async function removeRegistration(
  actor: CalendarActor,
  registrationId: string,
  reason: string | null,
  now = new Date(),
): Promise<AbmeldeErgebnis> {
  const eintrag = await prisma.calendarRegistration.findUnique({
    where: { id: registrationId },
    include: { event: { select: { id: true, title: true } } },
  });
  if (!eintrag) {
    throw notFound('Anmeldung nicht gefunden', 'Diese Anmeldung existiert nicht.');
  }

  const ergebnis = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eintrag.eventId} FOR UPDATE`;
    const abgemeldet = await tx.calendarRegistration.update({
      where: { id: registrationId },
      data: { status: 'CANCELLED', cancelledAt: now, waitlistPosition: null },
    });
    // Wie bei der eigenen Abmeldung: die Tickets gehen mit.
    await tx.calendarTicket.updateMany({
      where: { registrationId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    const nachgerueckt = eintrag.status === 'CONFIRMED' ? await rueckeNach(tx, eintrag.eventId, now) : null;
    await nummeriereWarteliste(tx, eintrag.eventId);
    return { registration: abgemeldet, nachgerueckt };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_REGISTRATION_REMOVED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: eintrag.event.title,
    targetDiscordId: eintrag.discordId,
    success: true,
    metadata: { eventId: eintrag.eventId, registrationId, reason },
  });
  return ergebnis;
}

/**
 * Nachruecken nachholen, wenn sich die Platzzahl geaendert hat.
 *
 * Wird die Kapazitaet erhoeht, sollen Wartende aufruecken, ohne dass jemand
 * sich erst abmelden muss. Der Aufruf ist idempotent: ist kein Platz frei,
 * geschieht nichts.
 */
export async function fuelleFreiePlaetze(eventId: string, now = new Date()): Promise<CalendarRegistration[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CalendarEvent" WHERE id = ${eventId} FOR UPDATE`;
    const nachgerueckt: CalendarRegistration[] = [];
    // Schleife statt Einzelfall: nach einer Erhoehung um fuenf Plaetze
    // ruecken fuenf Personen nach, nicht eine.
    for (;;) {
      const naechster = await rueckeNach(tx, eventId, now);
      if (!naechster) {
        break;
      }
      nachgerueckt.push(naechster);
    }
    await nummeriereWarteliste(tx, eventId);
    return nachgerueckt;
  });
}

export interface TeilnehmerZeile {
  id: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  status: CalendarRegistrationStatus;
  waitlistPosition: number | null;
  registeredAt: Date;
  promotedAt: Date | null;
  answers: Array<{ question: string; value: string }>;
}

/**
 * Teilnehmerliste eines Termins.
 *
 * Die Berechtigung prueft der Aufrufer - diese Stelle prueft sie nicht, und
 * genau deshalb darf sie nie ungeprueft aufgerufen werden. `withAnswers`
 * entscheidet, ob die Antworten auf Zusatzfragen mitkommen: sie gehen nur die
 * Organisation etwas an, nicht die oeffentliche Liste.
 */
export async function listRegistrations(
  eventId: string,
  options: { withAnswers?: boolean; includeCancelled?: boolean } = {},
): Promise<TeilnehmerZeile[]> {
  const where: Prisma.CalendarRegistrationWhereInput = {
    eventId,
    ...(options.includeCancelled ? {} : { status: { in: ['CONFIRMED', 'WAITLIST'] } }),
  };
  const orderBy: Prisma.CalendarRegistrationOrderByWithRelationInput[] = [
    { status: 'asc' },
    { waitlistPosition: 'asc' },
    { registeredAt: 'asc' },
  ];

  // Zwei Abfragen statt einer bedingten: der Verbund auf die Antworten kostet
  // etwas, und die oeffentliche Liste braucht ihn nie.
  if (!options.withAnswers) {
    const zeilen = await prisma.calendarRegistration.findMany({ where, orderBy });
    return zeilen.map((zeile) => ({
      id: zeile.id,
      discordId: zeile.discordId,
      username: zeile.username,
      displayName: zeile.displayName,
      status: zeile.status,
      waitlistPosition: zeile.waitlistPosition,
      registeredAt: zeile.registeredAt,
      promotedAt: zeile.promotedAt,
      answers: [],
    }));
  }

  const zeilen = await prisma.calendarRegistration.findMany({
    where,
    orderBy,
    include: { answers: { include: { question: { select: { label: true } } } } },
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    discordId: zeile.discordId,
    username: zeile.username,
    displayName: zeile.displayName,
    status: zeile.status,
    waitlistPosition: zeile.waitlistPosition,
    registeredAt: zeile.registeredAt,
    promotedAt: zeile.promotedAt,
    answers: zeile.answers.map((antwort) => ({
      question: antwort.question.label,
      value: antwort.value,
    })),
  }));
}

/** Die eigene Anmeldung - Grundlage der Knopfbeschriftung auf der Detailseite. */
export async function meineAnmeldung(
  eventId: string,
  discordId: string,
): Promise<CalendarRegistration | null> {
  const eintrag = await prisma.calendarRegistration.findUnique({
    where: { eventId_discordId: { eventId, discordId } },
  });
  return eintrag && eintrag.status !== 'CANCELLED' ? eintrag : null;
}

export { forbidden };
