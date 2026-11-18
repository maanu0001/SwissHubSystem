import { Events, MessageFlags, type Client, type Interaction } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { logs } from '@swisshub/modules';
import { JAIL_COMMAND_DEFINITIONS, handleJailCommand } from './jail-commands';
import { LEVEL_COMMAND_DEFINITIONS, LEVEL_COMMAND_NAMES, handleLevelCommand } from './level-commands';
import {
  COMMUNICATION_COMMAND_DEFINITIONS,
  COMMUNICATION_COMMAND_NAMES,
  handleCommunicationCommand,
  handleCommunicationModal,
  isCommunicationModal,
} from './communication-commands';
import {
  SPIELWAHL_COMMAND_DEFINITIONS,
  SPIELWAHL_COMMAND_NAMES,
  handleSpielwahlCommand,
} from './spielwahl-commands';
import { EMOJI_COMMAND_DEFINITIONS, EMOJI_COMMAND_NAMES, handleEmojiCommand } from './emoji-commands';
import {
  MODERATION_COMMAND_DEFINITIONS,
  MODERATION_COMMAND_NAMES,
  handleModerationCommand,
} from './moderation-commands';
import { XPSLOT_COMMAND_DEFINITIONS, XPSLOT_COMMAND_NAMES, handleXpSlotCommand } from './xpslot-commands';
import {
  AUTOMATION_COMMAND_DEFINITIONS,
  AUTOMATION_COMMAND_NAMES,
  handleAutomationAutocomplete,
  handleAutomationCommand,
} from './automation-commands';

const log = createLogger('bot:commands:register');

/** Alle Befehle der Anwendung - eine Liste, ein Registrierungsvorgang. */
const ALL_COMMANDS = [
  ...JAIL_COMMAND_DEFINITIONS,
  ...LEVEL_COMMAND_DEFINITIONS,
  ...COMMUNICATION_COMMAND_DEFINITIONS,
  ...AUTOMATION_COMMAND_DEFINITIONS,
  ...SPIELWAHL_COMMAND_DEFINITIONS,
  ...EMOJI_COMMAND_DEFINITIONS,
  ...MODERATION_COMMAND_DEFINITIONS,
  ...XPSLOT_COMMAND_DEFINITIONS,
];

/**
 * Registrierung der Slash Commands.
 *
 * Die Befehle werden pro Guild registriert. Guild-Befehle sind sofort
 * verfügbar, während globale Befehle bis zu einer Stunde brauchen - beim
 * Wechsel des verbundenen Servers wäre das unbrauchbar.
 *
 * Die Registrierung ist idempotent: `set()` ersetzt die Liste vollständig.
 * Ein entfernter Befehl verschwindet dadurch auch auf Discord.
 */
export async function registerCommands(client: Client, guildId: string): Promise<boolean> {
  if (!client.application) {
    log.warn('Slash Commands können ohne Anwendungskontext nicht registriert werden.');
    return false;
  }

  try {
    await client.application.commands.set(ALL_COMMANDS, guildId);
    log.info('Slash Commands registriert', {
      guildId,
      commands: ALL_COMMANDS.map((entry) => entry.name),
    });
    return true;
  } catch (error) {
    // Fehlt dem Bot `applications.commands`, ist das ein Einladungsproblem -
    // der Bot läuft trotzdem weiter, das Dashboard bleibt voll nutzbar.
    log.error(
      'Slash Commands konnten nicht registriert werden. Wurde der Bot mit dem Scope `applications.commands` eingeladen?',
      { error, guildId },
    );
    return false;
  }
}

/**
 * Nimmt Slash-Command-Interaktionen entgegen.
 *
 * Die Zuordnung erfolgt am Befehlsnamen - jedes Modul bringt seinen eigenen
 * Adapter mit, hier wird nur verteilt.
 */
/**
 * Was ein Handler durchlaesst, landet im Fehler-Log.
 *
 * ## Warum hier und nicht in jedem Handler
 *
 * Jeder Befehlsadapter hat seinen eigenen `catch`, der dem Aufrufer eine
 * Absage schickt - und genau deshalb braucht es diese Huelle: ein `void
 * handleX(interaction)` ohne sie macht aus allem, was die eigenen `catch`
 * nicht gefangen haben, eine unbehandelte Promise-Ablehnung. Die landet im
 * Serverprotokoll, wo niemand sie liest, und der Aufrufer sieht ein Discord
 * das stumm bleibt.
 *
 * Die Huelle meldet und antwortet: beides, weil beides fehlte. Eine Meldung
 * ohne Antwort laesst den Aufrufer auf eine Antwort warten, die nie kommt;
 * eine Antwort ohne Meldung verschweigt den Fehler.
 *
 * ## Was sie nicht ist
 *
 * Kein Ersatz fuer die `catch`-Bloecke der Adapter. Die kennen ihre eigenen
 * Fehlertexte - «du hesch kei Berächtigung» ist keine Panne und gehoert
 * nicht hierher. Diese Huelle ist das Netz darunter.
 */
async function fuehreAus(
  interaction: Interaction,
  befehl: string,
  art: 'DISCORD_COMMAND' | 'DISCORD_INTERACTION',
  arbeit: () => Promise<void>,
): Promise<void> {
  try {
    await arbeit();
  } catch (fehler) {
    log.error('Interaktion gescheitert', { befehl, fehler });
    await logs
      .meldeFehler({
        source: art,
        origin: befehl,
        fehler,
        actorDiscordId: interaction.user.id,
      })
      .catch(() => undefined);

    /*
     * Noch eine Antwort versuchen - aber nur, wenn keine da ist.
     *
     * Ein Adapter, der schon geantwortet hat, bekaeme sonst eine zweite
     * Nachricht ueber denselben Vorgang. Und jeder Versuch hier ist selbst
     * gefangen: wenn Discord die Interaktion bereits verfallen laesst, ist
     * das kein Grund, den Prozess zu stoeren.
     */
    if (!interaction.isRepliable()) {
      return;
    }
    const text = 'Das het leider nöd klappt. De Fähler isch gmäldet worde.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text }).catch(() => undefined);
      return;
    }
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export function registerCommandHandler(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    // Das Modal von `/post` kommt als eigene Interaktion zurück.
    if (interaction.isModalSubmit()) {
      if (isCommunicationModal(interaction.customId)) {
        void fuehreAus(interaction, 'modal:post', 'DISCORD_INTERACTION', () =>
          handleCommunicationModal(interaction),
        );
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      if (AUTOMATION_COMMAND_NAMES.has(interaction.commandName)) {
        void fuehreAus(interaction, `autocomplete:${interaction.commandName}`, 'DISCORD_INTERACTION', () =>
          handleAutomationAutocomplete(interaction),
        );
      }
      /*
       * Die Emoji-Befehle brauchen keine Autovervollstaendigung mehr.
       *
       * Sie nehmen jetzt ein Emoji aus einem Chat, keine Kennung aus einer
       * Liste - was man einfuegt, kann niemand vorschlagen.
       */
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }
    /*
     * Jeder Zweig durch dieselbe Huelle - der Befehlsname ist der Ort.
     *
     * `/level` ist damit im Fehler-Log ein anderer Ort als `/jail`, und
     * zwei Fehler in zwei Befehlen sind zwei Zeilen statt einer.
     */
    const befehl = `/${interaction.commandName}`;
    const starte = (arbeit: () => Promise<void>): void => {
      void fuehreAus(interaction, befehl, 'DISCORD_COMMAND', arbeit);
    };

    if (XPSLOT_COMMAND_NAMES.has(interaction.commandName)) {
      starte(() => handleXpSlotCommand(interaction));
      return;
    }
    if (LEVEL_COMMAND_NAMES.has(interaction.commandName)) {
      starte(() => handleLevelCommand(interaction));
      return;
    }
    if (COMMUNICATION_COMMAND_NAMES.has(interaction.commandName)) {
      starte(() => handleCommunicationCommand(interaction));
      return;
    }
    if (AUTOMATION_COMMAND_NAMES.has(interaction.commandName)) {
      starte(() => handleAutomationCommand(interaction));
      return;
    }
    if (SPIELWAHL_COMMAND_NAMES.has(interaction.commandName as 'was-spielen-wir')) {
      starte(() => handleSpielwahlCommand(interaction));
      return;
    }
    if (EMOJI_COMMAND_NAMES.has(interaction.commandName as 'emoji_add')) {
      starte(() => handleEmojiCommand(interaction));
      return;
    }
    if (MODERATION_COMMAND_NAMES.has(interaction.commandName as 'note')) {
      starte(() => handleModerationCommand(interaction));
      return;
    }
    starte(() => handleJailCommand(interaction));
  });
}
