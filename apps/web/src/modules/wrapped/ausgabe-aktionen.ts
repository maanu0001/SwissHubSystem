'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { wrapped } from '@swisshub/modules';
import { AppError, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { wrappedHandelnder } from '@/server/wrapped';

/**
 * Die periodischen Ausgaben, von der Serverseite aus.
 *
 * ## Warum eine eigene Datei
 *
 * `aktionen.ts` daneben gehoert dem persoenlichen Rueckblick: Kampagne,
 * Szenen, Momentaufnahmen, Veroeffentlichung fuer die Mitglieder. Hier geht
 * es um etwas anderes - Monats- und Jahresausgaben fuer Social Media. Zwei
 * Dateien, weil es zwei Fragen sind; dieselben Bausteine darunter.
 *
 * ## Berechtigungen
 *
 * Jede Aktion nennt ihre eigene. Keine prueft im Rumpf noch einmal nach -
 * das tut `defineAction`, mit frischen Discord-Rollen und einem Eintrag im
 * Sicherheitsprotokoll, wenn es schiefgeht.
 */

const neuLaden = (editionId?: string): void => {
  revalidatePath(systemRoutes.wrappedAusgaben());
  if (editionId) {
    revalidatePath(systemRoutes.wrappedAusgabe(editionId));
  }
};

const periodenSchema = z.object({
  type: z.enum(['MONTHLY', 'YEARLY']),
  /** `2026-09` oder `2026`. */
  periodKey: z.string().trim().max(10),
});

/**
 * Eine Ausgabe von Hand erzeugen.
 *
 * Das ist zugleich die Nachholfunktion fuer vergangene Zeitraeume: wer den
 * August nachtraeglich will, traegt `2026-08` ein. Erfunden wird dabei
 * nichts - die Stories arbeiten auf denselben Daten und lassen weg, wozu es
 * nichts gibt. Ein Monat ohne Sprachzeitmessung bekommt eben keine
 * Sprachzeit-Folie.
 */
export const ausgabeErzeugenAction = defineAction(
  {
    name: 'wrapped.ausgabe.erzeugen',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.generate,
    schema: periodenSchema,
    rateLimit: 'wrappedGenerate',
  },
  async ({ ctx, input }) => {
    const periode = wrapped.periodeVon(input.type, input.periodKey);
    if (!periode) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage:
          input.type === 'MONTHLY'
            ? 'Bitte einen Monat im Format JJJJ-MM angeben, zum Beispiel 2026-08.'
            : 'Bitte ein Jahr im Format JJJJ angeben, zum Beispiel 2026.',
      });
    }

    const guildId = await resolveGuildId();
    const ergebnis = await wrapped.erzeugeAusgabe(guildId, periode, {
      akteur: wrappedHandelnder(ctx),
    });
    neuLaden(ergebnis.editionId);
    return ergebnis;
  },
);

export const ausgabeRegenerierenAction = defineAction(
  {
    name: 'wrapped.ausgabe.regenerieren',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.generate,
    schema: z.object({
      editionId: z.string().min(1),
      /*
       * Vorgabe: behalten.
       *
       * Wer eine Stunde an den Begleitsaetzen gefeilt hat, soll sie nicht
       * durch einen Klick auf «neu erheben» verlieren. Der Gegenbefehl ist
       * ausdruecklich, und die Oberflaeche fragt vorher nach.
       */
      texteBehalten: z.boolean().default(true),
    }),
    rateLimit: 'wrappedGenerate',
  },
  async ({ ctx, input }) => {
    const ergebnis = await wrapped.regeneriereAusgabe(input.editionId, {
      akteur: wrappedHandelnder(ctx),
      texteBehalten: input.texteBehalten,
    });
    neuLaden(input.editionId);
    return ergebnis;
  },
);

export const folieTextAction = defineAction(
  {
    name: 'wrapped.folie.text',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({
      slideId: z.string().min(1),
      ueberschrift: z.string().max(60),
      text: z.string().max(200),
    }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.speichereEditorial(
      input.slideId,
      { ueberschrift: input.ueberschrift, text: input.text },
      wrappedHandelnder(ctx),
    );
    return { ok: true };
  },
);

export const folieSchaltenAction = defineAction(
  {
    name: 'wrapped.folie.schalten',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({ slideId: z.string().min(1), enabled: z.boolean() }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.schalteFolie(input.slideId, input.enabled, wrappedHandelnder(ctx));
    return { ok: true };
  },
);

export const folienOrdnenAction = defineAction(
  {
    name: 'wrapped.folien.ordnen',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({
      editionId: z.string().min(1),
      slideIds: z.array(z.string().min(1)).max(20),
    }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.ordneFolien(input.editionId, input.slideIds, wrappedHandelnder(ctx));
    neuLaden(input.editionId);
    return { ok: true };
  },
);

export const ausgabeFinalisierenAction = defineAction(
  {
    name: 'wrapped.ausgabe.finalisieren',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.editionFinalize,
    schema: z.object({ editionId: z.string().min(1) }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.finalisiereAusgabe(input.editionId, wrappedHandelnder(ctx));
    neuLaden(input.editionId);
    return { ok: true };
  },
);

/**
 * Eine eingefrorene Ausgabe wieder aufmachen.
 *
 * Eigene Berechtigung, eigener Protokolleintrag - das ist kein Versehen im
 * Entwurf, sondern ein Eingriff in etwas, das bereits draussen sein koennte.
 */
export const ausgabeEntsperrenAction = defineAction(
  {
    name: 'wrapped.ausgabe.entsperren',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.editionUnlock,
    schema: z.object({ editionId: z.string().min(1) }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.entsperreAusgabe(input.editionId, wrappedHandelnder(ctx));
    neuLaden(input.editionId);
    return { ok: true };
  },
);

export const ausgabeVeroeffentlichtAction = defineAction(
  {
    name: 'wrapped.ausgabe.veroeffentlicht',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.publish,
    schema: z.object({ editionId: z.string().min(1) }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.markiereVeroeffentlicht(input.editionId, wrappedHandelnder(ctx));
    neuLaden(input.editionId);
    return { ok: true };
  },
);

// --- Community Moments ------------------------------------------------------

export const momentAnlegenAction = defineAction(
  {
    name: 'wrapped.moment.anlegen',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.momentsManage,
    schema: wrapped.momentSchema,
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const moment = await wrapped.erstelleMoment(guildId, input, wrappedHandelnder(ctx));
    revalidatePath(systemRoutes.wrappedMomente());
    return moment;
  },
);

export const momentAendernAction = defineAction(
  {
    name: 'wrapped.moment.aendern',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.momentsManage,
    schema: wrapped.momentSchema.extend({ momentId: z.string().min(1) }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    const { momentId, ...felder } = input;
    await wrapped.aendereMoment(momentId, felder, wrappedHandelnder(ctx));
    revalidatePath(systemRoutes.wrappedMomente());
    return { ok: true };
  },
);

export const momentLoeschenAction = defineAction(
  {
    name: 'wrapped.moment.loeschen',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.momentsManage,
    schema: z.object({ momentId: z.string().min(1) }),
    rateLimit: 'wrappedStudio',
  },
  async ({ ctx, input }) => {
    await wrapped.loescheMoment(input.momentId, wrappedHandelnder(ctx));
    revalidatePath(systemRoutes.wrappedMomente());
    return { ok: true };
  },
);
