import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_gameserver_optional');

/**
 * Die Gameserver-Erweiterung ist freiwillig.
 *
 * ## Worum es hier geht
 *
 * Die meisten Installationen werden nie einen Gameserver betreiben. Für sie
 * muss die Erweiterung eine einzige Eigenschaft haben, und zwar ohne
 * Ausnahme: **sie darf nichts umbringen.** Nicht die WebApp, nicht den Bot,
 * nicht den Zeitplaner, nicht eine Turnierseite, die es seit Monaten gibt.
 *
 * Diese Datei prüft das gegen eine Datenbank, in der **nichts** eingerichtet
 * ist: kein Anbieter, kein Template, kein Profil, keine Zugangsdaten.
 *
 * Ausdrücklich kein `MASTER_ENCRYPTION_KEY` in dieser Datei - auch das
 * gehört zum geprüften Zustand. Eine Installation ohne Hauptschlüssel darf
 * an einer Gameserver-Abfrage nicht scheitern.
 */
const { prisma } = await import('@swisshub/database');
const { gameserver, setModuleEnabled } = await import('@swisshub/modules');

describeWithDatabase('Ohne jede Konfiguration', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    /*
     * Das Turniermodul an, sonst nichts.
     *
     * Ein frisches Testschema hat es aus - dann meldet der Stand nur
     * `MODUL_AUS` und kommt gar nicht bis zu den Gameserver-Luecken. Dieser
     * Test will den Zustand danach: Modul laeuft, Gameserver nicht
     * eingerichtet.
     */
    await setModuleEnabled('tournaments', true, 'test');
    await prisma.matchVetoAction.deleteMany();
    await prisma.matchServerAssignment.deleteMany();
    await prisma.provisioningAttempt.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.hostPortReservation.deleteMany();
    await prisma.hostImageState.deleteMany();
    await prisma.serverHeartbeat.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameRuntimeImage.deleteMany();
    await prisma.gameServerHost.deleteMany();
    await prisma.hostGroup.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
  });

  it('ermittelt den Stand, ohne zu werfen', async () => {
    const stand = await gameserver.konfigurationsStand();

    expect(stand.ermittelt).toBe(true);
    expect(stand.bereit).toBe(false);
    expect(stand.luecken).toContain('KEIN_HOST');
    expect(stand.luecken).toContain('KEIN_ABBILD');
    expect(stand.luecken).toContain('KEIN_PROFIL');
    expect(stand.hosts).toBe(0);
    expect(stand.hostsBereit).toBe(0);
  });

  it('nennt jede Lücke im Klartext und sagt, wo man sie schliesst', async () => {
    /*
     * Wer eine Liste bekommt, richtet in einem Durchgang ein. Wer immer nur
     * den nächsten Mangel erfährt, braucht fünf Anläufe.
     */
    const stand = await gameserver.konfigurationsStand();
    for (const luecke of stand.luecken) {
      const eintrag = gameserver.LUECKEN_TEXT[luecke];
      expect(eintrag, luecke).toBeDefined();
      expect(eintrag.text, luecke).not.toBe('');
      expect(eintrag.wo, luecke).not.toBe('');
    }
  });

  it('lässt den Durchgang lautlos durchlaufen', async () => {
    /*
     * **Der wichtigste Test dieser Datei.**
     *
     * Der Durchgang läuft im Minutentakt auf jedem Server, auf dem SwissHub
     * läuft. Ohne Konfiguration muss er nichts tun und nichts melden - und
     * vor allem nicht werfen: ein Job, der jede Minute in einen Fehler
     * läuft, füllt in einer Nacht das Protokoll.
     */
    const ergebnis = await gameserver.runGameserverTick();

    expect(ergebnis).toEqual({
      hostsGefragt: 0,
      angestossen: 0,
      fortgeschritten: 0,
      abgelaufen: 0,
      unterbrochen: 0,
      geloescht: 0,
    });
    expect(await prisma.gameServerInstance.count()).toBe(0);
  });

  it('läuft auch dann durch, wenn das Turniermodul ganz aus ist', async () => {
    await setModuleEnabled('tournaments', false, 'test');
    const ergebnis = await gameserver.runGameserverTick();
    expect(ergebnis.angestossen).toBe(0);

    const stand = await gameserver.konfigurationsStand();
    expect(stand.luecken).toEqual(['MODUL_AUS']);

    await setModuleEnabled('tournaments', true, 'test');
  });

  it('meldet einen leeren Infrastrukturstand statt eines Fehlers', async () => {
    const stand = await gameserver.infrastrukturStand();

    expect(stand.laufend).toBe(0);
    expect(stand.inBereitstellung).toBe(0);
    expect(stand.fehlerhaft).toBe(0);
    // Ohne Messwerte `null` und nicht 0 - eine 0 sähe aus wie «sofort».
    expect(stand.durchschnittProvisioningSekunden).toBeNull();
  });

  it('gibt eine leere Serverliste zurück', async () => {
    expect(await gameserver.listeServer()).toEqual([]);
  });

  it('räumt nichts auf, wenn es nichts gibt', async () => {
    expect(await gameserver.raeumeAuf()).toEqual({ geloescht: 0, uebersprungen: 0 });
  });

  it('liefert Zugangsdaten als leer statt zu werfen', async () => {
    /*
     * Ohne hinterlegte Werte und ohne Hauptschlüssel. `ladeZugang` muss
     * eine leere Karte liefern - der Treiber sagt dann, was ihm fehlt, und
     * zwar an einer Stelle, an der die Meldung jemand liest.
     */
    const zugang = await gameserver.ladeZugang();
    expect(zugang.endpoint).toBe('');
    expect(zugang.secret).toBe('');
  });
});

describeWithDatabase('Mit halber Konfiguration', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    /*
     * Das Turniermodul an, sonst nichts.
     *
     * Ein frisches Testschema hat es aus - dann meldet der Stand nur
     * `MODUL_AUS` und kommt gar nicht bis zu den Gameserver-Luecken. Dieser
     * Test will den Zustand danach: Modul laeuft, Gameserver nicht
     * eingerichtet.
     */
    await setModuleEnabled('tournaments', true, 'test');
    await prisma.matchVetoAction.deleteMany();
    await prisma.matchServerAssignment.deleteMany();
    await prisma.provisioningAttempt.deleteMany();
    await prisma.gameServerInstance.deleteMany();
    await prisma.hostPortReservation.deleteMany();
    await prisma.hostImageState.deleteMany();
    await prisma.serverHeartbeat.deleteMany();
    await prisma.gameProfile.deleteMany();
    await prisma.gameRuntimeImage.deleteMany();
    await prisma.gameServerHost.deleteMany();
    await prisma.hostGroup.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
  });

  it('meldet einen Anbieter ohne Treiber nicht mehr als Lücke', async () => {
    /*
     * **Eine bewusste Änderung gegenüber dem VM-Modell.**
     *
     * Ein Anbieter ist seit den vorbereiteten Hosts keine Voraussetzung
     * mehr: er wird erst gebraucht, wenn SwissHub selbst Maschinen erzeugen
     * soll. Ein halb eingetragener Anbieter darf deshalb nicht dazu führen,
     * dass ein vollständig eingerichteter Host als «nicht bereit» gilt.
     */
    await prisma.gameServerProvider.create({
      data: { name: 'Noch kein Treiber', driver: 'gibt-es-nicht', enabled: true },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.ermittelt).toBe(true);
    expect(stand.luecken).not.toContain('TREIBER_FEHLT');
    expect(stand.luecken).not.toContain('KEINE_ZUGANGSDATEN');

    // Und der Durchgang läuft trotzdem durch.
    await expect(gameserver.runGameserverTick()).resolves.toBeDefined();
  });

  it('zählt einen Host, der sich nie gemeldet hat, nicht als bereit', async () => {
    /*
     * Ein Host, den jemand angelegt, aber nie registriert hat, ist ein
     * Eintrag in einer Tabelle - kein Server. Wer ihn mitzählte, liesse
     * Matches auf eine Maschine warten, die es vielleicht gar nicht gibt.
     */
    await prisma.gameServerHost.create({
      data: { name: 'Nie gemeldet', hostname: '192.0.2.10', allowedGames: ['CS2'] },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.hosts).toBe(1);
    expect(stand.hostsBereit).toBe(0);
    expect(stand.luecken).toContain('KEIN_HOST_BEREIT');
    expect(stand.luecken).not.toContain('KEIN_HOST');
  });

  it('zählt einen Host in Wartung nicht als bereit', async () => {
    await prisma.gameServerHost.create({
      data: {
        name: 'In Wartung',
        hostname: '192.0.2.11',
        allowedGames: ['CS2'],
        status: 'MAINTENANCE',
        registeredAt: new Date(),
        lastHeartbeatAt: new Date(),
        dockerAvailable: true,
      },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.hostsBereit).toBe(0);
    expect(stand.luecken).toContain('KEIN_HOST_BEREIT');
  });

  it('zählt einen Host, dessen Lebenszeichen alt ist, nicht als bereit', async () => {
    await prisma.gameServerHost.create({
      data: {
        name: 'Stumm',
        hostname: '192.0.2.12',
        allowedGames: ['CS2'],
        registeredAt: new Date('2026-01-01T00:00:00Z'),
        lastHeartbeatAt: new Date('2026-01-01T00:00:00Z'),
        dockerAvailable: true,
      },
    });

    const stand = await gameserver.konfigurationsStand(new Date('2026-06-01T00:00:00Z'));
    expect(stand.hostsBereit).toBe(0);
  });

  it('meldet ein Profil ohne Runtime-Image als eigene Lücke', async () => {
    /*
     * Ein Profil ohne Abbild sieht vollständig aus und ist es nicht: beim
     * ersten Match gäbe es nichts, woraus ein Container entstehen könnte.
     * Das soll beim Einrichten auffallen, nicht im Turnier.
     */
    await prisma.gameRuntimeImage.create({
      data: { name: 'CS2', game: 'CS2', image: 'ghcr.io/example/cs2', tag: 'x' },
    });
    await prisma.gameProfile.create({ data: { name: 'Ohne Abbild', game: 'CS2' } });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.luecken).toContain('PROFIL_OHNE_ABBILD');
    expect(stand.luecken).not.toContain('KEIN_PROFIL');
    expect(stand.luecken).not.toContain('KEIN_ABBILD');
  });

  it('bleibt auch mit einem Host ohne lesbare Identität lautlos', async () => {
    /*
     * Der Durchgang fragt jeden registrierten Host. Ohne Hauptschlüssel
     * lässt sich dessen Identität nicht entschlüsseln - und genau dann darf
     * er nicht werfen, sondern muss den Fehler in die Zeile schreiben.
     */
    await prisma.gameServerHost.create({
      data: {
        name: 'Ohne Schlüssel',
        hostname: '192.0.2.13',
        allowedGames: ['CS2'],
        registeredAt: new Date(),
        agentTokenEnc: 'unlesbar',
      },
    });

    await expect(gameserver.runGameserverTick()).resolves.toBeDefined();
  });
});
