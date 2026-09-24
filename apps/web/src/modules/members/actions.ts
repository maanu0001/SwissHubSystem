'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, recordAudit } from '@swisshub/database';
import { members, profile, searchMembers } from '@swisshub/modules';
import { AppError, sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { memberActor, memberViewer } from '@/server/members';

/**
 * Die Aktionen des Member Center.
 *
 * Jede ist ein duenner Adapter auf einen Dienst, der die Zugriffspruefung
 * selbst vornimmt. Hier steht kein zweites Regelwerk - eine Regel, die es
 * zweimal gibt, gilt bald unterschiedlich.
 *
 * `selfService` steht dort, wo der Dienst aus Betrachter und Ziel entscheidet:
 * eine feste Berechtigung waere an dieser Stelle falsch, weil sie nicht
 * zwischen dem eigenen Profil und einem fremden unterscheidet.
 */

const searchSchema = z.object({
  query: z
    .string()
    .max(100)
    .transform((value) => sanitizeText(value, 100)),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Mitgliedersuche.
 *
 * Die Suche läuft serverseitig gegen Discord - es wird niemals die komplette
 * Mitgliederliste an den Browser gesendet.
 */
export const searchMembersAction = defineAction(
  {
    name: 'members.search',
    module: 'members',
    permission: 'members.view',
    schema: searchSchema,
    rateLimit: 'memberSearch',
    freshness: 'cached',
  },
  async ({ input }) => {
    const members = await searchMembers(input.query, { limit: input.limit ?? 20 });
    return members.map((member) => ({
      discordId: member.discordId,
      username: member.username,
      displayName: member.displayName,
      avatarHash: member.avatarHash,
      isBot: member.isBot,
      roles: member.roles.slice(0, 5).map((role) => ({ id: role.id, name: role.name, color: role.color })),
      jailed: member.activeJail !== null,
    }));
  },
);

// --- Rollen ---------------------------------------------------------------

const rollenSchema = z.object({
  discordId: snowflakeSchema,
  roleId: snowflakeSchema,
});

export const grantMemberRoleAction = defineAction(
  {
    name: 'members.roles.grant',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.rolesManage,
    schema: rollenSchema,
    rateLimit: 'memberCenter',
    // Rollen sind Rechte. Wer seine Rolle gerade verloren hat, soll damit
    // nicht noch eine letzte Aenderung durchbekommen.
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.grantMemberRole({
      viewer: memberViewer(ctx),
      actor: memberActor(ctx),
      targetDiscordId: input.discordId,
      roleId: input.roleId,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

export const revokeMemberRoleAction = defineAction(
  {
    name: 'members.roles.revoke',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.rolesManage,
    schema: rollenSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.revokeMemberRole({
      viewer: memberViewer(ctx),
      actor: memberActor(ctx),
      targetDiscordId: input.discordId,
      roleId: input.roleId,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

// --- Interne Notizen ------------------------------------------------------

const notizSchema = z.object({
  discordId: snowflakeSchema,
  content: z.string().min(1).max(members.NOTIZ_MAX),
  category: z.string().max(40).nullish(),
  pinned: z.boolean().optional(),
});

export const createMemberNoteAction = defineAction(
  {
    name: 'members.notes.create',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.notesCreate,
    schema: notizSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const notiz = await members.createMemberNote(memberViewer(ctx), memberActor(ctx), {
      targetDiscordId: input.discordId,
      content: input.content,
      category: input.category ?? null,
      pinned: input.pinned ?? false,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { id: notiz.id };
  },
);

const notizAendernSchema = z.object({
  discordId: snowflakeSchema,
  id: z.string().cuid(),
  content: z.string().min(1).max(members.NOTIZ_MAX),
  category: z.string().max(40).nullish(),
  pinned: z.boolean().optional(),
});

export const updateMemberNoteAction = defineAction(
  {
    name: 'members.notes.update',
    module: 'members',
    // Die eigene Notiz darf aendern, wer Notizen schreiben darf; fremde nur
    // mit der eigenen Berechtigung dafuer. Welcher Fall vorliegt, weiss erst
    // der Dienst - er kennt den Autor.
    selfService: true,
    schema: notizAendernSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.updateMemberNote(memberViewer(ctx), memberActor(ctx), {
      id: input.id,
      content: input.content,
      category: input.category ?? null,
      pinned: input.pinned,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

export const deleteMemberNoteAction = defineAction(
  {
    name: 'members.notes.delete',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.notesDelete,
    schema: z.object({ discordId: snowflakeSchema, id: z.string().cuid() }),
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.deleteMemberNote(memberViewer(ctx), memberActor(ctx), input.id);
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

// --- XP -------------------------------------------------------------------

const xpSchema = z.object({
  discordId: snowflakeSchema,
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().max(200).optional(),
});

/**
 * XP aendern.
 *
 * Ueber den bestehenden Level-Dienst und die bestehende Level-Berechtigung -
 * ein eigener Member-Center-Schluessel dafuer waere ein zweiter Schalter fuer
 * dieselbe Tuer.
 */
export const adjustMemberXpAction = defineAction(
  {
    name: 'members.xp.adjust',
    module: 'members',
    permission: 'level.members.manage',
    schema: xpSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (input.delta === 0) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Ohne Änderung gibt es nichts zu tun.' });
    }
    const { level } = await import('@swisshub/modules');
    const ergebnis = await level.adjustXp(memberActor(ctx), {
      target: { discordId: input.discordId },
      amount: input.delta,
      reason: input.reason ?? 'Member Center',
    });
    revalidatePath(`/members/${input.discordId}`);
    return { xp: ergebnis.xpAfter, level: ergebnis.levelAfter };
  },
);

/*
 * Auszeichnungen und fremde Profile.
 *
 * Alle drei tragen eine `permission` in der Definition, und die prueft
 * `defineAction`, bevor der Rumpf laeuft. Das ist der Unterschied zu einer
 * Oberflaeche, die den Knopf nur versteckt: wer die Kennung eines anderen
 * in die Anfrage schreibt, kommt trotzdem nicht durch - die Pruefung haengt
 * an der Berechtigung des Absenders und nicht daran, welche Kennung er
 * mitschickt.
 */

const auszeichnungSchema = z.object({
  discordId: snowflakeSchema,
  key: z.string().min(1).max(64),
  notiz: z
    .string()
    .max(200)
    .transform((wert) => sanitizeText(wert, 200))
    .nullish(),
});

/** Eine verleihbare Auszeichnung vergeben. */
export const verleiheAuszeichnungAction = defineAction(
  {
    name: 'members.awards.grant',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsManage,
    schema: auszeichnungSchema,
    rateLimit: 'memberCenter',
  },
  async ({ ctx, input }) => {
    const neu = await profile.verleihe(
      { discordId: ctx.user.discordId, username: ctx.user.username ?? ctx.user.discordId },
      { discordId: input.discordId, key: input.key, notiz: input.notiz ?? null },
    );
    await profilNeuLaden(input.discordId);
    return { neu };
  },
);

/** Eine verliehene Auszeichnung wieder entziehen. */
export const entzieheAuszeichnungAction = defineAction(
  {
    name: 'members.awards.revoke',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsManage,
    schema: auszeichnungSchema.pick({ discordId: true, key: true }),
    rateLimit: 'memberCenter',
  },
  async ({ ctx, input }) => {
    const entzogen = await profile.entziehe(
      { discordId: ctx.user.discordId, username: ctx.user.username ?? ctx.user.discordId },
      input.discordId,
      input.key,
    );
    await profilNeuLaden(input.discordId);
    return { entzogen };
  },
);

/**
 * Das oeffentliche Profil eines Mitglieds aendern.
 *
 * Dieselben Felder und dasselbe Schema wie im eigenen Editor -
 * `profile.allgemeinSchema`. Es gibt genau ein Profilmodell; ein zweites
 * fuer die Verwaltung waere ein zweiter Ort, an dem dieselben Felder
 * gepflegt werden muessten, und irgendwann stuende an einem der beiden
 * etwas anderes.
 */
export const bearbeiteFremdesProfilAction = defineAction(
  {
    name: 'members.profile.edit',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.profileEdit,
    schema: z.object({ discordId: snowflakeSchema }).and(profile.allgemeinSchema),
    rateLimit: 'memberCenter',
  },
  async ({ ctx, input }) => {
    const { discordId, ...felder } = input;
    await profile.speichereAllgemein(discordId, felder);

    await recordAudit({
      action: AUDIT_ACTIONS.PROFILE_ADMIN_EDITED,
      module: 'members',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username ?? null,
      targetDiscordId: discordId,
      targetLabel: felder.displayName ?? discordId,
      success: true,
      // Was geaendert wurde, nicht womit: die Werte stehen im Profil, und
      // das Protokoll soll keine zweite Kopie davon fuehren.
      metadata: { felder: Object.keys(felder) },
    });

    await profilNeuLaden(discordId);
    return { ok: true };
  },
);

/**
 * Nach einer Aenderung von aussen: die Seiten neu laden lassen.
 *
 * Auch die oeffentliche - sonst zeigte sie bis zu einer Minute lang den
 * alten Stand, und wer gerade etwas entfernt hat, saehe es dort noch.
 */
async function profilNeuLaden(discordId: string): Promise<void> {
  revalidatePath(`/members/${discordId}`);
  revalidatePath(`/spieler/${discordId}`);
  const slug = await profile.slugVon(discordId).catch(() => null);
  if (slug) {
    revalidatePath(`/u/${slug}`);
    revalidatePath(`/u/${slug}/karte`);
  }
}
