'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Server Actions des Post Creators.
 *
 * ## Was hier nicht geprueft wird
 *
 * Der Inhalt. Die Pruefung steht in `socialmedia.normalisiereInhalt` - eine
 * reine Funktion im Modulkern, durch die **jeder** Weg in die Datenbank
 * laeuft. Hier zu pruefen hiesse, sie zweimal zu haben, und die zweite waere
 * die, die beim naechsten Feld vergessen wird.
 *
 * Das Schema laesst den Inhalt deshalb absichtlich als `unknown` durch:
 * `z.unknown()` ist hier keine Luecke, sondern die Aussage, dass die Form
 * eine Stelle weiter festgelegt wird - und zwar gegen die Registry, die auch
 * der Editor und die Zeichenquelle lesen.
 */

function revalidierePosts(postId?: string): void {
  revalidatePath('/social-media/post-creator');
  revalidatePath('/social-media');
  if (postId) {
    revalidatePath(`/social-media/post-creator/${postId}`);
  }
}

const STATUS = z.enum(['DRAFT', 'READY', 'ARCHIVED']);

export const postErstellenAction = defineAction(
  {
    name: 'socialmedia.post.create',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postCreate,
    schema: z.object({
      title: z.string().min(1).max(120),
      postType: z.string().min(1).max(40),
      design: z.string().min(1).max(40),
      inhalt: z.unknown().optional(),
    }),
    rateLimit: 'postCreator',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const post = await socialmedia.erstellePost({
      guildId,
      title: input.title,
      postType: input.postType,
      design: input.design,
      inhalt: input.inhalt ?? {},
      autor: {
        userId: ctx.user.id,
        discordId: ctx.user.discordId,
        username: ctx.user.username,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SOCIAL_POST_CREATED,
      module: 'socialmedia',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: post.title,
      success: true,
      metadata: { postId: post.id, postType: post.postType, design: post.design },
    });

    revalidierePosts(post.id);
    return { postId: post.id };
  },
);

export const postSpeichernAction = defineAction(
  {
    name: 'socialmedia.post.save',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postEdit,
    schema: z.object({
      postId: z.string().cuid(),
      title: z.string().min(1).max(120),
      postType: z.string().min(1).max(40),
      design: z.string().min(1).max(40),
      inhalt: z.unknown().optional(),
      status: STATUS.optional(),
    }),
    rateLimit: 'postCreator',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const post = await socialmedia.speicherePost({
      postId: input.postId,
      guildId,
      title: input.title,
      postType: input.postType,
      design: input.design,
      inhalt: input.inhalt ?? {},
      ...(input.status ? { status: input.status } : {}),
      autorUsername: ctx.user.username,
    });

    revalidierePosts(post.id);
    return {
      saved: true,
      status: post.status,
      /*
       * Der Zeitstempel geht zurueck an den Editor.
       *
       * Er haengt ihn als Parameter an die Vorschauadresse - sonst bediente
       * der Browser dieselbe Adresse aus seinem Cache, und die Vorschau
       * zeigte den Stand von vorher. Das erlebt man als «die Vorschau
       * aktualisiert nicht», und es ist der haeufigste Fehler in so einem
       * Editor.
       */
      stand: post.updatedAt.getTime(),
    };
  },
);

export const postDuplizierenAction = defineAction(
  {
    name: 'socialmedia.post.duplicate',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postCreate,
    schema: z.object({ postId: z.string().cuid() }),
    rateLimit: 'postCreator',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const kopie = await socialmedia.verdopplePost(input.postId, guildId, {
      userId: ctx.user.id,
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SOCIAL_POST_CREATED,
      module: 'socialmedia',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: kopie.title,
      success: true,
      metadata: { postId: kopie.id, kopieVon: input.postId },
    });

    revalidierePosts(kopie.id);
    return { postId: kopie.id };
  },
);

export const postArchivierenAction = defineAction(
  {
    name: 'socialmedia.post.archive',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postDelete,
    schema: z.object({ postId: z.string().cuid(), archivieren: z.boolean() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const post = await socialmedia.setzeArchiv(input.postId, guildId, input.archivieren, ctx.user.username);

    // Nur das Ablegen ist ein Ereignis. Das Zurueckholen steht am Post selbst
    // (`status`) und braucht keinen zweiten Eintrag - ein Audit, das jede
    // Richtung eines Schalters protokolliert, ist nach einem Monat Rauschen.
    if (input.archivieren) {
      await safeRecordAudit({
        action: AUDIT_ACTIONS.SOCIAL_POST_ARCHIVED,
        module: 'socialmedia',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetLabel: post.title,
        success: true,
        metadata: { postId: post.id },
      });
    }

    revalidierePosts(post.id);
    return { status: post.status };
  },
);

export const postLoeschenAction = defineAction(
  {
    name: 'socialmedia.post.delete',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postDelete,
    schema: z.object({ postId: z.string().cuid() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const post = await socialmedia.loeschePost(input.postId, guildId);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.SOCIAL_POST_DELETED,
      module: 'socialmedia',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: post.title,
      success: true,
      metadata: { postId: post.id, postType: post.postType },
    });

    revalidierePosts();
    return { deleted: true };
  },
);

/**
 * Vorschlaege aus einem Turnier (§45).
 *
 * Sie werden in den Editor **geschrieben**, nicht an den Post gebunden: wer
 * den Titel danach aendert, behaelt seine Aenderung. Ein Feld, das sich beim
 * naechsten Oeffnen selbst ueberschreibt, waere ein Feld, dem man nicht
 * trauen kann.
 */
export const turnierVorschlagAction = defineAction(
  {
    name: 'socialmedia.post.tournament',
    module: 'socialmedia',
    permission: socialmedia.SOCIAL_MEDIA_PERMISSIONS.postEdit,
    schema: z.object({ tournamentId: z.string().cuid() }),
    rateLimit: 'postCreator',
    freshness: 'cached',
  },
  async ({ input }) => {
    const guildId = await resolveGuildId();
    const vorschlag = await socialmedia.turnierVorschlag(input.tournamentId, guildId);
    if (!vorschlag) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Turnier gibt es nicht.' });
    }
    return vorschlag;
  },
);
