'use server';

import { z } from 'zod';
import { notifications } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Lesezustand der eigenen Benachrichtigungen.
 *
 * `selfService`: beide Aktionen wirken ausschliesslich auf die Meldungen des
 * Aufrufers. Die Empfänger-ID kommt aus der Sitzung, nie aus der Eingabe -
 * deshalb kann niemand fremde Meldungen als gelesen markieren und über die
 * Antwort erfahren, dass es sie gibt.
 */

export const markiereGelesenAction = defineAction(
  {
    name: 'notifications.read',
    selfService: true,
    schema: z.object({ id: z.string().min(1).max(64) }),
    rateLimit: 'notificationRead',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    const geaendert = await notifications.markiereGelesen(ctx.user.discordId, input.id);
    return { geaendert, ungelesen: await notifications.zaehleUngelesene(ctx.user.discordId) };
  },
);

export const markiereAlleGelesenAction = defineAction(
  {
    name: 'notifications.readAll',
    selfService: true,
    // Die Aktion nimmt nichts entgegen - und sagt das ausdruecklich. Ein
    // leeres Schema wirft alles weg, was ein Browser sonst noch mitschickt.
    schema: z.object({}),
    rateLimit: 'notificationRead',
    freshness: 'cached',
  },
  async ({ ctx }) => {
    const anzahl = await notifications.markiereAlleGelesen(ctx.user.discordId);
    return { anzahl, ungelesen: 0 };
  },
);
