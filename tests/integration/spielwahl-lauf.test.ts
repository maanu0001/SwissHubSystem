import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_lauf');

/**
 * Ein Abend, von Anfang bis Ende.
 *
 * ## Was diese Datei prueft
 *
 * Nicht einzelne Funktionen, sondern den Weg: eroeffnen, beitreten,
 * vorschlagen, schliessen, entscheiden, annehmen. Wenn dabei eine der
 * Zustandsbedingungen falsch sitzt, faellt es hier auf und nicht erst am
 * Freitagabend.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = { discordId: '100000000000000001', username: 'anna' };
const BEN = { discordId: '100000000000000002', username: 'ben' };
const CARA = { discordId: '100000000000000003', username: 'cara' };

async function leeren(): Promise<void> {
  await prisma.spielwahlVote.deleteMany({});
  await prisma.spielwahlRound.deleteMany({});
  await prisma.spielwahlSupport.deleteMany({});
  await prisma.spielwahlCandidate.deleteMany({});
  await prisma.spielwahlCommand.deleteMany({});
  await prisma.spielwahlParticipant.deleteMany({});
  await prisma.spielwahlSession.deleteMany({});
  await prisma.game.deleteMany({});
}

async function spiele(anzahl: number): Promise<string[]> {
  const namen = [
    'Deep Rock Galactic',
    'Valheim',
    'Counter-Strike 2',
    'Lethal Company',
    'Helldivers 2',
    'Rocket League',
  ];
  const ids: string[] = [];
  for (let index = 0; index < anzahl; index += 1) {
    const name = namen[index] ?? `Spiel ${index}`;
    const spiel = await prisma.game.create({
      data: { name, nameKey: name.toLowerCase(), enabled: true },
    });
    ids.push(spiel.id);
  }
  return ids;
}

describeWithDatabase('Was spielen wir?: der ganze Ablauf', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('führt eine Roulette-Runde von der Lobby bis zum angenommenen Ergebnis', async () => {
    const gameIds = await spiele(4);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });

    expect(await spielwahl.tritteBei(session.id, BEN.discordId)).toBe('neu');
    expect(await spielwahl.tritteBei(session.id, BEN.discordId)).toBe('schon-dabei');

    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: gameIds[1] });
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: gameIds[2] });

    await spielwahl.schliesseVorschlaege(session.id, ANNA);
    const rundenId = await spielwahl.starte(session.id, ANNA);

    const runde = await prisma.spielwahlRound.findUniqueOrThrow({ where: { id: rundenId } });
    // Der Gewinner steht, bevor sich etwas gedreht hat.
    expect(runde.gewinnerCandidateId).not.toBeNull();
    expect(runde.kandidaten).toContain(runde.gewinnerCandidateId);
    expect(runde.seed).toMatch(/^[0-9a-f]{32}$/u);

    // Vor Ablauf der Drehzeit passiert nichts.
    expect(await spielwahl.pruefe(session.id, new Date(runde.startedAt.getTime() + 1000))).toBe(false);

    const nachher = new Date(runde.endsAt!.getTime() + 10);
    expect(await spielwahl.pruefe(session.id, nachher)).toBe(true);

    const nachRunde = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachRunde.status).toBe('ERGEBNIS');

    await spielwahl.nimmAn(session.id, ANNA);
    const fertig = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(fertig.status).toBe('ABGESCHLOSSEN');
    expect(fertig.ergebnisCandidateId).toBe(runde.gewinnerCandidateId);
  });

  it('macht aus demselben Titel einen Kandidaten mit mehreren Unterstützern', async () => {
    /*
     * Der Kern der Fairness-Regel: drei Leute, ein Spiel - ein Los. Wuerde
     * jeder Vorschlag eine eigene Zeile werden, gewaenne der Titel mit
     * dreifacher Wahrscheinlichkeit, ohne dass jemand das beschlossen haette.
     */
    const [game] = await spiele(1);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await spielwahl.tritteBei(session.id, CARA.discordId);

    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: game });
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: game });
    await spielwahl.schlageVor(session.id, CARA.discordId, { gameId: game });

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    expect(kandidaten).toHaveLength(1);
    expect(kandidaten[0]?.unterstuetzer).toHaveLength(3);
  });

  it('führt einen freien Titel mit demselben Spiel aus dem Katalog zusammen', async () => {
    const [game] = await spiele(1);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);

    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: game });
    // Andere Schreibweise, dasselbe Spiel.
    await spielwahl.schlageVor(session.id, BEN.discordId, { freierName: 'deep rock  galactic' });

    const kandidaten = await spielwahl.listeKandidaten(session.id);
    expect(kandidaten).toHaveLength(1);
    expect(kandidaten[0]?.unterstuetzer).toHaveLength(2);
    // Und es bleibt der Katalogeintrag - mit Cover, nicht der Freitext.
    expect(kandidaten[0]?.gameId).toBe(game);
  });

  it('nimmt einen Kandidaten erst aus dem Rennen, wenn niemand mehr dahintersteht', async () => {
    const [game] = await spiele(1);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);

    const { candidateId } = await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: game });
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: game });

    await spielwahl.nimmZurueck(session.id, ANNA.discordId, candidateId);
    expect(await prisma.spielwahlCandidate.count({ where: { sessionId: session.id } })).toBe(1);

    await spielwahl.nimmZurueck(session.id, BEN.discordId, candidateId);
    expect(await prisma.spielwahlCandidate.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('lässt die Vorschlagsphase nicht schliessen, solange nur ein Spiel dasteht', async () => {
    const [game] = await spiele(1);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: game });
    await expect(spielwahl.schliesseVorschlaege(session.id, ANNA)).rejects.toThrow();
  });

  it('hält die Vorschlagsgrenze ein - auch über mehrere Kandidaten hinweg', async () => {
    const gameIds = await spiele(5);
    const session = await spielwahl.eroeffne({
      guildId: GUILD,
      host: ANNA,
      optionen: { vorschlaegeProPerson: 2 },
    });
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: gameIds[1] });
    await expect(spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: gameIds[2] })).rejects.toThrow();
  });

  it('lässt nur die Führung starten', async () => {
    const gameIds = await spiele(3);
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await spielwahl.schlageVor(session.id, ANNA.discordId, { gameId: gameIds[0] });
    await spielwahl.schlageVor(session.id, BEN.discordId, { gameId: gameIds[1] });

    await expect(spielwahl.schliesseVorschlaege(session.id, BEN)).rejects.toThrow();
    await spielwahl.schliesseVorschlaege(session.id, ANNA);
    await expect(spielwahl.starte(session.id, BEN)).rejects.toThrow();
  });

  it('gibt die Führung weiter, wenn der Host geht', async () => {
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.tritteBei(session.id, BEN.discordId);
    await spielwahl.tritteBei(session.id, CARA.discordId);

    await spielwahl.verlasse(session.id, ANNA.discordId);

    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.hostDiscordId).toBe(BEN.discordId);
    expect(nachher.status).toBe('LOBBY');
    expect(await spielwahl.rolleVon(session.id, BEN.discordId)).toBe('HOST');
  });

  it('bricht die Runde ab, wenn der Letzte geht', async () => {
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await spielwahl.verlasse(session.id, ANNA.discordId);
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.status).toBe('ABGEBROCHEN');
  });

  it('räumt verfallene Runden ab, ohne den Verlauf zu löschen', async () => {
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
    await prisma.spielwahlSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await spielwahl.raeumeAuf()).toBe(1);
    const nachher = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(nachher.status).toBe('ABGEBROCHEN');
    expect(nachher.closedAt).not.toBeNull();
  });
});
