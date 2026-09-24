import { Events, MessageFlags, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';

const log = createLogger('bot:altlasten');

/**
 * Knoepfe, die es nicht mehr gibt.
 *
 * ## Das Problem
 *
 * Eine Discord-Nachricht bleibt stehen, auch wenn der Code dahinter weg ist.
 * Die Spielersuche hat monatelang Nachrichten mit «Mitmache»-, «Verlah»- und
 * «Schliesse»-Knoepfen in den Kanal gestellt; die stehen dort weiterhin. Wer
 * einen davon drueckt, bekommt nach drei Sekunden «Diese Interaktion ist
 * fehlgeschlagen» - eine Fehlermeldung, die nichts erklaert und aussieht, als
 * waere der Bot kaputt.
 *
 * ## Die Antwort
 *
 * Ein Satz, nur fuer den Klickenden sichtbar, der sagt was los ist. Kein
 * Fehler, keine unerwartete Aktion - und vor allem nichts, was noch etwas
 * veraendert: die Suchen, zu denen diese Knoepfe gehoerten, gibt es nicht
 * mehr.
 *
 * ## Warum das hier stehen bleibt
 *
 * Solange die alten Nachrichten im Kanal stehen. Sie pauschal zu loeschen
 * waere ein Eingriff in fremde Kanaele, und es sind Gespraeche, an denen
 * Leute teilgenommen haben. Diese Datei kostet nichts und faengt sie ab.
 */

/**
 * Die Kennungen der alten Knoepfe.
 *
 * Zwei Schreibweisen, weil der Vorgaenger-Bot eine andere verwendete und
 * beide in bestehenden Nachrichten stehen.
 */
const ABGESCHALTETE_KNOEPFE = new Set<string>([
  'swisshub:spielersuche:join',
  'swisshub:spielersuche:leave',
  'swisshub:spielersuche:close',
  'swisshub:spielersuche:help',
  'swisshub_spielersuche:join',
  'swisshub_spielersuche:leave',
  'swisshub_spielersuche:close',
  'swisshub_spielersuche:help',
]);

export function registerAbgeschalteteKnoepfe(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton() || !ABGESCHALTETE_KNOEPFE.has(interaction.customId)) {
      return;
    }

    log.info('Knopf einer abgeschalteten Funktion gedrückt', {
      customId: interaction.customId,
      userId: interaction.user.id,
    });

    void interaction
      .reply({
        content:
          'Die Spielersuche gibt es nicht mehr. Wer heute Abend Mitspieler sucht, macht eine Runde bei **Was spielen wir?** auf - im Dashboard oder mit `/was-spielen-wir`.',
        flags: MessageFlags.Ephemeral,
      })
      .catch((error: unknown) => log.warn('Antwort auf alten Knopf fehlgeschlagen', { error }));
  });
}
