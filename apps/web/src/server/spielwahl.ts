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
  /**
   * Hat die Runde ein Mitglied eröffnet oder jemand ohne Konto?
   *
   * Gebraucht für die Darstellung: `DiscordAvatar` würde für eine
   * Gastkennung eine Avataradresse bauen, die es nicht gibt. Steht hier
   * `true`, zeichnet die Karte stattdessen ein Monogramm.
   */
  hostIstGast: boolean;
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
 * Gelesen wird nur innerhalb der eigenen Guild, eine Suche über Sessions gibt
 * es nicht, und der Einladungswert steht in dieser Liste nur bei Runden, in
 * denen man ohnehin schon dabei ist.
 *
 * ## Der Betrachter darf eine Gastkennung sein
 *
 * Dann greifen `binDabei` und `binHost` für ihn genauso wie für ein Mitglied -
 * die Teilnehmerzeilen tragen beide Arten von Kennung in derselben Spalte
 * (siehe `spielwahl/gast.ts`). Das ist nicht Bequemlichkeit, sondern notwendig:
 * ohne sie bekäme der Gast, der eine Runde eröffnet hat, in dieser Liste
 * **seine eigene** Runde ohne Einladungswert angeboten, die Seite dahinter
 * liesse ihn mit der blossen Kennung nicht herein, und er landete auf einer
 * Anmeldeaufforderung für die Runde, die er selbst aufgemacht hat.
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
      participants: { where: { leftAt: null }, select: { discordId: true, rolle: true, gastName: true } },
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
      participants: { where: { leftAt: null }, select: { discordId: true, rolle: true, gastName: true } },
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
    participants: Array<{ discordId: string; rolle: string; gastName: string | null }>;
    _count: { candidates: number };
  }>,
  betrachter: string,
): Promise<RundeInListe[]> {
  if (sessions.length === 0) {
    return [];
  }

  const { loadPersonen, spielwahl: modul } = await import('@swisshub/modules');
  /*
   * Nur Discord-Kennungen nachschlagen.
   *
   * `loadPersonen` fragt den Mitgliederbestand; eine Gastkennung findet es
   * dort nie, und sie dort zu suchen hiesse, eine Abfrage mit einem Wert zu
   * fuettern, der dafuer nicht gedacht ist. Der Name eines Gast-Hosts steht
   * in seiner Teilnehmerzeile - dort, wo er ihn selbst eingetragen hat.
   */
  const personen = await loadPersonen(
    sessions.map((session) => session.hostDiscordId).filter((id) => !modul.istGastKennung(id)),
  );

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
    const gastHost = modul.istGastKennung(session.hostDiscordId)
      ? (session.participants.find((teilnehmer) => teilnehmer.discordId === session.hostDiscordId)
          ?.gastName ?? 'Gast')
      : null;
    /*
     * Ein leerer Betrachter ist niemand - und das ist Absicht.
     *
     * Eine Discord-Kennung ist nie leer, eine Gastkennung nie. Wer ohne
     * Kennung liest (die Seite ruft so, solange noch kein Gastcookie
     * vergeben ist), ist in keiner Runde dabei und bekommt keinen
     * Einladungswert.
     */
    const dabei =
      betrachter !== '' && session.participants.some((teilnehmer) => teilnehmer.discordId === betrachter);
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
      hostName: gastHost ?? person?.displayName ?? 'Unbekannt',
      hostAvatar: person?.avatarHash ?? null,
      hostIstGast: gastHost !== null,
      teilnehmer: session.participants.length,
      kandidaten: session._count.candidates,
      binDabei: dabei,
      binHost: session.hostDiscordId === betrachter,
      ergebnisName: session.ergebnisCandidateId ? (nachId.get(session.ergebnisCandidateId) ?? null) : null,
      createdAt: session.createdAt.toISOString(),
    };
  });
}
