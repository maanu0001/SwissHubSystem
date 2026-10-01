import { AUDIT_ACTIONS, recordAudit } from '@swisshub/database';
import { discord, type GuildEmoji } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { alsDataUri, pruefeBild, pruefsummeVon } from './bild';
import { EMOJI_MODULE_ID, type EmojiSettings } from './config';
import { pruefeEmojiName } from './name';
import { platzUebersicht, pruefePlatz, type PlatzUebersicht } from './plaetze';

/**
 * Die Emojis, die auf dem Server liegen.
 *
 * ## Warum dieser Teil so klein ist
 *
 * Weil Discord die Liste führt. SwissHub spiegelt sie nicht in eine eigene
 * Tabelle - eine Kopie wäre genau die, die nach dem ersten Umbenennen auf
 * Discord falsch ist. Was hier steht, ist die Prüfung davor und der Eintrag
 * danach.
 *
 * ## Die drei Prüfungen vor jedem Upload
 *
 * 1. **Der Name.** Discord lehnt sonst mit «Invalid Form Body» ab - eine
 *    Meldung, die niemandem sagt, was zu tun ist.
 * 2. **Das Bild.** An seinen Bytes, nicht an seiner Endung.
 * 3. **Der Platz.** Getrennt für feste und animierte, weil Discord getrennt
 *    zählt.
 *
 * Alle drei geben einen Satz zurück, der sagt, was zu ändern ist.
 */

export interface KatalogEintrag extends GuildEmoji {
  /** Die Form, in der man es im Chat tippt. */
  code: string;
  /** Die Bildadresse auf Discords CDN. */
  bildUrl: string;
}

function anreichern(emoji: GuildEmoji): KatalogEintrag {
  const endung = emoji.animated ? 'gif' : 'png';
  return {
    ...emoji,
    code: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
    bildUrl: `https://cdn.discordapp.com/emojis/${emoji.id}.${endung}`,
  };
}

/** Alle Emojis des Servers, nach Art und Name geordnet. */
export async function ladeKatalog(): Promise<KatalogEintrag[]> {
  const emojis = await discord.emojis.list();
  return emojis
    .map(anreichern)
    .sort((a, b) => Number(a.animated) - Number(b.animated) || a.name.localeCompare(b.name, 'de'));
}

async function einstellungen(): Promise<EmojiSettings> {
  if (!(await isModuleEnabled(EMOJI_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Das Emoji-Modul ist derzeit ausgeschaltet.' });
  }
  return getModuleSettings<EmojiSettings>(EMOJI_MODULE_ID);
}

export interface HinzufuegenEingabe {
  name: string;
  bytes: Uint8Array;
  /** Wer es tut - für das Audit Log. */
  akteurDiscordId: string;
  /** Technische Herkunft im Klartext. Keine Aussage über Rechte. */
  herkunftNotiz?: string | null;
  /**
   * Die Reserve übergehen.
   *
   * Nur für das Team: wer `emoji.manage` hat, darf den letzten Platz belegen.
   * Für einen angenommenen Vorschlag bleibt die Reserve stehen.
   */
  ohneReserve?: boolean;
}

export interface HinzufuegenErgebnis {
  ok: boolean;
  grund?: string;
  emoji?: KatalogEintrag;
  /** Ein Hinweis, der nichts verhindert hat. */
  hinweis?: string;
}

/**
 * Ein Emoji hinzufügen.
 *
 * Gibt einen Grund zurück statt zu werfen: «der Name ist vergeben» ist eine
 * Antwort und keine Störung. Geworfen wird nur, was unerwartet ist - ein
 * abgeschaltetes Modul, ein Discord, das nicht antwortet.
 */
export async function fuegeEmojiHinzu(eingabe: HinzufuegenEingabe): Promise<HinzufuegenErgebnis> {
  const settings = await einstellungen();

  const name = pruefeEmojiName(eingabe.name);
  if (!name.ok) {
    return { ok: false, grund: name.grund };
  }

  const bild = pruefeBild(eingabe.bytes);
  if (!bild.ok || !bild.art) {
    return { ok: false, grund: bild.grund };
  }

  const [vorhandene, uebersicht] = await Promise.all([discord.emojis.list(), platzUebersicht()]);

  const namensKonflikt = vorhandene.find((emoji) => emoji.name.toLowerCase() === name.name);
  if (namensKonflikt) {
    return {
      ok: false,
      grund: `«${name.name}» gibt es schon. Discord erlaubt denselben Namen nicht zweimal.`,
    };
  }

  const platz = pruefePlatz(uebersicht, bild.animiert ?? false, settings.reservePlaetze, {
    mitReserve: !eingabe.ohneReserve,
  });
  if (!platz.ok) {
    return { ok: false, grund: platz.grund };
  }

  const emoji = await discord.emojis.create(
    { name: name.name, image: alsDataUri(eingabe.bytes, bild.art) },
    `Emoji hinzugefügt über SwissHub (${eingabe.akteurDiscordId})`,
  );

  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_ADDED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: eingabe.akteurDiscordId,
    targetLabel: emoji.name,
    success: true,
    metadata: {
      emojiId: emoji.id,
      animiert: emoji.animated,
      bytes: eingabe.bytes.length,
      pruefsumme: pruefsummeVon(eingabe.bytes),
      /*
       * Nur die technische Herkunft.
       *
       * «Hochgeladen von X» oder «geholt von cdn.discordapp.com» ist, was
       * SwissHub weiss. Ob jemand das Bild verwenden darf, weiss es nicht -
       * und behauptet es deshalb auch nicht.
       */
      herkunft: eingabe.herkunftNotiz ?? null,
    },
  });

  return {
    ok: true,
    emoji: anreichern(emoji),
    ...(bild.hinweis ? { hinweis: bild.hinweis } : {}),
  };
}

/** Ein Emoji umbenennen. */
export async function benenneEmojiUm(
  emojiId: string,
  neuerName: string,
  akteurDiscordId: string,
): Promise<HinzufuegenErgebnis> {
  await einstellungen();

  const name = pruefeEmojiName(neuerName);
  if (!name.ok) {
    return { ok: false, grund: name.grund };
  }

  const vorhandene = await discord.emojis.list();
  const ziel = vorhandene.find((emoji) => emoji.id === emojiId);
  if (!ziel) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Emoji gibt es nicht mehr.' });
  }
  if (ziel.managed) {
    return {
      ok: false,
      grund: 'Dieses Emoji gehört einer Integration - Discord lässt es nicht umbenennen.',
    };
  }
  if (ziel.name.toLowerCase() === name.name) {
    // Kein Fehler, nur nichts zu tun. Ein Discord-Aufruf dafür wäre verschenkt.
    return { ok: true, emoji: anreichern(ziel) };
  }
  const konflikt = vorhandene.find((emoji) => emoji.id !== emojiId && emoji.name.toLowerCase() === name.name);
  if (konflikt) {
    return { ok: false, grund: `«${name.name}» gibt es schon.` };
  }

  const neu = await discord.emojis.rename(
    emojiId,
    name.name,
    `Emoji umbenannt über SwissHub (${akteurDiscordId})`,
  );

  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_RENAMED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: neu.name,
    success: true,
    metadata: { emojiId, vorher: ziel.name, nachher: neu.name },
  });

  return { ok: true, emoji: anreichern(neu) };
}

/**
 * Ein Emoji löschen.
 *
 * Unwiderruflich - Discord gibt die Bytes nicht zurück. Der Audit-Eintrag
 * behält deshalb den Namen: ohne ihn stünde im Verlauf eine Kennung, zu der es
 * nichts mehr gibt.
 */
export async function loescheEmoji(emojiId: string, akteurDiscordId: string): Promise<HinzufuegenErgebnis> {
  await einstellungen();

  const vorhandene = await discord.emojis.list();
  const ziel = vorhandene.find((emoji) => emoji.id === emojiId);
  if (!ziel) {
    // Schon weg heisst: Ziel erreicht.
    return { ok: true };
  }
  if (ziel.managed) {
    return {
      ok: false,
      grund: 'Dieses Emoji gehört einer Integration - es verschwindet mit ihr, nicht von Hand.',
    };
  }

  await discord.emojis.remove(emojiId, `Emoji gelöscht über SwissHub (${akteurDiscordId})`);

  await recordAudit({
    action: AUDIT_ACTIONS.EMOJI_DELETED,
    module: EMOJI_MODULE_ID,
    actorDiscordId: akteurDiscordId,
    targetLabel: ziel.name,
    success: true,
    metadata: { emojiId, animiert: ziel.animated },
  });

  return { ok: true };
}

/** Der Platzstand - hier mitexportiert, damit das Dashboard einen Einstieg hat. */
export async function ladePlatzstand(): Promise<PlatzUebersicht> {
  return platzUebersicht();
}
