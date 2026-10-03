import { prisma, type Prisma, type XpSlotSpinKind } from '@swisshub/database';
import { LINIEN } from './regeln';

/**
 * Der Spielverlauf.
 *
 * ## Zwei Sichten auf dieselben Zeilen
 *
 * Die Verwaltung sieht alles: wer, wann, Einsatz, Freispiel, das vollstaendige
 * Ergebnis, die Linien, Brutto und Netto, Bonus, Jackpot, Premium, den
 * XP-Stand danach und die Werte, die das Ergebnis bestimmt haben. Das
 * Mitglied sieht seinen eigenen Verlauf, kurz gehalten: Zeit, Einsatz,
 * Gewinn, was Besonderes passierte.
 *
 * ## Warum keine Konfigurationsversionierung
 *
 * Weil sie nicht gebraucht wird und teuer waere. Was ein Ergebnis bestimmt
 * hat, steht in `configNote` am Spin - Gewichte, Auszahlungen, Jackpot,
 * Bonusschwelle, Eventname. Eine vollstaendige Historie jeder Aenderung an
 * jeder Zahl waere eine zweite Datenbank, und niemand wuerde sie lesen. Fuer
 * «warum hat dieser Spin so viel gezahlt?» genuegt die Notiz am Spin.
 *
 * ## Testlaeufe
 *
 * Sie stehen **nicht** im Verlauf eines Mitglieds und nicht in den
 * Kennzahlen. In der Verwaltung sind sie sichtbar, aber nur, wenn man sie
 * ausdruecklich einschliesst - sonst stuende nach einem Nachmittag
 * Einstellungsarbeit der halbe Verlauf voll erzwungener Jackpots.
 */

export interface VerlaufEintrag {
  id: string;
  discordId: string;
  zeit: Date;
  art: XpSlotSpinKind;
  einsatz: number;
  grid: string[];
  linien: Array<{ linie: number; symbolKey: string; laenge: number; gewinn: number }>;
  brutto: number;
  netto: number;
  gedeckelt: boolean;
  jackpot: boolean;
  bonus: boolean;
  premiumTage: number;
  xpNachher: number;
  notiz: unknown;
  eventName: string | null;
}

export interface VerlaufFilter {
  discordId?: string | null;
  nurJackpot?: boolean;
  nurBonus?: boolean;
  nurPremium?: boolean;
  mitTestlaeufen?: boolean;
  seite?: number;
  proSeite?: number;
}

export interface VerlaufSeite {
  eintraege: VerlaufEintrag[];
  gesamt: number;
  seite: number;
  proSeite: number;
}

/** Der Verlauf fuer die Verwaltung. */
export async function verlauf(filter: VerlaufFilter = {}): Promise<VerlaufSeite> {
  const proSeite = Math.min(100, Math.max(10, filter.proSeite ?? 25));
  const seite = Math.max(1, filter.seite ?? 1);

  const wo: Prisma.XpSlotSpinWhereInput = {
    ...(filter.discordId ? { discordId: filter.discordId } : {}),
    ...(filter.mitTestlaeufen ? {} : { kind: { not: 'TEST' } }),
    ...(filter.nurJackpot ? { jackpot: true } : {}),
    ...(filter.nurBonus ? { bonusTrigger: true } : {}),
    ...(filter.nurPremium ? { premiumDays: { gt: 0 } } : {}),
  };

  const [zeilen, gesamt] = await Promise.all([
    prisma.xpSlotSpin.findMany({
      where: wo,
      orderBy: { createdAt: 'desc' },
      skip: (seite - 1) * proSeite,
      take: proSeite,
      include: { event: { select: { name: true } } },
    }),
    prisma.xpSlotSpin.count({ where: wo }),
  ]);

  return {
    eintraege: zeilen.map((zeile) => ({
      id: zeile.id,
      discordId: zeile.discordId,
      zeit: zeile.createdAt,
      art: zeile.kind,
      einsatz: zeile.bet,
      grid: zeile.grid,
      linien: lesbareLinien(zeile.lines),
      brutto: zeile.grossWin,
      netto: zeile.netWin,
      gedeckelt: zeile.capped,
      jackpot: zeile.jackpot,
      bonus: zeile.bonusTrigger,
      premiumTage: zeile.premiumDays,
      xpNachher: zeile.xpAfter,
      notiz: zeile.configNote,
      eventName: zeile.event?.name ?? null,
    })),
    gesamt,
    seite,
    proSeite,
  };
}

/**
 * Die Linien eines gespeicherten Spins.
 *
 * Das JSON kommt aus der Datenbank und kann aelter sein als der Code. Statt
 * ihm zu vertrauen, wird jeder Eintrag auf Form geprueft - ein unlesbarer
 * Eintrag wird weggelassen und nicht als `NaN` angezeigt.
 */
function lesbareLinien(
  wert: unknown,
): Array<{ linie: number; symbolKey: string; laenge: number; gewinn: number }> {
  if (!Array.isArray(wert)) {
    return [];
  }
  return wert.flatMap((eintrag) => {
    if (typeof eintrag !== 'object' || eintrag === null) {
      return [];
    }
    const roh = eintrag as Record<string, unknown>;
    const linie = typeof roh.linie === 'number' ? roh.linie : null;
    const symbolKey = typeof roh.symbolKey === 'string' ? roh.symbolKey : null;
    const laenge = typeof roh.laenge === 'number' ? roh.laenge : null;
    const gewinn = typeof roh.gewinn === 'number' ? roh.gewinn : 0;
    if (linie === null || symbolKey === null || laenge === null || linie >= LINIEN.length) {
      return [];
    }
    return [{ linie, symbolKey, laenge, gewinn }];
  });
}

export interface MeinEintrag {
  id: string;
  zeit: Date;
  art: XpSlotSpinKind;
  einsatz: number;
  gewinn: number;
  netto: number;
  jackpot: boolean;
  bonus: boolean;
  premiumTage: number;
}

/** Der eigene Verlauf - kurz. */
export async function meinVerlauf(discordId: string, anzahl = 20): Promise<MeinEintrag[]> {
  const zeilen = await prisma.xpSlotSpin.findMany({
    where: { discordId, kind: { not: 'TEST' } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(5, anzahl)),
    select: {
      id: true,
      createdAt: true,
      kind: true,
      bet: true,
      grossWin: true,
      netWin: true,
      jackpot: true,
      bonusTrigger: true,
      premiumDays: true,
    },
  });
  return zeilen.map((zeile) => ({
    id: zeile.id,
    zeit: zeile.createdAt,
    art: zeile.kind,
    einsatz: zeile.bet,
    gewinn: zeile.grossWin,
    netto: zeile.netWin,
    jackpot: zeile.jackpot,
    bonus: zeile.bonusTrigger,
    premiumTage: zeile.premiumDays,
  }));
}
