import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_nachkauf');

/**
 * Weitere Tickets zu einer bestehenden Anmeldung.
 *
 * ## Die drei Zusagen
 *
 * **Eine Bestellung, die wächst.** Keine zweite Bestellung derselben Person -
 * die Datenbank lässt sie nicht zu, und sie wäre auch falsch: zwei Beträge
 * und zwei Zahlungsstände für einen Menschen, der einmal überweist.
 *
 * **Bezahlte Tickets bleiben bezahlt.** Wer zwei Tickets bezahlt hat und ein
 * drittes dazunimmt, hat zwei definitive Leute und einen vorläufigen. Nicht
 * drei bezahlte, und nicht drei offene.
 *
 * **Neue Tickets sind nicht bezahlt.** Auch dann nicht, wenn die Bestellung
 * bestätigt war. SwissHub sieht keine Kontobewegung; dass jemand zwei Tickets
 * bezahlt hat, sagt nichts über das dritte.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil die Kapazitätsprüfung eine Zeilensperre ist und der Zahlungsstand je
 * Ticket eine bedingte Aktualisierung. Eine Nachbildung von Prisma hätte
 * beides nicht.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const P = calendar.CALENDAR_PERMISSIONS;
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

const KASSE = {
  discordId: '100000000000000020',
  username: 'kasse',
  can: (permission: string) =>
    [P.paymentsView, P.paymentsVerify, P.paymentsWaive, P.paymentsRevoke, P.ordersManage, P.checkIn].includes(
      permission as never,
    ),
};

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
  discordId: `96000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
  displayName: `User ${n}`,
});

const fuerMich = (p: ReturnType<typeof person>) => ({
  memberDiscordId: p.discordId,
  memberUsername: p.displayName,
});

const gast = (name: string) => ({ guestFirstName: name });

const tickets = (registrationId: string) =>
  prisma.calendarTicket.findMany({
    where: { registrationId },
    orderBy: { position: 'asc' },
  });

describeWithDatabase('Kalender: Tickets nachbestellen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarTicket","CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","MemberProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
    await prisma.guildConfig?.deleteMany?.({}).catch(() => undefined);
  });

  // --- Ohne bestehende Anmeldung -------------------------------------------

  it('weist einen Nachkauf ohne Anmeldung ab', async () => {
    const event = await offenesEvent();
    await expect(calendar.ergaenzeTickets(person(1), event.id, [gast('Gast A')])).rejects.toThrow(
      /nicht angemeldet/u,
    );
  });

  it('weist einen Nachkauf nach einer Abmeldung ab', async () => {
    const event = await offenesEvent();
    await calendar.register(person(2), event.id);
    await calendar.unregister(person(2).discordId, event.id);

    await expect(calendar.ergaenzeTickets(person(2), event.id, [gast('Gast A')])).rejects.toThrow(
      /nicht angemeldet/u,
    );
  });

  it('weist einen Nachkauf auf der Warteliste ab', async () => {
    /*
     * Eine wartende Bestellung haelt noch keinen Platz, und `rueckeNach` nimmt
     * nur Bestellungen, die als Ganzes hineinpassen. Sie waehrend des Wartens
     * wachsen zu lassen hiesse, ihre Chancen still zu verschlechtern.
     */
    const event = await offenesEvent({ capacity: 1, waitlistEnabled: true });
    await calendar.register(person(3), event.id);
    const wartend = await calendar.register(person(4), event.id);
    expect(wartend.waitlisted).toBe(true);

    await expect(calendar.ergaenzeTickets(person(4), event.id, [gast('Gast A')])).rejects.toThrow(
      /Warteliste/u,
    );
  });

  it('weist einen leeren Nachkauf ab', async () => {
    const event = await offenesEvent();
    await calendar.register(person(5), event.id);
    await expect(calendar.ergaenzeTickets(person(5), event.id, [])).rejects.toThrow(/mindestens ein Ticket/u);
  });

  // --- Der Normalfall: noch offene Zahlung ---------------------------------

  it('hängt ein Ticket an eine bestehende Bestellung, statt eine zweite anzulegen', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(10), event.id);

    const ergebnis = await calendar.ergaenzeTickets(person(10), event.id, [gast('Gast A')]);

    expect(ergebnis.ergaenzt).toBe(1);
    expect(ergebnis.registration.id).toBe(registration.id);
    // Genau eine Bestellung, zwei Tickets.
    expect(await prisma.calendarRegistration.count({ where: { eventId: event.id } })).toBe(1);
    expect(await tickets(registration.id)).toHaveLength(2);
    expect(ergebnis.registration.ticketCount).toBe(2);
  });

  it('setzt die Positionen hinter den bestehenden auf', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(11), event.id, {}, new Date(), {
      tickets: [fuerMich(person(11)), gast('A')],
    });
    await calendar.ergaenzeTickets(person(11), event.id, [gast('B'), gast('C')]);

    const alle = await tickets(registration.id);
    expect(alle.map((t) => t.position)).toEqual([0, 1, 2, 3]);
    expect(alle.map((t) => t.guestFirstName)).toEqual([null, 'A', 'B', 'C']);
  });

  it('gibt jedem nachbestellten Ticket einen eigenen Token', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(12), event.id);
    await calendar.ergaenzeTickets(person(12), event.id, [gast('A'), gast('B')]);

    const alle = await tickets(registration.id);
    expect(new Set(alle.map((t) => t.token)).size).toBe(3);
    for (const eintrag of alle) {
      expect(eintrag.token).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('rechnet den Gesamtbetrag bei offener Zahlung neu', async () => {
    // 2 × CHF 15 = CHF 30, plus ein Ticket → CHF 45 offen.
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(13), event.id, {}, new Date(), {
      tickets: [fuerMich(person(13)), gast('A')],
    });
    expect(registration.paymentAmountCents).toBe(3000);

    const ergebnis = await calendar.ergaenzeTickets(person(13), event.id, [gast('B')]);

    expect(ergebnis.zusatzbetragRappen).toBe(1500);
    expect(ergebnis.registration.paymentAmountCents).toBe(4500);
    expect(ergebnis.offenRappen).toBe(4500);
    // Und die Bestellung bleibt offen.
    expect(ergebnis.registration.paymentStatus).toBe('PENDING');
  });

  it('berechnet bei einem kostenlosen Termin nichts und macht sofort definitiv', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(14), event.id);
    const ergebnis = await calendar.ergaenzeTickets(person(14), event.id, [gast('A')]);

    expect(ergebnis.zusatzbetragRappen).toBe(0);
    expect(ergebnis.offenRappen).toBe(0);
    expect(ergebnis.registration.paymentStatus).toBe('NOT_REQUIRED');
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);
    const alle = await tickets(registration.id);
    expect(alle.every((t) => t.settledStatus === 'NOT_REQUIRED')).toBe(true);
  });

  it('friert den Preis je Ticket ein', async () => {
    /*
     * Die Organisation erhoeht den Eintritt zwischen Anmeldung und Nachkauf.
     * Das erste Ticket bleibt bei 15, das zweite kostet 20 - niemand schuldet
     * rueckwirkend mehr.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(15), event.id);

    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 2000 }), {
      darfZahlungen: true,
    });
    const ergebnis = await calendar.ergaenzeTickets(person(15), event.id, [gast('A')]);

    const alle = await tickets(registration.id);
    expect(alle.map((t) => t.priceCents)).toEqual([1500, 2000]);
    expect(ergebnis.zusatzbetragRappen).toBe(2000);
    expect(ergebnis.registration.paymentAmountCents).toBe(3500);
  });

  // --- Der schwierige Fall: bereits bestätigte Bestellung ------------------

  it('macht nachbestellte Tickets NICHT automatisch bezahlt', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(20), event.id, {}, new Date(), {
      tickets: [fuerMich(person(20)), gast('A')],
    });
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);

    await calendar.ergaenzeTickets(person(20), event.id, [gast('B')]);

    const alle = await tickets(registration.id);
    const neu = alle.find((t) => t.guestFirstName === 'B')!;
    expect(neu.settledStatus).toBeNull();
    expect(neu.settledAt).toBeNull();
    // Zwei definitive, einer vorlaeufig.
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);
  });

  it('lässt bereits bestätigte Tickets definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(21), event.id, {}, new Date(), {
      tickets: [fuerMich(person(21)), gast('A')],
    });
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    const vorher = await tickets(registration.id);

    await calendar.ergaenzeTickets(person(21), event.id, [gast('B')]);

    const nachher = await tickets(registration.id);
    for (const alt of vorher) {
      const jetzt = nachher.find((t) => t.id === alt.id)!;
      expect(jetzt.settledStatus).toBe('VERIFIED');
      // Auch der Zeitpunkt bleibt - er ist die Spur der ersten Bestaetigung.
      expect(jetzt.settledAt?.getTime()).toBe(alt.settledAt?.getTime());
    }
  });

  it('setzt die Bestellung wieder auf offen, behält aber die Spur der Bestätigung', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(22), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);

    const ergebnis = await calendar.ergaenzeTickets(person(22), event.id, [gast('A')]);

    // «Bestaetigt» waere jetzt eine falsche Auskunft: es steht Geld aus.
    expect(ergebnis.registration.paymentStatus).toBe('PENDING');
    // Aber wer bestaetigt hat, bleibt sichtbar.
    expect(ergebnis.registration.paymentVerifiedAt).not.toBeNull();
    expect(ergebnis.registration.paymentVerifiedByUsername).toBe('kasse');
    // Offen ist nur der Nachkauf, nicht der Gesamtbetrag.
    expect(ergebnis.registration.paymentAmountCents).toBe(3000);
    expect(ergebnis.offenRappen).toBe(1500);
  });

  it('macht mit der zweiten Bestätigung nur die neuen Tickets definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(23), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    const ersterZeitpunkt = (await tickets(registration.id))[0]!.settledAt!;

    await calendar.ergaenzeTickets(person(23), event.id, [gast('A')]);
    await calendar.bestaetigeZahlung(KASSE, registration.id);

    const alle = await tickets(registration.id);
    expect(alle.every((t) => t.settledStatus === 'VERIFIED')).toBe(true);
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(2);
    // Das erste Ticket behaelt seinen Zeitpunkt.
    expect(alle[0]!.settledAt?.getTime()).toBe(ersterZeitpunkt.getTime());
    // Das zweite hat einen spaeteren.
    expect(alle[1]!.settledAt!.getTime()).toBeGreaterThanOrEqual(ersterZeitpunkt.getTime());
  });

  it('macht mit einem Erlass die alten bezahlten Tickets nicht zu erlassenen', async () => {
    /*
     * Sonst faende die Kasse einen Betrag nicht wieder, den sie erhalten hat:
     * «erlassen» zaehlt ausdruecklich nicht als eingegangen.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(24), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.ergaenzeTickets(person(24), event.id, [gast('A')]);
    await calendar.erlasseZahlung(KASSE, registration.id, 'Crew');

    const alle = await tickets(registration.id);
    expect(alle.map((t) => t.settledStatus)).toEqual(['VERIFIED', 'WAIVED']);

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    // Eingegangen ist nur das bezahlte Ticket.
    expect(kennzahlen.eingegangenRappen).toBe(1500);
    expect(kennzahlen.offenRappen).toBe(0);
    expect(kennzahlen.definitiveTickets).toBe(2);
  });

  it('öffnet bei einer Rücknahme alle Tickets der Bestellung', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(25), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.ergaenzeTickets(person(25), event.id, [gast('A')]);
    await calendar.bestaetigeZahlung(KASSE, registration.id);

    await calendar.nimmBestaetigungZurueck(KASSE, registration.id, 'PENDING', 'Irrtum');

    const alle = await tickets(registration.id);
    expect(alle.every((t) => t.settledStatus === null)).toBe(true);
    expect(await calendar.definitiveTeilnehmer(event.id)).toBe(0);
  });

  it('zeigt in den Kennzahlen offen und eingegangen getrennt', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(26), event.id, {}, new Date(), {
      tickets: [fuerMich(person(26)), gast('A')],
    });
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.ergaenzeTickets(person(26), event.id, [gast('B'), gast('C')]);

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    expect(kennzahlen.eingegangenRappen).toBe(3000); // zwei bezahlte
    expect(kennzahlen.offenRappen).toBe(3000); // zwei neue
    expect(kennzahlen.definitiveTickets).toBe(2);
    expect(kennzahlen.ausstehendeTickets).toBe(2);
    expect(kennzahlen.reservierteTickets).toBe(4);
  });

  // --- Kapazität ------------------------------------------------------------

  it('prüft die Kapazität erneut und lehnt sauber ab', async () => {
    // Kapazitaet 5, drei belegt - drei weitere passen nicht.
    const event = await offenesEvent({ capacity: 5, waitlistEnabled: false });
    await calendar.register(person(30), event.id, {}, new Date(), {
      tickets: [fuerMich(person(30)), gast('A'), gast('B')],
    });

    await expect(
      calendar.ergaenzeTickets(person(30), event.id, [gast('C'), gast('D'), gast('E')]),
    ).rejects.toThrow(/noch 2 übrig/u);
    // Nichts angelegt - kein halber Nachkauf.
    expect((await calendar.belegung(event.id)).confirmed).toBe(3);
  });

  it('lässt genau so viele Tickets zu, wie noch frei sind', async () => {
    const event = await offenesEvent({ capacity: 5, waitlistEnabled: false });
    await calendar.register(person(31), event.id, {}, new Date(), {
      tickets: [fuerMich(person(31)), gast('A'), gast('B')],
    });
    await calendar.ergaenzeTickets(person(31), event.id, [gast('C'), gast('D')]);
    expect((await calendar.belegung(event.id)).confirmed).toBe(5);
  });

  it('meldet bei ausgebuchtem Termin, dass es ausgebucht ist', async () => {
    const event = await offenesEvent({ capacity: 2, waitlistEnabled: false });
    await calendar.register(person(32), event.id, {}, new Date(), {
      tickets: [fuerMich(person(32)), gast('A')],
    });
    await expect(calendar.ergaenzeTickets(person(32), event.id, [gast('B')])).rejects.toThrow(/ausgebucht/u);
  });

  it('verhindert Overselling bei gleichzeitigen Nachkäufen', async () => {
    /*
     * Zwei Leute kaufen gleichzeitig je zwei Tickets nach; frei sind drei.
     * Genau einer darf durchkommen.
     */
    const event = await offenesEvent({ capacity: 5, waitlistEnabled: false });
    await calendar.register(person(33), event.id);
    await calendar.register(person(34), event.id);
    expect((await calendar.belegung(event.id)).confirmed).toBe(2);

    const ergebnisse = await Promise.allSettled([
      calendar.ergaenzeTickets(person(33), event.id, [gast('A'), gast('B')]),
      calendar.ergaenzeTickets(person(34), event.id, [gast('C'), gast('D')]),
    ]);

    expect(ergebnisse.filter((e) => e.status === 'fulfilled')).toHaveLength(1);
    expect((await calendar.belegung(event.id)).confirmed).toBe(4);
  });

  it('begrenzt die Gesamtzahl je Bestellung', async () => {
    const event = await offenesEvent();
    await calendar.register(person(35), event.id, {}, new Date(), {
      tickets: Array.from({ length: 8 }, (_, i) => gast(`Gast ${i}`)),
    });
    await expect(
      calendar.ergaenzeTickets(person(35), event.id, [gast('X'), gast('Y'), gast('Z')]),
    ).rejects.toThrow(/höchstens 10 Tickets - du hast bereits 8/u);
  });

  it('zählt ein storniertes Ticket nicht gegen die Obergrenze', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(36), event.id, {}, new Date(), {
      tickets: Array.from({ length: 10 }, (_, i) => gast(`Gast ${i}`)),
    });
    const eines = (await tickets(registration.id))[0]!;
    await calendar.storniereTicket(KASSE, eines.id, null);

    // Jetzt ist wieder Platz fuer genau eines.
    const ergebnis = await calendar.ergaenzeTickets(person(36), event.id, [gast('Neu')]);
    expect(ergebnis.ergaenzt).toBe(1);
  });

  // --- Sonstiges ------------------------------------------------------------

  it('lässt ein zweites Ticket auf die eigene Person zu, wenn es keines gab', async () => {
    // Jemand hat nur fuer Gaeste bestellt und kommt jetzt doch mit.
    const event = await offenesEvent();
    await calendar.register(person(40), event.id, {}, new Date(), { tickets: [gast('A')] });
    await calendar.ergaenzeTickets(person(40), event.id, [fuerMich(person(40))]);

    const meine = await calendar.meineBestellung(event.id, person(40).discordId);
    expect(meine!.tickets).toHaveLength(2);
    expect(meine!.tickets.filter((t) => t.istIch)).toHaveLength(1);
  });

  it('weist einen Nachkauf nach Ablauf der Anmeldefrist ab', async () => {
    const event = await offenesEvent({
      registrationClosesAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await calendar.register(person(41), event.id);

    // Ein Zeitpunkt nach der Frist.
    await expect(
      calendar.ergaenzeTickets(person(41), event.id, [gast('A')], new Date(Date.now() + 7200_000)),
    ).rejects.toThrow(/Anmeldefrist/u);
  });

  it('protokolliert den Nachkauf', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.register(person(42), event.id);
    await calendar.ergaenzeTickets(person(42), event.id, [gast('A')]);

    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'CALENDAR_TICKETS_ADDED' },
      orderBy: { id: 'desc' },
    });
    expect(eintrag).not.toBeNull();
    expect(eintrag!.actorDiscordId).toBe(person(42).discordId);
    const daten = eintrag!.metadata as Record<string, unknown>;
    expect(daten.ergaenzt).toBe(1);
    expect(daten.zusatzbetragRappen).toBe(1500);
    expect(daten.gesamtTickets).toBe(2);
  });

  it('gibt dem Besteller den offenen Betrag und nicht den Gesamtbetrag', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(43), event.id, {}, new Date(), {
      tickets: [fuerMich(person(43)), gast('A')],
    });
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.ergaenzeTickets(person(43), event.id, [gast('B')]);

    const meine = await calendar.meineBestellung(event.id, person(43).discordId);
    expect(meine!.betragRappen).toBe(4500);
    // Zu bezahlen ist nur noch der Nachkauf.
    expect(meine!.offenRappen).toBe(1500);
    expect(meine!.tickets.map((t) => t.erledigt)).toEqual([true, true, false]);
  });

  it('verhindert den Check-in eines nachbestellten, noch offenen Tickets', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(44), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.ergaenzeTickets(person(44), event.id, [gast('A')]);

    const alle = await tickets(registration.id);
    // Das alte Ticket kommt herein.
    expect((await calendar.checkeEin(KASSE, alle[0]!.id)).geaendert).toBe(true);
    // Das neue nicht.
    await expect(calendar.checkeEin(KASSE, alle[1]!.id)).rejects.toThrow(/Zahlung noch nicht bestätigt/u);
  });
});
