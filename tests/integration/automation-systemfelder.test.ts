import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_sysfelder');

/**
 * Die freigegebenen Felder einer Systemautomation.
 *
 * ## Woran diese Datei hängt
 *
 * Die Systemeinladung entsteht beim Start mit leerer Rollenliste - welche
 * Rollen eine Einladung verschicken dürfen, weiss nur der Server. Vorher gab
 * es keinen Weg, sie einzutragen: `aendere` lehnte jede Änderung an einer
 * Systemautomation ab. Die Automation war da, abschaltbar, einschaltbar - und
 * konnte nichts tun, weil «keine Rolle freigegeben» heisst «niemand».
 *
 * Geprüft wird darum beides: dass die freigegebenen Felder ankommen **und**
 * dass daneben nichts aufgeht. Eine Tür, durch die versehentlich der ganze
 * Ablauf passt, wäre schlimmer als die geschlossene Tür vorher.
 */

const { prisma, AUDIT_ACTIONS } = await import('@swisshub/database');
const automation = await import('@swisshub/automation');
const { setModuleEnabled, automation: automationModul } = await import('@swisshub/modules');

const GILDE = '900000000000000800';
const ROLLE = '900000000000000801';
const ZWEITE_ROLLE = '900000000000000802';
const AKTEUR = { discordId: '100000000000000803', username: 'nina' };

async function einladung() {
  await automationModul.stelleSystemautomationenSicher(GILDE);
  return prisma.automation.findUniqueOrThrow({
    where: { systemKey: automationModul.SYSTEM_EINLADUNG_KEY },
  });
}

function rollenVon(eintrag: { triggerConfig: unknown }): unknown {
  return (eintrag.triggerConfig as { rollen?: unknown }).rollen;
}

describeWithDatabase('Freigegebene Felder einer Systemautomation', () => {
  beforeAll(async () => {
    pushSchema();
    await setModuleEnabled('automation', true, 'test');
  });

  beforeEach(async () => {
    await prisma.automationJob.deleteMany({});
    await prisma.automationVersion.deleteMany({});
    await prisma.automation.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  // --- Was durchgeht -------------------------------------------------------

  it('trägt die freigegebenen Rollen ein', async () => {
    const vorher = await einladung();
    expect(rollenVon(vorher)).toEqual([]);

    const nachher = await automation.aendereSystemfelder(
      GILDE,
      vorher.id,
      { 'triggerConfig.rollen': [ROLLE, ZWEITE_ROLLE] },
      AKTEUR,
    );

    expect(rollenVon(nachher)).toEqual([ROLLE, ZWEITE_ROLLE]);
    // Und damit ist die Automation aus Discord startbar - der eigentliche
    // Zweck der ganzen Übung.
    await prisma.automation.update({ where: { id: vorher.id }, data: { enabled: true } });
    const startbare = await automation.listeDiscordStartbare(GILDE, [ROLLE]);
    expect(startbare.map((eintrag) => eintrag.id)).toContain(vorher.id);
  });

  it('lässt den Hinweis aus der Vorlage stehen', async () => {
    const vorher = await einladung();
    const nachher = await automation.aendereSystemfelder(
      GILDE,
      vorher.id,
      { 'triggerConfig.rollen': [ROLLE] },
      AKTEUR,
    );

    /*
     * Gearbeitet wird auf einer Kopie des Gespeicherten. Käme die
     * Trigger-Konfiguration aus der Eingabe, wäre `hinweis` jetzt weg - und
     * niemand hätte es gemerkt, weil er nur in der Auswahlliste in Discord
     * auftaucht.
     */
    expect((nachher.triggerConfig as { hinweis?: unknown }).hinweis).toBe('WebApp-Einladung an eine Person');
  });

  it('zählt die Fassung hoch und hält sie fest', async () => {
    const vorher = await einladung();
    const nachher = await automation.aendereSystemfelder(
      GILDE,
      vorher.id,
      { 'triggerConfig.rollen': [ROLLE] },
      AKTEUR,
    );

    expect(nachher.version).toBe(vorher.version + 1);
    // Ein laufender Lauf zeigt auf eine Fassung. Ohne diese Zeile würde er
    // nach dem Aufwachen mit einer anderen Freigabe weiterarbeiten.
    const fassung = await prisma.automationVersion.findUniqueOrThrow({
      where: { automationId_version: { automationId: vorher.id, version: nachher.version } },
    });
    expect((fassung.snapshot as { triggerConfig?: { rollen?: unknown } }).triggerConfig?.rollen).toEqual([
      ROLLE,
    ]);
  });

  it('schreibt in die Prüfspur, wer welche Felder gefüllt hat', async () => {
    const vorher = await einladung();
    await automation.aendereSystemfelder(GILDE, vorher.id, { 'triggerConfig.rollen': [ROLLE] }, AKTEUR);

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.AUTOMATION_UPDATED },
    });
    expect(eintrag.actorDiscordId).toBe(AKTEUR.discordId);
    expect((eintrag.metadata as { pfade?: unknown }).pfade).toEqual(['triggerConfig.rollen']);
  });

  it('übersteht den nächsten Start', async () => {
    const vorher = await einladung();
    await automation.aendereSystemfelder(GILDE, vorher.id, { 'triggerConfig.rollen': [ROLLE] }, AKTEUR);

    /*
     * Die wichtigste Zusage dieses Blocks. Der Abgleich beim Start schreibt
     * Name, Bedingungen und Schritte zurück - fasste er auch die
     * Trigger-Konfiguration an, wäre die eingetragene Rolle nach jedem
     * Deployment weg. Dann hätte das Ausfüllen keinen Wert.
     */
    await automationModul.stelleSystemautomationenSicher(GILDE);

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } });
    expect(rollenVon(nachher)).toEqual([ROLLE]);
  });

  // --- Was nicht durchgeht -------------------------------------------------

  it('lehnt ein Feld ab, das die Vorlage nicht freigibt', async () => {
    const vorher = await einladung();

    // `hinweis` steht in der Konfiguration, aber nicht in `auszufuellen`. Er
    // gehört zur Vorlage, nicht zum Server.
    await expect(
      automation.aendereSystemfelder(GILDE, vorher.id, { 'triggerConfig.hinweis': 'frei erfunden' }, AKTEUR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } });
    expect((nachher.triggerConfig as { hinweis?: unknown }).hinweis).toBe('WebApp-Einladung an eine Person');
    expect(nachher.version).toBe(vorher.version);
  });

  it('lehnt eine ungültige Rollenkennung ab', async () => {
    const vorher = await einladung();

    // Das Schema des Triggers verlangt Discord-Kennungen. Ein freigegebenes
    // Feld ist kein Freibrief für beliebigen Inhalt.
    await expect(
      automation.aendereSystemfelder(GILDE, vorher.id, { 'triggerConfig.rollen': ['nein'] }, AKTEUR),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } });
    expect(rollenVon(nachher)).toEqual([]);
  });

  it('lehnt eine leere Eingabe ab, statt eine Fassung für nichts zu schreiben', async () => {
    const vorher = await einladung();
    await expect(automation.aendereSystemfelder(GILDE, vorher.id, {}, AKTEUR)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await prisma.automationVersion.count({ where: { automationId: vorher.id } })).toBe(1);
  });

  it('lässt den allgemeinen Editor weiterhin nicht an eine Systemautomation', async () => {
    const vorher = await einladung();

    /*
     * Die Gegenprobe zur neuen Tür: `aendere` schickt eine ganze Automation.
     * Ginge sie durch, liesse sich der Ablauf umstellen - und der nächste
     * Start schriebe ihn zurück, ohne dass es jemandem auffällt.
     */
    await expect(
      automation.aendere(
        GILDE,
        vorher.id,
        {
          guildId: GILDE,
          name: 'Umbenannt',
          triggerType: 'discord',
          triggerConfig: { rollen: [ROLLE] },
          conditions: null,
          steps: [],
        },
        AKTEUR,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } });
    expect(nachher.name).not.toBe('Umbenannt');
    expect(nachher.steps).not.toEqual([]);
  });

  it('lässt eine Systemautomation weiterhin nicht löschen', async () => {
    const vorher = await einladung();
    await expect(automation.archiviere(GILDE, vorher.id, AKTEUR)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } })).archivedAt).toBeNull();
  });

  it('nimmt eine gewöhnliche Automation nicht durch diese Tür', async () => {
    const vorlage = automation.getTemplate('system-einladung');
    const gewoehnlich = await automation.legeAn(
      {
        guildId: GILDE,
        name: 'Von Hand gebaut',
        triggerType: 'discord',
        triggerConfig: { rollen: [] },
        conditions: null,
        steps: vorlage!.steps,
      },
      AKTEUR,
    );

    await expect(
      automation.aendereSystemfelder(GILDE, gewoehnlich.id, { 'triggerConfig.rollen': [ROLLE] }, AKTEUR),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('gibt keinen Pfad frei, der den Ablauf austauschen würde', async () => {
    /*
     * Dieser Test steht absichtlich am Ende: er meldet eine zusätzliche
     * Systemvorlage an, und die bleibt für den Rest der Datei angemeldet.
     *
     * Er prüft die Grenze, die **nicht** in der Vorlage steht. Stünde dort
     * eines Tages `steps.0.typ`, liesse sich die Aktion austauschen - aus
     * einer Direktnachricht würde ein Rollenentzug. Der Speicher lässt
     * deshalb nur Werte durch: etwas in der Trigger-Konfiguration oder im
     * `config` eines Schritts. Die Vorlage allein entscheidet das nicht.
     */
    const vorlage = automation.getTemplate('system-einladung');
    automation.registerTemplate({
      ...vorlage!,
      id: 'test-abwegig',
      systemKey: 'test_abwegig',
      auszufuellen: [{ pfad: 'steps.0.typ', label: 'Aktion' }],
    });

    const eintrag = await automation.stelleSystemautomationSicher({
      guildId: GILDE,
      systemKey: 'test_abwegig',
      name: 'Abwegig',
      triggerType: 'discord',
      triggerConfig: { rollen: [] },
      conditions: vorlage!.conditions ?? null,
      steps: vorlage!.steps,
    });

    await expect(
      automation.aendereSystemfelder(GILDE, eintrag.id, { 'steps.0.typ': 'rolle.entfernen' }, AKTEUR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: eintrag.id } });
    expect((nachher.steps as Array<{ typ: string }>)[0]?.typ).toBe('nachricht.direkt');
  });
});
