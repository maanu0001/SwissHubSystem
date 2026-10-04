import { prisma, type XpSlotConfig, type XpSlotSymbol } from '@swisshub/database';
import { BASISPUNKTE, type SpielSymbol, type Spielregeln } from './regeln';
import { rechneRtp, type BonusAnnahmen, type RtpErgebnis } from './rtp';
import { AUTO_SPIN_VORGABEN, EINSATZ_VORGABEN, KONFIG_VORGABEN, SYMBOL_VORGABEN } from './vorgaben';

/**
 * Die Konfiguration des Slots - Lesen und Schreiben.
 *
 * ## Eine Zeile, und sie entsteht beim ersten Hinsehen
 *
 * `sorgeFuerKonfiguration` legt die Zeile und die acht Symbole an, wenn sie
 * fehlen. Kein Seed-Skript, keine Migration mit Daten: eine Migration mit
 * Daten laeuft genau einmal, und wer die Tabelle spaeter leert, hat einen
 * Slot ohne Symbole und keinen Weg zurueck. So entsteht die Grundstellung
 * immer dann, wenn sie gebraucht wird.
 *
 * ## Es gibt nur eine Wahrheit, und sie steht in `XpSlotConfig`
 *
 * Hier lag einmal ein Eventmodus: eine zweite Tabelle mit JSON-Feldern, die
 * Teile dieser Konfiguration ueberschrieb, solange ein Event lief. Er ist
 * weg, und das ist eine Vereinfachung mit Folgen in alle Richtungen - jede
 * Zahl, die das Dashboard zeigt, ist jetzt auch die, mit der gespielt wird.
 * Vorher musste man wissen, ob gerade ein Event laeuft, um eine Auszahlung
 * richtig zu lesen.
 *
 * `wirksameWerte` bleibt trotzdem bestehen: sie ist die Stelle, die aus den
 * englischen Spaltennamen der Datenbank die deutschen Begriffe des Spiels
 * macht, und sie ist der einzige Weg zu diesen Werten. Wer `config.minBet`
 * direkt liest, umgeht eine Umrechnung, die es vielleicht einmal wieder gibt.
 */

/** Die vollstaendige, wirksame Konfiguration. */
export interface SlotKonfiguration {
  config: XpSlotConfig;
  symbole: XpSlotSymbol[];
  /** Die wirksamen Werte des Spiels. */
  wirksam: WirksameWerte;
  /** Was die Auswertung braucht. */
  regeln: Spielregeln;
  bonus: BonusAnnahmen;
}

/**
 * Die Werte, mit denen gespielt wird.
 *
 * Bewusst eine eigene Form und nicht die Prisma-Zeile: hier stehen die
 * Begriffe des Spiels, dort die Spaltennamen der Datenbank. Alles, was eine
 * Regel beeinflusst, steht hier - und nur hier wird umgerechnet.
 */
export interface WirksameWerte {
  status: XpSlotConfig['status'];
  einsaetze: number[];
  minEinsatz: number;
  maxEinsatz: number;
  jackpotMultiplikator: number;
  jackpotNurEcht: boolean;
  wildErsetztAlles: boolean;
  bonusAusloeser: number;
  bonusFreispiele: number;
  leiter1: number;
  leiter2: number;
  gambleChance1Bp: number;
  gambleChance2Bp: number;
  retriggerSpins: number;
  stickyWilds: boolean;
  premiumAktiv: boolean;
  maxGewinnMultiplikator: number;
  maxTagesverlust: number;
  maxTagesgewinn: number;
  maxSpinsJeSitzung: number;
  sitzungspauseSekunden: number;
  autoSpinZahlen: number[];
  tierGross: number;
  tierMega: number;
  hintergrundPfad: string | null;
  hintergrundUrl: string | null;
  logoPfad: string | null;
  logoUrl: string | null;
  akzentfarbe: string | null;
  overlay: number;
  glow: number;
  knopfStil: string;
  soundPackId: string | null;
}

/**
 * Legt die Grundstellung an, falls sie fehlt.
 *
 * Idempotent: zwei gleichzeitige Aufrufe erzeugen keine zweite Zeile, weil
 * `id` fest `default` ist und `key` je Symbol eindeutig. Der zweite Aufruf
 * laeuft in `upsert` und aendert nichts.
 */
export async function sorgeFuerKonfiguration(): Promise<void> {
  await prisma.xpSlotConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      status: 'DISABLED',
      betTiers: [...EINSATZ_VORGABEN],
      minBet: EINSATZ_VORGABEN[0] ?? 10,
      maxBet: EINSATZ_VORGABEN[EINSATZ_VORGABEN.length - 1] ?? 500,
      jackpotMultiplier: KONFIG_VORGABEN.jackpotMultiplikator,
      jackpotPureOnly: KONFIG_VORGABEN.jackpotNurEcht,
      wildSubstitutesAll: KONFIG_VORGABEN.wildErsetztAlles,
      bonusTriggerCount: KONFIG_VORGABEN.bonusAusloeser,
      bonusBaseFreespins: KONFIG_VORGABEN.bonusFreispiele,
      bonusLadder1: KONFIG_VORGABEN.leiter1,
      bonusLadder2: KONFIG_VORGABEN.leiter2,
      gambleChance1Bp: KONFIG_VORGABEN.gambleChance1Bp,
      gambleChance2Bp: KONFIG_VORGABEN.gambleChance2Bp,
      retriggerSpins: KONFIG_VORGABEN.retriggerSpins,
      stickyWilds: KONFIG_VORGABEN.stickyWilds,
      premiumEnabled: false,
      maxWinMultiplier: KONFIG_VORGABEN.maxGewinnMultiplikator,
      autoSpinCounts: [...AUTO_SPIN_VORGABEN],
      tierBigMultiplier: KONFIG_VORGABEN.tierGross,
      tierMegaMultiplier: KONFIG_VORGABEN.tierMega,
    },
  });

  for (const [index, vorgabe] of SYMBOL_VORGABEN.entries()) {
    await prisma.xpSlotSymbol.upsert({
      where: { key: vorgabe.key },
      update: {},
      create: {
        key: vorgabe.key,
        name: vorgabe.name,
        role: vorgabe.rolle,
        active: true,
        weight: vorgabe.gewicht,
        order: index,
        glow: vorgabe.glow,
        payout3Bp: vorgabe.auszahlung[0],
        payout4Bp: vorgabe.auszahlung[1],
        payout5Bp: vorgabe.auszahlung[2],
        premiumDays3: vorgabe.premiumTage[0],
        premiumDays4: vorgabe.premiumTage[1],
        premiumDays5: vorgabe.premiumTage[2],
      },
    });
  }

  /*
   * Ein Sound-Paket, das es immer gibt.
   *
   * Gespielt wird auch ohne eines: fehlt einem Slot die Datei, nimmt die
   * Oberflaeche den mitgelieferten Klang. In der Verwaltung aber haengen die
   * Klangzeilen an einem Paket - ohne Paket saehe das Team eine leere Seite
   * und wuesste nicht, dass der Slot klingt. Deshalb steht hier ein leeres
   * Paket: es enthaelt keine einzige Datei und ist genau deshalb der
   * Standardsatz.
   *
   * Nur, wenn es ueberhaupt keines gibt. Wer eigene Pakete angelegt hat,
   * bekommt kein neuntes dazu.
   */
  const paketeVorhanden = await prisma.xpSlotSoundPack.count();
  if (paketeVorhanden === 0) {
    const paket = await prisma.xpSlotSoundPack.create({
      data: { name: 'Standard', kind: 'STANDARD' },
    });
    await prisma.xpSlotConfig.update({
      where: { id: 'default' },
      data: { activeSoundPackId: paket.id },
    });
  }
}

/** Die wirksamen Werte aus der Grundstellung. */
export function wirksameWerte(config: XpSlotConfig): WirksameWerte {
  return {
    status: config.status,
    einsaetze: [...config.betTiers].sort((a, b) => a - b),
    minEinsatz: config.minBet,
    maxEinsatz: config.maxBet,
    jackpotMultiplikator: config.jackpotMultiplier,
    jackpotNurEcht: config.jackpotPureOnly,
    wildErsetztAlles: config.wildSubstitutesAll,
    bonusAusloeser: config.bonusTriggerCount,
    bonusFreispiele: config.bonusBaseFreespins,
    leiter1: config.bonusLadder1,
    leiter2: config.bonusLadder2,
    gambleChance1Bp: config.gambleChance1Bp,
    gambleChance2Bp: config.gambleChance2Bp,
    retriggerSpins: config.retriggerSpins,
    stickyWilds: config.stickyWilds,
    /*
     * Premium haengt an einem Schalter, und zwar an diesem.
     *
     * Vorher war Premium an den Eventmodus gebunden: `premiumEnabled` in der
     * Grundstellung war wirkungslos, solange kein Event lief. Das war ein
     * Schalter, der nichts tat - niemand konnte sehen, warum. Jetzt gilt er.
     */
    premiumAktiv: config.premiumEnabled,
    maxGewinnMultiplikator: config.maxWinMultiplier,
    maxTagesverlust: config.maxDailyLoss,
    maxTagesgewinn: config.maxDailyWin,
    maxSpinsJeSitzung: config.maxSpinsPerSession,
    sitzungspauseSekunden: config.sessionCooldownSeconds,
    autoSpinZahlen: [...config.autoSpinCounts].sort((a, b) => a - b),
    tierGross: config.tierBigMultiplier,
    tierMega: config.tierMegaMultiplier,
    hintergrundPfad: config.backgroundPath,
    hintergrundUrl: config.backgroundUrl,
    logoPfad: config.logoPath,
    logoUrl: config.logoUrl,
    akzentfarbe: config.accentColor,
    overlay: config.overlayOpacity,
    glow: config.glowStrength,
    knopfStil: config.spinButtonStyle,
    soundPackId: config.activeSoundPackId,
  };
}

/** Die Symbole in Spielform. */
export function spielSymbole(symbole: readonly XpSlotSymbol[]): SpielSymbol[] {
  return symbole
    .map(
      (symbol) =>
        ({
          key: symbol.key,
          rolle: symbol.role,
          // Ein abgeschaltetes Symbol hat Gewicht 0 - es liegt nicht auf den
          // Walzen. Die Auswertung braucht es trotzdem in der Liste, damit ein
          // altes Ergebnis in der Historie weiterhin lesbar bleibt.
          gewicht: symbol.active ? symbol.weight : 0,
          auszahlung: [symbol.payout3Bp, symbol.payout4Bp, symbol.payout5Bp] as [number, number, number],
          premiumTage: [symbol.premiumDays3, symbol.premiumDays4, symbol.premiumDays5] as [
            number,
            number,
            number,
          ],
        }) satisfies SpielSymbol,
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Die Regeln, mit denen gespielt wird. */
export function spielregeln(symbole: readonly XpSlotSymbol[], wirksam: WirksameWerte): Spielregeln {
  return {
    symbole: spielSymbole(symbole),
    jackpotMultiplikator: wirksam.jackpotMultiplikator,
    jackpotNurEcht: wirksam.jackpotNurEcht,
    wildErsetztAlles: wirksam.wildErsetztAlles,
    bonusAusloeser: wirksam.bonusAusloeser,
    maxGewinnMultiplikator: wirksam.maxGewinnMultiplikator,
    premiumAktiv: wirksam.premiumAktiv,
  };
}

/** Die Bonusannahmen der RTP-Rechnung aus den wirksamen Werten. */
export function bonusAnnahmen(wirksam: WirksameWerte): BonusAnnahmen {
  return {
    freispiele: wirksam.bonusFreispiele,
    leiter1: wirksam.leiter1,
    leiter2: wirksam.leiter2,
    chance1: wirksam.gambleChance1Bp / BASISPUNKTE,
    chance2: wirksam.gambleChance2Bp / BASISPUNKTE,
    retriggerSpins: wirksam.retriggerSpins,
    stickyWilds: wirksam.stickyWilds,
  };
}

/**
 * Die vollstaendige Konfiguration.
 *
 * Eine Abfrage je Tabelle, kein Nachladen in Schleifen - diese Funktion
 * laeuft bei jedem Spin.
 */
export async function leseKonfiguration(): Promise<SlotKonfiguration> {
  await sorgeFuerKonfiguration();
  const [config, symbole] = await Promise.all([
    prisma.xpSlotConfig.findUniqueOrThrow({ where: { id: 'default' } }),
    prisma.xpSlotSymbol.findMany({ orderBy: { order: 'asc' } }),
  ]);

  const wirksam = wirksameWerte(config);
  return {
    config,
    symbole,
    wirksam,
    regeln: spielregeln(symbole, wirksam),
    bonus: bonusAnnahmen(wirksam),
  };
}

/** Die Quote dieser Konfiguration. */
export function rtpVon(konfiguration: Pick<SlotKonfiguration, 'regeln' | 'bonus'>): RtpErgebnis {
  return rechneRtp(konfiguration.regeln, konfiguration.bonus);
}

/** Laesst sich gerade spielen? */
export interface Spielzustand {
  ok: boolean;
  /** Warum nicht - unveraendert anzeigbar. */
  grund: string | null;
  /**
   * Steht der Slot in Wartung?
   *
   * Getrennt von `ok`, weil beides zusammen vorkommt: fuer die Verwaltung ist
   * er spielbar **und** in Wartung. Die Oberflaeche sagt das dann auch - ein
   * versteckter Wartungsmodus waere eine Verwaltung, die nicht weiss, dass
   * die Mitglieder gerade ausgesperrt sind.
   */
  wartung: boolean;
}

export function istSpielbar(konfiguration: SlotKonfiguration, darfVerwalten = false): Spielzustand {
  const { status } = konfiguration.wirksam;
  if (konfiguration.regeln.symbole.every((symbol) => symbol.gewicht === 0)) {
    /*
     * Diese Pruefung steht **vor** allen anderen und gilt auch fuer die
     * Verwaltung: ein Spielfeld ohne ziehbares Symbol laesst sich nicht
     * ziehen - das ist keine Frage der Berechtigung, sondern der Mathematik.
     */
    return {
      ok: false,
      grund: 'Der XP-Slot ist nicht spielbar: kein Symbol hat ein Gewicht.',
      wartung: false,
    };
  }
  if (status === 'DISABLED') {
    return { ok: false, grund: 'Der XP-Slot ist abgeschaltet.', wartung: false };
  }
  if (status === 'MAINTENANCE') {
    /*
     * Der Wartungsmodus sperrt die Mitglieder und laesst die Verwaltung
     * spielen.
     *
     * Dafuer ist er da: etwas pruefen, waehrend niemand sonst spielt. Vorher
     * sperrte er alle - also auch die Person, die gerade eine Aenderung
     * kontrollieren wollte. Wer pruefen wollte, musste den Slot fuer alle
     * aufmachen, und genau in diesem Moment waren die Walzen offen.
     *
     * `darfVerwalten` kommt von der Aufrufstelle und damit aus der
     * Berechtigungsengine - hier steht keine Rolle und keine Kennung.
     */
    if (darfVerwalten) {
      return {
        ok: true,
        grund: null,
        wartung: true,
      };
    }
    return {
      ok: false,
      grund: konfiguration.config.maintenanceNote ?? 'Der XP-Slot ist gerade in Wartung.',
      wartung: true,
    };
  }
  return { ok: true, grund: null, wartung: false };
}
