'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { streamer } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Was die Verwaltung des Streamer Hubs tut.
 *
 * ## Jede Aktion prueft serverseitig
 *
 * `defineAction` nimmt `permission` und lehnt ohne sie ab, bevor die Datenbank
 * ueberhaupt gefragt wird. Die Oberflaeche entscheidet, welche Knoepfe sie
 * zeigt; was geschieht, entscheidet diese Datei.
 *
 * ## Die Kennung des Handelnden kommt aus der Sitzung
 *
 * Keine Aktion nimmt eine `discordId` aus dem Formular. Das gilt besonders fuer
 * die eigene Bewerbung: `speichereBewerbung` arbeitet immer auf
 * `ctx.user.discordId`, und es gibt keinen Parameter, mit dem sich das umlenken
 * liesse. Eine fremde Bewerbung zu bearbeiten ist damit keine Frage der
 * Berechtigung, sondern unmoeglich.
 */

const P = streamer.STREAMER_PERMISSIONS;

const neuLaden = (): void => {
  revalidatePath(systemRoutes.streamerHub());
  revalidatePath(systemRoutes.streamerHubStreamer());
  revalidatePath(systemRoutes.streamerHubBewerbungen());
  revalidatePath(systemRoutes.streamerHubBewerbung());
  revalidatePath(systemRoutes.streamerHubAnkuendigungen());
  revalidatePath(systemRoutes.streamerHubStudio());
  /*
   * Die oeffentlichen Seiten mit: eine Freigabe, eine Pause oder ein
   * entfernter Kanal aendert, was ein Besucher sieht. Ohne diese Zeile stuende
   * ein pausierter Streamer weiter in der Uebersicht, bis der Zwischenspeicher
   * von selbst ablaeuft.
   */
  revalidatePath(systemRoutes.streamerOeffentlich());
};

/**
 * Das eigene oeffentliche Profil neu laden.
 *
 * Seit es nur noch eines gibt, ist es das Ziel jeder Aenderung an der Vitrine.
 * Ohne diese Zeile stuende die neue Zeile erst nach einer Minute dort - die
 * Profilseite hat `revalidate = 60`.
 */
const profilNeuLaden = async (discordId: string): Promise<void> => {
  const slug = await streamer.slugFuerProfil(discordId);
  if (slug) {
    revalidatePath(systemRoutes.oeffentlichesProfil(slug));
  }
};

// --- Die eigene Bewerbung -----------------------------------------------------

export const speichereBewerbungAction = defineAction(
  {
    name: 'streamer.speichereBewerbung',
    permission: P.apply,
    schema: streamer.bewerbungSchema,
    rateLimit: 'streamerBewerbung',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.speichereBewerbung(ctx.user.discordId, input);
    neuLaden();
    return {
      status: ergebnis.profil.status,
      kanaele: ergebnis.profil.kanaele.length,
      /*
       * Welche Plattform vergeben war - aber nicht, an wen. Die Bewerbungsmaske
       * soll kein Werkzeug sein, um herauszufinden, welches Mitglied welchen
       * Kanal hat.
       */
      vergeben: ergebnis.vergeben,
    };
  },
);

export const reicheEinAction = defineAction(
  {
    name: 'streamer.reicheEin',
    permission: P.apply,
    schema: z.object({}),
    rateLimit: 'streamerBewerbung',
  },
  async ({ ctx }) => {
    const ergebnis = await streamer.reicheEin(ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

// --- Die eigene Vitrine -------------------------------------------------------

/**
 * Bis zu drei eigene Clips und eine hervorgehobene Zeile.
 *
 * ## Warum `P.apply` und nicht `P.manage`
 *
 * Weil es die eigene Seite ist. Dieselbe Berechtigung, mit der jemand seine
 * Bewerbung pflegt - wer Streamer werden darf, darf seinen Auftritt gestalten.
 * `manage` ist die Befugnis, in **fremde** Profile zu greifen, und dafuer
 * braucht es diese Aktionen nicht.
 *
 * ## Warum dennoch kein `selfService`
 *
 * Es ist Selbstbedienung, und die Kennung kommt ausnahmslos aus der Sitzung -
 * aber eine feste Permission ist die klarere Auskunft: nur ein **freigegebener**
 * Streamer hat eine Vitrine, und `verlangeFreigegeben` im Modul prueft genau
 * das. Zwei Riegel, und der zweite kennt den Zustand des Profils.
 */
export const setzeVitrineClipAction = defineAction(
  {
    name: 'streamer.setzeVitrineClip',
    permission: P.apply,
    schema: z.object({
      position: z.coerce
        .number()
        .int()
        .min(0)
        .max(streamer.MAX_VITRINE_CLIPS - 1),
      url: z.string().trim().min(1).max(500),
      titel: z.string().trim().max(70).optional(),
    }),
    rateLimit: 'streamerBewerbung',
  },
  async ({ ctx, input }) => {
    const clip = await streamer.setzeVitrineClip(
      ctx.user.discordId,
      input.position,
      input.url,
      input.titel ?? null,
    );
    neuLaden();
    await profilNeuLaden(ctx.user.discordId);
    return { position: clip.position, provider: clip.provider };
  },
);

export const entferneVitrineClipAction = defineAction(
  {
    name: 'streamer.entferneVitrineClip',
    permission: P.apply,
    schema: z.object({
      position: z.coerce
        .number()
        .int()
        .min(0)
        .max(streamer.MAX_VITRINE_CLIPS - 1),
    }),
    rateLimit: 'streamerBewerbung',
  },
  async ({ ctx, input }) => {
    await streamer.entferneVitrineClip(ctx.user.discordId, input.position);
    neuLaden();
    await profilNeuLaden(ctx.user.discordId);
    return { entfernt: true };
  },
);

export const setzeVitrineCaptionAction = defineAction(
  {
    name: 'streamer.setzeVitrineCaption',
    permission: P.apply,
    // Ein leerer Text loescht die Zeile - siehe `setzeVitrineCaption`. Deshalb
    // keine Mindestlaenge: «leer» ist hier eine Angabe und kein Fehler.
    schema: z.object({ text: z.string().max(streamer.MAX_CAPTION_LAENGE + 1) }),
    rateLimit: 'streamerBewerbung',
  },
  async ({ ctx, input }) => {
    const caption = await streamer.setzeVitrineCaption(ctx.user.discordId, input.text);
    neuLaden();
    await profilNeuLaden(ctx.user.discordId);
    return { caption };
  },
);

// --- Bewerbungen pruefen ------------------------------------------------------

export const genehmigeAction = defineAction(
  {
    name: 'streamer.genehmige',
    permission: P.review,
    schema: z.object({ profilId: z.string().cuid() }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.genehmige(input.profilId, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

export const lehneAbAction = defineAction(
  {
    name: 'streamer.lehneAb',
    permission: P.review,
    schema: z.object({
      profilId: z.string().cuid(),
      // Ohne Grund keine Ablehnung: die Person soll wissen, was fehlt.
      grund: z.string().trim().min(5, 'Bitte begründe die Ablehnung.').max(500),
    }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.lehneAb(input.profilId, input.grund, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

export const bestaetigeVonHandAction = defineAction(
  {
    name: 'streamer.bestaetigeVonHand',
    permission: P.review,
    schema: z.object({ kanalId: z.string().cuid() }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.bestaetigeVonHand(input.kanalId, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

// --- Streamer verwalten -------------------------------------------------------

export const pausiereAction = defineAction(
  {
    name: 'streamer.pausiere',
    permission: P.manage,
    schema: z.object({ profilId: z.string().cuid(), grund: z.string().trim().max(500).default('') }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.pausiere(input.profilId, input.grund, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

export const schalteFreiAction = defineAction(
  {
    name: 'streamer.schalteFrei',
    permission: P.manage,
    schema: z.object({ profilId: z.string().cuid() }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.schalteFrei(input.profilId, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

export const entferneKanalAction = defineAction(
  {
    name: 'streamer.entferneKanal',
    permission: P.manage,
    schema: z.object({
      profilId: z.string().cuid(),
      plattform: z.enum(['TWITCH', 'YOUTUBE']),
    }),
    rateLimit: 'streamerReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.entferneKanal(input.profilId, input.plattform, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

export const setzeAnkuendigungAction = defineAction(
  {
    name: 'streamer.setzeAnkuendigung',
    permission: P.manage,
    schema: z.object({ profilId: z.string().cuid(), aktiv: z.boolean() }),
    rateLimit: 'streamerReview',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.setzeAnkuendigung(input.profilId, input.aktiv, ctx.user.discordId);
    neuLaden();
    return ergebnis;
  },
);

// --- Content Studio -----------------------------------------------------------

export const erstelleSpotlightAction = defineAction(
  {
    name: 'streamer.erstelleSpotlight',
    permission: P.spotlight,
    schema: z.object({ profilId: z.string().cuid() }),
    rateLimit: 'streamerReview',
  },
  async ({ ctx, input }) => {
    const spotlight = await streamer.erstelleSpotlight(input.profilId, ctx.user.discordId);
    neuLaden();
    return { spotlightId: spotlight.id };
  },
);

export const bearbeiteSpotlightAction = defineAction(
  {
    name: 'streamer.bearbeiteSpotlight',
    permission: P.spotlight,
    schema: z.object({
      spotlightId: z.string().cuid(),
      ueberschrift: z.string().trim().max(60).optional(),
      beschreibung: z.string().trim().max(280).optional(),
      cta: z.string().trim().max(80).optional(),
    }),
    rateLimit: 'streamerReview',
  },
  async ({ input }) => {
    const { spotlightId, ...texte } = input;
    await streamer.bearbeiteSpotlight(spotlightId, texte);
    revalidatePath(systemRoutes.streamerHubSpotlight(spotlightId));
    return { gespeichert: true };
  },
);

export const finalisiereSpotlightAction = defineAction(
  {
    name: 'streamer.finalisiereSpotlight',
    permission: P.spotlight,
    schema: z.object({ spotlightId: z.string().cuid() }),
    rateLimit: 'streamerReview',
  },
  async ({ input }) => {
    await streamer.finalisiere(input.spotlightId);
    revalidatePath(systemRoutes.streamerHubSpotlight(input.spotlightId));
    revalidatePath(systemRoutes.streamerHubStudio());
    return { abgeschlossen: true };
  },
);

/**
 * Einen Spotlight auf Discord senden.
 *
 * Eigene Berechtigung (`publish`), eigenes Rate Limit, `freshness: 'critical'`.
 * Das ist die einzige Aktion dieses Moduls, die von sich aus eine Nachricht an
 * alle im Kanal erzeugt - und sie wird nie von einem Job gerufen, sondern
 * ausschliesslich von einem Menschen mit dieser Berechtigung.
 */
export const veroeffentlicheSpotlightAction = defineAction(
  {
    name: 'streamer.veroeffentlicheSpotlight',
    permission: P.publish,
    schema: z.object({ spotlightId: z.string().cuid() }),
    rateLimit: 'streamerPublish',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await streamer.veroeffentlicheAufDiscord(input.spotlightId, ctx.user.discordId);
    revalidatePath(systemRoutes.streamerHubSpotlight(input.spotlightId));
    revalidatePath(systemRoutes.streamerHubStudio());
    return ergebnis;
  },
);
