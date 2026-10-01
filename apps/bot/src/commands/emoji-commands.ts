import {
  ApplicationCommandOptionType,
  MessageFlags,
  type Attachment,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { emoji, getModuleSettings, isModuleEnabled } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './context';

const log = createLogger('bot:commands:emoji');

/**
 * `/emoji_add`, `/emoji_request`, `/emoji_vote`.
 *
 * ## Drei Befehle, drei Rollen im Vorgang
 *
 * - **`/emoji_add`** ist fürs Team: Bild dran, Name dazu, liegt sofort auf dem
 *   Server. Braucht `emoji.manage`.
 * - **`/emoji_request`** ist für alle: dasselbe Bild, aber als Vorschlag. Das
 *   Team entscheidet.
 * - **`/emoji_vote`** legt einen offenen Vorschlag der Community vor. Braucht
 *   `emoji.moderate` - wer abstimmen lässt, entscheidet darüber, dass nicht das
 *   Team entscheidet.
 *
 * ## Ein Adapter, keine zweite Fachlogik
 *
 * Alle drei rufen dieselben Funktionen auf wie das Dashboard:
 * `emoji.fuegeEmojiHinzu`, `emoji.reicheEin`, `emoji.starteAbstimmung`. Es gibt
 * keine zweite Vorstellung davon, welcher Name erlaubt ist, wie viele Plätze
 * frei sind oder wie viele Vorschläge jemand offen haben darf.
 *
 * ## Der Anhang
 *
 * Discord liefert eine Adresse auf seinem eigenen CDN. Die Bytes holt
 * `emoji.holeDiscordAnhang` - mit derselben SSRF-Prüfung wie jeder Import, aber
 * gegen die feste Discord-Liste statt gegen die eingestellte: diese Adresse hat
 * niemand getippt, sie kam in Discords Nutzlast.
 *
 * Geprüft werden danach trotzdem die Bytes und nicht der angekündigte Typ. Ein
 * `content-type` ist eine Behauptung, auch wenn Discord ihn aufstellt.
 */

export const EMOJI_COMMAND_DEFINITIONS = [
  {
    name: 'emoji_add',
    description: 'Es Emoji direkt uf de Server lade.',
    dmPermission: false,
    options: [
      {
        name: 'name',
        description: 'Wie söll s Emoji heisse? (a-z, Zahle, Underschtrich)',
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 32,
      },
      {
        name: 'bild',
        description: 'S Bild - PNG, JPEG, GIF oder WebP, max 256 KB.',
        type: ApplicationCommandOptionType.Attachment,
        required: true,
      },
    ],
  },
  {
    name: 'emoji_request',
    description: 'Es Emoji vorschlah - s Team entscheidet.',
    dmPermission: false,
    options: [
      {
        name: 'name',
        description: 'Wie söll s Emoji heisse? (a-z, Zahle, Underschtrich)',
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 32,
      },
      {
        name: 'bild',
        description: 'S Bild - PNG, JPEG, GIF oder WebP, max 256 KB.',
        type: ApplicationCommandOptionType.Attachment,
        required: true,
      },
      {
        name: 'begründig',
        description: 'Werum söll s das Emoji gäh? (optional)',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 400,
      },
    ],
  },
  {
    name: 'emoji_vote',
    description: 'E offene Vorschlag vo de Community abstimme lah.',
    dmPermission: false,
    options: [
      {
        name: 'vorschlag',
        description: 'De Name vom Vorschlag.',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
    ],
  },
] as const;

export const EMOJI_COMMAND_NAMES = new Set(EMOJI_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name));

type EmojiCommandName = (typeof EMOJI_COMMAND_DEFINITIONS)[number]['name'];

/**
 * Die Bytes eines Anhangs - oder ein Grund.
 *
 * Discord nennt Grösse und Typ im Anhang. Die Grösse wird vorab geprüft, weil
 * sie einen Abruf spart; der Typ nicht, weil er eine Behauptung ist.
 */
async function bytesVon(anhang: Attachment): Promise<{ bytes?: Uint8Array; grund?: string }> {
  if (anhang.size > emoji.EMOJI_MAX_BYTES) {
    return {
      grund: `S Bild isch ${Math.round(anhang.size / 1024)} KB gross. Discord nimmt maximal ${Math.round(
        emoji.EMOJI_MAX_BYTES / 1024,
      )} KB.`,
    };
  }
  const ergebnis = await emoji.holeDiscordAnhang(anhang.url);
  if (!ergebnis.ok || !ergebnis.bytes) {
    return { grund: ergebnis.grund ?? 'S Bild het sich nöd lade lah.' };
  }
  return { bytes: ergebnis.bytes };
}

export async function handleEmojiCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!EMOJI_COMMAND_NAMES.has(interaction.commandName as EmojiCommandName)) {
    return;
  }

  /*
   * Immer privat.
   *
   * Die Antwort auf einen Befehl ist eine Quittung, und eine Quittung gehört
   * niemandem ausser dem, der sie ausgelöst hat. Was öffentlich wird - die
   * Moderationsmeldung, die Abstimmung - stellt das Modul selbst.
   */
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!(await isModuleEnabled(emoji.EMOJI_MODULE_ID))) {
      await interaction.editReply({ content: 'S Emoji-Modul isch grad usgschalte.' });
      return;
    }

    const actor = await buildCommandActor(interaction);

    switch (interaction.commandName as EmojiCommandName) {
      case 'emoji_add':
        await hinzufuegen(interaction, actor);
        return;
      case 'emoji_request':
        await vorschlagen(interaction, actor);
        return;
      case 'emoji_vote':
        await abstimmenLassen(interaction, actor);
        return;
    }
  } catch (error) {
    const fehler = error instanceof AppError ? error.userMessage : 'Das het leider nöd klappt.';
    log.warn('Emoji-Befehl gescheitert', {
      befehl: interaction.commandName,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await interaction.editReply({ content: fehler });
  }
}

type Actor = Awaited<ReturnType<typeof buildCommandActor>>;

async function hinzufuegen(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
  if (!actor.can(emoji.EMOJI_PERMISSIONS.manage)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const anhang = interaction.options.getAttachment('bild', true);
  const { bytes, grund } = await bytesVon(anhang);
  if (!bytes) {
    await interaction.editReply({ content: grund ?? 'S Bild het sich nöd lade lah.' });
    return;
  }

  const ergebnis = await emoji.fuegeEmojiHinzu({
    name: interaction.options.getString('name', true),
    bytes,
    akteurDiscordId: actor.discordId,
    herkunftNotiz: `Discord-Ahang: ${anhang.name}`,
    // Das Team darf den letzten Platz belegen - das ist eine Entscheidung.
    ohneReserve: true,
  });

  if (!ergebnis.ok || !ergebnis.emoji) {
    await interaction.editReply({ content: ergebnis.grund ?? 'Das het nöd klappt.' });
    return;
  }

  await interaction.editReply({
    content: [
      `${ergebnis.emoji.code} isch da - tipp \`:${ergebnis.emoji.name}:\`.`,
      ergebnis.hinweis ? `Hinwiis: ${ergebnis.hinweis}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function vorschlagen(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
  if (!actor.can(emoji.EMOJI_PERMISSIONS.request)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const anhang = interaction.options.getAttachment('bild', true);
  const { bytes, grund } = await bytesVon(anhang);
  if (!bytes) {
    await interaction.editReply({ content: grund ?? 'S Bild het sich nöd lade lah.' });
    return;
  }

  const ergebnis = await emoji.reicheEin({
    name: interaction.options.getString('name', true),
    bytes,
    antragstellerId: actor.discordId,
    herkunft: 'DISCORD_ANHANG',
    herkunftNotiz: anhang.name,
    begruendung: interaction.options.getString('begründig'),
  });

  if (!ergebnis.ok || !ergebnis.antrag) {
    await interaction.editReply({ content: ergebnis.grund ?? 'Das het nöd klappt.' });
    return;
  }

  /*
   * Die Meldung ans Team geht hier heraus und nicht im Modul.
   *
   * Der Vorschlag steht auch ohne sie: ein falsch gesetzter Kanal darf keine
   * Einreichung verlieren. Deshalb erst speichern, dann melden - und ein
   * Fehlschlag beim Melden bleibt im Log.
   */
  await emoji.schreibeModerationsmeldung(ergebnis.antrag.id, { basisUrl: appUrl('') });

  await interaction.editReply({
    content: [
      `Danke - \`:${ergebnis.antrag.name}:\` isch bim Team.`,
      ergebnis.hinweis ? `Hinwiis: ${ergebnis.hinweis}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

async function abstimmenLassen(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
  if (!actor.can(emoji.EMOJI_PERMISSIONS.moderate)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const settings = await getModuleSettings<emoji.EmojiSettings>(emoji.EMOJI_MODULE_ID);
  if (!settings.abstimmungAktiv) {
    await interaction.editReply({
      content: 'D Community-Abstimmig isch usgschalte. Du chasch sie i de Modulistellige iischalte.',
    });
    return;
  }

  const antragId = interaction.options.getString('vorschlag', true);
  const ergebnis = await emoji.starteAbstimmung(antragId, actor.discordId);
  if (!ergebnis.ok || !ergebnis.antrag) {
    await interaction.editReply({ content: ergebnis.grund ?? 'Das het nöd klappt.' });
    return;
  }

  await Promise.all([
    emoji.schreibeAbstimmungsnachricht(antragId, { basisUrl: appUrl('') }),
    emoji.schreibeModerationsmeldung(antragId, { basisUrl: appUrl(''), nurAktualisieren: true }),
  ]);

  const ziel = ergebnis.antrag.stimmenZiel ?? settings.stimmenZiel;
  await interaction.editReply({
    content: settings.abstimmungChannelId
      ? `D Abstimmig über \`:${ergebnis.antrag.name}:\` laufed i <#${settings.abstimmungChannelId}> - ${ziel} Stimme in ${settings.abstimmungMinuten} Minute.`
      : `D Abstimmig laufed, aber es isch kei Abstimmigskanal istellt. De Stand staht im Dashboard.`,
  });
}

/**
 * Autovervollständigung für `/emoji_vote`.
 *
 * Es werden nur **offene** Vorschläge angeboten. Einen schon entschiedenen zur
 * Wahl zu stellen wäre ein Eintrag, der beim Klick scheitert - und das
 * Dashboard zeigte dann einen Fehler, den die Liste verursacht hat.
 */
export async function handleEmojiAutocomplete(interaction: {
  commandName: string;
  respond: (
    optionen: Array<{ name: string; value: string }>,
  ) => Promise<void>;
  options: { getFocused: () => string };
}): Promise<void> {
  if (!EMOJI_COMMAND_NAMES.has(interaction.commandName as EmojiCommandName)) {
    return;
  }
  try {
    const suche = interaction.options.getFocused().trim().toLowerCase();
    const bereich = await emoji.ladeBereich();
    const treffer = bereich.offene
      .filter((antrag) => suche.length === 0 || antrag.name.includes(suche))
      .slice(0, 25)
      .map((antrag) => ({ name: `:${antrag.name}:`, value: antrag.id }));
    await interaction.respond(treffer);
  } catch (error) {
    log.debug('Autovervollständigung gescheitert', { error });
    await interaction.respond([]);
  }
}
