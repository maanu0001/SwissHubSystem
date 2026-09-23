import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_ankuendigung');

/**
 * Die Ankündigung auf Discord.
 *
 * ## Zwei Eigenschaften, und beide sind unangenehm zu debuggen
 *
 *   - **Genau einmal.** Eine Ankündigung, die bei jedem Durchlauf des Bots
 *     erneut gesendet wird, ist nach einer Stunde sechzigmal im Kanal. Das
 *     merkt man sofort - aber erst, wenn es passiert ist.
 *   - **Ohne Erwähnungen.** Eine Nachricht, die sechstausend Leute anpingt,
 *     ist kein Hinweis, sondern ein Vorfall.
 *
 * Beides lässt sich nicht anschauen, bevor es schiefgeht. Deshalb hier.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const KANAL = '500000000000000001';

async function leeren(): Promise<void> {
  await prisma.wrappedScene.deleteMany({});
  await prisma.wrappedSnapshot.deleteMany({});
  await prisma.wrappedGenerationRun.deleteMany({});
  await prisma.wrappedCampaign.deleteMany({});
}

/** Ein Gateway, das nur mitschreibt, was es senden sollte. */
function gatewayAttrappe(verhalten: 'ok' | 'fehler' = 'ok') {
  const send = vi.fn(async (_kanalId: string, _nachricht: unknown) => {
    if (verhalten === 'fehler') {
      throw new Error('Discord ist gerade nicht erreichbar');
    }
    return { id: '600000000000000001' };
  });
  return { gateway: { channels: { send } } as never, send };
}

async function veroeffentlichteKampagne(
  optionen: { announceEnabled?: boolean; channel?: string | null } = {},
): Promise<Awaited<ReturnType<typeof prisma.wrappedCampaign.create>>> {
  return prisma.wrappedCampaign.create({
    data: {
      guildId: GUILD,
      key: '2026',
      title: 'SwissHub Wrapped 2026',
      displayYear: 2026,
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2027, 0, 1)),
      status: 'PUBLISHED',
      publishedAt: new Date(),
      announceEnabled: optionen.announceEnabled ?? true,
      announcementChannelId: optionen.channel === undefined ? KANAL : optionen.channel,
    },
  });
}

describeWithDatabase('Wrapped: Ankündigung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('sendet genau einmal, auch bei wiederholtem Aufruf', async () => {
    const campaign = await veroeffentlichteKampagne();
    const { gateway, send } = gatewayAttrappe();

    expect(await wrapped.kuendigeWrappedAn(campaign, gateway)).toBe(true);
    // Der zweite Aufruf bekommt dieselbe Kampagne - frisch aus der Datenbank,
    // so wie der Bot sie beim nächsten Durchlauf laden würde.
    const erneut = await prisma.wrappedCampaign.findUnique({ where: { id: campaign.id } });
    expect(await wrapped.kuendigeWrappedAn(erneut!, gateway)).toBe(false);
    expect(await wrapped.kuendigeWrappedAn(erneut!, gateway)).toBe(false);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('erwähnt niemanden', async () => {
    const campaign = await veroeffentlichteKampagne();
    const { gateway, send } = gatewayAttrappe();
    await wrapped.kuendigeWrappedAn(campaign, gateway);

    const nachricht = send.mock.calls[0]?.[1] as { allowedMentions?: { parse?: string[] } };
    expect(nachricht.allowedMentions).toEqual({ parse: [] });
  });

  it('verlinkt den Rückblick, ohne eine Kennung zu nennen', async () => {
    const campaign = await veroeffentlichteKampagne();
    const { gateway, send } = gatewayAttrappe();
    await wrapped.kuendigeWrappedAn(campaign, gateway);

    const roh = JSON.stringify(send.mock.calls[0]?.[1]);
    expect(roh).toContain('/wrapped/2026');
    // Keine Discord-Kennung, keine interne Kennung.
    expect(roh).not.toContain(campaign.id);
    expect(roh).not.toMatch(/\b\d{17,20}\b/u);
  });

  it('gibt den Platz wieder frei, wenn Discord nicht erreichbar ist', async () => {
    /*
     * Sonst gälte die Kampagne für immer als angekündigt, und die Nachricht
     * käme nie - der schlimmste Ausgang, weil er still ist.
     */
    const campaign = await veroeffentlichteKampagne();
    const kaputt = gatewayAttrappe('fehler');
    expect(await wrapped.kuendigeWrappedAn(campaign, kaputt.gateway)).toBe(false);

    const danach = await prisma.wrappedCampaign.findUnique({ where: { id: campaign.id } });
    expect(danach?.announcementMessageId).toBeNull();

    // Beim nächsten Versuch klappt es.
    const heil = gatewayAttrappe();
    expect(await wrapped.kuendigeWrappedAn(danach!, heil.gateway)).toBe(true);
    expect(heil.send).toHaveBeenCalledTimes(1);
  });

  it('sendet nichts, wenn die Ankündigung ausgeschaltet ist', async () => {
    const campaign = await veroeffentlichteKampagne({ announceEnabled: false });
    const { gateway, send } = gatewayAttrappe();
    expect(await wrapped.kuendigeWrappedAn(campaign, gateway)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sendet nichts ohne Kanal', async () => {
    const campaign = await veroeffentlichteKampagne({ channel: null });
    const { gateway, send } = gatewayAttrappe();
    expect(await wrapped.kuendigeWrappedAn(campaign, gateway)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('kündigt einen Entwurf nicht an', async () => {
    /*
     * Der Riegel sitzt in der Bedingung des Schreibvorgangs: nur eine
     * veröffentlichte Kampagne lässt sich belegen. Ein Entwurf, der
     * versehentlich in den Bot-Durchlauf gerät, bleibt still.
     */
    const entwurf = await prisma.wrappedCampaign.create({
      data: {
        guildId: GUILD,
        key: 'entwurf',
        title: 'Entwurf',
        displayYear: 2026,
        periodStart: new Date(Date.UTC(2026, 0, 1)),
        periodEnd: new Date(Date.UTC(2027, 0, 1)),
        announceEnabled: true,
        announcementChannelId: KANAL,
      },
    });
    const { gateway, send } = gatewayAttrappe();
    expect(await wrapped.kuendigeWrappedAn(entwurf, gateway)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
