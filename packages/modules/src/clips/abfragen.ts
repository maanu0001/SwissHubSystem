import { prisma } from '@swisshub/database';
import { CLIPS_MODULE_ID } from './config';
import { ausSchluessel } from './woche';
import { getModuleSettings } from '../module-state';
import type { ClipsSettings } from './config';
import type { Clip, ClipCompetition, ClipCompetitionEntry } from '@swisshub/database';

/**
 * Was die Oberflaeche zu sehen bekommt.
 *
 * Eine einzige Stelle, an der entschieden wird, welche Zahlen herausgehen -
 * insbesondere die Stimmen. Waehrend der Abstimmung sind sie in der Regel
 * verborgen, und «verborgen» heisst hier: sie verlassen den Server nicht.
 * Sie erst im Browser auszublenden waere keine Verborgenheit, sondern eine
 * Einladung, die Netzwerkanzeige zu oeffnen.
 */

export interface ClipKarte {
  entryId: string;
  clipId: string;
  titel: string;
  beschreibung: string | null;
  provider: string;
  externalId: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  spiel: string | null;
  einreicher: {
    discordId: string;
    username: string | null;
    displayName: string | null;
    avatarHash: string | null;
  };
  eingereichtAm: Date;
  /** `null`, solange die Stimmen nicht gezeigt werden duerfen. */
  stimmen: number | null;
  /** Hat die aufrufende Person fuer diesen Clip gestimmt? */
  eigeneStimme: boolean;
  /** Der eigene Clip - fuer den Hinweis «dein Clip». */
  eigenerClip: boolean;
  rang: number | null;
}

type EintragMitClip = ClipCompetitionEntry & { clip: Clip };

/** Duerfen die Stimmen dieser Runde offen liegen? */
export function stimmenSichtbar(runde: ClipCompetition): boolean {
  if (runde.status === 'COMPLETED') {
    return true;
  }
  return runde.status === 'VOTING' && runde.showVoteCounts;
}

function zuKarte(
  eintrag: EintragMitClip,
  optionen: { stimmen: number | null; eigeneStimme: boolean; betrachter: string | null },
): ClipKarte {
  const { clip } = eintrag;
  return {
    entryId: eintrag.id,
    clipId: clip.id,
    titel: clip.title,
    beschreibung: clip.description,
    provider: clip.provider,
    externalId: clip.externalId,
    canonicalUrl: clip.canonicalUrl,
    embedUrl: clip.embedUrl,
    thumbnailUrl: clip.thumbnailUrl,
    spiel: clip.gameName,
    einreicher: {
      discordId: clip.submittedByDiscordId,
      username: clip.submittedByUsername,
      displayName: clip.submittedByDisplayName,
      avatarHash: clip.submittedByAvatarHash,
    },
    eingereichtAm: eintrag.submittedAt,
    stimmen: optionen.stimmen,
    eigeneStimme: optionen.eigeneStimme,
    eigenerClip: optionen.betrachter !== null && eintrag.submittedByDiscordId === optionen.betrachter,
    rang: eintrag.finalRank,
  };
}

export type Sortierung = 'neueste' | 'aelteste' | 'stimmen' | 'zufall';

export interface GalerieEingabe {
  competitionId: string;
  betrachterDiscordId?: string | null;
  sortierung?: Sortierung;
  spiel?: string | null;
  seite?: number;
  proSeite?: number;
}

export interface Galerie {
  karten: ClipKarte[];
  gesamt: number;
  seite: number;
  seiten: number;
}

/**
 * Die freigegebenen Clips einer Runde.
 *
 * Nach Stimmen sortieren darf man nur, wenn die Stimmen auch sichtbar sind -
 * sonst verriete die Reihenfolge genau das, was die Runde verbergen will.
 * Statt den Wunsch abzulehnen, wird er in diesem Fall still auf «neueste»
 * zurueckgesetzt: die Liste bleibt brauchbar, die Zahlen bleiben geheim.
 */
export async function galerie(eingabe: GalerieEingabe): Promise<Galerie> {
  const runde = await prisma.clipCompetition.findUnique({ where: { id: eingabe.competitionId } });
  if (!runde) {
    return { karten: [], gesamt: 0, seite: 1, seiten: 1 };
  }

  const sichtbar = stimmenSichtbar(runde);
  const gewuenscht = eingabe.sortierung ?? 'neueste';
  const sortierung: Sortierung = gewuenscht === 'stimmen' && !sichtbar ? 'neueste' : gewuenscht;

  const proSeite = Math.min(Math.max(eingabe.proSeite ?? 24, 1), 60);
  const seite = Math.max(eingabe.seite ?? 1, 1);

  const bedingung = {
    competitionId: runde.id,
    status: 'APPROVED' as const,
    ...(eingabe.spiel ? { clip: { gameName: eingabe.spiel } } : {}),
  };

  const gesamt = await prisma.clipCompetitionEntry.count({ where: bedingung });
  const seiten = Math.max(1, Math.ceil(gesamt / proSeite));
  const aktuelleSeite = Math.min(seite, seiten);

  /*
   * Die Sortierung nach Stimmen geht nicht ueber `orderBy` - Prisma kann nicht
   * nach der Anzahl einer Relation sortieren. Bei einer abgeschlossenen Runde
   * steht die Zahl ohnehin schon in der Zeile (`finalVoteCount`); nur waehrend
   * einer laufenden Abstimmung mit offenen Zahlen muss gezaehlt werden, und
   * dann werden die Eintraege dieser einen Runde geholt und im Speicher
   * geordnet. Das sind Dutzende, nicht Millionen.
   */
  const imSpeicher = sortierung === 'stimmen' && runde.status !== 'COMPLETED';

  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: bedingung,
    include: { clip: true },
    ...(imSpeicher
      ? {}
      : {
          orderBy:
            sortierung === 'stimmen'
              ? [{ finalRank: 'asc' as const }]
              : sortierung === 'aelteste'
                ? [{ submittedAt: 'asc' as const }]
                : [{ submittedAt: 'desc' as const }],
          skip: (aktuelleSeite - 1) * proSeite,
          take: proSeite,
        }),
  });

  const stimmen = await stimmenJeEintrag(
    runde,
    eintraege.map((eintrag) => eintrag.id),
    sichtbar,
  );
  const eigene = await eigeneStimmen(runde.id, eingabe.betrachterDiscordId ?? null);

  let karten = eintraege.map((eintrag) =>
    zuKarte(eintrag, {
      stimmen: stimmen.get(eintrag.id) ?? (sichtbar ? 0 : null),
      eigeneStimme: eigene.has(eintrag.id),
      betrachter: eingabe.betrachterDiscordId ?? null,
    }),
  );

  if (imSpeicher) {
    karten.sort(
      (a, b) => (b.stimmen ?? 0) - (a.stimmen ?? 0) || a.eingereichtAm.getTime() - b.eingereichtAm.getTime(),
    );
    karten = karten.slice((aktuelleSeite - 1) * proSeite, aktuelleSeite * proSeite);
  }

  return { karten, gesamt, seite: aktuelleSeite, seiten };
}

/** Stimmen je Eintrag - oder eine leere Tabelle, wenn sie geheim bleiben. */
async function stimmenJeEintrag(
  runde: ClipCompetition,
  entryIds: string[],
  sichtbar: boolean,
): Promise<Map<string, number>> {
  const tabelle = new Map<string, number>();
  if (!sichtbar || entryIds.length === 0) {
    return tabelle;
  }
  const gruppen = await prisma.clipVote.groupBy({
    by: ['entryId'],
    where: { competitionId: runde.id, entryId: { in: entryIds } },
    _count: { _all: true },
  });
  for (const gruppe of gruppen) {
    tabelle.set(gruppe.entryId, gruppe._count._all);
  }
  for (const id of entryIds) {
    if (!tabelle.has(id)) {
      tabelle.set(id, 0);
    }
  }
  return tabelle;
}

/** Fuer welche Eintraege dieser Runde die Person gestimmt hat. */
export async function eigeneStimmen(competitionId: string, discordId: string | null): Promise<Set<string>> {
  if (!discordId) {
    return new Set();
  }
  const stimmen = await prisma.clipVote.findMany({
    where: { competitionId, voterDiscordId: discordId },
    select: { entryId: true },
  });
  return new Set(stimmen.map((stimme) => stimme.entryId));
}

/** Die Spiele, die in dieser Runde tatsaechlich vorkommen - fuer den Filter. */
export async function spieleDerRunde(competitionId: string): Promise<string[]> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: { competitionId, status: 'APPROVED', clip: { gameName: { not: null } } },
    select: { clip: { select: { gameName: true } } },
    distinct: ['clipId'],
  });
  const namen = new Set<string>();
  for (const eintrag of eintraege) {
    if (eintrag.clip.gameName) {
      namen.add(eintrag.clip.gameName);
    }
  }
  return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Ein zufaelliger Clip.
 *
 * `ORDER BY random()` ueber eine Runde mit ein paar Dutzend Eintraegen ist
 * genau das Richtige: kein Zaehlen, kein zweiter Aufruf, und der Zufall ist
 * wirklich einer. Bei Millionen Zeilen waere es der falsche Weg - so viele
 * Clips hat eine Woche nicht.
 *
 * `ausser` verhindert, dass zweimal hintereinander derselbe Clip kommt; bei
 * einem einzigen Clip in der Runde kommt er trotzdem, sonst waere die Antwort
 * leer.
 */
export async function zufaelligerClip(
  competitionId: string,
  betrachterDiscordId: string | null,
  ausser?: string | null,
): Promise<ClipKarte | null> {
  const treffer = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ClipCompetitionEntry"
    WHERE "competitionId" = ${competitionId}
      AND "status" = 'APPROVED'
      AND ("id" <> ${ausser ?? ''})
    ORDER BY random()
    LIMIT 1
  `;
  const id =
    treffer[0]?.id ??
    (
      await prisma.clipCompetitionEntry.findFirst({
        where: { competitionId, status: 'APPROVED' },
        select: { id: true },
      })
    )?.id;
  if (!id) {
    return null;
  }
  return karteFuerEintrag(id, betrachterDiscordId);
}

/** Ein einzelner Eintrag als Karte. */
export async function karteFuerEintrag(
  entryId: string,
  betrachterDiscordId: string | null,
): Promise<ClipKarte | null> {
  const eintrag = await prisma.clipCompetitionEntry.findUnique({
    where: { id: entryId },
    include: { clip: true, competition: true },
  });
  if (!eintrag) {
    return null;
  }
  const sichtbar = stimmenSichtbar(eintrag.competition);
  const stimmen = sichtbar ? await prisma.clipVote.count({ where: { entryId } }) : null;
  const eigene = await eigeneStimmen(eintrag.competitionId, betrachterDiscordId);
  return zuKarte(eintrag, { stimmen, eigeneStimme: eigene.has(entryId), betrachter: betrachterDiscordId });
}

/** Das Treppchen - die ersten drei einer abgeschlossenen Runde. */
export async function siegertreppchen(competitionId: string, anzahl = 3): Promise<ClipKarte[]> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: { competitionId, status: 'APPROVED', finalRank: { not: null } },
    include: { clip: true },
    orderBy: { finalRank: 'asc' },
    take: anzahl,
  });
  return eintraege.map((eintrag) =>
    zuKarte(eintrag, { stimmen: eintrag.finalVoteCount, eigeneStimme: false, betrachter: null }),
  );
}

// --- Moderation -------------------------------------------------------------

export interface ModerationsEintrag extends ClipKarte {
  meldungen: number;
}

/** Was auf Freigabe wartet - und was gemeldet wurde. */
export async function moderationsListe(
  competitionId: string,
  nur: 'offen' | 'gemeldet' | 'alle' = 'offen',
): Promise<ModerationsEintrag[]> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: {
      competitionId,
      ...(nur === 'offen'
        ? { status: 'PENDING' }
        : nur === 'gemeldet'
          ? { clip: { reports: { some: { resolvedAt: null } } } }
          : {}),
    },
    include: { clip: { include: { _count: { select: { reports: true } } } } },
    orderBy: { submittedAt: 'asc' },
  });

  return eintraege.map((eintrag) => ({
    ...zuKarte(eintrag, { stimmen: null, eigeneStimme: false, betrachter: null }),
    meldungen: eintrag.clip._count.reports,
  }));
}

/** Wie viele Einreichungen auf eine Entscheidung warten. */
export const offeneModeration = (competitionId: string): Promise<number> =>
  prisma.clipCompetitionEntry.count({ where: { competitionId, status: 'PENDING' } });

// --- Hall of Fame und Profil ------------------------------------------------

export interface HallOfFameEintrag {
  key: string;
  nummer: number;
  jahr: number;
  woche: number;
  beendetAm: Date | null;
  gewinner: ClipKarte | null;
  teilnehmer: number;
  stimmen: number;
}

/** Alle abgeschlossenen Runden, neueste zuerst. */
export async function hallOfFame(guildId: string, limit = 24, offset = 0): Promise<HallOfFameEintrag[]> {
  const runden = await prisma.clipCompetition.findMany({
    where: { guildId, status: 'COMPLETED' },
    orderBy: { number: 'desc' },
    take: limit,
    skip: offset,
    include: {
      entries: {
        where: { status: 'APPROVED' },
        include: { clip: true },
        orderBy: { finalRank: 'asc' },
      },
      _count: { select: { votes: true } },
    },
  });

  return runden.map((runde) => {
    const gewinner = runde.entries.find((eintrag) => eintrag.id === runde.winnerEntryId) ?? null;
    const { jahr, woche } = ausSchluessel(runde.key);
    return {
      key: runde.key,
      nummer: runde.number,
      jahr,
      woche,
      beendetAm: runde.finalizedAt,
      gewinner: gewinner
        ? zuKarte(gewinner, { stimmen: gewinner.finalVoteCount, eigeneStimme: false, betrachter: null })
        : null,
      teilnehmer: runde.entries.length,
      stimmen: runde._count.votes,
    };
  });
}

export const hallOfFameAnzahl = (guildId: string): Promise<number> =>
  prisma.clipCompetition.count({ where: { guildId, status: 'COMPLETED' } });

export interface ClipBilanz {
  siege: number;
  treppchen: number;
  eingereicht: number;
  erhalteneStimmen: number;
  letzterSieg: { key: string; nummer: number; titel: string; entryId: string } | null;
}

/**
 * Was jemand bei Clip of the Week erreicht hat.
 *
 * Gezaehlt wird ueber abgeschlossene Runden - eine laufende Runde hat noch
 * keine Plaetze, und ein Profil, das vorlaeufige Raenge anzeigt, luege
 * jeden Montag.
 */
export async function bilanz(guildId: string, discordId: string): Promise<ClipBilanz> {
  const abgeschlossen = { competition: { guildId, status: 'COMPLETED' as const } };

  const [siege, treppchen, eingereicht, stimmen, letzter] = await Promise.all([
    prisma.clipCompetitionEntry.count({
      where: { ...abgeschlossen, submittedByDiscordId: discordId, finalRank: 1 },
    }),
    prisma.clipCompetitionEntry.count({
      where: { ...abgeschlossen, submittedByDiscordId: discordId, finalRank: { in: [1, 2, 3] } },
    }),
    prisma.clipCompetitionEntry.count({
      where: {
        competition: { guildId },
        submittedByDiscordId: discordId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    }),
    prisma.clipCompetitionEntry.aggregate({
      where: { ...abgeschlossen, submittedByDiscordId: discordId },
      _sum: { finalVoteCount: true },
    }),
    prisma.clipCompetitionEntry.findFirst({
      where: { ...abgeschlossen, submittedByDiscordId: discordId, finalRank: 1 },
      include: { clip: { select: { title: true } }, competition: { select: { key: true, number: true } } },
      orderBy: { competition: { number: 'desc' } },
    }),
  ]);

  return {
    siege,
    treppchen,
    eingereicht,
    erhalteneStimmen: stimmen._sum.finalVoteCount ?? 0,
    letzterSieg: letzter
      ? {
          key: letzter.competition.key,
          nummer: letzter.competition.number,
          titel: letzter.clip.title,
          entryId: letzter.id,
        }
      : null,
  };
}

/** Die eigenen Einreichungen einer Runde - fuer «dein Clip» auf der Startseite. */
export async function eigeneEinreichungen(
  competitionId: string,
  discordId: string,
): Promise<
  Array<{ entryId: string; titel: string; status: string; grund: string | null; notiz: string | null }>
> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: { competitionId, submittedByDiscordId: discordId },
    include: { clip: { select: { title: true, rejectionReason: true, rejectionNote: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  return eintraege.map((eintrag) => ({
    entryId: eintrag.id,
    titel: eintrag.clip.title,
    status: eintrag.status,
    grund: eintrag.clip.rejectionReason,
    notiz: eintrag.clip.rejectionNote,
  }));
}

/** Kennzahlen einer Runde fuer die Kopfzeile. */
export interface RundenZahlen {
  eingereicht: number;
  freigegeben: number;
  offen: number;
  stimmen: number;
  teilnehmende: number;
}

export async function rundenZahlen(competitionId: string): Promise<RundenZahlen> {
  const [eingereicht, freigegeben, offen, stimmen, teilnehmende] = await Promise.all([
    prisma.clipCompetitionEntry.count({ where: { competitionId } }),
    prisma.clipCompetitionEntry.count({ where: { competitionId, status: 'APPROVED' } }),
    prisma.clipCompetitionEntry.count({ where: { competitionId, status: 'PENDING' } }),
    prisma.clipVote.count({ where: { competitionId } }),
    prisma.clipVote
      .groupBy({ by: ['voterDiscordId'], where: { competitionId } })
      .then((gruppen) => gruppen.length),
  ]);
  return { eingereicht, freigegeben, offen, stimmen, teilnehmende };
}

export const einstellungen = (): Promise<ClipsSettings> => getModuleSettings<ClipsSettings>(CLIPS_MODULE_ID);

/** Eine Runde ueber ihren Schluessel - `2026-W39`. */
export const rundeNachSchluessel = (guildId: string, key: string): Promise<ClipCompetition | null> =>
  prisma.clipCompetition.findUnique({ where: { guildId_key: { guildId, key } } });
