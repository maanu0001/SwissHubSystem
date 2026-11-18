import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_ticket_archiv');

/**
 * Die Ordnung des Ticket-Archivs - gegen eine echte Datenbank.
 *
 * ## Warum das eine Datenbank braucht
 *
 * Weil die Ordnung in der Abfrage steht und nicht im Code: `orderBy` mit
 * `nulls: 'last'` ist eine Eigenschaft von PostgreSQL. Eine Nachbildung
 * davon wuerde vor allem sich selbst pruefen - und zwar genau an der Stelle,
 * an der Altbestand ohne `closedAt` liegt.
 *
 * ## Was bestellt war
 *
 * «Ticket-System: Archivierte Tickets nach Datum auflisten». Vorher ordnete
 * das Archiv nach Dringlichkeit - ein Merkmal, das bei einem erledigten
 * Ticket keine Aussage mehr traegt, und das zuletzt geschlossene stand
 * irgendwo mittendrin.
 */
const { prisma } = await import('@swisshub/database');
const { tickets } = await import('@swisshub/modules');

const TEAM = {
  discordId: '900000000000006001',
  roleIds: [],
  can: (): boolean => true,
};

const tag = (nummer: number): Date => new Date(Date.UTC(2026, 0, nummer, 12, 0, 0));

/** Ein Ticket, direkt in der Tabelle - der Weg ueber Discord ist hier nicht die Frage. */
async function legeTicket(eingabe: {
  nummer: number;
  betreff: string;
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED';
  prioritaet: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  geschlossenAm: Date | null;
  erstelltAm: Date;
  geaendertAm?: Date;
}): Promise<void> {
  await prisma.ticket.create({
    data: {
      // Mandantenschluessel - jedes Ticket gehoert zu einer Guild.
      guildId: '200000000000000000',
      ticketNumber: eingabe.nummer,
      subject: eingabe.betreff,
      status: eingabe.status,
      priority: eingabe.prioritaet,
      creatorDiscordId: '900000000000006099',
      creatorUsername: 'melder',
      closedAt: eingabe.geschlossenAm,
      createdAt: eingabe.erstelltAm,
      updatedAt: eingabe.geaendertAm ?? eingabe.erstelltAm,
      lastMessageAt: eingabe.erstelltAm,
    },
  });
}

async function betreffeImArchiv(): Promise<string[]> {
  const { rows } = await tickets.listTickets(TEAM, { closed: true, page: 1, pageSize: 50 });
  return rows.map((zeile) => zeile.ticket.subject);
}

describeWithDatabase('Ticket-Archiv: die Ordnung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  it('listet geschlossene Tickets nach Schliessungsdatum, neueste zuerst', async () => {
    await legeTicket({
      nummer: 1,
      betreff: 'zuerst geschlossen',
      status: 'CLOSED',
      prioritaet: 'URGENT',
      geschlossenAm: tag(1),
      erstelltAm: tag(1),
    });
    await legeTicket({
      nummer: 2,
      betreff: 'zuletzt geschlossen',
      status: 'CLOSED',
      prioritaet: 'LOW',
      geschlossenAm: tag(9),
      erstelltAm: tag(2),
    });
    await legeTicket({
      nummer: 3,
      betreff: 'dazwischen',
      status: 'ARCHIVED',
      prioritaet: 'NORMAL',
      geschlossenAm: tag(5),
      erstelltAm: tag(3),
    });

    /*
     * Die Dringlichkeit entscheidet hier **nicht** mehr.
     *
     * Das `URGENT` steht unten, weil es am laengsten erledigt ist - genau
     * umgekehrt zur Warteschlange. Waere die alte Ordnung noch da, stuende es
     * oben, und der Test faellt.
     */
    expect(await betreffeImArchiv()).toEqual(['zuletzt geschlossen', 'dazwischen', 'zuerst geschlossen']);
  });

  it('haelt Altbestand ohne Schliessungsdatum unten statt dazwischen', async () => {
    /*
     * `closedAt` kann bei Tickets fehlen, die vor der Einfuehrung des Feldes
     * geschlossen wurden. Ohne `nulls: 'last'` streut PostgreSQL sie bei
     * `desc` **oben** ein - und das Archiv begaenne mit den Tickets, von
     * denen man am wenigsten weiss.
     */
    await legeTicket({
      nummer: 10,
      betreff: 'ohne Datum',
      status: 'CLOSED',
      prioritaet: 'URGENT',
      geschlossenAm: null,
      erstelltAm: tag(1),
      geaendertAm: tag(2),
    });
    await legeTicket({
      nummer: 11,
      betreff: 'mit Datum',
      status: 'CLOSED',
      prioritaet: 'LOW',
      geschlossenAm: tag(3),
      erstelltAm: tag(3),
    });

    expect(await betreffeImArchiv()).toEqual(['mit Datum', 'ohne Datum']);
  });

  it('ordnet Altbestand untereinander nach der letzten Aenderung', async () => {
    // Zwei ohne Schliessungsdatum: dann traegt `updatedAt` die Ordnung weiter.
    await legeTicket({
      nummer: 20,
      betreff: 'älter geändert',
      status: 'CLOSED',
      prioritaet: 'NORMAL',
      geschlossenAm: null,
      erstelltAm: tag(1),
      geaendertAm: tag(2),
    });
    await legeTicket({
      nummer: 21,
      betreff: 'neuer geändert',
      status: 'CLOSED',
      prioritaet: 'NORMAL',
      geschlossenAm: null,
      erstelltAm: tag(1),
      geaendertAm: tag(8),
    });

    expect(await betreffeImArchiv()).toEqual(['neuer geändert', 'älter geändert']);
  });

  it('laesst die Warteschlange nach Dringlichkeit geordnet', async () => {
    /*
     * Die Gegenprobe, und sie ist der eigentliche Punkt: die neue Ordnung
     * gilt nur dem Archiv. In der Warteschlange ist die Frage «wer wartet am
     * laengsten auf eine Antwort», und dort gehoert das Dringendste nach
     * oben. Ohne diesen Test waere eine Umstellung beider Listen auf Datum
     * nicht zu bemerken.
     */
    await legeTicket({
      nummer: 30,
      betreff: 'normal, alt',
      status: 'OPEN',
      prioritaet: 'NORMAL',
      geschlossenAm: null,
      erstelltAm: tag(1),
    });
    await legeTicket({
      nummer: 31,
      betreff: 'dringend, neu',
      status: 'OPEN',
      prioritaet: 'URGENT',
      geschlossenAm: null,
      erstelltAm: tag(9),
    });

    const { rows } = await tickets.listTickets(TEAM, { closed: false, page: 1, pageSize: 50 });
    expect(rows.map((zeile) => zeile.ticket.subject)).toEqual(['dringend, neu', 'normal, alt']);
  });

  it('erkennt das Archiv auch an einer Statusauswahl', async () => {
    /*
     * Die Oberflaeche schickt nicht immer `closed: true` - der Reiter
     * «Archiv» waehlt die Status aus. Eine Erkennung, die nur auf `closed`
     * sieht, liesse das Archiv dann nach Dringlichkeit geordnet, und zwar
     * genau an der Stelle, an der jemand hinsieht.
     */
    await legeTicket({
      nummer: 40,
      betreff: 'dringend, lange zu',
      status: 'CLOSED',
      prioritaet: 'URGENT',
      geschlossenAm: tag(1),
      erstelltAm: tag(1),
    });
    await legeTicket({
      nummer: 41,
      betreff: 'ruhig, frisch zu',
      status: 'ARCHIVED',
      prioritaet: 'LOW',
      geschlossenAm: tag(9),
      erstelltAm: tag(2),
    });

    const { rows } = await tickets.listTickets(TEAM, {
      status: ['CLOSED', 'ARCHIVED'],
      page: 1,
      pageSize: 50,
    });
    expect(rows.map((zeile) => zeile.ticket.subject)).toEqual(['ruhig, frisch zu', 'dringend, lange zu']);
  });
});
