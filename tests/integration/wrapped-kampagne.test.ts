import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_kampagne');

/**
 * Der Lebenslauf einer Kampagne.
 *
 * ## Warum das geprüft wird
 *
 * Ein Jahresrückblick ist eine Aussage über ein abgeschlossenes Jahr. Sobald
 * er veröffentlicht ist, haben ihn Leute gesehen - und ab da darf sich die
 * Grundlage nicht mehr verschieben. Ein nachträglich geänderter Zeitraum
 * ergäbe einen Rückblick, dessen Zahlen nicht mehr zu seiner Beschriftung
 * passen, und niemand würde es merken.
 *
 * Geprüft wird deshalb vor allem, **was nicht mehr geht**.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const TEAM = { discordId: '900000000000000001', username: 'team' };

async function leeren(): Promise<void> {
  await prisma.analyticsVoiceSegment.deleteMany({});
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsMemberProfile.deleteMany({});
  await prisma.wrappedView.deleteMany({});
  await prisma.wrappedSnapshot.deleteMany({});
  await prisma.wrappedScene.deleteMany({});
  await prisma.wrappedGenerationRun.deleteMany({});
  await prisma.wrappedCampaign.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

async function aktiveAnna(): Promise<void> {
  await prisma.analyticsMemberProfile.create({
    data: { guildId: GUILD, discordId: ANNA, username: 'anna', displayName: 'Anna', isBot: false },
  });
  await prisma.analyticsUserDaily.createMany({
    data: Array.from({ length: 150 }, (_, index) => ({
      guildId: GUILD,
      discordId: ANNA,
      day: new Date(Date.UTC(2026, 0, 1 + index * 2)),
      messages: 20,
      voiceSeconds: 3600,
      voiceSessions: 1,
    })),
  });
  await prisma.analyticsVoiceSegment.createMany({
    data: Array.from({ length: 30 }, (_, index) => {
      const von = new Date(Date.UTC(2026, 0, 3 + index * 6, 20, 0, 0));
      return {
        guildId: GUILD,
        sessionId: `anna-${index}`,
        discordId: ANNA,
        channelId: '400000000000000001',
        channelName: 'Gaming 1',
        joinedAt: von,
        leftAt: new Date(von.getTime() + 2 * 3600_000),
        seconds: 7200,
        isAfk: false,
        isBot: false,
      };
    }),
  });
}

async function neueKampagne(): Promise<string> {
  const campaign = await wrapped.erstelleKampagne(GUILD, TEAM, {
    key: '2026',
    title: 'SwissHub Wrapped 2026',
    displayYear: 2026,
    periodStart: new Date(Date.UTC(2026, 0, 1)),
    periodEnd: new Date(Date.UTC(2027, 0, 1)),
  });
  return campaign.id;
}

async function durchgangKomplett(campaignId: string): Promise<void> {
  await wrapped.starteDurchgang(campaignId, TEAM);
  let weiter = true;
  while (weiter) {
    const lauf = await prisma.wrappedGenerationRun.findFirst({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    weiter = (await wrapped.verarbeiteStapel(lauf!.id)).weiter;
  }
}

describeWithDatabase('Wrapped: Kampagne', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('legt die Szenen gleich mit an', async () => {
    const id = await neueKampagne();
    const szenen = await prisma.wrappedScene.findMany({ where: { campaignId: id } });
    expect(szenen).toHaveLength(wrapped.WRAPPED_SZENEN.length);
  });

  it('nimmt denselben Schlüssel kein zweites Mal', async () => {
    await neueKampagne();
    await expect(neueKampagne()).rejects.toThrow();
  });

  it('weist einen Zeitraum zurück, der rückwärts läuft', async () => {
    await expect(
      wrapped.erstelleKampagne(GUILD, TEAM, {
        key: 'verdreht',
        title: 'Verdreht',
        displayYear: 2026,
        periodStart: new Date(Date.UTC(2027, 0, 1)),
        periodEnd: new Date(Date.UTC(2026, 0, 1)),
      }),
    ).rejects.toThrow();
  });

  it('lässt sich ohne Momentaufnahmen nicht veröffentlichen', async () => {
    const id = await neueKampagne();
    const pruefung = await wrapped.pruefeFreigabe(id);
    expect(pruefung.bereit).toBe(false);
    expect(pruefung.blocker.join(' ')).toMatch(/Momentaufnahmen/u);
    await expect(wrapped.veroeffentliche(id, TEAM)).rejects.toThrow();
  });

  it('lässt sich ohne eingeschaltete Szene nicht veröffentlichen', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.setzeSzenen(
      id,
      TEAM,
      wrapped.WRAPPED_SZENEN.map((szene, position) => ({
        sceneKey: szene.key,
        enabled: false,
        position,
      })),
    );
    const pruefung = await wrapped.pruefeFreigabe(id);
    expect(pruefung.bereit).toBe(false);
    expect(pruefung.blocker.join(' ')).toMatch(/Szene/u);
  });

  it('friert Zeitraum und Schwellen ein, sobald veröffentlicht ist', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.veroeffentliche(id, TEAM);

    for (const aenderung of [
      { periodStart: new Date(Date.UTC(2025, 0, 1)) },
      { periodEnd: new Date(Date.UTC(2028, 0, 1)) },
      { displayYear: 2027 },
      { minActiveDays: 0 },
      { minMessages: 0 },
      { minVoiceMinutes: 0 },
    ]) {
      await expect(wrapped.aendereKampagne(id, TEAM, aenderung)).rejects.toThrow();
    }

    // Was den Zahlen nicht widerspricht, bleibt änderbar - ein Tippfehler
    // im Begrüssungssatz soll sich noch beheben lassen.
    await expect(wrapped.aendereKampagne(id, TEAM, { introText: 'Neu.' })).resolves.toBeTruthy();
  });

  it('lässt die Szenen einer veröffentlichten Kampagne nicht mehr umsortieren', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.veroeffentliche(id, TEAM);

    await expect(
      wrapped.setzeSzenen(id, TEAM, [{ sceneKey: 'intro', enabled: false, position: 0 }]),
    ).rejects.toThrow();
  });

  it('lässt die Momentaufnahmen einer veröffentlichten Kampagne nicht neu erzeugen', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.veroeffentliche(id, TEAM);

    await expect(wrapped.starteDurchgang(id, TEAM)).rejects.toThrow();
  });

  it('lässt die einmal geschriebene Momentaufnahme unberührt', async () => {
    /*
     * Der Kern der Zusage an das Mitglied: was im Rückblick steht, stand
     * dort schon, als er geschrieben wurde. Neue Aktivität nach dem
     * Veröffentlichen verändert daran nichts.
     */
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.veroeffentliche(id, TEAM);

    const vorher = await prisma.wrappedSnapshot.findUnique({
      where: { campaignId_discordId: { campaignId: id, discordId: ANNA } },
    });

    // Anna legt nach dem Veröffentlichen noch einmal kräftig zu.
    await prisma.analyticsUserDaily.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        guildId: GUILD,
        discordId: ANNA,
        day: new Date(Date.UTC(2026, 6, 2 + index * 3)),
        messages: 500,
        voiceSeconds: 20_000,
        voiceSessions: 3,
      })),
      skipDuplicates: true,
    });

    const nachher = await prisma.wrappedSnapshot.findUnique({
      where: { campaignId_discordId: { campaignId: id, discordId: ANNA } },
    });
    expect(nachher?.data).toEqual(vorher?.data);
    expect(nachher?.generatedAt).toEqual(vorher?.generatedAt);
  });

  it('legt auch einen aufgegebenen Entwurf ins Archiv', async () => {
    /*
     * Ohne diesen Weg bliebe ein verworfener Entwurf für immer in der
     * Liste stehen, und im nächsten Jahr suchte man den richtigen zwischen
     * drei falschen.
     */
    const id = await neueKampagne();
    await wrapped.archiviere(id, TEAM);
    expect((await prisma.wrappedCampaign.findUnique({ where: { id } }))?.status).toBe('ARCHIVED');
    // Zweimal archivieren ist ein Fehler und keine stille Wiederholung.
    await expect(wrapped.archiviere(id, TEAM)).rejects.toThrow();
  });

  it('archiviert nicht, während ein Durchgang läuft', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await wrapped.starteDurchgang(id, TEAM);
    await expect(wrapped.archiviere(id, TEAM)).rejects.toThrow();
  });

  it('macht das Zurückziehen und Archivieren nachvollziehbar', async () => {
    await aktiveAnna();
    const id = await neueKampagne();
    await durchgangKomplett(id);
    await wrapped.veroeffentliche(id, TEAM);
    expect((await wrapped.aktuelleVeroeffentlichung(GUILD))?.id).toBe(id);

    await wrapped.ziehZurueck(id, TEAM, 'Zahlen stimmen nicht');
    expect(await wrapped.aktuelleVeroeffentlichung(GUILD)).toBeNull();
    // Die Momentaufnahmen bleiben - zurückziehen ist kein Löschen.
    expect(await prisma.wrappedSnapshot.count({ where: { campaignId: id } })).toBeGreaterThan(0);

    await wrapped.archiviere(id, TEAM);
    const archiviert = await prisma.wrappedCampaign.findUnique({ where: { id } });
    expect(archiviert?.status).toBe('ARCHIVED');
    await expect(wrapped.veroeffentliche(id, TEAM)).rejects.toThrow();

    const eintraege = await prisma.auditLog.findMany({ where: { module: 'wrapped' } });
    expect(eintraege.length).toBeGreaterThanOrEqual(4);
  });
});
