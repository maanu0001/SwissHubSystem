import { prisma } from '@swisshub/database';
import type { VerificationRequest, VerificationStatus } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { OFFENE_STATUS, WARTET_AUF_MENSCH } from './service';

/**
 * Abfragen fuer Uebersicht, Warteschlange und Verlauf.
 *
 * Alle Daten strikt nach Guild getrennt: die Kennung kommt aus der
 * Serverkonfiguration, nicht aus der Anfrage.
 */

export interface WarteZeile {
  id: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  status: VerificationStatus;
  joinedAt: Date;
  accountCreatedAt: Date | null;
  latestMessage: string | null;
  latestMessageId: string | null;
  latestMessageAt: Date | null;
  messageCount: number;
  aiVerdict: VerificationRequest['aiVerdict'];
  aiConfidence: number | null;
  aiReasonCode: string | null;
  aiError: string | null;
  /** Wartezeit in Sekunden, ab Beitritt. */
  wartetSeit: number;
  /** Konto juenger als einen Tag - ein Hinweis, kein Urteil. */
  jungesKonto: boolean;
  /** Kein Avatar gesetzt - ein Hinweis, kein Urteil. */
  ohneAvatar: boolean;
}

const AUSWAHL = {
  id: true,
  discordId: true,
  username: true,
  displayName: true,
  avatarHash: true,
  status: true,
  joinedAt: true,
  accountCreatedAt: true,
  latestMessage: true,
  latestMessageId: true,
  latestMessageAt: true,
  messageCount: true,
  aiVerdict: true,
  aiConfidence: true,
  aiReasonCode: true,
  aiError: true,
} as const;

function zuZeile(eintrag: Pick<VerificationRequest, keyof typeof AUSWAHL>, jetzt: Date): WarteZeile {
  return {
    ...eintrag,
    wartetSeit: Math.max(0, Math.floor((jetzt.getTime() - eintrag.joinedAt.getTime()) / 1000)),
    jungesKonto:
      eintrag.accountCreatedAt !== null &&
      eintrag.joinedAt.getTime() - eintrag.accountCreatedAt.getTime() < 24 * 3600_000,
    ohneAvatar: eintrag.avatarHash === null,
  };
}

/** Offene Vorgaenge, aelteste zuerst - wer am laengsten wartet, steht oben. */
export async function listQueue(limit = 100, jetzt = new Date()): Promise<WarteZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  const zeilen = await prisma.verificationRequest.findMany({
    where: { guildId, status: { in: [...OFFENE_STATUS] } },
    select: AUSWAHL,
    orderBy: { joinedAt: 'asc' },
    take: limit,
  });
  return zeilen.map((zeile) => zuZeile(zeile, jetzt));
}

/**
 * Wie viele Vorgaenge auf eine menschliche Entscheidung warten.
 *
 * Bewusst nur eine Zahl: das Dashboard braucht keine Zeilen, und eine
 * Zaehlung kostet keine Auswahl von Personendaten.
 */
export async function offeneAnzahl(): Promise<number> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return 0;
  }
  return prisma.verificationRequest.count({
    where: { guildId, status: { in: [...WARTET_AUF_MENSCH] } },
  });
}

export interface VerlaufZeile extends WarteZeile {
  decidedAt: Date | null;
  decidedBy: VerificationRequest['decidedBy'];
  decidedByUsername: string | null;
  decisionReason: string | null;
  /** Wie lange es vom Beitritt bis zur Entscheidung dauerte, in Sekunden. */
  dauer: number | null;
}

export type VerlaufFilter = 'ALL' | 'HUMAN_VERIFIED' | 'AI_VERIFIED' | 'REJECTED' | 'LEFT_SERVER' | 'EXPIRED';

export async function listHistory(
  filter: VerlaufFilter = 'ALL',
  options: { search?: string; limit?: number } = {},
): Promise<VerlaufZeile[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }

  const nachFilter =
    filter === 'HUMAN_VERIFIED'
      ? { status: 'VERIFIED' as const, decidedBy: 'HUMAN' as const }
      : filter === 'AI_VERIFIED'
        ? { status: 'VERIFIED' as const, decidedBy: 'AI' as const }
        : filter === 'ALL'
          ? { status: { notIn: [...OFFENE_STATUS] } }
          : { status: filter as VerificationStatus };

  const suche = options.search?.trim();
  const zeilen = await prisma.verificationRequest.findMany({
    where: {
      guildId,
      ...nachFilter,
      ...(suche
        ? {
            OR: [
              { username: { contains: suche, mode: 'insensitive' as const } },
              { displayName: { contains: suche, mode: 'insensitive' as const } },
              { discordId: { contains: suche } },
            ],
          }
        : {}),
    },
    select: {
      ...AUSWAHL,
      decidedAt: true,
      decidedBy: true,
      decidedByUsername: true,
      decisionReason: true,
    },
    orderBy: { decidedAt: 'desc' },
    take: options.limit ?? 100,
  });

  const jetzt = new Date();
  return zeilen.map((zeile) => ({
    ...zuZeile(zeile, jetzt),
    decidedAt: zeile.decidedAt,
    decidedBy: zeile.decidedBy,
    decidedByUsername: zeile.decidedByUsername,
    decisionReason: zeile.decisionReason,
    dauer: zeile.decidedAt
      ? Math.max(0, Math.floor((zeile.decidedAt.getTime() - zeile.joinedAt.getTime()) / 1000))
      : null,
  }));
}

export interface Kennzahlen {
  wartetAufNachricht: number;
  wartetAufModeration: number;
  /**
   * Alle jemals freigeschalteten Vorgaenge - nicht nur die von heute.
   *
   * Gezaehlt werden Verifikationsvorgaenge, nicht Personen: wer den Server
   * verlaesst und neu beitritt, durchlaeuft einen zweiten Vorgang, und der
   * ist eine zweite Entscheidung. Je Vorgang gibt es genau eine Zeile, und
   * `decidedAt` faellt genau einmal - ein Vorgang kann hier also nicht
   * mehrfach erscheinen.
   */
  gesamtVerifiziert: number;
  gesamtAbgelehnt: number;
  gesamtAiVerifiziert: number;
  /**
   * Mittlere Wartezeit ueber die gesamte entschiedene Historie, in Sekunden.
   *
   * Wartezeit ist unveraendert `decidedAt - joinedAt`: vom Beitritt bis zur
   * Entscheidung. Nur der Zeitraum hat sich geaendert - frueher der heutige
   * Tag, jetzt alles Vorhandene.
   *
   * Offene Vorgaenge bleiben aussen vor. Ihre Wartezeit steht noch nicht
   * fest, und sie mit der bisher verstrichenen Zeit einzurechnen wuerde den
   * Schnitt mit jeder Minute verschieben, in der niemand entscheidet.
   */
  schnittWartezeit: number | null;
  medianWartezeit: number | null;
  /** Wie viele entschiedene Faelle. Grundlage der beiden Werte. */
  schnittBasis: number;
  aiAnfragenHeute: number;
  aiFehlerHeute: number;
  /** Anteil der AI-Freischaltungen an allen Freischaltungen, 7 Tage. */
  aiQuote7Tage: number | null;
  ablehnQuote7Tage: number | null;
  ohneNachricht7Tage: number;
}

/**
 * Kennzahlen der Uebersicht.
 *
 * Ausschliesslich, was sich aus vorhandenen Daten rechnen laesst. Die
 * Wartezeit nennt ihre Grundgesamtheit, und wo nichts entschieden wurde,
 * steht `null` statt einer Null - eine erfundene Null waere eine Aussage.
 */
export async function kennzahlen(jetzt = new Date()): Promise<Kennzahlen> {
  const guildId = await resolveGuildId().catch(() => null);
  const leer: Kennzahlen = {
    wartetAufNachricht: 0,
    wartetAufModeration: 0,
    gesamtVerifiziert: 0,
    gesamtAbgelehnt: 0,
    gesamtAiVerifiziert: 0,
    schnittWartezeit: null,
    medianWartezeit: null,
    schnittBasis: 0,
    aiAnfragenHeute: 0,
    aiFehlerHeute: 0,
    aiQuote7Tage: null,
    ablehnQuote7Tage: null,
    ohneNachricht7Tage: 0,
  };
  if (!guildId) {
    return leer;
  }

  const tagesBeginn = new Date(jetzt);
  tagesBeginn.setHours(0, 0, 0, 0);
  const vorSieben = new Date(jetzt.getTime() - 7 * 24 * 3600_000);

  const [
    wartetAufNachricht,
    wartetAufModeration,
    gesamtVerifiziert,
    gesamtAbgelehnt,
    gesamtAiVerifiziert,
    aiFehlerHeute,
  ] = await Promise.all([
    prisma.verificationRequest.count({ where: { guildId, status: 'WAITING_FOR_MESSAGE' } }),
    prisma.verificationRequest.count({
      where: { guildId, status: { in: ['WAITING_FOR_REVIEW', 'AI_ANALYZING'] } },
    }),
    // Ohne Zeitgrenze: der gesamte vorhandene Bestand. Was vor der
    // Aufzeichnung geschah, steht nirgends und wird auch nicht geschaetzt.
    prisma.verificationRequest.count({ where: { guildId, status: 'VERIFIED' } }),
    prisma.verificationRequest.count({ where: { guildId, status: 'REJECTED' } }),
    prisma.verificationRequest.count({ where: { guildId, status: 'VERIFIED', decidedBy: 'AI' } }),
    prisma.verificationRequest.count({
      where: { guildId, aiVerdict: 'FAILED', aiCheckedAt: { gte: tagesBeginn } },
    }),
  ]);

  const aiAnfragen = await prisma.verificationRequest.aggregate({
    where: { guildId, aiCheckedAt: { gte: tagesBeginn } },
    _sum: { aiAttempts: true },
  });

  /*
   * Wartezeiten ueber die gesamte entschiedene Historie.
   *
   * In der Datenbank gerechnet, nicht hier. Die vorige Fassung holte bis zu
   * 1000 Zeilen und bildete Schnitt und Median in JavaScript - fuer einen
   * Tag ging das auf, fuer den gesamten Bestand waere es eine Abfrage, die
   * mit jedem Monat teurer wird und ab Zeile 1001 einfach falsche Werte
   * liefert.
   *
   * `GREATEST(..., 0)` haelt dieselbe Regel fest wie vorher `Math.max(0, ...)`:
   * eine negative Dauer ist keine Wartezeit, sondern eine kaputte Uhr.
   */
  const [wartezeit] = await prisma.$queryRaw<
    Array<{ anzahl: bigint; schnitt: number | null; median: number | null }>
  >`
    SELECT
      count(*) AS anzahl,
      avg(GREATEST(EXTRACT(EPOCH FROM ("decidedAt" - "joinedAt")), 0))::float8 AS schnitt,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY GREATEST(EXTRACT(EPOCH FROM ("decidedAt" - "joinedAt")), 0)
      )::float8 AS median
    FROM "VerificationRequest"
    WHERE "guildId" = ${guildId}
      AND "decidedAt" IS NOT NULL
      AND "status"::text IN ('VERIFIED', 'REJECTED')
  `;
  const schnittBasis = Number(wartezeit?.anzahl ?? 0);

  const [verifiziert7, aiVerifiziert7, abgelehnt7, ohneNachricht7] = await Promise.all([
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'VERIFIED', decidedBy: 'AI', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'REJECTED', decidedAt: { gte: vorSieben } },
    }),
    prisma.verificationRequest.count({
      where: { guildId, status: 'EXPIRED', decidedAt: { gte: vorSieben } },
    }),
  ]);
  const entschieden7 = verifiziert7 + abgelehnt7;

  return {
    wartetAufNachricht,
    wartetAufModeration,
    gesamtVerifiziert,
    gesamtAbgelehnt,
    gesamtAiVerifiziert,
    schnittWartezeit:
      schnittBasis > 0 && wartezeit?.schnitt !== null && wartezeit?.schnitt !== undefined
        ? Math.round(wartezeit.schnitt)
        : null,
    medianWartezeit:
      schnittBasis > 0 && wartezeit?.median !== null && wartezeit?.median !== undefined
        ? Math.round(wartezeit.median)
        : null,
    schnittBasis,
    aiAnfragenHeute: aiAnfragen._sum.aiAttempts ?? 0,
    aiFehlerHeute,
    aiQuote7Tage: verifiziert7 > 0 ? Math.round((aiVerifiziert7 / verifiziert7) * 100) : null,
    ablehnQuote7Tage: entschieden7 > 0 ? Math.round((abgelehnt7 / entschieden7) * 100) : null,
    ohneNachricht7Tage: ohneNachricht7,
  };
}

/** Der letzte abgeschlossene Vorgang einer Person - fuer das Member Center. */
export async function verificationFuerMitglied(discordId: string): Promise<{
  status: VerificationStatus;
  decidedAt: Date | null;
  decidedBy: VerificationRequest['decidedBy'];
  decidedByUsername: string | null;
} | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.verificationRequest.findFirst({
    where: { guildId, discordId, decidedAt: { not: null } },
    select: { status: true, decidedAt: true, decidedBy: true, decidedByUsername: true },
    orderBy: { decidedAt: 'desc' },
  });
}
