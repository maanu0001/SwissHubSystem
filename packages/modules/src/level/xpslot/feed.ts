import { appUrl } from '@swisshub/config';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import type { XpSlotSpin } from '@swisshub/database';
import type { SlotKonfiguration } from './konfiguration';
import { gewinnstufe } from './auswertung';

const log = createLogger('level:xpslot:feed');

/**
 * Die Gewinnmeldung auf Discord.
 *
 * ## Was gemeldet wird - und was nie
 *
 * Nur Jackpot, Premium-Gewinn und, wenn eingeschaltet, Big und Mega Win.
 * **Nie** ein gewoehnlicher Gewinn: bei einem Automaten, der in vier von zehn
 * Spins etwas zahlt, waere ein Kanal mit jedem Gewinn ein Kanal, den nach
 * einer Stunde niemand mehr liest. Jede der drei Arten ist einzeln
 * schaltbar, und ohne gewaehlten Kanal passiert gar nichts.
 *
 * ## Warum das nichts abbricht
 *
 * Der Spin ist gebucht, bevor diese Funktion laeuft. Ein Discord, das nicht
 * antwortet, darf einen Gewinn nicht zurueckdrehen - die Meldung ist die
 * Beigabe, nicht das Wesentliche. Fehlschlaege stehen im Protokoll.
 *
 * ## Warum nie ein Ping
 *
 * `allowedMentions: { parse: [] }`. Die Meldung enthaelt `<@id>`, weil
 * Discord daraus den Namen macht - nicht, um jemanden zu rufen. Wer zehnmal
 * am Abend gross gewinnt, soll den Kanal nicht zehnmal aufschrecken.
 *
 * ## Testlaeufe tauchen nicht auf
 *
 * Ein erzwungener Jackpot aus dem Testmodus ist kein Jackpot. Er wird hier
 * zuerst abgewiesen, noch vor der Frage, ob der Kanal eingestellt ist.
 */

/** Dasselbe Rot wie in den uebrigen Embeds. */
const FARBE = 0x83060a;

export async function meldeGewinn(spin: XpSlotSpin, konfiguration: SlotKonfiguration): Promise<void> {
  if (spin.kind === 'TEST') {
    return;
  }
  const { config, wirksam } = konfiguration;
  if (!config.feedChannelId) {
    return;
  }

  const stufe = gewinnstufe(
    spin.grossWin,
    spin.bet,
    { gross: wirksam.tierGross, mega: wirksam.tierMega },
    spin.jackpot,
  );

  const grund =
    spin.jackpot && config.feedJackpot
      ? 'jackpot'
      : spin.premiumDays > 0 && config.feedPremium
        ? 'premium'
        : (stufe === 'gross' || stufe === 'mega') && config.feedBigWin
          ? 'gross'
          : null;
  if (!grund) {
    return;
  }

  const titel =
    grund === 'jackpot'
      ? 'JACKPOT im XP-Slot'
      : grund === 'premium'
        ? 'Premium im XP-Slot gewonnen'
        : stufe === 'mega'
          ? 'Mega Win im XP-Slot'
          : 'Big Win im XP-Slot';

  const felder: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Einsatz', value: `${spin.bet} XP`, inline: true },
  ];
  if (spin.grossWin > 0) {
    felder.push({
      name: 'Gewinn',
      value: `${spin.grossWin} XP (${(spin.grossWin / Math.max(1, spin.bet)).toFixed(1)}x)`,
      inline: true,
    });
  }
  if (spin.premiumDays > 0) {
    felder.push({ name: 'Premium', value: `${spin.premiumDays} Tage`, inline: true });
  }
  if (spin.kind !== 'PAID') {
    felder.push({ name: 'Art', value: 'Freispiel', inline: true });
  }

  try {
    await discord.channels.send(config.feedChannelId, {
      embeds: [
        {
          color: FARBE,
          title: titel,
          description: `<@${spin.discordId}>`,
          fields: felder,
          url: appUrl('/level/xp-slot'),
          timestamp: spin.createdAt.toISOString(),
        },
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    log.warn('Gewinnmeldung liess sich nicht stellen', {
      spinId: spin.id,
      channelId: config.feedChannelId,
      error,
    });
  }
}
