import { Events, MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { fragt } from '@swisshub/modules';

const log = createLogger('bot:fragt');

/**
 * Button-Klicks der Fragen von «SwissHub fragt».
 *
 * Die Stimmzaehlung liegt im Modul (`fragt.stimmeAb`) und ist dort ueber die
 * Bedingung `@@unique([abstimmungId, voterDiscordId])` abgesichert. Hier geht
 * es nur um die Discord-Seite: Klick entgegennehmen, Ergebnis zurueckmelden,
 * und bei oeffentlichem Zwischenstand das Embed nachziehen.
 *
 * ## Warum die Antwort immer privat ist
 *
 * `MessageFlags.Ephemeral` - nur die Person sieht sie. Eine sichtbare Antwort
 * «Anna hat fuer Minecraft gestimmt» waere eine Offenlegung des eigenen
 * Stimmverhaltens gegenueber dem ganzen Kanal, und sie wuerde die naechsten
 * Stimmen beeinflussen.
 */
export function registerFragtHandler(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const treffer = fragt.parseButtonId(interaction.customId);
    if (!treffer) {
      // Ein Klick eines anderen Moduls. Nicht unsere Sache.
      return;
    }
    void behandleKlick(interaction, treffer.abstimmungId, treffer.optionId);
  });
}

async function behandleKlick(
  interaction: ButtonInteraction,
  abstimmungId: string,
  optionId: string,
): Promise<void> {
  try {
    /*
     * Sofort bestaetigen.
     *
     * Discord erwartet innerhalb von drei Sekunden eine Antwort. Die Zaehlung
     * ist schneller, aber eine langsame Datenbank oder ein Embed-Update
     * daneben waeren es nicht - und eine verpasste Frist zeigt dem Mitglied
     * «Diese Interaktion ist fehlgeschlagen», obwohl die Stimme zaehlt.
     */
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ausgang = await fragt.stimmeAb(abstimmungId, optionId, { discordId: interaction.user.id });

    switch (ausgang.art) {
      case 'gezaehlt':
        await interaction.editReply({ content: `Danke - deine Stimme für **${ausgang.label}** zählt.` });
        break;

      case 'geaendert':
        await interaction.editReply({
          content: `Geändert: von **${ausgang.vorher}** auf **${ausgang.label}**. Es zählt nur deine aktuelle Stimme.`,
        });
        break;

      case 'unveraendert':
        // Doppelklick. Keine zweite Stimme, und auch kein Vorwurf.
        await interaction.editReply({
          content: `Du hast schon für **${ausgang.label}** gestimmt. Alles gut - du kannst bis zum Ende wechseln.`,
        });
        break;

      case 'beendet':
        await interaction.editReply({
          content: 'Diese Abstimmung ist beendet. Das Ergebnis steht oben im Beitrag.',
        });
        return;

      case 'unbekannt':
        /*
         * Die Abstimmung oder die Antwort gibt es nicht.
         *
         * Im Alltag: eine sehr alte Nachricht, deren Abstimmung geloescht
         * wurde. Denkbar auch ein nachgebauter Button - dann ist genau das die
         * richtige Antwort, und die Pruefung im Modul hat gegriffen.
         */
        await interaction.editReply({ content: 'Diese Abstimmung gibt es nicht mehr.' });
        return;
    }

    /*
     * Das Embed nachziehen - nur bei oeffentlichem Zwischenstand.
     *
     * `aktualisiereZwischenstand` prueft das selbst und tut sonst nichts. Der
     * Aufruf steht trotzdem hinter dem `await editReply`: die Person hat ihre
     * Antwort dann schon, und ein Discord, das beim Bearbeiten zoegert,
     * verzoegert nicht ihre Bestaetigung.
     */
    await fragt.aktualisiereZwischenstand(abstimmungId);
  } catch (fehler) {
    log.error('Stimme konnte nicht verarbeitet werden', { fehler, abstimmungId, optionId });
    const meldung = 'Deine Stimme lässt sich gerade nicht verarbeiten. Bitte später noch einmal.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: meldung }).catch(() => undefined);
    } else {
      await interaction.reply({ content: meldung, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}
