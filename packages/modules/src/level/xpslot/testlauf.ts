import { prisma, type Prisma, type XpSlotSpin } from '@swisshub/database';
import { conflict } from '@swisshub/shared';
import { secureRandom, type RandomSource } from '../../zufall';
import { gewinnstufe, werteAus } from './auswertung';
import { leseKonfiguration, type SlotKonfiguration } from './konfiguration';
import { dreheWalzen, linienZellen, REIHEN, WALZEN, ZELLEN, type Spielregeln } from './regeln';
import type { SpinErgebnis } from './spin';

/**
 * Der Testmodus der Verwaltung.
 *
 * ## Was ein Testlauf ist
 *
 * Ein vollstaendiger Spin mit vollstaendigem Ergebnis - und ohne jede Folge.
 * Kein XP wird abgebucht, kein Gewinn gutgeschrieben, kein Freispiel
 * verbraucht, keine Bonusrunde eroeffnet, keine Statistik und keine
 * Tagesbilanz beruehrt, kein Premium gewaehrt, keine Auszeichnung ausgeloest,
 * keine Meldung auf Discord. Der Spin wird als `TEST` gespeichert, damit sich
 * ansehen laesst, was herauskam - und **jede** Abfrage, die Kennzahlen,
 * Historie oder Auszeichnungen fuellt, schliesst `TEST` aus.
 *
 * ## Warum er trotzdem gespeichert wird
 *
 * Weil man sonst nicht nachsehen kann, was man gerade gesehen hat. Ein
 * Testlauf, der nur im Browser existiert, ist beim Nachfragen weg.
 *
 * ## Warum die Erzwingung hier steht und nicht in der Spiellogik
 *
 * Weil die Spiellogik nichts erzwingen darf. `dreheWalzen` kennt nur
 * Gewichte; ein Schalter «mach einen Jackpot» darin waere ein Schalter, den
 * irgendwann ein anderer Pfad findet. Hier wird ein Spielfeld **gebaut** und
 * dann durch dieselbe Auswertung geschickt wie jedes andere - deshalb ist
 * ein erzwungener Jackpot auch wirklich einer und keine Anzeige.
 */

/** Was sich erzwingen laesst. */
export const TESTFAELLE = ['zufall', 'jackpot', 'bonus', 'premium', 'sweat', 'mega'] as const;
export type Testfall = (typeof TESTFAELLE)[number];

export const TESTFALL_LABEL: Record<Testfall, string> = {
  zufall: 'Zufälliger Spin',
  jackpot: 'Jackpot erzwingen',
  bonus: 'Bonus erzwingen',
  premium: 'Premium-Gewinn erzwingen',
  sweat: 'Bonus-Sweat erzwingen (zwei Symbole, dritter noch offen)',
  mega: 'Mega Win erzwingen',
};

/**
 * Baut ein Spielfeld fuer einen Testfall.
 *
 * Der Rest des Felds wird gewoehnlich gezogen - ein erzwungener Jackpot soll
 * aussehen wie ein echter und nicht wie ein Formular.
 */
export function erzwungenesGrid(
  regeln: Spielregeln,
  fall: Testfall,
  ausloeser: number,
  random: RandomSource = secureRandom,
): string[] {
  const grid = dreheWalzen(regeln, random);
  const symbol = (rolle: Spielregeln['symbole'][number]['rolle']): string | null =>
    regeln.symbole.find((eintrag) => eintrag.rolle === rolle)?.key ?? null;

  if (fall === 'zufall') {
    return grid;
  }

  if (fall === 'jackpot' || fall === 'premium' || fall === 'mega') {
    const key =
      fall === 'jackpot'
        ? symbol('JACKPOT')
        : fall === 'premium'
          ? symbol('PREMIUM')
          : hoechstesNormal(regeln);
    if (!key) {
      throw conflict('Für diesen Testfall fehlt das passende Symbol in der Konfiguration.');
    }
    for (const index of linienZellen(0)) {
      grid[index] = key;
    }
    return grid;
  }

  const bonus = symbol('SCATTER');
  if (!bonus) {
    throw conflict('Es ist kein Bonussymbol eingerichtet.');
  }

  /*
   * Erst alle Bonussymbole entfernen, dann genau so viele setzen, wie der
   * Fall verlangt. Ohne das Entfernen koennte der Zufall ein weiteres
   * beigesteuert haben - und aus dem Sweat waere ein Bonus geworden.
   */
  const ohneBonus = regeln.symbole.filter((eintrag) => eintrag.rolle !== 'SCATTER' && eintrag.gewicht > 0);
  for (let index = 0; index < ZELLEN; index += 1) {
    if (grid[index] === bonus) {
      grid[index] = ohneBonus[random.integer(ohneBonus.length)]?.key ?? grid[index]!;
    }
  }

  // Ein Bonussymbol je Walze, von links - so entsteht beim Sweat die
  // Spannung auf der naechsten Walze.
  const anzahl = fall === 'bonus' ? ausloeser : Math.max(1, ausloeser - 1);
  for (let walze = 0; walze < Math.min(anzahl, WALZEN); walze += 1) {
    grid[walze * REIHEN + random.integer(REIHEN)] = bonus;
  }
  return grid;
}

function hoechstesNormal(regeln: Spielregeln): string | null {
  const kandidaten = regeln.symbole.filter((eintrag) => eintrag.rolle === 'NORMAL');
  if (kandidaten.length === 0) {
    return null;
  }
  return kandidaten.reduce((bester, eintrag) =>
    (eintrag.auszahlung[2] ?? 0) > (bester.auszahlung[2] ?? 0) ? eintrag : bester,
  ).key;
}

export interface TestlaufEingabe {
  discordId: string;
  einsatz: number;
  fall: Testfall;
  random?: RandomSource;
}

/**
 * Fuehrt einen Testlauf aus.
 *
 * Kein Blick auf den XP-Stand, keine Grenzen, keine Wiederholungssperre: ein
 * Testlauf ist kein Spin, und wer testen darf, darf beliebig oft testen. Der
 * Einsatz wird trotzdem gegen die spielbaren Einsaetze geprueft, weil eine
 * Vorschau mit einem Einsatz, den es nicht gibt, nichts vorfuehrt.
 */
export async function testlauf(
  eingabe: TestlaufEingabe,
): Promise<{ ergebnis: SpinErgebnis; spin: XpSlotSpin; konfiguration: SlotKonfiguration }> {
  const konfiguration = await leseKonfiguration();
  const w = konfiguration.wirksam;
  if (!w.einsaetze.includes(eingabe.einsatz)) {
    throw conflict(`Dieser Einsatz ist nicht spielbar. Möglich sind: ${w.einsaetze.join(', ')} XP.`);
  }

  const random = eingabe.random ?? secureRandom;
  const grid = erzwungenesGrid(konfiguration.regeln, eingabe.fall, w.bonusAusloeser, random);
  const auswertung = werteAus(grid, konfiguration.regeln, eingabe.einsatz);

  const spin = await prisma.xpSlotSpin.create({
    data: {
      discordId: eingabe.discordId,
      kind: 'TEST',
      bet: eingabe.einsatz,
      grid,
      lines: auswertung.treffer as unknown as Prisma.InputJsonValue,
      grossWin: auswertung.gewinn,
      netWin: 0,
      capped: auswertung.gedeckelt,
      jackpot: auswertung.jackpot,
      bonusTrigger: auswertung.bonusAusgeloest,
      premiumDays: auswertung.premiumTage,
      xpBefore: 0,
      xpAfter: 0,
      configNote: { testfall: eingabe.fall },
      eventId: konfiguration.event?.id ?? null,
    },
  });

  return {
    spin,
    konfiguration,
    ergebnis: {
      spinId: spin.id,
      wiederholung: false,
      art: 'TEST',
      einsatz: eingabe.einsatz,
      grid,
      treffer: auswertung.treffer,
      gewinn: auswertung.gewinn,
      netto: 0,
      gedeckelt: auswertung.gedeckelt,
      stufe: gewinnstufe(
        auswertung.gewinn,
        eingabe.einsatz,
        { gross: w.tierGross, mega: w.tierMega },
        auswertung.jackpot,
      ),
      jackpot: auswertung.jackpot,
      premiumTage: auswertung.premiumTage,
      bonusZellen: auswertung.bonusZellen,
      bonusSymbole: auswertung.bonusSymbole,
      bonusAusgeloest: auswertung.bonusAusgeloest,
      sweatAbWalze: auswertung.sweatAbWalze,
      xpVorher: 0,
      xpNachher: 0,
      bonus: null,
      freispieleOffen: 0,
      freispielEinsatz: null,
      stand: {
        tagesverlust: 0,
        tagesgewinn: 0,
        spinsHeute: 0,
        spinsInSitzung: 0,
        pauseSekunden: 0,
      },
    },
  };
}
