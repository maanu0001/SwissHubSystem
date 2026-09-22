import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_vorschau_personas');

/**
 * Die Vorschau gegen echte Rollen aus der Datenbank.
 *
 * Der Unit-Test daneben prüft die Regel an erfundenen Zuordnungen. Hier
 * stehen sie in der Datenbank, und geladen werden sie über denselben Weg wie
 * im Betrieb - `loadRoleConfiguration`. Damit beantwortet dieser Test zwei
 * Dinge, die sich mit erfundenen Daten nicht beantworten lassen:
 *
 * 1. **Die Persona-Regression.** Mitglied, Premium, Moderation und
 *    Verwaltung sehen ohne Vorschau genau das, was sie vorher sahen. Eine
 *    Änderung an der Rechteauflösung fiele hier auf.
 * 2. **Keine Rechteausweitung.** Eine Vorschau auf eine stärkere Persona
 *    gibt nichts dazu - auch dann nicht, wenn die Rolle in der Datenbank
 *    tatsächlich mehr darf.
 */
const { prisma } = await import('@swisshub/database');
await import('@swisshub/modules');
const { can } = await import('@swisshub/auth');
const { invalidateRoleConfiguration, loadRoleConfiguration, resolvePermissions } =
  await import('@swisshub/permissions');
const { listPermissions } = await import('@swisshub/permissions');
import type { AuthContext } from '@swisshub/auth';

const ROLLE = {
  mitglied: '900000000000000008',
  premium: '900000000000000009',
  moderator: '900000000000000003',
  admin: '900000000000000001',
} as const;

/** Die Rechte, die jede Persona in dieser Prüfung tragen soll. */
const ZUORDNUNG: Array<[string, string]> = [
  [ROLLE.mitglied, 'dashboard.view'],
  [ROLLE.premium, 'dashboard.view'],
  [ROLLE.premium, 'level.card.custom'],
  [ROLLE.moderator, 'dashboard.view'],
  [ROLLE.moderator, 'moderation.view'],
  [ROLLE.moderator, 'jail.view'],
  [ROLLE.moderator, 'members.view'],
  [ROLLE.admin, 'admin.full'],
];

async function basis(): Promise<void> {
  for (const [discordRoleId, label] of Object.entries(ROLLE).map(
    ([name, id]) => [id, name] as [string, string],
  )) {
    await prisma.managedRole.create({ data: { discordRoleId, label } });
  }
  for (const [discordRoleId, permission] of ZUORDNUNG) {
    await prisma.rolePermission.create({ data: { discordRoleId, permission } });
  }
  invalidateRoleConfiguration();
}

async function kontextFuer(roleIds: string[], vorschauRollen?: string[]): Promise<AuthContext> {
  const konfiguration = await loadRoleConfiguration(true);
  const echt = resolvePermissions({ discordId: '1', roleIds, isOwner: false }, konfiguration.mappings);
  const gemeinsam = {
    user: {
      id: 'u1',
      discordId: '1',
      username: 'test',
      globalName: null,
      displayName: 'Test',
      avatarHash: null,
      appRole: 'USER' as const,
      isOwner: false,
    },
    sessionId: 's1',
    identity: { discordId: '1', isMember: true, roleIds } as AuthContext['identity'],
    isMember: true,
    moderationLevel: 0,
    roleIds,
    permissionKeys: [],
  };

  if (!vorschauRollen) {
    return { ...gemeinsam, permissions: echt } as AuthContext;
  }

  return {
    ...gemeinsam,
    permissions: resolvePermissions(
      { discordId: '2', roleIds: vorschauRollen, isOwner: false },
      konfiguration.mappings,
    ),
    realPermissions: echt,
    preview: {
      kind: 'ROLE' as const,
      subjectId: vorschauRollen[0]!,
      label: 'Vorschau',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  } as AuthContext;
}

/** Alles, was dieser Kontext sehen darf - die Liste hinter der Seitenleiste. */
function sichtbar(context: AuthContext): string[] {
  return listPermissions()
    .map((recht) => recht.key)
    .filter((recht) => can(context, recht))
    .sort();
}

describeWithDatabase('Vorschau und Personas', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "RolePermission","ManagedRole" RESTART IDENTITY CASCADE');
    invalidateRoleConfiguration();
    await basis();
  });

  // --- Ohne Vorschau: nichts hat sich geändert ------------------------------

  it('Mitglied sieht ohne Vorschau genau sein Dashboard', async () => {
    const mitglied = await kontextFuer([ROLLE.mitglied]);
    expect(sichtbar(mitglied)).toEqual(['dashboard.view']);
  });

  it('Premium sieht ohne Vorschau sein Dashboard und seine Levelkarte', async () => {
    const premium = await kontextFuer([ROLLE.mitglied, ROLLE.premium]);
    expect(sichtbar(premium)).toEqual(['dashboard.view', 'level.card.custom']);
  });

  it('Moderation sieht ohne Vorschau ihre Bereiche', async () => {
    const mod = await kontextFuer([ROLLE.mitglied, ROLLE.moderator]);
    expect(sichtbar(mod)).toEqual(['dashboard.view', 'jail.view', 'members.view', 'moderation.view']);
  });

  it('Verwaltung sieht ohne Vorschau alles', async () => {
    const admin = await kontextFuer([ROLLE.admin]);
    expect(sichtbar(admin)).toEqual(
      listPermissions()
        .map((recht) => recht.key)
        .sort(),
    );
  });

  // --- Mit Vorschau: genau die Sicht der Persona ---------------------------

  it('Verwaltung in der Vorschau als Mitglied sieht das Mitglieder-Dashboard', async () => {
    const alsMitglied = await kontextFuer([ROLLE.admin], [ROLLE.mitglied]);
    expect(sichtbar(alsMitglied)).toEqual(['dashboard.view']);
  });

  it('Verwaltung in der Vorschau als Premium sieht die Premium-Sicht', async () => {
    const alsPremium = await kontextFuer([ROLLE.admin], [ROLLE.mitglied, ROLLE.premium]);
    expect(sichtbar(alsPremium)).toEqual(['dashboard.view', 'level.card.custom']);
  });

  it('Verwaltung in der Vorschau als Moderation sieht deren Bereiche', async () => {
    const alsMod = await kontextFuer([ROLLE.admin], [ROLLE.moderator]);
    expect(sichtbar(alsMod)).toEqual(['dashboard.view', 'jail.view', 'members.view', 'moderation.view']);
  });

  // --- Keine Rechteausweitung ----------------------------------------------

  it('gibt einer Moderation in der Vorschau als Verwaltung nichts dazu', async () => {
    const modAlsAdmin = await kontextFuer([ROLLE.moderator], [ROLLE.admin]);
    // Höchstens das Eigene - und hier nicht einmal `dashboard.view` mehr als
    // vorher: die Schnittmenge ist genau die eigene Menge.
    expect(sichtbar(modAlsAdmin)).toEqual(['dashboard.view', 'jail.view', 'members.view', 'moderation.view']);
    expect(can(modAlsAdmin, 'admin.full')).toBe(false);
  });

  it('gibt einem Mitglied in der Vorschau als Verwaltung nichts dazu', async () => {
    const mitgliedAlsAdmin = await kontextFuer([ROLLE.mitglied], [ROLLE.admin]);
    expect(sichtbar(mitgliedAlsAdmin)).toEqual(['dashboard.view']);
  });

  it('achtet auch in der Vorschau eine ausdrückliche Ausnahme', async () => {
    // `DENY` schlägt jede Erlaubnis - auch den Vollzugriff. Die Vorschau
    // rechnet mit derselben Engine und kommt deshalb zum selben Ergebnis.
    await prisma.rolePermission.create({
      data: { discordRoleId: ROLLE.admin, permission: 'jail.view', effect: 'DENY' },
    });
    invalidateRoleConfiguration();

    const admin = await kontextFuer([ROLLE.admin]);
    expect(can(admin, 'jail.view')).toBe(false);

    // Und die Vorschau als Moderation gibt es ihm auch nicht zurück.
    const alsMod = await kontextFuer([ROLLE.admin], [ROLLE.moderator]);
    expect(can(alsMod, 'jail.view')).toBe(false);
    expect(can(alsMod, 'moderation.view')).toBe(true);
  });

  it('macht eine erfundene Rollen-ID wirkungslos', async () => {
    // Eine Rolle, die es nicht gibt, hat keine Rechte - die Vorschau zeigt
    // dann eine leere Oberfläche, nicht eine volle.
    const alsUnbekannt = await kontextFuer([ROLLE.admin], ['999999999999999999']);
    expect(sichtbar(alsUnbekannt)).toEqual([]);
  });
});
