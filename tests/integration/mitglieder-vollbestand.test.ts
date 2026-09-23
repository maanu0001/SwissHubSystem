import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type * as DiscordModulTyp from '@swisshub/discord';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

type DiscordModul = typeof DiscordModulTyp;

useTestSchema('test_mitglieder_vollbestand');

/**
 * Die Mitgliederliste kennt alle Mitglieder.
 *
 * ## Was vorher geschah
 *
 * Mitglieder wurden nicht gespiegelt, sondern bei jedem Aufruf bei Discord
 * geholt - und zwar **eine** Seite, intern auf 100 gedeckelt. Gesucht,
 * gefiltert und geblättert wurde danach in JavaScript, also in diesen 100.
 *
 * Damit kannte die Anwendung 100 von über 6000 Mitgliedern. «99 Mitglieder,
 * Seite 1 von 5» waren 100 geholte minus einen Bot, verteilt auf Seiten zu
 * 24. Wer weiter hinten stand, war über die Suche nicht zu finden.
 *
 * Diese Datei prüft den Bestand, den die Anforderung nennt: 6049 Mitglieder,
 * 100 je Seite - und einen Treffer weit hinten.
 */
const { prisma } = await import('@swisshub/database');
const { listMembersPage, syncMembers, merkeMitglied, merkeAustritt, memberSyncStand } =
  await import('@swisshub/modules');

const GUILD = '000000000000000001';

vi.mock('@swisshub/discord', async () => {
  const echt = await vi.importActual<DiscordModul>('@swisshub/discord');
  return { ...echt, resolveGuildId: async () => GUILD, tryResolveGuildId: async () => GUILD };
});

/** Anzahl Mitglieder aus der Anforderung. */
const BESTAND = 6049;
const ROLLE_A = '700000000000000001';
const ROLLE_B = '700000000000000002';
/** Der Testnutzer steht absichtlich ganz hinten im Alphabet. */
const HINTEN = '200000000000009999';

type Mitglied = Awaited<ReturnType<typeof discordAttrappe>>['alle'][number];

/**
 * Ein Discord-Zugang, der einen vollständigen Server nachstellt.
 *
 * Er blättert wie Discord: höchstens `limit` je Anfrage, weiter über den
 * `after`-Cursor. Wer nur die erste Seite holt, bekommt hier - genau wie
 * produktiv - einen Bruchteil.
 */
function discordAttrappe(anzahl = BESTAND) {
  const alle = Array.from({ length: anzahl }, (__, i) => {
    const nummer = String(100_000 + i);
    return {
      discordId: `2000000000000${nummer}`,
      username: `mitglied${nummer}`,
      globalName: null as string | null,
      nickname: null as string | null,
      displayName: `Mitglied ${nummer}`,
      avatarHash: null as string | null,
      isBot: i % 1000 === 0,
      roleIds: i % 2 === 0 ? [ROLLE_A] : [ROLLE_B],
      joinedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      accountCreatedAt: new Date(Date.UTC(2020, 0, 1)),
      boosting: false,
      timedOutUntil: null as Date | null,
    };
  });
  // Einer ganz hinten - über die Suche muss er trotzdem auffindbar sein.
  alle.push({
    discordId: HINTEN,
    username: 'zuhinterst',
    globalName: 'Zuhinterst',
    nickname: 'Der Letzte',
    displayName: 'Der Letzte',
    avatarHash: null,
    isBot: false,
    roleIds: [ROLLE_B],
    joinedAt: new Date(Date.UTC(2026, 5, 1)),
    accountCreatedAt: new Date(Date.UTC(2020, 0, 1)),
    boosting: false,
    timedOutUntil: null,
  });

  let anfragen = 0;
  const gateway = {
    members: {
      async list(optionen: { limit?: number; after?: string } = {}) {
        anfragen += 1;
        const limit = Math.min(optionen.limit ?? 50, 1000);
        const ab = optionen.after;
        const sortiert = [...alle].sort((a, b) => a.discordId.localeCompare(b.discordId));
        const start = ab ? sortiert.findIndex((m) => m.discordId === ab) + 1 : 0;
        return sortiert.slice(start, start + limit);
      },
      async get(discordId: string) {
        return alle.find((m) => m.discordId === discordId) ?? null;
      },
      async search() {
        return [];
      },
    },
    roles: {
      async list() {
        return [
          { id: ROLLE_A, name: 'Gerade', color: 0, position: 2, managed: false, permissions: '0' },
          { id: ROLLE_B, name: 'Ungerade', color: 0, position: 1, managed: false, permissions: '0' },
        ];
      },
    },
  };
  return { alle, gateway: gateway as never, anfragen: () => anfragen };
}

const seite = async (nummer: number, extras: Record<string, unknown> = {}) =>
  listMembersPage('', { ohneBots: false, ...extras }, { page: nummer, pageSize: 100 });

describeWithDatabase('Mitglieder: der vollständige Bestand', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordMemberCache","JailEntry","PremiumSubscription","GuildConfig" RESTART IDENTITY CASCADE',
    );
  });

  // --- Der Sync -------------------------------------------------------------

  it('holt alle Mitglieder, nicht nur die erste Seite', async () => {
    const { gateway, anfragen } = discordAttrappe();

    const ergebnis = await syncMembers({ gateway });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.gesehen).toBe(BESTAND + 1);
    // Über 6000 Mitglieder brauchen mehr als eine Anfrage - genau daran ist
    // es vorher gescheitert.
    expect(anfragen()).toBeGreaterThan(1);
    expect(await prisma.discordMemberCache.count({ where: { leftAt: null } })).toBe(BESTAND + 1);
  });

  it('holt nach, was in der Datenbank fehlt', async () => {
    // Der Fall aus der Anforderung: Discord 6049, lokal 500.
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });
    await prisma.discordMemberCache.deleteMany({
      where: { discordId: { in: alle.slice(500).map((m) => m.discordId) } },
    });
    expect(await prisma.discordMemberCache.count()).toBe(500);

    await syncMembers({ gateway });

    expect(await prisma.discordMemberCache.count({ where: { leftAt: null } })).toBe(BESTAND + 1);
  });

  it('erzeugt bei wiederholtem Lauf keine Duplikate', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });
    await syncMembers({ gateway });

    expect(await prisma.discordMemberCache.count()).toBe(BESTAND + 1);
  });

  it('markiert Ausgetretene, statt sie zu löschen', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });

    const gegangen = alle[5]!;
    alle.splice(5, 1);
    await syncMembers({ gateway });

    const zeile = await prisma.discordMemberCache.findUnique({ where: { discordId: gegangen.discordId } });
    expect(zeile, 'der Eintrag bleibt als Beleg stehen').not.toBeNull();
    expect(zeile?.leftAt).not.toBeNull();
    expect(await prisma.discordMemberCache.count({ where: { leftAt: null } })).toBe(BESTAND);
  });

  it('markiert bei einer leeren Antwort niemanden als ausgetreten', async () => {
    /*
     * Eine leere Antwort ist kein leerer Server - sie ist ein fehlendes
     * Intent oder ein Ausfall. Würde sie durchschlagen, wäre die
     * Mitgliederliste nach einem einzigen misslungenen Lauf leer.
     */
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const leer = {
      members: {
        async list() {
          return [];
        },
      },
    } as never;
    await syncMembers({ gateway: leer });

    expect(await prisma.discordMemberCache.count({ where: { leftAt: null } })).toBe(BESTAND + 1);
  });

  // --- Pagination -----------------------------------------------------------

  it('zählt den vollständigen Bestand, nicht die Länge einer Seite', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const erste = await seite(1);
    expect(erste.total).toBe(BESTAND + 1);
    expect(erste.pageSize).toBe(100);
  });

  it('gibt 100 je Seite aus - erste, mittlere und letzte', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const gesamt = BESTAND + 1;
    const letzteSeite = Math.ceil(gesamt / 100);

    expect((await seite(1)).members).toHaveLength(100);
    expect((await seite(30)).members).toHaveLength(100);
    expect((await seite(letzteSeite)).members).toHaveLength(gesamt - (letzteSeite - 1) * 100);
    expect(letzteSeite).toBe(61);
  });

  it('lässt kein Mitglied zwischen den Seiten verschwinden', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const gesehen = new Set<string>();
    const letzteSeite = Math.ceil((BESTAND + 1) / 100);
    for (let nummer = 1; nummer <= letzteSeite; nummer += 1) {
      for (const mitglied of (await seite(nummer)).members) {
        gesehen.add(mitglied.discordId);
      }
    }
    expect(gesehen.size).toBe(BESTAND + 1);
  });

  // --- Suche ----------------------------------------------------------------

  it('findet ein Mitglied, das weit hinten steht', async () => {
    /*
     * Der entscheidende Test. Vorher konnte die Suche nur die geholten 100
     * durchsehen; wer auf Seite 58 stand, war schlicht nicht auffindbar.
     */
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const treffer = await listMembersPage('zuhinterst', {}, { page: 1, pageSize: 100 });
    expect(treffer.total).toBe(1);
    expect(treffer.members[0]?.discordId).toBe(HINTEN);
  });

  it('sucht über Benutzername, Anzeigename, globalen Namen und Spitznamen', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    for (const begriff of ['zuhinterst', 'Der Letzte', 'Zuhinterst', 'letzte']) {
      const treffer = await listMembersPage(begriff, {}, { page: 1, pageSize: 100 });
      expect(
        treffer.members.map((m) => m.discordId),
        `Suche nach «${begriff}»`,
      ).toContain(HINTEN);
    }
  });

  it('findet ein Mitglied über seine Discord-ID', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    const treffer = await listMembersPage(HINTEN, {}, { page: 1, pageSize: 100 });
    expect(treffer.total).toBe(1);
    expect(treffer.members[0]?.discordId).toBe(HINTEN);
  });

  // --- Filter ---------------------------------------------------------------

  it('filtert über den ganzen Bestand, nicht über eine Seite', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });

    const erwartet = alle.filter((m) => m.roleIds.includes(ROLLE_A)).length;
    const gefiltert = await listMembersPage('', { roleId: ROLLE_A }, { page: 1, pageSize: 100 });

    expect(erwartet).toBeGreaterThan(100);
    expect(gefiltert.total).toBe(erwartet);
  });

  it('blendet Bots über den ganzen Bestand aus', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });

    const bots = alle.filter((m) => m.isBot).length;
    const ohne = await listMembersPage('', { ohneBots: true }, { page: 1, pageSize: 100 });

    expect(bots).toBeGreaterThan(0);
    expect(ohne.total).toBe(BESTAND + 1 - bots);
  });

  it('verbindet Suche und Filter', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });

    // «Der Letzte» trägt Rolle B - über Rolle A darf er nicht auftauchen.
    expect((await listMembersPage('zuhinterst', { roleId: ROLLE_B })).total).toBe(1);
    expect((await listMembersPage('zuhinterst', { roleId: ROLLE_A })).total).toBe(0);
  });

  // --- Fortschreibung -------------------------------------------------------

  it('nimmt einen neu beigetretenen sofort auf', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });
    const vorher = (await seite(1)).total;

    await merkeMitglied({
      discordId: '300000000000000001',
      username: 'neuling',
      globalName: null,
      nickname: null,
      displayName: 'Neuling',
      avatarHash: null,
      isBot: false,
      roleIds: [],
      joinedAt: new Date(),
      accountCreatedAt: new Date(),
      boosting: false,
      timedOutUntil: null,
    });

    expect((await seite(1)).total).toBe(vorher + 1);
    expect((await listMembersPage('neuling')).total).toBe(1);
  });

  it('nimmt einen Ausgetretenen aus der Liste', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });
    const vorher = (await seite(1)).total;

    await merkeAustritt(alle[0]!.discordId);

    expect((await seite(1)).total).toBe(vorher - 1);
  });

  it('holt einen Rückkehrer zurück in die Liste', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });
    const rueckkehrer = alle[0]!;
    await merkeAustritt(rueckkehrer.discordId);

    await merkeMitglied(rueckkehrer);

    const zeile = await prisma.discordMemberCache.findUnique({
      where: { discordId: rueckkehrer.discordId },
    });
    expect(zeile?.leftAt).toBeNull();
  });

  it('schreibt eine Rollenänderung fort', async () => {
    const { gateway, alle } = discordAttrappe();
    await syncMembers({ gateway });
    const mitglied = alle.find((m) => m.roleIds.includes(ROLLE_A))!;

    await merkeMitglied({ ...mitglied, roleIds: [ROLLE_B] } as Mitglied);

    const treffer = await listMembersPage(mitglied.discordId, { roleId: ROLLE_B });
    expect(treffer.total).toBe(1);
  });

  // --- Systemstatus ---------------------------------------------------------

  it('macht den Stand des Spiegels sichtbar', async () => {
    const { gateway } = discordAttrappe();
    await syncMembers({ gateway });
    await prisma.guildConfig.create({
      data: { guildId: GUILD, memberCount: BESTAND + 1 },
    });

    const stand = await memberSyncStand();
    expect(stand.gespiegelt).toBe(BESTAND + 1);
    expect(stand.discord).toBe(BESTAND + 1);
    expect(stand.letzterSync).not.toBeNull();
  });
});
