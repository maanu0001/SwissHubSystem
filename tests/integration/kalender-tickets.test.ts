import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_tickets');

/**
 * Mehrere Tickets je Anmeldung - mit und ohne SwissHub-Konto.
 *
 * ## Die drei Zusagen
 *
 * **Jedes Ticket ist ein Platz.** Fünfzig Bestellungen können achtzig Leute
 * sein; wer Zeilen zählt, überbucht den Abend. Die Prüfung läuft unter
 * derselben Zeilensperre wie vorher - sie zählt nur etwas anderes.
 *
 * **Jeder Gast gehört zu jemandem.** Ein Name ohne Konto ist nur dann
 * brauchbar, wenn daneben steht, wer ihn mitbringt.
 *
 * **Der Preis kommt vom Server.** Anzahl mal Eintritt, gerechnet unter der
 * Sperre. Ein Betrag aus dem Browser wäre ein Preisschild, das sich der
 * Käufer selbst schreibt.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil Overselling in der Sperre entsteht. Eine Nachbildung von Prisma hätte
 * keine und würde vor allem sich selbst bestätigen.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const P = calendar.CALENDAR_PERMISSIONS;
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

/** Darf alles rund um Zahlungen, Gäste und Einlass. */
const CREW = {
  discordId: '100000000000000030',
  username: 'crew',
  can: (permission: string) =>
    [
      P.paymentsView,
      P.paymentsVerify,
      P.paymentsWaive,
      P.paymentsRevoke,
      P.paymentsManage,
      P.guestsView,
      P.guestsManage,
      P.ordersManage,
      P.checkIn,
    ].includes(permission as never),
};

/** Ein gewöhnliches Mitglied ohne jede Verwaltungsberechtigung. */
const fremder = (n: number) => ({
  discordId: `94000000000000${String(n).padStart(4, '0')}`,
  username: `fremd${n}`,
  can: () => false,
});

function eingabe(overrides: Record<string, unknown> = {}) {
  return calendar.eventInputSchema.parse({
    title: 'LAN-Abend',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    registrationEnabled: true,
    capacity: 0,
    ...overrides,
  });
}

async function offenesEvent(overrides: Record<string, unknown> = {}) {
  const event = await calendar.createEvent(ADMIN, eingabe(overrides), { darfZahlungen: true });
  return calendar.publishEvent(ADMIN, event.id);
}

const person = (n: number) => ({
  discordId: `95000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
  displayName: `User ${n}`,
});

/** Ein Ticket für sich selbst. */
const fuerMich = (p: ReturnType<typeof person>) => ({
  memberDiscordId: p.discordId,
  memberUsername: p.displayName,
});

const gast = (name: string, extra: Record<string, unknown> = {}) => ({
  guestFirstName: name,
  ...extra,
});

describeWithDatabase('Kalender: Tickets und Gäste', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarTicket","CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
    await prisma.guildConfig?.deleteMany?.({}).catch(() => undefined);
  });

  // --- Mehrere Tickets ------------------------------------------------------

  it('legt ohne Angabe genau ein Ticket auf die anmeldende Person', async () => {
    /*
     * Der alte Weg - und der Weg des Discord-Knopfes bei kostenlosen
     * Terminen. Er muss unveraendert funktionieren.
     */
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(1), event.id);

    const tickets = await prisma.calendarTicket.findMany({ where: { registrationId: registration.id } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.memberDiscordId).toBe(person(1).discordId);
    expect(tickets[0]!.guestFirstName).toBeNull();
    expect(registration.ticketCount).toBe(1);
  });

  it('legt drei Tickets an: eines für sich, zwei für Gäste', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(2), event.id, {}, new Date(), {
      tickets: [fuerMich(person(2)), gast('Gast A'), gast('Gast B')],
    });

    expect(registration.ticketCount).toBe(3);
    const tickets = await prisma.calendarTicket.findMany({
      where: { registrationId: registration.id },
      orderBy: { position: 'asc' },
    });
    expect(tickets.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(tickets[0]!.memberDiscordId).toBe(person(2).discordId);
    expect(tickets[1]!.guestFirstName).toBe('Gast A');
    expect(tickets[2]!.guestFirstName).toBe('Gast B');
  });

  it('erlaubt eine Bestellung nur für Gäste', async () => {
    // Jemand meldet drei Leute an und kommt selbst nicht mit.
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(3), event.id, {}, new Date(), {
      tickets: [gast('Gast A'), gast('Gast B')],
    });

    const tickets = await prisma.calendarTicket.findMany({ where: { registrationId: registration.id } });
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.memberDiscordId === null)).toBe(true);
    // Der Besteller steht trotzdem fest - an der Bestellung.
    expect(registration.discordId).toBe(person(3).discordId);
  });

  it('nimmt einen Gast ohne Discord und ohne E-Mail', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(4), event.id, {}, new Date(), {
      tickets: [gast('Nur ein Vorname')],
    });

    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    expect(ticket.guestFirstName).toBe('Nur ein Vorname');
    expect(ticket.guestEmail).toBeNull();
    expect(ticket.guestDiscordName).toBeNull();
    // Und ausdruecklich keine erfundene Kennung.
    expect(ticket.memberDiscordId).toBeNull();
  });

  it('weist ein Ticket ohne Mitglied und ohne Namen ab', async () => {
    const event = await offenesEvent();
    await expect(calendar.register(person(5), event.id, {}, new Date(), { tickets: [{}] })).rejects.toThrow(
      /Mitglied oder einen Gastnamen/u,
    );
  });

  it('legt für einen Gast kein Mitgliedskonto an', async () => {
    /*
     * Die Zusage, die am leichtesten verloren geht: ein Gast ist ein Name auf
     * einer Liste. Kein DiscordMemberCache-Eintrag, kein Platzhalter.
     */
    const event = await offenesEvent();
    const vorher = await prisma.discordMemberCache.count();
    await calendar.register(person(6), event.id, {}, new Date(), {
      tickets: [fuerMich(person(6)), gast('Gast ohne Konto')],
    });
    expect(await prisma.discordMemberCache.count()).toBe(vorher);
  });

  it('begrenzt die Zahl der Tickets je Bestellung', async () => {
    const event = await offenesEvent();
    await expect(
      calendar.register(person(7), event.id, {}, new Date(), {
        tickets: Array.from({ length: 11 }, (_, i) => gast(`Gast ${i}`)),
      }),
    ).rejects.toThrow(/höchstens/u);
  });

  it('gibt jedem Ticket einen eigenen, zufälligen Token', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(8), event.id, {}, new Date(), {
      tickets: [fuerMich(person(8)), gast('Gast A'), gast('Gast B')],
    });

    const tickets = await prisma.calendarTicket.findMany({ where: { registrationId: registration.id } });
    const tokens = tickets.map((t) => t.token);
    // Drei verschiedene - nicht einer je Bestellung.
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) {
      // 32 Byte als Hex. Und nichts, was sich hochzaehlen laesst.
      expect(token).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  // --- Kapazität ------------------------------------------------------------

  it('zählt jedes Ticket als eigenen Platz', async () => {
    const event = await offenesEvent({ capacity: 100 });
    await calendar.register(person(10), event.id, {}, new Date(), {
      tickets: [fuerMich(person(10)), gast('A'), gast('B')],
    });

    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(3);
    expect(belegung.freeSeats).toBe(97);
    expect(belegung.bestellungen).toBe(1);
  });

  it('reserviert auch mit offener Zahlung', async () => {
    const event = await offenesEvent({ capacity: 10, entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(11), event.id, {}, new Date(), {
      tickets: [fuerMich(person(11)), gast('A')],
    });

    expect(registration.paymentStatus).toBe('PENDING');
    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(2);
    // Reserviert ja - definitiv nein.
    expect(belegung.definitiv).toBe(0);
  });

  it('weist eine Bestellung ab, die nicht mehr ganz hineinpasst', async () => {
    /*
     * Bei 4 von 5 belegten Plaetzen ist noch Platz - aber nicht fuer drei.
     * `belegt >= kapazitaet` haette hier «passt» gesagt.
     */
    const event = await offenesEvent({ capacity: 5, waitlistEnabled: false });
    await calendar.register(person(12), event.id, {}, new Date(), {
      tickets: [fuerMich(person(12)), gast('A'), gast('B'), gast('C')],
    });

    await expect(
      calendar.register(person(13), event.id, {}, new Date(), {
        tickets: [fuerMich(person(13)), gast('D'), gast('E')],
      }),
    ).rejects.toThrow(/kein Platz mehr frei|noch 1 übrig/u);
    expect((await calendar.belegung(event.id)).confirmed).toBe(4);
  });

  it('schickt eine zu grosse Bestellung als Ganzes auf die Warteliste', async () => {
    // Nicht zwei Tickets hinein und eines heraus: eine halb bestaetigte
    // Bestellung haette einen Betrag, der zu nichts passt.
    const event = await offenesEvent({ capacity: 2, waitlistEnabled: true });
    await calendar.register(person(14), event.id, {}, new Date(), { tickets: [fuerMich(person(14))] });

    const zweite = await calendar.register(person(15), event.id, {}, new Date(), {
      tickets: [fuerMich(person(15)), gast('A')],
    });
    expect(zweite.waitlisted).toBe(true);
    expect(zweite.registration.ticketCount).toBe(2);

    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(1);
    expect(belegung.waitlist).toBe(2);
  });

  it('verhindert Overselling bei gleichzeitigen Bestellungen', async () => {
    /*
     * Der eigentliche Fall. Vier Bestellungen zu je drei Tickets auf sechs
     * Plaetze: genau zwei duerfen durchkommen.
     */
    const event = await offenesEvent({ capacity: 6, waitlistEnabled: false });
    const ergebnisse = await Promise.allSettled(
      [20, 21, 22, 23].map((n) =>
        calendar.register(person(n), event.id, {}, new Date(), {
          tickets: [fuerMich(person(n)), gast(`A${n}`), gast(`B${n}`)],
        }),
      ),
    );

    const durch = ergebnisse.filter((e) => e.status === 'fulfilled').length;
    expect(durch).toBe(2);
    expect((await calendar.belegung(event.id)).confirmed).toBe(6);
  });

  it('lässt nach einer Stornierung eine passende Bestellung nachrücken', async () => {
    const event = await offenesEvent({ capacity: 3, waitlistEnabled: true });
    await calendar.register(person(24), event.id, {}, new Date(), {
      tickets: [fuerMich(person(24)), gast('A'), gast('B')],
    });
    const wartend = await calendar.register(person(25), event.id, {}, new Date(), {
      tickets: [fuerMich(person(25)), gast('C')],
    });
    expect(wartend.waitlisted).toBe(true);

    await calendar.unregister(person(24).discordId, event.id);

    const belegung = await calendar.belegung(event.id);
    expect(belegung.confirmed).toBe(2);
    expect(belegung.waitlist).toBe(0);
  });

  it('gibt bei der Abmeldung alle Tickets frei', async () => {
    const event = await offenesEvent({ capacity: 10 });
    await calendar.register(person(26), event.id, {}, new Date(), {
      tickets: [fuerMich(person(26)), gast('A'), gast('B')],
    });
    expect((await calendar.belegung(event.id)).confirmed).toBe(3);

    await calendar.unregister(person(26).discordId, event.id);

    expect((await calendar.belegung(event.id)).confirmed).toBe(0);
    // Und die Ticketzeilen selbst sind storniert, nicht nur die Bestellung.
    const aktive = await prisma.calendarTicket.count({ where: { eventId: event.id, status: 'ACTIVE' } });
    expect(aktive).toBe(0);
  });

  // --- Preis ----------------------------------------------------------------

  it('rechnet den Gesamtbetrag aus Anzahl mal Eintritt', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(30), event.id, {}, new Date(), {
      tickets: [fuerMich(person(30)), gast('A'), gast('B')],
    });

    expect(registration.paymentAmountCents).toBe(4500);
    expect(calendar.betragText(registration.paymentAmountCents, 'CHF')).toBe('CHF 45.–');
  });

  it('rechnet den Preis für ein einzelnes Ticket unverändert', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(31), event.id);
    expect(registration.paymentAmountCents).toBe(1500);
  });

  it('berechnet bei einem kostenlosen Termin nichts', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(32), event.id, {}, new Date(), {
      tickets: [fuerMich(person(32)), gast('A')],
    });
    expect(registration.paymentAmountCents).toBe(0);
    expect(registration.paymentStatus).toBe('NOT_REQUIRED');
  });

  // --- Zuordnung ------------------------------------------------------------

  it('ordnet jeden Gast seinem Besteller zu', async () => {
    const event = await offenesEvent();
    await calendar.register(person(40), event.id, {}, new Date(), {
      tickets: [fuerMich(person(40)), gast('Gast A'), gast('Gast B')],
    });
    await calendar.register(person(41), event.id, {}, new Date(), {
      tickets: [fuerMich(person(41)), gast('Gast C')],
    });

    const zeilen = await calendar.ladeTeilnehmende(event.id);
    const gastA = zeilen.find((z) => z.name === 'Gast A')!;
    const gastC = zeilen.find((z) => z.name === 'Gast C')!;

    expect(gastA.art).toBe('GAST');
    expect(gastA.bestellerDiscordId).toBe(person(40).discordId);
    expect(gastA.bestellerName).toBe('User 40');
    expect(gastC.bestellerDiscordId).toBe(person(41).discordId);

    // Mehrere Gaeste desselben Bestellers zeigen auf dieselbe Person.
    const seine = zeilen.filter((z) => z.bestellerDiscordId === person(40).discordId);
    expect(seine).toHaveLength(3);
  });

  it('zeigt in den Bestellungen, wer dazugehört', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.register(person(42), event.id, {}, new Date(), {
      tickets: [fuerMich(person(42)), gast('Gast A')],
    });

    const bestellungen = await calendar.ladeBestellungen(event.id);
    expect(bestellungen).toHaveLength(1);
    expect(bestellungen[0]!.ticketCount).toBe(2);
    expect(bestellungen[0]!.betragRappen).toBe(3000);
    expect(bestellungen[0]!.tickets.map((t) => t.name)).toEqual(['User 42', 'Gast A']);
  });

  it('gibt dem Besteller seine eigene Bestellung samt Tickets', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.register(person(43), event.id, {}, new Date(), {
      tickets: [fuerMich(person(43)), gast('Gast A')],
    });

    const meine = await calendar.meineBestellung(event.id, person(43).discordId);
    expect(meine).not.toBeNull();
    expect(meine!.tickets).toHaveLength(2);
    expect(meine!.betragRappen).toBe(3000);
    expect(meine!.preisJeTicketRappen).toBe(1500);
    expect(meine!.tickets[0]!.istIch).toBe(true);
    expect(meine!.tickets[1]!.istIch).toBe(false);
  });

  it('gibt einem fremden Mitglied keine fremde Bestellung', async () => {
    const event = await offenesEvent();
    await calendar.register(person(44), event.id, {}, new Date(), {
      tickets: [fuerMich(person(44)), gast('Gast A')],
    });
    expect(await calendar.meineBestellung(event.id, person(45).discordId)).toBeNull();
  });

  // --- Zahlung über die ganze Bestellung ------------------------------------

  it('macht mit einer Bestätigung alle Tickets definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(50), event.id, {}, new Date(), {
      tickets: [fuerMich(person(50)), gast('A'), gast('B')],
    });
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(0);

    await calendar.bestaetigeZahlung(CREW, registration.id);

    // Eine Zahlung, drei definitive Leute.
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(3);
  });

  it('zählt einen Erlass ebenfalls als definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(51), event.id, {}, new Date(), {
      tickets: [fuerMich(person(51)), gast('A')],
    });
    await calendar.erlasseZahlung(CREW, registration.id, 'Crew');
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);
  });

  it('zählt PENDING, CANCELLED und REFUNDED nicht als definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const offen = await calendar.register(person(52), event.id, {}, new Date(), {
      tickets: [fuerMich(person(52)), gast('A')],
    });
    const bezahlt = await calendar.register(person(53), event.id, {}, new Date(), {
      tickets: [fuerMich(person(53))],
    });
    const storniert = await calendar.register(person(54), event.id, {}, new Date(), {
      tickets: [fuerMich(person(54)), gast('B')],
    });

    await calendar.bestaetigeZahlung(CREW, bezahlt.registration.id);
    await calendar.unregister(person(54).discordId, event.id);

    expect(offen.registration.paymentStatus).toBe('PENDING');
    expect(storniert.registration.id).toBeTruthy();
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(1);

    // Und nach einer Erstattung faellt die Bestellung wieder heraus.
    await calendar.nimmBestaetigungZurueck(CREW, bezahlt.registration.id, 'REFUNDED', 'zurück');
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(0);
  });

  it('rechnet die Kennzahlen getrennt nach Bestellungen und Tickets', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500, capacity: 100 });
    const a = await calendar.register(person(60), event.id, {}, new Date(), {
      tickets: [fuerMich(person(60)), gast('A1'), gast('A2')],
    });
    await calendar.register(person(61), event.id, {}, new Date(), {
      tickets: [fuerMich(person(61)), gast('B1')],
    });
    const c = await calendar.register(person(62), event.id, {}, new Date(), {
      tickets: [fuerMich(person(62))],
    });

    await calendar.bestaetigeZahlung(CREW, a.registration.id);
    await calendar.erlasseZahlung(CREW, c.registration.id, 'Gast');

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    // Drei Bestellungen, sechs Tickets, vier davon definitiv.
    expect(kennzahlen.angemeldet).toBe(3);
    expect(kennzahlen.reservierteTickets).toBe(6);
    expect(kennzahlen.definitiveTickets).toBe(4);
    expect(kennzahlen.definitiveGaeste).toBe(2);
    expect(kennzahlen.ausstehend).toBe(1);
    expect(kennzahlen.ausstehendeTickets).toBe(2);
    expect(kennzahlen.eingegangenRappen).toBe(4500);
  });

  // --- Gäste ändern und Tickets stornieren ----------------------------------

  it('lässt den Besteller seinen eigenen Gast ändern', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(70), event.id, {}, new Date(), {
      tickets: [fuerMich(person(70)), gast('Gast A')],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast A' },
    });

    const besteller = { ...person(70), can: () => false };
    const geaendert = await calendar.aendereTicket(besteller, ticket.id, {
      guestFirstName: 'Gast B',
      guestLastName: 'Meier',
    });

    expect(geaendert.guestFirstName).toBe('Gast B');
    expect(geaendert.guestLastName).toBe('Meier');
    // Derselbe Token: der Platz bleibt, nur die Person wechselt.
    expect(geaendert.token).toBe(ticket.token);
  });

  it('lässt ein fremdes Mitglied ein fremdes Ticket nicht ändern', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(71), event.id, {}, new Date(), {
      tickets: [fuerMich(person(71)), gast('Gast A')],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast A' },
    });

    await expect(
      calendar.aendereTicket(fremder(1), ticket.id, { guestFirstName: 'Eindringling' }),
    ).rejects.toThrow(/calendar\.guests\.manage/u);
  });

  it('gibt beim Stornieren eines Tickets den Platz frei', async () => {
    const event = await offenesEvent({ capacity: 10 });
    const { registration } = await calendar.register(person(72), event.id, {}, new Date(), {
      tickets: [fuerMich(person(72)), gast('A'), gast('B')],
    });
    expect((await calendar.belegung(event.id)).confirmed).toBe(3);

    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'B' },
    });
    const ergebnis = await calendar.storniereTicket(CREW, ticket.id, 'kann nicht');

    expect(ergebnis.verbleibend).toBe(2);
    expect((await calendar.belegung(event.id)).confirmed).toBe(2);
    // Die Zusammenfassung an der Bestellung laeuft mit.
    const nachher = await prisma.calendarRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(nachher.ticketCount).toBe(2);
  });

  it('lässt den Gesamtbetrag beim Ticketstorno stehen', async () => {
    /*
     * Das Geld ist gekommen. Ob etwas zurueckgeht, entscheidet ein Mensch -
     * eine automatisch reduzierte Summe waere eine Rueckzahlung, die niemand
     * veranlasst hat.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(73), event.id, {}, new Date(), {
      tickets: [fuerMich(person(73)), gast('A'), gast('B')],
    });
    await calendar.bestaetigeZahlung(CREW, registration.id);

    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'B' },
    });
    await calendar.storniereTicket(CREW, ticket.id, null);

    const nachher = await prisma.calendarRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(nachher.paymentAmountCents).toBe(4500);
    expect(nachher.paymentStatus).toBe('VERIFIED');
    // Aber nur noch zwei kommen.
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);
  });

  it('storniert mit dem letzten Ticket die ganze Bestellung', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(74), event.id, {}, new Date(), {
      tickets: [fuerMich(person(74))],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });

    const ergebnis = await calendar.storniereTicket(CREW, ticket.id, null);
    expect(ergebnis.verbleibend).toBe(0);

    const nachher = await prisma.calendarRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(nachher.status).toBe('CANCELLED');
  });

  // --- Check-in -------------------------------------------------------------

  it('checkt einzelne Tickets getrennt ein', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(80), event.id, {}, new Date(), {
      tickets: [fuerMich(person(80)), gast('Gast A')],
    });
    await calendar.bestaetigeZahlung(CREW, registration.id);

    const tickets = await prisma.calendarTicket.findMany({
      where: { registrationId: registration.id },
      orderBy: { position: 'asc' },
    });

    const erstes = await calendar.checkeEin(CREW, tickets[0]!.id);
    expect(erstes.geaendert).toBe(true);
    expect(erstes.art).toBe('MITGLIED');

    // Das zweite ist noch offen - sie treffen getrennt ein.
    const zweites = await prisma.calendarTicket.findUniqueOrThrow({ where: { id: tickets[1]!.id } });
    expect(zweites.checkedInAt).toBeNull();

    const gastCheck = await calendar.checkeEin(CREW, tickets[1]!.id);
    expect(gastCheck.geaendert).toBe(true);
    expect(gastCheck.art).toBe('GAST');
    expect(gastCheck.name).toBe('Gast A');
    expect(gastCheck.bestelltVon).toBe(person(80).discordId);
  });

  it('meldet einen zweiten Scan als bereits eingecheckt', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(81), event.id);
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });

    await calendar.checkeEin(CREW, ticket.id);
    const zweiter = await calendar.checkeEin(CREW, ticket.id);
    expect(zweiter.geaendert).toBe(false);
    expect(zweiter.ticket.checkedInAt).not.toBeNull();
  });

  it('blockiert den Check-in bei offener Zahlung', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(82), event.id);
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });

    await expect(calendar.checkeEin(CREW, ticket.id)).rejects.toThrow(/Zahlung noch nicht bestätigt/u);

    // Nach der Bestaetigung geht es.
    await calendar.bestaetigeZahlung(CREW, registration.id);
    const nachher = await calendar.checkeEin(CREW, ticket.id);
    expect(nachher.geaendert).toBe(true);
  });

  it('lässt einen Erlass durch den Check-in', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(83), event.id);
    await calendar.erlasseZahlung(CREW, registration.id, 'Sponsor');
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    expect((await calendar.checkeEin(CREW, ticket.id)).geaendert).toBe(true);
  });

  it('blockiert den Check-in eines stornierten Tickets', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(84), event.id, {}, new Date(), {
      tickets: [fuerMich(person(84)), gast('A')],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'A' },
    });
    await calendar.storniereTicket(CREW, ticket.id, null);

    await expect(calendar.checkeEin(CREW, ticket.id)).rejects.toThrow(/storniert/u);
  });

  it('lässt niemanden ohne Berechtigung einchecken', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(85), event.id);
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    await expect(calendar.checkeEin(fremder(2), ticket.id)).rejects.toThrow(/calendar\.checkin/u);
  });

  it('nimmt einen Check-in zurück', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(86), event.id);
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });
    await calendar.checkeEin(CREW, ticket.id);

    const zurueck = await calendar.nimmCheckInZurueck(CREW, ticket.id);
    expect(zurueck.checkedInAt).toBeNull();
    expect(zurueck.checkedInByUsername).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_TICKET_CHECKIN_REVOKED' } })).toBe(1);
  });

  it('sperrt das Ändern eines eingecheckten Tickets', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(87), event.id, {}, new Date(), {
      tickets: [fuerMich(person(87)), gast('Gast A')],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast A' },
    });
    await calendar.checkeEin(CREW, ticket.id);

    await expect(
      calendar.aendereTicket(CREW, ticket.id, { guestFirstName: 'Jemand anderes' }),
    ).rejects.toThrow(/eingecheckt/u);
  });

  it('findet ein Ticket über seinen Token', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(88), event.id, {}, new Date(), {
      tickets: [gast('Gast A')],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id },
    });

    const gefunden = await calendar.ticketZuToken(ticket.token);
    expect(gefunden?.id).toBe(ticket.id);
    expect(gefunden?.registration.discordId).toBe(person(88).discordId);

    // Ein Token, den es nicht gibt, ist eine Auskunft und kein Ausnahmefall.
    expect(await calendar.ticketZuToken('0'.repeat(64))).toBeNull();
    expect(await calendar.ticketZuToken('offensichtlich-kein-token')).toBeNull();
  });

  // --- Audit ----------------------------------------------------------------

  it('protokolliert Ticketänderung, Storno und Check-in', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(90), event.id, {}, new Date(), {
      tickets: [fuerMich(person(90)), gast('Gast A', { guestEmail: 'gast-a@example.invalid' })],
    });
    const ticket = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast A' },
    });

    await calendar.aendereTicket(CREW, ticket.id, { guestFirstName: 'Gast B' });
    await calendar.checkeEin(CREW, ticket.id);
    await calendar.nimmCheckInZurueck(CREW, ticket.id);
    await calendar.storniereTicket(CREW, ticket.id, 'Test');

    for (const aktion of [
      'CALENDAR_TICKET_UPDATED',
      'CALENDAR_TICKET_CHECKED_IN',
      'CALENDAR_TICKET_CHECKIN_REVOKED',
      'CALENDAR_TICKET_CANCELLED',
    ]) {
      expect(await prisma.auditLog.count({ where: { action: aktion } }), aktion).toBeGreaterThan(0);
    }

    /*
     * Und keine Gast-E-Mail im Protokoll.
     *
     * Das Protokoll wird von mehr Leuten gelesen als die Gastliste. Was
     * jemand fuer eine Reservierung hinterlegt hat, gehoert nicht in einen
     * Verlauf, der ueberall auftaucht.
     */
    const eintraege = await prisma.auditLog.findMany({ where: { module: 'calendar' } });
    // Die laufende Nummer ist ein BigInt - `JSON.stringify` braucht eine Regel.
    const alsText = JSON.stringify(eintraege, (_schluessel, wert) =>
      typeof wert === 'bigint' ? wert.toString() : wert,
    );
    expect(alsText).not.toContain('gast-a@example.invalid');
  });
});
