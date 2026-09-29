import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_zahlungen');

/**
 * Eintritt, TWINT und die manuelle Bestätigung.
 *
 * ## Die eine Zusage, um die es hier geht
 *
 * **SwissHub darf nie behaupten, eine Zahlung sei eingegangen.** Es gibt
 * keine Schnittstelle zur Bank, keinen Rückkanal von TWINT und keinen Weg,
 * auf dem eine Zahlung ankäme - es gibt ein Bild mit einem QR-Code und einen
 * Menschen, der nachher aufs Konto schaut.
 *
 * Jeder Test hier ist eine Seite dieser Zusage: dass eine Anmeldung
 * vorläufig bleibt, dass kein Zeitablauf und kein Durchgang sie definitiv
 * macht, dass nur eine berechtigte Person den Status setzen kann - und dass
 * «erlassen» nicht dasselbe ist wie «bezahlt».
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Weil der Riegel gegen zwei gleichzeitige Bestätigungen eine bedingte
 * Aktualisierung ist. Eine Nachbildung von Prisma hätte keine und würde vor
 * allem sich selbst bestätigen.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const P = calendar.CALENDAR_PERMISSIONS;

/** Ein Verwalter mit allen Zahlungsberechtigungen. */
const KASSE = {
  discordId: '100000000000000020',
  username: 'kasse',
  can: (permission: string) =>
    [P.paymentsView, P.paymentsVerify, P.paymentsWaive, P.paymentsRevoke, P.paymentsManage].includes(
      permission as never,
    ),
};

/** Jemand, der Events pflegen darf - aber keine Zahlungen anfasst. */
const REDAKTION = {
  discordId: '100000000000000021',
  username: 'redaktion',
  can: (permission: string) => permission === P.edit || permission === P.view,
};

/** Darf bestaetigen, aber nicht erlassen - fuer die Rechtepruefung. */
const KASSE_OHNE_ERLASS = {
  discordId: '100000000000000022',
  username: 'kasse-eng',
  can: (permission: string) => permission === P.paymentsVerify || permission === P.paymentsView,
};

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

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

/** Ein veroeffentlichtes Event - mit oder ohne Eintritt. */
async function offenesEvent(overrides: Record<string, unknown> = {}) {
  const event = await calendar.createEvent(ADMIN, eingabe(overrides), { darfZahlungen: true });
  return calendar.publishEvent(ADMIN, event.id);
}

const person = (n: number) => ({
  discordId: `92000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
  displayName: `User ${n}`,
});

const anmeldung = (id: string) => prisma.calendarRegistration.findUniqueOrThrow({ where: { id } });

describeWithDatabase('Kalender: Eintritt und Zahlung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
    await prisma.guildConfig?.deleteMany?.({}).catch(() => undefined);
  });

  // --- Der Preis am Termin -------------------------------------------------

  it('legt einen kostenlosen Termin ohne Eintrittsangaben an', async () => {
    const event = await offenesEvent();
    expect(event.entryFeeEnabled).toBe(false);
    expect(event.entryFeeCents).toBe(0);
    expect(calendar.kostenpflichtig(event)).toBe(false);
  });

  it('legt CHF 15.– als 1500 Rappen ab', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    expect(event.entryFeeCents).toBe(1500);
    expect(event.entryFeeCurrency).toBe('CHF');
    expect(calendar.betragText(event.entryFeeCents, event.entryFeeCurrency)).toBe('CHF 15.–');
  });

  it('schreibt Rappen mit, wo es welche gibt', async () => {
    expect(calendar.betragText(1550)).toBe('CHF 15.50');
    expect(calendar.betragText(1505)).toBe('CHF 15.05');
    expect(calendar.betragText(0)).toBe('CHF 0.–');
  });

  it('weist einen negativen Preis ab', async () => {
    expect(() => eingabe({ entryFeeEnabled: true, entryFeeCents: -100 })).toThrow(/nicht negativ|negativ/u);
  });

  it('weist einen kostenpflichtigen Termin ohne Betrag ab', async () => {
    // Sonst stuende «Eintritt: CHF 0.–» auf der Seite, und die Anmeldung
    // waere vorlaeufig, ohne dass jemand etwas schuldete.
    expect(() => eingabe({ entryFeeEnabled: true, entryFeeCents: 0 })).toThrow(/über null|Betrag/u);
  });

  it('weist einen Eintritt ohne Anmeldung ab', async () => {
    // Ohne Anmeldung gibt es keine Zeile, auf der ein Zahlungsstatus stuende -
    // also auch niemanden, dessen Zahlung jemand bestaetigen koennte.
    expect(() => eingabe({ registrationEnabled: false, entryFeeEnabled: true, entryFeeCents: 1500 })).toThrow(
      /Anmeldung/u,
    );
  });

  it('nimmt Zahlungshinweise mehrzeilig entgegen', async () => {
    const hinweise = 'Bitte per TWINT bezahlen.\n\nDiscord-Name als Mitteilung angeben.';
    const event = await offenesEvent({
      entryFeeEnabled: true,
      entryFeeCents: 1500,
      paymentNote: hinweise,
    });
    expect(event.paymentNote).toContain('TWINT');
    // Die Absaetze bleiben - `sanitizeText` mit `keepNewlines`.
    expect(event.paymentNote).toContain('\n');
  });

  it('ändert Eintritt und Hinweise nur mit der eigenen Berechtigung', async () => {
    /*
     * Der Riegel sitzt im Dienst, nicht in der Oberflaeche. Wer nur
     * `calendar.edit` hat, schickt die Felder mit - das Formular sendet
     * immer alle - und der Dienst laesst sie fallen.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });

    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 9900 }));
    const ohne = await calendar.requireEvent(event.id);
    expect(ohne.entryFeeCents).toBe(1500);

    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 9900 }), {
      darfZahlungen: true,
    });
    const mit = await calendar.requireEvent(event.id);
    expect(mit.entryFeeCents).toBe(9900);
  });

  it('protokolliert eine Preisänderung eigens', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 2000 }), {
      darfZahlungen: true,
    });

    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'CALENDAR_PAYMENT_SETTINGS_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(eintrag).not.toBeNull();
    // Betraege ja, Zahlungsdaten nein.
    expect(JSON.stringify(eintrag!.metadata)).toContain('2000');
  });

  // --- Die Anmeldung -------------------------------------------------------

  it('bleibt bei einem kostenlosen Termin auf NOT_REQUIRED', async () => {
    const event = await offenesEvent();
    const ergebnis = await calendar.register(person(1), event.id);
    expect(ergebnis.registration.paymentStatus).toBe('NOT_REQUIRED');
    // Und gilt sofort als definitiv - es gibt nichts zu bestaetigen.
    expect(calendar.teilnahmeDefinitiv(ergebnis.registration)).toBe(true);
  });

  it('startet bei einem kostenpflichtigen Termin auf PENDING', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const ergebnis = await calendar.register(person(2), event.id);

    expect(ergebnis.registration.paymentStatus).toBe('PENDING');
    expect(ergebnis.registration.paymentAmountCents).toBe(1500);
    expect(ergebnis.registration.paymentCurrency).toBe('CHF');
  });

  it('gilt mit PENDING noch nicht als definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const ergebnis = await calendar.register(person(3), event.id);
    expect(calendar.teilnahmeDefinitiv(ergebnis.registration)).toBe(false);
  });

  it('reserviert mit PENDING trotzdem einen Platz', async () => {
    /*
     * Die Reihenfolge waere sonst grausam: bezahlen, und danach erfahren,
     * dass der Abend voll ist.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500, capacity: 1 });
    const erste = await calendar.register(person(4), event.id);
    expect(erste.registration.status).toBe('CONFIRMED');
    expect(erste.registration.paymentStatus).toBe('PENDING');

    const zweite = await calendar.register(person(5), event.id);
    expect(zweite.waitlisted).toBe(true);
    expect((await calendar.belegung(event.id)).full).toBe(true);
  });

  it('hält den Preis fest, den die Person gesehen hat', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const ergebnis = await calendar.register(person(6), event.id);

    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 5000 }), {
      darfZahlungen: true,
    });

    // Rueckwirkend schuldet niemand mehr.
    expect((await anmeldung(ergebnis.registration.id)).paymentAmountCents).toBe(1500);
  });

  it('lässt bestehende Anmeldungen unberührt, wenn ein Termin nachträglich kostet', async () => {
    const event = await offenesEvent();
    const ergebnis = await calendar.register(person(7), event.id);
    expect(ergebnis.registration.paymentStatus).toBe('NOT_REQUIRED');

    await calendar.updateEvent(ADMIN, event.id, eingabe({ entryFeeEnabled: true, entryFeeCents: 1500 }), {
      darfZahlungen: true,
    });

    // Sie haben sich fuer einen kostenlosen Abend eingetragen. Von ihnen
    // rueckwirkend Geld zu erwarten waere eine Forderung, die niemand
    // gestellt hat.
    expect((await anmeldung(ergebnis.registration.id)).paymentStatus).toBe('NOT_REQUIRED');
  });

  it('bestätigt keine Zahlung von selbst', async () => {
    /*
     * Der Kern des ganzen Auftrags. Die Anmeldung ist durch, der QR-Code war
     * sichtbar, es ist Zeit vergangen - und der Status steht weiterhin auf
     * PENDING, weil niemand aufs Konto geschaut hat.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const ergebnis = await calendar.register(person(8), event.id);

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    expect(kennzahlen.ausstehend).toBe(1);
    expect(kennzahlen.bestaetigt).toBe(0);
    expect(kennzahlen.eingegangenRappen).toBe(0);
    expect((await anmeldung(ergebnis.registration.id)).paymentStatus).toBe('PENDING');
  });

  // --- Bestätigen ----------------------------------------------------------

  it('macht die Teilnahme erst durch die Bestätigung definitiv', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(9), event.id);

    const ergebnis = await calendar.bestaetigeZahlung(KASSE, registration.id);

    expect(ergebnis.geaendert).toBe(true);
    expect(ergebnis.registration.paymentStatus).toBe('VERIFIED');
    expect(ergebnis.registration.paymentVerifiedAt).not.toBeNull();
    expect(ergebnis.registration.paymentVerifiedByDiscordId).toBe(KASSE.discordId);
    expect(ergebnis.registration.paymentVerifiedByUsername).toBe('kasse');
    expect(calendar.teilnahmeDefinitiv(ergebnis.registration)).toBe(true);
  });

  it('ist beim zweiten Mal idempotent', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(10), event.id);

    await calendar.bestaetigeZahlung(KASSE, registration.id);
    const zweite = await calendar.bestaetigeZahlung(KASSE, registration.id);

    expect(zweite.geaendert).toBe(false);
    expect(zweite.registration.paymentStatus).toBe('VERIFIED');
    const eintraege = await prisma.auditLog.count({ where: { action: 'CALENDAR_PAYMENT_VERIFIED' } });
    expect(eintraege).toBe(1);
  });

  it('lässt zwei gleichzeitige Bestätigungen nur einmal durch', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(11), event.id);

    const [eins, zwei] = await Promise.all([
      calendar.bestaetigeZahlung(KASSE, registration.id),
      calendar.bestaetigeZahlung(KASSE, registration.id),
    ]);

    expect([eins.geaendert, zwei.geaendert].filter(Boolean)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'CALENDAR_PAYMENT_VERIFIED' } })).toBe(1);
  });

  it('lässt niemanden ohne Berechtigung bestätigen', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(12), event.id);

    // Geprueft wird der fehlende Schluessel: das ist die Aussage, nicht der
    // Wortlaut der Meldung an die Oberflaeche.
    await expect(calendar.bestaetigeZahlung(REDAKTION, registration.id)).rejects.toThrow(
      /calendar\.payments\.verify/u,
    );
    expect((await anmeldung(registration.id)).paymentStatus).toBe('PENDING');
  });

  it('bestätigt nichts an einem kostenlosen Termin', async () => {
    const event = await offenesEvent();
    const { registration } = await calendar.register(person(13), event.id);
    await expect(calendar.bestaetigeZahlung(KASSE, registration.id)).rejects.toThrow(/kein Eintritt/u);
  });

  it('schreibt einen Audit-Eintrag mit Betrag und Person', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(14), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CALENDAR_PAYMENT_VERIFIED' },
    });
    expect(eintrag.actorDiscordId).toBe(KASSE.discordId);
    expect(eintrag.targetDiscordId).toBe(person(14).discordId);
    expect(JSON.stringify(eintrag.metadata)).toContain('1500');
  });

  // --- Erlassen ------------------------------------------------------------

  it('führt einen Erlass getrennt von einer Zahlung', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(15), event.id);

    const ergebnis = await calendar.erlasseZahlung(KASSE, registration.id, 'Crew');

    expect(ergebnis.registration.paymentStatus).toBe('WAIVED');
    expect(ergebnis.registration.paymentReason).toBe('Crew');
    // Teilnahme definitiv - aber ausdruecklich nicht «bezahlt».
    expect(calendar.teilnahmeDefinitiv(ergebnis.registration)).toBe(true);
    expect(ergebnis.registration.paymentStatus).not.toBe('VERIFIED');
  });

  it('zählt einen Erlass nicht als eingegangenes Geld', async () => {
    /*
     * Sonst suchte jemand spaeter in der Kasse nach einem Betrag, den nie
     * jemand geschickt hat.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const eins = await calendar.register(person(16), event.id);
    const zwei = await calendar.register(person(17), event.id);

    await calendar.bestaetigeZahlung(KASSE, eins.registration.id);
    await calendar.erlasseZahlung(KASSE, zwei.registration.id, 'Sponsor');

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    expect(kennzahlen.bestaetigt).toBe(1);
    expect(kennzahlen.erlassen).toBe(1);
    expect(kennzahlen.eingegangenRappen).toBe(1500);
  });

  it('lässt niemanden ohne Berechtigung erlassen', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(18), event.id);
    await expect(calendar.erlasseZahlung(KASSE_OHNE_ERLASS, registration.id, 'Crew')).rejects.toThrow(
      /calendar\.payments\.waive/u,
    );
  });

  // --- Zurücknehmen --------------------------------------------------------

  it('nimmt eine Bestätigung kontrolliert zurück', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(19), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);

    const ergebnis = await calendar.nimmBestaetigungZurueck(
      KASSE,
      registration.id,
      'PENDING',
      'versehentlich bestätigt',
    );

    expect(ergebnis.registration.paymentStatus).toBe('PENDING');
    expect(ergebnis.registration.paymentReason).toBe('versehentlich bestätigt');
    expect(calendar.teilnahmeDefinitiv(ergebnis.registration)).toBe(false);
    // Wer bestaetigt hatte, bleibt stehen - das ist die Spur, die man braucht.
    expect(ergebnis.registration.paymentVerifiedByUsername).toBe('kasse');
  });

  it('protokolliert jede Rücknahme', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(20), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await calendar.nimmBestaetigungZurueck(KASSE, registration.id, 'PENDING', null);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CALENDAR_PAYMENT_REVOKED' },
    });
    expect(JSON.stringify(eintrag.metadata)).toContain('VERIFIED');
  });

  it('nimmt nichts zurück, was nicht bestätigt ist', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(21), event.id);
    await expect(calendar.nimmBestaetigungZurueck(KASSE, registration.id, 'PENDING', null)).rejects.toThrow(
      /nicht bestätigt/u,
    );
  });

  it('lässt niemanden ohne Berechtigung zurücknehmen', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const { registration } = await calendar.register(person(22), event.id);
    await calendar.bestaetigeZahlung(KASSE, registration.id);
    await expect(
      calendar.nimmBestaetigungZurueck(REDAKTION, registration.id, 'PENDING', null),
    ).rejects.toThrow(/calendar\.payments\.revoke/u);
  });

  // --- Übersicht, Kennzahlen, Filter --------------------------------------

  it('rechnet die Kennzahlen über alle Zustände', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const offen = await calendar.register(person(30), event.id);
    const bezahlt = await calendar.register(person(31), event.id);
    const frei = await calendar.register(person(32), event.id);
    await calendar.register(person(33), event.id);

    await calendar.bestaetigeZahlung(KASSE, bezahlt.registration.id);
    await calendar.erlasseZahlung(KASSE, frei.registration.id, 'Gast');
    await calendar.unregister(person(33).discordId, event.id);

    const kennzahlen = await calendar.zahlungsKennzahlen(event.id);
    expect(kennzahlen.angemeldet).toBe(3);
    expect(kennzahlen.ausstehend).toBe(1);
    expect(kennzahlen.bestaetigt).toBe(1);
    expect(kennzahlen.erlassen).toBe(1);
    expect(kennzahlen.storniert).toBe(1);
    expect(kennzahlen.eingegangenRappen).toBe(1500);
    // Eine stornierte Anmeldung schuldet nichts mehr.
    expect(kennzahlen.offenRappen).toBe(1500);
    expect(offen.registration.paymentStatus).toBe('PENDING');
  });

  it('filtert nach «Zahlung ausstehend»', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const offen = await calendar.register(person(40), event.id);
    const bezahlt = await calendar.register(person(41), event.id);
    await calendar.bestaetigeZahlung(KASSE, bezahlt.registration.id);

    const liste = await calendar.ladeZahlungsliste(event.id, { filter: 'ausstehend' });
    expect(liste).toHaveLength(1);
    expect(liste[0]!.registrationId).toBe(offen.registration.id);
    expect(liste[0]!.zahlung).toBe('PENDING');
  });

  it('filtert nach «Bestätigt»', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.register(person(42), event.id);
    const bezahlt = await calendar.register(person(43), event.id);
    await calendar.bestaetigeZahlung(KASSE, bezahlt.registration.id);

    const liste = await calendar.ladeZahlungsliste(event.id, { filter: 'bestaetigt' });
    expect(liste).toHaveLength(1);
    expect(liste[0]!.verifiedByUsername).toBe('kasse');
    expect(liste[0]!.verifiedAt).not.toBeNull();
  });

  it('sucht nach Anzeigename und Kennung', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    await calendar.register(person(44), event.id);
    await calendar.register(person(45), event.id);

    expect(await calendar.ladeZahlungsliste(event.id, { suche: 'User 44' })).toHaveLength(1);
    expect(await calendar.ladeZahlungsliste(event.id, { suche: person(45).discordId })).toHaveLength(1);
    expect(await calendar.ladeZahlungsliste(event.id, { suche: 'gibtsnicht' })).toHaveLength(0);
  });

  it('gibt den Betrag mit, den die Anmeldung trägt', async () => {
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1550 });
    await calendar.register(person(46), event.id);

    const liste = await calendar.ladeZahlungsliste(event.id);
    expect(liste[0]!.betragRappen).toBe(1550);
    expect(calendar.betragText(liste[0]!.betragRappen, liste[0]!.waehrung)).toBe('CHF 15.50');
  });

  it('beginnt nach einer Stornierung bei einer neuen Anmeldung wieder bei null', async () => {
    /*
     * Sonst behielte jemand, der einmal bestaetigt und dann storniert wurde,
     * seine Bestaetigung ueber die neue Anmeldung hinweg - und haette beim
     * naechsten Mal umsonst teilgenommen.
     */
    const event = await offenesEvent({ entryFeeEnabled: true, entryFeeCents: 1500 });
    const erste = await calendar.register(person(47), event.id);
    await calendar.bestaetigeZahlung(KASSE, erste.registration.id);
    await calendar.unregister(person(47).discordId, event.id);

    const zweite = await calendar.register(person(47), event.id);
    expect(zweite.registration.paymentStatus).toBe('PENDING');
    expect(zweite.registration.paymentVerifiedAt).toBeNull();
    expect(zweite.registration.paymentVerifiedByUsername).toBeNull();
  });
});
