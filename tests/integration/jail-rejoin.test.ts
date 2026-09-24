import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Austritt und Wiedereintritt während eines Jails.
 *
 * Ohne diese Behandlung wäre jede Strafe trivial umgehbar: Server verlassen,
 * neu beitreten, Rollen sind zurück. Der alte Bot löste das im
 * `on_member_join`-Event; hier entscheidet die Datenbank, das Discord-Ereignis
 * stösst es nur an.
 */
const fake: { state?: unknown; module?: unknown } = {};

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const { jail } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');

type State = ReturnType<typeof createFakeState>;

const JAIL_ROLE = '900000000000000006';
const TARGET = '100000000000000004';

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  roleIds: [],
  isOwner: true,
  moderationLevel: 100,
};

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

function resetState(): void {
  state = fake.state as State;
  state.jails.length = 0;
  state.jailRoleSnapshots.length = 0;
  state.audits.length = 0;
  state.idempotency.clear();
  state.managedRoles.length = 0;
  state.moduleSettings.jail = {
    jailRoleId: JAIL_ROLE,
    maxDurationSeconds: 7 * 24 * 60 * 60,
    keepRoleIds: [],
    postModerationLog: false,
    notifyInJailChannel: false,
    announcePublicly: false,
    pingOnJail: false,
    reapplyOnRejoin: true,
  };
}

beforeEach(() => {
  resetState();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

async function jailTarget(durationSeconds: number | null = 3600): Promise<string> {
  const result = await jail.createJail(
    {
      targetDiscordId: TARGET,
      type: durationSeconds === null ? 'PERMANENT' : 'TEMPORARY',
      durationSeconds,
      reason: 'Spam',
      idempotencyKey: crypto.randomUUID(),
    },
    MODERATOR,
    { gateway },
  );
  return result.jail.id;
}

describe('Austritt während eines Jails', () => {
  it('hält den Eintrag offen und vermerkt den Austritt', async () => {
    const id = await jailTarget();

    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(true);

    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('PENDING_REJOIN');
    expect(entry?.leftGuildAt).not.toBeNull();
    expect(entry?.releasedAt).toBeNull();
    // Der Platz bleibt belegt - es kann kein zweiter Jail entstehen.
    expect(entry?.activeKey).toBe(TARGET);
    expect(state.audits.map((row) => row.action)).toContain('JAIL_PENDING_REJOIN');
  });

  it('meldet `false`, wenn gar kein Jail läuft', async () => {
    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(false);
  });

  it('schreibt den Austritt genau einmal auf, auch bei wiederholten Ereignissen', async () => {
    /*
     * Discord liefert `guildMemberRemove` nach einem Verbindungsabriss
     * gelegentlich erneut, und der Bot startet ohnehin regelmaessig neu.
     * Ein Protokoll, das jedes dieser Ereignisse aufzeichnet, beschreibt
     * nicht mehr den Vorgang, sondern die Zuverlaessigkeit der Verbindung.
     */
    await jailTarget();

    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(true);
    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(false);
    expect(await jail.markMemberLeftDuringJail(TARGET)).toBe(false);

    const eintraege = state.audits.filter((row) => row.action === 'JAIL_PENDING_REJOIN');
    expect(eintraege).toHaveLength(1);
  });

  it('schreibt beim Abgleich keinen weiteren Eintrag über denselben Wartezustand', async () => {
    /*
     * Der eigentliche Grund fuer den Spam.
     *
     * Die Reconciliation lief alle fuenfzehn Minuten, fand die wartenden
     * Jails erneut - das Mitglied ist ja weiterhin weg -, meldete sie als
     * `MEMBER_LEFT` und liess `releaseJail` laufen. Dort schrieb der Zweig
     * fuer den ausstehenden Wiedereintritt jedes Mal einen Eintrag. Nach
     * einem Tag waren das sechsundneunzig je wartendem Jail.
     *
     * Hier laufen drei Durchgaenge. Danach darf genau ein Eintrag stehen -
     * der vom tatsaechlichen Austritt.
     */
    const id = await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);
    // Das Mitglied ist weg - so sieht es der Abgleich auch.
    gateway.members.get = (async () => null) as typeof gateway.members.get;

    await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true, gateway });
    await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true, gateway });
    await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true, gateway });

    const eintraege = state.audits.filter((row) => row.action === 'JAIL_PENDING_REJOIN');
    expect(eintraege).toHaveLength(1);

    // Und der Jail wartet weiterhin - der Abgleich hat ihn nicht beendet.
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('PENDING_REJOIN');
    expect(entry?.releasedAt).toBeNull();
    expect(entry?.activeKey).toBe(TARGET);
  });

  it('schreibt auch bei einem direkten Freilassungsversuch nichts Zweites', async () => {
    /*
     * Der Riegel an der Quelle, unabhaengig vom Aufrufer.
     *
     * Der Filter im Abgleich sorgt dafuer, dass `releaseJail` fuer einen
     * wartenden Jail gar nicht mehr aufgerufen wird. Das genuegt heute - und
     * genuegt nicht als Zusage: es gibt mehrere Aufrufer (Scheduler,
     * Abgleich, Verwaltung), und ein kuenftiger vierter wuesste von dem
     * Filter nichts.
     *
     * Deshalb wird hier direkt aufgerufen, so wie es ein solcher Aufrufer
     * taete. Der Uebergang hat bereits stattgefunden; ein zweiter Eintrag
     * waere die Wiederholung derselben Nachricht.
     */
    const id = await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);
    gateway.members.get = (async () => null) as typeof gateway.members.get;

    await jail.releaseJail(id, { releaseType: 'RECONCILED', gateway });
    await jail.releaseJail(id, { releaseType: 'AUTOMATIC', gateway });

    const eintraege = state.audits.filter((row) => row.action === 'JAIL_PENDING_REJOIN');
    expect(eintraege).toHaveLength(1);

    // Und der Jail wartet unveraendert weiter.
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('PENDING_REJOIN');
    expect(entry?.releasedAt).toBeNull();
  });

  it('meldet einen wartenden Jail gar nicht erst als Abweichung', async () => {
    /*
     * Nicht nur kein Audit-Eintrag: er soll auch nicht als «Drift» in der
     * Auswertung stehen. Wer sich den Bericht ansieht, soll dort echte
     * Abweichungen finden und nicht die Liste aller Leute, die den Server
     * waehrend einer Strafe verlassen haben.
     */
    await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);
    gateway.members.get = (async () => null) as typeof gateway.members.get;

    const bericht = await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true, gateway });
    expect(bericht.drift.filter((eintrag) => eintrag.type === 'MEMBER_LEFT')).toHaveLength(0);
  });

  it('lässt einen offenen Jail vom Sweep in Ruhe', async () => {
    const id = await jailTarget(60);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.endsAt = new Date(Date.now() - 1000);

    // Ohne diese Ausnahme würde der Sweep den Eintrag bei jedem Durchgang
    // erneut anfassen, ohne je etwas ausrichten zu können.
    const result = await jail.releaseExpiredJails(10, gateway);
    expect(result.processed).toBe(0);
    expect(state.jails.find((row) => row.id === id)?.releasedAt).toBeNull();
  });
});

describe('Wiedereintritt', () => {
  it('setzt die Jail-Rolle erneut und zählt den Wiedereintritt', async () => {
    const id = await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);

    // Discord kennt das Mitglied wieder - mit frischen Rollen.
    await gateway.members.setRoles(TARGET, ['900000000000000001']);

    const outcome = await jail.reapplyJailOnRejoin(TARGET, { gateway });

    expect(outcome).toBe('reapplied');
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.lifecycle).toBe('ACTIVE');
    expect(entry?.reappliedCount).toBe(1);
    expect(entry?.leftGuildAt).toBeNull();

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).toContain(JAIL_ROLE);
    expect(state.audits.map((row) => row.action)).toContain('JAIL_REAPPLIED');
  });

  it('beendet eine während der Abwesenheit abgelaufene Strafe sauber', async () => {
    const id = await jailTarget(60);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.endsAt = new Date(Date.now() - 1000);

    const outcome = await jail.reapplyJailOnRejoin(TARGET, { gateway });

    expect(outcome).toBe('released');
    const entry = state.jails.find((row) => row.id === id);
    expect(entry?.releasedAt).not.toBeNull();
    expect(entry?.activeKey).toBeNull();

    const member = await gateway.members.get(TARGET);
    expect(member?.roleIds).not.toContain(JAIL_ROLE);
  });

  it('wendet einen permanenten Jail auch nach Monaten wieder an', async () => {
    const id = await jailTarget(null);
    await jail.markMemberLeftDuringJail(TARGET);
    state.jails.find((row) => row.id === id)!.startedAt = new Date('2025-01-01T00:00:00Z');

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('reapplied');
    expect((await gateway.members.get(TARGET))?.roleIds).toContain(JAIL_ROLE);
  });

  it('tut nichts, wenn kein Jail offen ist', async () => {
    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });

  it('tut nichts, wenn die Einstellung deaktiviert ist', async () => {
    await jailTarget();
    await jail.markMemberLeftDuringJail(TARGET);
    (state.moduleSettings.jail as Record<string, unknown>).reapplyOnRejoin = false;

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });

  it('rührt einen bereits freigelassenen Jail nicht an', async () => {
    const id = await jailTarget();
    await jail.releaseJail(id, { releaseType: 'MANUAL', actor: MODERATOR, gateway });

    expect(await jail.reapplyJailOnRejoin(TARGET, { gateway })).toBe('none');
  });
});
