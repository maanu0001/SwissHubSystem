'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Das eigene Profil bearbeiten.
 *
 * ## Warum jede Aktion `selfService` ist und keine eine Kennung entgegennimmt
 *
 * Wessen Profil geaendert wird, steht in **keinem** dieser Schemas. Es kommt
 * ausschliesslich aus `ctx.user.discordId` - dem Wert der Sitzung. Ein
 * praepariertes Request kann daher kein fremdes Profil treffen, und zwar
 * nicht weil eine Pruefung es abfaengt, sondern weil es keinen Weg gibt, die
 * Frage ueberhaupt zu stellen.
 *
 * Deshalb braucht hier auch keine Aktion eine Verwaltungsberechtigung:
 * «Mein Profil» gehoert jedem angemeldeten Mitglied. Eine Berechtigung zu
 * verlangen hiesse, dass jemand ohne sie sein eigenes Profil nicht pflegen
 * koennte - genau der Fehler, den der Navigationseintrag `baseline` schon
 * einmal beheben musste.
 *
 * Alles Uebrige der Sicherheitskette bleibt: Anmeldung, Mitgliedschaft,
 * Vorschau-Sperre, CSRF, Ratengrenze und Eingabepruefung laufen wie bei
 * jeder anderen Aktion.
 */

function neuLaden(): void {
  revalidatePath(systemRoutes.profil());
  revalidatePath(systemRoutes.profilBearbeiten());
  revalidatePath(systemRoutes.entdecken());
}

export const allgemeinSpeichernAction = defineAction(
  {
    name: 'profil.allgemein',
    schema: profile.allgemeinSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speichereAllgemein(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

export const gestaltungSpeichernAction = defineAction(
  {
    name: 'profil.gestaltung',
    schema: profile.gestaltungSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speichereGestaltung(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

export const socialsSpeichernAction = defineAction(
  {
    name: 'profil.socials',
    schema: profile.socialsSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speichereSocials(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

export const privatsphaereSpeichernAction = defineAction(
  {
    name: 'profil.privatsphaere',
    schema: profile.privatsphaereSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speicherePrivatsphaere(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

/*
 * Die spielabhaengigen Felder kommen hier als freies Objekt herein und
 * werden erst im Dienst gegen die Registry des jeweiligen Spiels geprueft -
 * welches Schema gilt, weiss man erst, wenn man das Spiel kennt. `strict()`
 * dort sorgt dafuer, dass ein unbekanntes Feld abgelehnt und nicht
 * gespeichert wird.
 */
export const spielSpeichernAction = defineAction(
  {
    name: 'profil.spiel.speichern',
    schema: z.object({
      gameId: z.string().min(1),
      platform: z.string().max(32).nullable().default(null),
      note: z.string().max(200).nullable().default(null),
      favorite: z.boolean().default(false),
      fields: z.record(z.string(), z.unknown()).default({}),
    }),
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speichereSpiel(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

export const spielEntfernenAction = defineAction(
  {
    name: 'profil.spiel.entfernen',
    schema: z.object({ gameId: z.string().min(1) }),
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.entferneSpiel(ctx.user.discordId, input.gameId);
    neuLaden();
    return { ok: true };
  },
);

export const spieleOrdnenAction = defineAction(
  {
    name: 'profil.spiele.ordnen',
    schema: profile.spielReihenfolgeSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.ordneSpiele(ctx.user.discordId, input.gameIds);
    neuLaden();
    return { ok: true };
  },
);

export const showcaseSpeichernAction = defineAction(
  {
    name: 'profil.showcase',
    schema: profile.showcaseSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    await profile.speichereShowcase(ctx.user.discordId, input);
    neuLaden();
    return { ok: true };
  },
);

export const bannerEntfernenAction = defineAction(
  { name: 'profil.banner.entfernen', selfService: true, rateLimit: 'profilWrite' },
  async ({ ctx }) => {
    await profile.entferneBanner(ctx.user.discordId);
    neuLaden();
    return { ok: true };
  },
);
