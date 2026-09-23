import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_leaderboard_command');

/**
 * `/leaderboard` auf Discord.
 *
 * Dieselbe Rangliste wie im Dashboard und wie auf der öffentlichen Seite -
 * drei Ansichten, eine Rechnung. Die Aufgabe des Commands ist die
 * Darstellung: Top 5, Erwähnungen statt gespeicherter Namen, und ein Weg zur
 * vollständigen Liste.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const profil = async (discordId: string, xp: number, name: string): Promise<void> => {
  await prisma.levelProfile.create({
    data: { discordId, xp, username: name.toLowerCase(), displayName: name },
  });
};

describeWithDatabase('Leaderboard-Command: die Rangliste', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "LevelProfile" RESTART IDENTITY CASCADE');
  });

  it('entspricht der Reihenfolge der öffentlichen Seite', async () => {
    await profil('100000000000000001', 5000, 'Anna');
    await profil('100000000000000002', 12000, 'Beat');
    await profil('100000000000000003', 800, 'Chris');

    const fuerDiscord = await level.getLeaderboard({ limit: 5 });
    const oeffentlich = await level.getPublicLeaderboard({ page: 1, pageSize: 5 });

    expect(fuerDiscord.entries.map((e) => e.discordId)).toEqual(oeffentlich.entries.map((e) => e.discordId));
  });

  it('zeigt fünf Plätze, wenn es fünf gibt', async () => {
    for (let i = 0; i < 12; i += 1) {
      await profil(`10000000000000${String(1000 + i)}`, 10_000 - i * 100, `Nutzer ${i}`);
    }

    const board = await level.getLeaderboard({ limit: 5 });
    expect(board.entries).toHaveLength(5);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('zeigt nur, was da ist, wenn es weniger als fünf sind', async () => {
    await profil('100000000000000001', 500, 'Anna');
    await profil('100000000000000002', 300, 'Beat');

    const embed = level.buildLeaderboardEmbed((await level.getLeaderboard({ limit: 5 })).entries, 0);
    expect(embed.description?.split('\n')).toHaveLength(2);
  });

  it('stellt jeden Platz als echte Erwähnung dar', async () => {
    /*
     * Nicht der gespeicherte Anzeigename. Der ist eine Momentaufnahme vom
     * letzten Mal, als jemand XP bekam - wer sich seither umbenannt hat,
     * stünde unter dem alten Namen da.
     */
    await profil('100000000000000001', 5000, 'Anna');
    await profil('100000000000000002', 4000, 'Beat');

    const embed = level.buildLeaderboardEmbed((await level.getLeaderboard({ limit: 5 })).entries, 0);

    expect(embed.description).toContain('<@100000000000000001>');
    expect(embed.description).toContain('<@100000000000000002>');
    // Und der gespeicherte Name steht nicht daneben.
    expect(embed.description).not.toContain('Anna');
  });

  it('nennt Level und XP', async () => {
    await profil('100000000000000001', 5000, 'Anna');

    const embed = level.buildLeaderboardEmbed((await level.getLeaderboard({ limit: 5 })).entries, 0);
    expect(embed.description).toMatch(/Level \d+/u);
    expect(embed.description).toMatch(/XP/u);
  });

  it('kommt mit einer leeren Rangliste zurecht', async () => {
    const embed = level.buildLeaderboardEmbed([], 0);
    expect(embed.description).toBeTruthy();
  });

  it('bietet einen Knopf zur vollständigen Rangliste', () => {
    const [reihe] = level.buildLeaderboardButtons('https://example.test/leaderboard');
    const knopf = reihe?.components[0];

    expect(knopf).toMatchObject({
      type: 2,
      // 5 = Link-Knopf. Er führt aus Discord hinaus und braucht keine
      // Antwort des Bots.
      style: 5,
      url: 'https://example.test/leaderboard',
    });
  });
});

describe('Leaderboard-Command: der Handler', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/bot/src/commands/level-commands.ts'), 'utf8');

  it('zeigt ohne Angabe fünf Plätze', () => {
    expect(quelle).toContain("interaction.options.getInteger('azahl') ?? 5");
  });

  it('pingt niemanden an', () => {
    /*
     * Eine Rangliste, die fünf Leute benachrichtigt, sobald irgendwer sie
     * abruft, wäre eine Zumutung. `allowedMentions: { parse: [] }` zeigt die
     * Erwähnung an, ohne zu benachrichtigen.
     */
    const abschnitt = quelle.slice(quelle.indexOf('async function handleLeaderboard'));
    expect(abschnitt.slice(0, abschnitt.indexOf('\n}\n'))).toContain('allowedMentions: { parse: [] }');
  });

  it('verlinkt auf die öffentliche Seite über die zentrale Adresse', () => {
    // Keine ausgeschriebene Domain im Befehl - sie steht in der
    // Konfiguration, und eine zweite Stelle wäre beim nächsten Umzug falsch.
    expect(quelle).toContain("appUrl('/leaderboard')");
    expect(quelle).not.toContain('system.swisshub.gg');
  });

  it('rechnet die Rangliste nicht selbst', () => {
    const abschnitt = quelle.slice(quelle.indexOf('async function handleLeaderboard'));
    const koerper = abschnitt.slice(0, abschnitt.indexOf('\n}\n'));
    expect(koerper).toContain('level.getLeaderboard(');
    expect(koerper).not.toContain('prisma');
    expect(koerper).not.toContain('sort(');
  });
});

describe('Mitgliedsakte: Avatar und Discord-Profil', () => {
  const akte = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/members/components/mitglieds-akte.tsx'),
    'utf8',
  );
  const avatar = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/members/components/profil-avatar.tsx'),
    'utf8',
  );

  it('macht den Avatar anklickbar', () => {
    expect(akte).toContain('<ProfilAvatar');
    expect(avatar).toContain('<Dialog');
  });

  it('holt für die Grossansicht ein grösseres Bild', () => {
    /*
     * Discords Adressen tragen die Kantenlänge als Parameter. Das Bild der
     * Akte ist 64 Pixel breit; es auf 512 zu ziehen ergäbe einen Matsch.
     */
    expect(avatar).toContain('avatarSizeFor(512)');
    expect(avatar).toContain('getDiscordAvatarUrl(');
  });

  it('zeigt Discords Standardbild, wenn es kein eigenes gibt', () => {
    expect(avatar).toContain('defaultAvatarUrl(discordId)');
  });

  it('lässt kein kaputtes Bild stehen', () => {
    expect(avatar).toContain('onError=');
    expect(avatar).toContain('fehlgeschlagen');
  });

  it('verzerrt das Bild nicht', () => {
    expect(avatar).toContain('aspect-square');
    expect(avatar).toContain('object-cover');
  });

  it('verlinkt das Discord-Profil über die Benutzerkennung', () => {
    // `discord.com/users/<id>` ist der von Discord unterstützte Weg. Die
    // Kennung ist der stabile Bezeichner - ein Benutzername ändert sich.
    expect(akte).toContain('https://discord.com/users/${basic.discordId}');
    expect(akte).toContain('Discord-Profil öffnen');
  });

  it('nutzt keine Adresse über den Benutzernamen', () => {
    expect(akte).not.toContain('discord.com/users/${basic.username}');
    expect(akte).not.toMatch(/discordapp\.com\/users\//u);
  });

  it('bietet einen Rückfall über die Kennung', () => {
    expect(akte).toContain('<KopierKnopf');
  });

  it('erweitert keine Berechtigung', () => {
    // Beides steht innerhalb der Akte. Wer sie nicht sehen darf, sieht auch
    // das nicht - hier wird nichts zusätzlich geprüft und nichts geöffnet.
    expect(avatar).not.toContain('requirePagePermission');
    expect(avatar).not.toContain('can(');
  });
});
