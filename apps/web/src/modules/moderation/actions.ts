'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { moderation } from '@swisshub/modules';
import { snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { moderationActor } from '@/server/moderation';

/**
 * Die Aktionen des Moderation Center.
 *
 * Jede ist ein duenner Adapter auf den Dienst, der Berechtigung und Rangfolge
 * selbst prueft. Hier steht kein zweites Regelwerk - und `freshness: 'critical'`
 * ueberall, weil eine Massnahme mit Rollen von vorhin die falsche Rangfolge
 * verwenden koennte.
 */

const grundSchema = z.string().min(3).max(400);

const zielSchema = z.object({
  discordId: snowflakeSchema,
  reason: grundSchema,
  note: z.string().max(1000).nullish(),
});

export const banMemberAction = defineAction(
  {
    name: 'moderation.ban',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.ban,
    schema: zielSchema.extend({
      // Discord erlaubt hoechstens sieben Tage.
      deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
    }),
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.banMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
      deleteMessageSeconds: input.deleteMessageSeconds,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const unbanMemberAction = defineAction(
  {
    name: 'moderation.unban',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.unban,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.unbanMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation/banns');
    return { id: eintrag.id };
  },
);

export const kickMemberAction = defineAction(
  {
    name: 'moderation.kick',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.kick,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.kickMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const timeoutMemberAction = defineAction(
  {
    name: 'moderation.timeout',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.timeout,
    schema: zielSchema.extend({
      seconds: z.number().int().min(60).max(moderation.MAX_TIMEOUT_SECONDS),
    }),
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.timeoutMember({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
      seconds: input.seconds,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const removeTimeoutAction = defineAction(
  {
    name: 'moderation.timeout.remove',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.timeoutRemove,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.removeTimeout({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });
    revalidatePath('/moderation');
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

export const addModerationNoteAction = defineAction(
  {
    name: 'moderation.note',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.notesCreate,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.addModerationNote({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { id: eintrag.id };
  },
);

/**
 * Das oeffentliche Profil sperren und wieder freigeben.
 *
 * ## Warum die Zwischenspeicher hier eine eigene Rolle spielen
 *
 * Die oeffentliche Profilseite ist die einzige Seite dieser Anwendung, die
 * fuer eine Minute zwischengespeichert wird - ohne das waere jeder geteilte
 * Link ein Datenbankzugriff. Genau das ist bei einer Sperre das Problem:
 * ohne ausdrueckliches Verwerfen lieferte sie das Profil bis zu einer Minute
 * weiter aus, und die Vorschaukarte fuer soziale Netze womoeglich laenger.
 *
 * Verworfen wird deshalb beides ausdruecklich: die Seite und ihre Karte.
 */
const profilPfadeVerwerfen = (slug: string | null): void => {
  revalidatePath('/moderation');
  if (slug) {
    revalidatePath(`/u/${slug}`);
    revalidatePath(`/u/${slug}/karte`);
  }
};

const sperrSchema = zielSchema.extend({
  /**
   * Geplantes Ende, als ISO-Zeitpunkt. Leer = bis jemand aufhebt.
   *
   * Als Text und nicht als `Date`: durch die Server Action geht JSON, und
   * ein `Date` daraus ist ein String, der bloss so tut.
   */
  bis: z.string().datetime().nullish(),
});

export const sperreProfilAction = defineAction(
  {
    name: 'moderation.profil.sperren',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.profileLock,
    schema: sperrSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { profile } = await import('@swisshub/modules');
    // Den Slug **vor** der Sperre holen: danach gibt `slugVon` nichts mehr
    // zurueck, und der Zwischenspeicher der Seite bliebe stehen.
    const slug = await profile.slugVon(input.discordId).catch(() => null);

    const eintrag = await moderation.sperreOeffentlichesProfil({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
      bis: input.bis ? new Date(input.bis) : null,
    });

    profilPfadeVerwerfen(slug);
    revalidatePath(`/members/${input.discordId}`);
    revalidatePath('/profil');
    return { id: eintrag.id };
  },
);

export const entsperreProfilAction = defineAction(
  {
    name: 'moderation.profil.entsperren',
    module: 'moderation',
    permission: moderation.MODERATION_PERMISSIONS.profileUnlock,
    schema: zielSchema,
    rateLimit: 'moderationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const eintrag = await moderation.entsperreOeffentlichesProfil({
      actor: moderationActor(ctx),
      targetDiscordId: input.discordId,
      reason: input.reason,
      note: input.note ?? null,
    });

    // Jetzt erst holen: vor dem Entsperren gaebe `slugVon` nichts zurueck.
    const { profile } = await import('@swisshub/modules');
    const slug = await profile.slugVon(input.discordId).catch(() => null);
    profilPfadeVerwerfen(slug);
    revalidatePath(`/members/${input.discordId}`);
    revalidatePath('/profil');
    return { id: eintrag.id };
  },
);
