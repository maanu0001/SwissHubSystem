import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { channelLink, guildLink, messageLink } from '@swisshub/discord/cdn';
import { istInterneRoute, systemRoutes } from '@swisshub/shared';

/**
 * Discord ↔ System.
 *
 * Zwei Richtungen, ein Versprechen: ein Deep Link ist Navigation, keine
 * Autorisierung. Er verkürzt den Weg; er öffnet keine Tür. Was hier geprüft
 * wird, ist deshalb nicht «führt der Link irgendwohin», sondern dass die
 * Adressen an einer Stelle entstehen und dass ein Verweis gar nicht erst
 * erscheint, wenn es nichts gibt, worauf er zeigen könnte.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

const GUILD = '900000000000000001';
const KANAL = '900000000000000002';
const NACHRICHT = '900000000000000003';

describe('Discord-Adressen entstehen an einer Stelle', () => {
  it('baut Server, Kanal und Nachricht nach demselben Muster', () => {
    expect(guildLink(GUILD)).toBe(`https://discord.com/channels/${GUILD}`);
    expect(channelLink(GUILD, KANAL)).toBe(`https://discord.com/channels/${GUILD}/${KANAL}`);
    expect(messageLink(GUILD, KANAL, NACHRICHT)).toBe(
      `https://discord.com/channels/${GUILD}/${KANAL}/${NACHRICHT}`,
    );
  });

  it('setzt die Kennungen in der richtigen Reihenfolge ein', () => {
    // Der Fehler, gegen den die Helfer da sind: Gilde und Kanal vertauscht.
    // Eine falsche Adresse dieser Art sieht richtig aus und führt ins Leere.
    const adresse = messageLink(GUILD, KANAL, NACHRICHT);
    expect(adresse.indexOf(GUILD)).toBeLessThan(adresse.indexOf(KANAL));
    expect(adresse.indexOf(KANAL)).toBeLessThan(adresse.indexOf(NACHRICHT));
  });

  it('steht in keiner Komponente mehr von Hand zusammengesetzt', () => {
    // Zehn Stellen mit derselben Zeichenkette sind zehn Gelegenheiten, sie
    // beim nächsten Mal anders zu schreiben.
    for (const datei of [
      'apps/web/src/components/layout/user-menu.tsx',
      'apps/web/src/components/layout/app-shell.tsx',
      'apps/web/src/app/(app)/layout.tsx',
      'apps/web/src/app/(app)/server/page.tsx',
      'apps/web/src/app/(app)/tickets/[ticketId]/page.tsx',
      'apps/web/src/modules/voice/components/talk-panel.tsx',
      'apps/web/src/modules/verification/components/warteschlange.tsx',
      'packages/modules/src/logs/formatters.ts',
    ]) {
      expect(lies(datei), datei).not.toContain('https://discord.com/channels/');
    }
  });
});

describe('System-Adressen entstehen an einer Stelle', () => {
  it('kennt die Ziele, auf die von aussen verwiesen wird', () => {
    expect(systemRoutes.ticket('abc')).toBe('/tickets/abc');
    expect(systemRoutes.mitglied('123')).toBe('/members/123');
    expect(systemRoutes.event('sommerfest')).toBe('/kalender/sommerfest');
    expect(systemRoutes.jail('j1')).toBe('/moderation/jail/j1');
    expect(systemRoutes.automationLauf('r1')).toBe('/automationen/laeufe/r1');
    expect(systemRoutes.verifikation()).toBe('/verifikation/warteschlange');
  });

  it('bleibt bei einer Kennung mit Sonderzeichen eine gültige Adresse', () => {
    // Eine Kennung aus fremder Hand darf die Adresse nicht verlassen können.
    const route = systemRoutes.ticket('a/b?c#d');
    expect(route).toBe('/tickets/a%2Fb%3Fc%23d');
    expect(istInterneRoute(route)).toBe(true);
  });

  it('gibt ausschliesslich Pfade zurück, nie absolute Adressen', () => {
    // Die Domain steht in `appUrl()` und nirgends sonst - genau einmal, in
    // der Konfiguration. Ein Pfad hier hält sie aus den Modulen heraus.
    for (const route of [
      systemRoutes.dashboard(),
      systemRoutes.tickets(),
      systemRoutes.mitglieder(),
      systemRoutes.kalender(),
      systemRoutes.gluecksrad(),
    ]) {
      expect(route.startsWith('/')).toBe(true);
      expect(route).not.toContain('://');
    }
  });

  it('trägt in keinem Modul eine fest verdrahtete Produktionsadresse', () => {
    for (const datei of [
      'packages/modules/src/links.ts',
      'packages/modules/src/tickets/discord.ts',
      'packages/modules/src/verification/discord.ts',
      'packages/modules/src/calendar/discord.ts',
      'packages/modules/src/automation/notify.ts',
    ]) {
      expect(lies(datei), datei).not.toMatch(/https:\/\/(system\.)?swisshub/u);
    }
  });
});

describe('Discord → System', () => {
  it('führt vom Ticket-Kanal ins Ticket', () => {
    const quelle = lies('packages/modules/src/tickets/discord.ts');
    expect(quelle).toContain('imSystemOeffnen(systemRoutes.ticket(input.ticketId))');
    expect(quelle).toContain('ticketId: ticket.id');
  });

  it('lässt den Knopf weg, wenn die Kennung fehlt', () => {
    // Lieber kein Knopf als einer, der auf eine 404 führt.
    expect(lies('packages/modules/src/tickets/discord.ts')).toContain(
      '...(input.ticketId ? [imSystemOeffnen(',
    );
  });

  it('führt von der Verifikation in die Warteschlange und danach zur Akte', () => {
    const quelle = lies('packages/modules/src/verification/discord.ts');
    expect(quelle).toContain("imSystemOeffnen(systemRoutes.verifikation(), 'In der Warteschlange')");
    expect(quelle).toContain('systemRoutes.mitglied(request.discordId)');
  });

  it('führt von der Fehlermeldung einer Automation zum Lauf', () => {
    // Zur Liste zu führen wäre die halbe Antwort: im Fehlerfall zählt der
    // Schritt, an dem es hakte, und den zeigt nur der Lauf.
    const quelle = lies('packages/modules/src/automation/notify.ts');
    expect(quelle).toContain('imSystemOeffnen(systemRoutes.automationLauf(lauf.id))');
    expect(quelle).toContain('imSystemOeffnen(systemRoutes.automationLauf(freigabe.runId))');
  });

  it('führt von der Event-Ankündigung zum Event', () => {
    expect(lies('packages/modules/src/calendar/discord.ts')).toContain(
      'systemLink(systemRoutes.event(event.slug))',
    );
  });

  it('gibt dem Weg ins System überall dieselbe Beschriftung', () => {
    const quelle = lies('packages/modules/src/links.ts');
    expect(quelle).toContain("export const IM_SYSTEM_OEFFNEN = 'Im System öffnen'");
    expect(quelle).toContain('label: string = IM_SYSTEM_OEFFNEN');
  });

  it('benutzt einen Link-Knopf und keine Interaktion', () => {
    // Ein Link-Knopf löst nichts aus: Discord öffnet die Adresse selbst. Der
    // Bot muss nichts beantworten - deshalb kostet dieser Weg nichts.
    const quelle = lies('packages/modules/src/links.ts');
    expect(quelle).toContain('style: BUTTON_STYLE.LINK');
    expect(quelle).not.toContain('custom_id');
  });
});

describe('System → Discord', () => {
  it('zeigt den Verweis nur, wenn es die Ressource gibt', () => {
    // Ohne Kanal-ID keinen Knopf: er führte sonst in einen Kanal, den es
    // nicht mehr gibt - und das sähe aus wie ein Fehler des Systems.
    const ticket = lies('apps/web/src/app/(app)/tickets/[ticketId]/page.tsx');
    expect(ticket).toContain('ticket.discordChannelId');
    expect(ticket).toContain('channelLink(guildId, ticket.discordChannelId)');

    const talk = lies('apps/web/src/modules/voice/components/talk-panel.tsx');
    expect(talk).toContain('channelLink(guildId, talk.discordChannelId)');
  });

  it('weist im Ticket darauf hin, wenn der Kanal verschwunden ist', () => {
    // Der Verlauf bleibt im System vollständig - das ist die Auskunft, die
    // an dieser Stelle zählt.
    expect(lies('apps/web/src/app/(app)/tickets/[ticketId]/page.tsx')).toContain('ticket.channelMissing');
  });
});

describe('Ein Deep Link ist Navigation, keine Autorisierung', () => {
  it('lässt die Berechtigungsprüfung der Zielseite unangetastet', () => {
    // Die Ticket-Detailseite ermittelt den Zugriff weiterhin selbst - der
    // Knopf in Discord ändert daran nichts.
    const ticket = lies('apps/web/src/app/(app)/tickets/[ticketId]/page.tsx');
    expect(ticket).toContain('ladeTicketMitZugriff(context, ticketId)');
    expect(ticket).toContain('requireMember()');
  });

  it('prüft die Warteschlange der Verifikation weiterhin selbst', () => {
    expect(lies('apps/web/src/app/(app)/verifikation/warteschlange/page.tsx')).toContain(
      'requirePagePermission(',
    );
  });
});
