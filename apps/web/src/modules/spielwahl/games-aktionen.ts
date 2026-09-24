'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { games, spielwahl } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Den Spielekatalog pflegen.
 *
 * ## Zweimal geprueft, und das ist Absicht
 *
 * `defineAction` verlangt `spielwahl.games.manage`, und der Dienst prueft
 * dieselbe Berechtigung noch einmal. Das ist keine Doppelung aus
 * Unsicherheit: der Katalogdienst wird auch von anderen Stellen aufgerufen
 * und darf sich nicht darauf verlassen, dass jemand vorher nachgesehen hat.
 *
 * ## Warum hier und nicht in `aktionen.ts`
 *
 * Die Befehle dort gehoeren einer Runde und pruefen eine Sessionrolle. Diese
 * hier gehoeren keiner Runde - sie aendern eine Liste, aus der auch Turniere
 * und Clips schoepfen. Zwei Dateien, weil es zwei Fragen sind.
 */

const handelnder = (ctx: AuthContext): games.GameActor => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  can: (permission: string) => can(ctx, permission),
});

/** Die Verwaltung neu laden - und die Stellen, die den Katalog anzeigen. */
function neuLaden(): void {
  revalidatePath('/was-spielen-wir/games');
  revalidatePath('/was-spielen-wir');
}

export const gameAnlegenAction = defineAction(
  {
    name: 'spielwahl.games.create',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.gamesManage,
    schema: games.gameAnlegenSchema,
    rateLimit: 'gameWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const spiel = await games.erstelleGame(input, handelnder(ctx));
    neuLaden();
    return { gameId: spiel.id, name: spiel.name };
  },
);

export const gameBearbeitenAction = defineAction(
  {
    name: 'spielwahl.games.update',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.gamesManage,
    schema: games.gameBearbeitenSchema,
    rateLimit: 'gameWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const spiel = await games.bearbeiteGame(input, handelnder(ctx));
    neuLaden();
    return { gameId: spiel.id, name: spiel.name };
  },
);

export const gameArchivierenAction = defineAction(
  {
    name: 'spielwahl.games.archive',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.gamesManage,
    schema: games.gameIdSchema,
    rateLimit: 'gameWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const erfolg = await games.archiviereGame(input.gameId, handelnder(ctx));
    if (!erfolg) {
      throw new AppError('CONFLICT', { userMessage: 'Dieses Spiel ist bereits archiviert.' });
    }
    neuLaden();
    return { archiviert: true };
  },
);

export const gameZurueckholenAction = defineAction(
  {
    name: 'spielwahl.games.restore',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.gamesManage,
    schema: games.gameIdSchema,
    rateLimit: 'gameWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const erfolg = await games.holeGameZurueck(input.gameId, handelnder(ctx));
    if (!erfolg) {
      throw new AppError('CONFLICT', { userMessage: 'Dieses Spiel ist gar nicht archiviert.' });
    }
    neuLaden();
    return { zurueckgeholt: true };
  },
);

export const gameCoverEntfernenAction = defineAction(
  {
    name: 'spielwahl.games.coverRemove',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    permission: spielwahl.SPIELWAHL_PERMISSIONS.gamesManage,
    schema: z.object({ gameId: z.string().cuid() }),
    rateLimit: 'gameWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await games.entferneCover(input.gameId, handelnder(ctx));
    neuLaden();
    return { entfernt: true };
  },
);
