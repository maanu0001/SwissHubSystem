import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_sysinvite');

/**
 * Die Systemeinladung gegen eine echte Datenbank.
 *
 * Drei Zusagen hängen hier an der Datenbank und lassen sich nur so prüfen:
 *
 * - «Hat ein SwissHub-Konto» liest die Kontentabelle.
 * - Die Abklingzeit liest die vergangenen Läufe - und zwar den **im Lauf
 *   festgehaltenen** Betroffenen. Genau dieses Feld fehlte vorher im
 *   gespeicherten Kontext; ohne es hätte die Bedingung jede Person als
 *   «noch nie eingeladen» gesehen.
 * - Der Abgleich beim Start legt die Automation an, lässt sie abgeschaltet
 *   und fasst beim zweiten Mal nicht an, was die Gilde eingestellt hat.
 */

const { prisma } = await import('@swisshub/database');
const automation = await import('@swisshub/automation');
const { setModuleEnabled, automation: automationModul } = await import('@swisshub/modules');

const GILDE = '900000000000000700';
const MITGLIED = '100000000000000701';
const ANDERE = '100000000000000702';
const AUSLOESER = '100000000000000703';
const ROLLE = '900000000000000704';

/** Ein Discord-Zugang, der die Direktnachrichten mitschreibt statt sie zu senden. */
function attrappe() {
  const direkt: Array<{ discordId: string; nutzlast: Record<string, unknown> }> = [];
  const gateway = {
    guild: { get: vi.fn(async () => ({ id: GILDE, name: 'SwissHub' })) },
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'nina',
        displayName: 'Nina',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: [] as string[],
        joinedAt: new Date('2026-01-05T08:00:00Z'),
        accountCreatedAt: new Date('2024-01-05T08:00:00Z'),
        boosting: false,
        timedOutUntil: null,
      })),
    },
    roles: { add: vi.fn(), remove: vi.fn(), list: vi.fn(async () => []) },
    channels: {
      list: vi.fn(async () => []),
      send: vi.fn(async () => ({ id: '800000000000000001', channelId: '0' })),
      sendDirect: vi.fn(async (discordId: string, nutzlast: Record<string, unknown>) => {
        direkt.push({ discordId, nutzlast });
        return true;
      }),
    },
  };
  return { gateway: gateway as never, direkt };
}

describeWithDatabase('Systemeinladung', () => {
  beforeAll(async () => {
    pushSchema();
    await setModuleEnabled('automation', true, 'test');
  });

  beforeEach(async () => {
    await prisma.automationJob.deleteMany({});
    await prisma.automationStepRun.deleteMany({});
    await prisma.automationRun.deleteMany({});
    await prisma.automationVersion.deleteMany({});
    await prisma.automation.deleteMany({});
    await prisma.automationEvent.deleteMany({});
    await prisma.user.deleteMany({});
  });

  // --- Der Abgleich beim Start --------------------------------------------

  it('legt die Systemeinladung an - abgeschaltet und ohne Rolle', async () => {
    await automationModul.stelleSystemautomationenSicher(GILDE);

    const eintrag = await prisma.automation.findUnique({
      where: { systemKey: automationModul.SYSTEM_EINLADUNG_KEY },
    });
    expect(eintrag).not.toBeNull();
    expect(eintrag!.kind).toBe('SYSTEM');
    /*
     * Abgeschaltet und ohne Rolle: der Bot entscheidet nicht, wer eine
     * Direktnachricht an Mitglieder auslösen darf. Das Team trägt die Rolle
     * ein und schaltet ein - bis dahin ist der Befehl für niemanden da.
     */
    expect(eintrag!.enabled).toBe(false);
    expect((eintrag!.triggerConfig as { rollen?: unknown }).rollen).toEqual([]);
    expect(eintrag!.concurrencyKey).toBe('{{event.subjectId}}');
  });

  it('legt sie beim zweiten Start nicht erneut an', async () => {
    await automationModul.stelleSystemautomationenSicher(GILDE);
    await automationModul.stelleSystemautomationenSicher(GILDE);
    expect(await prisma.automation.count({ where: { kind: 'SYSTEM' } })).toBe(1);
  });

  it('behält Rollen und Schalter der Gilde über einen Neustart', async () => {
    await automationModul.stelleSystemautomationenSicher(GILDE);
    const vorher = await prisma.automation.findUniqueOrThrow({
      where: { systemKey: automationModul.SYSTEM_EINLADUNG_KEY },
    });

    // So, wie es ein Teammitglied im Dashboard täte.
    await prisma.automation.update({
      where: { id: vorher.id },
      data: { enabled: true, triggerConfig: { rollen: [ROLLE], hinweis: 'WebApp-Einladung an eine Person' } },
    });

    await automationModul.stelleSystemautomationenSicher(GILDE);

    const nachher = await prisma.automation.findUniqueOrThrow({ where: { id: vorher.id } });
    expect(nachher.enabled).toBe(true);
    expect((nachher.triggerConfig as { rollen?: unknown }).rollen).toEqual([ROLLE]);
  });

  it('macht die Einladung über die freigegebene Rolle startbar', async () => {
    await automationModul.stelleSystemautomationenSicher(GILDE);
    const eintrag = await prisma.automation.findUniqueOrThrow({
      where: { systemKey: automationModul.SYSTEM_EINLADUNG_KEY },
    });
    await prisma.automation.update({
      where: { id: eintrag.id },
      data: { enabled: true, triggerConfig: { rollen: [ROLLE] } },
    });

    // Mit der Rolle startbar, ohne sie nicht - und das ist die ganze
    // Berechtigungsfrage dieses Befehls.
    const mitRolle = await automation.listeDiscordStartbare(GILDE, [ROLLE]);
    expect(mitRolle.map((e) => e.id)).toContain(eintrag.id);
    const ohneRolle = await automation.listeDiscordStartbare(GILDE, ['900000000000000799']);
    expect(ohneRolle.map((e) => e.id)).not.toContain(eintrag.id);
  });

  // --- Hat ein SwissHub-Konto ---------------------------------------------

  it('lädt nur ein, wer noch kein SwissHub-Konto hat', async () => {
    const { gateway, direkt } = attrappe();
    const eintrag = await einladung();

    await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });
    expect(direkt).toHaveLength(1);
    expect(direkt[0]!.discordId).toBe(MITGLIED);

    // Jetzt meldet sich dieselbe Person an - und bekommt keine Einladung mehr.
    await prisma.user.create({ data: { discordId: ANDERE, username: 'nina' } });
    const ergebnis = await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: ANDERE,
    });
    expect(ergebnis.status).toBe('SKIPPED');
    expect(direkt).toHaveLength(1);
  });

  // --- Die Abklingzeit -----------------------------------------------------

  it('schickt dieselbe Einladung nicht zweimal an dieselbe Person', async () => {
    const { gateway, direkt } = attrappe();
    const eintrag = await einladung();

    const erste = await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });
    expect(erste.status).toBe('SUCCESS');

    const zweite = await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });
    expect(zweite.status).toBe('SKIPPED');
    expect(direkt).toHaveLength(1);
  });

  it('lässt eine andere Person trotz der Abklingzeit durch', async () => {
    /*
     * Die Zusage, für die der Betroffene im Lauf gespeichert werden musste.
     * Ohne `event.subjectId` im festgehaltenen Kontext zählte die Bedingung
     * jeden Lauf für jeden - und die zweite Einladung des Abends wäre an
     * niemanden mehr gegangen.
     */
    const { gateway, direkt } = attrappe();
    const eintrag = await einladung();

    await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });
    const zweite = await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: ANDERE,
    });

    expect(zweite.status).toBe('SUCCESS');
    expect(direkt.map((eintragung) => eintragung.discordId)).toEqual([MITGLIED, ANDERE]);
  });

  it('hält den Betroffenen im Lauf fest', async () => {
    const { gateway } = attrappe();
    const eintrag = await einladung();
    const lauf = await automation.starte({
      automation: eintrag,
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });

    const zeile = await prisma.automationRun.findUniqueOrThrow({ where: { id: lauf.runId! } });
    const gespeichert = zeile.context as { event?: { subjectId?: unknown; actorId?: unknown } };
    expect(gespeichert.event?.subjectId).toBe(MITGLIED);
    expect(gespeichert.event?.actorId).toBe(AUSLOESER);
  });

  // --- Die Nachricht selbst ------------------------------------------------

  it('schreibt Name, Servername und den Anmeldelink aus der Konfiguration', async () => {
    const { appUrl } = await import('@swisshub/config');
    const { branding } = await import('@swisshub/config/client');
    const { gateway, direkt } = attrappe();

    await automation.starte({
      automation: await einladung(),
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });

    const text = JSON.stringify(direkt[0]!.nutzlast);
    expect(text).toContain('Nina');
    expect(text).toContain(branding.name);
    expect(text).toContain(appUrl('/login'));
    // Kein unaufgelöster Platzhalter in einer echten Nachricht.
    expect(text).not.toContain('{{');
  });

  it('pingt in der Einladung niemanden an', async () => {
    const { gateway, direkt } = attrappe();
    await automation.starte({
      automation: await einladung(),
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: MITGLIED,
    });
    expect(direkt[0]!.nutzlast.allowedMentions).toEqual({ parse: [] });
  });

  it('schreibt niemandem, wenn kein Mitglied angegeben ist', async () => {
    /*
     * `/automation` ohne `user`: die Einladung hat keine Empfängerin. Sie
     * darf dann nicht ersatzweise an die auslösende Person gehen - das wäre
     * eine Nachricht, die niemand bestellt hat.
     */
    const { gateway, direkt } = attrappe();
    await automation.starte({
      automation: await einladung(),
      trigger: 'discord',
      guildId: GILDE,
      gateway,
      actorId: AUSLOESER,
      subjectId: null,
    });
    expect(direkt).toHaveLength(0);
  });

  /** Die eingeschaltete Systemeinladung, wie der Startabgleich sie anlegt. */
  async function einladung() {
    await automationModul.stelleSystemautomationenSicher(GILDE);
    return prisma.automation.update({
      where: { systemKey: automationModul.SYSTEM_EINLADUNG_KEY },
      data: { enabled: true, triggerConfig: { rollen: [ROLLE] } },
    });
  }
});
