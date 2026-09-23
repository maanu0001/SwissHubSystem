import { appUrl } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, BUTTON_STYLE, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { systemRoutes } from '@swisshub/shared';
import { WRAPPED_ACCENT_COLOR } from './config';
import type { WrappedCampaign } from '@swisshub/database';

const log = createLogger('wrapped:ankuendigung');

/**
 * Die Ankuendigung auf Discord.
 *
 * Genau eine Nachricht je Kampagne - der Riegel ist dieselbe Bedingung wie
 * ueberall im System: die Kennung der gesendeten Nachricht wird vorher
 * belegt, und wer sie belegen konnte, sendet.
 *
 * Ohne Erwaehnung. Eine Ankuendigung, die sechstausend Leute anpingt, ist
 * keine Ankuendigung, sondern ein Vorfall.
 */
export async function kuendigeWrappedAn(
  campaign: WrappedCampaign,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  if (!campaign.announceEnabled || !campaign.announcementChannelId) {
    return false;
  }

  const platzhalter = `pending:${Date.now()}`;
  const { count } = await prisma.wrappedCampaign.updateMany({
    where: { id: campaign.id, announcementMessageId: null, status: 'PUBLISHED' },
    data: { announcementMessageId: platzhalter },
  });
  if (count === 0) {
    return false;
  }

  const kanalId = campaign.announcementChannelId;
  try {
    const gesendet = await gateway.channels.send(kanalId, {
      embeds: [
        {
          title: `🎁 ${campaign.title}`,
          description: [
            campaign.introText ?? 'Dein Jahr. Deine Mates. Dein SwissHub.',
            '',
            'Dein persönlicher Jahresrückblick steht bereit - nur für dich.',
          ].join('\n'),
          color: WRAPPED_ACCENT_COLOR,
          footer: { text: `SwissHub · ${campaign.displayYear}` },
        },
      ],
      // Keine Erwähnungen. Siehe oben.
      allowedMentions: { parse: [] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: BUTTON_STYLE.LINK,
              label: 'Mein Wrapped ansehen',
              url: appUrl(systemRoutes.wrapped(campaign.key)),
              emoji: { name: '🎁' },
            },
          ],
        },
      ],
    });

    await prisma.wrappedCampaign.updateMany({
      where: { id: campaign.id, announcementMessageId: platzhalter },
      data: {
        announcementMessageId: gesendet.id,
        announcementChannelPostedId: kanalId,
        announcementPostedAt: new Date(),
      },
    });
    log.info('Wrapped angekündigt', { campaignId: campaign.id });
    return true;
  } catch (error) {
    // Den belegten Platz wieder freigeben - sonst gilt die Kampagne fuer
    // immer als angekuendigt, und die Nachricht kaeme nie.
    await prisma.wrappedCampaign.updateMany({
      where: { id: campaign.id, announcementMessageId: platzhalter },
      data: { announcementMessageId: null },
    });
    log.warn('Wrapped-Ankündigung fehlgeschlagen', { campaignId: campaign.id, error });
    return false;
  }
}
