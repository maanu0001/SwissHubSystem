import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielekatalog');

/**
 * Der Spielekatalog.
 *
 * Eine Liste, auf die vier Module zeigen - Turniere, Clips, «Was spielen
 * wir?» und die Mitgliederakte. Geprueft wird hier das, was nur eine echte
 * Datenbank zeigt: dass eine Verwaltungsaktion von heute keine Vergangenheit
 * umschreibt, dass die Berechtigung im Dienst und nicht erst in der
 * Oberflaeche sitzt, und dass zwei Spiele mit demselben Namen zwei Namen
 * brauchen.
 */
const { prisma } = await import('@swisshub/database');
const { games, setModuleEnabled, setModuleSettings, spielwahl } = await import('@swisshub/modules');

// Der Typ als reiner Typ-Import: `games` oben ist ein Wert und taugt nicht
// als Namensraum fuer Typen.
type GameEingabe = import('@swisshub/modules').games.GameEingabe;

const GUILD = '000000000000000001';
const ANNA = '900000000000000021';
const BEN = '900000000000000022';
const HOST = { discordId: ANNA, username: 'anna' };

const admin = { discordId: ANNA, username: 'anna', can: () => true };
const mitglied = { discordId: BEN, username: 'ben', can: () => false };

const eingabe = (teile: Partial<GameEingabe> = {}): GameEingabe => ({
  name: 'Deep Rock Galactic',
  shortName: null,
  description: null,
  genre: null,
  platforms: [],
  coverUrl: null,
  maxPlayers: null,
  enabled: true,
  ...teile,
});

async function leeren(): Promise<void> {
  await prisma.spielwahlVote.deleteMany({});
  await prisma.spielwahlSupport.deleteMany({});
  await prisma.spielwahlRound.deleteMany({});
  await prisma.spielwahlCandidate.deleteMany({});
  await prisma.spielwahlParticipant.deleteMany({});
  await prisma.spielwahlSession.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.game.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

describeWithDatabase('Spielekatalog', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await setModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID, true, 'test');
    await setModuleSettings(
      spielwahl.SPIELWAHL_MODULE_ID,
      {
        vorschlaegeProPerson: 3,
        maxTeilnehmerGrenze: 12,
        abstimmdauerSek: 45,
        freieVorschlaege: true,
        offeneProPerson: 3,
        verfallStunden: 12,
        announcementChannelId: null,
      },
      'test',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- Verwaltung ----------------------------------------------------------

  it('legt ein Spiel an und schreibt es ins Protokoll', async () => {
    const spiel = await games.erstelleGame(
      eingabe({ platforms: ['PC', 'Xbox'], maxPlayers: 4, genre: 'Koop-Shooter' }),
      admin,
    );

    expect(spiel.name).toBe('Deep Rock Galactic');
    expect(spiel.nameKey).toBe('deep rock galactic');
    expect(spiel.platforms).toEqual(['PC', 'Xbox']);
    expect(spiel.archivedAt).toBeNull();

    const eintrag = await prisma.auditLog.findFirstOrThrow({ where: { action: 'GAME_CREATED' } });
    expect(eintrag.actorDiscordId).toBe(ANNA);
  });

  it('weist ein unberechtigtes Mitglied überall zurück', async () => {
    const spiel = await games.erstelleGame(eingabe(), admin);

    await expect(games.erstelleGame(eingabe({ name: 'Valheim' }), mitglied)).rejects.toThrow();
    await expect(
      games.bearbeiteGame({ ...eingabe({ name: 'Anders' }), gameId: spiel.id }, mitglied),
    ).rejects.toThrow();
    await expect(games.archiviereGame(spiel.id, mitglied)).rejects.toThrow();
    await expect(games.holeGameZurueck(spiel.id, mitglied)).rejects.toThrow();

    // Nichts davon hat etwas veraendert.
    const unveraendert = await prisma.game.findUniqueOrThrow({ where: { id: spiel.id } });
    expect(unveraendert.name).toBe('Deep Rock Galactic');
    expect(await prisma.game.count()).toBe(1);
  });

  it('lehnt denselben Titel ein zweites Mal ab - auch anders geschrieben', async () => {
    await games.erstelleGame(eingabe(), admin);
    await expect(games.erstelleGame(eingabe({ name: 'DEEP ROCK GALACTIC' }), admin)).rejects.toThrow(
      /bereits ein Spiel/u,
    );
    expect(await prisma.game.count()).toBe(1);
  });

  it('weist ungültige Eingaben serverseitig ab', async () => {
    // Nicht die Oberflaeche entscheidet, was eine Eingabe sein darf.
    expect(games.gameAnlegenSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(games.gameAnlegenSchema.safeParse({ name: 'Ok', coverUrl: 'javascript:x' }).success).toBe(false);
    expect(games.gameAnlegenSchema.safeParse({ name: 'Ok', platforms: ['Atari'] }).success).toBe(false);
    expect(games.gameAnlegenSchema.safeParse({ name: 'Ok', maxPlayers: 0 }).success).toBe(false);
    // Und das Gegenstueck: das Minimum genuegt.
    expect(games.gameAnlegenSchema.safeParse({ name: 'Ok' }).success).toBe(true);
  });

  // --- Verfügbarkeit -------------------------------------------------------

  it('bietet ein abgeschaltetes Spiel in neuen Runden nicht mehr an', async () => {
    const aktiv = await games.erstelleGame(eingabe({ name: 'Valheim' }), admin);
    const aus = await games.erstelleGame(eingabe({ name: 'Phasmophobia', enabled: false }), admin);

    const auswahl = await games.listGames();
    expect(auswahl.map((spiel) => spiel.id)).toEqual([aktiv.id]);
    expect(auswahl.map((spiel) => spiel.id)).not.toContain(aus.id);

    // Die Verwaltung sieht beide.
    const verwaltung = await games.listGames({ includeDisabled: true });
    expect(verwaltung).toHaveLength(2);
  });

  it('nimmt ein archiviertes Spiel aus jeder Auswahl - und aus der Verwaltungsliste', async () => {
    const spiel = await games.erstelleGame(eingabe(), admin);
    expect(await games.archiviereGame(spiel.id, admin)).toBe(true);

    expect(await games.listGames()).toHaveLength(0);
    expect(await games.listGames({ includeDisabled: true })).toHaveLength(0);
    // Erst ausdrücklich danach gefragt.
    expect(await games.listGames({ includeDisabled: true, includeArchived: true })).toHaveLength(1);

    const archiviert = await prisma.game.findUniqueOrThrow({ where: { id: spiel.id } });
    expect(archiviert.archivedAt).not.toBeNull();
    // Archiviert heisst auch abgeschaltet.
    expect(archiviert.enabled).toBe(false);
  });

  it('archiviert idempotent und schreibt nur einmal', async () => {
    const spiel = await games.erstelleGame(eingabe(), admin);

    expect(await games.archiviereGame(spiel.id, admin)).toBe(true);
    expect(await games.archiviereGame(spiel.id, admin)).toBe(false);

    expect(await prisma.auditLog.count({ where: { action: 'GAME_ARCHIVED' } })).toBe(1);
  });

  it('holt ein Spiel zurück, ohne es gleich wieder anzubieten', async () => {
    const spiel = await games.erstelleGame(eingabe(), admin);
    await games.archiviereGame(spiel.id, admin);

    expect(await games.holeGameZurueck(spiel.id, admin)).toBe(true);
    const zurueck = await prisma.game.findUniqueOrThrow({ where: { id: spiel.id } });
    expect(zurueck.archivedAt).toBeNull();
    // Ob es wieder aktiv sein soll, entscheidet jemand danach bewusst.
    expect(zurueck.enabled).toBe(false);
    expect(await games.holeGameZurueck(spiel.id, admin)).toBe(false);
  });

  // --- Historie ------------------------------------------------------------

  it('lässt eine abgeschlossene Runde unberührt, wenn das Spiel umbenannt wird', async () => {
    const spiel = await games.erstelleGame(eingabe({ name: 'Lethal Company' }), admin);
    const sessionId = await runde();
    await spielwahl.schlageVor(sessionId, ANNA, { gameId: spiel.id });

    await games.bearbeiteGame({ ...eingabe({ name: 'Lethal Company 2' }), gameId: spiel.id }, admin);

    const kandidaten = await spielwahl.listeKandidaten(sessionId);
    expect(kandidaten[0]?.name).toBe('Lethal Company');
  });

  it('lässt eine abgeschlossene Runde unberührt, wenn das Spiel gelöscht wird', async () => {
    /*
     * Der Fall, der vorher die Runde mitgenommen haette: die Beziehung stand
     * auf `Cascade`, ein `DELETE` loeschte den Kandidaten - und damit die
     * Stimmen darauf und den Gewinner, der einmal feststand.
     *
     * Geloescht wird ueber den Dienst nicht mehr; ueber die Datenbank ist es
     * weiterhin moeglich, und genau das wird hier nachgestellt.
     */
    const spiel = await games.erstelleGame(eingabe({ name: 'Valheim' }), admin);
    const sessionId = await runde();
    const { candidateId } = await spielwahl.schlageVor(sessionId, ANNA, { gameId: spiel.id });

    await prisma.game.delete({ where: { id: spiel.id } });

    const kandidat = await prisma.spielwahlCandidate.findUnique({ where: { id: candidateId } });
    expect(kandidat).not.toBeNull();
    expect(kandidat?.gameId).toBeNull();
    expect(kandidat?.nameSnapshot).toBe('Valheim');

    const kandidaten = await spielwahl.listeKandidaten(sessionId);
    expect(kandidaten.map((eintrag) => eintrag.name)).toEqual(['Valheim']);
  });

  it('gibt einem freien Vorschlag kein Cover', async () => {
    const sessionId = await runde();
    const { candidateId } = await spielwahl.schlageVor(sessionId, ANNA, {
      freierName: 'Etwas Selbstgedachtes',
    });

    const kandidat = await prisma.spielwahlCandidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(kandidat.coverSnapshot).toBeNull();
    expect(kandidat.nameSnapshot).toBe('Etwas Selbstgedachtes');
  });

  it('lässt ein abgeschaltetes Spiel nicht mehr vorschlagen', async () => {
    const spiel = await games.erstelleGame(eingabe({ enabled: false }), admin);
    const sessionId = await runde();

    // Geprueft wird die Antwort, die beim Benutzer ankommt - nicht die
    // interne Meldung daneben.
    await expect(spielwahl.schlageVor(sessionId, ANNA, { gameId: spiel.id })).rejects.toMatchObject({
      userMessage: expect.stringContaining('nicht (mehr) im Katalog'),
    });
  });

  it('hält die Referenzen anderer Module gültig', async () => {
    const spiel = await games.erstelleGame(eingabe({ name: 'Rocket League' }), admin);

    const clip = await prisma.clip.create({
      data: {
        guildId: GUILD,
        submittedByDiscordId: ANNA,
        submittedByUsername: 'anna',
        sourceType: 'YOUTUBE',
        provider: 'youtube',
        externalId: 'abc',
        canonicalUrl: 'https://www.youtube.com/watch?v=abc',
        embedUrl: 'https://www.youtube-nocookie.com/embed/abc',
        title: 'Clip',
        status: 'APPROVED',
        gameId: spiel.id,
      },
    });

    // Archivieren laesst die Referenz stehen.
    await games.archiviereGame(spiel.id, admin);
    const nachher = await prisma.clip.findUniqueOrThrow({ where: { id: clip.id } });
    expect(nachher.gameId).toBe(spiel.id);

    // Und die Nutzungszahlen sehen ihn.
    const nutzung = await games.nutzungJeGame();
    expect(nutzung.get(spiel.id)?.clips).toBe(1);
  });

  it('zählt, was an einem Spiel hängt', async () => {
    const spiel = await games.erstelleGame(eingabe(), admin);
    const sessionId = await runde();
    await spielwahl.schlageVor(sessionId, ANNA, { gameId: spiel.id });

    const nutzung = await games.nutzungJeGame();
    expect(nutzung.get(spiel.id)).toEqual({ turniere: 0, clips: 0, runden: 1 });
  });

  /** Eine offene Runde, in die vorgeschlagen werden kann. */
  async function runde(): Promise<string> {
    const session = await spielwahl.eroeffne({ guildId: GUILD, host: HOST });
    return session.id;
  }
});
