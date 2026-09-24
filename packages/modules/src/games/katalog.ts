import { prisma } from '@swisshub/database';
import type { Game } from '@swisshub/database';

/**
 * Der Spielekatalog - lesend.
 *
 * ## Warum das hier kein Modul ist
 *
 * Ein Modul hat eine Oberflaeche, Berechtigungen und einen Schalter im
 * Dashboard. Der Katalog hat nichts davon: er ist eine Liste, auf die vier
 * Module zeigen - Turniere, Clips, «Was spielen wir?» und die Mitgliederakte.
 * Waere er an eines davon gebunden, haetten die anderen drei ein Problem,
 * sobald dieses eine ausgeschaltet wird.
 *
 * Gepflegt wird er unter «Was spielen wir?». Das ist eine Zustaendigkeit und
 * keine Zugehoerigkeit; dieser Teil hier kennt die Spielwahl nicht.
 *
 * ## Drei Zustaende, nicht zwei
 *
 *   - **aktiv** - steht ueberall zur Auswahl.
 *   - **inaktiv** (`enabled = false`) - wird nicht mehr angeboten, bleibt
 *     aber in der Verwaltung sichtbar und in laufenden Runden gueltig.
 *   - **archiviert** (`archivedAt` gesetzt) - aus der Verwaltung genommen.
 *     Die Zeile bleibt, weil Turniere, Clips und vergangene Runden darauf
 *     zeigen; wer sie loeschte, machte deren Vergangenheit unleserlich.
 */

export interface KatalogFilter {
  /** Auch abgeschaltete Spiele. Fuer die Verwaltung, nicht fuer die Auswahl. */
  includeDisabled?: boolean;
  /** Auch archivierte. Setzt `includeDisabled` voraus, sonst ergibt es nichts. */
  includeArchived?: boolean;
  /** Teilstring in Name oder Kurzform. */
  suche?: string;
  plattform?: string;
}

/** Die Bedingung zu einem Filter - einmal, damit Liste und Zaehlung nicht auseinanderlaufen. */
function bedingung(filter: KatalogFilter): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (!filter.includeDisabled) {
    where.enabled = true;
  }
  if (!filter.includeArchived) {
    where.archivedAt = null;
  }
  if (filter.plattform) {
    where.platforms = { has: filter.plattform };
  }
  const suche = filter.suche?.trim();
  if (suche) {
    where.OR = [
      { name: { contains: suche, mode: 'insensitive' } },
      { shortName: { contains: suche, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * Die Spiele des Katalogs.
 *
 * Ohne Angabe: die aktiven, nicht archivierten - also das, was ueberall
 * ausgewaehlt werden darf. Die Verwaltung fragt ausdruecklich nach mehr.
 */
export async function listGames(filter: KatalogFilter = {}): Promise<Game[]> {
  return prisma.game.findMany({
    where: bedingung(filter),
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getGame(gameId: string): Promise<Game | null> {
  return prisma.game.findUnique({ where: { id: gameId } });
}

/**
 * Auswahlliste fuer Autocomplete.
 *
 * Discord erlaubt hoechstens 25 Vorschlaege; gefiltert wird nach Teilstring,
 * damit sich Tippen wie eine Suche anfuehlt.
 */
export async function searchGames(query: string, limit = 25): Promise<Array<{ id: string; name: string }>> {
  const games = await listGames({ suche: query });
  return games.slice(0, limit).map((game) => ({ id: game.id, name: game.name }));
}

/**
 * Das Cover eines Spiels, als Adresse.
 *
 * Eine hochgeladene Datei gilt vor einer verlinkten - wer ein Bild hochlaedt,
 * will es sehen, auch wenn darunter noch eine alte Adresse steht. Die Datei
 * selbst liegt ausserhalb des statisch bedienten Bereichs und wird ueber eine
 * Route ausgeliefert, die die Berechtigung prueft.
 */
export function coverSrc(game: Pick<Game, 'id' | 'coverPath' | 'coverUrl'>): string | null {
  if (game.coverPath) {
    // Die Version im Pfad sorgt dafuer, dass nach einem Austausch nicht das
    // alte Bild aus dem Browser-Cache erscheint.
    return `/api/games/${game.id}/cover?v=${game.coverPath.slice(-12)}`;
  }
  return game.coverUrl;
}

/** Der Name, der an enge Stellen passt. */
export function kurzname(game: Pick<Game, 'name' | 'shortName'>): string {
  return game.shortName ?? game.name;
}
