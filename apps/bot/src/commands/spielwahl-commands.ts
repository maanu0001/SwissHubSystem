import {
  ApplicationCommandOptionType,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError, systemRoutes } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled, spielwahl } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { buildCommandActor, NO_PERMISSION } from './context';

const log = createLogger('bot:commands:spielwahl');

/**
 * `/was-spielen-wir`.
 *
 * ## Ein Adapter, keine zweite Fachlogik
 *
 * Eröffnet wird über `spielwahl.eroeffne` - dieselbe Funktion, die auch der
 * Knopf im Dashboard aufruft. Es gibt keine zweite Vorstellung davon, wie
 * viele Runden jemand offen haben darf oder was die Vorgaben sind.
 *
 * ## Die Voice-Option
 *
 * `voice: true` stellt die Einladung **in den Textchat des Sprachkanals**,
 * in dem der Aufrufer gerade sitzt. Genau das und nicht mehr: es wird
 * niemand automatisch hinzugefügt, niemand erwähnt, und es wird nirgends
 * festgehalten oder veröffentlicht, wer dort sitzt. Wer die Einladung sieht,
 * sieht sie, weil er im Kanal ist - nicht, weil der Bot eine Mitgliederliste
 * gelesen hat.
 *
 * Vorher wird geprüft, ob der Bot dort überhaupt schreiben darf. Eine
 * Einladung, die im Nichts landet, wäre schlimmer als keine.
 */

const MODUS_WAHL = [
  { name: 'Roulette - das Rad entscheidet', value: 'ROULETTE' },
  { name: 'Abstimmung - alle wählen gleichzeitig', value: 'VOTING' },
  { name: 'Ausscheidung - Duell für Duell', value: 'ELIMINATION' },
];

export const SPIELWAHL_COMMAND_DEFINITIONS = [
  {
    name: 'was-spielen-wir',
    description: 'Start e gmeinsami Spielwahl - Roulette, Abstimmig oder Usscheidig.',
    dmPermission: false,
    options: [
      {
        name: 'modus',
        description: 'Wie söll entschide werde?',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: MODUS_WAHL,
      },
      {
        name: 'voice',
        description: 'D Ilading i de Chat vo dim Sprachkanal stelle.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
] as const;

export const SPIELWAHL_COMMAND_NAMES = new Set(SPIELWAHL_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name));

export async function handleSpielwahlCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!SPIELWAHL_COMMAND_NAMES.has(interaction.commandName as 'was-spielen-wir')) {
    return;
  }

  /*
   * Nur für den Aufrufer sichtbar.
   *
   * Die Runde selbst wird - wenn gewünscht - als eigener Beitrag gestellt.
   * Die Antwort auf den Befehl ist dagegen eine Quittung, und eine Quittung
   * gehört niemandem ausser dem, der sie ausgelöst hat.
   */
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
      await interaction.editReply({ content: '«Was spielen wir?» isch grad usgschalte.' });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(spielwahl.SPIELWAHL_PERMISSIONS.create)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const modus = interaction.options.getString('modus') as 'ROULETTE' | 'VOTING' | 'ELIMINATION' | null;
    const inVoice = interaction.options.getBoolean('voice') === true;

    const guildId = await resolveGuildId();
    const session = await spielwahl.eroeffne({
      guildId,
      host: { discordId: actor.discordId, username: actor.username },
      optionen: modus ? { modus } : undefined,
    });

    const adresse = appUrl(systemRoutes.spielwahlSession(session.inviteToken));

    const kanalId = inVoice ? await voiceTextKanal(interaction) : await ankuendigungsKanal();
    if (kanalId) {
      const zeile = await spielwahl.finde(guildId, session.id);
      if (zeile) {
        await spielwahl.stelleAufDiscord(zeile, kanalId);
      }
    }

    await interaction.editReply({
      content: [
        `D Runde isch offe: ${adresse}`,
        kanalId ? `D Ilading staht i <#${kanalId}>.` : 'Teil de Link mit dine Kollege.',
      ].join('\n'),
    });
  } catch (error) {
    const fehler = error instanceof AppError ? error.userMessage : 'Das het leider nöd klappt.';
    log.warn('Spielwahl-Befehl gescheitert', {
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await interaction.editReply({ content: fehler });
  }
}

/**
 * Der Textchat des Sprachkanals, in dem der Aufrufer sitzt.
 *
 * `null`, wenn er in keinem sitzt oder der Bot dort nicht schreiben darf.
 * Gelesen wird ausschliesslich **sein eigener** Aufenthaltsort - die
 * Mitgliederliste des Kanals wird nicht angefasst.
 */
async function voiceTextKanal(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const member = interaction.member;
  if (!member || !('voice' in member) || !member.voice?.channel) {
    return null;
  }
  const kanal = member.voice.channel;
  if (kanal.type !== ChannelType.GuildVoice && kanal.type !== ChannelType.GuildStageVoice) {
    return null;
  }

  const eigene = kanal.permissionsFor(interaction.client.user);
  if (!eigene?.has(PermissionFlagsBits.SendMessages) || !eigene.has(PermissionFlagsBits.ViewChannel)) {
    return null;
  }
  return kanal.id;
}

/** Der eingestellte Ankündigungskanal - oder keiner. */
async function ankuendigungsKanal(): Promise<string | null> {
  const settings = await getModuleSettings<spielwahl.SpielwahlSettings>(spielwahl.SPIELWAHL_MODULE_ID);
  return settings.announcementChannelId;
}
