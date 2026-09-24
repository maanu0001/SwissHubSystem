import { prisma } from '@swisshub/database';
import { conflict, notFound, policyViolation } from '@swisshub/shared';
import { beruehre, namensKey, sperre } from './session';
import type { KandidatEingabe } from './schemas';

/**
 * Die Kandidatenliste.
 *
 * ## Die eine Entscheidung, die alles andere bestimmt
 *
 * Derselbe Titel, von drei Leuten genannt, ist **ein** Kandidat - aber mit
 * drei Unterstuetzern. Die Alternative waere, dreimal dasselbe Spiel ins Rad
 * zu legen; dann gewaenne es mit dreifacher Wahrscheinlichkeit, ohne dass
 * irgendwer das beschlossen haette. Genau das ist die «stillschweigende
 * Gewichtung nach Anzahl der Vorschlaege», und sie findet hier nicht statt.
 *
 * Sichtbar bleiben die Unterstuetzer trotzdem: man soll sehen, dass drei
 * Leute Deep Rock wollen. Ob das etwas zaehlt, entscheidet der Host mit dem
 * Schalter «gewichten» - bewusst und fuer alle lesbar.
 */

export interface KandidatAnsicht {
  id: string;
  name: string;
  gameId: string | null;
  bannerUrl: string | null;
  maxSquadSize: number | null;
  /** Discord-Kennungen der Unterstuetzer, der Vorschlagende zuerst. */
  unterstuetzer: string[];
}

export async function listeKandidaten(sessionId: string): Promise<KandidatAnsicht[]> {
  const zeilen = await prisma.spielwahlCandidate.findMany({
    where: { sessionId },
    include: {
      game: { select: { id: true, name: true, bannerUrl: true, maxSquadSize: true } },
      supporters: { orderBy: [{ erster: 'desc' }, { createdAt: 'asc' }], select: { discordId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return zeilen.map((zeile) => ({
    id: zeile.id,
    name: zeile.game?.name ?? zeile.freierName ?? '—',
    gameId: zeile.gameId,
    /*
     * Das Cover kommt ausschliesslich aus dem Katalog. Ein freier Vorschlag
     * bekommt keines - und schon gar nicht eine Adresse aus der Eingabe.
     */
    bannerUrl: zeile.game?.bannerUrl ?? null,
    maxSquadSize: zeile.game?.maxSquadSize ?? null,
    unterstuetzer: zeile.supporters.map((eintrag) => eintrag.discordId),
  }));
}

/**
 * Einen Vorschlag eintragen.
 *
 * Zwei Faelle in einer Funktion, und das ist Absicht: ob ein Titel neu ist
 * oder schon steht, weiss der Vorschlagende nicht, und er soll es auch nicht
 * wissen muessen. Er nennt ein Spiel; was daraus wird, entscheidet die Liste.
 */
export async function schlageVor(
  sessionId: string,
  discordId: string,
  eingabe: KandidatEingabe,
): Promise<{ candidateId: string; neu: boolean }> {
  return prisma.$transaction(async (tx) => {
    /*
     * Die Sperre sitzt vor dem Zaehlen der eigenen Vorschlaege. Ohne sie
     * laesen sechs gleichzeitige Klicks alle dieselbe Null und kaemen alle
     * durch - das Kontingent waere eine Empfehlung.
     */
    await sperre(tx, sessionId);
    const session = await tx.spielwahlSession.findUnique({
      where: { id: sessionId },
      select: { status: true, vorschlaegeProPerson: true, freieVorschlaege: true },
    });
    if (!session) {
      throw notFound('spielwahl: Session unbekannt', 'Diese Runde gibt es nicht mehr.');
    }
    if (session.status !== 'LOBBY') {
      throw conflict('Die Vorschlagsphase ist geschlossen.');
    }

    let name: string;
    let gameId: string | null = null;

    if (eingabe.gameId) {
      const spiel = await tx.spielersucheGame.findFirst({
        where: { id: eingabe.gameId, enabled: true },
        select: { id: true, name: true },
      });
      if (!spiel) {
        throw notFound('spielwahl: Spiel unbekannt', 'Dieses Spiel steht nicht (mehr) im Katalog.');
      }
      gameId = spiel.id;
      name = spiel.name;
    } else {
      if (!session.freieVorschlaege) {
        throw policyViolation('In dieser Runde sind nur Spiele aus dem Katalog erlaubt.');
      }
      name = eingabe.freierName!;
    }

    const key = namensKey(name);
    if (!key) {
      throw conflict('Der Titel braucht Buchstaben oder Ziffern.');
    }

    /*
     * Das Kontingent zaehlt **Unterstuetzungen**, nicht angelegte Zeilen: wer
     * drei Spiele mittraegt, hat drei Vorschlaege gemacht, auch wenn alle
     * drei schon standen. Sonst waere «ich unterstuetze einfach alles» ein
     * Weg an der Grenze vorbei.
     */
    const eigene = await tx.spielwahlSupport.count({
      where: { discordId, candidate: { sessionId } },
    });
    const schonDabei = await tx.spielwahlCandidate.findUnique({
      where: { sessionId_namensKey: { sessionId, namensKey: key } },
      select: { id: true, supporters: { where: { discordId }, select: { id: true } } },
    });
    if (schonDabei?.supporters.length) {
      // Zweimal dasselbe genannt - kein Fehler, nur nichts Neues.
      return { candidateId: schonDabei.id, neu: false };
    }
    if (eigene >= session.vorschlaegeProPerson) {
      throw policyViolation(
        `Du hast deine ${session.vorschlaegeProPerson} Vorschläge vergeben. Nimm einen zurück, wenn du einen anderen willst.`,
      );
    }

    if (schonDabei) {
      await tx.spielwahlSupport.create({ data: { candidateId: schonDabei.id, discordId } });
      await beruehre(tx, sessionId);
      return { candidateId: schonDabei.id, neu: false };
    }

    const angelegt = await tx.spielwahlCandidate.create({
      data: {
        sessionId,
        gameId,
        freierName: gameId ? null : name,
        namensKey: key,
        supporters: { create: { discordId, erster: true } },
      },
      select: { id: true },
    });
    await beruehre(tx, sessionId);
    return { candidateId: angelegt.id, neu: true };
  });
}

/**
 * Den eigenen Vorschlag zuruecknehmen.
 *
 * Zurueckgenommen wird die eigene Unterstuetzung - nie der Kandidat. Der
 * verschwindet nur, wenn niemand mehr dahintersteht; sonst koennte der
 * Vorschlagende den anderen ihr Spiel wegnehmen.
 */
export async function nimmZurueck(sessionId: string, discordId: string, candidateId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.spielwahlSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session?.status !== 'LOBBY') {
      throw conflict('Die Vorschlagsphase ist geschlossen.');
    }

    const kandidat = await tx.spielwahlCandidate.findFirst({
      where: { id: candidateId, sessionId },
      select: { id: true, _count: { select: { supporters: true } } },
    });
    if (!kandidat) {
      return;
    }

    const entfernt = await tx.spielwahlSupport.deleteMany({ where: { candidateId, discordId } });
    if (entfernt.count === 0) {
      return;
    }

    if (kandidat._count.supporters - entfernt.count <= 0) {
      await tx.spielwahlCandidate.delete({ where: { id: candidateId } });
    }
    await beruehre(tx, sessionId);
  });
}

/**
 * Einen Kandidaten ganz entfernen - nur die Fuehrung.
 *
 * Der Weg fuer einen Titel, der in einer Gemeinschaftsrunde nichts zu suchen
 * hat. Die Pruefung der Rolle steht beim Aufrufer.
 */
export async function entferneKandidat(sessionId: string, candidateId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.spielwahlSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session?.status !== 'LOBBY' && session?.status !== 'BEREIT') {
      throw conflict('Während einer laufenden Entscheidung ändert sich die Liste nicht mehr.');
    }
    const geloescht = await tx.spielwahlCandidate.deleteMany({ where: { id: candidateId, sessionId } });
    if (geloescht.count > 0) {
      await beruehre(tx, sessionId);
    }
  });
}

/**
 * Die Spielsuche fuer das Vorschlagsfeld.
 *
 * Genau derselbe Katalog wie in der Spielersuche, in Turnieren und bei den
 * Clips - `SpielersucheGame`. Eine zweite Spieleliste gibt es nicht und soll
 * es nicht geben.
 */
export async function sucheSpiele(query: string, limit = 12) {
  const suche = query.trim();
  return prisma.spielersucheGame.findMany({
    where: {
      enabled: true,
      ...(suche.length > 0 ? { name: { contains: suche, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: Math.min(Math.max(limit, 1), 25),
    select: { id: true, name: true, bannerUrl: true, maxSquadSize: true },
  });
}
