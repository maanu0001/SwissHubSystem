import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_jail_sammelfreilassung');

/**
 * «Alle Jails aufheben und löschen».
 *
 * Eine Schaltfläche, die in einem Zug jede gejailte Person anfasst und danach
 * Zeilen unwiderruflich entfernt. Zwei Fragen entscheiden, ob sie brauchbar
 * oder gefährlich ist, und beide lassen sich nur gegen eine echte Datenbank
 * beantworten:
 *
 * 1. Wird wirklich **erst freigelassen und dann gelöscht**? Andersherum bliebe
 *    die Jail-Rolle auf Discord kleben, während der Eintrag verschwindet -
 *    gesperrt ohne Spur.
 * 2. Was passiert, wenn eine Freilassung scheitert? Dieser Eintrag darf nicht
 *    gelöscht werden; er ist dann das Einzige, was noch davon weiss.
 *
 * Dazu kommt, was die Fälschung einer Datenbank nicht abbilden kann: die
 * Fremdschlüssel. Rollenschnappschüsse hängen am Jail und müssen mitgehen,
 * eine Abstimmung darf durch das Löschen nicht mitgerissen werden, und die
 * Moderationshistorie verweist frei - sie muss stehen bleiben.
 */
const { prisma } = await import('@swisshub/database');
const { jail, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { createMockGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

const JAIL_ROLE = '900000000000000006';
const MEMBER_ROLE = '900000000000000008';

/** Mitglieder, die das Mock-Gateway kennt. */
const SPAMMER = '100000000000000004';
const ROESCHTI = '100000000000000006';
const FUCHS = '100000000000000005';

const MODERATOR = {
  discordId: '100000000000000002',
  username: 'nina.mod',
  avatarHash: null,
  roleIds: ['900000000000000003', MEMBER_ROLE],
  isOwner: false,
  moderationLevel: 50,
};

let gateway: ReturnType<typeof createMockGateway>;

/**
 * Discord verweigert fuer diese Person jede Rollenaenderung.
 *
 * Beide Wege muessen scheitern, denn `releaseJail` hat einen Rueckfall: geht
 * die Sammelaktualisierung schief, entfernt es die Jail-Rolle einzeln. Erst
 * wenn auch das misslingt, traegt die Person ihre Jail-Rolle weiter - und nur
 * dann wirft die Freilassung. Genau dieser Fall ist der gefaehrliche, und nur
 * er darf das Loeschen verhindern.
 */
function discordVerweigert(discordId: string): void {
  const setRoles = gateway.members.setRoles.bind(gateway.members);
  gateway.members.setRoles = async (ziel: string, roleIds: string[], grund?: string) => {
    if (ziel === discordId) {
      throw new Error('Discord antwortet nicht');
    }
    return setRoles(ziel, roleIds, grund);
  };
  const remove = gateway.roles.remove.bind(gateway.roles);
  gateway.roles.remove = async (ziel: string, roleId: string, grund?: string) => {
    if (ziel === discordId) {
      throw new Error('Discord antwortet nicht');
    }
    return remove(ziel, roleId, grund);
  };
}

/** Ein laufender Jail, direkt in der Datenbank. */
async function laufenderJail(discordId: string, username: string): Promise<string> {
  const eintrag = await prisma.jailEntry.create({
    data: {
      targetDiscordId: discordId,
      targetUsername: username,
      moderatorDiscordId: MODERATOR.discordId,
      moderatorUsername: MODERATOR.username,
      reason: 'Spam im Chat',
      type: 'TEMPORARY',
      durationSeconds: 3600,
      endsAt: new Date(Date.now() + 3600_000),
      roleSnapshot: [MEMBER_ROLE],
      status: 'COMPLETED',
      lifecycle: 'ACTIVE',
      // Der Unique-Index, der zwei gleichzeitige Jails je Person verhindert.
      activeKey: discordId,
    },
  });
  await prisma.jailRoleSnapshot.create({
    data: { jailId: eintrag.id, roleId: MEMBER_ROLE, roleNameAtTime: 'Mitglied' },
  });
  return eintrag.id;
}

/** Ein bereits beendeter Jail - er gehört in den Verlauf, nicht in die Aktion. */
async function beendeterJail(discordId: string, username: string): Promise<string> {
  const eintrag = await prisma.jailEntry.create({
    data: {
      targetDiscordId: discordId,
      targetUsername: username,
      moderatorDiscordId: MODERATOR.discordId,
      moderatorUsername: MODERATOR.username,
      reason: 'Alter Vorfall',
      type: 'TEMPORARY',
      durationSeconds: 3600,
      startedAt: new Date(Date.now() - 7 * 24 * 3600_000),
      endsAt: new Date(Date.now() - 6 * 24 * 3600_000),
      releasedAt: new Date(Date.now() - 6 * 24 * 3600_000),
      releaseType: 'AUTOMATIC',
      status: 'COMPLETED',
      releaseStatus: 'COMPLETED',
      lifecycle: 'RELEASED',
      activeKey: null,
    },
  });
  return eintrag.id;
}

describeWithDatabase('Jail: alle aufheben und löschen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "JailRoleSnapshot","VoteJailVote","VoteJail","JailEntry","ModerationAction","ManagedRole","RolePermission","ModuleState","AuditLog","IdempotencyRecord" RESTART IDENTITY CASCADE',
    );
    invalidateRoleConfiguration();
    gateway = createMockGateway();
    await setModuleEnabled(jail.JAIL_MODULE_ID, true, 'test');
    await setModuleSettings(
      jail.JAIL_MODULE_ID,
      { jailRoleId: JAIL_ROLE, postModerationLog: false, pingOnJail: false },
      'test',
    );
  });

  // --- Die Zählung -------------------------------------------------------

  it('zählt genau das, was der Reiter «Aktiv» zeigt', async () => {
    await laufenderJail(SPAMMER, 'spammer99');
    await laufenderJail(ROESCHTI, 'roeschti');
    await beendeterJail(FUCHS, 'alpenfuchs');

    expect(await jail.countActiveJails()).toBe(2);

    const liste = await jail.listJails(jail.jailListQuerySchema.parse({ tab: 'active' }));
    expect(liste.total).toBe(2);
  });

  it('zählt ohne laufende Jails null', async () => {
    await beendeterJail(FUCHS, 'alpenfuchs');
    expect(await jail.countActiveJails()).toBe(0);
  });

  // --- Der gute Fall -----------------------------------------------------

  it('lässt alle frei und löscht danach genau deren Einträge', async () => {
    const einer = await laufenderJail(SPAMMER, 'spammer99');
    const anderer = await laufenderJail(ROESCHTI, 'roeschti');

    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis.gefunden).toBe(2);
    expect(ergebnis.freigelassen).toBe(2);
    expect(ergebnis.geloescht).toBe(2);
    expect(ergebnis.fehlgeschlagen).toEqual([]);

    expect(await prisma.jailEntry.findUnique({ where: { id: einer } })).toBeNull();
    expect(await prisma.jailEntry.findUnique({ where: { id: anderer } })).toBeNull();
  });

  it('nimmt den Betroffenen die Jail-Rolle wirklich ab', async () => {
    // Der Kern der Reihenfolge: nicht nur die Zeile ist weg, die Person ist
    // auch tatsächlich frei. Wäre nur gelöscht worden, trüge sie die Rolle
    // weiter - und niemand wüsste davon.
    await gateway.members.setRoles(SPAMMER, [JAIL_ROLE], 'Test');
    await laufenderJail(SPAMMER, 'spammer99');

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    const mitglied = await gateway.members.get(SPAMMER);
    expect(mitglied?.roleIds).not.toContain(JAIL_ROLE);
    expect(mitglied?.roleIds).toContain(MEMBER_ROLE);
  });

  it('lässt den Verlauf unter «Vergangen» unberührt', async () => {
    const alt = await beendeterJail(FUCHS, 'alpenfuchs');
    await laufenderJail(SPAMMER, 'spammer99');

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(await prisma.jailEntry.findUnique({ where: { id: alt } })).not.toBeNull();
  });

  it('nimmt die Rollenschnappschüsse der gelöschten Jails mit', async () => {
    // Sie hängen am Jail. Blieben sie liegen, wären es Zeilen, auf die nichts
    // mehr zeigt.
    await laufenderJail(SPAMMER, 'spammer99');
    expect(await prisma.jailRoleSnapshot.count()).toBe(1);

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(await prisma.jailRoleSnapshot.count()).toBe(0);
  });

  it('lässt die Moderationshistorie stehen', async () => {
    // Sie verweist über eine freie Kennung, nicht über einen Fremdschlüssel -
    // «X wurde gejailt» und «X wurde freigelassen» bleiben lesbar, auch wenn
    // der Jail-Eintrag weg ist. Genau das macht die Aktion vertretbar.
    await laufenderJail(SPAMMER, 'spammer99');

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    const historie = await prisma.moderationAction.findMany({
      where: { targetDiscordId: SPAMMER },
    });
    expect(historie.length).toBeGreaterThan(0);
    expect(historie.some((eintrag) => eintrag.type === 'JAIL_RELEASE')).toBe(true);
  });

  it('schreibt einen Eintrag ins Audit Log', async () => {
    await laufenderJail(SPAMMER, 'spammer99');
    await laufenderJail(ROESCHTI, 'roeschti');

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'JAIL_PURGED' },
      orderBy: { sequence: 'desc' },
    });
    expect(eintrag).not.toBeNull();
    expect(eintrag?.actorDiscordId).toBe(MODERATOR.discordId);
    expect(eintrag?.success).toBe(true);
    expect(eintrag?.metadata).toMatchObject({ gefunden: 2, freigelassen: 2, geloescht: 2 });
  });

  it('protokolliert jede einzelne Freilassung weiterhin', async () => {
    // Die Sammelaktion ersetzt die Einzelprotokolle nicht - sonst stünde im
    // Audit Log nur «zwei Einträge gelöscht» und nirgends, wer freikam.
    await laufenderJail(SPAMMER, 'spammer99');
    await laufenderJail(ROESCHTI, 'roeschti');

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    const freilassungen = await prisma.auditLog.findMany({ where: { action: 'JAIL_RELEASED' } });
    expect(freilassungen).toHaveLength(2);
  });

  // --- Der schlechte Fall ------------------------------------------------

  it('löscht keinen Eintrag, dessen Freilassung gescheitert ist', async () => {
    /*
     * Die wichtigste Zusicherung dieser Datei.
     *
     * Geht die Freilassung schief - Discord nicht erreichbar, Rolle weg -,
     * trägt die Person ihre Jail-Rolle weiter. Verschwände jetzt auch noch
     * ihr Eintrag, wäre sie gesperrt, ohne dass irgendwo stünde, warum, und
     * ohne dass die Oberfläche sie noch fände.
     */
    const heil = await laufenderJail(SPAMMER, 'spammer99');
    const kaputt = await laufenderJail(ROESCHTI, 'roeschti');

    discordVerweigert(ROESCHTI);

    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis.gefunden).toBe(2);
    expect(ergebnis.freigelassen).toBe(1);
    expect(ergebnis.geloescht).toBe(1);
    expect(ergebnis.fehlgeschlagen).toHaveLength(1);
    expect(ergebnis.fehlgeschlagen[0]?.jailId).toBe(kaputt);

    expect(await prisma.jailEntry.findUnique({ where: { id: heil } })).toBeNull();
    expect(await prisma.jailEntry.findUnique({ where: { id: kaputt } })).not.toBeNull();
  });

  it('lässt ein Scheitern die übrigen nicht aufhalten', async () => {
    // Der erste in der Reihe scheitert - die beiden danach müssen trotzdem
    // freikommen. Sonst hinge das Ergebnis davon ab, wer zufällig zuerst
    // drankam.
    await laufenderJail(ROESCHTI, 'roeschti');
    await laufenderJail(SPAMMER, 'spammer99');
    await laufenderJail(FUCHS, 'alpenfuchs');

    discordVerweigert(ROESCHTI);

    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis.freigelassen).toBe(2);
    expect(ergebnis.geloescht).toBe(2);
    expect(await prisma.jailEntry.count()).toBe(1);
  });

  it('vermerkt einen unvollständigen Durchlauf als nicht erfolgreich', async () => {
    // Ein «erledigt» mit einer gescheiterten Freilassung darunter wäre im
    // Protokoll später nicht mehr von einem sauberen Durchlauf zu
    // unterscheiden.
    await laufenderJail(ROESCHTI, 'roeschti');

    discordVerweigert(ROESCHTI);

    await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    const eintrag = await prisma.auditLog.findFirst({ where: { action: 'JAIL_PURGED' } });
    expect(eintrag?.success).toBe(false);
  });

  it('löscht trotzdem, wenn nur eine wiederherzustellende Rolle fehlschlägt', async () => {
    // Die feine, aber entscheidende Unterscheidung: eine Rolle, die nicht
    // zurückgegeben werden konnte, ist ärgerlich - die Jail-Rolle ist aber
    // weg, die Person also frei. Das darf das Löschen nicht blockieren,
    // sondern nur eine Warnung erzeugen. Blockierte es, bliebe nach jedem
    // Durchlauf ein Rest liegen, den niemand mehr zuordnen kann.
    await laufenderJail(SPAMMER, 'spammer99');

    const setRoles = gateway.members.setRoles.bind(gateway.members);
    gateway.members.setRoles = async (ziel: string, roleIds: string[], grund?: string) => {
      throw new Error('Sammelaktualisierung nicht möglich');
      // Der Rückfall - Jail-Rolle einzeln entfernen - gelingt weiterhin.
      return setRoles(ziel, roleIds, grund);
    };
    gateway.roles.add = async () => {
      throw new Error('Rolle existiert nicht mehr');
    };

    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis.freigelassen).toBe(1);
    expect(ergebnis.geloescht).toBe(1);
    expect(ergebnis.fehlgeschlagen).toEqual([]);
    // Die Warnung trägt den Namen - sonst wäre am Ende nicht erkennbar, wen
    // sie betrifft.
    expect(ergebnis.warnings.join(' ')).toContain('spammer99');
  });

  // --- Randfälle ---------------------------------------------------------

  it('tut nichts, wenn es nichts zu tun gibt', async () => {
    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis).toMatchObject({ gefunden: 0, freigelassen: 0, geloescht: 0 });
    expect(ergebnis.fehlgeschlagen).toEqual([]);
    // Kein Audit-Eintrag über eine Aktion, die nichts getan hat.
    expect(await prisma.auditLog.count({ where: { action: 'JAIL_PURGED' } })).toBe(0);
  });

  it('fasst einen Jail eines Mitglieds an, das den Server verlassen hat', async () => {
    // `PENDING_REJOIN` zählt zu «aktiv»: die Strafe läuft weiter und würde
    // beim Wiedereintritt erneut greifen. Bliebe der Eintrag stehen, käme die
    // Person nach dem Aufräumen erneut ins Jail.
    const eintrag = await prisma.jailEntry.create({
      data: {
        targetDiscordId: '100000000000000099',
        targetUsername: 'weggegangen',
        moderatorDiscordId: MODERATOR.discordId,
        moderatorUsername: MODERATOR.username,
        reason: 'Spam',
        type: 'TEMPORARY',
        durationSeconds: 3600,
        endsAt: new Date(Date.now() + 3600_000),
        roleSnapshot: [MEMBER_ROLE],
        status: 'COMPLETED',
        lifecycle: 'PENDING_REJOIN',
        leftGuildAt: new Date(),
        activeKey: '100000000000000099',
      },
    });

    expect(await jail.countActiveJails()).toBe(1);

    const ergebnis = await jail.releaseAndPurgeActiveJails({ actor: MODERATOR, gateway });

    expect(ergebnis.freigelassen).toBe(1);
    expect(await prisma.jailEntry.findUnique({ where: { id: eintrag.id } })).toBeNull();
  });
});
