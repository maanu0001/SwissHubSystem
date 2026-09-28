import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_gameserver_hosts');

/**
 * Hosts, Ports und der Scheduler gegen eine echte Datenbank.
 *
 * ## Warum das gegen eine echte Datenbank laufen muss
 *
 * Weil hier drei Zusagen geprueft werden, die **in** der Datenbank liegen
 * und nicht in der Anwendung:
 *
 *   1. ein Registrierungs-Token gilt **einmal** - bedingte Schreiboperation
 *   2. ein Port gehoert **einem** - `@@unique([hostId, port])`
 *   3. ein Host nimmt nicht mehr an, als er tragen kann - Zeilensperre
 *
 * Ein Test mit Attrappen wuerde alle drei bestehen und keine einzige
 * beweisen: die Eindeutigkeit gibt es nur, wo die Datenbank sie durchsetzt.
 *
 * ## Was hier ausdruecklich nicht passiert
 *
 * Es entsteht kein Container und keine Maschine. Hosts sind Zeilen, der
 * Agent wird nie angerufen.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64');

const { prisma } = await import('@swisshub/database');
const { gameserver } = await import('@swisshub/modules');

const AKTEUR = { discordId: '1', username: 'leitung' };

async function baueHost(ueberschreibungen: Record<string, unknown> = {}) {
  const kennung = Math.random().toString(36).slice(2, 8);
  return prisma.gameServerHost.create({
    data: {
      name: `Host ${kennung}`,
      hostname: '192.0.2.60',
      allowedGames: ['CS2'],
      cpuCores: 16,
      memoryMb: 32_768,
      diskGb: 500,
      diskFreeMb: 400_000,
      reservedCpuCores: 1,
      reservedMemoryMb: 2048,
      maxInstances: 4,
      maxParallelStarts: 2,
      registeredAt: new Date(),
      lastHeartbeatAt: new Date(),
      dockerAvailable: true,
      ...ueberschreibungen,
    },
  });
}

const ANFORDERUNG = { game: 'CS2' as const, cpu: 2, memoryMb: 4096 };

function entwurf(name: string) {
  return {
    name,
    game: 'CS2' as const,
    profileId: null,
    runtimeImageId: null,
    imageTag: null,
    region: null,
    tournamentId: null,
    cpuLimit: 2,
    memoryLimitMb: 4096,
    diskLimitMb: 20_480,
    maxRuntimeMinutes: 240,
    profileSnapshot: {},
    rconPasswordEnc: null,
    serverPassword: null,
  };
}

describeWithDatabase('Die Host-Registrierung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.hostPortReservation.deleteMany();
    await prisma.serverHeartbeat.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.hostImageState.deleteMany();
    await prisma.gameServerHost.deleteMany();
  });

  it('speichert das Token nur als Hash und gibt es genau einmal aus', async () => {
    const host = await baueHost({ registeredAt: null, lastHeartbeatAt: null });

    const angebot = await gameserver.oeffneRegistrierung(host.id, AKTEUR);

    expect(angebot.token.length).toBeGreaterThanOrEqual(40);

    const zeile = await prisma.gameServerHost.findUniqueOrThrow({ where: { id: host.id } });
    expect(zeile.registrationTokenHash, 'Der Klartext darf nirgends stehen').not.toBe(angebot.token);
    expect(zeile.registrationTokenHash).toBe(gameserver.tokenHash(angebot.token));
    expect(zeile.registrationExpiresAt).not.toBeNull();
  });

  it('registriert einen Host und gibt ihm eine dauerhafte Identität', async () => {
    const host = await baueHost({ registeredAt: null });
    const { token } = await gameserver.oeffneRegistrierung(host.id, AKTEUR);

    const ergebnis = await gameserver.registriereHost(token, {
      agentVersion: '2.0.0',
      cpuCores: 8,
      memoryMb: 16_384,
      dockerAvailable: true,
    });

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) {
      return;
    }
    expect(ergebnis.hostId).toBe(host.id);
    expect(ergebnis.agentToken.length).toBeGreaterThanOrEqual(40);

    const zeile = await prisma.gameServerHost.findUniqueOrThrow({ where: { id: host.id } });
    expect(zeile.registeredAt).not.toBeNull();
    expect(zeile.agentTokenEnc, 'Verschlüsselt, nicht im Klartext').toMatch(/^v1\./u);
    expect(zeile.agentVersion).toBe('2.0.0');
    expect(zeile.cpuCores, 'Was der Host meldet, wird übernommen').toBe(8);
    // Und das Registrierungs-Token ist verbraucht.
    expect(zeile.registrationTokenHash).toBeNull();
  });

  it('lässt dasselbe Token kein zweites Mal gelten', async () => {
    /*
     * **Die wichtigste Zusage dieser Datei.**
     *
     * Ein Token, das zweimal geht, öffnet einem Zweiten dieselbe Tür. Die
     * Entwertung ist eine bedingte Schreiboperation - wer sie gewinnt,
     * registriert; wer sie verliert, bekommt eine Absage.
     */
    const host = await baueHost({ registeredAt: null });
    const { token } = await gameserver.oeffneRegistrierung(host.id, AKTEUR);

    const erste = await gameserver.registriereHost(token);
    const zweite = await gameserver.registriereHost(token);

    expect(erste.ok).toBe(true);
    expect(zweite.ok).toBe(false);
  });

  it('lässt zwei gleichzeitige Anläufe nur einen gewinnen', async () => {
    const host = await baueHost({ registeredAt: null });
    const { token } = await gameserver.oeffneRegistrierung(host.id, AKTEUR);

    const [a, b] = await Promise.all([gameserver.registriereHost(token), gameserver.registriereHost(token)]);

    expect([a.ok, b.ok].filter(Boolean), 'Genau einer darf durchkommen').toHaveLength(1);
  });

  it('weist ein abgelaufenes Token ab', async () => {
    const host = await baueHost({ registeredAt: null });
    const { token } = await gameserver.oeffneRegistrierung(
      host.id,
      AKTEUR,
      60,
      new Date('2026-01-01T00:00:00Z'),
    );

    const ergebnis = await gameserver.registriereHost(token, {}, new Date('2026-06-01T00:00:00Z'));
    expect(ergebnis.ok).toBe(false);
  });

  it('weist ein erfundenes Token ab - mit derselben Meldung wie bei jedem anderen Fehler', async () => {
    /*
     * Drei unterschiedliche Antworten wären drei Auskünfte an jemanden,
     * der rät: gab es das Token, ist es abgelaufen, war es schon benutzt?
     */
    const ohneToken = await gameserver.registriereHost('erfunden-aber-lang-genug-1234');
    const zuKurz = await gameserver.registriereHost('kurz');

    expect(ohneToken.ok).toBe(false);
    expect(zuKurz.ok).toBe(false);
    if (ohneToken.ok || zuKurz.ok) {
      return;
    }
    expect(ohneToken.grund).toBe(zuKurz.grund);
  });

  it('leitet die Gesundheit aus dem letzten Lebenszeichen ab', async () => {
    const jetzt = new Date('2026-09-28T12:00:00Z');
    const alt = new Date(jetzt.getTime() - 10 * 60_000);

    const faelle = [
      [{ registeredAt: null }, 'UNREGISTERED'],
      [{ status: 'DISABLED' as const }, 'DISABLED'],
      [{ status: 'MAINTENANCE' as const }, 'MAINTENANCE'],
      [{ lastHeartbeatAt: alt }, 'OFFLINE'],
      [{ lastHeartbeatAt: null }, 'OFFLINE'],
      [{ dockerAvailable: false }, 'DEGRADED'],
      [{ diskFreeMb: 100 }, 'DEGRADED'],
      [{}, 'HEALTHY'],
    ] as const;

    for (const [abweichung, erwartet] of faelle) {
      const host = await prisma.gameServerHost.findFirstOrThrow({
        where: { id: (await baueHost({ lastHeartbeatAt: jetzt, ...abweichung })).id },
      });
      expect(gameserver.hostGesundheit(host, jetzt).wert, JSON.stringify(abweichung)).toBe(erwartet);
      await prisma.gameServerHost.delete({ where: { id: host.id } });
    }
  });

  it('lässt einen Host nicht entfernen, auf dem noch etwas läuft', async () => {
    const host = await baueHost();
    await prisma.gameServerInstance.create({
      data: {
        hostId: host.id,
        name: `i-${Math.random().toString(36).slice(2, 8)}`,
        game: 'CS2',
        status: 'LIVE',
      },
    });

    await expect(gameserver.loescheHost(host.id, AKTEUR)).rejects.toThrow();
    expect(await prisma.gameServerHost.count({ where: { id: host.id } })).toBe(1);
  });
});

describeWithDatabase('Der Port-Allocator', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.hostPortReservation.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.gameServerHost.deleteMany();
  });

  async function instanz(host: { id: string }, name: string) {
    return prisma.gameServerInstance.create({
      data: { hostId: host.id, name, game: 'CS2', status: 'RESERVED' },
    });
  }

  it('reserviert Ports aus den Bereichen des Hosts', async () => {
    const host = await baueHost();
    const eine = await instanz(host, 'a');

    const ports = await gameserver.reservierePorts(host.id, eine.id, host, { query: true, tv: true });

    expect(ports.game).toBeGreaterThanOrEqual(host.gamePortFrom);
    expect(ports.game).toBeLessThanOrEqual(host.gamePortTo);
    expect(ports.query).toBeGreaterThanOrEqual(host.queryPortFrom);
    expect(ports.tv).toBeGreaterThanOrEqual(host.tvPortFrom);

    expect(await prisma.hostPortReservation.count({ where: { instanceId: eine.id } })).toBe(3);
  });

  it('gibt keinen Port zweimal aus - auch nicht bei zwanzig gleichzeitigen Anläufen', async () => {
    /*
     * Der eigentliche Test. Zwanzig Anläufe auf einen Bereich mit genau
     * zwanzig Ports: jeder muss einen anderen bekommen, und keiner darf
     * leer ausgehen.
     */
    const host = await baueHost({ gamePortFrom: 30_000, gamePortTo: 30_019 });
    const instanzen = await Promise.all(
      Array.from({ length: 20 }, (_, i) => instanz(host, `parallel-${String(i)}`)),
    );

    const ports = await Promise.all(
      instanzen.map((eintrag) =>
        gameserver.reservierePorts(host.id, eintrag.id, host, { query: false, tv: false }),
      ),
    );

    const vergeben = ports.map((eintrag) => eintrag.game);
    expect(new Set(vergeben).size, 'Kein Port darf doppelt vergeben sein').toBe(20);
    expect(await prisma.hostPortReservation.count()).toBe(20);
  });

  it('meldet einen erschöpften Bereich, statt einen Port zu erfinden', async () => {
    const host = await baueHost({ gamePortFrom: 30_000, gamePortTo: 30_001 });
    const [a, b, c] = await Promise.all([instanz(host, 'a'), instanz(host, 'b'), instanz(host, 'c')]);

    await gameserver.reservierePorts(host.id, a.id, host, { query: false, tv: false });
    await gameserver.reservierePorts(host.id, b.id, host, { query: false, tv: false });

    await expect(
      gameserver.reservierePorts(host.id, c.id, host, { query: false, tv: false }),
      // Die Meldung an den Benutzer trägt den Umlaut, die interne nicht -
      // geprüft wird der gemeinsame Kern.
    ).rejects.toThrow(/ersch/u);
  });

  it('gibt einen halb reservierten Satz vollständig zurück', async () => {
    /*
     * Ein Container mit Spielport, aber ohne GOTV-Port wäre eine halbe
     * Instanz - und halbe Instanzen sind schlimmer als keine. Der GOTV-
     * Bereich ist hier erschöpft; der Spielport muss trotzdem frei werden.
     */
    const host = await baueHost({ tvPortFrom: 31_000, tvPortTo: 31_000 });
    const [a, b] = await Promise.all([instanz(host, 'a'), instanz(host, 'b')]);

    await gameserver.reservierePorts(host.id, a.id, host, { query: false, tv: true });

    await expect(
      gameserver.reservierePorts(host.id, b.id, host, { query: false, tv: true }),
    ).rejects.toThrow();

    expect(
      await prisma.hostPortReservation.count({ where: { instanceId: b.id } }),
      'Nichts darf zurückbleiben',
    ).toBe(0);
  });

  it('gibt Ports frei und lässt sie danach wieder vergeben', async () => {
    const host = await baueHost({ gamePortFrom: 30_000, gamePortTo: 30_000 });
    const [a, b] = await Promise.all([instanz(host, 'a'), instanz(host, 'b')]);

    await gameserver.reservierePorts(host.id, a.id, host, { query: false, tv: false });
    expect(await gameserver.gibPortsFrei(a.id)).toBe(1);

    const zweite = await gameserver.reservierePorts(host.id, b.id, host, { query: false, tv: false });
    expect(zweite.game).toBe(30_000);
  });

  it('übersteht einen Neustart, weil die Reservierung in der Datenbank steht', async () => {
    /*
     * Eine Vergabe im Arbeitsspeicher wäre nach einem Deployment leer - die
     * Container aber nicht. Der nächste Start kollidierte mit einem
     * laufenden Match.
     */
    const host = await baueHost({ gamePortFrom: 30_000, gamePortTo: 30_001 });
    const [a, b] = await Promise.all([instanz(host, 'a'), instanz(host, 'b')]);

    const erste = await gameserver.reservierePorts(host.id, a.id, host, { query: false, tv: false });

    // «Neustart»: nichts im Speicher, alles in der Datenbank.
    const zweite = await gameserver.reservierePorts(host.id, b.id, host, { query: false, tv: false });

    expect(zweite.game).not.toBe(erste.game);
  });

  it('räumt eine Reservierung ohne Besitzer erst nach einer Schonfrist weg', async () => {
    const host = await baueHost();
    await prisma.hostPortReservation.create({
      data: { hostId: host.id, port: 30_500, kind: 'GAME', createdAt: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.hostPortReservation.create({ data: { hostId: host.id, port: 30_501, kind: 'GAME' } });

    const entfernt = await gameserver.raeumeVerwaisteReservierungen(new Date('2026-06-01T00:00:00Z'));

    expect(entfernt, 'Nur die alte - die frische gehört vermutlich einem laufenden Vorgang').toBe(1);
  });
});

describeWithDatabase('Der Host-Scheduler', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.hostPortReservation.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.gameServerHost.deleteMany();
    await prisma.hostGroup.deleteMany();
  });

  it('nimmt einen gesunden, aktiven Host mit genug Luft', async () => {
    await baueHost();
    const { kandidaten, abgelehnt } = await gameserver.waehleHosts(ANFORDERUNG);

    expect(kandidaten).toHaveLength(1);
    expect(abgelehnt).toHaveLength(0);
  });

  it('nennt für jeden abgelehnten Host einen Grund im Klartext', async () => {
    /*
     * Eine Oberfläche, die «kein Host verfügbar» sagt, ohne zu sagen warum,
     * erzeugt genau einen Support-Fall je Vorkommnis.
     */
    await baueHost({ status: 'DRAINING' });
    await baueHost({ status: 'MAINTENANCE' });
    await baueHost({ allowedGames: [] });
    await baueHost({ registeredAt: null });

    const { kandidaten, abgelehnt } = await gameserver.waehleHosts(ANFORDERUNG);

    expect(kandidaten).toHaveLength(0);
    expect(abgelehnt).toHaveLength(4);
    for (const absage of abgelehnt) {
      expect(absage.grund.length, absage.hostName).toBeGreaterThan(10);
    }
  });

  it('lehnt einen Host ab, dessen Ressourcen nicht reichen', async () => {
    await baueHost({ cpuCores: 2, reservedCpuCores: 1 });
    const { kandidaten, abgelehnt } = await gameserver.waehleHosts({ ...ANFORDERUNG, cpu: 8 });

    expect(kandidaten).toHaveLength(0);
    expect(abgelehnt[0]?.grund).toMatch(/Kerne/u);
  });

  it('bevorzugt die gewünschte Hostgruppe, wartet aber nicht auf sie', async () => {
    const gruppe = await prisma.hostGroup.create({ data: { name: 'Schweiz', region: 'zrh' } });
    const bevorzugt = await baueHost({ groupId: gruppe.id });
    await baueHost();

    const { kandidaten } = await gameserver.waehleHosts({
      ...ANFORDERUNG,
      bevorzugteGruppeId: gruppe.id,
    });

    expect(kandidaten[0]?.host.id, 'Der Host aus der Gruppe zuerst').toBe(bevorzugt.id);
    expect(kandidaten, 'Der andere bleibt trotzdem ein Kandidat').toHaveLength(2);
  });

  it('nimmt bei einem erzwungenen Host nur diesen in Betracht - und prüft ihn trotzdem', async () => {
    const erzwungen = await baueHost({ status: 'MAINTENANCE' });
    await baueHost();

    const { kandidaten, abgelehnt } = await gameserver.waehleHosts({
      ...ANFORDERUNG,
      erzwungenerHostId: erzwungen.id,
    });

    expect(kandidaten).toHaveLength(0);
    expect(abgelehnt).toHaveLength(1);
    expect(abgelehnt[0]?.hostId).toBe(erzwungen.id);
  });

  it('lässt nicht mehr Instanzen zu, als der Host tragen darf - auch nicht gleichzeitig', async () => {
    /*
     * **Der Kern der Reservierung.** Acht gleichzeitige Anläufe auf einen
     * Host mit vier Plätzen: genau vier dürfen durchkommen. Ohne
     * Zeilensperre sähen alle acht dieselben «noch vier Plätze frei».
     */
    const host = await baueHost({ maxInstances: 4, maxParallelStarts: 99 });

    const ergebnisse = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        gameserver.reserviereAufHost(host.id, ANFORDERUNG, entwurf(`parallel-${String(i)}`)),
      ),
    );

    expect(ergebnisse.filter((eintrag) => eintrag.ok)).toHaveLength(4);
    expect(await prisma.gameServerInstance.count({ where: { hostId: host.id } })).toBe(4);
  });

  it('lässt nicht mehr CPU verplanen, als der Host nach Abzug der Reserve hat', async () => {
    /*
     * 16 Kerne, 1 reserviert, je Instanz 4 -> drei Instanzen passen.
     *
     * `maxParallelStarts` muss hier hochgesetzt werden, sonst greift diese
     * Grenze zuerst und der Test prüfte etwas anderes, als er behauptet.
     */
    const host = await baueHost({
      cpuCores: 16,
      reservedCpuCores: 1,
      maxInstances: 99,
      maxParallelStarts: 99,
    });

    const ergebnisse = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        gameserver.reserviereAufHost(
          host.id,
          { ...ANFORDERUNG, cpu: 4 },
          { ...entwurf(`cpu-${String(i)}`), cpuLimit: 4 },
        ),
      ),
    );

    expect(ergebnisse.filter((eintrag) => eintrag.ok)).toHaveLength(3);
  });

  it('achtet auf die Zahl gleichzeitiger Starts', async () => {
    const host = await baueHost({ maxInstances: 99, maxParallelStarts: 2 });

    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        gameserver.reserviereAufHost(host.id, ANFORDERUNG, entwurf(`start-${String(i)}`)),
      ),
    );

    expect(ergebnisse.filter((eintrag) => eintrag.ok)).toHaveLength(2);
  });

  it('nimmt einen Host nicht mehr an, sobald er in Wartung geht', async () => {
    const host = await baueHost();
    await prisma.gameServerHost.update({ where: { id: host.id }, data: { status: 'MAINTENANCE' } });

    const ergebnis = await gameserver.reserviereAufHost(host.id, ANFORDERUNG, entwurf('nach-wartung'));
    expect(ergebnis.ok).toBe(false);
  });

  it('nimmt laufende Instanzen beim Leerlaufen nicht weg', async () => {
    /*
     * Wer einen Host in Wartung schickt, während darauf ein Halbfinale
     * läuft, will das Halbfinale zu Ende spielen lassen - nicht abbrechen.
     */
    const host = await baueHost();
    await prisma.gameServerInstance.create({
      data: { hostId: host.id, name: 'laeuft', game: 'CS2', status: 'LIVE' },
    });

    const ergebnis = await gameserver.setzeHostStatus(host.id, 'DRAINING', AKTEUR);

    expect(ergebnis.laufende).toBe(1);
    const instanz = await prisma.gameServerInstance.findFirstOrThrow({ where: { hostId: host.id } });
    expect(instanz.status).toBe('LIVE');
  });
});
