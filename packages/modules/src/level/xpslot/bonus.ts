import { prisma, type Prisma, type XpSlotBonusRound } from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { secureRandom, type RandomSource } from '../../zufall';
import { BASISPUNKTE } from './regeln';
import { leseKonfiguration, type SlotKonfiguration } from './konfiguration';
import { bonusStand, type BonusStand } from './spin';

/**
 * Die Bonusrunde und ihre Risikoleiter.
 *
 * ## Die Regel, die alles bestimmt
 *
 * **Eine verlorene Risikowahl kostet die ganze Runde.** Nicht die Haelfte,
 * nicht den Zuschlag - alles. Wer von 8 auf 12 riskiert und verliert, hat
 * null Freispiele. Das ist die Anforderung, und sie ist der Grund, weshalb
 * die Entscheidung etwas bedeutet.
 *
 * ## Warum das Ergebnis hier entsteht und nicht im Browser
 *
 * Weil es sonst kein Risiko waere. Der Wuerfel fallt auf dem Server, mit
 * `crypto.randomInt` ueber `secureRandom`, bevor die Animation startet. Die
 * Oberflaeche inszeniert ein Ergebnis, das in dem Moment schon feststeht, in
 * dem sie die Antwort bekommt - genau wie das Rad der Verlosung.
 *
 * ## Warum die Chancen einstellbar und trotzdem nicht beliebig sind
 *
 * Freispiele mit Sticky Wilds sind ueberproportional wertvoll (siehe
 * `rtp.ts`). Eine Chance von 50 Prozent macht Riskieren deshalb lohnend und
 * hebt die Quote ueber 100 Prozent. Die Vorgaben stehen bei 34 und 46
 * Prozent, damit Nehmen und Riskieren etwa gleich viel wert sind; wer sie
 * verschiebt, sieht die Folge im Dashboard.
 */

/** Die Runde, auf die sich eine Entscheidung bezieht. */
async function holeRunde(discordId: string, rundeId: string): Promise<XpSlotBonusRound> {
  const runde = await prisma.xpSlotBonusRound.findUnique({ where: { id: rundeId } });
  if (!runde) {
    throw notFound('Diese Bonusrunde gibt es nicht.');
  }
  /*
   * Die Pruefung auf die eigene Runde.
   *
   * `notFound` und nicht «verboten»: eine fremde Rundenkennung soll nicht
   * bestaetigt bekommen, dass sie existiert.
   */
  if (runde.discordId !== discordId) {
    throw notFound('Diese Bonusrunde gibt es nicht.');
  }
  return runde;
}

/** Was auf dieser Stufe zur Wahl steht. */
function stufenwerte(
  runde: XpSlotBonusRound,
  konfiguration: SlotKonfiguration,
): { nehmen: number; riskierenAuf: number; chance: number } {
  const w = konfiguration.wirksam;
  if (runde.stage === 'LADDER_1') {
    return { nehmen: w.bonusFreispiele, riskierenAuf: w.leiter1, chance: w.gambleChance1Bp / BASISPUNKTE };
  }
  return { nehmen: w.leiter1, riskierenAuf: w.leiter2, chance: w.gambleChance2Bp / BASISPUNKTE };
}

/**
 * Nimmt die Freispiele dieser Stufe.
 *
 * Danach beginnt der Freispielmodus: `remaining` ist gesetzt, und jeder
 * weitere Spin dieser Person geht als Freispiel durch `dreheSpin`.
 */
export async function nimmFreispiele(discordId: string, rundeId: string): Promise<{ bonus: BonusStand }> {
  const konfiguration = await leseKonfiguration();
  const runde = await holeRunde(discordId, rundeId);
  if (runde.stage !== 'LADDER_1' && runde.stage !== 'LADDER_2') {
    throw conflict('Auf dieser Bonusrunde steht keine Entscheidung mehr an.');
  }

  const { nehmen } = stufenwerte(runde, konfiguration);
  const aktualisiert = await prisma.xpSlotBonusRound.update({
    where: { id: runde.id },
    data: {
      stage: nehmen > 0 ? 'SPINS' : 'FINISHED',
      awarded: nehmen,
      remaining: nehmen,
      ladder: [
        ...leiterEintraege(runde),
        { stufe: runde.stage, wahl: 'nehmen', freispiele: nehmen },
      ] as unknown as Prisma.InputJsonValue,
      finishedAt: nehmen > 0 ? null : new Date(),
    },
  });

  return { bonus: bonusStand(aktualisiert, konfiguration) };
}

/**
 * Riskiert die naechste Stufe.
 *
 * Gewonnen: die Runde steht auf der naechsten Stufe und es gibt wieder die
 * Wahl - nach der zweiten Stufe gibt es nichts mehr zu riskieren, dann
 * beginnen die Freispiele sofort. Verloren: die Runde ist vorbei, mit null
 * Freispielen.
 */
export async function riskiere(
  discordId: string,
  rundeId: string,
  random: RandomSource = secureRandom,
): Promise<{ bonus: BonusStand; gewonnen: boolean }> {
  const konfiguration = await leseKonfiguration();
  const runde = await holeRunde(discordId, rundeId);
  if (runde.stage !== 'LADDER_1' && runde.stage !== 'LADDER_2') {
    throw conflict('Auf dieser Bonusrunde steht keine Entscheidung mehr an.');
  }

  const { riskierenAuf, chance } = stufenwerte(runde, konfiguration);
  /*
   * Der Wuerfel: eine gleichverteilte Zahl in [0, 10000) gegen die Chance in
   * Basispunkten. Kein `Math.random`, und kein Vergleich auf einer
   * Fliesskommazahl - Basispunkte sind ganzzahlig, und damit ist 34,00
   * Prozent genau 34,00 Prozent.
   */
  const wurf = random.integer(BASISPUNKTE);
  const gewonnen = wurf < Math.round(chance * BASISPUNKTE);

  const naechste: XpSlotBonusRound['stage'] = !gewonnen
    ? 'LOST'
    : runde.stage === 'LADDER_1'
      ? 'LADDER_2'
      : riskierenAuf > 0
        ? 'SPINS'
        : 'FINISHED';

  const aktualisiert = await prisma.xpSlotBonusRound.update({
    where: { id: runde.id },
    data: {
      stage: naechste,
      // Gewonnen auf der letzten Stufe: die Freispiele stehen sofort an.
      awarded: naechste === 'SPINS' ? riskierenAuf : runde.awarded,
      remaining: naechste === 'SPINS' ? riskierenAuf : 0,
      ladder: [
        ...leiterEintraege(runde),
        {
          stufe: runde.stage,
          wahl: 'riskieren',
          gewonnen,
          wurf,
          chanceBp: Math.round(chance * BASISPUNKTE),
        },
      ] as unknown as Prisma.InputJsonValue,
      finishedAt: naechste === 'LOST' || naechste === 'FINISHED' ? new Date() : null,
    },
  });

  return { bonus: bonusStand(aktualisiert, konfiguration), gewonnen };
}

/** Die bisherigen Leitereintraege - als Liste, auch wenn noch keine da ist. */
function leiterEintraege(runde: XpSlotBonusRound): unknown[] {
  return Array.isArray(runde.ladder) ? (runde.ladder as unknown[]) : [];
}

/** Die Runde einer Person, aufbereitet - oder keine. */
export async function bonusFuer(
  discordId: string,
  konfiguration?: SlotKonfiguration,
): Promise<BonusStand | null> {
  const runde = await prisma.xpSlotBonusRound.findFirst({
    where: { discordId, stage: { in: ['LADDER_1', 'LADDER_2', 'SPINS'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!runde) {
    return null;
  }
  return bonusStand(runde, konfiguration ?? (await leseKonfiguration()));
}
