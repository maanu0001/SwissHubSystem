import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type { AgentTransport } from '../../packages/modules/src/gameserver/agent-client';

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

/**
 * Ein Agent, der antwortet, ohne dass es ihn gibt.
 *
 * **Hier entsteht kein Container.** Der Transport schreibt mit, was SwissHub
 * senden wollte, und antwortet mit dem, was ein Host antworten wuerde. Ein
 * Test, der Docker startet, ist kein Test - er ist eine Maschine, die
 * jemand aufraeumen muss.
 */
function falscherAgent(optionen: { erstellenScheitert?: boolean; laeuft?: boolean } = {}) {
  const aufrufe: Array<{ pfad: string; rumpf: unknown }> = [];

  const transport: AgentTransport = async (url, anfrage) => {
    const pfad = new URL(url).pathname;
    const rumpf: unknown = anfrage.body ? JSON.parse(anfrage.body) : {};
    aufrufe.push({ pfad, rumpf });

    if (pfad === '/instances/create' && optionen.erstellenScheitert) {
      return { status: 500, text: async () => JSON.stringify({ error: 'Kein Platz auf dem Host.' }) };
    }

    const antwort: Record<string, unknown> =
      pfad === '/host/status'
        ? {
            ok: true,
            agentVersion: '2.0.0',
            dockerAvailable: true,
            cpuPercent: 10,
            memoryUsedMb: 2048,
            diskFreeMb: 100_000,
            uptimeSeconds: 1000,
            runningCount: 0,
          }
        : pfad === '/instances/create'
          ? { containerRef: `container-${Math.random().toString(36).slice(2, 10)}` }
          : pfad === '/instances/status'
            ? {
                instanceId: (rumpf as { instanceId?: string }).instanceId ?? '',
                containerRef: 'container-abc',
                running: optionen.laeuft ?? true,
                status: 'Up 3 seconds',
              }
            : pfad === '/instances'
              ? { instances: [] }
              : pfad === '/images'
                ? { images: [] }
                : pfad === '/instances/files'
                  ? { files: [] }
                  : { ok: true };

    return { status: 200, text: async () => JSON.stringify(antwort) };
  };

  return { transport, aufrufe };
}

/**
 * Ein registrierter Host, ein Runtime-Image und ein Profil.
 *
 * Die Vorbedingung jedes Tests - und zugleich die Beschreibung des neuen
 * Modells: kein Anbieter, keine VM-Vorlage, sondern eine vorbereitete
 * Maschine mit einem Abbild darauf.
 */
async function baueInfrastruktur(ueberschreibungen: Record<string, unknown> = {}) {
  const kennung = Math.random().toString(36).slice(2, 8);

  const abbild = await prisma.gameRuntimeImage.create({
    data: {
      name: `CS2 Stable ${kennung}`,
      game: 'CS2',
      image: 'ghcr.io/swisshub/cs2',
      tag: '2026-09',
      gamePortInContainer: 27015,
      tvPortInContainer: 27020,
    },
  });

  const host = await prisma.gameServerHost.create({
    data: {
      name: `SH-GAME-HOST-${kennung}`,
      hostname: '192.0.2.50',
      allowedGames: ['CS2'],
      registeredAt: new Date(),
      lastHeartbeatAt: new Date(),
      dockerAvailable: true,
      cpuCores: 16,
      memoryMb: 32_768,
      diskGb: 500,
      diskFreeMb: 400_000,
      maxInstances: 6,
      maxParallelStarts: 4,
      ...ueberschreibungen,
    },
  });

  /*
   * Die Identitaet des Hosts, verschluesselt wie im Betrieb. Ohne sie
   * koennte der Orchestrator den Host nicht ansprechen - und genau das
   * soll der Test mitpruefen.
   */
  await prisma.gameServerHost.update({
    where: { id: host.id },
    data: {
      agentTokenEnc: (await import('@swisshub/secrets')).encryptSecret(
        'test-agent-token-fuer-den-host',
        gameserver.hostTokenAdresse(host.id),
      ),
    },
  });

  const profil = await prisma.gameProfile.create({
    data: {
      name: `CS2 Competitive ${kennung}`,
      game: 'CS2',
      runtimeImageId: abbild.id,
      mapPool: MAP_POOL,
      cpuLimit: 2,
      memoryLimitMb: 4096,
    },
  });

  return { host, abbild, profil };
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
    await prisma.hostPortReservation.deleteMany();
    await prisma.serverHeartbeat.deleteMany();
    await prisma.gameServerFile.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.hostImageState.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameRuntimeImage.deleteMany();
    await prisma.gameServerHost.deleteMany();
    await prisma.hostGroup.deleteMany();
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

  it('stellt eine Instanz auf einem Host bereit und merkt sich den Versuch', async () => {
    const { profil, host } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport, aufrufe } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    expect(ergebnis.ok, ergebnis.grund).toBe(true);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    expect(instanz.hostId).toBe(host.id);
    expect(instanz.providerId, 'Eine Instanz auf einem Host hat keinen Anbieter').toBeNull();
    expect(instanz.containerRef).toBeTruthy();
    expect(instanz.publicHost).toBe(host.hostname);
    expect(instanz.status).toBe('STARTING');

    // Die Ports kommen aus dem Bereich des Hosts, nicht aus dem Abbild.
    expect(instanz.gamePort).toBeGreaterThanOrEqual(host.gamePortFrom);
    expect(instanz.gamePort).toBeLessThanOrEqual(host.gamePortTo);
    expect(instanz.tvPort).toBeGreaterThanOrEqual(host.tvPortFrom);

    // Und sie sind reserviert - nicht nur an der Instanz vermerkt.
    const reservierungen = await prisma.hostPortReservation.findMany({ where: { instanceId: instanz.id } });
    expect(reservierungen.map((zeile) => zeile.kind).sort()).toEqual(['GAME', 'TV']);

    // Das RCON-Passwort liegt verschluesselt da und nicht im Klartext.
    expect(instanz.rconPasswordEnc).toMatch(/^v1\./u);

    // Der Schnappschuss haelt fest, mit welchen Einstellungen gespielt wird.
    expect(instanz.profileSnapshot).toBeTruthy();
    expect(JSON.stringify(instanz.profileSnapshot)).toContain('mapPool');

    const versuch = await prisma.provisioningAttempt.findFirstOrThrow();
    expect(versuch.succeeded).toBe(true);
    expect(versuch.durationMs).not.toBeNull();

    // Und der Host hat genau einen Auftrag bekommen: einen Container bauen.
    expect(aufrufe.map((aufruf) => aufruf.pfad)).toEqual(['/instances/create']);
  });

  it('schickt dem Host eine Spezifikation ohne freie Docker-Argumente', async () => {
    /*
     * Die Zusage der ganzen Laufzeitschicht. Was hier ankommt, ist eine
     * Aufzaehlung geprüfter Felder - kein Feld, in dem ein `--privileged`
     * stehen koennte.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport, aufrufe } = falscherAgent();

    await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    const erstellen = aufrufe.find((aufruf) => aufruf.pfad === '/instances/create');
    const spez = (erstellen?.rumpf as { spec: Record<string, unknown> }).spec;

    expect(Object.keys(spez).sort()).toEqual([
      'command',
      'configMountPath',
      'cpuLimit',
      'dataMountPath',
      'env',
      'image',
      'memoryLimitMb',
      'name',
      'ports',
    ]);
    expect(spez.image).toBe('ghcr.io/swisshub/cs2:2026-09');
    expect(JSON.stringify(spez)).not.toMatch(/privileged|network|cap-add|--/u);

    // Das RCON-Passwort reist mit - es muss in den Container, und es geht
    // ueber eine signierte Verbindung. Im Browser taucht es nirgends auf.
    expect((spez.env as Record<string, string>).SWISSHUB_RCON_PASSWORD).toBeTruthy();
  });

  it('merkt sich auch einen gescheiterten Versuch und gibt die Ports zurück', async () => {
    /*
     * Gerade die gescheiterten. Ohne sie liesse sich hinterher nicht sagen,
     * ob der Host langsam war oder gar nicht geantwortet hat.
     *
     * Und die Ports muessen zurueck: eine Instanz, die scheitert und ihre
     * Ports behaelt, frisst den Bereich des Hosts auf - nach genug
     * Fehlversuchen nimmt er gar nichts mehr an.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent({ erstellenScheitert: true });

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    expect(ergebnis.ok).toBe(false);

    const versuch = await prisma.provisioningAttempt.findFirstOrThrow();
    expect(versuch.succeeded).toBe(false);
    expect(versuch.error).toBeTruthy();

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.phase).toBe('PROVISION_FAILED');

    expect(await prisma.hostPortReservation.count(), 'Die Ports müssen frei sein').toBe(0);
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
    const { transport } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(
      assignmentId,
      { ...GRENZEN, maxTotal: 0 },
      new Date(),
      transport,
    );

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/Gesamtgrenze/u);
    expect(await prisma.gameServerInstance.count()).toBe(0);

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.phase, 'Die Zuordnung bleibt wartend').toBe('WAITING_FOR_SERVER');
  });

  it('hält sich an die Grenze je Turnier', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(
      assignmentId,
      { ...GRENZEN, maxPerTournament: 0 },
      new Date(),
      transport,
    );
    expect(ergebnis.grund).toMatch(/Turnier/u);
  });

  it('stellt nichts bereit, solange der Zeitpunkt nicht erreicht ist', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const spaeter = new Date(Date.now() + 3_600_000);
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, spaeter);
    const { transport } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);
    expect(ergebnis.ok).toBe(false);
    expect(await prisma.gameServerInstance.count()).toBe(0);
  });

  it('weist ein Profil ohne Runtime-Image lesbar ab', async () => {
    /*
     * Ein Profil ohne Abbild sieht vollstaendig aus und ist es nicht. Der
     * Grund soll in der Zuordnung stehen und damit in der Oberflaeche -
     * nicht als Ausnahme im Protokoll.
     */
    await baueInfrastruktur();
    const profil = await prisma.gameProfile.create({
      data: { name: `Ohne Abbild ${Math.random().toString(36).slice(2, 8)}`, game: 'CS2', mapPool: MAP_POOL },
    });
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/Runtime-Image/u);

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.lastError).toMatch(/Runtime-Image/u);
  });

  it('nimmt keinen Host, der das Spiel nicht darf', async () => {
    const { profil } = await baueInfrastruktur({ allowedGames: [] });
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toMatch(/freigegeben/u);
    expect(await prisma.gameServerInstance.count()).toBe(0);
  });

  it('nimmt keinen Host, der leerläuft oder in Wartung steht', async () => {
    for (const status of ['DRAINING', 'MAINTENANCE', 'DISABLED'] as const) {
      await prisma.hostPortReservation.deleteMany();
      await prisma.gameServerInstance.deleteMany();
      await prisma.matchServerAssignment.deleteMany();
      await prisma.gameProfile.deleteMany();
      await prisma.gameRuntimeImage.deleteMany();
      await prisma.gameServerHost.deleteMany();

      const { profil } = await baueInfrastruktur({ status });
      const { match } = await baueMatch();
      const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
      const { transport } = falscherAgent();

      const ergebnis = await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);
      expect(ergebnis.ok, status).toBe(false);
      expect(await prisma.gameServerInstance.count(), status).toBe(0);
    }
  });

  it('entfernt eine fällige Instanz, gibt die Ports frei und nimmt die Geheimnisse mit', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport, aufrufe } = falscherAgent();

    await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: { status: 'READY', deleteAfterAt: new Date(Date.now() - 60_000) },
    });

    aufrufe.length = 0;
    const ergebnis = await gameserver.raeumeAuf(new Date(), transport);
    expect(ergebnis.geloescht).toBe(1);

    const danach = await prisma.gameServerInstance.findUniqueOrThrow({ where: { id: instanz.id } });
    expect(danach.status).toBe('REMOVED');
    expect(danach.rconPasswordEnc, 'Ein Passwort für einen Container, den es nicht mehr gibt').toBeNull();
    expect(danach.containerRef).toBeNull();

    expect(await prisma.hostPortReservation.count()).toBe(0);

    // Erst stoppen, dann entfernen - in dieser Reihenfolge.
    expect(aufrufe.map((aufruf) => aufruf.pfad)).toEqual(['/instances/stop', '/instances/delete']);
  });

  it('entfernt keine Instanz, deren Archivierung schiefging', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: { status: 'READY', deleteAfterAt: new Date(Date.now() - 60_000) },
    });
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { phase: 'ARCHIVE_ERROR' },
    });

    const ergebnis = await gameserver.raeumeAuf(new Date(), transport);
    expect(ergebnis.geloescht).toBe(0);
    expect(ergebnis.uebersprungen).toBe(1);

    const danach = await prisma.gameServerInstance.findUniqueOrThrow({ where: { id: instanz.id } });
    expect(danach.status, 'Lieber eine Instanz zu viel als eine Demo zu wenig').not.toBe('REMOVED');
  });

  it('entfernt keine Instanz, die jemand behalten will', async () => {
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);

    const instanz = await prisma.gameServerInstance.findFirstOrThrow();
    await prisma.gameServerInstance.update({
      where: { id: instanz.id },
      data: {
        status: 'READY',
        deleteAfterAt: new Date(Date.now() - 60_000),
        heldByDiscordId: '1',
        heldReason: 'Wird noch angesehen',
      },
    });

    const ergebnis = await gameserver.raeumeAuf(new Date(), transport);
    expect(ergebnis.geloescht).toBe(0);
  });

  it('erstellt eine Instanz neu, ohne das Match anzufassen', async () => {
    /*
     * Der Fall aus dem Betrieb: der Container ist kaputt, das Match nicht.
     * Match, Zuordnung und Veto bleiben - es entsteht ein neuer Container.
     */
    const { profil } = await baueInfrastruktur();
    const { match } = await baueMatch();
    const { assignmentId } = await gameserver.sorgeFuerZuordnung(match.id, profil.id, null);
    const { transport } = falscherAgent();

    await gameserver.provisioniere(assignmentId, GRENZEN, new Date(), transport);
    const erste = await prisma.gameServerInstance.findFirstOrThrow();

    const ergebnis = await gameserver.erstelleInstanzNeu(
      assignmentId,
      GRENZEN,
      { discordId: '1', username: 'leitung' },
      new Date(),
      transport,
    );

    expect(ergebnis.ok, ergebnis.grund).toBe(true);

    const zuordnung = await prisma.matchServerAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(zuordnung.matchId, 'Dieselbe Turnier-Match-Kennung').toBe(match.id);
    expect(zuordnung.instanceId).not.toBe(erste.id);

    const alte = await prisma.gameServerInstance.findUniqueOrThrow({ where: { id: erste.id } });
    expect(alte.status).toBe('REMOVED');

    // Und die alte Instanz hat ihre Ports abgegeben.
    expect(await prisma.hostPortReservation.count({ where: { instanceId: erste.id } })).toBe(0);
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
