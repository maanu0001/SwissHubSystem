import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_durchgang');

/**
 * Warum «Neu erheben» nichts erhob.
 *
 * ## Der gemeldete Fehler
 *
 * Ein Klick auf «Momentaufnahmen erzeugen» antwortete mit Erfolg, und danach
 * geschah nichts. Kein Fortschritt, keine Fehlermeldung, kein Ende - auch
 * nach Tagen nicht.
 *
 * ## Die Ursache, in zwei Teilen
 *
 * `WrappedRunStatus.FAILED` stand von Anfang an im Schema und wurde auch
 * gelesen. **Geschrieben hat es nie jemand.** Ein Durchgang, der ausserhalb
 * der einzelnen Momentaufnahme scheiterte - verschwundene Kampagne,
 * unlesbarer Zeitraum, abgestuerzter Bot -, blieb deshalb auf `RUNNING`
 * stehen. Daraus folgten zwei Dinge:
 *
 * 1. **`starteDurchgang` gab ihn zurueck.** Die Regel «laeuft schon einer,
 *    dann keinen zweiten» ist richtig, sie hielt einen toten Lauf aber fuer
 *    lebendig. Jeder weitere Klick bekam denselben toten Lauf - mitsamt
 *    Erfolgsmeldung.
 * 2. **Er blockierte alle anderen.** Der Takt nimmt sich immer den aeltesten
 *    offenen Lauf. Steht vorne einer, der nie fertig wird, kommt kein
 *    spaeterer je an die Reihe - auch nicht der einer ganz anderen Kampagne.
 *
 * Diese Datei haelt beide Teile fest.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const TEAM = { discordId: '900000000000000001', username: 'team' };

async function leeren(): Promise<void> {
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsMemberProfile.deleteMany({});
  await prisma.wrappedSnapshot.deleteMany({});
  await prisma.wrappedScene.deleteMany({});
  await prisma.wrappedGenerationRun.deleteMany({});
  await prisma.wrappedCampaign.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.moduleState.deleteMany({});
}

/**
 * Genug Mitglieder fuer mehr als einen Stapel.
 *
 * Die kleinste erlaubte Stapelgroesse ist zehn. Fuenfzehn Kandidaten ergeben
 * damit zwei Stapel - und nur ueber zwei Stapel laesst sich pruefen, ob das
 * Lebenszeichen mitwandert.
 */
const MITGLIEDER = Array.from({ length: 15 }, (_, index) => `10000000000000${String(index + 10)}`);

async function aktiveMitglieder(): Promise<void> {
  await prisma.analyticsMemberProfile.createMany({
    data: MITGLIEDER.map((discordId, index) => ({
      guildId: GUILD,
      discordId,
      username: `m${index}`,
      displayName: `Mitglied ${index}`,
      isBot: false,
    })),
  });
  await prisma.analyticsUserDaily.createMany({
    data: MITGLIEDER.flatMap((discordId) =>
      Array.from({ length: 60 }, (_, index) => ({
        guildId: GUILD,
        discordId,
        day: new Date(Date.UTC(2026, 0, 1 + index * 2)),
        messages: 20,
        voiceSeconds: 3600,
        voiceSessions: 1,
      })),
    ),
  });
}

/** Stapelgroesse auf das Minimum - sonst passt alles in einen Zug. */
async function kleineStapel(): Promise<void> {
  await prisma.moduleState.upsert({
    where: { moduleId: wrapped.WRAPPED_MODULE_ID },
    create: { moduleId: wrapped.WRAPPED_MODULE_ID, enabled: true, settings: { batchSize: 10 } },
    update: { settings: { batchSize: 10 } },
  });
}

async function kampagne(key: string): Promise<string> {
  const campaign = await wrapped.erstelleKampagne(GUILD, TEAM, {
    key,
    title: `SwissHub Wrapped ${key}`,
    displayYear: 2026,
    periodStart: new Date(Date.UTC(2026, 0, 1)),
    periodEnd: new Date(Date.UTC(2027, 0, 1)),
  });
  return campaign.id;
}

/** Einen Lauf so zurechtstellen, wie ihn ein abgestuerzter Bot hinterlaesst. */
async function alsVerwaistHinstellen(runId: string, minuten: number): Promise<void> {
  const alt = new Date(Date.now() - minuten * 60_000);
  await prisma.wrappedGenerationRun.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: alt, heartbeatAt: alt },
  });
}

describeWithDatabase('Wrapped: haengende Durchgaenge', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await aktiveMitglieder();
  });

  it('haelt einen frisch laufenden Durchgang fuer lebendig', async () => {
    const id = await kampagne('2026');
    const erster = await wrapped.starteDurchgang(id, TEAM);
    await prisma.wrappedGenerationRun.update({
      where: { id: erster.id },
      data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date() },
    });

    const zweiter = await wrapped.starteDurchgang(id, TEAM);
    expect(zweiter.id).toBe(erster.id);
    expect(await prisma.wrappedGenerationRun.count({ where: { campaignId: id } })).toBe(1);
  });

  it('schliesst einen verwaisten Durchgang und beginnt neu', async () => {
    const id = await kampagne('2026');
    const erster = await wrapped.starteDurchgang(id, TEAM);
    await alsVerwaistHinstellen(erster.id, 30);

    const zweiter = await wrapped.starteDurchgang(id, TEAM);
    expect(zweiter.id).not.toBe(erster.id);

    const alt = await prisma.wrappedGenerationRun.findUnique({ where: { id: erster.id } });
    expect(alt?.status).toBe('FAILED');
    expect(alt?.failureReason).toBeTruthy();
    expect(zweiter.status).toBe('QUEUED');
  });

  it('erkennt einen Lauf ohne jedes Lebenszeichen als verwaist', async () => {
    const id = await kampagne('2026');
    const lauf = await wrapped.starteDurchgang(id, TEAM);
    await prisma.wrappedGenerationRun.update({
      where: { id: lauf.id },
      data: { status: 'RUNNING', startedAt: null, heartbeatAt: null },
    });
    const gelesen = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(wrapped.istVerwaist(gelesen)).toBe(true);
  });

  it('haelt einen wartenden Durchgang nie fuer verwaist', async () => {
    const id = await kampagne('2026');
    const lauf = await wrapped.starteDurchgang(id, TEAM);
    // Eine Stunde alt und immer noch QUEUED: der Bot war lange weg, den Lauf
    // holt er trotzdem noch. Ihn fuer tot zu erklaeren hiesse, eine Bestellung
    // wegzuwerfen, an der nichts kaputt ist.
    await prisma.wrappedGenerationRun.update({
      where: { id: lauf.id },
      data: { createdAt: new Date(Date.now() - 3600_000) },
    });
    const gelesen = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(wrapped.istVerwaist(gelesen)).toBe(false);
  });

  it('laesst einen haengenden Lauf nicht alle anderen blockieren', async () => {
    const alte = await kampagne('2025');
    const haengt = await wrapped.starteDurchgang(alte, TEAM);
    await alsVerwaistHinstellen(haengt.id, 45);

    // Eine zweite, gesunde Kampagne - ihr Lauf entsteht spaeter und stuende
    // damit hinter dem haengenden.
    const neue = await kampagne('2026');
    const gesund = await wrapped.starteDurchgang(neue, TEAM);

    const ergebnis = await wrapped.runWrappedTick();

    expect(ergebnis.stapel).toBeGreaterThan(0);
    const geraeumt = await prisma.wrappedGenerationRun.findUnique({ where: { id: haengt.id } });
    expect(geraeumt?.status).toBe('FAILED');
    const gearbeitet = await prisma.wrappedGenerationRun.findUnique({ where: { id: gesund.id } });
    expect(gearbeitet?.status === 'RUNNING' || gearbeitet?.status === 'COMPLETED').toBe(true);
    expect(gearbeitet?.heartbeatAt).not.toBeNull();
  });

  it('schreibt bei jedem Stapel ein Lebenszeichen', async () => {
    /*
     * Nicht nur «irgendwann einmal gesetzt», sondern **bei jedem Stapel neu**.
     *
     * Der Unterschied entscheidet ueber lange Durchgaenge: sechstausend
     * Momentaufnahmen dauern laenger als die zehn Minuten, nach denen ein Lauf
     * als verwaist gilt. Stuende das Lebenszeichen nur am Anfang, erklaerte
     * der Takt einen gesunden Durchgang mitten in der Arbeit fuer tot - und
     * das waere schlimmer als der Fehler, den es behebt.
     */
    await kleineStapel();
    const id = await kampagne('2026');
    const lauf = await wrapped.starteDurchgang(id, TEAM);
    expect(lauf.heartbeatAt).toBeNull();

    await wrapped.verarbeiteStapel(lauf.id);
    const nachErstem = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(nachErstem.heartbeatAt).not.toBeNull();

    // Auf alt stellen und noch einen Stapel laufen lassen: wandert das
    // Lebenszeichen mit, wird es je Stapel geschrieben und nicht nur beim
    // Wechsel auf RUNNING.
    const alt = new Date(Date.now() - 30 * 60_000);
    await prisma.wrappedGenerationRun.update({ where: { id: lauf.id }, data: { heartbeatAt: alt } });
    await wrapped.verarbeiteStapel(lauf.id);
    const nachZweitem = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(nachZweitem.heartbeatAt!.getTime()).toBeGreaterThan(alt.getTime());
  });

  it('raeumt mehrere haengende Laeufe hintereinander weg', async () => {
    /*
     * Zwei Leichen vor der Tuer.
     *
     * Der Takt nimmt den aeltesten offenen Lauf. Raeumte er je Durchgang nur
     * einen weg, braeuchte es bei drei haengenden Laeufen drei Minuten, bis
     * der gesunde drankommt - und bei dreissig eine halbe Stunde. Er raeumt
     * deshalb weiter, bis er einen lebendigen findet.
     */
    const a = await kampagne('2023');
    const laufA = await wrapped.starteDurchgang(a, TEAM);
    await alsVerwaistHinstellen(laufA.id, 60);

    const b = await kampagne('2024');
    const laufB = await wrapped.starteDurchgang(b, TEAM);
    await alsVerwaistHinstellen(laufB.id, 50);

    const c = await kampagne('2026');
    const gesund = await wrapped.starteDurchgang(c, TEAM);

    const ergebnis = await wrapped.runWrappedTick();

    expect(ergebnis.stapel).toBeGreaterThan(0);
    for (const id of [laufA.id, laufB.id]) {
      const zeile = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id } });
      expect(zeile.status).toBe('FAILED');
    }
    const gearbeitet = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: gesund.id } });
    expect(gearbeitet.status === 'RUNNING' || gearbeitet.status === 'COMPLETED').toBe(true);
  });

  it('haelt den Takt an, wenn gar nichts offen ist', async () => {
    const ergebnis = await wrapped.runWrappedTick();
    expect(ergebnis).toMatchObject({ stapel: 0, verarbeitet: 0, fertig: true });
  });

  it('erhebt nach einem gescheiterten Lauf wieder normal', async () => {
    const id = await kampagne('2026');
    const erster = await wrapped.starteDurchgang(id, TEAM);
    await wrapped.markiereGescheitert(erster.id, 'Testfall');

    const zweiter = await wrapped.starteDurchgang(id, TEAM);
    expect(zweiter.id).not.toBe(erster.id);

    let weiter = true;
    while (weiter) {
      weiter = (await wrapped.verarbeiteStapel(zweiter.id)).weiter;
    }
    const fertig = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: zweiter.id } });
    expect(fertig.status).toBe('COMPLETED');
    expect(await prisma.wrappedSnapshot.count({ where: { campaignId: id } })).toBeGreaterThan(0);
  });

  it('macht aus einem abgeschlossenen Lauf keinen gescheiterten', async () => {
    const id = await kampagne('2026');
    const lauf = await wrapped.starteDurchgang(id, TEAM);
    let weiter = true;
    while (weiter) {
      weiter = (await wrapped.verarbeiteStapel(lauf.id)).weiter;
    }

    expect(await wrapped.markiereGescheitert(lauf.id, 'zu spaet')).toBe(false);
    const nachher = await prisma.wrappedGenerationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(nachher.status).toBe('COMPLETED');
  });
});
