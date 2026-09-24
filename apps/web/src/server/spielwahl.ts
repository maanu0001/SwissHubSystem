import 'server-only';
import { prisma } from '@swisshub/database';
import { spielwahl } from '@swisshub/modules';

/**
 * Was die Übersichtsseite braucht.
 *
 * Bewusst hier und nicht in `packages/modules`: das sind Abfragen für **eine
 * Seite**, nicht Fachlogik. Was beide brauchen - die Statusmaschine, die
 * Kandidaten, die Entscheidung - steht im Modul.
 */

export interface RundeInListe {
  id: string;
  inviteToken: string;
  status: spielwahl.SessionAnsicht['status'];
  modus: spielwahl.SessionAnsicht['modus'];
  hostDiscordId: string;
  hostName: string;
  hostAvatar: string | null;
  teilnehmer: number;
  kandidaten: number;
  binDabei: boolean;
  binHost: boolean;
  ergebnisName: string | null;
  createdAt: string;
}

/**
 * Die offenen Runden dieser Guild.
 *
 * ## Warum alle offenen und nicht nur die eigenen
 *
 * Weil eine Runde, die niemand findet, keine Gruppe zusammenbringt. Wer am
 * Freitagabend schaut, ob schon etwas läuft, soll es sehen - das ist der
 * halbe Zweck des Moduls.
 *
 * Öffentlich ist das trotzdem nicht: gelesen wird nur innerhalb der eigenen
 * Guild, und die Seite selbst verlangt Anmeldung und Mitgliedschaft. Eine
 * Suche über Sessions gibt es nicht, und der Einladungswert steht in dieser
 * Liste nur bei Runden, in denen man ohnehin schon dabei ist.
 */
export async function ladeOffeneRunden(guildId: string, betrachter: string): Promise<RundeInListe[]> {
  const sessions = await prisma.spielwahlSession.findMany({
    where: {
      guildId,
      status: { in: spielwahl.OFFENE_ZUSTAENDE },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      participants: { where: { leftAt: null }, select: { discordId: true, rolle: true } },
      _count: { select: { candidates: true } },
    },
  });

  return baueListe(sessions, betrachter);
}

/** Die letzten abgeschlossenen Runden - der Verlauf einer Gruppe. */
export async function ladeVergangeneRunden(guildId: string, betrachter: string): Promise<RundeInListe[]> {
  const sessions = await prisma.spielwahlSession.findMany({
    where: {
      guildId,
      status: 'ABGESCHLOSSEN',
      participants: { some: { discordId: betrachter } },
    },
    orderBy: { closedAt: 'desc' },
    take: 8,
    include: {
      participants: { where: { leftAt: null }, select: { discordId: true, rolle: true } },
      _count: { select: { candidates: true } },
    },
  });

  return baueListe(sessions, betrachter);
}

async function baueListe(
  sessions: Array<{
    id: string;
    inviteToken: string;
    status: RundeInListe['status'];
    modus: RundeInListe['modus'];
    hostDiscordId: string;
    createdAt: Date;
    ergebnisCandidateId: string | null;
    participants: Array<{ discordId: string; rolle: string }>;
    _count: { candidates: number };
  }>,
  betrachter: string,
): Promise<RundeInListe[]> {
  if (sessions.length === 0) {
    return [];
  }

  const { loadPersonen } = await import('@swisshub/modules');
  const personen = await loadPersonen(sessions.map((session) => session.hostDiscordId));

  const ergebnisIds = sessions
    .map((session) => session.ergebnisCandidateId)
    .filter((id): id is string => id !== null);
  const ergebnisse =
    ergebnisIds.length > 0
      ? await prisma.spielwahlCandidate.findMany({
          where: { id: { in: ergebnisIds } },
          select: { id: true, freierName: true, game: { select: { name: true } } },
        })
      : [];
  const nachId = new Map(ergebnisse.map((zeile) => [zeile.id, zeile.game?.name ?? zeile.freierName ?? null]));

  return sessions.map((session) => {
    const person = personen.get(session.hostDiscordId);
    const dabei = session.participants.some((teilnehmer) => teilnehmer.discordId === betrachter);
    return {
      id: session.id,
      /*
       * Der Einladungswert geht nur an Leute, die ohnehin dabei sind.
       *
       * Wer eine fremde Runde in der Liste sieht, bekommt die Kennung - und
       * damit den Weg zur Seite, auf der er beitreten kann. Der
       * Einladungswert ist für Discord und den kopierten Link gedacht, und je
       * weniger Listen ihn tragen, desto weniger Wege gibt es, ihn zu
       * verlieren.
       */
      inviteToken: dabei ? session.inviteToken : '',
      status: session.status,
      modus: session.modus,
      hostDiscordId: session.hostDiscordId,
      hostName: person?.displayName ?? 'Unbekannt',
      hostAvatar: person?.avatarHash ?? null,
      teilnehmer: session.participants.length,
      kandidaten: session._count.candidates,
      binDabei: dabei,
      binHost: session.hostDiscordId === betrachter,
      ergebnisName: session.ergebnisCandidateId ? (nachId.get(session.ergebnisCandidateId) ?? null) : null,
      createdAt: session.createdAt.toISOString(),
    };
  });
}
