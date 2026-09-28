import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_gameserver');

/**
 * Die Serverorchestrierung gegen eine echte Datenbank.
 *
 * ## Was hier geprueft wird
 *
 * Die drei Zusagen, die auf Eindeutigkeiten und bedingten Schreibvorgaengen
 * beruhen - also auf der Datenbank und nicht auf der Anwendung:
 *
 *   1. ein Match bekommt **eine** Bereitstellung, auch bei zwei Workern
 *   2. ein Veto-Schritt wird **einmal** belegt, auch bei zwei Klicks
 *   3. ein Serverresultat geht durch die **bestehende** Resultatlogik
 *
 * ## Was hier ausdruecklich nicht passiert
 *
 * Es entsteht keine einzige echte Maschine. Der Anbieter ist der
 * Simulationstreiber; er kennt kein Datacenter und ruft nichts auf. Ein
 * Test, der eine VM startet, ist kein Test - er ist eine Rechnung.
 */
/*
 * Ein Hauptschluessel fuer diese Testdatei.
 *
 * Die Orchestrierung verschluesselt das Agent-Token und das RCON-Passwort
 * je Maschine - ohne Schluessel liesse sich das nicht pruefen. Der Wert ist
 * eine feste Fuellung: er ist kein Geheimnis, er ist ein Testwert, und er
 * darf in keiner anderen Umgebung stehen.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString('base64');

const { prisma } = await import('@swisshub/database');
const { gameserver } = await import('@swisshub/modules');

const GUILD = '100000000000000002';
const GRENZEN = {
  enabled: true,
  maxTotal: 30,
  maxPerGame: 20,
  maxParallelProvisioning: 5,
  maxPerTournament: 8,
  provisionLeadMinutes: 20,
  provisioningTimeoutMinutes: 15,
  idleTimeoutMinutes: 60,
};

const MAP_POOL = ['de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo'];

/** Ein Anbieter, ein Template und ein Profil - die Vorbedingung jedes Tests. */
async function baueInfrastruktur() {
  const anbieter = await prisma.gameServerProvider.create({
    data: { name: `Sim ${Math.random().toString(36).slice(2, 8)}`, driver: 'simulation', enabled: true },
  });
  const template = await prisma.gameServerTemplate.create({
    data: { name: 'CS2 Turnier', providerId: anbieter.id, game: 'CS2', imageRef: 'cs2-base' },
  });
  const profil = await prisma.gameProfile.create({
    data: {
      name: `CS2 Competitive ${Math.random().toString(36).slice(2, 8)}`,
      game: 'CS2',
      templateId: template.id,
      mapPool: MAP_POOL,
    },
  });
  return { anbieter, template, profil };
}

/** Ein Turnier mit einem Match zwischen zwei Teams. */
async function baueMatch(bestOf = 1) {
  const turnier = await prisma.tournament.create({
    data: {
      guildId: GUILD,
      slug: `t-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Testturnier',
      gameName: 'Counter-Strike 2',
      status: 'RUNNING',
      createdByDiscordId: '1',
    },
  });
  const stage = await prisma.tournamentStage.create({
    data: { tournamentId: turnier.id, kind: 'WINNERS', name: 'Hauptrunde', sortOrder: 1 },
  });

  const teams = await Promise.all(
    ['Alpha', 'Beta'].map((name, i) =>
      prisma.tournamentTeam.create({
        data: {
          tournamentId: turnier.id,
          name,
          tag: name.slice(0, 3).toUpperCase(),
          status: 'CONFIRMED',
          captainDiscordId: `20000000000000000${String(i)}`,
          captainUsername: `captain-${name.toLowerCase()}`,
        },
      }),
    ),
  );

  const teilnehmer = await Promise.all(
    teams.map((team, i) =>
      prisma.tournamentParticipant.create({
        data: { tournamentId: turnier.id, teamId: team.id, username: team.name, seed: i + 1 },
      }),
    ),
  );

  const match = await prisma.tournamentMatch.create({
    data: {
      tournamentId: turnier.id,
      stageId: stage.id,
      matchNumber: 1,
      round: 1,
      position: 1,
      bestOf,
      status: 'READY',
      participantAId: teilnehmer[0]?.id,
      participantBId: teilnehmer[1]?.id,
    },
  });

  return { turnier, match, teams };
}

describeWithDatabase('Die Bereitstellung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    gameserver.simulationZuruecksetzen();
    await prisma.matchVetoAction.deleteMany();
    await prisma.matchServerAssignment.deleteMany();
    await prisma.provisioningAttempt.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
    await prisma.tournamentMatch.deleteMany();
    await prisma.tournament.deleteMany();
  });

  it('legt für ein Match genau eine Zuordnung an - auch bei zwei Durchgängen', async () => {
    /*
     * **Der wichtigste Test dieser Datei.**
     *
     * Zwei Worker, dasselbe Match, im selben Moment. Genau einer darf die
     * Zuordnung anlegen; der andere muss dieselbe zurueckbekommen, ohne zu
     * werfen. Waere das nicht so, entstuenden zwei Maschinen fuer ein Match -
     * und die Rechnung kaeme am Monatsende.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();

    const [a, b] = await Promise.all([
      gameserver.sorgeFuerZuordnung(match.id, profil.id, null),
      gameserver.sorgeFuerZuordnung(match.id, profil.id, null),
    ]);

    expect(
      [a, b].filter((e) => e.neu),
      'Genau eine Zuordnung darf neu sein',
    ).toHaveLength(1);
    expect(a.assignmentId).toBe(b.assignmentId);
    expect(await prisma.matchServerAssignment.count({ where: { matchId: match.id } })).toBe(1);
  });

  it('stellt eine Maschine bereit und merkt sich den Versuch', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN);

    expect(ergebnis.ok, ergebnis.grund).toBe(true);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    expect(instanz.providerRef).toBeTruthy();
    expect(instanz.publicHost).toBeTruthy();
    // Die Geheimnisse liegen verschluesselt da und nicht im Klartext.
    expect(instanz.agentTokenEnc).toMatch(/^v1\./u);
    expect(instanz.rconPasswordEnc).toMatch(/^v1\./u);

    const versuch = await prisma.provisioningAttempt.findFirstOrThrow();
    expect(versuch.succeeded).toBe(true);
    expect(versuch.durationMs).not.toBeNull();
  });

  it('merkt sich auch einen gescheiterten Versuch', async () => {
    /*
     * Gerade die gescheiterten. Ohne sie liesse sich hinterher nicht sagen,
     * ob der Anbieter langsam war oder gar nicht geantwortet hat.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    gameserver.simulationNaechsterFehler('Kontingent erschöpft');
    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN);

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toContain('Kontingent');

    const versuch = await prisma.provisioningAttempt.findFirstOrThrow();
    expect(versuch.succeeded).toBe(false);
    expect(versuch.error).toContain('Kontingent');

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.phase).toBe('PROVISION_FAILED');
  });

  it('hält sich an die Gesamtgrenze - ohne die Zuordnung zu verbrennen', async () => {
    /*
     * Eine Grenze ist eine Entscheidung, keine Stoerung. Die Zuordnung
     * bleibt wartend, damit der naechste Durchgang es wieder versucht -
     * sonst muesste jemand sie von Hand zuruecksetzen, nur weil gerade viel
     * los war.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.provisioniere(assignmentId, { ...GRENZEN, maxTotal: 0 });

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/Gesamtgrenze/u);
    expect(await prisma.gameServerInstance.count()).toBe(0);

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.phase, 'Die Zuordnung muss wartend bleiben').toBe('WAITING_FOR_SERVER');
  });

  it('hält sich an die Grenze je Turnier', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.provisioniere(assignmentId, { ...GRENZEN, maxPerTournament: 0 });
    expect(ergebnis.grund).toMatch(/Turnier/u);
  });

  it('stellt nichts bereit, solange der Zeitpunkt nicht erreicht ist', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const spaeter = new Date(Date.now() + 3600_000);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, spaeter);

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN);
    expect(ergebnis.ok).toBe(false);
    expect(await prisma.gameServerInstance.count()).toBe(0);
  });

  it('weist einen ausgeschalteten Anbieter ab', async () => {
    const { anbieter, profil } = await baueInfrastruktur();
    await prisma.gameServerProvider.update({ where: { id: anbieter.id }, data: { enabled: false } });
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/ausgeschaltet/u);
  });

  it('löscht eine fällige Maschine und nimmt die Geheimnisse mit', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    await gameserver.provisioniere(assignmentId, GRENZEN);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: { status: 'RUNNING', deleteAfterAt: new Date(Date.now() - 1000) },
    });

    const ergebnis = await gameserver.raeumeAuf();
    expect(ergebnis.geloescht).toBe(1);

    const danach = await prisma.gameServerInstance.findUniqueOrThrow({ where: { id: instanz.id } });
    expect(danach.status).toBe('REMOVED');
    expect(danach.rconPasswordEnc, 'Ein RCON-Passwort ohne Maschine ist nur noch ein Risiko').toBeNull();
    expect(danach.agentTokenEnc).toBeNull();
  });

  it('löscht keine Maschine, deren Archivierung schiefging', async () => {
    /*
     * Lieber eine Maschine zu viel als eine Demo zu wenig. Eine Datei, die
     * es nicht mehr gibt, weil die Maschine schneller weg war, laesst sich
     * nicht nachreichen.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    await gameserver.provisioniere(assignmentId, GRENZEN);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: { status: 'RUNNING', deleteAfterAt: new Date(Date.now() - 1000) },
    });
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { phase: 'ARCHIVE_ERROR' },
    });

    const ergebnis = await gameserver.raeumeAuf();
    expect(ergebnis.geloescht).toBe(0);
    expect(ergebnis.uebersprungen).toBe(1);
    expect((await prisma.gameServerInstance.findUniqueOrThrow({ where: { id: instanz.id } })).status).toBe(
      'RUNNING',
    );
  });

  it('löscht keine Maschine, die jemand behalten will', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    await gameserver.provisioniere(assignmentId, GRENZEN);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: {
        status: 'RUNNING',
        deleteAfterAt: new Date(Date.now() - 1000),
        heldByDiscordId: '1',
        heldReason: 'Demo fehlt noch',
      },
    });

    expect((await gameserver.raeumeAuf()).geloescht).toBe(0);
  });
});

describeWithDatabase('Das Map-Veto', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.matchVetoAction.deleteMany();
    await prisma.matchServerAssignment.deleteMany();
    await prisma.provisioningAttempt.deleteMany();
    // Vor dem Anbieter: `GameServerInstance` verweist mit `Restrict` auf ihn -
    // eine laufende Maschine soll ihren Anbieter nicht verlieren koennen.
    await prisma.gameServerInstance.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
    await prisma.tournamentMatch.deleteMany();
    await prisma.tournament.deleteMany();
  });

  async function vetoAufbauen(bestOf = 1) {
    const { profil } = await baueInfrastruktur();
    const { match, teams } = await baueMatch(bestOf);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    return { assignmentId, match, teams };
  }

  it('beginnt mit dem vollen Map-Pool und Seite A am Zug', async () => {
    const { assignmentId } = await vetoAufbauen();
    const stand = await gameserver.vetoStand(assignmentId);

    expect(stand.verfuegbar).toHaveLength(MAP_POOL.length);
    expect(stand.naechster).toMatchObject({ kind: 'BAN', actor: 'A', stepIndex: 0 });
    expect(stand.fertig).toBe(false);
  });

  it('belegt einen Schritt genau einmal - auch bei zwei gleichzeitigen Klicks', async () => {
    /*
     * Zwei Klicks im selben Moment. Genau einer darf zaehlen; der andere
     * muss eine Absage bekommen, die der Oberflaeche sagt, dass sie den
     * neuen Stand holen soll. Waere das nicht so, waehlte jemand eine Map
     * und saehe eine andere.
     */
    const { assignmentId } = await vetoAufbauen();

    const klick = (map: string) =>
      gameserver.fuehreVetoSchritt({
        assignmentId,
        map,
        discordId: '1',
        username: 'admin',
        alsAdmin: true,
      });

    const ergebnisse = await Promise.allSettled([klick('de_mirage'), klick('de_nuke')]);
    const erfolgreich = ergebnisse.filter((e) => e.status === 'fulfilled');

    expect(erfolgreich).toHaveLength(1);
    expect(await prisma.matchVetoAction.count({ where: { assignmentId } })).toBe(1);
  });

  it('lässt nur die Seite handeln, die an der Reihe ist', async () => {
    const { assignmentId, teams } = await vetoAufbauen();
    const captainB = teams[1]?.captainDiscordId as string;

    await expect(
      gameserver.fuehreVetoSchritt({
        assignmentId,
        map: 'de_mirage',
        discordId: captainB,
        username: 'beta',
        alsAdmin: false,
      }),
      'Seite B darf bei Schritt 0 nicht bannen',
    ).rejects.toThrow();
  });

  it('lässt Fremde gar nicht handeln', async () => {
    const { assignmentId } = await vetoAufbauen();

    await expect(
      gameserver.fuehreVetoSchritt({
        assignmentId,
        map: 'de_mirage',
        discordId: '999999999999999999',
        username: 'fremder',
        alsAdmin: false,
      }),
    ).rejects.toThrow();
  });

  it('lässt eine schon gebannte Map nicht ein zweites Mal wählen', async () => {
    const { assignmentId } = await vetoAufbauen();
    await gameserver.fuehreVetoSchritt({
      assignmentId,
      map: 'de_mirage',
      discordId: '1',
      username: 'admin',
      alsAdmin: true,
    });

    await expect(
      gameserver.fuehreVetoSchritt({
        assignmentId,
        map: 'de_mirage',
        discordId: '1',
        username: 'admin',
        alsAdmin: true,
      }),
    ).rejects.toThrow();
  });

  it('führt ein BO1 bis zum Decider und liefert eine Map', async () => {
    const { assignmentId } = await vetoAufbauen(1);

    for (let i = 0; i < 6; i += 1) {
      const stand = await gameserver.vetoStand(assignmentId);
      await gameserver.fuehreVetoSchritt({
        assignmentId,
        map: stand.verfuegbar[0] as string,
        discordId: '1',
        username: 'admin',
        alsAdmin: true,
      });
    }

    const fertig = await gameserver.schliesseVetoAb(assignmentId);
    expect(fertig.fertig).toBe(true);
    expect(gameserver.mapsAusVeto(fertig)).toHaveLength(1);
    expect(fertig.gebannt).toHaveLength(6);
  });

  it('führt ein BO3 zu drei Maps in Spielreihenfolge', async () => {
    const { assignmentId } = await vetoAufbauen(3);

    for (let i = 0; i < 6; i += 1) {
      const stand = await gameserver.vetoStand(assignmentId);
      await gameserver.fuehreVetoSchritt({
        assignmentId,
        map: stand.verfuegbar[0] as string,
        discordId: '1',
        username: 'admin',
        alsAdmin: true,
      });
    }

    const fertig = await gameserver.schliesseVetoAb(assignmentId);
    const maps = gameserver.mapsAusVeto(fertig);

    expect(maps).toHaveLength(3);
    // Die Picks zuerst, der Decider zuletzt - das ist die Spielreihenfolge.
    expect(maps.at(-1)).toBe(fertig.geschehen.find((g) => g.kind === 'DECIDER')?.map);
  });

  it('überlebt einen Neustart, weil jeder Schritt in der Datenbank steht', async () => {
    const { assignmentId } = await vetoAufbauen(1);
    await gameserver.fuehreVetoSchritt({
      assignmentId,
      map: 'de_mirage',
      discordId: '1',
      username: 'admin',
      alsAdmin: true,
    });

    // Ein frisch berechneter Stand - nichts wird mitgefuehrt.
    const stand = await gameserver.vetoStand(assignmentId);
    expect(stand.gebannt).toEqual(['de_mirage']);
    expect(stand.naechster?.stepIndex).toBe(1);
  });

  it('lässt sich nicht vorzeitig abschliessen', async () => {
    const { assignmentId } = await vetoAufbauen(1);
    await expect(gameserver.schliesseVetoAb(assignmentId)).rejects.toThrow();
  });
});

describeWithDatabase('Das Resultat', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.matchServerAssignment.deleteMany();
    await prisma.provisioningAttempt.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
    await prisma.tournamentMatch.deleteMany();
    await prisma.tournament.deleteMany();
  });

  it('übernimmt ein eindeutiges Resultat ins Turniermodul', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch(1);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.uebernimmErgebnis(assignmentId, {
      maps: [{ map: 'de_mirage', team1_score: 13, team2_score: 7 }],
    });

    expect(ergebnis.uebernommen, ergebnis.grund).toBe(true);

    const danach = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(danach.status).toBe('COMPLETED');
    expect(danach.scoreA).toBe(1);
    expect(danach.scoreB).toBe(0);
    expect(danach.winnerId).toBe(match.participantAId);

    // Die Map steht in der **bestehenden** Tabelle des Turniermoduls.
    const maps = await prisma.tournamentMatchGame.findMany({ where: { matchId: match.id } });
    expect(maps).toHaveLength(1);
    expect(maps[0]?.map).toBe('de_mirage');
  });

  it('schickt ein unklares Resultat zur Prüfung, ohne das Bracket anzufassen', async () => {
    /*
     * Ein abgebrochenes BO3. Der Bracket bleibt, wie er ist - ein falsch
     * weitergerueckter Sieger ist im Turnierbetrieb kaum noch zu korrigieren.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch(3);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    const ergebnis = await gameserver.uebernimmErgebnis(assignmentId, {
      maps: [{ map: 'de_mirage', team1_score: 13, team2_score: 7 }],
    });

    expect(ergebnis.uebernommen).toBe(false);
    expect(ergebnis.pruefung).toBe(true);

    const danach = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(danach.status, 'Das Match darf nicht abgeschlossen werden').toBe('READY');
    expect(danach.winnerId).toBeNull();

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.resultReview).toBe(true);
    expect(zuordnung.resultReviewReason).toBeTruthy();
    // Das Rohe steht trotzdem da - sonst waere nicht nachvollziehbar, was
    // der Server tatsaechlich gesagt hat.
    expect(zuordnung.rawResult).toBeTruthy();
  });

  it('überschreibt ein bereits feststehendes Resultat nicht', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch(1);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);

    await gameserver.uebernimmErgebnis(assignmentId, {
      maps: [{ map: 'de_mirage', team1_score: 13, team2_score: 7 }],
    });

    // Ein zweiter Bericht - ein Retry, ein Neustart, ein doppelter Webhook.
    const zweiter = await gameserver.uebernimmErgebnis(assignmentId, {
      maps: [{ map: 'de_mirage', team1_score: 2, team2_score: 13 }],
    });

    expect(zweiter.uebernommen).toBe(false);

    const danach = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(danach.scoreA).toBe(1);
    expect(danach.winnerId).toBe(match.participantAId);
  });

  it('legt keine zweite Bracket-Logik an', async () => {
    /*
     * Strukturell, nicht fachlich: im Gameserver-Modul darf kein
     * `winnerToMatchId` vorkommen. Das Weiterschieben gehoert dem
     * Turniermodul, und zwei Stellen, die dasselbe tun, sind irgendwann
     * uneinig.
     */
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const verzeichnis = join(process.cwd(), 'packages/modules/src/gameserver');

    for (const name of readdirSync(verzeichnis).filter((n) => n.endsWith('.ts'))) {
      const quelle = readFileSync(join(verzeichnis, name), 'utf8');
      expect(quelle, name).not.toMatch(/winnerToMatchId|loserToMatchId|tournamentMatch\.update/u);
    }
  });
});
