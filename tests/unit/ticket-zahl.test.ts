import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Zahl neben «Tickets» - eine Herkunft, eine Darstellung.
 *
 * Die Fachlichkeit steht im Integrationstest gegen eine echte Datenbank.
 * Hier steht, was man davor nicht falsch machen darf: dass die Zahl an
 * genau einer Stelle entsteht, dass Telefon und Rechner dieselbe bekommen
 * und dass eine Null gar nicht erst erscheint.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('Die Zahl entsteht an einer Stelle', () => {
  const abfragen = lies('packages/modules/src/tickets/queries.ts');

  it('holt das Grundlayout sie über die eine Modulfunktion', () => {
    const layout = lies('apps/web/src/app/(app)/layout.tsx');
    expect(layout).toContain('ticketsModule.ticketNavigationCounter(ticketViewer(context))');
    // Nicht mehr die Support-Zahl für alle - das war der Fehler.
    expect(layout).not.toContain('ticketsModule.countOpenTickets(');
  });

  it('entscheidet die Bedeutung im Modul, nicht in der Oberfläche', () => {
    // Zwei Bedeutungen, eine Stelle: sonst stünde die Fallunterscheidung in
    // der Seitenleiste - und die mobile Navigation träfe sie neu.
    expect(abfragen).toContain('export async function ticketNavigationCounter');
    expect(abfragen).toContain('if (viewer.can(TICKET_PERMISSIONS.supportView))');
  });

  it('leitet den Zustand aus bestehenden Feldern ab, ohne neues Schema', () => {
    // `lastMessageByStaff` und `status` gibt es längst. Ein weiteres Feld
    // wäre eine zweite Wahrheit, die jemand pflegen müsste.
    expect(abfragen).toContain('ticket.lastMessageByStaff');
    expect(abfragen).toContain("ticket.status === 'WAITING_FOR_USER'");
    const schema = lies('packages/database/prisma/schema.prisma');
    expect(schema).not.toContain('awaitingReplyFrom');
    expect(schema).not.toContain('waitingState');
  });

  it('zählt mit einer Abfrage statt mit geladenen Nachrichten', () => {
    // Bei jedem Seitenaufbau sämtliche Ticketnachrichten zu laden wäre
    // genau das N+1, gegen das die Bedingung hier da ist.
    const zaehlung = abfragen.slice(abfragen.indexOf('export async function countTicketsAwaitingCreator'));
    expect(zaehlung.slice(0, 500)).toContain('prisma.ticket.count(');
    expect(zaehlung.slice(0, 500)).not.toContain('messages');
  });

  it('formuliert «meine Tickets» und «wartet auf mich» als zwei UND-Bedingungen', () => {
    // Zwei `OR`-Schlüssel in einem Objekt überschrieben sich - die Zahl
    // zählte dann fremde Tickets mit.
    expect(abfragen).toContain('where: { AND: [meineTickets(discordId), WARTET_AUF_ERSTELLER] }');
  });

  it('lässt die Bedeutung für den Support unverändert', () => {
    // `countOpenTickets` zählt weiterhin, was Arbeit bedeutet - inklusive
    // «wartet auf Mitglied».
    expect(abfragen).toContain('export async function countOpenTickets');
    expect(abfragen).toContain('status: { in: [...OFFENE_TICKET_STATUS] }');
  });
});

describe('Telefon und Rechner zeigen dieselbe Zahl', () => {
  it('bekommen beide dieselbe fertige Liste aus dem Grundlayout', () => {
    const layout = lies('apps/web/src/app/(app)/layout.tsx');
    expect(layout).toContain(
      "count: item.counter === 'openTickets' ? (offeneTickets ?? undefined) : undefined",
    );
    expect(layout).toContain('<AppShell');
    expect(layout).toContain('groups={groups}');

    // Seitenleiste, mobile Navigation und Schnellnavigation reichen dieselbe
    // Liste weiter - keine davon rechnet selbst.
    const shell = lies('apps/web/src/components/layout/app-shell.tsx');
    expect(shell).toContain('<Sidebar\n          groups={groups}');
    expect(shell).toContain('groups={groups}');
    const header = lies('apps/web/src/components/layout/app-header.tsx');
    expect(header).toContain('<MobileNav groups={groups}');
    expect(header).toContain('<CommandPalette groups={groups}');
  });

  it('rechnet in keiner Navigationskomponente selbst', () => {
    for (const datei of [
      'apps/web/src/components/layout/sidebar-nav.tsx',
      'apps/web/src/components/layout/mobile-nav.tsx',
      'apps/web/src/components/layout/command-palette.tsx',
    ]) {
      expect(lies(datei), datei).not.toContain('countOpenTickets');
      expect(lies(datei), datei).not.toContain('lastMessageByStaff');
    }
  });
});

describe('Die Darstellung des Badges', () => {
  const sidebar = lies('apps/web/src/components/layout/sidebar-nav.tsx');

  it('zeigt bei null gar nichts', () => {
    // Eine Null neben einem Eintrag ist eine leere Hülse, die man trotzdem
    // jedes Mal liest.
    expect(sidebar).toContain("typeof entry.count === 'number' && entry.count > 0");
  });

  it('benutzt das bestehende Badge und keine neue Komponente', () => {
    expect(sidebar).toContain('function ItemBadge');
    expect(sidebar).toContain("{entry.count > 99 ? '99+' : entry.count}");
  });
});
