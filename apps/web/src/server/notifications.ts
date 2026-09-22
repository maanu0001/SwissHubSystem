import 'server-only';
import { cache } from 'react';
import { notifications } from '@swisshub/modules';
import { istInterneRoute } from '@swisshub/shared';
import type { AuthContext } from '@swisshub/auth';

/**
 * Die Glocke der angemeldeten Person.
 *
 * `cache()` sorgt dafür, dass Kopfzeile und Panel sich pro Seitenaufbau eine
 * Antwort teilen.
 *
 * **In der Vorschau bleibt sie leer.** Persönliche Benachrichtigungen einer
 * anderen Person wären das Gegenteil einer Vorschau - sie sind ihr Posteingang.
 * Der Aufrufer entscheidet das; hier steht nur, dass diese Funktion immer die
 * Meldungen des **echten** Kontos liefert und nie die einer Vorschau-Person.
 */
export const ladeGlocke = cache(async (discordId: string): Promise<notifications.GlockenAnsicht> =>
  notifications.glocke(discordId).catch(() => ({ eintraege: [], ungelesen: 0 })),
);

export interface GlockenEintrag {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  route: string | null;
  count: number;
  gelesen: boolean;
  createdAt: Date;
}

/**
 * Was der Browser zu sehen bekommt.
 *
 * Bewusst nicht die Datenbankzeile: `dedupeKey`, `groupKey` und die
 * Empfänger-ID gehen den Browser nichts an. Die Adresse wird ein zweites Mal
 * geprüft - eine Meldung aus der Zeit vor dieser Prüfung soll keinen
 * fremden Verweis in die Oberfläche tragen.
 */
export function alsGlockenEintrag(
  eintrag: notifications.GlockenAnsicht['eintraege'][number],
): GlockenEintrag {
  return {
    id: eintrag.id,
    kind: eintrag.kind,
    title: eintrag.title,
    body: eintrag.body,
    route: eintrag.route && istInterneRoute(eintrag.route) ? eintrag.route : null,
    count: eintrag.count,
    gelesen: eintrag.readAt !== null,
    createdAt: eintrag.createdAt,
  };
}

/** Die Glocke für einen Sicherheitskontext - immer die des echten Kontos. */
export async function glockeFuer(
  context: AuthContext,
): Promise<{ eintraege: GlockenEintrag[]; ungelesen: number }> {
  const ansicht = await ladeGlocke(context.user.discordId);
  return { eintraege: ansicht.eintraege.map(alsGlockenEintrag), ungelesen: ansicht.ungelesen };
}
