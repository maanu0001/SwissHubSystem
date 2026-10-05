import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_personensuche');

/**
 * Die Quelle der Beteiligten-Suche.
 *
 * ## Der Fehler, den dieser Test festnagelt
 *
 * Das Suchfeld der Beteiligten zeigte auf dem Server keine Treffer. Die
 * Ursache lag nicht im Feld: `traegerDerBerechtigung` baut seine Grundmenge
 * aus `prisma.user` - also aus denen, die sich an der WebApp **angemeldet**
 * haben. Auf einem Server, dessen Mitglieder die WebApp kaum benutzen, sind
 * das wenige; gemessen waren es 14 von 35. Wer gesucht wurde, stand im
 * Mitgliederspiegel und damit nicht in der Liste, die durchsucht wurde.
 *
 * Genau diese Lage stellt dieser Test her: Leute, die es **nur** im Spiegel
 * gibt. Die alte Quelle findet sie nicht, die neue schon - und beide prueft
 * dieselbe Berechtigung.
 */
const { prisma } = await import('@swisshub/database');
const { traegerDerBerechtigung, traegerSuche, workspace } = await import('@swisshub/modules');

/** Die Rolle, die den Workspace oeffnen darf. */
const TEAMROLLE = '900000000000000061';
/** Eine Rolle ohne jede Berechtigung. */
const GASTROLLE = '900000000000000062';

/** Wer sich angemeldet hat - und im Spiegel steht. */
const ANGEMELDET = '100000000000000061';

async function spiegelPerson(
  discordId: string,
  name: string,
  rollen: string[],
  extra: { isBot?: boolean; leftAt?: Date } = {},
): Promise<void> {
  await prisma.discordMemberCache.upsert({
    where: { discordId },
    update: {
      displayName: name,
      username: name.toLowerCase(),
      roleIds: rollen,
      searchText: name.toLowerCase(),
      isBot: extra.isBot ?? false,
      leftAt: extra.leftAt ?? null,
    },
    create: {
      discordId,
      username: name.toLowerCase(),
      globalName: name,
      displayName: name,
      roleIds: rollen,
      searchText: name.toLowerCase(),
      isBot: extra.isBot ?? false,
      leftAt: extra.leftAt ?? null,
    },
  });
}

describeWithDatabase('Workspace: Quelle der Beteiligten-Suche', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.discordMemberCache.deleteMany({});
    await prisma.discordIdentityCache.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.managedRole.deleteMany({});

    // Die Rolle muss verwaltet sein, bevor sie eine Berechtigung tragen kann -
    // `RolePermission` haengt am Fremdschluessel.
    await prisma.managedRole.createMany({
      data: [
        { discordRoleId: TEAMROLLE, label: 'Team' },
        { discordRoleId: GASTROLLE, label: 'Gast' },
      ],
    });
    await prisma.rolePermission.create({
      data: {
        discordRoleId: TEAMROLLE,
        permission: workspace.WORKSPACE_PERMISSIONS.view,
        effect: 'ALLOW',
      },
    });

    // Eine Person, die sich angemeldet hat - die alte Quelle kennt nur sie.
    await prisma.user.create({
      data: {
        discordId: ANGEMELDET,
        username: 'anna',
        identityCache: { create: { discordId: ANGEMELDET, isMember: true, roleIds: [TEAMROLLE] } },
      },
    });
    await spiegelPerson(ANGEMELDET, 'Anna', [TEAMROLLE]);

    // Und fuenf, die es nur im Spiegel gibt.
    for (let i = 0; i < 5; i += 1) {
      await spiegelPerson(`20000000000000${String(2000 + i)}`, `Manuel${i}`, [TEAMROLLE]);
    }
  });

  it('findet Mitglieder, die sich nie angemeldet haben', async () => {
    const alt = await traegerDerBerechtigung(workspace.WORKSPACE_PERMISSIONS.view);
    const neu = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'manuel');

    // Die alte Quelle kennt nur die Angemeldete - und keinen der Gesuchten.
    expect(alt).toEqual([ANGEMELDET]);
    // Die neue findet alle fuenf.
    expect(neu).toHaveLength(5);
    expect(neu.map((person) => person.displayName).sort()).toEqual([
      'Manuel0',
      'Manuel1',
      'Manuel2',
      'Manuel3',
      'Manuel4',
    ]);
  });

  it('prueft dieselbe Berechtigung wie vorher', async () => {
    await spiegelPerson('200000000000003001', 'Gast', [GASTROLLE]);

    const treffer = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'gast');
    // Wer den Workspace nicht oeffnen darf, ist kein Treffer - eine Zuweisung
    // an ihn waere eine, von der er nie erfaehrt.
    expect(treffer).toEqual([]);
  });

  it('nimmt Bots und Ausgetretene nicht auf', async () => {
    await spiegelPerson('200000000000003002', 'Botli', [TEAMROLLE], { isBot: true });
    await spiegelPerson('200000000000003003', 'Weggli', [TEAMROLLE], { leftAt: new Date() });

    expect(await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'botli')).toEqual([]);
    expect(await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'weggli')).toEqual([]);
  });

  it('liefert Avatar und Benutzernamen fuer die Trefferzeile mit', async () => {
    const [treffer] = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'manuel0');
    expect(treffer).toBeDefined();
    expect(treffer?.discordId).toBe('200000000000002000');
    expect(treffer?.displayName).toBe('Manuel0');
    expect(treffer?.username).toBe('manuel0');
    expect(treffer).toHaveProperty('avatarHash');
  });

  it('findet eine Person auch an ihrer Kennung', async () => {
    const treffer = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, '200000000000002003');
    expect(treffer.map((person) => person.displayName)).toEqual(['Manuel3']);
  });

  it('haelt die Obergrenze ein, ohne die Reihenfolge dem Zufall zu lassen', async () => {
    for (let i = 0; i < 12; i += 1) {
      await spiegelPerson(`20000000000000${String(4000 + i)}`, `Teamli${String(i).padStart(2, '0')}`, [
        TEAMROLLE,
      ]);
    }
    const treffer = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, 'teamli', { grenze: 5 });
    expect(treffer).toHaveLength(5);
    // Nach Anzeigename - zweimal dieselbe Suche gibt dieselben fuenf.
    expect(treffer.map((person) => person.displayName)).toEqual([
      'Teamli00',
      'Teamli01',
      'Teamli02',
      'Teamli03',
      'Teamli04',
    ]);
  });

  it('gibt ohne Suchbegriff alle Berechtigten des Spiegels', async () => {
    const alle = await traegerSuche(workspace.WORKSPACE_PERMISSIONS.view, '', { grenze: 200 });
    expect(alle).toHaveLength(6);
  });
});
