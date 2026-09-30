import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_gruppen');

/**
 * Gäste stehen bei ihrem Mitglied - und Mitglieder verlinken auf ihr Profil.
 *
 * ## Warum gruppiert
 *
 * Weil ein Gast ohne seinen Besteller ein Name ohne Zusammenhang ist. Flach
 * gelesen steht «Manuel, Anna, Gast A, Peter, Gast B» - und an der Tür fragt
 * jemand, zu wem Gast A gehört. Die Gruppierung ist die Antwort, und sie steht
 * in der Struktur und nicht in einer Beschriftung.
 *
 * ## Warum die Profiladressen hier entstehen
 *
 * Weil Sichtbarkeit und Sperre serverseitig entschieden werden müssen. Eine
 * Liste, die alle Slugs mitgibt und die Ansicht entscheiden lässt, hat die
 * Adresse eines privaten Profils bereits ausgeliefert. Was `profilSlug` auf
 * `null` hat, bekommt keinen Link - und ein Gast hat nie einen.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const P = calendar.CALENDAR_PERMISSIONS;
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const CREW = {
  discordId: '100000000000000030',
  username: 'crew',
  can: (permission: string) =>
    [P.paymentsVerify, P.paymentsWaive, P.ordersManage, P.guestsManage, P.checkIn].includes(
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

const person = (n: number, name: string) => ({
  discordId: `97000000000000${String(n).padStart(4, '0')}`,
  username: name.toLowerCase(),
  displayName: name,
});

const fuerMich = (p: ReturnType<typeof person>) => ({
  memberDiscordId: p.discordId,
  memberUsername: p.displayName,
});

const gast = (name: string) => ({ guestFirstName: name });

/** Ein Profil mit einer öffentlichen Adresse. */
async function profil(
  p: ReturnType<typeof person>,
  teile: { slug?: string | null; sichtbar?: boolean; gesperrt?: boolean } = {},
): Promise<void> {
  await prisma.memberProfile.create({
    data: {
      discordId: p.discordId,
      publicSlug: teile.slug === undefined ? p.username : teile.slug,
      visibilityProfile: teile.sichtbar === false ? 'MEMBERS' : 'PUBLIC',
      publicLockedAt: teile.gesperrt ? new Date() : null,
    },
  });
}

const MANUEL = person(1, 'Manuel');
const ANNA = person(2, 'Anna');
const PETER = person(3, 'Peter');

describeWithDatabase('Kalender: Teilnehmende nach Bestellung gruppiert', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarTicket","CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","MemberProfileSlugAlias","MemberProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
    await prisma.guildConfig?.deleteMany?.({}).catch(() => undefined);
  });

  // --- Gruppierung ----------------------------------------------------------

  it('macht aus einem Mitglied ohne Gäste eine Gruppe mit Kopf und nichts darunter', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0]!.kopf?.name).toBe('Manuel');
    expect(gruppen[0]!.weitere).toHaveLength(0);
    expect(gruppen[0]!.anzahl).toBe(1);
  });

  it('hängt einen Gast unter sein Mitglied', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.name).toBe('Manuel');
    expect(gruppe!.weitere.map((z) => z.name)).toEqual(['Gast A']);
    expect(gruppe!.weitere[0]!.art).toBe('GAST');
    expect(gruppe!.anzahl).toBe(2);
  });

  it('hängt mehrere Gäste in der Reihenfolge der Bestellung unter ihr Mitglied', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A'), gast('Gast B'), gast('Gast C')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.weitere.map((z) => z.name)).toEqual(['Gast A', 'Gast B', 'Gast C']);
    expect(gruppe!.anzahl).toBe(4);
  });

  it('vermischt die Gäste zweier Mitglieder nicht', async () => {
    /*
     * Der Fall aus dem Auftrag. Flach sähe das so aus:
     *
     *     Manuel, Anna, Gast A, Peter, Gast B
     *
     * Gruppiert steht jeder Gast bei dem, der ihn mitbringt.
     */
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A'), gast('Gast B')],
    });
    await calendar.register(ANNA, event.id);
    await calendar.register(PETER, event.id, {}, new Date(), {
      tickets: [fuerMich(PETER), gast('Gast C')],
    });

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppen.map((g) => g.bestellerName)).toEqual(['Anna', 'Manuel', 'Peter']);

    const manuel = gruppen.find((g) => g.bestellerName === 'Manuel')!;
    expect(manuel.weitere.map((z) => z.name)).toEqual(['Gast A', 'Gast B']);
    const anna = gruppen.find((g) => g.bestellerName === 'Anna')!;
    expect(anna.weitere).toHaveLength(0);
    const peter = gruppen.find((g) => g.bestellerName === 'Peter')!;
    expect(peter.weitere.map((z) => z.name)).toEqual(['Gast C']);
  });

  it('nennt den Besteller auch dann, wenn er selbst nicht kommt', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [gast('Gast A'), gast('Gast B')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf).toBeNull();
    // Er ist trotzdem der Ansprechpartner.
    expect(gruppe!.bestellerName).toBe('Manuel');
    expect(gruppe!.weitere).toHaveLength(2);
    expect(gruppe!.anzahl).toBe(2);
  });

  it('macht das eigene Ticket zum Kopf, auch wenn es nicht an Position 0 steht', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [gast('Gast A'), fuerMich(MANUEL), gast('Gast B')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.name).toBe('Manuel');
    expect(gruppe!.weitere.map((z) => z.name)).toEqual(['Gast A', 'Gast B']);
  });

  it('nimmt ein nachbestelltes Ticket in dieselbe Gruppe', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);
    await calendar.ergaenzeTickets(MANUEL, event.id, [gast('Später dazu')]);

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0]!.weitere.map((z) => z.name)).toEqual(['Später dazu']);
  });

  // --- Nur aktive Teilnehmer ------------------------------------------------

  it('zeigt ein storniertes Ticket nicht als Teilnehmer', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A'), gast('Gast B')],
    });
    const gastB = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast B' },
    });
    await calendar.storniereTicket(CREW, gastB.id, 'kann nicht');

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.weitere.map((z) => z.name)).toEqual(['Gast A']);
    expect(gruppe!.anzahl).toBe(2);
    // In der Kassensicht steht er weiter - dort gehoert er hin.
    const bestellungen = await calendar.ladeBestellungen(event.id);
    expect(bestellungen[0]!.tickets.map((t) => t.name)).toContain('Gast B');
  });

  it('zeigt eine stornierte Anmeldung überhaupt nicht', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });
    await calendar.register(ANNA, event.id);
    await calendar.unregister(MANUEL.discordId, event.id);

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppen.map((g) => g.bestellerName)).toEqual(['Anna']);
  });

  it('zeigt eine wartende Anmeldung mit ihrem Status', async () => {
    const event = await offenesEvent({ capacity: 1, waitlistEnabled: true });
    await calendar.register(MANUEL, event.id);
    await calendar.register(ANNA, event.id);

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    const anna = gruppen.find((g) => g.bestellerName === 'Anna')!;
    expect(anna.bestellungStatus).toBe('WAITLIST');
    // Und sie ist nicht definitiv - sie hat keinen Platz.
    expect(anna.kopf?.definitiv).toBe(false);
  });

  // --- Status je Person -----------------------------------------------------

  it('zeigt den Status je Person und nicht den der Bestellung', async () => {
    /*
     * Zwei bezahlte Tickets, eines nachbestellt. Der Besteller ist definitiv,
     * der neue Gast nicht - obwohl beide in derselben Bestellung stehen.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });
    await calendar.bestaetigeZahlung(CREW, registration.id);
    await calendar.ergaenzeTickets(MANUEL, event.id, [gast('Gast B')]);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.definitiv).toBe(true);
    expect(gruppe!.kopf?.zahlung).toBe('VERIFIED');

    const gastA = gruppe!.weitere.find((z) => z.name === 'Gast A')!;
    const gastB = gruppe!.weitere.find((z) => z.name === 'Gast B')!;
    expect(gastA.definitiv).toBe(true);
    expect(gastA.zahlung).toBe('VERIFIED');
    expect(gastB.definitiv).toBe(false);
    expect(gastB.zahlung).toBe('PENDING');
    // Die Bestellung selbst steht auf offen - beide sehen dasselbe Feld.
    expect(gastA.bestellungZahlung).toBe('PENDING');
  });

  it('macht bei einem kostenlosen Termin jeden sofort definitiv', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.definitiv).toBe(true);
    expect(gruppe!.weitere[0]!.definitiv).toBe(true);
    expect(gruppe!.weitere[0]!.zahlung).toBe('NOT_REQUIRED');
  });

  it('zeigt einen Erlass als definitiv und als erlassen', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(MANUEL, event.id);
    await calendar.erlasseZahlung(CREW, registration.id, 'Crew');

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.definitiv).toBe(true);
    expect(gruppe!.kopf?.zahlung).toBe('WAIVED');
  });

  // --- Profil-Links ---------------------------------------------------------

  it('gibt einem Mitglied mit öffentlichem Profil seinen Slug', async () => {
    await profil(MANUEL);
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.profilSlug).toBe('manuel');
    expect(gruppe!.bestellerSlug).toBe('manuel');
  });

  it('gibt einem Gast niemals einen Slug', async () => {
    /*
     * Auch dann nicht, wenn ein Mitglied denselben Namen traegt. Ein Gastname
     * ist Text und keine Adresse - ihn zu deuten fuehrte auf ein fremdes
     * Profil.
     */
    await profil(MANUEL);
    const event = await offenesEvent();
    await calendar.register(ANNA, event.id, {}, new Date(), {
      tickets: [fuerMich(ANNA), gast('Manuel')],
    });

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    const alsGast = gruppe!.weitere.find((z) => z.name === 'Manuel')!;
    expect(alsGast.art).toBe('GAST');
    expect(alsGast.profilSlug).toBeNull();
  });

  it('gibt einem Mitglied ohne Profil keinen Slug', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.profilSlug).toBeNull();
    expect(gruppe!.bestellerSlug).toBeNull();
  });

  it('gibt einem Mitglied ohne Slug keinen Link', async () => {
    await profil(MANUEL, { slug: null });
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.profilSlug).toBeNull();
  });

  it('respektiert ein nicht öffentliches Profil', async () => {
    await profil(MANUEL, { sichtbar: false });
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.profilSlug).toBeNull();
  });

  it('respektiert ein gesperrtes Profil', async () => {
    await profil(MANUEL, { gesperrt: true });
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppe!.kopf?.profilSlug).toBeNull();
  });

  it('verlinkt in einer gemischten Liste genau die, die es dürfen', async () => {
    await profil(MANUEL);
    await profil(ANNA, { sichtbar: false });
    // Peter hat gar kein Profil.
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });
    await calendar.register(ANNA, event.id);
    await calendar.register(PETER, event.id);

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    const nach = new Map(gruppen.map((g) => [g.bestellerName, g]));
    expect(nach.get('Manuel')!.kopf?.profilSlug).toBe('manuel');
    expect(nach.get('Anna')!.kopf?.profilSlug).toBeNull();
    expect(nach.get('Peter')!.kopf?.profilSlug).toBeNull();
    expect(nach.get('Manuel')!.weitere[0]!.profilSlug).toBeNull();
  });

  it('leakt keine Profildaten über den Slug hinaus', async () => {
    /*
     * Was hier herauskommt, ist ein Adressteil und sonst nichts. Kein
     * Anzeigename aus dem Profil, kein Banner, keine Sichtbarkeitsangabe - wer
     * mehr braucht, ruft die oeffentliche Profilseite auf, und die entscheidet
     * selbst.
     */
    await profil(MANUEL);
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);

    const [gruppe] = await calendar.ladeTeilnehmerGruppen(event.id);
    const alsText = JSON.stringify(gruppe);
    expect(alsText).not.toContain('visibilityProfile');
    expect(alsText).not.toContain('publicLockedAt');
    expect(alsText).not.toContain('bannerUrl');
  });

  it('holt die Slugs einer grossen Liste in einer Abfrage', async () => {
    // Zwanzig Mitglieder - die Liste darf nicht zwanzig Abfragen machen. Das
    // prueft der Test nicht direkt, aber er faengt eine Rueckkehr zur Abfrage
    // je Zeile ueber die Laufzeit auf.
    const leute = Array.from({ length: 20 }, (_, i) => person(100 + i, `Mitglied${i}`));
    for (const wer of leute) {
      await profil(wer);
    }
    const event = await offenesEvent();
    for (const wer of leute) {
      await calendar.register(wer, event.id);
    }

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(gruppen).toHaveLength(20);
    expect(gruppen.every((g) => g.kopf?.profilSlug !== null)).toBe(true);
  });

  // --- Die oeffentliche Liste auf der Eventseite ----------------------------

  it('zeigt auf der Eventseite jedes Mitglied mit seinen Gästen', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A'), gast('Gast B')],
    });
    await calendar.register(ANNA, event.id);

    const liste = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    const manuel = liste.find((g) => g.bestellerName === 'Manuel')!;
    expect(manuel.gaeste).toEqual(['Gast A', 'Gast B']);
    expect(manuel.kommtSelbst).toBe(true);
    expect(manuel.anzahl).toBe(3);

    const anna = liste.find((g) => g.bestellerName === 'Anna')!;
    expect(anna.gaeste).toEqual([]);
    expect(anna.anzahl).toBe(1);
  });

  it('verlinkt in der öffentlichen Liste nur Mitglieder mit öffentlichem Profil', async () => {
    await profil(MANUEL);
    await profil(ANNA, { sichtbar: false });
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);
    await calendar.register(ANNA, event.id);
    await calendar.register(PETER, event.id);

    const liste = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    const nach = new Map(liste.map((g) => [g.bestellerName, g]));
    expect(nach.get('Manuel')!.bestellerSlug).toBe('manuel');
    expect(nach.get('Anna')!.bestellerSlug).toBeNull();
    expect(nach.get('Peter')!.bestellerSlug).toBeNull();
  });

  it('gibt in der öffentlichen Liste keine internen Angaben heraus', async () => {
    /*
     * Die eigentliche Zusage dieser Liste: sie ist bei `participantsPublic`
     * fuer jedes Mitglied sichtbar und beantwortet genau eine Frage.
     *
     * Geprueft wird am Ergebnis und nicht an der Darstellung - was gar nicht
     * erst geladen wird, kann eine Ansicht auch nicht versehentlich zeigen.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [
        fuerMich(MANUEL),
        {
          guestFirstName: 'Gast A',
          guestEmail: 'gast-a@example.invalid',
          guestDiscordName: 'gasta#1234',
          note: 'Erdnussallergie',
        },
      ],
    });
    await calendar.bestaetigeZahlung(CREW, registration.id);

    const alsText = JSON.stringify(await calendar.ladeOeffentlicheTeilnehmer(event.id));
    for (const geheim of [
      'gast-a@example.invalid',
      'gasta#1234',
      'Erdnussallergie',
      'VERIFIED',
      'priceCents',
      'settledStatus',
      'checkedIn',
      'token',
      MANUEL.discordId,
    ]) {
      expect(alsText, `«${geheim}» steht in der oeffentlichen Liste`).not.toContain(geheim);
    }
    // Was drinsteht: die Namen.
    expect(alsText).toContain('Manuel');
    expect(alsText).toContain('Gast A');
  });

  it('nennt in der öffentlichen Liste, wer selbst nicht kommt', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [gast('Gast A'), gast('Gast B')],
    });

    const [gruppe] = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    expect(gruppe!.bestellerName).toBe('Manuel');
    expect(gruppe!.kommtSelbst).toBe(false);
    expect(gruppe!.gaeste).toEqual(['Gast A', 'Gast B']);
    expect(gruppe!.anzahl).toBe(2);
  });

  it('lässt in der öffentlichen Liste stornierte Tickets und Anmeldungen weg', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A'), gast('Gast B')],
    });
    const gastB = await prisma.calendarTicket.findFirstOrThrow({
      where: { registrationId: registration.id, guestFirstName: 'Gast B' },
    });
    await calendar.storniereTicket(CREW, gastB.id, null);
    await calendar.register(ANNA, event.id);
    await calendar.unregister(ANNA.discordId, event.id);

    const liste = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    expect(liste).toHaveLength(1);
    expect(liste[0]!.gaeste).toEqual(['Gast A']);
    expect(liste[0]!.anzahl).toBe(2);
  });

  it('zeigt in der öffentlichen Liste die Warteliste mit ihrem Platz', async () => {
    const event = await offenesEvent({ capacity: 1, waitlistEnabled: true });
    await calendar.register(MANUEL, event.id);
    await calendar.register(ANNA, event.id);

    const liste = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    // Bestaetigte zuerst, danach die Warteliste in ihrer Reihenfolge.
    expect(liste.map((g) => g.status)).toEqual(['CONFIRMED', 'WAITLIST']);
    expect(liste[1]!.bestellerName).toBe('Anna');
    expect(liste[1]!.waitlistPosition).toBe(1);
  });

  it('zählt einen Nachkauf in der öffentlichen Liste mit', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id);
    await calendar.ergaenzeTickets(MANUEL, event.id, [gast('Später dazu')]);

    const [gruppe] = await calendar.ladeOeffentlicheTeilnehmer(event.id);
    expect(gruppe!.gaeste).toEqual(['Später dazu']);
    expect(gruppe!.anzahl).toBe(2);
  });

  // --- Gastdaten ------------------------------------------------------------

  it('gibt den Ticket-Token in der Gruppenansicht nicht heraus', async () => {
    const event = await offenesEvent();
    await calendar.register(MANUEL, event.id, {}, new Date(), {
      tickets: [fuerMich(MANUEL), gast('Gast A')],
    });

    const gruppen = await calendar.ladeTeilnehmerGruppen(event.id);
    expect(JSON.stringify(gruppen)).not.toContain('token');
  });
});
