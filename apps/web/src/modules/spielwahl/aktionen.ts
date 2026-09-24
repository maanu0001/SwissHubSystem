'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { spielwahl } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import { forbidden, notFound, systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { spielwahlThema, wecke } from '@/server/live-bus';
import type { AuthContext } from '@swisshub/auth';

/**
 * Die Befehle einer Spielauswahl.
 *
 * ## Drei Schichten, und jede prueft etwas anderes
 *
 *   1. `defineAction` - angemeldet, Mitglied der Guild, CSRF, Ratengrenze,
 *      Berechtigung im System. Dieselbe Kette wie ueberall.
 *   2. Die **Sessionrolle** - Host, Co-Host oder Gast. Sie steht in der
 *      Session und nicht in den Rechten des Systems: wer eine Runde
 *      eroeffnet, fuehrt sie, und ein Moderator ist in einer fremden Runde
 *      erst einmal Gast.
 *   3. Die **Statusmaschine** im Modul. Sie entscheidet, ob ein Befehl im
 *      aktuellen Zustand ueberhaupt existiert.
 *
 * Keine dieser Schichten ersetzt eine andere. Wer nur die erste hat, kann
 * eine fremde Runde starten; wer nur die zweite hat, kann als Host stimmen,
 * obwohl die Abstimmung vorbei ist.
 *
 * ## Der Idempotenzschluessel
 *
 * Jeder Befehl, der den Zustand aller aendert, traegt einen mit. Er kommt aus
 * dem Browser - nur dort weiss man, ob der zweite Klick derselbe Klick war.
 * Siehe `spielwahl/befehl.ts`.
 */

const handelnder = (ctx: AuthContext): spielwahl.Handelnder => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

/**
 * Die offenen Stroeme wecken.
 *
 * Nach jeder Aenderung, nicht davor: geweckt wird, wenn die Transaktion
 * durch ist und die neue Revision in der Datenbank steht. Ein Wecker, der zu
 * frueh kommt, laesst die Stroeme den alten Stand lesen.
 */
const anstossen = (sessionId: string): void => {
  wecke(spielwahlThema(sessionId));
};

const neuLaden = (): void => {
  revalidatePath(systemRoutes.spielwahl());
};

/** Die Session laden und pruefen, dass sie zur eigenen Guild gehoert. */
async function ladeSession(sessionId: string) {
  const guildId = await resolveGuildId();
  const session = await spielwahl.finde(guildId, sessionId);
  if (!session) {
    throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht.');
  }
  return session;
}

const sessionId = spielwahl.sessionIdSchema;
const schluessel = spielwahl.befehlsSchluessel;

// ---------------------------------------------------------------------------
// Eroeffnen und beitreten
// ---------------------------------------------------------------------------

export const spielwahlEroeffnenAction = defineAction(
  {
    name: 'spielwahl.session.create',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.create,
    schema: spielwahl.sessionEinstellungenSchema,
    rateLimit: 'spielwahlEroeffnen',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const session = await spielwahl.eroeffne({ guildId, host: handelnder(ctx), optionen: input });
    neuLaden();
    return { sessionId: session.id, inviteToken: session.inviteToken };
  },
);

export const spielwahlBeitretenAction = defineAction(
  {
    name: 'spielwahl.session.join',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'join',
        discordId: ctx.user.discordId,
      },
      async () => ({ art: await spielwahl.tritteBei(input.sessionId, ctx.user.discordId) }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

export const spielwahlVerlassenAction = defineAction(
  {
    name: 'spielwahl.session.leave',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    selfService: true,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    // Selbstbedienung: wirkt ausschliesslich auf den Aufrufer selbst.
    await ladeSession(input.sessionId);
    await spielwahl.verlasse(input.sessionId, ctx.user.discordId);
    anstossen(input.sessionId);
    neuLaden();
    return { ok: true };
  },
);

/**
 * Lebenszeichen.
 *
 * Selbstbedienung, weil sie nichts anfasst ausser der eigenen Zeile - und
 * bewusst **ohne** Wecken: ein Lebenszeichen ist keine Nachricht an die
 * anderen, und sechs Browser, die sich gegenseitig alle zwanzig Sekunden
 * wecken, waeren ein Polling mit Umweg.
 */
export const spielwahlHierAction = defineAction(
  {
    name: 'spielwahl.session.ping',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    selfService: true,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'cached',
    csrf: false,
  },
  async ({ ctx, input }) => {
    await spielwahl.melde(input.sessionId, ctx.user.discordId);
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Vorschlagen
// ---------------------------------------------------------------------------

export const spielwahlVorschlagenAction = defineAction(
  {
    name: 'spielwahl.candidate.add',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }).and(spielwahl.kandidatSchema),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.verlangeTeilnahme(input.sessionId, ctx.user.discordId);

    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'suggest',
        discordId: ctx.user.discordId,
      },
      () =>
        spielwahl.schlageVor(input.sessionId, ctx.user.discordId, {
          gameId: input.gameId,
          freierName: input.freierName,
        }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

export const spielwahlZurueckziehenAction = defineAction(
  {
    name: 'spielwahl.candidate.withdraw',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    selfService: true,
    schema: z.object({ sessionId, candidateId: z.string().trim().min(1).max(64) }),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    // Selbstbedienung: entfernt ausschliesslich die eigene Unterstuetzung.
    await ladeSession(input.sessionId);
    await spielwahl.nimmZurueck(input.sessionId, ctx.user.discordId, input.candidateId);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlKandidatEntfernenAction = defineAction(
  {
    name: 'spielwahl.candidate.remove',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, candidateId: z.string().trim().min(1).max(64) }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.verlangeFuehrung(input.sessionId, ctx.user.discordId);
    await spielwahl.entferneKandidat(input.sessionId, input.candidateId);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlSpieleSuchenAction = defineAction(
  {
    name: 'spielwahl.games.search',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ query: z.string().trim().max(60).default('') }),
    rateLimit: 'spielwahlMitmachen',
    freshness: 'cached',
    csrf: false,
  },
  async ({ input }) => {
    // Liest nur den gemeinsamen Katalog - dieselbe Liste, aus der auch
    // Turniere und Clips schoepfen.
    return { spiele: await spielwahl.sucheSpiele(input.query) };
  },
);

// ---------------------------------------------------------------------------
// Fuehrung
// ---------------------------------------------------------------------------

export const spielwahlPhaseSchliessenAction = defineAction(
  {
    name: 'spielwahl.phase.close',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'close-phase',
        discordId: ctx.user.discordId,
      },
      async () => {
        await spielwahl.schliesseVorschlaege(input.sessionId, handelnder(ctx));
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlPhaseOeffnenAction = defineAction(
  {
    name: 'spielwahl.phase.reopen',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'reopen',
        discordId: ctx.user.discordId,
      },
      async () => {
        await spielwahl.oeffneVorschlaege(input.sessionId, handelnder(ctx));
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlModusSetzenAction = defineAction(
  {
    name: 'spielwahl.mode.set',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId }).and(spielwahl.sessionEinstellungenSchema),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.verlangeFuehrung(input.sessionId, ctx.user.discordId);
    await spielwahl.aendereEinstellungen(input.sessionId, input);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlStartenAction = defineAction(
  {
    name: 'spielwahl.round.start',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'start',
        discordId: ctx.user.discordId,
      },
      async () => ({ rundenId: await spielwahl.starte(input.sessionId, handelnder(ctx)) }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

export const spielwahlNeuLosenAction = defineAction(
  {
    name: 'spielwahl.round.reroll',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'reroll',
        discordId: ctx.user.discordId,
      },
      async () => ({ rundenId: await spielwahl.loseNeu(input.sessionId, handelnder(ctx)) }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

export const spielwahlNochEineAction = defineAction(
  {
    name: 'spielwahl.round.again',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'again',
        discordId: ctx.user.discordId,
      },
      async () => {
        await spielwahl.nochEine(input.sessionId, handelnder(ctx));
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlAnnehmenAction = defineAction(
  {
    name: 'spielwahl.result.accept',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'accept',
        discordId: ctx.user.discordId,
      },
      async () => {
        await spielwahl.nimmAn(input.sessionId, handelnder(ctx));
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    neuLaden();
    return { ok: true };
  },
);

/**
 * Die Runde schliessen.
 *
 * Zwei Wege in einer Aktion, und der zweite steht ausdruecklich da: der Host
 * schliesst seine eigene Runde, und wer `spielwahl.manage` hat, kann eine
 * fremde beenden. Letzteres steht im Protokoll.
 */
export const spielwahlSchliessenAction = defineAction(
  {
    name: 'spielwahl.session.close',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    const fuehrt = await spielwahl.fuehrt(input.sessionId, ctx.user.discordId);
    const alsModeration = !fuehrt && can(ctx, spielwahl.SPIELWAHL_PERMISSIONS.manage);
    if (!fuehrt && !alsModeration) {
      throw forbidden('spielwahl: weder Führung noch Moderation', 'Das darf nur der Host dieser Runde.');
    }
    await spielwahl.schliesse(input.sessionId, handelnder(ctx), { alsModeration });
    anstossen(input.sessionId);
    neuLaden();
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Teilnehmer
// ---------------------------------------------------------------------------

export const spielwahlTeilnehmerEntfernenAction = defineAction(
  {
    name: 'spielwahl.participant.remove',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({
      sessionId,
      discordId: z
        .string()
        .trim()
        .regex(/^\d{17,20}$/u),
    }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.entferne(input.sessionId, input.discordId, handelnder(ctx));
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlCoHostAction = defineAction(
  {
    name: 'spielwahl.participant.cohost',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({
      sessionId,
      discordId: z
        .string()
        .trim()
        .regex(/^\d{17,20}$/u),
      anheften: z.boolean(),
    }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.setzeCoHost(input.sessionId, input.discordId, input.anheften, handelnder(ctx));
    anstossen(input.sessionId);
    return { ok: true };
  },
);

export const spielwahlUebergebenAction = defineAction(
  {
    name: 'spielwahl.participant.handover',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({
      sessionId,
      discordId: z
        .string()
        .trim()
        .regex(/^\d{17,20}$/u),
    }),
    rateLimit: 'spielwahlFuehrung',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await ladeSession(input.sessionId);
    await spielwahl.uebergib(input.sessionId, input.discordId, handelnder(ctx));
    anstossen(input.sessionId);
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Abstimmen
// ---------------------------------------------------------------------------

export const spielwahlStimmeAction = defineAction(
  {
    name: 'spielwahl.vote',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.view,
    schema: z.object({
      sessionId,
      candidateId: z.string().trim().min(1).max(64),
      duell: z.coerce.number().int().min(0).max(999).default(0),
    }),
    rateLimit: 'spielwahlStimme',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    /*
     * Ohne Idempotenzschluessel - und das ist hier richtig.
     *
     * Eine Stimme ist ein Umschalter: derselbe Klick noch einmal nimmt sie
     * zurueck. Ein Schluessel, der den zweiten Klick verschluckt, naehme
     * genau die Handlung weg, die jemand gerade ausfuehren wollte. Die
     * Eindeutigkeit in der Datenbank verhindert, dass eine Stimme doppelt
     * zaehlt; mehr braucht es hier nicht.
     */
    await ladeSession(input.sessionId);
    await spielwahl.stimme(input.sessionId, ctx.user.discordId, input.candidateId, input.duell);
    anstossen(input.sessionId);
    return { ok: true };
  },
);
