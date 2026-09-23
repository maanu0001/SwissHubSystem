'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { AppError, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { baueVorschau, type VorschauErgebnis } from '@/server/wrapped-vorschau';
import { wrappedHandelnder } from '@/server/wrapped';

/**
 * Das Studio, von der Serverseite aus.
 *
 * ## Die Trennlinie, die hier zaehlt
 *
 * Es gibt genau zwei Arten von Aktionen in dieser Datei:
 *
 *   - solche, die etwas **aendern** - Kampagne, Szenen, Momentaufnahmen,
 *     Veroeffentlichung. Sie verlangen eine eigene Berechtigung, laufen
 *     ueber `defineAction` mit frischen Rollen und hinterlassen einen
 *     Eintrag im Protokoll.
 *   - genau **eine**, die nur liest: die Vorschau. Sie ruft ausschliesslich
 *     `baueVorschau` auf und ist damit nachweislich folgenlos - keine
 *     Momentaufnahme, kein XP, keine Benachrichtigung, kein Discord-Post,
 *     kein «angesehen»-Vermerk.
 *
 * Wer hier eine dritte Art einfuehrt, sollte einen guten Grund haben.
 */

const neuLaden = (campaignId?: string): void => {
  revalidatePath(systemRoutes.wrappedStudio());
  if (campaignId) {
    revalidatePath(systemRoutes.wrappedKampagne(campaignId));
    revalidatePath(systemRoutes.wrappedVorschau(campaignId));
  }
};

/*
 * Der Schluessel einer Kampagne steht in der Adresse des Rueckblicks.
 *
 * Deshalb nur Kleinbuchstaben, Ziffern und Bindestriche: alles andere
 * muesste kodiert werden, und eine Adresse mit Prozentzeichen verschickt
 * niemand gern.
 */
const schluessel = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9-]+$/, 'Nur Kleinbuchstaben, Ziffern und Bindestriche.');

const datum = z.coerce.date();

export const wrappedKampagneAnlegenAction = defineAction(
  {
    name: 'wrapped.campaign.create',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({
      key: schluessel,
      title: z.string().trim().min(3).max(120),
      displayYear: z.coerce.number().int().min(2000).max(2100),
      periodStart: datum,
      periodEnd: datum,
    }),
    rateLimit: 'wrappedStudio',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const campaign = await wrapped.erstelleKampagne(guildId, wrappedHandelnder(ctx), input);
    neuLaden(campaign.id);
    return { campaignId: campaign.id };
  },
);

export const wrappedKampagneAendernAction = defineAction(
  {
    name: 'wrapped.campaign.update',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({
      campaignId: z.string().cuid(),
      title: z.string().trim().min(3).max(120).optional(),
      displayYear: z.coerce.number().int().min(2000).max(2100).optional(),
      periodStart: datum.optional(),
      periodEnd: datum.optional(),
      introText: z.string().trim().max(280).nullable().optional(),
      outroText: z.string().trim().max(280).nullable().optional(),
      shareCardsEnabled: z.boolean().optional(),
      announceEnabled: z.boolean().optional(),
      announcementChannelId: z.string().trim().max(32).nullable().optional(),
      minActiveDays: z.coerce.number().int().min(0).max(366).optional(),
      minMessages: z.coerce.number().int().min(0).max(100000).optional(),
      minVoiceMinutes: z.coerce.number().int().min(0).max(1000000).optional(),
    }),
    rateLimit: 'wrappedStudio',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { campaignId, ...aenderung } = input;
    /*
     * Die Vorlagen werden geprueft, bevor sie gespeichert werden.
     *
     * `pruefeVorlage` laesst nur die Platzhalter aus der Erlaubnisliste
     * durch und weist spitze Klammern zurueck. Das ist die einzige
     * Verarbeitung, die diese Texte je erfahren - kein `eval`, kein
     * JavaScript, keine freien Ausdruecke.
     */
    for (const [feld, text] of [
      ['Der Begrüssungstext', aenderung.introText],
      ['Der Abschlusstext', aenderung.outroText],
    ] as const) {
      if (typeof text === 'string' && text.length > 0) {
        const befund = wrapped.pruefeVorlage(text);
        if (!befund.gueltig) {
          throw new AppError('VALIDATION_FAILED', { userMessage: `${feld}: ${befund.fehler}` });
        }
      }
    }

    await wrapped.aendereKampagne(campaignId, wrappedHandelnder(ctx), aenderung);
    neuLaden(campaignId);
    return { gespeichert: true };
  },
);

export const wrappedSzenenSetzenAction = defineAction(
  {
    name: 'wrapped.scenes.set',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.studioEdit,
    schema: z.object({
      campaignId: z.string().cuid(),
      szenen: z
        .array(
          z.object({
            sceneKey: z.string().trim().min(1).max(64),
            enabled: z.boolean(),
            position: z.coerce.number().int().min(0).max(999),
          }),
        )
        .min(1)
        .max(64),
    }),
    rateLimit: 'wrappedStudio',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await wrapped.setzeSzenen(input.campaignId, wrappedHandelnder(ctx), input.szenen);
    neuLaden(input.campaignId);
    return { gespeichert: true };
  },
);

export const wrappedMomentaufnahmenStartenAction = defineAction(
  {
    name: 'wrapped.snapshots.start',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.generate,
    schema: z.object({ campaignId: z.string().cuid() }),
    rateLimit: 'wrappedStudio',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    /*
     * Ein zweiter Durchgang braucht keinen Schalter «neu aufbauen».
     *
     * Momentaufnahmen werden geschrieben oder ersetzt, nie nur ergaenzt -
     * ein erneuter Start rechnet also ohnehin alles neu. Ein Schalter
     * daneben wuerde eine Wahl vortaeuschen, die es nicht gibt.
     */
    const run = await wrapped.starteDurchgang(input.campaignId, wrappedHandelnder(ctx));
    neuLaden(input.campaignId);
    return { runId: run.id, total: run.total };
  },
);

export const wrappedDurchgangAbbrechenAction = defineAction(
  {
    name: 'wrapped.snapshots.cancel',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.generate,
    schema: z.object({ campaignId: z.string().cuid(), runId: z.string().cuid() }),
    rateLimit: 'wrappedStudio',
    freshness: 'critical',
  },
  async ({ input }) => {
    await wrapped.brichDurchgangAb(input.runId);
    neuLaden(input.campaignId);
    return { abgebrochen: true };
  },
);

export const wrappedVeroeffentlichenAction = defineAction(
  {
    name: 'wrapped.publish',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.publish,
    schema: z.object({ campaignId: z.string().cuid() }),
    rateLimit: 'wrappedFreigabe',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const campaign = await wrapped.veroeffentliche(input.campaignId, wrappedHandelnder(ctx));
    neuLaden(input.campaignId);
    revalidatePath('/');
    return { key: campaign.key };
  },
);

export const wrappedZurueckziehenAction = defineAction(
  {
    name: 'wrapped.unpublish',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.publish,
    schema: z.object({ campaignId: z.string().cuid(), grund: z.string().trim().min(3).max(300) }),
    rateLimit: 'wrappedFreigabe',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await wrapped.ziehZurueck(input.campaignId, wrappedHandelnder(ctx), input.grund);
    neuLaden(input.campaignId);
    revalidatePath('/');
    return { zurueckgezogen: true };
  },
);

export const wrappedArchivierenAction = defineAction(
  {
    name: 'wrapped.archive',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.publish,
    schema: z.object({ campaignId: z.string().cuid() }),
    rateLimit: 'wrappedFreigabe',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await wrapped.archiviere(input.campaignId, wrappedHandelnder(ctx));
    neuLaden(input.campaignId);
    return { archiviert: true };
  },
);

/**
 * Die Vorschau.
 *
 * ## Was sie tut
 *
 * Sie rechnet einen Rueckblick durch und gibt ihn zurueck. Das ist alles.
 *
 * ## Was sie nicht tut
 *
 * Sie legt keine Momentaufnahme an, vergibt kein XP, verschickt keine
 * Benachrichtigung, schreibt nichts nach Discord, vergibt kein Achievement
 * und vermerkt bei niemandem, sein Rueckblick sei angesehen worden. Genau
 * das ist die Bedingung dafuer, dass man im Studio die Zahlen einer echten
 * Person ansehen darf: es passiert dieser Person dabei nichts.
 *
 * Belegt wird das nicht durch diesen Kommentar, sondern durch
 * `tests/integration/wrapped-vorschau.test.ts`, das die Zeilenzahlen aller
 * betroffenen Tabellen vor und nach dem Aufruf vergleicht.
 */
export const wrappedVorschauAction = defineAction(
  {
    name: 'wrapped.preview',
    module: wrapped.WRAPPED_MODULE_ID,
    permission: wrapped.WRAPPED_PERMISSIONS.preview,
    schema: z.object({
      campaignId: z.string().cuid(),
      quelle: z.enum(['person', 'fixture']),
      discordId: z
        .string()
        .trim()
        .regex(/^[0-9]{5,25}$/)
        .nullish(),
      persona: z.string().trim().max(40).nullish(),
      ueberschreibung: z
        .object({
          voiceSeconds: z.coerce.number().int().min(0).max(40_000_000).optional(),
          messages: z.coerce.number().int().min(0).max(5_000_000).optional(),
          levelStart: z.coerce.number().int().min(0).max(999).optional(),
          levelEnd: z.coerce.number().int().min(0).max(999).optional(),
          clipWins: z.coerce.number().int().min(0).max(999).optional(),
          activeDays: z.coerce.number().int().min(0).max(366).optional(),
          primeTimeStunde: z.coerce.number().int().min(0).max(23).optional(),
          displayName: z.string().trim().max(60).optional(),
        })
        .optional(),
    }),
    rateLimit: 'wrappedVorschau',
    freshness: 'cached',
  },
  async ({ input }): Promise<VorschauErgebnis> => {
    const campaign = await wrapped.verlangeKampagne(input.campaignId);
    return baueVorschau(campaign, {
      quelle: input.quelle,
      discordId: input.discordId ?? null,
      persona: input.persona ?? null,
      ...(input.ueberschreibung ? { ueberschreibung: input.ueberschreibung } : {}),
    });
  },
);

/**
 * Den eigenen Fortschritt merken.
 *
 * Selbstbedienung: die Aktion schreibt ausschliesslich auf die Kennung der
 * aufrufenden Person. Eine fremde Kennung aus der Eingabe gibt es nicht -
 * sie wird gar nicht erst entgegengenommen.
 *
 * Und sie laeuft **nur** fuer eine veroeffentlichte Kampagne. Damit kann
 * eine Vorschau sie nicht ausloesen, selbst wenn jemand sie von Hand
 * aufriefe: einen Entwurf sieht niemand als «angesehen».
 */
export const wrappedFortschrittAction = defineAction(
  {
    name: 'wrapped.progress',
    module: wrapped.WRAPPED_MODULE_ID,
    selfService: true,
    schema: z.object({
      campaignId: z.string().cuid(),
      sceneKey: z.string().trim().max(64),
      abgeschlossen: z.boolean().optional(),
    }),
    rateLimit: 'wrappedFortschritt',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const campaign = await prisma.wrappedCampaign.findUnique({
      where: { id: input.campaignId },
      select: { id: true, status: true },
    });
    if (!campaign || campaign.status !== 'PUBLISHED') {
      return { gemerkt: false };
    }

    const jetzt = new Date();
    await prisma.wrappedView.upsert({
      where: {
        campaignId_discordId: { campaignId: campaign.id, discordId: ctx.user.discordId },
      },
      create: {
        campaignId: campaign.id,
        discordId: ctx.user.discordId,
        firstOpenedAt: jetzt,
        lastOpenedAt: jetzt,
        lastSceneKey: input.sceneKey,
        ...(input.abgeschlossen ? { completedAt: jetzt } : {}),
      },
      update: {
        lastOpenedAt: jetzt,
        lastSceneKey: input.sceneKey,
        ...(input.abgeschlossen ? { completedAt: jetzt } : {}),
      },
    });
    return { gemerkt: true };
  },
);
