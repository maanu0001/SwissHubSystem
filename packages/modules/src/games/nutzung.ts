import { prisma } from '@swisshub/database';

/**
 * Wo ein Spiel ueberall vorkommt.
 *
 * Gezaehlt wird aus den echten Zeilen und nicht aus einem Zaehler am Spiel:
 * ein mitgefuehrter Wert laeuft frueher oder spaeter auseinander, und dann
 * steht in der Verwaltung eine Zahl, die niemand nachrechnen kann.
 *
 * Die Verwaltung braucht das fuer eine einzige Frage: was haengt dran, wenn
 * ich dieses Spiel archiviere?
 */
export interface GameNutzung {
  turniere: number;
  clips: number;
  runden: number;
}

export async function nutzungJeGame(): Promise<Map<string, GameNutzung>> {
  const [turniere, clips, kandidaten] = await Promise.all([
    prisma.tournament.groupBy({ by: ['gameId'], _count: { _all: true } }),
    prisma.clip.groupBy({ by: ['gameId'], _count: { _all: true } }),
    prisma.spielwahlCandidate.groupBy({ by: ['gameId'], _count: { _all: true } }),
  ]);

  const nutzung = new Map<string, GameNutzung>();
  const eintrag = (gameId: string): GameNutzung => {
    const vorhanden = nutzung.get(gameId);
    if (vorhanden) {
      return vorhanden;
    }
    const neu: GameNutzung = { turniere: 0, clips: 0, runden: 0 };
    nutzung.set(gameId, neu);
    return neu;
  };

  for (const zeile of turniere) {
    if (zeile.gameId) {
      eintrag(zeile.gameId).turniere = zeile._count._all;
    }
  }
  for (const zeile of clips) {
    if (zeile.gameId) {
      eintrag(zeile.gameId).clips = zeile._count._all;
    }
  }
  for (const zeile of kandidaten) {
    if (zeile.gameId) {
      eintrag(zeile.gameId).runden = zeile._count._all;
    }
  }

  return nutzung;
}
