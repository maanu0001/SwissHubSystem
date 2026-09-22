import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_benachrichtigungen');

/**
 * Das Notification Center.
 *
 * Fünf Fragen entscheiden, ob eine Glocke brauchbar oder gefährlich ist, und
 * keine davon lässt sich gegen eine gefälschte Datenbank beantworten:
 *
 * 1. **Bekommt sie der Richtige?** Eine Meldung über ein Ticket bei jemandem,
 *    der keine Tickets sehen darf, ist ein Datenleck in einer Zeile - der
 *    Betreff verrät bereits, dass es das Ticket gibt.
 * 2. **Bekommt sie der Falsche nicht?** Dieselbe Frage von der anderen Seite,
 *    und die wichtigere: sie muss auch dann Nein ergeben, wenn jemand nur
 *    *fast* genug Rechte hat.
 * 3. **Zählt sie einmal?** Ereignisse werden wiederholt zugestellt. Zwei
 *    Zeilen für denselben Vorgang sind der übliche Weg dorthin, dass die
 *    Zahl an der Glocke niemand mehr ernst nimmt.
 * 4. **Ist der Lesezustand persönlich?** Zwei Moderatorinnen entscheiden
 *    unabhängig voneinander, was sie gesehen haben.
 * 5. **Wächst sie nicht unbegrenzt?**
 */
const { prisma } = await import('@swisshub/database');
const { notifications, setModuleEnabled } = await import('@swisshub/modules');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

/** Rollen aus dem Mock-Gateway. */
const SUPPORT_ROLLE = '900000000000000004';
const GEWOEHNLICH = '900000000000000008';

const LARS = '100000000000000003'; // Support
const SPAMMER = '100000000000000004'; // gewöhnliches Mitglied
const NINA = '100000000000000002'; // zweite Person im Support

async function benutzer(discordId: string, roleIds: string[], name: string): Promise<void> {
  const user = await prisma.user.create({
    data: { discordId, username: name, lastLoginAt: new Date() },
  });
  await prisma.discordIdentityCache.create({
    data: { discordId, userId: user.id, isMember: true, roleIds },
  });
}

async function rolleDarf(roleId: string, permission: string): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId: roleId },
    create: { discordRoleId: roleId, label: `Rolle ${roleId}` },
    update: {},
  });
  await prisma.rolePermission.create({ data: { discordRoleId: roleId, permission } });
  invalidateRoleConfiguration();
}

/** Ein Ticket-Ereignis, wie `meldeEreignis` es liefert. */
function ticketEreignis(eventId: string, ticketId = 'ticket-1') {
  return {
    eventId,
    type: 'ticket.opened',
    payload: { ticketId, nummer: 42, discordId: SPAMMER, kategorie: 'Technik', channelId: '1' },
    actorId: SPAMMER,
    subjectId: SPAMMER,
    entityId: ticketId,
  };
}

describeWithDatabase('Benachrichtigungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Notification","RolePermission","ManagedRole","DiscordIdentityCache","Session","User","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    invalidateRoleConfiguration();
    await setModuleEnabled('tickets', true, 'test');
  });

  // --- Empfänger ------------------------------------------------------------

  it('erzeugt aus einem Domain Event eine Meldung für die Berechtigten', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE, GEWOEHNLICH], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');

    const erzeugt = await notifications.verteileBenachrichtigungen(ticketEreignis('e1'));

    expect(erzeugt).toBe(1);
    const zeile = await prisma.notification.findFirstOrThrow({ where: { recipientDiscordId: LARS } });
    expect(zeile.kind).toBe('ticket.neu');
    expect(zeile.title).toBe('Neues Ticket #0042');
    expect(zeile.body).toBe('Technik');
    expect(zeile.route).toBe('/tickets/ticket-1');
    expect(zeile.readAt).toBeNull();
  });

  it('gibt sie niemandem ohne die Berechtigung', async () => {
    // Der Betreff allein verriete bereits, dass es das Ticket gibt.
    await benutzer(SPAMMER, [GEWOEHNLICH], 'spammer99');

    const erzeugt = await notifications.verteileBenachrichtigungen(ticketEreignis('e1'));

    expect(erzeugt).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('gibt sie niemandem mit einer ausdrücklichen Ausnahme', async () => {
    // `DENY` schlägt jede Erlaubnis - auch den Vollzugriff. Die Glocke rechnet
    // mit derselben Permission Engine wie die Seite, nicht mit einer zweiten.
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'admin.full');
    await prisma.rolePermission.create({
      data: { discordRoleId: SUPPORT_ROLLE, permission: 'tickets.support.view', effect: 'DENY' },
    });
    invalidateRoleConfiguration();

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(0);
  });

  it('erreicht auch, wer die Berechtigung über einen Vollzugriff hat', async () => {
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'admin.full');

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(1);
  });

  it('meldet niemandem seine eigene Tat', async () => {
    // Das wäre keine Nachricht, sondern eine Quittung - und die steht im
    // Audit Log.
    await benutzer(SPAMMER, [SUPPORT_ROLLE], 'spammer99');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(0);
  });

  it('schweigt, solange das zuständige Modul abgeschaltet ist', async () => {
    // Ein abgeschaltetes Modul hat keine Seite, auf die der Deep Link führen
    // könnte - die Meldung wäre ein Weg ins Leere.
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await setModuleEnabled('tickets', false, 'test');

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(0);
  });

  it('schreibt für ein Ereignis ohne Regel gar nichts', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'admin.full');

    const erzeugt = await notifications.verteileBenachrichtigungen({
      eventId: 'e1',
      type: 'voice.joined',
      payload: {},
    });

    expect(erzeugt).toBe(0);
  });

  it('gibt eine persönliche Meldung nur der einen Person', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'admin.full');

    await notifications.verteileBenachrichtigungen({
      eventId: 'e1',
      type: 'calendar.registration_created',
      payload: {
        eventId: 'ev1',
        registrationId: 'r1',
        discordId: SPAMMER,
        titel: 'Sommerfest',
        status: 'CONFIRMED',
        slug: 'sommerfest',
        organizerDiscordId: NINA,
      },
      actorId: SPAMMER,
    });

    const zeilen = await prisma.notification.findMany();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.recipientDiscordId).toBe(NINA);
    expect(zeilen[0]!.route).toBe('/kalender/sommerfest');
  });

  // --- Doppel und Wiederholung ---------------------------------------------

  it('erzeugt bei erneuter Zustellung desselben Ereignisses keine zweite Zeile', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(1);
    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('erzeugt für ein anderes Ereignis wieder eine Zeile', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');

    await notifications.verteileBenachrichtigungen(ticketEreignis('e1', 't1'));
    await notifications.verteileBenachrichtigungen(ticketEreignis('e2', 't2'));

    expect(await prisma.notification.count()).toBe(2);
  });

  // --- Gruppierung ----------------------------------------------------------

  it('fasst gleichartige Meldungen zu einer mit Zähler zusammen', async () => {
    // Fünf gescheiterte Läufe derselben Automation sind ein Problem - aber
    // ein einziges. Fünf Zeilen daraus zu machen, verdeckt es.
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'automations.view');
    await setModuleEnabled('automation', true, 'test');

    for (const lauf of ['r1', 'r2', 'r3']) {
      await notifications.verteileBenachrichtigungen({
        eventId: `e-${lauf}`,
        type: 'automation.failed',
        payload: {
          automationId: 'a1',
          automationName: 'Willkommen',
          runId: lauf,
          fehler: 'Discord antwortet nicht',
        },
      });
    }

    const zeilen = await prisma.notification.findMany({ where: { recipientDiscordId: LARS } });
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.count).toBe(3);
    // Die Gruppe zeigt auf den jüngsten Lauf - den, um den es jetzt geht.
    expect(zeilen[0]!.route).toBe('/automationen/laeufe/r3');
  });

  it('setzt eine gelesene Gruppe wieder auf ungelesen', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'automations.view');
    await setModuleEnabled('automation', true, 'test');

    const melde = async (runId: string): Promise<void> => {
      await notifications.verteileBenachrichtigungen({
        eventId: `e-${runId}`,
        type: 'automation.failed',
        payload: { automationId: 'a1', automationName: 'Willkommen', runId, fehler: 'x' },
      });
    };

    await melde('r1');
    await notifications.markiereAlleGelesen(LARS);
    expect(await notifications.zaehleUngelesene(LARS)).toBe(0);

    await melde('r2');
    expect(await notifications.zaehleUngelesene(LARS)).toBe(1);
  });

  it('zählt dieselbe Gruppe nicht zweimal für dasselbe Ereignis hoch', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await rolleDarf(SUPPORT_ROLLE, 'automations.view');
    await setModuleEnabled('automation', true, 'test');

    const ereignis = {
      eventId: 'e1',
      type: 'automation.failed',
      payload: { automationId: 'a1', automationName: 'Willkommen', runId: 'r1', fehler: 'x' },
    };
    await notifications.verteileBenachrichtigungen(ereignis);
    await notifications.verteileBenachrichtigungen(ereignis);

    const zeile = await prisma.notification.findFirstOrThrow({ where: { recipientDiscordId: LARS } });
    expect(zeile.count).toBe(1);
  });

  // --- Lesezustand ----------------------------------------------------------

  it('hält den Lesezustand je Person getrennt', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');

    expect(await notifications.verteileBenachrichtigungen(ticketEreignis('e1'))).toBe(2);
    await notifications.markiereAlleGelesen(LARS);

    expect(await notifications.zaehleUngelesene(LARS)).toBe(0);
    expect(await notifications.zaehleUngelesene(NINA)).toBe(1);
  });

  it('markiert keine fremde Meldung als gelesen', async () => {
    // Ohne den Empfänger in der Bedingung könnte jemand über die Antwort
    // erfahren, dass es eine fremde Meldung überhaupt gibt.
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await notifications.verteileBenachrichtigungen(ticketEreignis('e1'));
    const fremde = await prisma.notification.findFirstOrThrow();

    expect(await notifications.markiereGelesen(LARS, fremde.id)).toBe(false);
    expect(await notifications.zaehleUngelesene(NINA)).toBe(1);
  });

  it('meldet beim zweiten Mal, dass nichts mehr zu tun war', async () => {
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await notifications.verteileBenachrichtigungen(ticketEreignis('e1'));
    const eigene = await prisma.notification.findFirstOrThrow();

    expect(await notifications.markiereGelesen(NINA, eigene.id)).toBe(true);
    expect(await notifications.markiereGelesen(NINA, eigene.id)).toBe(false);
  });

  it('zeigt ungelesene zuerst', async () => {
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await notifications.verteileBenachrichtigungen(ticketEreignis('e1', 't1'));
    const erste = await prisma.notification.findFirstOrThrow();
    await notifications.markiereGelesen(NINA, erste.id);
    await notifications.verteileBenachrichtigungen(ticketEreignis('e2', 't2'));

    const ansicht = await notifications.glocke(NINA);
    expect(ansicht.ungelesen).toBe(1);
    expect(ansicht.eintraege[0]!.readAt).toBeNull();
    expect(ansicht.eintraege).toHaveLength(2);
  });

  it('zeigt einer Person nur ihre eigenen', async () => {
    await benutzer(LARS, [SUPPORT_ROLLE], 'lars');
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await notifications.verteileBenachrichtigungen(ticketEreignis('e1'));

    const ansicht = await notifications.glocke(LARS);
    expect(ansicht.eintraege.every((eintrag) => eintrag.recipientDiscordId === LARS)).toBe(true);
  });

  // --- Gelöschtes Ziel ------------------------------------------------------

  it('bleibt lesbar, wenn das Zielobjekt verschwunden ist', async () => {
    // Die Meldung ist eine Nachricht, kein Fremdschlüssel. Sie verschwindet
    // nicht, nur weil das Ticket gelöscht wurde - und sie reisst beim
    // Löschen auch nichts mit.
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    await rolleDarf(SUPPORT_ROLLE, 'tickets.support.view');
    await notifications.verteileBenachrichtigungen(ticketEreignis('e1', 'weg'));

    const ansicht = await notifications.glocke(NINA);
    expect(ansicht.eintraege[0]!.route).toBe('/tickets/weg');
    expect(ansicht.ungelesen).toBe(1);
  });

  // --- Aufbewahrung ---------------------------------------------------------

  it('räumt gelesene nach der Frist weg und ungelesene später', async () => {
    await benutzer(NINA, [SUPPORT_ROLLE], 'nina');
    const alt = new Date(Date.now() - 40 * 86_400_000);
    const sehrAlt = new Date(Date.now() - 70 * 86_400_000);
    await prisma.notification.createMany({
      data: [
        {
          recipientDiscordId: NINA,
          kind: 'x',
          title: 'gelesen, alt',
          dedupeKey: 'a',
          createdAt: alt,
          readAt: alt,
          updatedAt: alt,
        },
        {
          recipientDiscordId: NINA,
          kind: 'x',
          title: 'ungelesen, alt',
          dedupeKey: 'b',
          createdAt: alt,
          updatedAt: alt,
        },
        {
          recipientDiscordId: NINA,
          kind: 'x',
          title: 'ungelesen, sehr alt',
          dedupeKey: 'c',
          createdAt: sehrAlt,
          updatedAt: sehrAlt,
        },
        { recipientDiscordId: NINA, kind: 'x', title: 'frisch', dedupeKey: 'd', updatedAt: new Date() },
      ],
    });

    const entfernt = await notifications.raeumeBenachrichtigungen();

    expect(entfernt).toBe(2);
    const verbleibend = await prisma.notification.findMany({ orderBy: { title: 'asc' } });
    expect(verbleibend.map((zeile) => zeile.title)).toEqual(['frisch', 'ungelesen, alt']);
  });
});
