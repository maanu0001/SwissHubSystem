import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { appUrl } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { isModuleEnabled, level } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './context';

const log = createLogger('bot:commands:xpslot');

/**
 * `/xp-slot`.
 *
 * ## Was dieser Befehl ist - und was nicht
 *
 * Eine Einladung. Er schickt ein Embed mit einem Knopf, der in die WebApp
 * fuehrt. **Es wird hier nicht gespielt**: kein Spin, keine XP-Buchung, kein
 * Einsatz, kein Freispiel. Ein Spielautomat in einer Chatnachricht waere ein
 * zweiter Spielablauf mit eigener Zustandshaltung, eigener Idempotenz und
 * eigener Wiederholungssperre - und der erste wuerde es nicht merken, wenn
 * der zweite daneben XP ausgibt.
 *
 * ## Woher die Adresse kommt
 *
 * Aus `appUrl` - derselben zentralen Stelle, die jede andere Adresse in
 * diesem System baut. Es steht hier kein Hostname im Code: auf dem naechsten
 * Server waere er falsch, und niemand wuerde merken, dass der Knopf ins
 * Leere fuehrt.
 *
 * ## Wie der Befehl geschaltet wird
 *
 * Ueber die bestehende zentrale Verwaltung, nicht ueber eine zweite Tabelle:
 *
 *  - **aktiv/inaktiv** ist der Modulstatus des Level-Systems plus der Status
 *    des Slots. Ist das Modul aus oder der Slot abgeschaltet, antwortet der
 *    Befehl mit dem Grund - und nicht mit einem Knopf auf eine geschlossene
 *    Seite.
 *  - **Rollen** sind die Berechtigung `level.xpslot.play`, aufgeloest ueber
 *    `buildCommandActor` - dieselbe Rollenzuordnung wie im Dashboard. Es gibt
 *    keine festen Rollenkennungen im Code; wer spielen darf, entscheidet die
 *    Rollenverwaltung.
 *
 * ## Warum ephemer
 *
 * Weil die Antwort eine Quittung ist. Wer `/xp-slot` tippt, will den Link -
 * und nicht, dass der halbe Kanal ihn bekommt. Grosse Gewinne landen im
 * Kanal, wenn das Team einen Feed einrichtet; das ist die andere Richtung.
 */

export const XPSLOT_COMMAND_DEFINITIONS = [
  {
    name: 'xp-slot',
    description: 'Zeigt de XP-Slot und de Link zum Spiele.',
    dmPermission: false,
    options: [],
  },
] as const;

export const XPSLOT_COMMAND_NAMES: ReadonlySet<string> = new Set<string>(
  XPSLOT_COMMAND_DEFINITIONS.map((eintrag) => eintrag.name),
);

/** Dasselbe Rot wie in den uebrigen Embeds des Level-Systems. */
const FARBE = 0x83060a;

export async function handleXpSlotCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!XPSLOT_COMMAND_NAMES.has(interaction.commandName)) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
      await interaction.editReply({ content: 'S Level-System isch grad usgschalte.' });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(level.LEVEL_PERMISSIONS.xpslotPlay)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const konfiguration = await level.xpslot.leseKonfiguration();
    const zustand = level.xpslot.istSpielbar(konfiguration);
    if (!zustand.ok) {
      await interaction.editReply({ content: zustand.grund ?? 'De XP-Slot isch grad zue.' });
      return;
    }

    const ansicht = await level.xpslot.slotAnsicht(konfiguration);
    const adresse = appUrl('/level/xp-slot');
    const w = konfiguration.wirksam;

    /*
     * Die Zahlen im Embed kommen aus der Konfiguration, nicht aus dem Text.
     *
     * Ein Embed mit festen Zahlen waere nach der ersten Aenderung an der
     * Auszahlungstabelle falsch - und niemand wuerde es nachfuehren.
     */
    await interaction.editReply({
      embeds: [
        {
          color: FARBE,
          title: 'XP-Slot',
          description: [
            `Fünf Walzen, ${ansicht.linien.length} Linien. Gespielt wird mit dine XP i de WebApp.`,
            ansicht.eventName ? `**Grad laufend:** ${ansicht.eventName}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
          fields: [
            { name: 'Einsätz', value: `${ansicht.einsaetze.join(', ')} XP`, inline: true },
            {
              name: 'Jackpot',
              value: `${w.jackpotMultiplikator}× Isatz bi fünf Logo`,
              inline: true,
            },
            {
              name: 'Bonus',
              value: `${w.bonusAusloeser} Bonussymbol → ${w.bonusFreispiele} Freispiel`,
              inline: true,
            },
            {
              name: 'Theoretischi Quote',
              value: `${(ansicht.rtp * 100).toFixed(1)} % über vieli Spins`,
              inline: true,
            },
          ],
          footer: { text: 'Spiel bewusst mit dine XP.' },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              // Ein Link-Knopf, kein `custom_id`: er fuehrt in die WebApp und
              // loest hier nichts aus. Alles andere waere ein zweiter
              // Spielablauf auf Discord.
              style: 5,
              label: 'XP-Slot öffne',
              url: adresse,
            },
          ],
        },
      ],
    });
  } catch (error) {
    const fehler = error instanceof AppError ? error.userMessage : 'Das het leider nöd klappt.';
    log.warn('XP-Slot-Befehl gescheitert', {
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await interaction.editReply({ content: fehler });
  }
}
