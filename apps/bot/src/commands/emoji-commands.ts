import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { emoji, getModuleSettings, isModuleEnabled } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './context';

const log = createLogger('bot:commands:emoji');

/**
 * `/emoji_add`, `/emoji_request`, `/emoji_vote`.
 *
 * ## Alle drei nehmen ein Emoji, kein Bild
 *
 *     /emoji_add emoji:<:pog:123456789012345678> name:pog
 *
 * Das ist der Weg, den man von Emoji-Stealer-Bots kennt, und er ist der
 * richtige: niemand lädt eine Datei hoch, um ein Emoji zu übernehmen, das er
 * gerade in einem Chat gesehen hat. Was ein Emoji in einer Nachricht ist - ein
 * Name und eine Kennung - und wie daraus eine Bildadresse auf Discords CDN
 * wird, steht in `emoji/fremd.ts`.
 *
 * **Das ist kein Laden einer beliebigen Adresse.** Die Adresse wird aus der
 * Kennung gebaut, nicht eingegeben, und der Host ist Discords eigener aus einer
 * festen Liste. Danach gilt dieselbe SSRF-Prüfung wie für jeden Import.
 *
 * ## Drei Befehle, drei Arten von Vertrauen
 *
 * - **`/emoji_add`** - `emoji.manage`. Liegt sofort auf dem Server.
 * - **`/emoji_request`** - `emoji.request`. Geht ans Team.
 * - **`/emoji_vote`** - `emoji.vote`. Geht an die **Community**: ein Embed mit
 *   Ja-Knopf im eingestellten Kanal. Erreicht es das Stimmenziel im Zeitfenster,
 *   landet das Emoji auf dem Server - ohne dass jemand entschieden hat.
 *
 * `emoji.vote` ist bewusst eine eigene Berechtigung und nicht Teil von
 * `moderate`: so lässt sie sich einer Levelrolle geben («ab Level 15 darfst du
 * die Community fragen»), während das Entscheiden beim Team bleibt.
 *
 * ## Ein Adapter, keine zweite Fachlogik
 *
 * Alle drei rufen dieselben Funktionen auf wie das Dashboard. Es gibt keine
 * zweite Vorstellung davon, welcher Name erlaubt ist, wie viele Plätze frei
 * sind oder wie viele Vorschläge jemand offen haben darf.
 */

/** Die Beschreibung, die bei allen drei Befehlen am Emoji-Feld steht. */
const EMOJI_HINWEIS = 'S Emoji vo eme andere Server - ischs Feld inekopiere.';

export const EMOJI_COMMAND_DEFINITIONS = [
  {
    name: 'emoji_add',
    description: 'Es Emoji vo eme andere Server uf de Server kopiere.',
    dmPermission: false,
    options: [
      {
        name: 'emoji',
        description: EMOJI_HINWEIS,
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 200,
      },
      {
        name: 'name',
        description: 'Neue Name (optional - sunscht de vom Herkunftsserver).',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 32,
      },
    ],
  },
  {
    name: 'emoji_request',
    description: 'Es Emoji vo eme andere Server vorschlah - s Team entscheidet.',
    dmPermission: false,
    options: [
      {
        name: 'emoji',
        description: EMOJI_HINWEIS,
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 200,
      },
      {
        name: 'name',
        description: 'Neue Name (optional - sunscht de vom Herkunftsserver).',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 32,
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
    description: 'Es Emoji vo eme andere Server de Community zur Abstimmig vorlege.',
    dmPermission: false,
    options: [
      {
        name: 'emoji',
        description: EMOJI_HINWEIS,
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 200,
      },
      {
        name: 'name',
        description: 'Neue Name (optional - sunscht de vom Herkunftsserver).',
        type: ApplicationCommandOptionType.String,
        required: false,
        max_length: 32,
      },
    ],
  },
] as const;

export const EMOJI_COMMAND_NAMES = new Set(EMOJI_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name));

type EmojiCommandName = (typeof EMOJI_COMMAND_DEFINITIONS)[number]['name'];
type Actor = Awaited<ReturnType<typeof buildCommandActor>>;

interface Uebernommen {
  bytes: Uint8Array;
  name: string;
  /** Die technische Herkunft - die Kennung und die Adresse, nichts weiter. */
  notiz: string;
}

/**
 * Das Emoji aus den Optionen holen und den Namen bestimmen.
 *
 * Gibt `null` zurück und hat dann **schon geantwortet** - die Gründe sind
 * verschieden («das ist ein Standard-Emoji», «dazu gibt es kein Bild», «ohne
 * Referenzname brauchst du einen Namen»), und jeder verdient seinen eigenen
 * Satz. Ein gemeinsames «ging nicht» wäre hier der Verlust der ganzen Arbeit
 * in `fremd.ts`.
 */
async function hole(interaction: ChatInputCommandInteraction): Promise<Uebernommen | null> {
  const eingabe = interaction.options.getString('emoji', true);
  const ergebnis = await emoji.uebernehmeEmoji(eingabe);

  if (!ergebnis.ok || !ergebnis.bytes || !ergebnis.referenz) {
    await interaction.editReply({ content: ergebnis.grund ?? 'S Emoji het sich nöd hole lah.' });
    return null;
  }

  /*
   * Der Name: der gewünschte, sonst der vom Herkunftsserver.
   *
   * Kam nur eine Kennung, gibt es keinen Herkunftsnamen - dann ist der
   * Namensparameter Pflicht, und das wird gesagt statt geraten. Ein Emoji
   * `emoji_123456789012345678` zu nennen wäre ein Name, den niemand wollte.
   */
  const gewuenscht = interaction.options.getString('name');
  const name = gewuenscht ?? ergebnis.referenz.urspruenglicherName;
  if (!name) {
    await interaction.editReply({
      content: 'Zu dere Kennig ghört kein Name - gib bitte `name:` mit aa.',
    });
    return null;
  }

  return {
    bytes: ergebnis.bytes,
    name,
    // Nur Technik. Wem das Emoji gehört, weiss SwissHub nicht.
    notiz: `Discord-Emoji ${ergebnis.referenz.discordEmojiId}${
      ergebnis.referenz.urspruenglicherName ? ` (:${ergebnis.referenz.urspruenglicherName}:)` : ''
    }`,
  };
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
        await kopieren(interaction, actor);
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

async function kopieren(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
  if (!actor.can(emoji.EMOJI_PERMISSIONS.manage)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const uebernommen = await hole(interaction);
  if (!uebernommen) {
    return;
  }

  const ergebnis = await emoji.fuegeEmojiHinzu({
    name: uebernommen.name,
    bytes: uebernommen.bytes,
    akteurDiscordId: actor.discordId,
    herkunftNotiz: uebernommen.notiz,
    // Das Team darf den letzten Platz belegen - das ist eine Entscheidung.
    ohneReserve: true,
  });

  if (!ergebnis.ok || !ergebnis.emoji) {
    await interaction.editReply({ content: ergebnis.grund ?? 'Das het nöd klappt.' });
    return;
  }

  await interaction.editReply({
    content: [
      `${ergebnis.emoji.code} isch kopiert - tipp \`:${ergebnis.emoji.name}:\`.`,
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

  const uebernommen = await hole(interaction);
  if (!uebernommen) {
    return;
  }

  const ergebnis = await emoji.reicheEin({
    name: uebernommen.name,
    bytes: uebernommen.bytes,
    antragstellerId: actor.discordId,
    herkunft: 'IMPORT',
    herkunftNotiz: uebernommen.notiz,
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

/**
 * Die Community fragen.
 *
 * Braucht `emoji.vote` - die Berechtigung, die an eine Levelrolle gehen kann.
 * Entscheidet nichts: es entsteht ein Embed mit Ja-Knopf im eingestellten
 * Kanal, und erst das Stimmenziel im Zeitfenster bringt das Emoji auf den
 * Server.
 */
async function abstimmenLassen(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
  if (!actor.can(emoji.EMOJI_PERMISSIONS.voteStart)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const settings = await getModuleSettings<emoji.EmojiSettings>(emoji.EMOJI_MODULE_ID);
  if (!settings.abstimmungAktiv) {
    await interaction.editReply({
      content: 'D Community-Abstimmig isch usgschalte. S Team chas i de Modulistellige iischalte.',
    });
    return;
  }
  if (settings.abstimmungChannelId.trim().length === 0) {
    /*
     * Ohne Kanal gibt es keine Abstimmung.
     *
     * Sie trotzdem zu starten hiesse: eine Frist läuft, und niemand kann
     * klicken. Das ist schlechter, als sie nicht zu starten - deshalb hier
     * abbrechen, bevor etwas angelegt wird.
     */
    await interaction.editReply({
      content: 'Es isch kein Abstimmigskanal istellt - ohni dä chönnt niemert abstimme. Säg s em Team.',
    });
    return;
  }

  const uebernommen = await hole(interaction);
  if (!uebernommen) {
    return;
  }

  const ergebnis = await emoji.reicheEinUndStelleZurAbstimmung({
    name: uebernommen.name,
    bytes: uebernommen.bytes,
    antragstellerId: actor.discordId,
    herkunft: 'IMPORT',
    herkunftNotiz: uebernommen.notiz,
  });

  if (!ergebnis.ok || !ergebnis.antrag) {
    await interaction.editReply({ content: ergebnis.grund ?? 'Das het nöd klappt.' });
    return;
  }

  // Das Embed mit dem Ja-Knopf in den eingestellten Kanal, und die Meldung ans
  // Team daneben - das Team soll sehen, worüber abgestimmt wird.
  await Promise.all([
    emoji.schreibeAbstimmungsnachricht(ergebnis.antrag.id, { basisUrl: appUrl('') }),
    emoji.schreibeModerationsmeldung(ergebnis.antrag.id, { basisUrl: appUrl('') }),
  ]);

  await interaction.editReply({
    content: `D Abstimmig über \`:${ergebnis.antrag.name}:\` laufed i <#${settings.abstimmungChannelId}> - ${ergebnis.ziel} Stimme in ${ergebnis.minuten} Minute.`,
  });
}
