import { appUrl } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, BUTTON_STYLE, type DiscordGateway } from '@swisshub/discord';
import type { DiscordEmbed, DiscordMessagePayload } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { systemRoutes } from '@swisshub/shared';
import { CLIPS_ACCENT_COLOR, CLIPS_MODULE_ID } from './config';
import { getModuleSettings } from '../module-state';
import { siegertreppchen, rundenZahlen } from './abfragen';
import { ausSchluessel } from './woche';
import type { ClipsSettings } from './config';
import type { ClipCompetition } from '@swisshub/database';

const log = createLogger('clips:ankuendigung');

/**
 * Die drei Nachrichten einer Runde: Start, Voting, Gewinner.
 *
 * ## Warum das Senden und das Merken zusammengehoeren
 *
 * Ein Job laeuft jede Minute und wird neu gestartet, wenn der Bot neu
 * startet. Wuerde er beim Uebergang einfach senden, staende nach drei
 * Neustarts dreimal derselbe Gewinner im Kanal.
 *
 * Deshalb ist die Kennung der gesendeten Nachricht das Gedaechtnis: sie wird
 * in der Runde festgehalten, und zwar unter einer Bedingung, die nur einmal
 * zutrifft. Wer sie setzen konnte, sendet; wer nicht, schweigt. Das gilt
 * auch dann, wenn zwei Bot-Instanzen gleichzeitig laufen.
 *
 * Die Reihenfolge ist Absicht: erst senden, dann merken. Andersherum waere
 * eine Nachricht als gesendet vermerkt, die nie ankam. Scheitert das Merken
 * nach erfolgreichem Senden, steht die Nachricht doppelt da - unschoen, aber
 * harmlos gegenueber einer Woche ohne Ankuendigung.
 */

type Phase = 'start' | 'voting' | 'winner';

const FELD: Record<
  Phase,
  {
    id: 'startMessageId' | 'votingMessageId' | 'winnerMessageId';
    kanal: 'startChannelId' | 'votingChannelId' | 'winnerChannelId';
    zeit: 'startPostedAt' | 'votingPostedAt' | 'winnerPostedAt';
  }
> = {
  start: { id: 'startMessageId', kanal: 'startChannelId', zeit: 'startPostedAt' },
  voting: { id: 'votingMessageId', kanal: 'votingChannelId', zeit: 'votingPostedAt' },
  winner: { id: 'winnerMessageId', kanal: 'winnerChannelId', zeit: 'winnerPostedAt' },
};

const zeitstempel = (datum: Date, stil: 'R' | 'f' = 'f'): string =>
  `<t:${Math.floor(datum.getTime() / 1000)}:${stil}>`;

/**
 * Eine Ankuendigung senden - hoechstens einmal je Runde und Phase.
 *
 * Gibt zurueck, ob tatsaechlich gesendet wurde.
 */
async function sende(
  competition: ClipCompetition,
  phase: Phase,
  bauen: () => Promise<DiscordMessagePayload | null>,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  const settings = await getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);
  const kanalId = settings.announcementChannelId;
  if (!kanalId) {
    return false;
  }
  const erlaubt =
    phase === 'start'
      ? settings.announceStart
      : phase === 'voting'
        ? settings.announceVoting
        : settings.announceWinner;
  if (!erlaubt) {
    return false;
  }

  const felder = FELD[phase];

  /*
   * Den Platz belegen, bevor gesendet wird.
   *
   * `updateMany` mit der Bedingung «noch nicht gesetzt» ist die Belegung: sie
   * gelingt genau einem Durchgang. Eingetragen wird zunaechst ein Platzhalter
   * - die echte Kennung gibt es erst nach dem Senden - und faellt das Senden
   * aus, wird er wieder entfernt, damit es die naechste Minute erneut
   * versucht.
   */
  const platzhalter = `pending:${Date.now()}`;
  const { count } = await prisma.clipCompetition.updateMany({
    where: { id: competition.id, [felder.id]: null },
    data: { [felder.id]: platzhalter },
  });
  if (count === 0) {
    return false;
  }

  let nachrichtId: string;
  try {
    const inhalt = await bauen();
    if (!inhalt) {
      await freigeben(competition.id, felder.id, platzhalter);
      return false;
    }
    const gesendet = await gateway.channels.send(kanalId, inhalt);
    nachrichtId = gesendet.id;
  } catch (error) {
    await freigeben(competition.id, felder.id, platzhalter);
    log.warn('Ankündigung konnte nicht gesendet werden', { phase, competitionId: competition.id, error });
    return false;
  }

  await prisma.clipCompetition.updateMany({
    where: { id: competition.id, [felder.id]: platzhalter },
    data: { [felder.id]: nachrichtId, [felder.kanal]: kanalId, [felder.zeit]: new Date() },
  });
  log.info('Ankündigung gesendet', { phase, competitionId: competition.id });
  return true;
}

/** Den belegten Platz wieder freigeben - nur den eigenen. */
const freigeben = async (id: string, feld: string, platzhalter: string): Promise<void> => {
  await prisma.clipCompetition.updateMany({
    where: { id, [feld]: platzhalter },
    data: { [feld]: null },
  });
};

const fussnote = (runde: ClipCompetition): { text: string } => {
  const { jahr, woche } = ausSchluessel(runde.key);
  return { text: `Clip of the Week · Woche ${woche}/${jahr}` };
};

/** «Die Einreichungen sind offen.» */
export async function kuendigeStartAn(
  competition: ClipCompetition,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  return sende(
    competition,
    'start',
    async () => {
      const embed: DiscordEmbed = {
        title: `🎬 Clip of the Week #${competition.number} - Einreichungen offen`,
        description: [
          'Dein bester Moment dieser Woche gehört hier hin.',
          '',
          `Einreichen bis ${zeitstempel(competition.submissionEndsAt)} (${zeitstempel(competition.submissionEndsAt, 'R')}).`,
          `Danach stimmt die Community ab - bis ${zeitstempel(competition.votingEndsAt)}.`,
        ].join('\n'),
        color: CLIPS_ACCENT_COLOR,
        fields: [
          {
            name: 'Was zählt',
            value: `${competition.submissionsPerMember === 1 ? 'Ein Clip' : `Bis zu ${competition.submissionsPerMember} Clips`} pro Person · Twitch oder YouTube`,
            inline: true,
          },
          {
            name: 'Abstimmung',
            value: `${competition.votesPerMember} ${competition.votesPerMember === 1 ? 'Stimme' : 'Stimmen'} pro Person`,
            inline: true,
          },
        ],
        footer: fussnote(competition),
      };
      return {
        embeds: [embed],
        allowedMentions: { parse: [] },
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: BUTTON_STYLE.LINK,
                label: 'Clip einreichen',
                url: appUrl(systemRoutes.clipEinreichen()),
                emoji: { name: '🎬' },
              },
            ],
          },
        ],
      };
    },
    gateway,
  );
}

/** «Das Voting läuft.» */
export async function kuendigeVotingAn(
  competition: ClipCompetition,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  return sende(
    competition,
    'voting',
    async () => {
      const zahlen = await rundenZahlen(competition.id);
      if (zahlen.freigegeben === 0) {
        // Ohne Clips gibt es nichts zu wählen. Eine Ankündigung «0 Clips im
        // Rennen» ist keine Einladung, sondern eine Verlegenheit.
        return null;
      }
      const embed: DiscordEmbed = {
        title: `🗳️ Clip of the Week #${competition.number} - jetzt abstimmen`,
        description: [
          `**${zahlen.freigegeben}** ${zahlen.freigegeben === 1 ? 'Clip ist' : 'Clips sind'} im Rennen.`,
          '',
          `Du hast **${competition.votesPerMember}** ${competition.votesPerMember === 1 ? 'Stimme' : 'Stimmen'}. Das Voting endet ${zeitstempel(competition.votingEndsAt, 'R')}.`,
        ].join('\n'),
        color: CLIPS_ACCENT_COLOR,
        footer: fussnote(competition),
      };
      return {
        embeds: [embed],
        allowedMentions: { parse: [] },
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: BUTTON_STYLE.LINK,
                label: 'Clips ansehen und abstimmen',
                url: appUrl(systemRoutes.clips()),
                emoji: { name: '🗳️' },
              },
            ],
          },
        ],
      };
    },
    gateway,
  );
}

/**
 * «Wir haben einen Gewinner.»
 *
 * Die einzige Nachricht mit einem Ping - und genau einem: die Person, die
 * gewonnen hat. Ein `@everyone` fuer einen Clip-Wettbewerb waere der
 * sicherste Weg, dass der Kanal stummgeschaltet wird.
 */
export async function kuendigeGewinnerAn(
  competition: ClipCompetition,
  gateway: DiscordGateway = defaultDiscord,
): Promise<boolean> {
  return sende(
    competition,
    'winner',
    async () => {
      const treppchen = await siegertreppchen(competition.id, 3);
      const gewinner = treppchen[0];
      if (!gewinner) {
        return null;
      }

      const plaetze = treppchen
        .slice(1)
        .map(
          (karte, index) =>
            `${index === 0 ? '🥈' : '🥉'} **${karte.titel}** · <@${karte.einreicher.discordId}> · ${karte.stimmen ?? 0} ${karte.stimmen === 1 ? 'Stimme' : 'Stimmen'}`,
        )
        .join('\n');

      const embed: DiscordEmbed = {
        title: `🏆 Clip of the Week #${competition.number}`,
        url: appUrl(systemRoutes.clipRunde(competition.key)),
        description: [
          `**${gewinner.titel}**`,
          `von <@${gewinner.einreicher.discordId}>`,
          '',
          `${gewinner.stimmen ?? 0} ${gewinner.stimmen === 1 ? 'Stimme' : 'Stimmen'} · [Clip ansehen](${gewinner.canonicalUrl})`,
        ].join('\n'),
        color: CLIPS_ACCENT_COLOR,
        ...(gewinner.thumbnailUrl ? { image: { url: gewinner.thumbnailUrl } } : {}),
        ...(plaetze ? { fields: [{ name: 'Auch vorne dabei', value: plaetze }] } : {}),
        footer: fussnote(competition),
      };

      return {
        content: `Der Clip der Woche kommt von <@${gewinner.einreicher.discordId}> 🏆`,
        embeds: [embed],
        // Nur diese eine Person. Keine Rollen, kein @everyone.
        allowedMentions: { parse: [], users: [gewinner.einreicher.discordId] },
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: BUTTON_STYLE.LINK,
                label: 'Hall of Fame',
                url: appUrl(systemRoutes.hallOfFame()),
                emoji: { name: '🏆' },
              },
            ],
          },
        ],
      };
    },
    gateway,
  );
}
