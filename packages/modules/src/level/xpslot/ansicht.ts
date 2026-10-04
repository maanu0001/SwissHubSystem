import { prisma } from '@swisshub/database';
import { BASISPUNKTE, LINIEN, linienZellen, REIHEN, WALZEN } from './regeln';
import { leseKonfiguration, istSpielbar, rtpVon, type SlotKonfiguration } from './konfiguration';
import { klaengeDesPakets } from './klaenge';
import { offeneFreispiele } from './freispiele';
import { bonusFuer } from './bonus';
import { meineStatistik, type SitzungsStatistik } from './statistik';
import { meinVerlauf, type MeinEintrag } from './historie';
import { pruefeGrenzen } from './limits';
import type { BonusStand } from './spin';
import {
  offeneBonusMeldung,
  offeneFreispielMeldung,
  offenerBonusAbschluss,
  offenerFreispielAbschluss,
  type BonusAbschluss,
  type BonusIntro,
  type FreispielAbschluss,
  type FreispielIntro,
} from './geschenke';

/**
 * Was der Browser bekommt.
 *
 * ## Die Trennlinie
 *
 * Hier wird entschieden, was die Spielerin sieht - und zwar nach zwei Regeln:
 *
 * 1. **Alles, was sie fuer eine Entscheidung braucht,** steht hier:
 *    Auszahlungen, Wild- und Bonusregeln, Jackpot, Freispiele, Sticky Wilds,
 *    Retrigger, die theoretische Quote, die spielbaren Einsaetze, der
 *    Hoechstgewinn, ihre Grenzen. Das ist die Anforderung «transparent, keine
 *    versteckten Bedingungen», und sie ist hier erfuellt, nicht im Kleingedruckten.
 *
 * 2. **Nichts, womit sich ein Ergebnis beeinflussen liesse.** Die Gewichte
 *    stehen nicht drin. Nicht, weil sie geheim waeren - die Quote verraet sie
 *    ohnehin ungefaehr -, sondern weil ein Gewicht im Browser aussieht wie
 *    etwas, das der Browser bestimmt. Er bestimmt nichts: das Spielfeld
 *    entsteht auf dem Server und kommt fertig an.
 *
 * ## Warum die Linien mitkommen
 *
 * Damit die Oberflaeche einen Gewinn zeigen kann, ohne ihn zu berechnen. Die
 * Treffer kommen fertig aus dem Spin - die Linienform braucht sie nur, um sie
 * zu zeichnen.
 */

export interface SymbolAnsicht {
  key: string;
  name: string;
  rolle: string;
  glow: boolean;
  bildPfad: string | null;
  bildUrl: string | null;
  /** Auszahlung als Vielfaches des Einsatzes - drei, vier, fuenf Gleiche. */
  auszahlung: [number, number, number];
  premiumTage: [number, number, number];
  beschreibung: string;
}

export interface SlotAnsicht {
  spielbar: boolean;
  /**
   * Steht der Slot in Wartung?
   *
   * Zusammen mit `spielbar: true` heisst das: diese Person darf spielen, die
   * Mitglieder nicht. Die Oberflaeche sagt das deutlich - sonst aendert
   * jemand etwas in der Annahme, alle koennten gerade spielen.
   */
  wartung: boolean;
  grund: string | null;
  symbole: SymbolAnsicht[];
  linien: number[][];
  walzen: number;
  reihen: number;
  einsaetze: number[];
  jackpotMultiplikator: number;
  jackpotNurEcht: boolean;
  wildErsetztAlles: boolean;
  bonusAusloeser: number;
  bonusFreispiele: number;
  leiter: Array<{ freispiele: number; chance: number }>;
  retriggerSpins: number;
  stickyWilds: boolean;
  premiumAktiv: boolean;
  maxGewinnMultiplikator: number;
  autoSpinZahlen: number[];
  schwellen: { gross: number; mega: number };
  /** Theoretische Quote als Anteil. */
  rtp: number;
  grenzen: {
    maxTagesverlust: number;
    maxTagesgewinn: number;
    maxSpinsJeSitzung: number;
    sitzungspauseSekunden: number;
  };
  design: {
    hintergrund: string | null;
    logo: string | null;
    akzentfarbe: string | null;
    overlay: number;
    glow: number;
    knopfStil: string;
  };
  klaenge: Array<{ slot: string; dateiname: string; lautstaerke: number; musik: boolean }>;
}

/** Der Zustand einer Person im Spiel. */
export interface SpielerAnsicht {
  xp: number;
  einsatz: number;
  freispieleOffen: number;
  freispielEinsatz: number | null;
  bonus: BonusStand | null;
  statistik: SitzungsStatistik;
  verlauf: MeinEintrag[];
  gesperrt: string | null;
  /** Was beim Oeffnen noch zu melden ist. */
  meldungen: SlotMeldungen;
}

const BESCHREIBUNGEN: Record<string, string> = {
  NORMAL: 'Zahlt ab drei Gleichen von links.',
  WILD: 'Ersetzt Symbole und vervollständigt Linien. In Freispielen bleibt es stehen.',
  SCATTER: 'Löst die Bonusrunde aus - irgendwo auf dem Feld, keine Linie nötig.',
  JACKPOT: 'Fünf auf einer Linie sind der Jackpot.',
  PREMIUM: 'Zahlt XP und zusätzlich Premium-Tage.',
};

/**
 * Die Ansicht des Spiels.
 *
 * `darfVerwalten` entscheidet nur eines: ob der Wartungsmodus diese Person
 * aussperrt. Es kommt aus der Berechtigungsengine der Aufrufstelle, und die
 * Spin-API prueft dasselbe noch einmal selbst - diese Ansicht ist eine
 * Anzeige und kein Riegel.
 */
export async function slotAnsicht(
  konfiguration?: SlotKonfiguration,
  darfVerwalten = false,
): Promise<SlotAnsicht> {
  const k = konfiguration ?? (await leseKonfiguration());
  const w = k.wirksam;
  const zustand = istSpielbar(k, darfVerwalten);
  const rtp = rtpVon(k);

  const nachKey = new Map(k.regeln.symbole.map((symbol) => [symbol.key, symbol]));
  const symbole: SymbolAnsicht[] = k.symbole
    .filter((symbol) => (nachKey.get(symbol.key)?.gewicht ?? 0) > 0)
    .map((symbol) => {
      const spiel = nachKey.get(symbol.key)!;
      return {
        key: symbol.key,
        name: symbol.name,
        rolle: symbol.role,
        glow: symbol.glow,
        bildPfad: symbol.imagePath,
        bildUrl: symbol.imageUrl,
        auszahlung: [
          spiel.auszahlung[0] / BASISPUNKTE,
          spiel.auszahlung[1] / BASISPUNKTE,
          spiel.auszahlung[2] / BASISPUNKTE,
        ],
        premiumTage: [...spiel.premiumTage] as [number, number, number],
        beschreibung: BESCHREIBUNGEN[symbol.role] ?? BESCHREIBUNGEN.NORMAL!,
      };
    });

  return {
    spielbar: zustand.ok,
    grund: zustand.grund,
    wartung: zustand.wartung,
    symbole,
    linien: LINIEN.map((_unused, index) => linienZellen(index)),
    walzen: WALZEN,
    reihen: REIHEN,
    einsaetze: w.einsaetze.filter((wert) => wert >= w.minEinsatz && wert <= w.maxEinsatz),
    jackpotMultiplikator: w.jackpotMultiplikator,
    jackpotNurEcht: w.jackpotNurEcht,
    wildErsetztAlles: w.wildErsetztAlles,
    bonusAusloeser: w.bonusAusloeser,
    bonusFreispiele: w.bonusFreispiele,
    leiter: [
      { freispiele: w.leiter1, chance: w.gambleChance1Bp / BASISPUNKTE },
      { freispiele: w.leiter2, chance: w.gambleChance2Bp / BASISPUNKTE },
    ].filter((stufe) => stufe.freispiele > 0),
    retriggerSpins: w.retriggerSpins,
    stickyWilds: w.stickyWilds,
    premiumAktiv: w.premiumAktiv,
    maxGewinnMultiplikator: w.maxGewinnMultiplikator,
    autoSpinZahlen: w.autoSpinZahlen,
    schwellen: { gross: w.tierGross, mega: w.tierMega },
    rtp: rtp.rtp,
    grenzen: {
      maxTagesverlust: w.maxTagesverlust,
      maxTagesgewinn: w.maxTagesgewinn,
      maxSpinsJeSitzung: w.maxSpinsJeSitzung,
      sitzungspauseSekunden: w.sitzungspauseSekunden,
    },
    design: {
      hintergrund: w.hintergrundPfad ?? w.hintergrundUrl,
      logo: w.logoPfad ?? w.logoUrl,
      akzentfarbe: w.akzentfarbe,
      overlay: w.overlay,
      glow: w.glow,
      knopfStil: w.knopfStil,
    },
    klaenge: await klaengeDesPakets(w.soundPackId),
  };
}

/**
 * Die Meldungen, die beim Oeffnen noch offen sind.
 *
 * Jede ist `null`, wenn es nichts zu melden gibt - der Normalfall.
 */
export interface SlotMeldungen {
  freispielIntro: FreispielIntro | null;
  bonusIntro: BonusIntro | null;
  freispielEnde: FreispielAbschluss | null;
  bonusEnde: BonusAbschluss | null;
}

/** Der Zustand einer Person. */
export async function spielerAnsicht(
  discordId: string,
  konfiguration?: SlotKonfiguration,
  jetzt = new Date(),
): Promise<SpielerAnsicht> {
  const k = konfiguration ?? (await leseKonfiguration());
  const w = k.wirksam;

  const [profil, frei, bonus, statistik, verlauf, grenzen, meldungen] = await Promise.all([
    prisma.levelProfile.findUnique({ where: { discordId }, select: { xp: true } }),
    offeneFreispiele(discordId, jetzt),
    bonusFuer(discordId, k),
    meineStatistik(discordId, jetzt),
    meinVerlauf(discordId, 15),
    pruefeGrenzen(prisma, discordId, 0, w, jetzt),
    /*
     * Die offenen Meldungen - was der Slot beim Oeffnen zu erzaehlen hat.
     *
     * Alle vier auf einmal geladen, weil die Oberflaeche sie ohnehin
     * priorisiert: eine Meldung zur Zeit, und welche zuerst kommt,
     * entscheidet sie. Hier zu entscheiden hiesse, die Reihenfolge in zwei
     * Schichten zu haben.
     */
    offeneMeldungen(discordId, k),
  ]);

  const spielbareEinsaetze = w.einsaetze.filter((wert) => wert >= w.minEinsatz && wert <= w.maxEinsatz);

  /*
   * Der vorgeschlagene Einsatz.
   *
   * Bei offenen Freispielen der festgelegte - er ist nicht verhandelbar.
   * Sonst der kleinste spielbare: ein Spiel, das mit dem Hoechsteinsatz
   * startet, ist ein Spiel, bei dem der erste Klick teuer ist.
   */
  const einsatz =
    bonus?.stufe === 'SPINS' ? bonus.einsatz : (frei.einsatz ?? spielbareEinsaetze[0] ?? w.minEinsatz);

  return {
    xp: profil?.xp ?? 0,
    einsatz,
    freispieleOffen: frei.anzahl,
    freispielEinsatz: frei.einsatz,
    bonus,
    statistik,
    verlauf,
    gesperrt: grenzen.ok ? null : grenzen.grund,
    meldungen,
  };
}

/**
 * Was dem Spieler noch zu sagen ist.
 *
 * Vier Dinge, jedes hoechstens einmal: ein geschenktes Freispielpaket, ein
 * geschenktes Bonusspiel, der Abschluss eines verbrauchten Pakets und der
 * Abschluss einer Bonusrunde. Alle vier sind **persistent** vermerkt und
 * nicht im Browser - wer das Geschenk auf dem Telefon erfaehrt, soll es am
 * Rechner nicht zweimal erfahren.
 */
async function offeneMeldungen(discordId: string, konfiguration: SlotKonfiguration): Promise<SlotMeldungen> {
  const [freispielIntro, bonusIntro, freispielEnde, bonusEnde] = await Promise.all([
    offeneFreispielMeldung(discordId),
    offeneBonusMeldung(discordId, konfiguration),
    offenerFreispielAbschluss(discordId),
    offenerBonusAbschluss(discordId),
  ]);
  return { freispielIntro, bonusIntro, freispielEnde, bonusEnde };
}
