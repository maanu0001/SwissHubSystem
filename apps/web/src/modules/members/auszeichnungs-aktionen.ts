'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { members, profile } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Die verleihbaren Auszeichnungen pflegen.
 *
 * ## Warum eine eigene Datei
 *
 * `actions.ts` daneben enthaelt die Vorgaenge **an einem Mitglied**: Rollen,
 * Notizen, verleihen, entziehen. Hier steht etwas anderes - was es
 * ueberhaupt zu verleihen gibt. Dieselbe Trennung wie bei den
 * Berechtigungen: `members.awards.manage` verleiht,
 * `members.awards.define` legt fest.
 *
 * ## Zweimal geprueft, und das ist Absicht
 *
 * `defineAction` verlangt die Berechtigung, und der Dienst prueft sie noch
 * einmal. Der Dienst hat mehr als einen Aufrufer und darf sich nicht darauf
 * verlassen, dass jemand vorher nachgesehen hat.
 */

const handelnder = (ctx: AuthContext): profile.ArtenActor => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  can: (permission: string) => can(ctx, permission),
});

const idSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * Die Verwaltung neu laden - und die Mitgliederakte.
 *
 * Wer eine Auszeichnung umbenennt, aendert damit auch, was in jeder Akte
 * und an jedem Profil steht. Die Akten einzeln zu kennen ist nicht
 * moeglich; `/members` deckt die Liste ab, und eine geoeffnete Akte laedt
 * ihre Daten ohnehin bei jedem Aufruf neu (`dynamic = 'force-dynamic'`).
 */
function neuLaden(): void {
  revalidatePath('/members/auszeichnungen');
  revalidatePath('/members');
}

export const auszeichnungAnlegenAction = defineAction(
  {
    name: 'members.awards.define.create',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: profile.auszeichnungsArtSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const art = await profile.erstelleAuszeichnungsArt(
      { ...input, stufe: input.stufe as profile.Stufe },
      handelnder(ctx),
    );
    neuLaden();
    return { id: art.id, key: art.key, label: art.label };
  },
);

export const auszeichnungBearbeitenAction = defineAction(
  {
    name: 'members.awards.define.update',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: profile.auszeichnungsArtSchema.extend({ id: z.string().min(1).max(64) }),
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { id, ...rest } = input;
    const art = await profile.bearbeiteAuszeichnungsArt(
      id,
      { ...rest, stufe: rest.stufe as profile.Stufe },
      handelnder(ctx),
    );
    neuLaden();
    return { id: art.id, label: art.label };
  },
);

export const auszeichnungArchivierenAction = defineAction(
  {
    name: 'members.awards.define.archive',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: idSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const geaendert = await profile.archiviereAuszeichnungsArt(input.id, handelnder(ctx));
    neuLaden();
    return { geaendert };
  },
);

export const auszeichnungZurueckholenAction = defineAction(
  {
    name: 'members.awards.define.restore',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: idSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const geaendert = await profile.holeAuszeichnungsArtZurueck(input.id, handelnder(ctx));
    neuLaden();
    return { geaendert };
  },
);

/**
 * Entfernen - und zwar wirklich.
 *
 * Der Dienst laesst das nur zu, solange niemand sie hat. Diese Aktion
 * reicht den Fehler durch; die Oberflaeche zeigt ihn an und nennt die Zahl
 * der Mitglieder, die betroffen waeren.
 */
export const auszeichnungEntfernenAction = defineAction(
  {
    name: 'members.awards.define.delete',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: idSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await profile.entferneAuszeichnungsArt(input.id, handelnder(ctx));
    neuLaden();
    return { entfernt: true };
  },
);

/**
 * Die **gerechneten** Auszeichnungen pflegen.
 *
 * ## Was hier geht - und was nicht
 *
 * Geht: Beschriftung, Beschreibung, Symbol, Stufe, Schwellenwert, aktiv.
 * Geht nicht: verleihen. Dafuer gibt es keine Aktion, und im Dienst steht
 * ein ausdruecklicher Riegel - eine manipulierte Anfrage kommt damit nicht
 * weiter als eine ordentliche.
 *
 * ## Warum dieselbe Berechtigung wie bei den verleihbaren
 *
 * `members.awards.define` beantwortet die Frage «wer legt fest, welche
 * Auszeichnungen es gibt und wie sie heissen». Dieselbe Frage, dieselbe
 * Antwort. Eine zweite Berechtigung daneben waere eine zweite Stelle, an der
 * jemand dieselbe Zuteilung pflegen muesste.
 */
const berechnetSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().trim().min(2).max(60),
  beschreibung: z.string().trim().min(3).max(200),
  symbol: z.string().min(1).max(40),
  stufe: z.enum(['bronze', 'silber', 'gold']),
  /**
   * Der Schwellenwert.
   *
   * Eine ganze Zahl und nichts sonst - kein Ausdruck, keine Formel, kein
   * Feld, in dem etwas anderes stehen koennte. Was gezaehlt wird, steht im
   * Code und ist von hier aus nicht erreichbar.
   */
  schwelle: z.number().int().min(1).max(1_000_000).nullish(),
  aktiv: z.boolean(),
});

const berechnetKeySchema = z.object({ key: z.string().min(1).max(64) });

export const berechneteAuszeichnungBearbeitenAction = defineAction(
  {
    name: 'members.awards.computed.update',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: berechnetSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await profile.aendereBerechneteArt(
      input.key,
      {
        label: input.label,
        beschreibung: input.beschreibung,
        symbol: input.symbol,
        stufe: input.stufe as profile.Stufe,
        schwelle: input.schwelle ?? null,
        aktiv: input.aktiv,
      },
      { discordId: ctx.user.discordId, username: ctx.user.username },
    );
    neuLaden();
    return { key: input.key };
  },
);

export const berechneteAuszeichnungAbschaltenAction = defineAction(
  {
    name: 'members.awards.computed.archive',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: berechnetKeySchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await profile.archiviereBerechneteArt(input.key, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    neuLaden();
    return { key: input.key };
  },
);

export const berechneteAuszeichnungZurueckholenAction = defineAction(
  {
    name: 'members.awards.computed.restore',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: berechnetKeySchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await profile.holeBerechneteArtZurueck(input.key, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    neuLaden();
    return { key: input.key };
  },
);

export const berechneteAuszeichnungZuruecksetzenAction = defineAction(
  {
    name: 'members.awards.computed.reset',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.awardsDefine,
    schema: berechnetKeySchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await profile.setzeBerechneteArtZurueck(input.key, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    neuLaden();
    return { key: input.key };
  },
);
