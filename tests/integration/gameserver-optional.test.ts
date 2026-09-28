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
    await prisma.gameProfile.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
  });

  it('ermittelt den Stand, ohne zu werfen', async () => {
    const stand = await gameserver.konfigurationsStand();

    expect(stand.ermittelt).toBe(true);
    expect(stand.bereit).toBe(false);
    expect(stand.luecken).toContain('KEIN_ANBIETER');
    expect(stand.luecken).toContain('KEIN_TEMPLATE');
    expect(stand.luecken).toContain('KEIN_PROFIL');
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

    expect(ergebnis).toEqual({ angestossen: 0, fortgeschritten: 0, abgelaufen: 0, geloescht: 0 });
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
    await prisma.gameProfile.deleteMany();
    await prisma.gameServerTemplate.deleteMany();
    await prisma.gameServerProvider.deleteMany();
  });

  it('meldet einen Anbieter ohne Treiber als Lücke - nicht als Absturz', async () => {
    /*
     * Genau der Fall, der nach dem Einrichten eintritt: jemand trägt den
     * Anbieter ein, für den es den Treiber noch nicht gibt. Das ist eine
     * Auskunft, kein Fehler - und es darf weder die Seite noch den
     * Durchgang mitnehmen.
     */
    await prisma.gameServerProvider.create({
      data: { name: 'Noch kein Treiber', driver: 'gibt-es-nicht', enabled: true },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.ermittelt).toBe(true);
    expect(stand.bereit).toBe(false);
    expect(stand.luecken).toContain('TREIBER_FEHLT');

    // Und der Durchgang läuft trotzdem durch.
    await expect(gameserver.runGameserverTick()).resolves.toBeDefined();
  });

  it('verlangt vom Simulationstreiber keine Zugangsdaten', async () => {
    /*
     * Er spricht kein Datacenter an. Von ihm Zugangsdaten zu verlangen
     * hiesse, beim Einrichten eine Hürde aufzubauen, die nichts absichert.
     */
    await prisma.gameServerProvider.create({
      data: { name: 'Sim', driver: 'simulation', enabled: true },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.nurSimulation).toBe(true);
    expect(stand.luecken).not.toContain('KEINE_ZUGANGSDATEN');
  });

  it('verlangt von einem echten Anbieter Zugangsdaten', async () => {
    /*
     * Die Gegenprobe. Der Simulationstreiber ist die Ausnahme, nicht die
     * Regel - ein echter Anbieter ohne Zugangsdaten ist eine offene Lücke.
     *
     * Geprüft wird über den Simulationstreiber unter einem anderen Namen:
     * es geht um die Unterscheidung «Simulation oder nicht», und einen
     * zweiten Treiber gibt es (bewusst) noch nicht.
     */
    await prisma.gameServerProvider.create({
      data: { name: 'Echtes Datacenter', driver: 'gibt-es-nicht', enabled: true },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.nurSimulation).toBe(false);
    expect(stand.luecken).toContain('KEINE_ZUGANGSDATEN');
  });

  it('zählt einen ausgeschalteten Anbieter nicht mit', async () => {
    await prisma.gameServerProvider.create({
      data: { name: 'Aus', driver: 'simulation', enabled: false },
    });

    const stand = await gameserver.konfigurationsStand();
    expect(stand.luecken).toContain('ANBIETER_AUS');
    expect(stand.luecken).not.toContain('KEIN_ANBIETER');
  });
});
