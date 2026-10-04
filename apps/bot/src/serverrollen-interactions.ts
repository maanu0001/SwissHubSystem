import { Events, MessageFlags, type Client, type StringSelectMenuInteraction } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { serverrollen } from '@swisshub/modules';

const log = createLogger('bot:serverrollen');

/**
 * Das Rollenmenue im Kanal.
 *
 * ## Was der Bot hier entscheidet: nichts
 *
 * Aus der Interaktion kommen zwei Angaben: die Gruppe (aus der eigenen
 * Kennung) und die angekreuzten Werte. Beide gehen unveraendert an
 * `serverrollen.setzeGruppenauswahl`, und dort wird geprueft - gegen die
 * Rollen, die wirklich zu dieser Gruppe gehoeren, gegen die Freigabe, gegen
 * die Discord-Rechte der Rolle, gegen `managed` und gegen die Bot-Hierarchie.
 *
 * Dass die Pruefung dort liegt und nicht hier, ist der Punkt: dieselbe
 * Funktion steht hinter der Webseite. Zwei Tueren mit zwei Regelwerken waeren
 * zwei Gelegenheiten, eine Regel zu vergessen.
 *
 * ## Warum die Antwort nur der Aufrufer sieht
 *
 * Weil sie ihn betrifft. «Du hast jetzt Valorant» im Kanal waere eine
 * Benachrichtigung fuer alle anderen, und eine Absage waere eine kleine
 * Blossstellung. Ausserdem wuerde ein Kanal mit einem beliebten Menue sonst
 * aus Botmeldungen bestehen.
 */
export function registerServerrollenInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }
    if (serverrollen.leseGruppenId(interaction.customId) === null) {
      return;
    }
    void behandleWahl(interaction).catch((fehler: unknown) => melde(interaction, fehler));
  });
}

async function behandleWahl(interaction: StringSelectMenuInteraction): Promise<void> {
  const gruppenId = serverrollen.leseGruppenId(interaction.customId);
  if (!gruppenId) {
    return;
  }

  /*
   * Erst aufschieben, dann arbeiten.
   *
   * Die Auswahl laeuft ueber mehrere Discord-Aufrufe - Mitglied lesen, Rollen
   * setzen, nachsehen. Discord gibt drei Sekunden fuer die erste Antwort; ohne
   * `deferReply` sieht die Person «Interaktion fehlgeschlagen», obwohl alles
   * durchlaeuft.
   */
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.inGuild()) {
    await interaction.editReply({ content: 'Das geht nur auf dem Server.' });
    return;
  }

  /*
   * Die Option «Keine» ist keine Rolle.
   *
   * Sie steht nur in Exklusivgruppen und bedeutet «nichts aus dieser Gruppe».
   * Herausgefiltert wird sie hier, weil sie eine Angelegenheit der Darstellung
   * ist: der Dienst kennt nur Rollenkennungen und eine leere Auswahl.
   */
  const gewaehlt = interaction.values.filter((wert) => wert !== serverrollen.KEINE_WAHL);

  const ergebnis = await serverrollen.setzeGruppenauswahl(interaction.user.id, gruppenId, gewaehlt);
  await interaction.editReply({ content: ergebnis.nachricht });
}

/**
 * Ein Fehlschlag wird beantwortet, nicht geschluckt.
 *
 * Ohne Antwort haengt die Interaktion und Discord zeigt nach drei Sekunden
 * seine eigene Fehlermeldung - die sagt nichts. `AppError` traegt einen Text
 * fuer Menschen; alles andere bekommt einen allgemeinen, und der Grund steht
 * im Serverlog.
 */
async function melde(interaction: StringSelectMenuInteraction, fehler: unknown): Promise<void> {
  const text = fehler instanceof AppError ? fehler.userMessage : 'Das hat leider nicht geklappt.';
  log.warn('Rollenmenü gescheitert', {
    customId: interaction.customId,
    discordId: interaction.user.id,
    grund: fehler instanceof Error ? fehler.message : 'unbekannt',
  });
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text });
    } else {
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Wenn selbst die Fehlermeldung nicht durchgeht, ist die Interaktion
    // abgelaufen. Dann ist nichts mehr zu retten und nichts mehr zu melden.
  }
}
