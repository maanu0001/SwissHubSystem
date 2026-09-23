'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { clips } from '@swisshub/modules';
import { AppError, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Moderation und Verwaltung der Runden.
 *
 * Getrennt von `actions.ts`, weil hier jede Aktion auf fremde Daten wirkt -
 * ein fremder Clip, eine fremde Runde, ein Ergebnis, das andere betrifft.
 * Jede verlangt deshalb eine eigene Berechtigung, und jede hinterlaesst
 * einen Eintrag im Protokoll.
 */

const handelnder = (ctx: AuthContext): clips.Handelnder => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  displayName: ctx.user.displayName,
  avatarHash: ctx.user.avatarHash,
});

const neuLaden = (): void => {
  revalidatePath(systemRoutes.clips());
  revalidatePath(`${systemRoutes.clips()}/moderation`);
  revalidatePath(`${systemRoutes.clips()}/verwalten`);
};

export const clipFreigebenAction = defineAction(
  {
    name: 'clips.approve',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.moderate,
    schema: z.object({ entryId: z.string().cuid() }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await clips.gibFrei(input.entryId, handelnder(ctx));
    neuLaden();
    return { freigegeben: true };
  },
);

export const clipAblehnenAction = defineAction(
  {
    name: 'clips.reject',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.moderate,
    schema: z.object({
      entryId: z.string().cuid(),
      grund: z.enum(['INAPPROPRIATE', 'NO_GAMING', 'BROKEN', 'RIGHTS', 'DUPLICATE', 'OTHER']),
      notiz: z.string().trim().max(300).optional(),
    }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await clips.lehneAb(input.entryId, handelnder(ctx), input.grund, input.notiz ?? null);
    neuLaden();
    return { abgelehnt: true };
  },
);

export const clipEntfernenAction = defineAction(
  {
    name: 'clips.remove',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.moderate,
    schema: z.object({ entryId: z.string().cuid(), grund: z.string().trim().max(300).optional() }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await clips.nimmAusRunde(input.entryId, handelnder(ctx), input.grund ?? null);
    neuLaden();
    return { entfernt: true };
  },
);

export const clipMeldungenErledigenAction = defineAction(
  {
    name: 'clips.resolveReports',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.moderate,
    schema: z.object({ clipId: z.string().cuid() }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const anzahl = await clips.erledigeMeldungen(input.clipId, handelnder(ctx));
    neuLaden();
    return { anzahl };
  },
);

/**
 * Eine Runde von Hand abschliessen.
 *
 * Der Normalfall ist die Zeitsteuerung; von Hand geht es, wenn eine Runde
 * frueher enden soll oder der Bot laenger stand. Beides landet in derselben
 * Funktion - zwei Wege zum Abschluss waeren zwei Gelegenheiten, verschiedene
 * Gewinner zu bestimmen.
 */
export const clipRundeAbschliessenAction = defineAction(
  {
    name: 'clips.finalize',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.manage,
    schema: z.object({ competitionId: z.string().cuid() }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const erfolg = await clips.finalisiere(input.competitionId, {
      quelle: 'manuell',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
    });
    if (!erfolg) {
      throw new AppError('CONFLICT', {
        userMessage: 'Diese Runde ist bereits abgeschlossen oder läuft noch nicht.',
      });
    }
    neuLaden();
    return { abgeschlossen: true };
  },
);

export const clipRundeAbbrechenAction = defineAction(
  {
    name: 'clips.cancel',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.manage,
    schema: z.object({ competitionId: z.string().cuid(), grund: z.string().trim().max(300).optional() }),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const erfolg = await clips.brichAb(input.competitionId, handelnder(ctx), input.grund ?? null);
    if (!erfolg) {
      throw new AppError('CONFLICT', { userMessage: 'Diese Runde lässt sich nicht mehr abbrechen.' });
    }
    neuLaden();
    return { abgebrochen: true };
  },
);

/**
 * Die Runde dieser Woche von Hand anlegen.
 *
 * Fuer den Fall, dass die selbsttaetige Eroeffnung ausgeschaltet ist. Legt
 * nichts Zweites an: dieselbe Woche ergibt denselben Schluessel, und den gibt
 * es je Server nur einmal.
 */
export const clipRundeAnlegenAction = defineAction(
  {
    name: 'clips.createRound',
    module: clips.CLIPS_MODULE_ID,
    permission: clips.CLIPS_PERMISSIONS.manage,
    schema: z.object({}),
    rateLimit: 'clipModerate',
    freshness: 'critical',
  },
  async () => {
    const guildId = await resolveGuildId();
    const runde = await clips.holeOderErstelleRunde(guildId);
    neuLaden();
    return { key: runde.key, nummer: runde.number };
  },
);
