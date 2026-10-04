import {
  prisma,
  type Prisma,
  type XpSlotBonusRound,
  type XpSlotSpin,
  type XpSlotSpinKind,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict } from '@swisshub/shared';
import { secureRandom, type RandomSource } from '../../zufall';
import { applyXpWithin, sperreProfil, type LevelIdentity } from '../service';
import { gewinnstufe, werteAus, type Auswertung, type Gewinnstufe } from './auswertung';
import { leseKonfiguration, istSpielbar, type SlotKonfiguration } from './konfiguration';
import { pruefeGrenzen, schreibeStand, type GrenzStand } from './limits';
import { naechstesPaket, verbraucheFreispiel } from './freispiele';
import { dreheWalzen, ZELLEN } from './regeln';

const log = createLogger('level:xpslot:spin');

/**
 * Ein Spin - von der Anfrage bis zur Buchung.
 *
 * ## Die Reihenfolge, und warum sie unverrueckbar ist
 *
 * 1. Person und Sitzung pruefen (macht der Aufrufer ueber die Berechtigung)
 * 2. Konfiguration lesen, Spielbarkeit pruefen
 * 3. Spielart bestimmen: Bonusrunde, Freispielpaket oder bezahlt
 * 4. Einsatz pruefen - **nur** gegen die eingestellten Einsaetze
 * 5. Grenzen pruefen
 * 6. Transaktion: Profil sperren, XP pruefen, abbuchen oder Freispiel
 *    verbrauchen, Walzen drehen, auswerten, Gewinn gutschreiben, Spin
 *    schreiben, Stand fortschreiben
 * 7. Nach der Transaktion: Premium gutschreiben, Feed melden
 *
 * Schritt 6 ist **eine** Transaktion. Das ist der ganze Punkt: es darf keinen
 * Zustand geben, in dem der Einsatz abgebucht und der Spin nicht gespeichert
 * ist, und keinen, in dem ein Gewinn gespeichert und nicht gutgeschrieben
 * ist. Die Zeilensperre auf dem Profil (`sperreProfil`) macht dabei aus der
 * Pruefung «hat genug XP» eine Zusage und nicht eine Momentaufnahme.
 *
 * ## Der zweite Klick
 *
 * Jede Anfrage bringt einen Schluessel mit, den der Browser erzeugt. Kommt er
 * zweimal an - Doppelklick, Wiederholung nach einem Verbindungsabbruch, zwei
 * offene Tabs -, wird **nicht** ein zweites Mal gedreht, sondern der erste
 * Spin zurueckgegeben. Dafuer sorgt der eindeutige Index auf
 * `XpSlotSpin.idempotencyKey`, nicht eine Pruefung davor: eine Pruefung
 * davor hat ein Zeitfenster, ein Index hat keines.
 *
 * ## Warum der Zufall hereingegeben wird
 *
 * `secureRandom` im Betrieb, eine nachrechenbare Quelle im Test. Ohne diese
 * Moeglichkeit waeren Tests ueber Jackpot, Bonus und Linien entweder
 * gelegentlich fehlschlagend oder gar nicht vorhanden. `Math.random` kommt
 * nirgends vor.
 */

/** Was die Oberflaeche nach einem Spin braucht. */
export interface SpinErgebnis {
  spinId: string;
  /** Hat dieser Aufruf gedreht, oder war es die Wiederholung? */
  wiederholung: boolean;
  art: XpSlotSpinKind;
  einsatz: number;
  grid: string[];
  treffer: Auswertung['treffer'];
  gewinn: number;
  /** Netto fuer die Person: Gewinn minus Einsatz. */
  netto: number;
  gedeckelt: boolean;
  stufe: Gewinnstufe;
  jackpot: boolean;
  premiumTage: number;
  bonusZellen: number[];
  bonusSymbole: number;
  bonusAusgeloest: boolean;
  /** Ab welcher Walze der Bonus noch offen war - Grundlage des Sweat. */
  sweatAbWalze: number | null;
  xpVorher: number;
  xpNachher: number;
  /** Die laufende Bonusrunde, falls es eine gibt. */
  bonus: BonusStand | null;
  /** Offene Freispiele nach diesem Spin. */
  freispieleOffen: number;
  freispielEinsatz: number | null;
  stand: GrenzStand;
}

/** Der Zustand einer Bonusrunde fuer die Oberflaeche. */
export interface BonusStand {
  id: string;
  stufe: XpSlotBonusRound['stage'];
  einsatz: number;
  zugesagt: number;
  offen: number;
  gespielt: number;
  retriggers: number;
  gewinn: number;
  stickyZellen: number[];
  /** Was auf dieser Leiterstufe zur Wahl steht. */
  wahl: { nehmen: number; riskierenAuf: number; chanceBp: number } | null;
}

export interface SpinEingabe extends LevelIdentity {
  /** Der gewuenschte Einsatz. Bei Freispielen ohne Wirkung. */
  einsatz: number;
  /** Der Schluessel gegen den zweiten Klick. */
  schluessel: string;
  /**
   * Darf diese Person den Slot verwalten?
   *
   * Nur fuer einen Zweck: im Wartungsmodus spielt die Verwaltung weiter,
   * waehrend die Mitglieder gesperrt sind. Der Wert kommt aus der
   * Berechtigungsengine der Aufrufstelle; hier steht keine Rolle und keine
   * Kennung, und die Vorgabe ist `false` - wer nichts mitgibt, ist Mitglied.
   */
  darfVerwalten?: boolean;
  /** Nur fuer Tests und den Testmodus. */
  random?: RandomSource;
  jetzt?: Date;
}

export function bonusStand(runde: XpSlotBonusRound, konfiguration: SlotKonfiguration): BonusStand {
  const w = konfiguration.wirksam;
  const wahl =
    runde.stage === 'LADDER_1'
      ? { nehmen: w.bonusFreispiele, riskierenAuf: w.leiter1, chanceBp: w.gambleChance1Bp }
      : runde.stage === 'LADDER_2'
        ? { nehmen: w.leiter1, riskierenAuf: w.leiter2, chanceBp: w.gambleChance2Bp }
        : null;

  return {
    id: runde.id,
    stufe: runde.stage,
    einsatz: runde.bet,
    zugesagt: runde.awarded,
    offen: runde.remaining,
    gespielt: runde.played,
    retriggers: runde.retriggers,
    gewinn: runde.totalWin,
    stickyZellen: runde.stickyCells,
    wahl,
  };
}

/** Die offene Bonusrunde einer Person - oder keine. */
export async function offeneBonusrunde(
  discordId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<XpSlotBonusRound | null> {
  return tx.xpSlotBonusRound.findFirst({
    where: { discordId, stage: { in: ['LADDER_1', 'LADDER_2', 'SPINS'] } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Dreht einmal.
 *
 * Wirft `conflict`, wenn nicht gespielt werden darf - mit einem Grund, den
 * die Oberflaeche unveraendert anzeigen kann.
 */
export async function dreheSpin(eingabe: SpinEingabe): Promise<SpinErgebnis> {
  const jetzt = eingabe.jetzt ?? new Date();
  const random = eingabe.random ?? secureRandom;
  const konfiguration = await leseKonfiguration();

  const spielbar = istSpielbar(konfiguration, eingabe.darfVerwalten ?? false);
  if (!spielbar.ok) {
    throw conflict(spielbar.grund ?? 'Der XP-Slot ist gerade nicht spielbar.');
  }
  if (!eingabe.schluessel || eingabe.schluessel.length < 8) {
    throw conflict('Diesem Spin fehlt der Schlüssel gegen Doppelklicks.');
  }

  /*
   * Die Wiederholung zuerst, und zwar ausserhalb der Transaktion.
   *
   * Der haeufigste Fall eines zweiten Aufrufs ist der Doppelklick, und er
   * soll nicht eine Transaktion samt Zeilensperre kosten. Die Sicherheit
   * liegt trotzdem im Index: wenn zwei Aufrufe gleichzeitig hier
   * durchkommen, scheitert der zweite beim Schreiben und wird unten
   * abgefangen.
   *
   * **Und der Schluessel muss der eigene sein.** Der Index ist global, der
   * Schluessel kommt vom Browser - ohne diese Pruefung bekaeme jemand, der
   * einen fremden Schluessel errät, das Ergebnis einer fremden Person
   * zurueck: Spielfeld, Gewinn und XP-Stand. Dass ein zufaelliger Schluessel
   * praktisch nie kollidiert, ist kein Schutz, sondern eine
   * Wahrscheinlichkeitsrechnung; der Schutz ist diese Zeile.
   */
  const bekannt = await prisma.xpSlotSpin.findUnique({
    where: { idempotencyKey: eingabe.schluessel },
  });
  if (bekannt) {
    gehoertMir(bekannt, eingabe.discordId);
    return nachbereitetesErgebnis(bekannt, konfiguration, jetzt, true);
  }

  try {
    const ergebnis = await prisma.$transaction((tx) =>
      spinInTransaktion(tx, eingabe, konfiguration, random, jetzt),
    );
    await nachDemSpin(ergebnis.spin, konfiguration);
    return ergebnis.ausgabe;
  } catch (error) {
    // Der eindeutige Index hat zugeschlagen: ein zweiter Aufruf mit demselben
    // Schluessel lief parallel. Dann gilt das Ergebnis des ersten.
    if (istDoppelschluessel(error)) {
      const erster = await prisma.xpSlotSpin.findUnique({
        where: { idempotencyKey: eingabe.schluessel },
      });
      if (erster) {
        gehoertMir(erster, eingabe.discordId);
        return nachbereitetesErgebnis(erster, konfiguration, jetzt, true);
      }
    }
    throw error;
  }
}

/**
 * Gehoert dieser Spin der anfragenden Person?
 *
 * Wenn nicht, gibt es keine Auskunft darueber, wem er gehoert - und auch
 * keine darueber, dass es ihn gibt. Die Meldung sagt nur, dass dieser
 * Schluessel nicht taugt.
 */
function gehoertMir(spin: XpSlotSpin, discordId: string): void {
  if (spin.discordId !== discordId) {
    throw conflict('Dieser Spin-Schlüssel ist belegt. Bitte noch einmal drehen.');
  }
}

function istDoppelschluessel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002' &&
    JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('idempotencyKey')
  );
}

async function spinInTransaktion(
  tx: Prisma.TransactionClient,
  eingabe: SpinEingabe,
  konfiguration: SlotKonfiguration,
  random: RandomSource,
  jetzt: Date,
): Promise<{ spin: XpSlotSpin; ausgabe: SpinErgebnis }> {
  const w = konfiguration.wirksam;
  const identity: LevelIdentity = {
    discordId: eingabe.discordId,
    username: eingabe.username ?? null,
    displayName: eingabe.displayName ?? null,
    avatarHash: eingabe.avatarHash ?? null,
  };

  // Die Sperre zuerst. Alles danach - Pruefung, Abbuchung, Gutschrift - sieht
  // einen Stand, den in dieser Transaktion niemand sonst veraendert.
  const profil = await sperreProfil(tx, identity);

  const runde = await offeneBonusrunde(eingabe.discordId, tx);
  if (runde && (runde.stage === 'LADDER_1' || runde.stage === 'LADDER_2')) {
    throw conflict('Entscheide zuerst über deine Bonusrunde: Freispiele nehmen oder riskieren.');
  }

  // --- Spielart und Einsatz ------------------------------------------------
  let art: XpSlotSpinKind = 'PAID';
  let einsatz = Math.trunc(eingabe.einsatz);
  let paket: Awaited<ReturnType<typeof naechstesPaket>> = null;

  if (runde && runde.stage === 'SPINS' && runde.remaining > 0) {
    art = 'BONUS_ROUND';
    einsatz = runde.bet;
  } else {
    paket = await naechstesPaket(tx, eingabe.discordId, jetzt);
    if (paket) {
      art = 'FREESPIN_PACKAGE';
      einsatz = paket.bet;
    } else {
      /*
       * Nur die eingestellten Einsaetze sind spielbar - und es wird nie
       * stillschweigend abgewertet.
       *
       * Ein Browser, der 37 XP schickt, bekommt eine Absage und nicht den
       * naechstkleineren Einsatz: wer 500 wollte und 100 gespielt haette,
       * haette ein anderes Spiel gespielt als das gewollte.
       */
      if (!w.einsaetze.includes(einsatz)) {
        throw conflict(`Dieser Einsatz ist nicht spielbar. Möglich sind: ${w.einsaetze.join(', ')} XP.`);
      }
      if (einsatz < w.minEinsatz || einsatz > w.maxEinsatz) {
        throw conflict(`Der Einsatz muss zwischen ${w.minEinsatz} und ${w.maxEinsatz} XP liegen.`);
      }
      if (profil.xp < einsatz) {
        throw conflict('Nicht genügend XP für diesen Einsatz.');
      }
    }
  }

  // --- Grenzen -------------------------------------------------------------
  const grenzen = await pruefeGrenzen(tx, eingabe.discordId, art === 'PAID' ? einsatz : 0, w, jetzt);
  if (!grenzen.ok) {
    throw conflict(grenzen.grund ?? 'Für heute ist Schluss.');
  }

  // --- Abbuchen oder Freispiel verbrauchen --------------------------------
  let xpVorher = profil.xp;
  if (art === 'PAID') {
    const abbuchung = await applyXpWithin(tx, {
      ...identity,
      delta: -einsatz,
      source: 'SLOT_STAKE',
      reason: 'XP-Slot: Einsatz',
      idempotencyKey: `slot:${eingabe.schluessel}:einsatz`,
    });
    xpVorher = abbuchung.xpBefore;
    /*
     * Die Klemmung auf `MAX(0, ...)` haette weniger abgebucht, als gesetzt
     * wurde. Nach der Zeilensperre kann das nicht mehr passieren - wir
     * pruefen es trotzdem, weil ein Spin auf Kredit der eine Fehler ist, der
     * sich nicht zurueckdrehen laesst.
     */
    if (-abbuchung.delta !== einsatz) {
      throw conflict('Nicht genügend XP für diesen Einsatz.');
    }
  } else if (art === 'FREESPIN_PACKAGE' && paket) {
    await verbraucheFreispiel(tx, paket);
  } else if (art === 'BONUS_ROUND' && runde) {
    await tx.xpSlotBonusRound.update({
      where: { id: runde.id },
      data: { remaining: { decrement: 1 }, played: { increment: 1 } },
    });
  }

  // --- Walzen und Auswertung ----------------------------------------------
  const sticky = art === 'BONUS_ROUND' && runde && w.stickyWilds ? runde.stickyCells : [];
  const grid = dreheWalzen(konfiguration.regeln, random, sticky);
  const auswertung = werteAus(grid, konfiguration.regeln, einsatz);

  // --- Gewinn gutschreiben -------------------------------------------------
  let xpNachher = xpVorher - (art === 'PAID' ? einsatz : 0);
  if (auswertung.gewinn > 0) {
    const gutschrift = await applyXpWithin(tx, {
      ...identity,
      delta: auswertung.gewinn,
      source: 'SLOT_WIN',
      reason: auswertung.jackpot ? 'XP-Slot: Jackpot' : 'XP-Slot: Gewinn',
      idempotencyKey: `slot:${eingabe.schluessel}:gewinn`,
    });
    xpNachher = gutschrift.xpAfter;
  }

  // --- Spin schreiben ------------------------------------------------------
  const spin = await tx.xpSlotSpin.create({
    data: {
      discordId: eingabe.discordId,
      kind: art,
      bet: einsatz,
      grid,
      lines: auswertung.treffer as unknown as Prisma.InputJsonValue,
      grossWin: auswertung.gewinn,
      netWin: auswertung.gewinn - (art === 'PAID' ? einsatz : 0),
      capped: auswertung.gedeckelt,
      jackpot: auswertung.jackpot,
      bonusTrigger: auswertung.bonusAusgeloest,
      premiumDays: auswertung.premiumTage,
      xpBefore: xpVorher,
      xpAfter: xpNachher,
      configNote: spielnotiz(konfiguration),
      freespinPackageId: paket?.id ?? null,
      bonusRoundId: art === 'BONUS_ROUND' && runde ? runde.id : null,
      idempotencyKey: eingabe.schluessel,
    },
  });

  // --- Bonusrunde fortschreiben -------------------------------------------
  let laufende = runde;
  if (art === 'BONUS_ROUND' && runde) {
    laufende = await schreibeBonusrundeFort(tx, runde, grid, auswertung, konfiguration, jetzt);
  } else if (auswertung.bonusAusgeloest) {
    laufende = await tx.xpSlotBonusRound.create({
      data: {
        discordId: eingabe.discordId,
        triggerSpinId: spin.id,
        stage: 'LADDER_1',
        bet: einsatz,
        awarded: 0,
        remaining: 0,
        stickyCells: [],
      },
    });
  }

  // --- Stand fortschreiben -------------------------------------------------
  await schreibeStand(
    tx,
    eingabe.discordId,
    art === 'PAID' ? einsatz : 0,
    auswertung.gewinn,
    jetzt,
    grenzen.stand.spinsInSitzung === 0,
  );

  const offen = await offeneFreispieleIn(tx, eingabe.discordId, jetzt);

  return {
    spin,
    ausgabe: {
      spinId: spin.id,
      wiederholung: false,
      art,
      einsatz,
      grid,
      treffer: auswertung.treffer,
      gewinn: auswertung.gewinn,
      netto: auswertung.gewinn - (art === 'PAID' ? einsatz : 0),
      gedeckelt: auswertung.gedeckelt,
      stufe: gewinnstufe(
        auswertung.gewinn,
        einsatz,
        { gross: w.tierGross, mega: w.tierMega },
        auswertung.jackpot,
      ),
      jackpot: auswertung.jackpot,
      premiumTage: auswertung.premiumTage,
      bonusZellen: auswertung.bonusZellen,
      bonusSymbole: auswertung.bonusSymbole,
      bonusAusgeloest: auswertung.bonusAusgeloest,
      sweatAbWalze: auswertung.sweatAbWalze,
      xpVorher,
      xpNachher,
      bonus: laufende ? bonusStand(laufende, konfiguration) : null,
      freispieleOffen: offen.anzahl,
      freispielEinsatz: offen.einsatz,
      stand: grenzen.stand,
    },
  };
}

/**
 * Was vom Spin an Konfiguration mitkommt.
 *
 * Bewusst klein: die Werte, die das Ergebnis bestimmt haben, und nicht die
 * ganze Konfiguration. Bei zehntausend Spins waeren zehntausend Kopien
 * derselben Tabelle ein Vielfaches der Nutzdaten - und niemand liest sie.
 * Was hier steht, genuegt, um einen alten Gewinn nachzurechnen.
 */
function spielnotiz(konfiguration: SlotKonfiguration): Prisma.InputJsonValue {
  const w = konfiguration.wirksam;
  return {
    jackpotMultiplikator: w.jackpotMultiplikator,
    wildErsetztAlles: w.wildErsetztAlles,
    bonusAusloeser: w.bonusAusloeser,
    maxGewinn: w.maxGewinnMultiplikator,
    premiumAktiv: w.premiumAktiv,
    gewichte: Object.fromEntries(konfiguration.regeln.symbole.map((symbol) => [symbol.key, symbol.gewicht])),
    auszahlungen: Object.fromEntries(
      konfiguration.regeln.symbole
        .filter((symbol) => symbol.auszahlung.some((wert) => wert > 0))
        .map((symbol) => [symbol.key, symbol.auszahlung]),
    ),
  };
}

/** Freispiele innerhalb einer laufenden Transaktion. */
async function offeneFreispieleIn(
  tx: Pick<Prisma.TransactionClient, 'xpSlotFreespinPackage'>,
  discordId: string,
  jetzt: Date,
): Promise<{ anzahl: number; einsatz: number | null }> {
  const zeilen = await tx.xpSlotFreespinPackage.findMany({
    where: {
      discordId,
      status: 'ACTIVE',
      remaining: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: jetzt } }],
    },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    anzahl: zeilen.reduce((wert, zeile) => wert + zeile.remaining, 0),
    einsatz: zeilen[0]?.bet ?? null,
  };
}

/**
 * Schreibt eine laufende Bonusrunde fort.
 *
 * Drei Dinge passieren hier: der Gewinn kommt zur Rundensumme, neu gefallene
 * Wilds bleiben stehen, und drei Bonussymbole verlaengern die Runde. Ist
 * danach kein Freispiel mehr offen, ist die Runde vorbei.
 */
async function schreibeBonusrundeFort(
  tx: Prisma.TransactionClient,
  runde: XpSlotBonusRound,
  grid: readonly string[],
  auswertung: Auswertung,
  konfiguration: SlotKonfiguration,
  jetzt: Date,
): Promise<XpSlotBonusRound> {
  const w = konfiguration.wirksam;
  const wild = konfiguration.regeln.symbole.find((symbol) => symbol.rolle === 'WILD');

  const sticky = new Set(runde.stickyCells);
  if (w.stickyWilds && wild) {
    for (let index = 0; index < ZELLEN; index += 1) {
      if (grid[index] === wild.key) {
        sticky.add(index);
      }
    }
  }

  const retrigger = auswertung.bonusAusgeloest;
  const frisch = await tx.xpSlotBonusRound.findUniqueOrThrow({ where: { id: runde.id } });
  const offen = frisch.remaining + (retrigger ? w.retriggerSpins : 0);
  const fertig = offen <= 0;

  return tx.xpSlotBonusRound.update({
    where: { id: runde.id },
    data: {
      remaining: offen,
      awarded: retrigger ? { increment: w.retriggerSpins } : undefined,
      retriggers: retrigger ? { increment: 1 } : undefined,
      totalWin: { increment: auswertung.gewinn },
      stickyCells: [...sticky].sort((a, b) => a - b),
      stage: fertig ? 'FINISHED' : 'SPINS',
      finishedAt: fertig ? jetzt : null,
    },
  });
}

/**
 * Was nach der Transaktion passiert.
 *
 * Premium und der Discord-Feed stehen bewusst **ausserhalb**: beide reden mit
 * fremden Systemen, und ein Discord, das nicht antwortet, darf keinen
 * gebuchten Spin zurueckrollen. Scheitert etwas davon, steht es im Protokoll
 * und - beim Premium - in einer Zeile, die es spaeter nachholt.
 */
async function nachDemSpin(spin: XpSlotSpin, konfiguration: SlotKonfiguration): Promise<void> {
  if (spin.premiumDays > 0 && konfiguration.wirksam.premiumAktiv) {
    const { gutschreibePremium } = await import('./premium');
    await gutschreibePremium(spin).catch((error: unknown) => {
      log.warn('Premium-Gewinn liess sich nicht sofort gutschreiben', { spinId: spin.id, error });
    });
  }

  const { meldeGewinn } = await import('./feed');
  await meldeGewinn(spin, konfiguration).catch((error: unknown) => {
    log.warn('Gewinnmeldung liess sich nicht stellen', { spinId: spin.id, error });
  });
}

/** Ein bereits gespeicherter Spin als Ergebnis - fuer die Wiederholung. */
async function nachbereitetesErgebnis(
  spin: XpSlotSpin,
  konfiguration: SlotKonfiguration,
  jetzt: Date,
  wiederholung: boolean,
): Promise<SpinErgebnis> {
  const w = konfiguration.wirksam;
  const auswertung = werteAus(spin.grid, konfiguration.regeln, spin.bet);
  const runde = await offeneBonusrunde(spin.discordId);
  const offen = await offeneFreispieleIn(prisma, spin.discordId, jetzt);
  const grenzen = await pruefeGrenzen(prisma, spin.discordId, 0, w, jetzt);

  return {
    spinId: spin.id,
    wiederholung,
    art: spin.kind,
    einsatz: spin.bet,
    grid: spin.grid,
    treffer: auswertung.treffer,
    gewinn: spin.grossWin,
    netto: spin.netWin,
    gedeckelt: spin.capped,
    stufe: gewinnstufe(spin.grossWin, spin.bet, { gross: w.tierGross, mega: w.tierMega }, spin.jackpot),
    jackpot: spin.jackpot,
    premiumTage: spin.premiumDays,
    bonusZellen: auswertung.bonusZellen,
    bonusSymbole: auswertung.bonusSymbole,
    bonusAusgeloest: spin.bonusTrigger,
    sweatAbWalze: auswertung.sweatAbWalze,
    xpVorher: spin.xpBefore,
    xpNachher: spin.xpAfter,
    bonus: runde ? bonusStand(runde, konfiguration) : null,
    freispieleOffen: offen.anzahl,
    freispielEinsatz: offen.einsatz,
    stand: grenzen.stand,
  };
}
