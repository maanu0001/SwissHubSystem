import { beforeAll, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_workspace_zugang');

/**
 * «Darf den Workspace nicht mehr öffnen» - eine Auskunft, keine Vermutung.
 *
 * ## Der Fehler
 *
 * Unter den Beteiligten eines Projekts stand dieser Satz auch bei Leuten, die
 * den Workspace sehr wohl öffnen durften. Er stand nicht da, weil jemand
 * nachgesehen hätte: die Komponente bekam die Liste der **wählbaren**
 * Personen und schrieb den Hinweis unter jeden Namen, der darin nicht
 * vorkam. Diese Liste ist bei 200 gedeckelt und nach Anzeigename sortiert -
 * wer dahinter lag, fehlte darin, ohne irgendein Recht verloren zu haben.
 *
 * `traegerPruefung` fragt nach genau den Kennungen, um die es geht, und
 * rechnet mit derselben Engine wie der Riegel vor der Seite.
 */
const { prisma } = await import('@swisshub/database');
const { traegerPruefung, workspace } = await import('@swisshub/modules');
const { ADMIN_FULL, invalidateRoleConfiguration } = await import('@swisshub/permissions');

const ROLLE_MITGLIED = '950000000000000001';
const ROLLE_ADMIN = '950000000000000002';

const MITGLIED = '960000000000000001';
const ADMIN = '960000000000000002';
const OHNE = '960000000000000003';
const SPAETER_IM_ALPHABET = '960000000000000004';
const FORT = '960000000000000005';
const UNBEKANNT = '960000000000000099';

describeWithDatabase('Workspace: der Zugang der Beteiligten', () => {
  beforeAll(async () => {
    await pushSchema();
    await prisma.rolePermission.deleteMany({});
    await prisma.managedRole.deleteMany({});
    await prisma.discordMemberCache.deleteMany({});

    await prisma.managedRole.create({
      data: {
        discordRoleId: ROLLE_MITGLIED,
        label: 'Mitglied',
        permissions: {
          create: [{ permission: workspace.WORKSPACE_PERMISSIONS.view, effect: 'ALLOW' }],
        },
      },
    });
    /*
     * Der Administrator bekommt **nur** `admin.full` - genau so, wie es im
     * Betrieb aussieht. `workspace.view` hat er nie einzeln zugewiesen
     * bekommen, weil er sie nie brauchte.
     */
    await prisma.managedRole.create({
      data: {
        discordRoleId: ROLLE_ADMIN,
        label: 'Administration',
        permissions: { create: [{ permission: ADMIN_FULL, effect: 'ALLOW' }] },
      },
    });

    for (const [discordId, displayName, roleIds, leftAt] of [
      [MITGLIED, 'Anna', [ROLLE_MITGLIED], null],
      [ADMIN, 'Beat', [ROLLE_ADMIN], null],
      [OHNE, 'Carla', [], null],
      // Hinten im Alphabet: genau der Fall, den der Deckel abschnitt.
      [SPAETER_IM_ALPHABET, 'Zoe', [ROLLE_MITGLIED], null],
      [FORT, 'Yves', [ROLLE_MITGLIED], new Date('2026-01-01T00:00:00Z')],
    ] as const) {
      await prisma.discordMemberCache.create({
        data: {
          discordId,
          username: displayName.toLowerCase(),
          displayName,
          roleIds: [...roleIds],
          searchText: displayName.toLowerCase(),
          leftAt,
        },
      });
    }
    invalidateRoleConfiguration();
  });

  it('bestätigt den Zugang über workspace.view', async () => {
    const stand = await traegerPruefung([MITGLIED], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(MITGLIED)).toBe(true);
  });

  it('bestätigt den Administrator, der nur admin.full hat', async () => {
    /*
     * Der Fall, auf den es ankommt. `admin.full` schliesst alles ein - wer
     * das nicht mitrechnet, erklärt den Administrator für ausgesperrt.
     */
    const stand = await traegerPruefung([ADMIN], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(ADMIN)).toBe(true);
  });

  it('sagt nein, wenn es wirklich nein ist', async () => {
    const stand = await traegerPruefung([OHNE], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(OHNE)).toBe(false);
  });

  it('antwortet unabhängig von der alphabetischen Reihenfolge', async () => {
    /*
     * Vorher entschied die Sortierung der Auswahlliste mit: «Zoe» lag hinter
     * dem Deckel und galt damit als ohne Zugang. Gefragt wird jetzt nach der
     * Kennung, und eine Kennung hat keine Position in einer Liste.
     */
    const stand = await traegerPruefung([SPAETER_IM_ALPHABET], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(SPAETER_IM_ALPHABET)).toBe(true);
  });

  it('beantwortet die Frage auch für jemanden, der den Server verlassen hat', async () => {
    /*
     * «Ist fort» und «darf nicht» sind zwei Auskünfte. Die Rollen von
     * gestern stehen noch im Spiegel, und die Frage hier ist die nach den
     * Rechten - ob die Person noch da ist, sagt `ehemalig`.
     */
    const stand = await traegerPruefung([FORT], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(FORT)).toBe(true);
  });

  it('sagt nein zu einer Kennung, zu der es nichts gibt', async () => {
    const stand = await traegerPruefung([UNBEKANNT], workspace.WORKSPACE_PERMISSIONS.view);
    expect(stand.get(UNBEKANNT)).toBe(false);
  });

  it('beantwortet alle Kennungen in einem Aufruf', async () => {
    const stand = await traegerPruefung(
      [MITGLIED, ADMIN, OHNE, SPAETER_IM_ALPHABET, FORT, UNBEKANNT],
      workspace.WORKSPACE_PERMISSIONS.view,
    );
    expect([...stand.entries()].sort()).toEqual(
      [
        [MITGLIED, true],
        [ADMIN, true],
        [OHNE, false],
        [SPAETER_IM_ALPHABET, true],
        [FORT, true],
        [UNBEKANNT, false],
      ].sort(),
    );
  });

  it('nimmt mehrere Berechtigungen als «eine davon genügt»', async () => {
    const stand = await traegerPruefung(
      [ADMIN, OHNE],
      [workspace.WORKSPACE_PERMISSIONS.view, 'settings.edit'],
    );
    expect(stand.get(ADMIN)).toBe(true);
    expect(stand.get(OHNE)).toBe(false);
  });

  it('kommt mit einer leeren Liste zurecht, ohne zu fragen', async () => {
    expect([...(await traegerPruefung([], workspace.WORKSPACE_PERMISSIONS.view)).keys()]).toEqual([]);
  });
});
