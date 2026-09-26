'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Was die Verwaltung von «SwissHub fragt» tut.
 *
 * ## Jede Aktion prueft serverseitig
 *
 * `defineAction` nimmt `permission` und lehnt ohne sie ab - vor dem ersten
 * Zugriff auf die Datenbank. Die Oberflaeche entscheidet, welche Knoepfe sie
 * zeigt; was geschieht, entscheidet diese Datei.
 *
 * Die Berechtigungen sind feiner geschnitten als bei den meisten Modulen, und
 * das ist hier der Punkt: `questions` schreibt Vorlagen, `publish` stellt sie
 * an alle, `studio` erzeugt etwas, das den Server verlaesst. Wer Fragen
 * vorbereiten darf, soll nicht senden koennen.
 *
 * Die Kennung des Handelnden kommt in jedem Fall aus der Sitzung. Eine
 * `discordId` aus dem Formular gibt es nicht.
 */

const handelnder = (ctx: AuthContext): fragt.Handelnder => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

const neuLaden = (): void => {
  revalidatePath(systemRoutes.fragt());
  revalidatePath(systemRoutes.fragtBibliothek());
  revalidatePath(systemRoutes.fragtGeplant());
  revalidatePath(systemRoutes.fragtAktiv());
  revalidatePath(systemRoutes.fragtErgebnisse());
};

const fragetypSchema = z.enum(['ENTWEDER_ODER', 'UMFRAGE', 'FAVORIT', 'HOT_TAKE']);

/*
 * Die Antworten werden hier nur grob begrenzt.
 *
 * Wie viele es sein muessen und wie lang sie sein duerfen, entscheidet
 * `pruefeAntworten` - an genau einer Stelle, damit Formular und Bot nicht zwei
 * verschiedene Meinungen dazu haben koennen.
 */
const antwortenSchema = z.array(z.string().trim().max(120)).max(10);

export const fragtFrageErstellenAction = defineAction(
  {
    name: 'fragt.question.create',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      text: z.string().trim().min(5).max(240),
      untertitel: z.string().trim().max(240).optional(),
      kategorie: z.string().trim().min(1).max(40),
      typ: fragetypSchema,
      antworten: antwortenSchema,
      tags: z.array(z.string().trim().max(24)).max(8).optional(),
      dauerStunden: z.number().int().min(1).max(336).optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const frage = await fragt.erstelleFrage(guildId, handelnder(ctx), {
      text: input.text,
      untertitel: input.untertitel ?? null,
      kategorie: input.kategorie,
      typ: input.typ,
      antworten: input.antworten,
      tags: input.tags,
      dauerStunden: input.dauerStunden,
    });
    neuLaden();
    return { frageId: frage.id };
  },
);

export const fragtFrageBearbeitenAction = defineAction(
  {
    name: 'fragt.question.update',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      frageId: z.string().cuid(),
      text: z.string().trim().min(5).max(240).optional(),
      untertitel: z.string().trim().max(240).nullable().optional(),
      kategorie: z.string().trim().min(1).max(40).optional(),
      typ: fragetypSchema.optional(),
      antworten: antwortenSchema.optional(),
      tags: z.array(z.string().trim().max(24)).max(8).optional(),
      dauerStunden: z.number().int().min(1).max(336).optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const { frageId, ...rest } = input;
    const frage = await fragt.bearbeiteFrage(frageId, handelnder(ctx), rest);
    neuLaden();
    return { frageId: frage.id };
  },
);

export const fragtFrageStatusAction = defineAction(
  {
    name: 'fragt.question.status',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      frageId: z.string().cuid(),
      status: z.enum(['DRAFT', 'READY', 'ARCHIVED']),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.setzeStatus(input.frageId, handelnder(ctx), input.status);
    neuLaden();
    return { status: input.status };
  },
);

export const fragtFrageDuplizierenAction = defineAction(
  {
    name: 'fragt.question.duplicate',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const kopie = await fragt.dupliziereFrage(input.frageId, handelnder(ctx));
    neuLaden();
    return { frageId: kopie.id };
  },
);

export const fragtSeedEinspielenAction = defineAction(
  {
    name: 'fragt.seed',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({}),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx }) => {
    const guildId = await resolveGuildId();
    // Legt die Fragen als Entwurf an. Nichts davon kann von selbst auf Discord
    // landen - die Automatik waehlt nur freigegebene Fragen.
    const neu = await fragt.spieleSeedEin(guildId, ctx.user.discordId);
    neuLaden();
    return { neu };
  },
);

export const fragtPlanenAction = defineAction(
  {
    name: 'fragt.schedule',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.schedule,
    schema: z.object({
      frageId: z.string().cuid(),
      /** ISO-Zeitstempel aus dem Formular. */
      termin: z.string().datetime(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.planeFrage(input.frageId, handelnder(ctx), new Date(input.termin));
    neuLaden();
    return { geplant: true };
  },
);

export const fragtPlanungAufhebenAction = defineAction(
  {
    name: 'fragt.schedule.clear',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.schedule,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.hebePlanungAuf(input.frageId, handelnder(ctx));
    neuLaden();
    return { geplant: false };
  },
);

export const fragtVeroeffentlichenAction = defineAction(
  {
    name: 'fragt.publish',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.publish,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtPublish',
    // Eine Veroeffentlichung sehen alle im Kanal. Die Sitzung muss frisch sein.
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const ausgang = await fragt.veroeffentlicheVonHand(guildId, input.frageId, handelnder(ctx));
    neuLaden();
    return { abstimmungId: ausgang.abstimmung.id };
  },
);

export const fragtSchliessenAction = defineAction(
  {
    name: 'fragt.close',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.close,
    schema: z.object({ abstimmungId: z.string().cuid() }),
    rateLimit: 'fragtPublish',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ausgang = await fragt.schliesseVonHand(input.abstimmungId, handelnder(ctx));
    neuLaden();
    return {
      stimmen: ausgang.art === 'geschlossen' ? ausgang.ergebnis.gesamt : 0,
    };
  },
);

export const fragtEntwurfBearbeitenAction = defineAction(
  {
    name: 'fragt.draft.update',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({
      entwurfId: z.string().cuid(),
      vorlage: z.enum(['winner', 'results', 'duel']).optional(),
      format: z.enum(['story', 'feed', 'quadrat']).optional(),
      /*
       * Redaktionelle Texte - und nur die.
       *
       * Es gibt in diesem Schema kein Feld fuer eine Prozentzahl oder eine
       * Stimmenzahl, und im Datenmodell auch keine Spalte dafuer. Die Zahlen
       * kommen beim Rendern aus dem festgeschriebenen Ergebnis.
       */
      ueberschrift: z.string().trim().min(1).max(240).optional(),
      untertitel: z.string().trim().max(240).nullable().optional(),
      cta: z.string().trim().min(1).max(200).optional(),
      folien: z
        .array(
          z.object({
            art: z.enum(['frage', 'gewinner', 'verteilung', 'duell', 'cta']),
            aktiv: z.boolean(),
            position: z.number().int().min(0).max(9),
          }),
        )
        .max(5)
        .optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ input }) => {
    const { entwurfId, ...rest } = input;
    await fragt.bearbeiteEntwurf(entwurfId, rest);
    revalidatePath(systemRoutes.fragtStudio(entwurfId));
    return { gespeichert: true };
  },
);

export const fragtEntwurfFinalisierenAction = defineAction(
  {
    name: 'fragt.draft.finalize',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.finalisiereEntwurf(input.entwurfId, handelnder(ctx));
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    neuLaden();
    return { status: 'FINALISIERT' as const };
  },
);

export const fragtEntwurfFreigebenAction = defineAction(
  {
    name: 'fragt.draft.reopen',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ input }) => {
    await fragt.gibEntwurfFrei(input.entwurfId);
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    return { status: 'OFFEN' as const };
  },
);

export const fragtEntwurfGepostetAction = defineAction(
  {
    name: 'fragt.draft.posted',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    /*
     * Diese Aktion postet nichts.
     *
     * Sie haelt fest, dass jemand es getan hat. Das Modul hat keine
     * Instagram-Zugangsdaten und keinen Endpunkt dorthin; eine automatische
     * Veroeffentlichung gibt es in dieser Fassung ausdruecklich nicht.
     */
    await fragt.markiereVeroeffentlicht(input.entwurfId, handelnder(ctx));
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    neuLaden();
    return { status: 'VEROEFFENTLICHT' as const };
  },
);
