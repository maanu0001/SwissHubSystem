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
 * ## Woher Text und Adresse kommen
 *
 * Der **Text** aus der XP-Slot-Verwaltung: Titel, Beschreibung, Farbe,
 * Knopfbeschriftung, Fusszeile und Bilder sind dort einstellbar, und hier
 * steht keine Kopie davon. Was nicht eingestellt ist, kommt aus
 * `BEFEHL_VORGABEN`; ein leeres Embed gibt es nicht.
 *
 * ## Warum keine Spielzahlen mehr dabeistehen
 *
 * Einsaetze, Jackpot, Bonus und die theoretische Quote standen hier einmal
 * als Felder - automatisch angefuegt, unabhaengig davon, was die Verwaltung
 * geschrieben hatte. Das war zweierlei: ein Embed, das niemand vollstaendig
 * gestalten konnte, und eine Tabelle in einer Einladung. Wer die Zahlen
 * sucht, findet sie auf der Spielseite samt Infotafel - immer aktuell und
 * ohne dass eine Chatnachricht sie nachfuehren muss.
 *
 * Es gilt also: **im Embed steht genau, was eingestellt ist.** Nichts
 * daneben.
 *
 * Die **Adresse** aus `appUrl` - derselben zentralen Stelle, die jede andere
 * Adresse in diesem System baut, und ausdruecklich nicht aus der Konfiguration.
 * Ein Feld zum Eintippen waere auf dem naechsten Server falsch, und niemand
 * wuerde merken, dass der Knopf ins Leere fuehrt.
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
    const zustand = level.xpslot.istSpielbar(
      konfiguration,
      // Im Wartungsmodus darf die Verwaltung spielen - dann soll der Befehl
      // ihr auch den Link geben und nicht den Wartungshinweis.
      actor.can(level.LEVEL_PERMISSIONS.xpslotManage),
    );
    if (!zustand.ok) {
      await interaction.editReply({ content: zustand.grund ?? 'De XP-Slot isch grad zue.' });
      return;
    }

    /*
     * Die gespeicherte Nachricht - bei jedem Aufruf frisch gelesen.
     *
     * Kein Zwischenspeicher und kein Neustart noetig: wer den Text im
     * Dashboard aendert, sieht ihn beim naechsten `/xp-slot`. Faellt das Lesen
     * aus, liefert `befehlsEmbed` die Vorgaben - der Befehl ist eine
     * Einladung und darf daran nicht scheitern.
     */
    const nachricht = await level.xpslot.befehlsEmbed().catch(() => null);
    const embed = nachricht ?? {
      titel: level.xpslot.BEFEHL_VORGABEN.titel,
      beschreibung: level.xpslot.BEFEHL_VORGABEN.beschreibung,
      farbe: level.xpslot.farbzahl(level.xpslot.BEFEHL_VORGABEN.farbe),
      knopf: level.xpslot.BEFEHL_VORGABEN.knopf,
      fusszeile: level.xpslot.BEFEHL_VORGABEN.fusszeile,
      thumbnailUrl: null,
      bildUrl: null,
      adresse: appUrl('/level/xp-slot'),
    };

    /*
     * Nur das Eingestellte - kein Feld, das der Befehl selbst dazuerfindet.
     */
    await interaction.editReply({
      embeds: [
        {
          color: embed.farbe,
          title: embed.titel,
          description: embed.beschreibung,
          ...(embed.thumbnailUrl ? { thumbnail: { url: embed.thumbnailUrl } } : {}),
          ...(embed.bildUrl ? { image: { url: embed.bildUrl } } : {}),
          ...(embed.fusszeile ? { footer: { text: embed.fusszeile } } : {}),
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
              label: embed.knopf,
              url: embed.adresse,
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
