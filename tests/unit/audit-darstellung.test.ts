import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIT_ACTIONS } from '@swisshub/database';
import { AUDIT_LABELS, auditActionLabel } from '../../apps/web/src/modules/audit/labels';
import { auditKategorie, resolveAuditContext } from '../../apps/web/src/modules/audit/kontext';

/**
 * Aus Audit-Datensätzen werden lesbare Vorgänge.
 *
 * ## Woran es lag
 *
 * In der Datenbank steht `TICKET_STATUS_CHANGED`, eine Kennung als
 * Handelnder, eine Kennung als Ziel. Die Liste zeigte genau das - vollständig
 * und praktisch unlesbar. Von 226 Aktionen hatten 30 einen Namen; der Rest
 * stand als Schlüssel da, das Ziel als 18-stellige Zahl, und um zu der Sache
 * zu gelangen, um die es ging, suchte man sie von Hand.
 */
const eintrag = (action: string, metadata: unknown = null, targetDiscordId: string | null = null) => ({
  action,
  metadata,
  targetDiscordId,
});

describe('Namen der Aktionen', () => {
  it('benennt jede Aktion der Registry', () => {
    /*
     * Der Kern: keine Aktion darf als technischer Schlüssel in der Liste
     * stehen. Ein Eintrag ohne Namen sieht aus wie ein Fehler.
     */
    const ohneNamen = Object.values(AUDIT_ACTIONS).filter((action) => !(action in AUDIT_LABELS));
    expect(ohneNamen, `ohne Namen: ${ohneNamen.join(', ')}`).toEqual([]);
  });

  it('benennt nichts, was es nicht gibt', () => {
    // Sonst wächst die Liste mit Namen für Aktionen, die längst weg sind.
    const bekannt = new Set<string>(Object.values(AUDIT_ACTIONS));
    const verwaist = Object.keys(AUDIT_LABELS).filter((key) => !bekannt.has(key));
    expect(verwaist, `verwaist: ${verwaist.join(', ')}`).toEqual([]);
  });

  it('übersetzt die gemeldete Aktion', () => {
    expect(auditActionLabel(AUDIT_ACTIONS.LOGIN)).toBe('Anmeldung');
    expect(auditActionLabel('TICKET_STATUS_CHANGED')).toBe('Ticketstatus geändert');
    expect(auditActionLabel('VERIFICATION_HUMAN_VERIFIED')).toBe('Freigeschaltet');
  });

  it('lässt eine unbekannte Aktion nicht verschwinden', () => {
    // Eine neu hinzugefügte Aktion soll auftauchen, auch bevor jemand ihr
    // einen Namen gegeben hat.
    expect(auditActionLabel('GANZ_NEUE_AKTION')).toBe('GANZ_NEUE_AKTION');
  });

  it('schreibt kein Deutsch, das niemand schreiben würde', () => {
    // Abgeleitete Namen hätten «Ticket Status Geaendert» ergeben. Stichprobe
    // gegen genau das: kein Label besteht nur aus Grossbuchstaben und
    // Unterstrichen.
    for (const [action, label] of Object.entries(AUDIT_LABELS)) {
      expect(label, action).not.toMatch(/^[A-Z_]+$/u);
      expect(label.length, action).toBeGreaterThan(2);
    }
  });
});

describe('Bereiche', () => {
  it('ordnet jede Aktion einem Bereich zu', () => {
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(auditKategorie(action).label, action).toBeTruthy();
    }
  });

  it('trennt die Bereiche sinnvoll', () => {
    expect(auditKategorie(AUDIT_ACTIONS.LOGIN).id).toBe('auth');
    expect(auditKategorie('TICKET_CREATED').id).toBe('tickets');
    expect(auditKategorie('JAIL_CREATED').id).toBe('moderation');
    expect(auditKategorie('VERIFICATION_STARTED').id).toBe('verifikation');
    expect(auditKategorie('XP_RAFFLE_CREATED').id).toBe('level');
    expect(auditKategorie('MIGRATION_APPLIED').id).toBe('migration');
  });

  it('lässt nichts ohne Bereich', () => {
    expect(auditKategorie('VÖLLIG_UNBEKANNT').id).toBe('system');
  });
});

describe('Verweise', () => {
  it('führt von einem Ticket-Eintrag zum Ticket', () => {
    const kontext = resolveAuditContext(eintrag('TICKET_CLOSED', { ticketId: 'tick-1' }));
    expect(kontext.links[0]).toMatchObject({ label: 'Ticket öffnen', href: '/tickets/tick-1' });
  });

  it('führt von einem Jail-Eintrag zum Jail', () => {
    const kontext = resolveAuditContext(eintrag('JAIL_CREATED', { jailId: 'j-7' }));
    expect(kontext.links.some((link) => link.href === '/moderation/jail/j-7')).toBe(true);
  });

  it('führt zum betroffenen Mitglied', () => {
    const kontext = resolveAuditContext(eintrag('MODERATION_BAN', null, '100000000000000001'));
    expect(kontext.links.some((link) => link.href === '/members/100000000000000001')).toBe(true);
  });

  it('baut einen Discord-Nachrichtenlink, wenn alle drei Kennungen da sind', () => {
    const kontext = resolveAuditContext(
      eintrag('COMMUNICATION_MESSAGE_DELETED', {
        channelId: '700000000000000001',
        messageId: '800000000000000002',
      }),
      { guildId: '000000000000000001' },
    );

    const discord = kontext.links.find((link) => link.extern);
    expect(discord?.href).toBe(
      'https://discord.com/channels/000000000000000001/700000000000000001/800000000000000002',
    );
  });

  it('erfindet keinen Nachrichtenlink, wenn eine Kennung fehlt', () => {
    /*
     * Discords Adresse braucht Server, Kanal und Nachricht. Eine halbe
     * Adresse wäre ein Knopf, der auf eine Fehlerseite führt.
     */
    const ohneKanal = resolveAuditContext(
      eintrag('COMMUNICATION_MESSAGE_DELETED', { messageId: '800000000000000002' }),
      { guildId: '000000000000000001' },
    );
    const ohneServer = resolveAuditContext(
      eintrag('COMMUNICATION_MESSAGE_DELETED', {
        channelId: '700000000000000001',
        messageId: '800000000000000002',
      }),
    );

    expect(ohneKanal.links.some((link) => link.extern)).toBe(false);
    expect(ohneServer.links.some((link) => link.extern)).toBe(false);
  });

  it('bietet ohne eigene Kennung wenigstens den Bereich an', () => {
    const kontext = resolveAuditContext(eintrag('VERIFICATION_EXPIRED'));
    expect(kontext.links[0]?.href).toContain('/verifikation');
  });

  it('bietet gar nichts an, wo es nichts zu öffnen gibt', () => {
    expect(resolveAuditContext(eintrag(AUDIT_ACTIONS.LOGIN)).links).toEqual([]);
  });

  it('überfrachtet keine Zeile mit Knöpfen', () => {
    const kontext = resolveAuditContext(
      eintrag('TICKET_CLOSED', { ticketId: 't1', jailId: 'j1', automationId: 'a1' }, '100000000000000001'),
    );
    expect(kontext.links.length).toBeLessThanOrEqual(2);
  });

  it('überlebt kaputte Metadaten', () => {
    // Was aus der Datenbank kommt, ist `unknown`. Ein Log, das an einem alten
    // Eintrag scheitert, wäre kein Log.
    for (const metadata of [null, undefined, 'text', 42, [], { ticketId: 42 }, { ticketId: null }]) {
      expect(() => resolveAuditContext(eintrag('TICKET_CLOSED', metadata))).not.toThrow();
    }
  });
});

describe('Änderungen', () => {
  it('zeigt Vorher und Nachher statt rohem JSON', () => {
    const kontext = resolveAuditContext(
      eintrag('TICKET_STATUS_CHANGED', { oldStatus: 'OPEN', newStatus: 'CLOSED' }),
    );

    expect(kontext.aenderungen).toEqual([{ feld: 'Status', vorher: 'OPEN', nachher: 'CLOSED' }]);
  });

  it('kommt auch mit nur einer Seite zurecht', () => {
    const kontext = resolveAuditContext(eintrag('TICKET_STATUS_CHANGED', { newStatus: 'CLOSED' }));
    expect(kontext.aenderungen).toEqual([{ feld: 'Status', vorher: null, nachher: 'CLOSED' }]);
  });

  it('erfindet keine Änderung, wo keine steht', () => {
    expect(resolveAuditContext(eintrag(AUDIT_ACTIONS.LOGIN)).aenderungen).toEqual([]);
  });
});

describe('Die Zeile', () => {
  const zeile = readFileSync(join(process.cwd(), 'apps/web/src/modules/audit/audit-zeile.tsx'), 'utf8');
  const seite = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/audit/page.tsx'), 'utf8');

  it('zeigt Personen mit Bild und Namen', () => {
    expect(zeile).toContain('<DiscordAvatar');
    expect(zeile).toContain('person?.displayName');
  });

  it('zeigt die Kennung höchstens als Tooltip', () => {
    // `title` statt Fliesstext: wer sie braucht, findet sie; wer das Log
    // liest, muss sie nicht lesen.
    expect(zeile).toContain('title={kennung ?? undefined}');
  });

  it('bleibt bei einem ehemaligen Mitglied lesbar', () => {
    expect(zeile).toContain("ersatzName ?? 'Ehemaliges Mitglied'");
    expect(zeile).toContain('(ehemalig)');
  });

  it('zeigt Rohdaten nicht in der Liste', () => {
    // Nur eingeklappt, und nur für die Verwaltung: Metadaten können Namen
    // und Gründe enthalten.
    expect(zeile).toContain('darfRohdatenSehen');
    expect(seite).toContain("can(context, 'settings.edit')");
  });

  it('schlägt Personen in einem Zug nach', () => {
    /*
     * Fünfundzwanzig Einträge wären sonst bis zu fünfzig Abfragen -
     * Handelnde und Ziele je einzeln.
     */
    expect(seite).toContain('loadPersonen(');
    expect(seite).not.toContain('loadAvatarHashes');
  });

  it('bricht auf dem Telefon um, statt quer zu scrollen', () => {
    expect(zeile).toContain('flex-wrap');
    expect(zeile).toContain('sm:hidden');
    expect(zeile).toContain('hidden shrink-0 whitespace-nowrap pt-0.5');
    expect(zeile).toContain('min-w-0');
  });

  it('kommt ohne Verlaufsfarben und Glaseffekte aus', () => {
    // Hier zählt Informationsdichte, nicht Effekt.
    expect(zeile).not.toContain('backdrop-blur');
    expect(zeile).not.toContain('bg-gradient');
  });
});
