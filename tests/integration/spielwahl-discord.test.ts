import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_spielwahl_discord');

/**
 * Die Runde auf Discord.
 *
 * ## Zwei Eigenschaften, und beide sind unangenehm zu debuggen
 *
 *   - **Eine Nachricht, nicht fünf.** Eine Spielauswahl ändert in zehn
 *     Minuten fünfmal ihren Zustand. Wer für jeden davon sendet, füllt einen
 *     Kanal mit einem Ereignis, das schon vorbei ist, bevor jemand nachliest.
 *   - **Ohne Erwähnungen.** Eine Runde für sechs Leute ist kein Anlass,
 *     sechstausend zu benachrichtigen.
 *
 * Beides lässt sich nicht anschauen, bevor es schiefgeht.
 */
const { prisma } = await import('@swisshub/database');
const { spielwahl } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const KANAL = '500000000000000001';
const ANNA = { discordId: '100000000000000001', username: 'anna' };

async function leeren(): Promise<void> {
  await prisma.spielwahlVote.deleteMany({});
  await prisma.spielwahlRound.deleteMany({});
  await prisma.spielwahlSupport.deleteMany({});
  await prisma.spielwahlCandidate.deleteMany({});
  await prisma.spielwahlCommand.deleteMany({});
  await prisma.spielwahlParticipant.deleteMany({});
  await prisma.spielwahlSession.deleteMany({});
  await prisma.game.deleteMany({});
}

/** Ein Gateway, das nur mitschreibt, was es tun sollte. */
function gatewayAttrappe(verhalten: 'ok' | 'fehler' = 'ok') {
  const send = vi.fn(async (_kanalId: string, _nachricht: unknown) => {
    if (verhalten === 'fehler') {
      throw new Error('Discord ist gerade nicht erreichbar');
    }
    return { id: '600000000000000001' };
  });
  const edit = vi.fn(async (_kanalId: string, _messageId: string, _nachricht: unknown) => undefined);
  return { gateway: { channels: { send, edit } } as never, send, edit };
}

async function session() {
  const angelegt = await spielwahl.eroeffne({ guildId: GUILD, host: ANNA });
  return prisma.spielwahlSession.findUniqueOrThrow({ where: { id: angelegt.id } });
}

describeWithDatabase('Was spielen wir?: Discord', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
  });

  it('sendet genau einmal und bearbeitet danach', async () => {
    const runde = await session();
    const { gateway, send, edit } = gatewayAttrappe();

    expect(await spielwahl.stelleAufDiscord(runde, KANAL, gateway)).toBe(true);

    const erneut = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: runde.id } });
    expect(await spielwahl.stelleAufDiscord(erneut, KANAL, gateway)).toBe(true);
    expect(await spielwahl.stelleAufDiscord(erneut, KANAL, gateway)).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it('sendet auch bei drei gleichzeitigen Versuchen nur eine Nachricht', async () => {
    const runde = await session();
    const { gateway, send } = gatewayAttrappe();

    await Promise.all([
      spielwahl.stelleAufDiscord(runde, KANAL, gateway),
      spielwahl.stelleAufDiscord(runde, KANAL, gateway),
      spielwahl.stelleAufDiscord(runde, KANAL, gateway),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('erwähnt niemanden', async () => {
    const runde = await session();
    const { gateway, send } = gatewayAttrappe();
    await spielwahl.stelleAufDiscord(runde, KANAL, gateway);

    const nachricht = send.mock.calls[0]?.[1] as { allowedMentions?: { parse?: string[] } };
    expect(nachricht.allowedMentions).toEqual({ parse: [] });
  });

  it('verlinkt über den Einladungswert, nicht über die interne Kennung', async () => {
    const runde = await session();
    const { gateway, send } = gatewayAttrappe();
    await spielwahl.stelleAufDiscord(runde, KANAL, gateway);

    const roh = JSON.stringify(send.mock.calls[0]?.[1]);
    expect(roh).toContain(runde.inviteToken);
    expect(roh).not.toContain(runde.id);
  });

  it('gibt den Platz wieder frei, wenn Discord nicht erreichbar ist', async () => {
    /*
     * Sonst gälte die Runde für immer als gesendet, und die Nachricht käme
     * nie - der schlimmste Ausgang, weil er still ist.
     */
    const runde = await session();
    const kaputt = gatewayAttrappe('fehler');
    expect(await spielwahl.stelleAufDiscord(runde, KANAL, kaputt.gateway)).toBe(false);

    const danach = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: runde.id } });
    expect(danach.announcementMessageId).toBeNull();

    const heil = gatewayAttrappe();
    expect(await spielwahl.stelleAufDiscord(danach, KANAL, heil.gateway)).toBe(true);
    expect(heil.send).toHaveBeenCalledTimes(1);
  });

  it('zeigt im Embed den Stand, aber keine internen Kennungen', async () => {
    const runde = await session();
    const embed = await spielwahl.baueEmbed(runde);

    const roh = JSON.stringify(embed);
    expect(roh).toContain('Was spielen wir?');
    expect(roh).toContain(`<@${ANNA.discordId}>`);
    // Keine Sessionkennung, kein Einladungswert im Embed selbst.
    expect(roh).not.toContain(runde.id);
    expect(roh).not.toContain(runde.inviteToken);
  });

  it('bietet einen Beitritts-Knopf, solange die Runde offen ist - und danach keinen', async () => {
    const runde = await session();
    const { gateway, send } = gatewayAttrappe();
    await spielwahl.stelleAufDiscord(runde, KANAL, gateway);

    const offen = send.mock.calls[0]?.[1] as { components?: unknown[] };
    expect(offen.components).toHaveLength(1);

    await spielwahl.schliesse(runde.id, ANNA);
    const geschlossen = await prisma.spielwahlSession.findUniqueOrThrow({ where: { id: runde.id } });
    const { gateway: zweites, edit } = gatewayAttrappe();
    await spielwahl.stelleAufDiscord(geschlossen, KANAL, zweites);

    const inhalt = edit.mock.calls[0]?.[2] as { components?: unknown[] } | undefined;
    expect(inhalt?.components).toHaveLength(0);
  });
});
