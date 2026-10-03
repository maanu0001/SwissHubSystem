import { prisma, type XpSlotConfig, type XpSlotEvent, type XpSlotSymbol } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { z } from 'zod';
import { BASISPUNKTE, type SpielSymbol, type Spielregeln } from './regeln';
import { rechneRtp, type BonusAnnahmen, type RtpErgebnis } from './rtp';
import {
  AUTO_SPIN_VORGABEN,
  EINSATZ_VORGABEN,
  KNOPF_STIL_KEYS,
  KONFIG_VORGABEN,
  SYMBOL_VORGABEN,
} from './vorgaben';

const log = createLogger('level:xpslot:konfiguration');

/**
 * Die Konfiguration des Slots - Lesen, Schreiben, Eventmodus.
 *
 * ## Eine Zeile, und sie entsteht beim ersten Hinsehen
 *
 * `sorgeFuerKonfiguration` legt die Zeile und die acht Symbole an, wenn sie
 * fehlen. Kein Seed-Skript, keine Migration mit Daten: eine Migration mit
 * Daten laeuft genau einmal, und wer die Tabelle spaeter leert, hat einen
 * Slot ohne Symbole und keinen Weg zurueck. So entsteht die Grundstellung
 * immer dann, wenn sie gebraucht wird.
 *
 * ## Der Eventmodus ist eine Schicht, keine Kopie
 *
 * Ein Event ueberschreibt Teile der Konfiguration, solange es laeuft. Es
 * aendert dabei **nichts** an `XpSlotConfig` - danach gilt wieder, was dort
 * steht, ohne dass jemand etwas zuruecksetzen muss. Genau das war die
 * Anforderung: «danach automatisch zurueck».
 *
 * Die Ueberschreibungen liegen als JSON in der Eventzeile und gehen beim
 * Speichern **und** beim Lesen durch dasselbe Zod-Schema. Beim Lesen, weil
 * eine Datenbank aelter sein kann als der Code: ein Feld, das es nicht mehr
 * gibt, darf nicht zu einem `undefined` fuehren, das sich als Gewicht
 * ausgibt. Was nicht durchkommt, wird protokolliert und ignoriert - der Slot
 * laeuft dann auf seiner Grundstellung und nicht auf halbgaren Werten.
 */

/** Die vollstaendige, wirksame Konfiguration. */
export interface SlotKonfiguration {
  config: XpSlotConfig;
  symbole: XpSlotSymbol[];
  /** Das laufende Event - oder keines. */
  event: XpSlotEvent | null;
  /** Die wirksamen Werte nach dem Eventmodus. */
  wirksam: WirksameWerte;
  /** Was die Auswertung braucht. */
  regeln: Spielregeln;
  bonus: BonusAnnahmen;
}

/**
 * Die Werte, die nach dem Eventmodus gelten.
 *
 * Bewusst eine eigene Form und nicht die Prisma-Zeile: wer `config.minBet`
 * liest, umgeht den Eventmodus, und das faellt niemandem auf, bis ein Event
 * laeuft. Alles, was ein Event ueberschreiben kann, steht hier.
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
 * Das Schema der Eventueberschreibungen.
 *
 * Eine Teilmenge der Konfiguration. Jedes Feld ist optional - was fehlt,
 * bleibt wie in der Grundstellung. Die Grenzen sind dieselben wie beim
 * Speichern der Konfiguration, damit ein Event nicht einstellen kann, was
 * die Verwaltung nicht einstellen darf.
 */
export const eventUeberschreibungSchema = z
  .object({
    einsaetze: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(12).optional(),
    minEinsatz: z.number().int().min(1).max(1_000_000).optional(),
    maxEinsatz: z.number().int().min(1).max(1_000_000).optional(),
    jackpotMultiplikator: z.number().int().min(1).max(100_000).optional(),
    jackpotNurEcht: z.boolean().optional(),
    wildErsetztAlles: z.boolean().optional(),
    bonusAusloeser: z.number().int().min(2).max(6).optional(),
    bonusFreispiele: z.number().int().min(0).max(100).optional(),
    leiter1: z.number().int().min(0).max(200).optional(),
    leiter2: z.number().int().min(0).max(300).optional(),
    gambleChance1Bp: z.number().int().min(0).max(10_000).optional(),
    gambleChance2Bp: z.number().int().min(0).max(10_000).optional(),
    retriggerSpins: z.number().int().min(0).max(25).optional(),
    stickyWilds: z.boolean().optional(),
    premiumAktiv: z.boolean().optional(),
    maxGewinnMultiplikator: z.number().int().min(0).max(1_000_000).optional(),
    maxTagesverlust: z.number().int().min(0).max(100_000_000).optional(),
    maxTagesgewinn: z.number().int().min(0).max(100_000_000).optional(),
    maxSpinsJeSitzung: z.number().int().min(0).max(100_000).optional(),
    sitzungspauseSekunden: z.number().int().min(0).max(86_400).optional(),
    autoSpinZahlen: z.array(z.number().int().min(1).max(100)).min(1).max(6).optional(),
    tierGross: z.number().int().min(1).max(10_000).optional(),
    tierMega: z.number().int().min(1).max(100_000).optional(),
    hintergrundPfad: z.string().max(200).nullable().optional(),
    hintergrundUrl: z.string().max(1000).nullable().optional(),
    logoPfad: z.string().max(200).nullable().optional(),
    logoUrl: z.string().max(1000).nullable().optional(),
    akzentfarbe: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u, 'Bitte eine Hex-Farbe wie #83060a.')
      .nullable()
      .optional(),
    overlay: z.number().int().min(0).max(100).optional(),
    glow: z.number().int().min(0).max(100).optional(),
    knopfStil: z
      .string()
      .refine((wert) => KNOPF_STIL_KEYS.includes(wert))
      .optional(),
  })
  .strict();

export type EventUeberschreibung = z.infer<typeof eventUeberschreibungSchema>;

/**
 * Abweichende Symbolwerte eines Events.
 *
 * Nur Gewicht, Auszahlung, Bild, Glow und «aktiv» - nicht die Rolle. Ein
 * Event, das aus dem Wild ein Bonussymbol macht, waere ein anderes Spiel und
 * kein Event; und die Auswertung baut auf der Rolle auf.
 */
export const eventSymbolSchema = z.record(
  z
    .object({
      aktiv: z.boolean().optional(),
      gewicht: z.number().int().min(0).max(1000).optional(),
      auszahlung: z
        .tuple([
          z.number().int().min(0).max(10_000_000),
          z.number().int().min(0).max(10_000_000),
          z.number().int().min(0).max(10_000_000),
        ])
        .optional(),
      premiumTage: z
        .tuple([
          z.number().int().min(0).max(365),
          z.number().int().min(0).max(365),
          z.number().int().min(0).max(365),
        ])
        .optional(),
      bildPfad: z.string().max(200).nullable().optional(),
      bildUrl: z.string().max(1000).nullable().optional(),
      glow: z.boolean().optional(),
    })
    .strict(),
);

export type EventSymbolWerte = z.infer<typeof eventSymbolSchema>;

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
}

/** Das Event, das jetzt laeuft - oder keines. */
export async function laufendesEvent(jetzt = new Date()): Promise<XpSlotEvent | null> {
  const kandidaten = await prisma.xpSlotEvent.findMany({ where: { active: true } });
  return (
    kandidaten.find(
      (eintrag) =>
        (!eintrag.startsAt || eintrag.startsAt <= jetzt) && (!eintrag.endsAt || eintrag.endsAt > jetzt),
    ) ?? null
  );
}

/** Die geprueften Ueberschreibungen eines Events. */
export function eventWerte(event: XpSlotEvent | null): EventUeberschreibung {
  if (!event) {
    return {};
  }
  const geprueft = eventUeberschreibungSchema.safeParse(event.overrides ?? {});
  if (!geprueft.success) {
    // Lieber die Grundstellung als halbgare Werte: ein Gewicht aus einem
    // Feld, das das Schema nicht kennt, waere ein Spiel, das niemand
    // eingestellt hat.
    log.warn('Eventueberschreibungen passen nicht zum Schema und werden ignoriert', {
      eventId: event.id,
      fehler: geprueft.error.issues.map((eintrag) => eintrag.path.join('.')),
    });
    return {};
  }
  return geprueft.data;
}

/** Dieselbe Pruefung fuer die Symbolwerte eines Events. */
export function eventSymbole(event: XpSlotEvent | null): EventSymbolWerte {
  if (!event?.symbolOverrides) {
    return {};
  }
  const geprueft = eventSymbolSchema.safeParse(event.symbolOverrides);
  if (!geprueft.success) {
    log.warn('Symbolueberschreibungen eines Events passen nicht zum Schema', { eventId: event.id });
    return {};
  }
  return geprueft.data;
}

/** Die wirksamen Werte: Grundstellung, darueber das Event. */
export function wirksameWerte(config: XpSlotConfig, event: XpSlotEvent | null): WirksameWerte {
  const ueber = eventWerte(event);
  const einsaetze = [...(ueber.einsaetze ?? config.betTiers)].sort((a, b) => a - b);

  return {
    status: config.status,
    einsaetze,
    minEinsatz: ueber.minEinsatz ?? config.minBet,
    maxEinsatz: ueber.maxEinsatz ?? config.maxBet,
    jackpotMultiplikator: ueber.jackpotMultiplikator ?? config.jackpotMultiplier,
    jackpotNurEcht: ueber.jackpotNurEcht ?? config.jackpotPureOnly,
    wildErsetztAlles: ueber.wildErsetztAlles ?? config.wildSubstitutesAll,
    bonusAusloeser: ueber.bonusAusloeser ?? config.bonusTriggerCount,
    bonusFreispiele: ueber.bonusFreispiele ?? config.bonusBaseFreespins,
    leiter1: ueber.leiter1 ?? config.bonusLadder1,
    leiter2: ueber.leiter2 ?? config.bonusLadder2,
    gambleChance1Bp: ueber.gambleChance1Bp ?? config.gambleChance1Bp,
    gambleChance2Bp: ueber.gambleChance2Bp ?? config.gambleChance2Bp,
    retriggerSpins: ueber.retriggerSpins ?? config.retriggerSpins,
    stickyWilds: ueber.stickyWilds ?? config.stickyWilds,
    /*
     * Premium: das Event darf es einschalten, die Grundstellung nicht.
     *
     * So steht es im Konzept - «ohne aktivierte Premium-/Event-Konfiguration
     * deaktiviert». `premiumEnabled` in der Grundstellung bleibt deshalb
     * wirkungslos, solange kein Event laeuft: wer Premium dauerhaft will,
     * legt ein Event ohne Enddatum an und sieht dabei die Quote.
     */
    premiumAktiv: event ? (ueber.premiumAktiv ?? config.premiumEnabled) : false,
    maxGewinnMultiplikator: ueber.maxGewinnMultiplikator ?? config.maxWinMultiplier,
    maxTagesverlust: ueber.maxTagesverlust ?? config.maxDailyLoss,
    maxTagesgewinn: ueber.maxTagesgewinn ?? config.maxDailyWin,
    maxSpinsJeSitzung: ueber.maxSpinsJeSitzung ?? config.maxSpinsPerSession,
    sitzungspauseSekunden: ueber.sitzungspauseSekunden ?? config.sessionCooldownSeconds,
    autoSpinZahlen: [...(ueber.autoSpinZahlen ?? config.autoSpinCounts)].sort((a, b) => a - b),
    tierGross: ueber.tierGross ?? config.tierBigMultiplier,
    tierMega: ueber.tierMega ?? config.tierMegaMultiplier,
    hintergrundPfad: ueber.hintergrundPfad ?? config.backgroundPath,
    hintergrundUrl: ueber.hintergrundUrl ?? config.backgroundUrl,
    logoPfad: ueber.logoPfad ?? config.logoPath,
    logoUrl: ueber.logoUrl ?? config.logoUrl,
    akzentfarbe: ueber.akzentfarbe ?? config.accentColor,
    overlay: ueber.overlay ?? config.overlayOpacity,
    glow: ueber.glow ?? config.glowStrength,
    knopfStil: ueber.knopfStil ?? config.spinButtonStyle,
    soundPackId: event?.soundPackId ?? config.activeSoundPackId,
  };
}

/** Die Symbole nach dem Eventmodus, in Spielform. */
export function spielSymbole(symbole: readonly XpSlotSymbol[], event: XpSlotEvent | null): SpielSymbol[] {
  const ueber = eventSymbole(event);
  return symbole
    .map((symbol) => {
      const e = ueber[symbol.key] ?? {};
      const aktiv = e.aktiv ?? symbol.active;
      return {
        key: symbol.key,
        rolle: symbol.role,
        // Ein abgeschaltetes Symbol hat Gewicht 0 - es liegt nicht auf den
        // Walzen. Die Auswertung braucht es trotzdem in der Liste, damit ein
        // altes Ergebnis in der Historie weiterhin lesbar bleibt.
        gewicht: aktiv ? (e.gewicht ?? symbol.weight) : 0,
        auszahlung: (e.auszahlung ?? [symbol.payout3Bp, symbol.payout4Bp, symbol.payout5Bp]) as [
          number,
          number,
          number,
        ],
        premiumTage: (e.premiumTage ?? [symbol.premiumDays3, symbol.premiumDays4, symbol.premiumDays5]) as [
          number,
          number,
          number,
        ],
      } satisfies SpielSymbol;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Die Regeln, mit denen gespielt wird. */
export function spielregeln(
  symbole: readonly XpSlotSymbol[],
  wirksam: WirksameWerte,
  event: XpSlotEvent | null,
): Spielregeln {
  return {
    symbole: spielSymbole(symbole, event),
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
export async function leseKonfiguration(jetzt = new Date()): Promise<SlotKonfiguration> {
  await sorgeFuerKonfiguration();
  const [config, symbole, event] = await Promise.all([
    prisma.xpSlotConfig.findUniqueOrThrow({ where: { id: 'default' } }),
    prisma.xpSlotSymbol.findMany({ orderBy: { order: 'asc' } }),
    laufendesEvent(jetzt),
  ]);

  const wirksam = wirksameWerte(config, event);
  return {
    config,
    symbole,
    event,
    wirksam,
    regeln: spielregeln(symbole, wirksam, event),
    bonus: bonusAnnahmen(wirksam),
  };
}

/** Die Quote dieser Konfiguration. */
export function rtpVon(konfiguration: Pick<SlotKonfiguration, 'regeln' | 'bonus'>): RtpErgebnis {
  return rechneRtp(konfiguration.regeln, konfiguration.bonus);
}

/** Laesst sich gerade spielen? */
export function istSpielbar(konfiguration: SlotKonfiguration): {
  ok: boolean;
  grund: string | null;
} {
  const { status } = konfiguration.wirksam;
  if (status === 'DISABLED') {
    return { ok: false, grund: 'Der XP-Slot ist abgeschaltet.' };
  }
  if (status === 'MAINTENANCE') {
    return {
      ok: false,
      grund: konfiguration.config.maintenanceNote ?? 'Der XP-Slot ist gerade in Wartung.',
    };
  }
  if (status === 'EVENT_ONLY' && !konfiguration.event) {
    return {
      ok: false,
      grund: 'Der XP-Slot läuft derzeit nur während eines Events. Gerade läuft keines.',
    };
  }
  if (konfiguration.regeln.symbole.every((symbol) => symbol.gewicht === 0)) {
    return { ok: false, grund: 'Der XP-Slot ist nicht spielbar: kein Symbol hat ein Gewicht.' };
  }
  return { ok: true, grund: null };
}
