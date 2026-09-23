import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_gesundheit');

/**
 * Der Systemstatus muss sagen, warum die Sprachzeit so aussieht.
 *
 * «0.0 h» kann zweierlei heissen: es redet gerade niemand, oder die
 * Aufzeichnung ist aus. Ohne diesen Unterschied sucht man den Fehler im
 * Falschen - und genau das ist passiert.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings, getModuleHealth } = await import('@swisshub/modules');

const grund = {
  logMessages: true,
  storeMessageContent: false,
  logVoice: true,
  logMembers: true,
  logAdmin: true,
  logBots: false,
  ignoredChannelIds: [],
  retentionDays: 90,
  mediaRetentionDays: 30,
  archiveMedia: false,
  mediaQuotaMb: 2048,
  maxMediaFileMb: 8,
};

const sprachzeitPruefung = async () => {
  const berichte = await getModuleHealth();
  const bericht = berichte.find((eintrag) => eintrag.moduleId === analytics.ANALYTICS_MODULE_ID);
  expect(bericht, 'Analytics muss im Gesundheitsbericht auftauchen').toBeDefined();
  return bericht?.checks.find((pruefung) => pruefung.label === 'Sprachzeit');
};

describeWithDatabase('Analytics: Systemstatus zur Sprachzeit', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordChannelCache","AnalyticsVoiceSegment","ModuleState" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(analytics.ANALYTICS_MODULE_ID, true, 'test');
  });

  it('warnt, wenn die Sprachaufzeichnung abgeschaltet ist', async () => {
    await setModuleSettings(analytics.ANALYTICS_MODULE_ID, { ...grund, logVoice: false }, 'test');

    const pruefung = await sprachzeitPruefung();
    expect(pruefung?.status).toBe('warning');
    // Der Text muss den Zusammenhang herstellen, nicht nur eine Einstellung nennen.
    expect(pruefung?.detail).toMatch(/Sprachzeit/);
    expect(pruefung?.fixHref).toContain(analytics.ANALYTICS_MODULE_ID);
  });

  it('meldet den Normalfall als in Ordnung', async () => {
    await setModuleSettings(analytics.ANALYTICS_MODULE_ID, grund, 'test');

    const pruefung = await sprachzeitPruefung();
    expect(pruefung?.status).toBe('ok');
  });

  it('warnt, wenn ein Sprachkanal von der Aufzeichnung ausgenommen ist', async () => {
    /*
     * Die zweite stille Null. Ein ausgenommener Sprachkanal sieht in der
     * Statistik genauso aus, als wäre dort niemand gewesen - und niemand
     * käme von selbst darauf, in den Einstellungen nachzusehen.
     */
    const KANAL = '700000000000000010';
    await prisma.discordChannelCache.create({
      data: { channelId: KANAL, name: 'Treffpunkt', type: 2, position: 0, parentId: null },
    });
    await setModuleSettings(analytics.ANALYTICS_MODULE_ID, { ...grund, ignoredChannelIds: [KANAL] }, 'test');

    const pruefung = await sprachzeitPruefung();
    expect(pruefung?.status).toBe('warning');
    expect(pruefung?.detail).toContain('Treffpunkt');
  });

  it('warnt nicht wegen eines ausgenommenen Textkanals', async () => {
    // Ein ausgenommener Textkanal hat mit der Sprachzeit nichts zu tun -
    // eine Warnung dort wäre Lärm.
    const TEXT = '700000000000000020';
    await prisma.discordChannelCache.create({
      data: { channelId: TEXT, name: 'allgemein', type: 0, position: 1, parentId: null },
    });
    await setModuleSettings(analytics.ANALYTICS_MODULE_ID, { ...grund, ignoredChannelIds: [TEXT] }, 'test');

    expect((await sprachzeitPruefung())?.status).toBe('ok');
  });
});
