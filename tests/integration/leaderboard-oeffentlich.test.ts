import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_leaderboard_public');

/**
 * Die öffentliche Rangliste.
 *
 * Zwei Zusagen, und beide sind der Grund, warum es diese Datei gibt:
 *
 * 1. **Keine zweite Rechnung.** Die Reihenfolge entsteht in `getLeaderboard`,
 *    derselben Abfrage wie im Dashboard. Zwei Ranglisten nebeneinander wären
 *    zwei Gelegenheiten, auseinanderzulaufen - und niemand merkte es, weil
 *    beide für sich plausibel aussähen.
 *
 * 2. **Nur, was öffentlich sein darf.** Der Server entscheidet, was den
 *    Server verlässt. Bekäme die Seite den vollständigen Datensatz und zeigte
 *    davon fünf Felder, stünde der Rest trotzdem in der Antwort.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

/** Ein Profil mit gegebenem XP-Stand. */
async function profil(discordId: string, xp: number, name: string): Promise<void> {
  await prisma.levelProfile.create({
    data: { discordId, xp, username: name.toLowerCase(), displayName: name },
  });
}

describeWithDatabase('Öffentliche Rangliste', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "LevelProfile","ModuleState" RESTART IDENTITY CASCADE');
  });

  // --- Dieselbe Reihenfolge wie im Dashboard --------------------------------

  it('rankt genau wie die interne Rangliste', async () => {
    await profil('100000000000000001', 5000, 'Anna');
    await profil('100000000000000002', 12000, 'Beat');
    await profil('100000000000000003', 800, 'Chris');
    await profil('100000000000000004', 12000, 'Dania');

    const intern = await level.getLeaderboard({ limit: 50, offset: 0 });
    const oeffentlich = await level.getPublicLeaderboard({ page: 1, pageSize: 50 });

    expect(oeffentlich.entries.map((e) => e.discordId)).toEqual(intern.entries.map((e) => e.discordId));
    expect(oeffentlich.entries.map((e) => e.rank)).toEqual(intern.entries.map((e) => e.rank));
    expect(oeffentlich.total).toBe(intern.total);
  });

  it('übernimmt Level und XP unverändert aus der Engine', async () => {
    await profil('100000000000000001', 7500, 'Anna');

    const intern = await level.getLeaderboard({ limit: 1, offset: 0 });
    const oeffentlich = await level.getPublicLeaderboard({ page: 1, pageSize: 1 });

    expect(oeffentlich.entries[0]?.xp).toBe(intern.entries[0]?.xp);
    expect(oeffentlich.entries[0]?.level).toBe(intern.entries[0]?.level);
  });

  // --- Die Projektion --------------------------------------------------------

  it('gibt ausschliesslich die erlaubten Felder aus', async () => {
    await profil('100000000000000001', 5000, 'Anna');

    const [eintrag] = (await level.getPublicLeaderboard()).entries;

    expect(Object.keys(eintrag!).sort()).toEqual([
      'avatarHash',
      'discordId',
      'displayName',
      'level',
      'progress',
      'rank',
      'xp',
    ]);
  });

  it('gibt keine Aktivitätszahlen preis', async () => {
    /*
     * Nachrichten- und Sprachzahlen stehen im internen Leaderboard und sind
     * dort am Platz. Öffentlich wären sie ein Aktivitätsprofil je Person -
     * für eine Rangliste braucht das niemand.
     */
    await prisma.levelProfile.create({
      data: {
        discordId: '100000000000000001',
        xp: 5000,
        username: 'anna',
        displayName: 'Anna',
        messages: 4321,
        voiceMinutes: 999,
      },
    });

    const antwort = JSON.stringify(await level.getPublicLeaderboard());
    expect(antwort).not.toContain('4321');
    expect(antwort).not.toContain('999');
    expect(antwort).not.toContain('messages');
    expect(antwort).not.toContain('voiceMinutes');
  });

  it('nennt niemanden «null», wenn ein Name fehlt', async () => {
    await prisma.levelProfile.create({ data: { discordId: '100000000000000001', xp: 10 } });

    const [eintrag] = (await level.getPublicLeaderboard()).entries;
    expect(eintrag?.displayName).toBe('Unbekannt');
  });

  // --- Blättern --------------------------------------------------------------

  it('blättert serverseitig und zählt den ganzen Bestand', async () => {
    for (let i = 0; i < 120; i += 1) {
      await profil(`10000000000000${String(1000 + i)}`, 10_000 - i, `Nutzer ${i}`);
    }

    const erste = await level.getPublicLeaderboard({ page: 1, pageSize: 50 });
    const dritte = await level.getPublicLeaderboard({ page: 3, pageSize: 50 });

    expect(erste.entries).toHaveLength(50);
    expect(erste.total).toBe(120);
    expect(erste.totalPages).toBe(3);
    // Die Ränge laufen über die Seiten hinweg weiter.
    expect(erste.entries[0]?.rank).toBe(1);
    expect(dritte.entries[0]?.rank).toBe(101);
    expect(dritte.entries).toHaveLength(20);
  });

  it('deckelt die Seitengrösse', async () => {
    // Ein `pageSize` aus der Adresszeile darf keine vollständige Ausgabe
    // erzwingen.
    await profil('100000000000000001', 10, 'Anna');
    expect((await level.getPublicLeaderboard({ pageSize: 100_000 })).pageSize).toBe(100);
  });

  it('kommt mit einer leeren Rangliste zurecht', async () => {
    const board = await level.getPublicLeaderboard();
    expect(board.entries).toEqual([]);
    expect(board.total).toBe(0);
    expect(board.totalPages).toBe(1);
  });

  // --- Fortschritt -----------------------------------------------------------

  it('weist den Fortschritt ins nächste Level aus', async () => {
    await profil('100000000000000001', 5000, 'Anna');

    const [eintrag] = (await level.getPublicLeaderboard()).entries;
    expect(eintrag?.progress).not.toBeNull();
    expect(eintrag!.progress!).toBeGreaterThanOrEqual(0);
    expect(eintrag!.progress!).toBeLessThanOrEqual(1);
  });
});
