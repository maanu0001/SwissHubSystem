import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_audit_filter');

/**
 * Der Filter des Audit Logs.
 *
 * ## Der Fehler
 *
 * «Aktion → Anmeldung → Filtern» endete mit «Diese Seite konnte nicht geladen
 * werden». Mit der Aktion hatte das nichts zu tun.
 *
 * Ein HTML-Formular schickt beim Absenden **alle** seine Felder mit, auch die
 * leeren. In der Adresszeile stand `?actor=&target=&action=LOGIN&from=&to=…`.
 * `from` war damit `''` - eine Zeichenkette, also griff `.optional()` nicht,
 * und `.date()` lehnte sie ab. `parse` warf, die Server Component brach ab.
 *
 * Also scheiterte **jede** Anwendung des Filters, unabhängig davon, was
 * ausgewählt war.
 */
const { prisma, AUDIT_ACTIONS } = await import('@swisshub/database');
const { leseAuditFilter, loadAuditLog, AUDIT_ACTION_OPTIONS } =
  await import('../../apps/web/src/server/audit');

/** Genau das, was das Formular beim Absenden in die Adresszeile schreibt. */
const wieDasFormular = (auswahl: Record<string, string> = {}): Record<string, string> => ({
  actor: '',
  target: '',
  action: '',
  module: '',
  from: '',
  to: '',
  outcome: 'all',
  ...auswahl,
});

let nummer = 0;

async function eintrag(action: string, optionen: { success?: boolean; module?: string } = {}): Promise<void> {
  nummer += 1;
  await prisma.auditLog.create({
    data: {
      sequence: nummer,
      action,
      module: optionen.module ?? null,
      success: optionen.success ?? true,
      actorDiscordId: '100000000000000001',
      actorUsername: 'moderatorin',
      hash: `hash-${nummer}`,
      previousHash: nummer === 1 ? null : `hash-${nummer - 1}`,
    },
  });
}

describeWithDatabase('Audit Log: der Filter', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "AuditLog" RESTART IDENTITY CASCADE');
    nummer = 0;
  });

  // --- Der gemeldete Fall ---------------------------------------------------

  it('nimmt die Eingabe des Formulars an, so wie sie ankommt', () => {
    // Der eigentliche Fehler: leere Felder gehören mitgeschickt und dürfen
    // nicht zum Abbruch führen.
    const { filter, verworfen } = leseAuditFilter(wieDasFormular({ action: AUDIT_ACTIONS.LOGIN }));

    expect(verworfen).toEqual([]);
    expect(filter.action).toBe(AUDIT_ACTIONS.LOGIN);
    expect(filter.from).toBeUndefined();
    expect(filter.to).toBeUndefined();
  });

  it('filtert «Anmeldung» auf die passenden Einträge', async () => {
    await eintrag(AUDIT_ACTIONS.LOGIN);
    await eintrag(AUDIT_ACTIONS.LOGOUT);
    await eintrag(AUDIT_ACTIONS.LOGIN);

    const { filter } = leseAuditFilter(wieDasFormular({ action: AUDIT_ACTIONS.LOGIN }));
    const ergebnis = await loadAuditLog(filter);

    expect(ergebnis.total).toBe(2);
    expect(ergebnis.items.every((zeile) => zeile.action === AUDIT_ACTIONS.LOGIN)).toBe(true);
  });

  it('scheitert an keiner einzigen Aktion der Registry', async () => {
    /*
     * Nicht nur «Anmeldung». Jede Aktion, die im Auswahlfeld steht, muss sich
     * auch filtern lassen - sonst wandert derselbe Fehler nur woandershin.
     */
    for (const aktion of AUDIT_ACTION_OPTIONS) {
      const { filter, verworfen } = leseAuditFilter(wieDasFormular({ action: aktion }));
      expect(verworfen, `Aktion ${aktion}`).toEqual([]);
      expect(filter.action, `Aktion ${aktion}`).toBe(aktion);
      await expect(loadAuditLog(filter), `Aktion ${aktion}`).resolves.toBeDefined();
    }
    expect(AUDIT_ACTION_OPTIONS.length).toBeGreaterThan(100);
  });

  it('kommt auch mit allen übrigen Feldern des Formulars zurecht', async () => {
    await eintrag(AUDIT_ACTIONS.LOGIN, { module: 'auth' });

    const auswahlen: Array<Record<string, string>> = [
      { outcome: 'success' },
      { outcome: 'error' },
      { module: 'auth' },
      { actor: 'moderatorin' },
      { target: 'irgendwer' },
      { from: '2026-01-01' },
      { to: '2026-12-31' },
      { from: '2026-01-01', to: '2026-12-31' },
    ];
    for (const auswahl of auswahlen) {
      const { filter, verworfen } = leseAuditFilter(wieDasFormular(auswahl));
      expect(verworfen, JSON.stringify(auswahl)).toEqual([]);
      await expect(loadAuditLog(filter), JSON.stringify(auswahl)).resolves.toBeDefined();
    }
  });

  // --- Verbogene Adressen ---------------------------------------------------

  it('übergeht eine unbekannte Aktion, statt die Seite zu verweigern', () => {
    const { filter } = leseAuditFilter({ action: 'GIBT-ES-NICHT' });
    expect(filter.action).toBeUndefined();
  });

  it('übergeht ein unbrauchbares Datum und behält den Rest', async () => {
    const { filter, verworfen } = leseAuditFilter({
      action: AUDIT_ACTIONS.LOGIN,
      from: 'gestern',
    });

    expect(verworfen).toContain('from');
    // Der Aktionsfilter überlebt das kaputte Datum.
    expect(filter.action).toBe(AUDIT_ACTIONS.LOGIN);
    await expect(loadAuditLog(filter)).resolves.toBeDefined();
  });

  it('stürzt an keiner verbogenen Eingabe ab', async () => {
    const eingaben: Array<Record<string, string>> = [
      { outcome: 'vielleicht' },
      { page: 'zwei' },
      { page: '-5' },
      { page: '99999999' },
      { pageSize: '0' },
      { pageSize: '100000' },
      { from: '2026-13-45' },
      { to: '' },
      { action: '   ' },
      { actor: 'x'.repeat(500) },
    ];
    for (const eingabe of eingaben) {
      const { filter } = leseAuditFilter(eingabe);
      await expect(loadAuditLog(filter), JSON.stringify(eingabe)).resolves.toBeDefined();
    }
  });

  // --- Seitenzahl -----------------------------------------------------------

  it('holt die letzte vorhandene Seite, wenn der Filter weniger Seiten übrig lässt', async () => {
    /*
     * Wer auf Seite 12 steht und dann filtert, steht selten wieder auf Seite
     * 12. Vorher blieb die Zahl stehen und das Ergebnis war «Keine Einträge»
     * - obwohl es Treffer gab, nur weiter vorne.
     */
    for (let i = 0; i < 5; i += 1) {
      await eintrag(AUDIT_ACTIONS.LOGIN);
    }

    const { filter } = leseAuditFilter({ action: AUDIT_ACTIONS.LOGIN, page: '12', pageSize: '25' });
    const ergebnis = await loadAuditLog(filter);

    expect(ergebnis.total).toBe(5);
    expect(ergebnis.items).toHaveLength(5);
    expect(ergebnis.page).toBe(1);
  });

  it('lässt eine leere Trefferliste leer, statt zu blättern', async () => {
    const { filter } = leseAuditFilter({ action: AUDIT_ACTIONS.LOGIN, page: '3' });
    const ergebnis = await loadAuditLog(filter);

    expect(ergebnis.total).toBe(0);
    expect(ergebnis.items).toEqual([]);
  });
});
