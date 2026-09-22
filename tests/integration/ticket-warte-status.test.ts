import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_ticket_warte_status');

/**
 * «Wer ist am Zug?» - die Zahl neben «Tickets».
 *
 * Die Zahl bedeutete bisher fuer alle dasselbe: *wie viele offene Tickets
 * sind sichtbar*. Fuer den Support ist das richtig - es ist seine Arbeit.
 * Fuer den Ersteller war es falsch: er eroeffnete ein Ticket, das Team war am
 * Zug, und neben «Tickets» stand trotzdem eine Eins. Sie las sich als
 * Aufforderung und war keine.
 *
 * Geprueft wird deshalb nicht «ist die Zahl kleiner geworden», sondern der
 * Verlauf einer Unterhaltung - Schritt fuer Schritt, ueber beide Wege
 * (Discord und WebApp), mit internen Notizen und Zuweisungen dazwischen.
 *
 * Gegen eine echte Datenbank, weil die Zahl eine `count`-Abfrage ist: die
 * Bedingung muss dasselbe sagen wie die Funktion, die ein einzelnes Ticket
 * beurteilt. Zwei Formulierungen derselben Regel laufen sonst auseinander,
 * und niemand merkt es.
 */
const { prisma } = await import('@swisshub/database');
const { tickets, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const MITGLIED = { discordId: '100000000000000004', username: 'spammer99', isStaff: false };
const ZWEITES_MITGLIED = { discordId: '100000000000000006', username: 'roeschti', isStaff: false };
const SUPPORTER = { discordId: '100000000000000003', username: 'lars.supporter', isStaff: true };

/**
 * Der Betrachter, wie das Modul ihn erwartet.
 *
 * Aus der Funktion abgeleitet statt noch einmal aufgeschrieben: der Typ kommt
 * aus einem dynamischen Import und steht als Namensraum nicht zur Verfuegung.
 */
type Betrachter = Parameters<typeof tickets.countOpenTickets>[0];

/** Ein Betrachter ohne Support-Rechte - der gewoehnliche Ticket-Ersteller. */
const alsMitglied = (discordId: string): Betrachter => ({
  discordId,
  roleIds: [],
  can: (permission) => permission === tickets.TICKET_PERMISSIONS.viewOwn,
});

/** Ein Betrachter mit Support-Rechten. */
const alsSupport = (discordId: string): Betrachter => ({
  discordId,
  roleIds: [],
  can: () => true,
});

let kategorieId: string;

/** Ein Ticket, wie es nach dem Anlegen dasteht: mit Kanal, ohne Nachricht. */
async function neuesTicket(ersteller = MITGLIED, nummer = 1): Promise<string> {
  const ticket = await prisma.ticket.create({
    data: {
      guildId: 'g1',
      ticketNumber: nummer,
      categoryId: kategorieId,
      subject: `Anliegen ${nummer}`,
      status: 'OPEN',
      creatorDiscordId: ersteller.discordId,
      creatorUsername: ersteller.username,
      discordChannelId: `90000000000000${String(nummer).padStart(4, '0')}`,
    },
  });
  return ticket.id;
}

/** Die Zahl, die neben «Tickets» stuende. */
const zahlFuer = (discordId: string): Promise<number> =>
  tickets.ticketNavigationCounter(alsMitglied(discordId));

/** Wer bei diesem Ticket am Zug ist - der Einzelfall. */
async function wartetAuf(ticketId: string): Promise<string> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { status: true, lastMessageByStaff: true },
  });
  return tickets.ticketWartetAuf(ticket);
}

describeWithDatabase('Ticket: wer ist am Zug?', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "TicketAttachment","TicketMessage","TicketEvent","TicketParticipant","TicketTagAssignment","TicketTag","Ticket","TicketCategory","ModuleState" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(tickets.TICKETS_MODULE_ID, true, 'test');
    const kategorie = await prisma.ticketCategory.create({
      data: { guildId: 'g1', name: 'Technik' },
    });
    kategorieId = kategorie.id;
  });

  // --- Der Verlauf einer Unterhaltung --------------------------------------

  it('TEST 1: ein frisch erstelltes Ticket erzeugt keine Zahl', async () => {
    // Der Ersteller hat sein Anliegen gesendet - das Team ist am Zug. Genau
    // hier stand bisher eine Eins.
    const ticketId = await neuesTicket();

    expect(await wartetAuf(ticketId)).toBe('TEAM');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('TEST 2: nach einer sichtbaren Team-Antwort steht eine Eins', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Hast du einen Screenshot?', SUPPORTER);

    expect(await wartetAuf(ticketId)).toBe('ERSTELLER');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
  });

  it('TEST 3: antwortet der Ersteller, verschwindet sie wieder', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Hast du einen Screenshot?', SUPPORTER);
    await tickets.sendMessage(ticketId, 'Hier ist er.', MITGLIED);

    expect(await wartetAuf(ticketId)).toBe('TEAM');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('TEST 4: antwortet das Team erneut, kommt sie zurueck', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Screenshot?', SUPPORTER);
    await tickets.sendMessage(ticketId, 'Hier.', MITGLIED);
    await tickets.sendMessage(ticketId, 'Danke - und welche Version?', SUPPORTER);

    expect(await wartetAuf(ticketId)).toBe('ERSTELLER');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
  });

  it('TEST 5: ein geschlossenes Ticket zaehlt nie mit', async () => {
    // Auch dann nicht, wenn die letzte Nachricht vom Team stammt - erledigt
    // ist erledigt.
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Ist das geloest?', SUPPORTER);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);

    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    expect(await wartetAuf(ticketId)).toBe('NIEMAND');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('zaehlt ein archiviertes Ticket ebenso wenig', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Antwort', SUPPORTER);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'ARCHIVED' } });

    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  // --- Mehrere Tickets ------------------------------------------------------

  it('TEST 6: zwei wartende Tickets ergeben eine Zwei', async () => {
    const a = await neuesTicket(MITGLIED, 1);
    const b = await neuesTicket(MITGLIED, 2);
    await tickets.sendMessage(a, 'Frage A', SUPPORTER);
    await tickets.sendMessage(b, 'Frage B', SUPPORTER);

    expect(await zahlFuer(MITGLIED.discordId)).toBe(2);
  });

  it('TEST 7: nur das Ticket zaehlt, bei dem der Ersteller am Zug ist', async () => {
    const a = await neuesTicket(MITGLIED, 1);
    const b = await neuesTicket(MITGLIED, 2);
    const c = await neuesTicket(MITGLIED, 3);
    await tickets.sendMessage(a, 'Frage A', SUPPORTER); // wartet auf Ersteller
    await tickets.sendMessage(b, 'Frage B', SUPPORTER);
    await tickets.sendMessage(b, 'Antwort B', MITGLIED); // wartet auf Team
    await tickets.sendMessage(c, 'Frage C', SUPPORTER);
    await prisma.ticket.update({ where: { id: c }, data: { status: 'CLOSED' } }); // geschlossen

    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
  });

  it('zaehlt fremde Tickets nicht mit', async () => {
    const fremd = await neuesTicket(ZWEITES_MITGLIED, 1);
    await tickets.sendMessage(fremd, 'Frage', SUPPORTER);

    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
    expect(await zahlFuer(ZWEITES_MITGLIED.discordId)).toBe(1);
  });

  it('zaehlt auch fuer jemanden, der zum Ticket hinzugefuegt wurde', async () => {
    // Wer einem Ticket beigezogen wurde, sieht es unter «Meine Tickets» und
    // ist ebenso gemeint, wenn das Team dort nachfragt.
    const ticketId = await neuesTicket(MITGLIED, 1);
    await prisma.ticketParticipant.create({
      data: { ticketId, discordId: ZWEITES_MITGLIED.discordId, username: ZWEITES_MITGLIED.username },
    });
    await tickets.sendMessage(ticketId, 'Frage an euch beide', SUPPORTER);

    expect(await zahlFuer(ZWEITES_MITGLIED.discordId)).toBe(1);
  });

  // --- Was den Zustand nicht veraendern darf --------------------------------

  it('TEST 8: eine interne Notiz veraendert nichts', async () => {
    // Das Mitglied sieht sie nie. Sie als «Antwort» zu werten hiesse, jemanden
    // auf etwas warten zu lassen, das er nicht lesen kann.
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Kurze Rueckfrage.', SUPPORTER);
    await tickets.sendMessage(ticketId, 'Meine Antwort.', MITGLIED);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);

    await tickets.addInternalNote(ticketId, 'Fall an Lars uebergeben.', SUPPORTER);

    expect(await wartetAuf(ticketId)).toBe('TEAM');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('eine interne Notiz erzeugt auch auf einem frischen Ticket keine Zahl', async () => {
    const ticketId = await neuesTicket();
    await tickets.addInternalNote(ticketId, 'Sieht nach einem Duplikat aus.', SUPPORTER);

    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('TEST 9: eine Zuweisung veraendert nichts', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Meine Rueckmeldung.', MITGLIED);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);

    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedToDiscordId: SUPPORTER.discordId,
        assignedToUsername: SUPPORTER.username,
        assignedAt: new Date(),
      },
    });

    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('ein Schlagwort veraendert nichts', async () => {
    const ticketId = await neuesTicket();
    const tag = await prisma.ticketTag.create({ data: { guildId: 'g1', name: 'Bug' } });
    await prisma.ticketTagAssignment.create({
      data: { ticketId, tagId: tag.id, addedByDiscordId: SUPPORTER.discordId },
    });

    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  // --- Discord und WebApp verhalten sich gleich -----------------------------

  it('TEST 10: eine Team-Antwort aus Discord wirkt wie eine aus der WebApp', async () => {
    const ticketId = await neuesTicket();
    await tickets.syncDiscordMessage({
      ticketId,
      discordMessageId: '700000000000000001',
      content: 'Antwort aus dem Kanal',
      author: SUPPORTER,
    });

    expect(await wartetAuf(ticketId)).toBe('ERSTELLER');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
  });

  it('TEST 11: eine Antwort des Erstellers aus Discord raeumt die Zahl weg', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Frage aus der WebApp', SUPPORTER);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);

    await tickets.syncDiscordMessage({
      ticketId,
      discordMessageId: '700000000000000002',
      content: 'Antwort aus dem Kanal',
      author: MITGLIED,
    });

    expect(await wartetAuf(ticketId)).toBe('TEAM');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('zaehlt dieselbe Discord-Nachricht nicht zweimal', async () => {
    // Der Bot kann sie nach einem Neustart erneut sehen.
    const ticketId = await neuesTicket();
    const nachricht = {
      ticketId,
      discordMessageId: '700000000000000003',
      content: 'Antwort',
      author: SUPPORTER,
    };
    await tickets.syncDiscordMessage(nachricht);
    await tickets.syncDiscordMessage(nachricht);

    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
    expect(await prisma.ticketMessage.count({ where: { ticketId } })).toBe(1);
  });

  // --- Ohne den automatischen Warte-Status ---------------------------------

  it('funktioniert auch, wenn der automatische Warte-Status aus ist', async () => {
    // Der Status wird dann nicht nachgezogen - `lastMessageByStaff` schon.
    // Genau deshalb haengt die Regel an der Nachricht und nicht am Status.
    await setModuleSettings(tickets.TICKETS_MODULE_ID, { autoWaitingStatus: false }, 'test');
    const ticketId = await neuesTicket();

    await tickets.sendMessage(ticketId, 'Frage', SUPPORTER);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);

    await tickets.sendMessage(ticketId, 'Antwort', MITGLIED);
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  it('achtet einen von Hand gesetzten Warte-Status, solange niemand geschrieben hat', async () => {
    // Dann ist er die einzige Aussage, die es gibt - und eine ausdrueckliche.
    const ticketId = await neuesTicket();
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'WAITING_FOR_USER' } });

    expect(await wartetAuf(ticketId)).toBe('ERSTELLER');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(1);
  });

  it('laesst die juengere Nachricht gegen einen veralteten Status gewinnen', async () => {
    await setModuleSettings(tickets.TICKETS_MODULE_ID, { autoWaitingStatus: false }, 'test');
    const ticketId = await neuesTicket();
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'WAITING_FOR_USER' } });
    await tickets.sendMessage(ticketId, 'Ich habe geantwortet.', MITGLIED);

    // Der Status steht noch auf «wartet auf Mitglied», die Nachricht sagt
    // etwas anderes - und sie ist juenger.
    expect(await wartetAuf(ticketId)).toBe('TEAM');
    expect(await zahlFuer(MITGLIED.discordId)).toBe(0);
  });

  // --- Die Zahl und der Einzelfall sagen dasselbe --------------------------

  it('zaehlt genau die Tickets, die einzeln betrachtet auf den Ersteller warten', async () => {
    // Zwei Formulierungen derselben Regel - eine als Abfragebedingung, eine
    // als Funktion. Laufen sie auseinander, merkt es sonst niemand.
    const faelle = [
      async (id: string): Promise<void> => {
        await tickets.sendMessage(id, 'Team', SUPPORTER);
      },
      async (id: string): Promise<void> => {
        await tickets.sendMessage(id, 'Team', SUPPORTER);
        await tickets.sendMessage(id, 'Mitglied', MITGLIED);
      },
      async (id: string): Promise<void> => {
        await tickets.addInternalNote(id, 'Notiz', SUPPORTER);
      },
      async (id: string): Promise<void> => {
        await prisma.ticket.update({ where: { id }, data: { status: 'WAITING_FOR_USER' } });
      },
      async (id: string): Promise<void> => {
        await tickets.sendMessage(id, 'Team', SUPPORTER);
        await prisma.ticket.update({ where: { id }, data: { status: 'CLOSED' } });
      },
      async (): Promise<void> => undefined,
    ];

    const ids: string[] = [];
    for (const [index, fall] of faelle.entries()) {
      const id = await neuesTicket(MITGLIED, index + 1);
      await fall(id);
      ids.push(id);
    }

    let einzeln = 0;
    for (const id of ids) {
      if ((await wartetAuf(id)) === 'ERSTELLER') {
        einzeln += 1;
      }
    }

    expect(await zahlFuer(MITGLIED.discordId)).toBe(einzeln);
    expect(einzeln).toBe(2);
  });

  // --- Die Bedeutung fuer den Support bleibt unveraendert -------------------

  it('zaehlt fuer den Support weiterhin die offenen Tickets', async () => {
    // Fuer ihn ist «ein offenes Ticket» Arbeit - auch eines, bei dem gerade
    // das Mitglied am Zug ist. Diese Bedeutung wird nicht angetastet.
    const a = await neuesTicket(MITGLIED, 1);
    const b = await neuesTicket(ZWEITES_MITGLIED, 2);
    const c = await neuesTicket(MITGLIED, 3);
    await tickets.sendMessage(a, 'Frage', SUPPORTER); // wartet auf Mitglied
    await tickets.sendMessage(b, 'Antwort', ZWEITES_MITGLIED); // wartet auf Team
    await prisma.ticket.update({ where: { id: c }, data: { status: 'CLOSED' } });

    const supportZahl = await tickets.ticketNavigationCounter(alsSupport(SUPPORTER.discordId));
    expect(supportZahl).toBe(2);
    expect(supportZahl).toBe(await tickets.countOpenTickets(alsSupport(SUPPORTER.discordId)));
  });

  it('gibt einem Supporter, der selbst ein Ticket eroeffnet hat, weiterhin die Support-Zahl', async () => {
    // Zwei Bedeutungen, eine Person - die Zustaendigkeit entscheidet, nicht
    // die Urheberschaft. Sonst saehe ein Supporter je nach eigenem Ticket
    // eine andere Kennzahl.
    const eigenes = await neuesTicket(SUPPORTER, 1);
    await tickets.sendMessage(eigenes, 'Frage vom Team', {
      discordId: ZWEITES_MITGLIED.discordId,
      username: 'zweiter.supporter',
      isStaff: true,
    });

    expect(await tickets.ticketNavigationCounter(alsSupport(SUPPORTER.discordId))).toBe(1);
    expect(await tickets.countOpenTickets(alsSupport(SUPPORTER.discordId))).toBe(1);
  });

  it('zaehlt ohne jede Ticket-Berechtigung nichts', async () => {
    const ticketId = await neuesTicket();
    await tickets.sendMessage(ticketId, 'Frage', SUPPORTER);

    const ohneRechte: Betrachter = {
      discordId: ZWEITES_MITGLIED.discordId,
      roleIds: [],
      can: () => false,
    };
    expect(await tickets.ticketNavigationCounter(ohneRechte)).toBe(0);
  });
});
