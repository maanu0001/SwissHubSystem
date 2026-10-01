import { Events, MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { emoji } from '@swisshub/modules';
import { buildCommandActor } from './commands/context';

const log = createLogger('bot:emoji');

/**
 * Die Knöpfe des Emoji-Moduls.
 *
 * ## Vier Knöpfe, zwei Arten von Berechtigung
 *
 * «Annehmen», «Ablehnen» und «Abstimmen lassen» stehen in der
 * Moderationsmeldung und brauchen `emoji.moderate` - **geprüft hier, bei jedem
 * Klick**. Dass die Nachricht in einem Kanal steht, den nur das Team sieht, ist
 * keine Prüfung: ein Kanal kann umkonfiguriert werden, und eine Kennung aus
 * einem Button lässt sich nachbauen.
 *
 * Der Stimmknopf braucht keine eigene Berechtigung - abstimmen darf, wer auf
 * dem Server ist. Die Eindeutigkeit sitzt in der Datenbank
 * (`@@unique([antragId, discordId])`) und nicht in einer Rechnung hier.
 *
 * ## Was nach dem Klick passiert
 *
 * Die Antwort an die Person ist privat. Die Nachricht, auf der geklickt wurde,
 * wird fortgeschrieben - sonst zeigt sie weiter den alten Stand, und der
 * nächste klickt auf einen Knopf, der nichts mehr tut.
 */
export function registerEmojiButtons(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const treffer = emoji.parseKnopfId(interaction.customId);
    if (!treffer) {
      // Ein Klick eines anderen Moduls. Nicht unsere Sache.
      return;
    }
    void behandleKlick(interaction, treffer.art, treffer.antragId);
  });
}

async function behandleKlick(
  interaction: ButtonInteraction,
  art: emoji.KnopfArt,
  antragId: string,
): Promise<void> {
  try {
    /*
     * Sofort bestätigen.
     *
     * Discord erwartet innerhalb von drei Sekunden eine Antwort. Ein Upload zu
     * Discord dauert länger als das - und eine verpasste Frist zeigt «Diese
     * Interaktion ist fehlgeschlagen», obwohl das Emoji entsteht.
     */
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (art === 'stimme') {
      await behandleStimme(interaction, antragId);
      return;
    }
    await behandleModeration(interaction, art, antragId);
  } catch (error) {
    log.warn('Emoji-Klick gescheitert', { art, antragId, error });
    if (interaction.deferred) {
      await interaction.editReply({ content: 'Das het leider nöd klappt.' }).catch(() => undefined);
    }
  }
}

async function behandleStimme(interaction: ButtonInteraction, antragId: string): Promise<void> {
  const ergebnis = await emoji.stimmeAb(antragId, interaction.user.id);

  switch (ergebnis.art) {
    case 'gezaehlt':
      await interaction.editReply({
        content: `Danke - ${ergebnis.stimmen} vo ${ergebnis.ziel} Stimme.`,
      });
      break;

    case 'ziel_erreicht':
      await interaction.editReply({
        content: ergebnis.grund
          ? `S Ziel isch erreicht, aber s Uflade het nöd klappt: ${ergebnis.grund}`
          : 'Dini Stimm het s Ziel erreicht - s Emoji isch jetzt uf em Server.',
      });
      break;

    case 'schon_gestimmt':
      // Doppelklick. Keine zweite Stimme, und auch kein Vorwurf.
      await interaction.editReply({
        content: `Du hesch scho gstimmt - ${ergebnis.stimmen} vo ${ergebnis.ziel}.`,
      });
      break;

    case 'abgelaufen':
      await interaction.editReply({ content: 'D Frischt isch verbi. Die Stimm zählt nöd mehr.' });
      break;

    case 'nicht_offen':
      await interaction.editReply({ content: 'Für de Vorschlag laufed kei Abstimmig mehr.' });
      break;

    case 'ausgeschaltet':
      await interaction.editReply({ content: 'D Abstimmig isch grad usgschalte.' });
      break;
  }

  // Der Stand gehört an die Nachricht, auf der geklickt wird.
  await emoji.schreibeAbstimmungsnachricht(antragId, {
    basisUrl: appUrl(''),
    nurAktualisieren: true,
  });
  await emoji.schreibeModerationsmeldung(antragId, {
    basisUrl: appUrl(''),
    nurAktualisieren: true,
  });
}

async function behandleModeration(
  interaction: ButtonInteraction,
  art: 'annehmen' | 'ablehnen' | 'abstimmung',
  antragId: string,
): Promise<void> {
  /*
   * Die Berechtigung wird hier geprüft, nicht am Kanal.
   *
   * Dieselben Rollen-Zuordnungen wie im Dashboard - `buildCommandActor`. Wer
   * im Dashboard entscheiden darf, darf es hier; und sonst niemand, auch wenn
   * er die Nachricht sieht.
   */
  const actor = await buildCommandActor(interaction);
  if (!actor.can(emoji.EMOJI_PERMISSIONS.moderate)) {
    await interaction.editReply({ content: 'Du hesch kei Berächtigung, über Vorschläg z entscheide.' });
    return;
  }

  if (art === 'annehmen') {
    const ergebnis = await emoji.nimmAn(antragId, actor.discordId);
    await interaction.editReply({
      content: ergebnis.ok ? 'Agnoh - s Emoji isch uf em Server.' : (ergebnis.grund ?? 'Das het nöd klappt.'),
    });
  } else if (art === 'ablehnen') {
    /*
     * Ohne Grund.
     *
     * Ein Modal für die Begründung wäre schöner, aber der Knopf soll in einem
     * Klick funktionieren - und ein Grund lässt sich im Dashboard nachtragen.
     * Eine Ablehnung, die an einem Formular hängt, bleibt liegen.
     */
    const ergebnis = await emoji.lehneAb(antragId, actor.discordId, null);
    await interaction.editReply({
      content: ergebnis.ok ? 'Abgleht.' : (ergebnis.grund ?? 'Das het nöd klappt.'),
    });
  } else {
    const ergebnis = await emoji.starteAbstimmung(antragId, actor.discordId);
    if (ergebnis.ok) {
      await emoji.schreibeAbstimmungsnachricht(antragId, { basisUrl: appUrl('') });
    }
    await interaction.editReply({
      content: ergebnis.ok ? 'D Community stimmt jetzt ab.' : (ergebnis.grund ?? 'Das het nöd klappt.'),
    });
  }

  // Die Meldung zeigt danach den neuen Zustand und keine Knöpfe mehr.
  await emoji.schreibeModerationsmeldung(antragId, {
    basisUrl: appUrl(''),
    nurAktualisieren: true,
  });
}
