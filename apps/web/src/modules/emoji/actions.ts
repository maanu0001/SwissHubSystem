'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { appUrl } from '@swisshub/config';
import { emoji, getModuleSettings } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Die Aktionen des Emoji-Bereichs.
 *
 * ## Warum Bilder als Base64 ankommen
 *
 * Eine Server Action nimmt ein einfaches Objekt - keine `File`. Ein Emoji ist
 * höchstens 256 KB gross; Base64 macht daraus rund 350 KB, und das ist eine
 * Zeile im Netzwerkprotokoll und keine Architekturentscheidung. Der Umweg über
 * einen eigenen Upload-Endpunkt wäre eine zweite Tür mit eigener Prüfung.
 *
 * Geprüft werden danach die **Bytes**. Was der Browser als Typ behauptet, steht
 * nirgends in der Rechnung: `pruefeBild` liest die ersten Bytes, und nur die.
 *
 * ## Die Trennung der Berechtigungen
 *
 * `emoji.manage` fügt hinzu, benennt um, löscht - ohne Vorschlagsweg.
 * `emoji.moderate` entscheidet über Vorschläge. `emoji.request` reicht einen
 * ein. Drei Dinge, drei Berechtigungen; wer Texte pflegt, soll nicht
 * zwangsläufig löschen dürfen.
 */

const PFAD = '/server/emojis';

/** Base64 zu Bytes - mit einer Grenze, bevor etwas dekodiert wird. */
function bytesAus(base64: string): Uint8Array {
  /*
   * Erst die Länge, dann das Dekodieren.
   *
   * Base64 wächst um ein Drittel; wer eine Zeichenkette von zwei Megabyte
   * schickt, soll keine zwei Megabyte Speicher auslösen, bevor abgelehnt wird.
   */
  const grenze = Math.ceil((emoji.EMOJI_MAX_BYTES * 4) / 3) + 128;
  if (base64.length > grenze) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Bild ist grösser als ${Math.round(emoji.EMOJI_MAX_BYTES / 1024)} KB.`,
    });
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

const bildSchema = z
  .object({
    /** Das Bild als Base64 - ohne `data:`-Vorsatz. */
    base64: z.string().min(1).optional(),
    /** Der Anzeigename der Datei. Wird nie zum Pfad. */
    dateiName: z.string().max(200).optional(),
    /** Alternativ: eine Adresse, von der geholt werden darf. */
    quelle: z.string().url().max(1000).optional(),
  })
  .refine((wert) => Boolean(wert.base64) !== Boolean(wert.quelle), {
    message: 'Entweder eine Datei oder eine Adresse - nicht beides und nicht keines.',
  });

/**
 * Die Bytes besorgen, egal auf welchem Weg.
 *
 * Gemeinsam für «hinzufügen» und «vorschlagen»: beide Wege haben dieselben zwei
 * Quellen, und eine zweite Umsetzung wäre die, in der der Import eines Tages
 * ungeprüft bleibt.
 */
async function besorgeBytes(eingabe: z.infer<typeof bildSchema>): Promise<{
  bytes: Uint8Array;
  herkunft: 'UPLOAD' | 'IMPORT';
  notiz: string | null;
}> {
  if (eingabe.base64) {
    return {
      bytes: bytesAus(eingabe.base64),
      herkunft: 'UPLOAD',
      notiz: eingabe.dateiName ?? null,
    };
  }

  const settings = await getModuleSettings<emoji.EmojiSettings>(emoji.EMOJI_MODULE_ID);
  const hosts = emoji.erlaubteHostsAus(settings.erlaubteHosts);
  const ergebnis = await emoji.holeBild(eingabe.quelle ?? '', hosts);
  if (!ergebnis.ok || !ergebnis.bytes) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: ergebnis.grund ?? 'Das Bild liess sich nicht laden.',
    });
  }
  return { bytes: ergebnis.bytes, herkunft: 'IMPORT', notiz: ergebnis.quelle ?? null };
}

function aktualisiere(): void {
  revalidatePath(PFAD);
}

/** Ein Emoji unmittelbar hinzufügen - ohne Vorschlagsweg. */
export const fuegeEmojiHinzuAction = defineAction(
  {
    name: 'emoji.hinzufuegen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.manage,
    rateLimit: 'emojiSchreiben',
    schema: z.intersection(z.object({ name: z.string().min(1).max(64) }), bildSchema),
  },
  async ({ ctx, input }) => {
    const quelle = await besorgeBytes(input);
    const ergebnis = await emoji.fuegeEmojiHinzu({
      name: input.name,
      bytes: quelle.bytes,
      akteurDiscordId: ctx.user.discordId,
      herkunftNotiz: quelle.notiz,
      // Das Team darf den letzten Platz belegen - das ist eine Entscheidung.
      ohneReserve: true,
    });
    aktualisiere();
    return ergebnis;
  },
);

export const benenneEmojiUmAction = defineAction(
  {
    name: 'emoji.umbenennen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.manage,
    rateLimit: 'emojiSchreiben',
    schema: z.object({ emojiId: z.string().min(1).max(32), name: z.string().min(1).max(64) }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await emoji.benenneEmojiUm(input.emojiId, input.name, ctx.user.discordId);
    aktualisiere();
    return ergebnis;
  },
);

export const loescheEmojiAction = defineAction(
  {
    name: 'emoji.loeschen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.manage,
    rateLimit: 'emojiSchreiben',
    schema: z.object({ emojiId: z.string().min(1).max(32) }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await emoji.loescheEmoji(input.emojiId, ctx.user.discordId);
    aktualisiere();
    return ergebnis;
  },
);

/**
 * Einen Vorschlag einreichen.
 *
 * Die Kennung kommt aus der Sitzung, nie aus der Eingabe - sonst reichte jemand
 * im Namen eines anderen ein, und die Grenze «so viele offene je Mitglied»
 * wäre umgehbar.
 */
export const reicheEmojiEinAction = defineAction(
  {
    name: 'emoji.vorschlagen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.request,
    rateLimit: 'emojiVorschlagen',
    schema: z.intersection(
      z.object({
        name: z.string().min(1).max(64),
        begruendung: z.string().max(400).nullish(),
      }),
      bildSchema,
    ),
  },
  async ({ ctx, input }) => {
    const quelle = await besorgeBytes(input);
    const ergebnis = await emoji.reicheEin({
      name: input.name,
      bytes: quelle.bytes,
      antragstellerId: ctx.user.discordId,
      herkunft: quelle.herkunft,
      herkunftNotiz: quelle.notiz,
      begruendung: input.begruendung ?? null,
    });
    if (ergebnis.ok && ergebnis.antrag) {
      // Die Meldung ans Team. Ein falsch gesetzter Kanal darf keinen Vorschlag
      // verlieren - deshalb erst speichern, dann melden.
      await emoji.schreibeModerationsmeldung(ergebnis.antrag.id, { basisUrl: appUrl('') });
    }
    aktualisiere();
    return ergebnis;
  },
);

export const nimmEmojiAntragAnAction = defineAction(
  {
    name: 'emoji.annehmen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.moderate,
    rateLimit: 'emojiSchreiben',
    schema: z.object({ antragId: z.string().min(1).max(64) }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await emoji.nimmAn(input.antragId, ctx.user.discordId);
    await emoji.schreibeModerationsmeldung(input.antragId, {
      basisUrl: appUrl(''),
      nurAktualisieren: true,
    });
    aktualisiere();
    return ergebnis;
  },
);

export const lehneEmojiAntragAbAction = defineAction(
  {
    name: 'emoji.ablehnen',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.moderate,
    rateLimit: 'emojiSchreiben',
    schema: z.object({
      antragId: z.string().min(1).max(64),
      grund: z.string().max(400).nullish(),
    }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await emoji.lehneAb(input.antragId, ctx.user.discordId, input.grund ?? null);
    await emoji.schreibeModerationsmeldung(input.antragId, {
      basisUrl: appUrl(''),
      nurAktualisieren: true,
    });
    aktualisiere();
    return ergebnis;
  },
);

export const starteEmojiAbstimmungAction = defineAction(
  {
    name: 'emoji.abstimmung',
    module: emoji.EMOJI_MODULE_ID,
    permission: emoji.EMOJI_PERMISSIONS.moderate,
    rateLimit: 'emojiSchreiben',
    schema: z.object({ antragId: z.string().min(1).max(64) }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await emoji.starteAbstimmung(input.antragId, ctx.user.discordId);
    if (ergebnis.ok) {
      await Promise.all([
        emoji.schreibeAbstimmungsnachricht(input.antragId, { basisUrl: appUrl('') }),
        emoji.schreibeModerationsmeldung(input.antragId, {
          basisUrl: appUrl(''),
          nurAktualisieren: true,
        }),
      ]);
    }
    aktualisiere();
    return ergebnis;
  },
);
