'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { appUrl } from '@swisshub/config';
import { resolveGuildId } from '@swisshub/discord';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Was die Community selbst tut: einreichen, abstimmen, melden.
 *
 * Alles Selbstbedienung - jede Aktion wirkt auf den eigenen Clip, die eigene
 * Stimme, die eigene Meldung. Die Verwaltung steht in `admin-actions.ts`.
 *
 * Die Kennung des Handelnden kommt in jedem Fall aus der Sitzung. Eine
 * `discordId` aus dem Formular gibt es nicht - sie waere die Einladung, im
 * Namen anderer zu stimmen.
 */

const handelnder = (ctx: AuthContext): clips.Handelnder => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  displayName: ctx.user.displayName,
  avatarHash: ctx.user.avatarHash,
});

const neuLaden = (): void => {
  revalidatePath(systemRoutes.clips());
  revalidatePath(systemRoutes.clipEinreichen());
};

export const clipEinreichenAction = defineAction(
  {
    name: 'clips.submit',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.submit,
    schema: z.object({
      // Die Adresse wird hier nur grob begrenzt. Was ein gueltiger Clip ist,
      // entscheidet `erkenneClip()` - an genau einer Stelle, damit Browser
      // und Server nicht zwei verschiedene Meinungen dazu haben koennen.
      url: z.string().trim().min(8).max(500),
      titel: z.string().trim().min(3).max(120),
      beschreibung: z.string().trim().max(500).optional(),
      gameId: z.string().cuid().optional(),
      gameName: z.string().trim().max(60).optional(),
      rechteBestaetigt: z.literal(true, {
        errorMap: () => ({ message: 'Bitte bestätigen, dass der Clip verwendet werden darf.' }),
      }),
    }),
    rateLimit: 'clipSubmit',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const ergebnis = await clips.reicheEin(guildId, handelnder(ctx), {
      url: input.url,
      titel: input.titel,
      beschreibung: input.beschreibung ?? null,
      gameId: input.gameId ?? null,
      gameName: input.gameName ?? null,
    });
    neuLaden();
    return { entryId: ergebnis.entryId };
  },
);

export const clipAbstimmenAction = defineAction(
  {
    name: 'clips.vote',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.vote,
    schema: z.object({ entryId: z.string().cuid() }),
    rateLimit: 'clipVote',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const ergebnis = await clips.stimmeAb(guildId, handelnder(ctx), input.entryId);
    revalidatePath(systemRoutes.clips());
    return ergebnis;
  },
);

export const clipStimmeZurueckziehenAction = defineAction(
  {
    name: 'clips.unvote',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.vote,
    schema: z.object({ entryId: z.string().cuid() }),
    rateLimit: 'clipVote',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const ergebnis = await clips.nimmStimmeZurueck(guildId, handelnder(ctx), input.entryId);
    revalidatePath(systemRoutes.clips());
    return ergebnis;
  },
);

export const clipMeldenAction = defineAction(
  {
    name: 'clips.report',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.view,
    schema: z.object({
      clipId: z.string().cuid(),
      grund: z.enum(['INAPPROPRIATE', 'RIGHTS', 'HARASSMENT', 'OTHER']),
      notiz: z.string().trim().max(300).optional(),
    }),
    rateLimit: 'clipReport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await clips.melde(input.clipId, handelnder(ctx), input.grund, input.notiz ?? null);
    return { gemeldet: true };
  },
);

/**
 * Den naechsten zufaelligen Clip holen.
 *
 * Eine Aktion und keine Seite: der Knopf soll den Clip tauschen, nicht den
 * Verlauf des Browsers mit dreissig Eintraegen fuellen.
 */
export const clipZufallAction = defineAction(
  {
    name: 'clips.random',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.view,
    schema: z.object({
      competitionId: z.string().cuid(),
      ausser: z.string().cuid().optional(),
    }),
    rateLimit: 'clipRandom',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const karte = await clips.zufaelligerClip(input.competitionId, ctx.user.discordId, input.ausser ?? null);
    if (!karte) {
      return { karte: null, einbettung: null };
    }
    /*
     * Die Einbettungsadresse entsteht hier, nicht im Browser.
     *
     * Twitch verlangt den Hostnamen der einbettenden Seite als Parameter. Ihn
     * im Browser anzuhaengen hiesse, dieselbe Regel ein zweites Mal zu
     * schreiben - und die zweite waere die, die irgendwann abweicht.
     */
    const hostname = new URL(appUrl('/')).hostname;
    return { karte, einbettung: clips.einbettung(karte, hostname) };
  },
);

/**
 * Die Vorschau im Einreich-Assistenten.
 *
 * Prueft die Adresse und gibt zurueck, was daraus geworden ist - Anbieter,
 * Kennung, Einbettungsadresse. **Ohne jeden Abruf**: es wird nur zerlegt, was
 * dasteht. Der Server holt keine fremde Adresse, und damit gibt es hier auch
 * nichts, womit sich ein interner Dienst erreichen liesse.
 *
 * Die Vorschau ist keine Zusage. Ob der Clip eingereicht werden darf,
 * entscheidet `reicheEin()` noch einmal von vorne - diese Antwort dient
 * allein dazu, dem Formular zu zeigen, dass die Adresse erkannt wurde.
 */
export const clipVorschauAction = defineAction(
  {
    name: 'clips.preview',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.submit,
    schema: z.object({ url: z.string().trim().min(8).max(500) }),
    rateLimit: 'clipMetadata',
    freshness: 'cached',
  },
  async ({ input }) => {
    const erkannt = clips.erkenneClip(input.url);
    const hostname = new URL(appUrl('/')).hostname;
    return {
      provider: erkannt.provider,
      canonicalUrl: erkannt.canonicalUrl,
      thumbnailUrl: erkannt.thumbnailUrl,
      einbettung: clips.einbettung(erkannt, hostname),
    };
  },
);
