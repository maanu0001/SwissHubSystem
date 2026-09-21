import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_level_zuruecksetzen');

/**
 * «Alle XP zurücksetzen».
 *
 * Eine Schaltfläche, die in einem Zug jeden XP-Stand auf dem Server auf null
 * setzt. Vier Fragen entscheiden, ob sie brauchbar oder gefährlich ist, und
 * keine davon lässt sich gegen eine gefälschte Datenbank beantworten:
 *
 * 1. Bleibt die Buchhaltung stimmig? Jede Rücksetzung muss im XP-Journal
 *    stehen - mit dem Stand davor. Ein `updateMany` ohne Journal wäre die
 *    einzige Stelle im Level-System, an der XP spurlos verschwände, und genau
 *    dort fehlte dann die Antwort auf «wo sind meine XP hin?».
 * 2. Stimmt das Level im Journal? Die Kurve beginnt bei Level 1, nicht bei
 *    null - `levelAfter: 0` wäre eine Zahl, die es im ganzen System nicht
 *    gibt.
 * 3. Verschwindet nur der Punktestand? Nachrichten, Voice-Minuten, die eigene
 *    Levelkarte und die Spiel-Statistiken sind etwas anderes als XP.
 * 4. Folgt Discord? Wer bei null steht, darf keine «Level 50»-Rolle mehr
 *    tragen.
 *
 * Dazu die Wiederholung: derselbe Knopf, zweimal abgeschickt, darf nicht
 * zweimal buchen.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { createMockGateway } = await import('@swisshub/discord');

/** Mitglieder, die das Mock-Gateway kennt. */
const MANUEL = '100000000000000001';
const NINA = '100000000000000002';
const LARS = '100000000000000003';

const MILESTONE_ROLE = '900000000000000004';

const ACTOR = { discordId: MANUEL, username: 'manuel' };

let gateway: ReturnType<typeof createMockGateway>;

/** Ein Profil mit einem Punktestand, ohne den Umweg über die XP-Engine. */
async function profilMit(
  discordId: string,
  xp: number,
  extra: { messages?: number; voiceMinutes?: number; customCardPath?: string } = {},
): Promise<string> {
  const profil = await prisma.levelProfile.create({
    data: {
      discordId,
      username: `user-${discordId}`,
      xp,
      messages: extra.messages ?? 0,
      voiceMinutes: extra.voiceMinutes ?? 0,
      customCardPath: extra.customCardPath ?? null,
    },
  });
  return profil.id;
}

function schluessel(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

describeWithDatabase('Level: alle XP zurücksetzen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "XpTransaction","LevelGameStats","LevelGameMatch","LevelMilestoneRole","LevelProfile","XpRaffleRefund","XpRaffleDraw","XpRaffleEntry","XpRaffle","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
    gateway = createMockGateway();
  });

  // --- Was zurückgesetzt wird ----------------------------------------------

  it('setzt jeden Punktestand auf null', async () => {
    await profilMit(MANUEL, 12_000);
    await profilMit(NINA, 340);
    await profilMit(LARS, 1);

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis.gefunden).toBe(3);
    expect(ergebnis.zurueckgesetzt).toBe(3);
    expect(ergebnis.entzogeneXp).toBe(12_341);

    const staende = await prisma.levelProfile.findMany({ select: { xp: true } });
    expect(staende.map((profil) => profil.xp)).toEqual([0, 0, 0]);
  });

  it('schreibt für jede Rücksetzung eine Buchung ins Journal', async () => {
    await profilMit(NINA, 340);

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    const buchungen = await prisma.xpTransaction.findMany({ where: { discordId: NINA } });
    expect(buchungen).toHaveLength(1);
    const buchung = buchungen[0]!;
    expect(buchung.source).toBe('ADMIN');
    expect(buchung.xpBefore).toBe(340);
    expect(buchung.xpAfter).toBe(0);
    expect(buchung.delta).toBe(-340);
    expect(buchung.requestedDelta).toBe(-340);
    expect(buchung.actorDiscordId).toBe(ACTOR.discordId);
    expect(buchung.reason).toBe('Alle XP zurückgesetzt');
  });

  it('trägt im Journal das Level ein, das die Kurve kennt', async () => {
    // Die Kurve beginnt bei 1. Eine 0 im Journal wäre ein Level, das es im
    // ganzen System nicht gibt - und die Levelkarte zeigte etwas anderes als
    // der Verlauf.
    await profilMit(MANUEL, 12_000);

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    const buchung = await prisma.xpTransaction.findFirstOrThrow({ where: { discordId: MANUEL } });
    expect(buchung.levelBefore).toBe(level.levelFromXp(12_000));
    expect(buchung.levelAfter).toBe(1);
    expect(buchung.levelAfter).toBe(level.levelFromXp(0));
  });

  it('fasst ein Profil ohne XP nicht an', async () => {
    // Sonst stünde im Verlauf eine Buchung über nichts, und die gemeldete
    // Zahl wäre grösser als das, was tatsächlich passiert ist.
    await profilMit(NINA, 0);
    await profilMit(LARS, 500);

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis.gefunden).toBe(1);
    expect(ergebnis.zurueckgesetzt).toBe(1);
    expect(await prisma.xpTransaction.count({ where: { discordId: NINA } })).toBe(0);
  });

  it('meldet nichts zu tun, wenn niemand XP hat', async () => {
    await profilMit(NINA, 0);

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis).toMatchObject({ gefunden: 0, zurueckgesetzt: 0, entzogeneXp: 0 });
    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  // --- Was unberührt bleibt -------------------------------------------------

  it('lässt Nachrichten, Voice-Minuten und die eigene Levelkarte stehen', async () => {
    // Zurückgesetzt wird der Punktestand, nicht die Geschichte. Wer seine
    // Levelkarte hochgeladen hat, soll sie nicht dabei verlieren.
    await profilMit(MANUEL, 5000, { messages: 1200, voiceMinutes: 4300, customCardPath: 'karte.png' });

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    const profil = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: MANUEL } });
    expect(profil.xp).toBe(0);
    expect(profil.messages).toBe(1200);
    expect(profil.voiceMinutes).toBe(4300);
    expect(profil.customCardPath).toBe('karte.png');
  });

  it('lässt ältere Buchungen im Journal stehen', async () => {
    // Das Journal ist ein fortlaufender Verlauf. Würde es mitgelöscht, wäre
    // die Rücksetzung selbst die einzige Spur - und die frühere Geschichte
    // weg.
    await level.applyXp({ discordId: LARS, delta: 800, source: 'MESSAGE' });

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    const buchungen = await prisma.xpTransaction.findMany({
      where: { discordId: LARS },
      orderBy: { createdAt: 'asc' },
    });
    expect(buchungen).toHaveLength(2);
    expect(buchungen[0]!.source).toBe('MESSAGE');
    expect(buchungen[1]!.delta).toBe(-800);
  });

  // --- Discord folgt --------------------------------------------------------

  it('entzieht die Meilenstein-Rollen', async () => {
    // Eine «Level 5»-Rolle bei null XP wäre ein Widerspruch zwischen Discord
    // und der Datenbank - und niemand käme auf die Idee, sie von Hand zu
    // suchen.
    await prisma.levelMilestoneRole.create({ data: { level: 5, roleId: MILESTONE_ROLE, enabled: true } });
    await profilMit(NINA, 50_000);
    await gateway.roles.add(NINA, MILESTONE_ROLE, 'Test');
    expect((await gateway.members.get(NINA))?.roleIds).toContain(MILESTONE_ROLE);

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis.rollenEntzogen).toBeGreaterThan(0);
    expect((await gateway.members.get(NINA))?.roleIds).not.toContain(MILESTONE_ROLE);
  });

  it('fragt Discord gar nicht, wenn es keine Meilenstein-Rollen gibt', async () => {
    let anfragen = 0;
    const get = gateway.members.get.bind(gateway.members);
    gateway.members.get = async (discordId: string) => {
      anfragen += 1;
      return get(discordId);
    };
    await profilMit(NINA, 500);

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(anfragen).toBe(0);
  });

  it('setzt trotzdem zurück, wenn Discord die Rolle nicht hergibt', async () => {
    // Eine Rolle über dem Bot in der Hierarchie darf nicht dazu führen, dass
    // der ganze Vorgang scheitert - aber sie muss gemeldet werden.
    await prisma.levelMilestoneRole.create({ data: { level: 5, roleId: MILESTONE_ROLE, enabled: true } });
    await profilMit(NINA, 50_000);
    await gateway.roles.add(NINA, MILESTONE_ROLE, 'Test');
    gateway.roles.remove = async () => {
      throw new Error('Missing Permissions');
    };

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis.zurueckgesetzt).toBe(1);
    expect(await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: NINA } })).toMatchObject({
      xp: 0,
    });
    expect(ergebnis.warnings.join(' ')).toContain('Meilenstein-Rollen');
  });

  // --- Wiederholung ---------------------------------------------------------

  it('bucht bei derselben Bestätigung kein zweites Mal', async () => {
    // Ein Doppelklick oder ein wiederholter Versuch nach einem Timeout darf
    // den Verlauf nicht mit Buchungen über null füllen.
    const key = schluessel();
    await profilMit(NINA, 340);

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: key });
    await prisma.levelProfile.update({ where: { discordId: NINA }, data: { xp: 340 } });
    const zweiter = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: key });

    expect(zweiter.zurueckgesetzt).toBe(1);
    expect(await prisma.xpTransaction.count({ where: { discordId: NINA } })).toBe(1);
  });

  it('bucht bei einer neuen Bestätigung wieder', async () => {
    await profilMit(NINA, 340);
    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });
    await prisma.levelProfile.update({ where: { discordId: NINA }, data: { xp: 200 } });

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(await prisma.xpTransaction.count({ where: { discordId: NINA } })).toBe(2);
  });

  // --- Mehr als ein Stapel --------------------------------------------------

  it('kommt mit mehr Profilen zurecht, als ein Stapel fasst', async () => {
    // Geschrieben wird in Stapeln zu hundert. Bei genau hundertfünfzig muss
    // der zweite Stapel dieselbe Arbeit tun wie der erste.
    await prisma.levelProfile.createMany({
      data: Array.from({ length: 150 }, (_unused, index) => ({
        discordId: `2000000000000${String(index).padStart(5, '0')}`,
        xp: index + 1,
      })),
    });

    const ergebnis = await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    expect(ergebnis.gefunden).toBe(150);
    expect(ergebnis.zurueckgesetzt).toBe(150);
    expect(ergebnis.entzogeneXp).toBe((150 * 151) / 2);
    expect(await prisma.levelProfile.count({ where: { xp: { gt: 0 } } })).toBe(0);
    expect(await prisma.xpTransaction.count()).toBe(150);
  });

  // --- Die Zahl, über die entschieden wird ----------------------------------

  it('zählt nur, wer tatsächlich XP trägt', async () => {
    await profilMit(MANUEL, 10);
    await profilMit(NINA, 0);

    expect(await level.countLevelProfilesWithXp()).toBe(1);
  });

  // --- Protokoll ------------------------------------------------------------

  it('hält den Vorgang im Audit Log fest', async () => {
    await profilMit(NINA, 340);

    await level.resetAllLevels({ actor: ACTOR, gateway, idempotencyKey: schluessel() });

    const eintrag = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LEVEL_RESET' } });
    expect(eintrag.actorDiscordId).toBe(ACTOR.discordId);
    expect(eintrag.success).toBe(true);
    expect(eintrag.metadata).toMatchObject({ zurueckgesetzt: 1, entzogeneXp: 340 });
  });

  // --- Gebundene Verlosungseinsätze ----------------------------------------

  it('meldet XP, die in einer laufenden Verlosung gebunden sind', async () => {
    // Der Einsatz ist bereits abgebucht. Wird der Stand jetzt genullt und die
    // Verlosung später abgebrochen, entstünde bei der Rückzahlung XP aus dem
    // Nichts - darauf muss der Dialog hinweisen.
    const verlosung = await prisma.xpRaffle.create({
      data: {
        title: 'Laufende Verlosung',
        prizeDescription: 'Ein Preis',
        entryModel: 'FIXED',
        fixedEntryXp: 500,
        status: 'ENTRY_OPEN',
        createdByDiscordId: ACTOR.discordId,
      },
    });
    await prisma.xpRaffleEntry.create({
      data: {
        raffleId: verlosung.id,
        discordId: NINA,
        xpBeforeEntry: 1000,
        entryXp: 500,
        weight: 1,
        status: 'ACTIVE',
      },
    });

    expect(await level.raffle.gebundeneVerlosungsEinsaetze()).toEqual({ teilnahmen: 1, xp: 500 });
  });

  it('meldet nichts, wenn die Verlosung abgeschlossen ist', async () => {
    // Dort ist nichts mehr gebunden - eine Warnung wäre falsch und stünde
    // nach jeder Ziehung einen Tag lang im Dialog.
    const verlosung = await prisma.xpRaffle.create({
      data: {
        title: 'Abgeschlossene Verlosung',
        prizeDescription: 'Ein Preis',
        entryModel: 'FIXED',
        fixedEntryXp: 500,
        status: 'COMPLETED',
        completedAt: new Date(),
        createdByDiscordId: ACTOR.discordId,
      },
    });
    await prisma.xpRaffleEntry.create({
      data: {
        raffleId: verlosung.id,
        discordId: NINA,
        xpBeforeEntry: 1000,
        entryXp: 500,
        weight: 1,
        status: 'ACTIVE',
      },
    });

    expect(await level.raffle.gebundeneVerlosungsEinsaetze()).toEqual({ teilnahmen: 0, xp: 0 });
  });
});
