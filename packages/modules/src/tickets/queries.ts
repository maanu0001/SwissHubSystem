import { prisma } from '@swisshub/database';
import type { Prisma as PrismaTypes, Ticket, TicketPriority, TicketStatus } from '@swisshub/database';
import { ticketSichtbarkeitsFilter, type TicketViewer } from './access';
import { TICKET_PERMISSIONS } from './config';

/** Kennzahlen der Uebersicht. */
export interface TicketOverview {
  offen: number;
  inBearbeitung: number;
  wartetAufMitglied: number;
  wartetAufSupport: number;
  heuteErstellt: number;
  nichtZugewiesen: number;
  ueberfaellig: number;
}

/**
 * Die Status, in denen ein Ticket noch bearbeitet wird.
 *
 * Nicht dabei: `PENDING` und `CREATION_FAILED` - Tickets, die es noch gar
 * nicht gibt oder deren Anlage scheiterte. Eine Zahl, die auf etwas zeigt,
 * das man nicht bearbeiten kann, schickt jemanden ins Leere. Ebenso wenig
 * `CLOSED` und `ARCHIVED`: erledigt ist erledigt.
 *
 * An einer Stelle, damit «offen» in der Seitenleiste, auf dem Dashboard und
 * in den Kennzahlen dasselbe heisst.
 */
export const OFFENE_TICKET_STATUS = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'WAITING_FOR_STAFF',
  'RESOLVED',
] as const satisfies readonly TicketStatus[];

/**
 * Wie viele Tickets gerade offen sind.
 *
 * Fuer die Verwaltung: sie zaehlt, was Arbeit bedeutet - alles, was weder
 * geschlossen noch archiviert ist. Ausdruecklich auch «wartet auf Mitglied»:
 * das Ticket ist offen, nur liegt der Ball gerade woanders.
 *
 * **Nicht** die Zahl fuer den Ersteller. Fuer ihn heisst «ein offenes
 * Ticket» nicht «du musst etwas tun» - siehe `countTicketsAwaitingCreator`.
 *
 * Durch dieselbe Sichtbarkeit gefiltert wie alles andere: auch eine Zahl
 * verraet etwas.
 */
export async function countOpenTickets(viewer: TicketViewer): Promise<number> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);
  return prisma.ticket.count({
    where: { ...sichtbar, status: { in: [...OFFENE_TICKET_STATUS] } },
  });
}

/** Wer bei einem Ticket am Zug ist. */
export type TicketWartetAuf = 'TEAM' | 'ERSTELLER' | 'NIEMAND';

/**
 * Wer ist am Zug?
 *
 * Die eine fachliche Regel des Ticket-Systems, und sie steht hier statt an
 * vier Stellen. Abgeleitet wird sie aus zwei Feldern, die es bereits gibt -
 * ein neues Prisma-Feld braucht es dafuer nicht:
 *
 * - **`lastMessageByStaff`** ist das eigentliche Signal. Es wird in
 *   `speichere()` bei jeder *sichtbaren* Nachricht gesetzt, gleich ob sie
 *   ueber Discord oder ueber die WebApp kam - beide Wege gehen durch
 *   dieselbe Funktion. Interne Notizen kommen dort gar nicht erst an: sie
 *   kehren vorher um. Zuweisungen, Schlagwoerter und Automations-Ereignisse
 *   fassen das Feld ueberhaupt nicht an.
 * - **`status === 'WAITING_FOR_USER'`** zaehlt nur, solange noch niemand
 *   geschrieben hat. Dann ist es eine ausdrueckliche Aussage der Verwaltung
 *   («wir warten auf dich»), und es gibt kein juengeres Signal, das ihr
 *   widerspraeche. Sobald eine Nachricht vorliegt, entscheidet sie - der
 *   Status koennte sonst veraltet sein, denn er wird nur nachgezogen, wenn
 *   `autoWaitingStatus` eingeschaltet ist.
 *
 * **Ein frisches Ticket wartet auf das Team.** Beim Anlegen entsteht keine
 * Nachricht: die Eroeffnung im Kanal schickt der Bot, und was der Bot
 * schreibt, uebernimmt die Spiegelung nicht. `lastMessageByStaff` ist damit
 * `null` - der Ersteller hat sein Anliegen gesendet, und das Team ist am Zug.
 */
export function ticketWartetAuf(ticket: Pick<Ticket, 'status' | 'lastMessageByStaff'>): TicketWartetAuf {
  if (!(OFFENE_TICKET_STATUS as readonly TicketStatus[]).includes(ticket.status)) {
    return 'NIEMAND';
  }
  if (ticket.lastMessageByStaff === null) {
    return ticket.status === 'WAITING_FOR_USER' ? 'ERSTELLER' : 'TEAM';
  }
  return ticket.lastMessageByStaff ? 'ERSTELLER' : 'TEAM';
}

/**
 * Dieselbe Regel als Abfragebedingung.
 *
 * Damit die Zahl fuer die Seitenleiste eine einzige `count`-Abfrage ist und
 * nicht das Laden saemtlicher Nachrichten. Sie muss mit `ticketWartetAuf`
 * uebereinstimmen; ein Test vergleicht beide Wege an denselben Tickets.
 */
const WARTET_AUF_ERSTELLER: PrismaTypes.TicketWhereInput = {
  status: { in: [...OFFENE_TICKET_STATUS] },
  OR: [{ lastMessageByStaff: true }, { lastMessageByStaff: null, status: 'WAITING_FOR_USER' }],
};

/** Ersteller oder aktiver Teilnehmer - die Menge hinter «Meine Tickets». */
const meineTickets = (discordId: string): PrismaTypes.TicketWhereInput => ({
  OR: [{ creatorDiscordId: discordId }, { participants: { some: { discordId, removedAt: null } } }],
});

/**
 * Bei wie vielen meiner offenen Tickets wartet das Team auf mich?
 *
 * Die Zahl neben «Tickets» fuer alle, die nicht im Support arbeiten. Sie
 * bedeutet ausdruecklich **nicht** «wie viele offene Tickets habe ich» -
 * sonst traegt jedes frisch erstellte Ticket sofort eine Eins, obwohl gerade
 * das Team am Zug ist.
 *
 * Gezaehlt wird ueber Ersteller **und** aktive Teilnehmer: wer zu einem
 * Ticket hinzugefuegt wurde, sieht es unter «Meine Tickets» und ist ebenso
 * gemeint, wenn das Team dort nachfragt. Genau die Menge, die hinter dem
 * Eintrag steht, auf dem die Zahl sitzt.
 */
export async function countTicketsAwaitingCreator(discordId: string): Promise<number> {
  // Beide Bedingungen ueber `AND`, nicht als zwei `OR`-Schluessel in einem
  // Objekt: das zweite ueberschriebe sonst stillschweigend das erste, und
  // die Zahl zaehlte ploetzlich fremde Tickets mit.
  return prisma.ticket.count({
    where: { AND: [meineTickets(discordId), WARTET_AUF_ERSTELLER] },
  });
}

/**
 * Die Zahl neben «Tickets» in der Navigation.
 *
 * Ein Eintrag, zwei Bedeutungen - und das ist kein Versehen, sondern die
 * Sache selbst:
 *
 * - Wer im **Support** arbeitet, will wissen, wie viel Arbeit wartet. Fuer
 *   ihn zaehlt die Zahl offene Tickets, unveraendert wie bisher.
 * - Wer ein Ticket **eroeffnet** hat, will wissen, ob jemand auf ihn wartet.
 *   Fuer ihn zaehlt sie Tickets, bei denen er am Zug ist.
 *
 * Beide Zahlen entstehen hier, an einer Stelle. Seitenleiste, mobile
 * Navigation und Schnellnavigation bekommen dieselbe fertige Zahl aus dem
 * Grundlayout - eine Zahl, die auf dem Telefon anders ausfiele als am
 * Rechner, kann so gar nicht entstehen.
 */
export async function ticketNavigationCounter(viewer: TicketViewer): Promise<number> {
  if (viewer.can(TICKET_PERMISSIONS.supportView)) {
    return countOpenTickets(viewer);
  }
  return countTicketsAwaitingCreator(viewer.discordId);
}

/**
 * Kennzahlen - immer durch die Sichtbarkeit gefiltert.
 *
 * Auch eine Zahl verraet etwas: ein Supporter, der nicht fuer Moderation
 * zustaendig ist, soll nicht an der Zahl ablesen, wie viele Meldungen
 * eingehen.
 */
export async function getOverview(viewer: TicketViewer): Promise<TicketOverview> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);

  const zaehle = (wo: Record<string, unknown>): Promise<number> =>
    prisma.ticket.count({ where: { ...sichtbar, ...wo } });

  const [offen, inBearbeitung, wartetAufMitglied, wartetAufSupport, heuteErstellt, nichtZugewiesen] =
    await Promise.all([
      zaehle({ status: 'OPEN' }),
      zaehle({ status: 'IN_PROGRESS' }),
      zaehle({ status: 'WAITING_FOR_USER' }),
      zaehle({ status: 'WAITING_FOR_STAFF' }),
      zaehle({ createdAt: { gte: heute } }),
      zaehle({ assignedToDiscordId: null, status: { in: ['OPEN', 'WAITING_FOR_STAFF'] } }),
    ]);

  // Ueberfaellig: wartet auf Support und seit ueber 24 Stunden unberuehrt.
  const ueberfaellig = await zaehle({
    status: { in: ['OPEN', 'WAITING_FOR_STAFF'] },
    OR: [
      { lastMessageAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
      { lastMessageAt: null, createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
    ],
  });

  return {
    offen,
    inBearbeitung,
    wartetAufMitglied,
    wartetAufSupport,
    heuteErstellt,
    nichtZugewiesen,
    ueberfaellig,
  };
}

export interface TicketListQuery {
  status?: TicketStatus[];
  priority?: TicketPriority;
  categoryId?: string;
  assignedTo?: string | null;
  creatorDiscordId?: string;
  search?: string;
  /** Nur geschlossene - fuer das Archiv. */
  closed?: boolean;
  page: number;
  pageSize: number;
}

export interface TicketRow {
  ticket: Ticket;
  categoryName: string | null;
  tagNames: string[];
  messageCount: number;
}

/** Die Reihenfolge der Warteschlange. */
const DRINGLICHKEIT: Record<TicketPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * Tickets auflisten.
 *
 * Sortiert nach Dringlichkeit, dann nach dem aeltesten Wartenden. Wer am
 * laengsten auf eine Antwort wartet, steht oben - nicht das zuletzt
 * Erstellte.
 */
export async function listTickets(
  viewer: TicketViewer,
  query: TicketListQuery,
): Promise<{ rows: TicketRow[]; total: number }> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);

  const where: Record<string, unknown> = { ...sichtbar };
  if (query.status && query.status.length > 0) {
    where.status = { in: query.status };
  } else if (query.closed === true) {
    where.status = { in: ['CLOSED', 'ARCHIVED'] };
  } else if (query.closed === false) {
    where.status = { notIn: ['CLOSED', 'ARCHIVED'] };
  }
  if (query.priority) {
    where.priority = query.priority;
  }
  if (query.categoryId) {
    where.categoryId = query.categoryId;
  }
  if (query.assignedTo !== undefined) {
    where.assignedToDiscordId = query.assignedTo;
  }
  if (query.creatorDiscordId) {
    where.creatorDiscordId = query.creatorDiscordId;
  }
  if (query.search) {
    const begriff = query.search.trim();
    const alsNummer = Number.parseInt(begriff.replace(/^#/u, ''), 10);
    where.AND = [
      {
        OR: [
          { subject: { contains: begriff, mode: 'insensitive' } },
          { creatorUsername: { contains: begriff, mode: 'insensitive' } },
          { creatorDiscordId: begriff },
          ...(Number.isFinite(alsNummer) ? [{ ticketNumber: alsNummer }] : []),
        ],
      },
    ];
  }

  const [eintraege, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        category: { select: { name: true } },
        tags: { include: { tag: { select: { name: true } } } },
        _count: { select: { messages: true } },
      },
      orderBy: [{ priority: 'asc' }, { lastMessageAt: 'asc' }, { createdAt: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  const rows = eintraege
    .map((eintrag) => {
      const { category, tags, _count, ...ticket } = eintrag;
      return {
        ticket,
        categoryName: category?.name ?? null,
        tagNames: tags.map((zuweisung) => zuweisung.tag.name),
        messageCount: _count.messages,
      };
    })
    // Prisma sortiert Enums alphabetisch, nicht nach Dringlichkeit.
    .sort((a, b) => DRINGLICHKEIT[a.ticket.priority] - DRINGLICHKEIT[b.ticket.priority]);

  return { rows, total };
}

/** Ein einzelnes Ticket - ohne Zugriffspruefung, die macht der Aufrufer. */
export async function getTicket(ticketId: string) {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      category: true,
      participants: { where: { removedAt: null } },
      tags: { include: { tag: true } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
}

/** Statistiken - nur echte Zahlen, nichts Geschaetztes. */
export async function getStats(viewer: TicketViewer): Promise<{
  gesamt: number;
  proStatus: Array<{ status: TicketStatus; anzahl: number }>;
  proKategorie: Array<{ name: string; anzahl: number }>;
  ersteAntwortMinuten: number | null;
  loesungsdauerStunden: number | null;
  bewertung: { schnitt: number; anzahl: number } | null;
}> {
  const sichtbar = await ticketSichtbarkeitsFilter(viewer);

  const [gesamt, nachStatus, kategorien] = await Promise.all([
    prisma.ticket.count({ where: sichtbar }),
    prisma.ticket.groupBy({ by: ['status'], where: sichtbar, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ['categoryId'], where: sichtbar, _count: { _all: true } }),
  ]);

  const kategorieNamen = await prisma.ticketCategory.findMany({ select: { id: true, name: true } });
  const namen = new Map(kategorieNamen.map((eintrag) => [eintrag.id, eintrag.name]));

  // Antwort- und Loesungszeiten nur aus Tickets, die den Zeitpunkt wirklich
  // tragen. Fehlende Werte mitzurechnen ergaebe eine schoenere, falsche Zahl.
  const mitAntwort = await prisma.ticket.findMany({
    where: { ...sichtbar, firstStaffResponseAt: { not: null } },
    select: { createdAt: true, firstStaffResponseAt: true },
    take: 500,
    orderBy: { createdAt: 'desc' },
  });
  const geloest = await prisma.ticket.findMany({
    where: { ...sichtbar, closedAt: { not: null } },
    select: { createdAt: true, closedAt: true },
    take: 500,
    orderBy: { closedAt: 'desc' },
  });

  const schnitt = (werte: number[]): number | null =>
    werte.length === 0 ? null : werte.reduce((a, b) => a + b, 0) / werte.length;

  const bewertungen = await prisma.ticketFeedback.aggregate({
    _avg: { rating: true },
    _count: { _all: true },
  });

  return {
    gesamt,
    proStatus: nachStatus.map((eintrag) => ({
      status: eintrag.status,
      anzahl: eintrag._count._all,
    })),
    proKategorie: kategorien
      .map((eintrag) => ({
        name: eintrag.categoryId ? (namen.get(eintrag.categoryId) ?? 'Ohne Kategorie') : 'Ohne Kategorie',
        anzahl: eintrag._count._all,
      }))
      .sort((a, b) => b.anzahl - a.anzahl),
    ersteAntwortMinuten: schnitt(
      mitAntwort.map(
        (eintrag) => (eintrag.firstStaffResponseAt!.getTime() - eintrag.createdAt.getTime()) / 60_000,
      ),
    ),
    loesungsdauerStunden: schnitt(
      geloest.map((eintrag) => (eintrag.closedAt!.getTime() - eintrag.createdAt.getTime()) / 3600_000),
    ),
    bewertung:
      bewertungen._count._all > 0
        ? { schnitt: bewertungen._avg.rating ?? 0, anzahl: bewertungen._count._all }
        : null,
  };
}
