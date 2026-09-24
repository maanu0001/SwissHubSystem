import { AUDIT_ACTIONS, Prisma, prisma, safeRecordAudit } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict } from '@swisshub/shared';
import type { Game } from '@swisshub/database';
import { CONTENT_TYPE, deleteUpload, readUpload, storeLogoUpload } from '../branding/storage';
import { GAMES_PERMISSION } from './config';
import type { GameBearbeitenEingabe, GameEingabe } from './schemas';

const log = createLogger('games:verwaltung');

/**
 * Den Katalog pflegen.
 *
 * ## Wer darf
 *
 * Genau eine Berechtigung: `spielwahl.games.manage`. Sie sitzt bei «Was
 * spielen wir?», weil dort die Verwaltung steht - geprueft wird sie hier, im
 * Dienst, und nicht erst in der Oberflaeche. Es gibt mehrere Aufrufer
 * (Seite, Aktion, spaeter vielleicht ein Befehl), und jeder von ihnen darf
 * sich darauf verlassen, dass der Dienst selbst nachsieht.
 *
 * Lesen darf dagegen jedes Mitglied: der Katalog ist die Grundlage von
 * Turnieren, Clips und Runden. Wer ein Spiel auswaehlt, veraendert nichts.
 *
 * ## Archivieren statt loeschen
 *
 * An einem Spiel haengen Turniere, Clips und vergangene Runden. Ein `DELETE`
 * waere schnell und wuerde deren Vergangenheit unleserlich machen; die
 * Kandidatenzeilen einer abgeschlossenen Runde verloeren ihren Bezug, und die
 * Ergebnisanzeige zeigte einen Gedankenstrich, wo einmal ein Gewinner stand.
 *
 * Deshalb gibt es hier kein Loeschen. `archiviere` nimmt ein Spiel aus jeder
 * Auswahl und aus der Verwaltungsliste; alles, was darauf zeigt, bleibt
 * gueltig und lesbar.
 */

export interface GameActor {
  discordId: string;
  username: string;
  can(permission: string): boolean;
}

/** Hoechstgroesse eines Covers - dieselbe Grenze wie beim Kartenhintergrund. */
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** Empfohlene Abmessungen: das uebliche Seitenverhaeltnis eines Store-Artworks. */
export const COVER_SIZE = { width: 920, height: 430 } as const;

const nameKeyOf = (name: string): string => name.trim().toLowerCase();

function verlangeBerechtigung(actor: GameActor): void {
  if (!actor.can(GAMES_PERMISSION)) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du darfst den Spielekatalog nicht verändern.',
    });
  }
}

/** Die Felder, die aus einer Eingabe in die Zeile wandern. */
function datenAus(eingabe: GameEingabe) {
  return {
    name: eingabe.name,
    nameKey: nameKeyOf(eingabe.name),
    shortName: eingabe.shortName,
    description: eingabe.description,
    genre: eingabe.genre,
    platforms: eingabe.platforms,
    coverUrl: eingabe.coverUrl,
    maxPlayers: eingabe.maxPlayers,
    enabled: eingabe.enabled,
  };
}

/**
 * Derselbe Titel zweimal.
 *
 * `nameKey` ist eindeutig und kleingeschrieben - «Valheim» und «valheim»
 * sind dasselbe Spiel. Der Datenbankfehler wird in eine Antwort uebersetzt,
 * die der Person etwas sagt; ein vorheriges Nachsehen waere ein zweiter Weg
 * mit einer Luecke dazwischen.
 */
function alsKonflikt(error: unknown, name: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw conflict(`Es gibt bereits ein Spiel mit dem Namen "${name}".`);
  }
  throw error;
}

export async function erstelleGame(eingabe: GameEingabe, actor: GameActor): Promise<Game> {
  verlangeBerechtigung(actor);

  try {
    const game = await prisma.game.create({
      data: { ...datenAus(eingabe), createdByDiscordId: actor.discordId },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.GAME_CREATED,
      module: 'spielwahl',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetLabel: game.name,
      metadata: { gameId: game.id, name: game.name, platforms: game.platforms },
    });

    log.info('Spiel angelegt', { gameId: game.id, name: game.name });
    return game;
  } catch (error) {
    alsKonflikt(error, eingabe.name);
  }
}

export async function bearbeiteGame(eingabe: GameBearbeitenEingabe, actor: GameActor): Promise<Game> {
  verlangeBerechtigung(actor);

  const vorher = await prisma.game.findUnique({ where: { id: eingabe.gameId } });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  try {
    const game = await prisma.game.update({
      where: { id: eingabe.gameId },
      data: datenAus(eingabe),
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.GAME_UPDATED,
      module: 'spielwahl',
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      targetLabel: game.name,
      metadata: {
        gameId: game.id,
        name: game.name,
        // Nur die tatsaechlichen Aenderungen - das haelt das Protokoll lesbar.
        geaendert: [
          vorher.name !== game.name ? 'name' : null,
          vorher.shortName !== game.shortName ? 'shortName' : null,
          vorher.description !== game.description ? 'description' : null,
          vorher.genre !== game.genre ? 'genre' : null,
          vorher.platforms.join(',') !== game.platforms.join(',') ? 'platforms' : null,
          vorher.coverUrl !== game.coverUrl ? 'coverUrl' : null,
          vorher.maxPlayers !== game.maxPlayers ? 'maxPlayers' : null,
          vorher.enabled !== game.enabled ? 'enabled' : null,
        ].filter(Boolean),
      },
    });

    return game;
  } catch (error) {
    alsKonflikt(error, eingabe.name);
  }
}

/**
 * Ein Spiel aus dem Katalog nehmen.
 *
 * Idempotent: ein zweiter Aufruf aendert nichts und schreibt nichts. Der
 * Zustandswechsel ist ein bedingtes `updateMany` - wer ihn als Erster
 * vollzieht, schreibt den Protokolleintrag.
 */
export async function archiviereGame(gameId: string, actor: GameActor): Promise<boolean> {
  verlangeBerechtigung(actor);

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  const { count } = await prisma.game.updateMany({
    where: { id: gameId, archivedAt: null },
    // Archiviert heisst auch abgeschaltet. Ein archiviertes Spiel, das
    // weiterhin `enabled` waere, stuende in keiner Liste und trotzdem zur
    // Auswahl - ein Zustand, den niemand erklaeren koennte.
    data: { archivedAt: new Date(), enabled: false },
  });
  if (count === 0) {
    return false;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAME_ARCHIVED,
    module: 'spielwahl',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: game.name,
    metadata: { gameId, name: game.name },
  });

  log.info('Spiel archiviert', { gameId, name: game.name });
  return true;
}

/** Und wieder zurueck - mit demselben bedingten Wechsel. */
export async function holeGameZurueck(gameId: string, actor: GameActor): Promise<boolean> {
  verlangeBerechtigung(actor);

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  const { count } = await prisma.game.updateMany({
    where: { id: gameId, archivedAt: { not: null } },
    // Zurueckgeholt, aber nicht automatisch wieder im Angebot: ob es aktiv
    // sein soll, entscheidet jemand danach bewusst.
    data: { archivedAt: null },
  });
  if (count === 0) {
    return false;
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAME_RESTORED,
    module: 'spielwahl',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: game.name,
    metadata: { gameId, name: game.name },
  });
  return true;
}

/**
 * Ein Cover hochladen.
 *
 * Ueber denselben Weg wie Logo und Kartenhintergrund: `storeLogoUpload`
 * erkennt das Format an der Datei-Signatur statt am angegebenen Typ, erzeugt
 * den Dateinamen serverseitig und legt ihn ausserhalb des statisch bedienten
 * Verzeichnisses ab. Ein zweiter Speicherweg haette dieselben Fragen noch
 * einmal beantworten muessen - und irgendwann anders.
 */
export async function speichereCover(
  gameId: string,
  actor: GameActor,
  data: Uint8Array,
  declaredMimeType: string | null,
): Promise<{ fileName: string }> {
  verlangeBerechtigung(actor);

  const vorher = await prisma.game.findUnique({
    where: { id: gameId },
    select: { coverPath: true, name: true },
  });
  if (!vorher) {
    throw new AppError('NOT_FOUND', { userMessage: 'Das Spiel wurde nicht gefunden.' });
  }

  const stored = await storeLogoUpload(data, declaredMimeType, 'gamecover', {
    maxBytes: MAX_COVER_BYTES,
    minSize: 64,
    maxSize: 4096,
  });

  await prisma.game.update({ where: { id: gameId }, data: { coverPath: stored.fileName } });

  if (vorher.coverPath && vorher.coverPath !== stored.fileName) {
    await deleteUpload(vorher.coverPath).catch((error: unknown) =>
      log.warn('Vorheriges Cover konnte nicht gelöscht werden', { error }),
    );
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAME_UPDATED,
    module: 'spielwahl',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: vorher.name,
    metadata: { gameId, geaendert: ['cover'], bytes: stored.bytes, format: stored.format },
  });

  return { fileName: stored.fileName };
}

/** Das hochgeladene Cover wieder entfernen - es gilt dann die Adresse, sofern eine steht. */
export async function entferneCover(gameId: string, actor: GameActor): Promise<void> {
  verlangeBerechtigung(actor);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { coverPath: true, name: true },
  });
  if (!game?.coverPath) {
    return;
  }

  await prisma.game.update({ where: { id: gameId }, data: { coverPath: null } });
  await deleteUpload(game.coverPath).catch(() => undefined);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAME_UPDATED,
    module: 'spielwahl',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: game.name,
    metadata: { gameId, geaendert: ['cover'], entfernt: true },
  });
}

/**
 * Das hochgeladene Cover lesen.
 *
 * Hier und nicht in der Route: welcher Dateiname zu welchem Spiel gehoert,
 * weiss der Katalog. Die Route soll ausliefern, nicht nachschlagen.
 */
export async function leseCover(gameId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { coverPath: true } });
  if (!game?.coverPath) {
    return null;
  }
  const file = await readUpload(game.coverPath);
  if (!file) {
    // Der Eintrag zeigt ins Leere - etwa nach einem neu angelegten
    // Upload-Volume. Die Oberflaeche faellt dann auf die verlinkte Adresse
    // zurueck, statt ein kaputtes Bild zu zeigen.
    log.warn('Hinterlegtes Cover fehlt auf der Platte', { gameId });
    return null;
  }
  return { data: file.data, contentType: CONTENT_TYPE[file.format] };
}
