import { prisma, type Prisma } from '@swisshub/database';
import { rtpVon, leseKonfiguration } from './konfiguration';
import { tagesschluessel } from './limits';

/**
 * Die Kennzahlen des Slots.
 *
 * ## Was «echte RTP» heisst
 *
 * Gewinn geteilt durch Einsatz, ueber die tatsaechlich gespielten Spins. Sie
 * weicht von der theoretischen Quote ab, und das ist normal: bei tausend
 * Spins schwankt sie um mehrere Punkte, weil ein einzelner Bonus mehr
 * ausschuettet als hundert gewoehnliche Spins zusammen. Deshalb steht neben
 * ihr immer die Zahl der Spins - eine Quote ohne Stichprobengroesse ist
 * keine Auskunft.
 *
 * ## Warum Freispiele den Nenner nicht erhoehen
 *
 * Ein Freispiel hat keinen Einsatz. Wuerde der fiktive Einsatz mitgezaehlt,
 * sahe die echte Quote kuenstlich niedrig aus; wuerde der Gewinn ohne Einsatz
 * gezaehlt, kuenstlich hoch. Gezaehlt wird beides getrennt, und der Bericht
 * sagt, wie viel aus Freispielen kam.
 *
 * ## Testlaeufe kommen nirgends vor
 *
 * Jede Abfrage hier filtert `kind: { not: 'TEST' }`. Ein erzwungener Jackpot
 * aus der Verwaltung darf die Kennzahlen nicht verschieben - sonst waere der
 * Testmodus das schnellste Mittel, die Statistik unbrauchbar zu machen.
 */

export const ZEITRAEUME = ['24h', '7d', '30d', 'alles'] as const;
export type Zeitraum = (typeof ZEITRAEUME)[number];

export const ZEITRAUM_LABEL: Record<Zeitraum, string> = {
  '24h': 'Letzte 24 Stunden',
  '7d': 'Letzte 7 Tage',
  '30d': 'Letzte 30 Tage',
  alles: 'Gesamt',
};

export function seit(zeitraum: Zeitraum, jetzt = new Date()): Date | null {
  const stunde = 60 * 60 * 1000;
  if (zeitraum === '24h') {
    return new Date(jetzt.getTime() - 24 * stunde);
  }
  if (zeitraum === '7d') {
    return new Date(jetzt.getTime() - 7 * 24 * stunde);
  }
  if (zeitraum === '30d') {
    return new Date(jetzt.getTime() - 30 * 24 * stunde);
  }
  return null;
}

/** Der Filter, den jede Abfrage hier teilt. */
function filter(zeitraum: Zeitraum, jetzt: Date): Prisma.XpSlotSpinWhereInput {
  const ab = seit(zeitraum, jetzt);
  return { kind: { not: 'TEST' }, ...(ab ? { createdAt: { gte: ab } } : {}) };
}

export interface SlotKennzahlen {
  zeitraum: Zeitraum;
  spins: number;
  bezahlteSpins: number;
  freispiele: number;
  xpEin: number;
  xpAus: number;
  /** Was dem System geblieben ist. Negativ heisst: der Slot hat verloren. */
  saldo: number;
  rtpEcht: number | null;
  rtpTheoretisch: number;
  einsatzSchnitt: number | null;
  groessterGewinn: number;
  groessterVerlust: number;
  jackpots: number;
  bonusRunden: number;
  freispieleGewonnen: number;
  premiumGewinne: number;
  premiumTage: number;
  grosseGewinne: number;
  spieler: number;
  aktivste: Array<{ discordId: string; spins: number; einsatz: number; gewinn: number }>;
  jeTag: Array<{ tag: string; spins: number; einsatz: number; gewinn: number }>;
}

/** Alle Kennzahlen eines Zeitraums. */
export async function kennzahlen(zeitraum: Zeitraum, jetzt = new Date()): Promise<SlotKennzahlen> {
  const wo = filter(zeitraum, jetzt);
  const konfiguration = await leseKonfiguration(jetzt);

  const [
    gesamt,
    bezahlt,
    frei,
    extremGewinn,
    extremVerlust,
    jackpots,
    bonus,
    premium,
    gross,
    spieler,
    aktivste,
  ] = await Promise.all([
    prisma.xpSlotSpin.aggregate({ where: wo, _count: { _all: true }, _sum: { grossWin: true, bet: true } }),
    prisma.xpSlotSpin.aggregate({
      where: { ...wo, kind: 'PAID' },
      _count: { _all: true },
      _sum: { bet: true, grossWin: true },
      _avg: { bet: true },
    }),
    prisma.xpSlotSpin.aggregate({
      where: { ...wo, kind: { in: ['FREESPIN_PACKAGE', 'BONUS_ROUND'] } },
      _count: { _all: true },
      _sum: { grossWin: true },
    }),
    prisma.xpSlotSpin.findFirst({ where: wo, orderBy: { grossWin: 'desc' }, select: { grossWin: true } }),
    prisma.xpSlotSpin.findFirst({ where: wo, orderBy: { netWin: 'asc' }, select: { netWin: true } }),
    prisma.xpSlotSpin.count({ where: { ...wo, jackpot: true } }),
    prisma.xpSlotSpin.count({ where: { ...wo, bonusTrigger: true } }),
    prisma.xpSlotSpin.aggregate({
      where: { ...wo, premiumDays: { gt: 0 } },
      _count: { _all: true },
      _sum: { premiumDays: true },
    }),
    zaehleGrosse(wo, konfiguration.wirksam.tierGross),
    prisma.xpSlotSpin
      .groupBy({ by: ['discordId'], where: wo, _count: { _all: true } })
      .then((zeilen) => zeilen.length),
    prisma.xpSlotSpin.groupBy({
      by: ['discordId'],
      where: wo,
      _count: { _all: true },
      _sum: { bet: true, grossWin: true },
      orderBy: { _count: { discordId: 'desc' } },
      take: 10,
    }),
  ]);

  /*
   * Gewonnene Freispiele: die Summe der zugesagten Spiele aller Bonusrunden
   * **und** der gewaehrten Pakete. Beides sind Freispiele, auch wenn sie
   * verschieden entstehen - wer fragt «wie viele Freispiele gab es?», meint
   * beide.
   */
  const [ausBonus, ausPaketen] = await Promise.all([
    prisma.xpSlotBonusRound.aggregate({
      where: zeitraumFilter(zeitraum, jetzt),
      _sum: { awarded: true },
    }),
    prisma.xpSlotFreespinPackage.aggregate({
      where: zeitraumFilter(zeitraum, jetzt),
      _sum: { granted: true },
    }),
  ]);

  const xpEin = bezahlt._sum.bet ?? 0;
  const xpAus = gesamt._sum.grossWin ?? 0;

  return {
    zeitraum,
    spins: gesamt._count._all,
    bezahlteSpins: bezahlt._count._all,
    freispiele: frei._count._all,
    xpEin,
    xpAus,
    saldo: xpEin - xpAus,
    rtpEcht: xpEin > 0 ? xpAus / xpEin : null,
    rtpTheoretisch: rtpVon(konfiguration).rtp,
    einsatzSchnitt: bezahlt._avg.bet ?? null,
    groessterGewinn: extremGewinn?.grossWin ?? 0,
    groessterVerlust: Math.abs(Math.min(0, extremVerlust?.netWin ?? 0)),
    jackpots,
    bonusRunden: bonus,
    freispieleGewonnen: (ausBonus._sum.awarded ?? 0) + (ausPaketen._sum.granted ?? 0),
    premiumGewinne: premium._count._all,
    premiumTage: premium._sum.premiumDays ?? 0,
    grosseGewinne: gross,
    spieler,
    aktivste: aktivste.map((zeile) => ({
      discordId: zeile.discordId,
      spins: zeile._count._all,
      einsatz: zeile._sum.bet ?? 0,
      gewinn: zeile._sum.grossWin ?? 0,
    })),
    jeTag: await jeTag(zeitraum, jetzt),
  };
}

function zeitraumFilter(zeitraum: Zeitraum, jetzt: Date): { createdAt?: { gte: Date } } {
  const ab = seit(zeitraum, jetzt);
  return ab ? { createdAt: { gte: ab } } : {};
}

/**
 * Grosse Gewinne zaehlen.
 *
 * Die Schwelle ist ein Vielfaches des Einsatzes, nicht eine feste XP-Summe -
 * deshalb geht das nicht als `where`-Bedingung, sondern braucht einen
 * Vergleich zweier Spalten. Rohes SQL ist hier die ehrlichere Loesung als
 * zehntausend Zeilen in den Arbeitsspeicher zu holen.
 */
async function zaehleGrosse(wo: Prisma.XpSlotSpinWhereInput, faktor: number): Promise<number> {
  const ab = (wo.createdAt as { gte?: Date } | undefined)?.gte ?? null;
  const zeilen = ab
    ? await prisma.$queryRaw<Array<{ anzahl: bigint }>>`
        SELECT COUNT(*)::bigint AS anzahl FROM "XpSlotSpin"
        WHERE "kind" <> 'TEST' AND "createdAt" >= ${ab} AND "grossWin" >= "bet" * ${faktor}
      `
    : await prisma.$queryRaw<Array<{ anzahl: bigint }>>`
        SELECT COUNT(*)::bigint AS anzahl FROM "XpSlotSpin"
        WHERE "kind" <> 'TEST' AND "grossWin" >= "bet" * ${faktor}
      `;
  return Number(zeilen[0]?.anzahl ?? 0);
}

/** Spins, Einsatz und Gewinn je Tag. */
async function jeTag(
  zeitraum: Zeitraum,
  jetzt: Date,
): Promise<Array<{ tag: string; spins: number; einsatz: number; gewinn: number }>> {
  const ab = seit(zeitraum, jetzt) ?? new Date(jetzt.getTime() - 90 * 24 * 60 * 60 * 1000);
  const zeilen = await prisma.$queryRaw<Array<{ tag: Date; spins: bigint; einsatz: bigint; gewinn: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS tag,
           COUNT(*)::bigint AS spins,
           COALESCE(SUM(CASE WHEN "kind" = 'PAID' THEN "bet" ELSE 0 END), 0)::bigint AS einsatz,
           COALESCE(SUM("grossWin"), 0)::bigint AS gewinn
    FROM "XpSlotSpin"
    WHERE "kind" <> 'TEST' AND "createdAt" >= ${ab}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return zeilen.map((zeile) => ({
    tag: zeile.tag.toISOString().slice(0, 10),
    spins: Number(zeile.spins),
    einsatz: Number(zeile.einsatz),
    gewinn: Number(zeile.gewinn),
  }));
}

/** Die Sitzungsstatistik, die eine Person selbst sieht. */
export interface SitzungsStatistik {
  spins: number;
  einsatz: number;
  gewinn: number;
  bestesSpin: number;
  saldo: number;
  tagesverlust: number;
  tagesgewinn: number;
  spinsHeute: number;
}

export async function meineStatistik(discordId: string, jetzt = new Date()): Promise<SitzungsStatistik> {
  const [sitzung, heute] = await Promise.all([
    prisma.xpSlotSession.findUnique({ where: { discordId } }),
    prisma.xpSlotDaily.findUnique({
      where: { discordId_day: { discordId, day: tagesschluessel(jetzt) } },
    }),
  ]);

  const gesetzt = heute?.staked ?? 0;
  const gewonnen = heute?.won ?? 0;
  return {
    spins: sitzung?.spins ?? 0,
    einsatz: sitzung?.staked ?? 0,
    gewinn: sitzung?.won ?? 0,
    bestesSpin: sitzung?.bestWin ?? 0,
    saldo: (sitzung?.won ?? 0) - (sitzung?.staked ?? 0),
    tagesverlust: Math.max(0, gesetzt - gewonnen),
    tagesgewinn: Math.max(0, gewonnen - gesetzt),
    spinsHeute: heute?.spins ?? 0,
  };
}

/**
 * Die Zahlen, aus denen die Auszeichnungen entstehen.
 *
 * Eine Abfrage je Person, und sie liest nur Summen - keine Spinzeilen. Sie
 * wird beim Oeffnen eines Profils aufgerufen, und ein Profil darf nicht
 * zehntausend Zeilen laden.
 */
export interface SlotGrundlage {
  spins: number;
  einsatzGesamt: number;
  gewinnGesamt: number;
  nettoGewinn: number;
  groessterGewinn: number;
  jackpots: number;
  bonusRunden: number;
  freispieleGewonnen: number;
  premiumTage: number;
  grosseGewinne: number;
  megaGewinne: number;
}

export async function slotGrundlage(discordId: string): Promise<SlotGrundlage> {
  const konfiguration = await leseKonfiguration();
  const w = konfiguration.wirksam;
  const wo: Prisma.XpSlotSpinWhereInput = { discordId, kind: { not: 'TEST' } };

  const [summen, bester, jackpots, bonus, premium, stufen, ausBonus, ausPaketen] = await Promise.all([
    prisma.xpSlotSpin.aggregate({
      where: wo,
      _count: { _all: true },
      _sum: { bet: true, grossWin: true, netWin: true },
    }),
    prisma.xpSlotSpin.findFirst({ where: wo, orderBy: { grossWin: 'desc' }, select: { grossWin: true } }),
    prisma.xpSlotSpin.count({ where: { ...wo, jackpot: true } }),
    prisma.xpSlotSpin.count({ where: { ...wo, bonusTrigger: true } }),
    prisma.xpSlotSpin.aggregate({ where: { ...wo, premiumDays: { gt: 0 } }, _sum: { premiumDays: true } }),
    prisma.$queryRaw<Array<{ gross: bigint; mega: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE "grossWin" >= "bet" * ${w.tierGross})::bigint AS gross,
        COUNT(*) FILTER (WHERE "grossWin" >= "bet" * ${w.tierMega})::bigint AS mega
      FROM "XpSlotSpin"
      WHERE "discordId" = ${discordId} AND "kind" <> 'TEST'
    `,
    prisma.xpSlotBonusRound.aggregate({ where: { discordId }, _sum: { awarded: true } }),
    prisma.xpSlotFreespinPackage.aggregate({ where: { discordId }, _sum: { granted: true } }),
  ]);

  // Der Einsatz zaehlt nur bei bezahlten Spins - ein Freispiel hat keinen.
  const bezahlt = await prisma.xpSlotSpin.aggregate({
    where: { discordId, kind: 'PAID' },
    _sum: { bet: true },
  });

  return {
    spins: summen._count._all,
    einsatzGesamt: bezahlt._sum.bet ?? 0,
    gewinnGesamt: summen._sum.grossWin ?? 0,
    nettoGewinn: Math.max(0, summen._sum.netWin ?? 0),
    groessterGewinn: bester?.grossWin ?? 0,
    jackpots,
    bonusRunden: bonus,
    freispieleGewonnen: (ausBonus._sum.awarded ?? 0) + (ausPaketen._sum.granted ?? 0),
    premiumTage: premium._sum.premiumDays ?? 0,
    grosseGewinne: Number(stufen[0]?.gross ?? 0),
    megaGewinne: Number(stufen[0]?.mega ?? 0),
  };
}
