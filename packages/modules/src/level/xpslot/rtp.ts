/**
 * Die theoretische Auszahlungsquote - gerechnet, nicht gesetzt.
 *
 * ## Warum nicht einfach eine Zahl im Dashboard
 *
 * Weil eine eingetragene RTP nichts ueber den Automaten sagt. Sie entsteht
 * aus den Gewichten, der Auszahlungstabelle, dem Wild, dem Jackpot und dem
 * Bonus - und wer ein Gewicht aendert, aendert sie, ob er will oder nicht.
 * Eine Zahl, die unabhaengig davon im Formular steht, wird beim ersten
 * Eingriff falsch und bleibt es.
 *
 * ## Warum Aufzaehlung und nicht Simulation
 *
 * Weil es geht. Jede der 15 Zellen wird unabhaengig gezogen (siehe
 * `regeln.ts`), eine Gewinnlinie besteht also aus fuenf unabhaengigen
 * Ziehungen. Bei acht Symbolen sind das 8^5 = 32768 Kombinationen - die
 * zaehlt man vollstaendig auf, mit Wahrscheinlichkeit und Auszahlung, und
 * hat den Erwartungswert **exakt**. Eine Simulation mit einer Million Spins
 * waere langsamer und ungenauer, und sie wuerde bei jedem Aufruf eine andere
 * Zahl zeigen.
 *
 * Der Erwartungswert aller zehn Linien ist die Summe der zehn
 * Einzelerwartungen - das gilt auch dann, wenn sich die Linien Zellen
 * teilen, denn der Erwartungswert ist linear. Weil alle zehn Linien
 * dieselbe Form haben (fuenf unabhaengige Zellen), ist es zehnmal derselbe
 * Wert.
 *
 * ## Wo es nicht mehr exakt ist - und warum das dasteht
 *
 * Drei Stellen, alle dokumentiert und alle so gewaehlt, dass sie die Quote
 * **nicht nach unten** verfaelschen - die ausgewiesene Zahl ist damit eine
 * Obergrenze und nie eine Beschoenigung nach unten:
 *
 * 1. **Der Hoechstgewinn je Spin.** Er deckelt die Summe aller Linien, und
 *    die Verteilung dieser Summe ueber 15 abhaengige Zellen exakt zu
 *    bestimmen waere 8^15. Gerechnet wird ohne Deckel; der Deckel kann die
 *    Quote nur senken. Damit niemand raten muss, ob er ueberhaupt greift,
 *    weist die Rechnung den grooesstmoeglichen Gewinn je Spin aus und warnt,
 *    wenn der Deckel darunter liegt.
 * 2. **Die Zahl der Freispiele.** Ein Retrigger verlaengert die Runde; die
 *    Wahrscheinlichkeit dafuer sinkt im Lauf der Runde, weil Sticky Wilds
 *    Felder belegen, auf denen sonst ein Bonussymbol liegen koennte.
 *    Gerechnet wird mit der Wahrscheinlichkeit des ersten Freispiels, also
 *    mit der hoechsten - das ergibt etwas zu viele Freispiele.
 * Die Risikoleiter ist dagegen **vollstaendig** mitgerechnet, und das ist
 * wichtiger, als es klingt. Sie ist eine Entscheidung der Spielerin, also
 * rechnet die Quote mit der **besten** Entscheidung: auf jeder Stufe wird
 * verglichen, was Nehmen wert ist und was Riskieren wert ist, und es gilt der
 * grooessere Wert. Ausgewiesen werden beide Zahlen.
 *
 * Der Grund ist eine Falle, die beim ersten Entwurf dieses Automaten
 * zugeschnappt waere: Freispiele mit Sticky Wilds sind **ueberproportional**
 * wertvoll. Zwoelf Freispiele sind nicht anderthalb mal acht, sondern fast
 * dreimal so viel, weil mehr Spiele mehr festsitzende Wilds bedeuten und
 * jedes weitere Spiel auf einem besseren Feld laeuft. Eine Risikowahl mit
 * 50 Prozent Chance von 8 auf 12 ist deshalb nicht neutral, sondern lohnend -
 * und wer immer riskiert, zieht die Quote ueber 100 Prozent. Haette die
 * Rechnung «nimmt die garantierten Freispiele» angenommen, haette das
 * Dashboard 92 Prozent gezeigt, waehrend der Automat an aufmerksame Spieler
 * 114 Prozent ausschuettet.
 *
 * Darum sind die Vorgabechancen der Leiter so gewaehlt, dass Nehmen und
 * Riskieren etwa gleich viel wert sind, und darum warnt die Rechnung, wenn
 * eine geaenderte Chance das Riskieren lohnend macht.
 *
 * Die Freispiele mit Sticky Wilds sind **exakt** gerechnet: ob eine
 * Zelle als Wild feststeht, haengt nur von ihrer eigenen Vorgeschichte ab,
 * und die Zellen sind unabhaengig. Die Wahrscheinlichkeit, dass eine Zelle
 * im `i`-ten Freispiel als Wild steht, ist damit geschlossen angebbar, und
 * die Linienaufzaehlung laeuft mit dieser veraenderten Verteilung erneut.
 */

import { besterLinienfaktor, type LinienFaktor } from './auswertung';
import { BASISPUNKTE, LINIEN, verteilung, ZELLEN, type SpielSymbol, type Spielregeln } from './regeln';

/** Das Ergebnis der Rechnung. */
export interface RtpErgebnis {
  /** Die Quote als Anteil: `0.93` sind 93 Prozent. */
  rtp: number;
  /** Nur die Linien im Grundspiel. */
  rtpGrundspiel: number;
  /** Nur die Freispiele aus dem Bonus, unter bester Risikowahl. */
  rtpBonus: number;
  /** Derselbe Beitrag, wenn immer die garantierten Freispiele genommen werden. */
  rtpBonusOhneRisiko: number;
  /** Was die beste Wahl auf jeder Stufe ist - fuer die Anzeige. */
  leiterWahl: Array<{
    stufe: number;
    freispiele: number;
    nehmen: number;
    riskieren: number;
    besser: 'nehmen' | 'riskieren';
  }>;
  /** Erwarteter Beitrag des Jackpots - Teil von `rtpGrundspiel`. */
  rtpJackpot: number;
  /** Wahrscheinlichkeit, dass ein Spin den Bonus ausloest. */
  bonusChance: number;
  /** Wahrscheinlichkeit eines Jackpots je Spin. */
  jackpotChance: number;
  /** Erwartete Freispiele je ausgeloestem Bonus, mit Retriggern. */
  freispieleJeBonus: number;
  /** Erwartete Premium-Tage je 1000 Spins - bewusst neben der XP-Quote. */
  premiumTageJe1000: number;
  /** Der grooesstmoegliche Gewinn je Spin als Vielfaches des Einsatzes. */
  maxFaktor: number;
  /** Greift der eingestellte Deckel ueberhaupt? */
  deckelErreichbar: boolean;
  /** Was die Rechnung nicht leisten kann - fuer die Anzeige. */
  hinweise: string[];
  /** Harte Fehler: damit ist der Automat nicht spielbar. */
  fehler: string[];
}

/** Die Zielspanne aus dem Konzept. */
export const RTP_ZIEL_MIN = 0.92;
export const RTP_ZIEL_MAX = 0.95;

/**
 * Die aufgezaehlte Linientabelle.
 *
 * Fuer jede der `n^5` Kombinationen steht hier, was sie zahlt. Die
 * Wahrscheinlichkeiten stehen **nicht** darin: dieselbe Tabelle wird mit
 * mehreren Verteilungen gewichtet - einmal fuer das Grundspiel und einmal je
 * Freispiel, weil Sticky Wilds die Verteilung verschieben. Die Aufzaehlung
 * passiert damit genau einmal statt sechzehnmal.
 */
interface Linientabelle {
  symbole: SpielSymbol[];
  /** Index `k` ist die Kombination in Basis `n`, erste Walze = kleinste Stelle. */
  faktor: Float64Array;
  premiumTage: Float64Array;
  jackpot: Uint8Array;
}

function baueLinientabelle(regeln: Spielregeln): Linientabelle {
  const symbole = regeln.symbole.filter((symbol) => symbol.gewicht > 0);
  const n = symbole.length;
  const anzahl = n ** 5;
  const faktor = new Float64Array(anzahl);
  const premiumTage = new Float64Array(anzahl);
  const jackpot = new Uint8Array(anzahl);

  const reihe: SpielSymbol[] = [symbole[0]!, symbole[0]!, symbole[0]!, symbole[0]!, symbole[0]!];
  for (let index = 0; index < anzahl; index += 1) {
    let rest = index;
    for (let walze = 0; walze < 5; walze += 1) {
      reihe[walze] = symbole[rest % n]!;
      rest = Math.trunc(rest / n);
    }
    const bester: LinienFaktor | null = besterLinienfaktor(reihe, regeln);
    if (bester) {
      faktor[index] = bester.faktor;
      premiumTage[index] = bester.premiumTage;
      jackpot[index] = bester.jackpot ? 1 : 0;
    }
  }

  return { symbole, faktor, premiumTage, jackpot };
}

/** Erwartungswerte einer Linie unter einer Zellverteilung. */
function linienErwartung(
  tabelle: Linientabelle,
  p: readonly number[],
): { faktor: number; premiumTage: number; jackpot: number } {
  const n = tabelle.symbole.length;
  let faktor = 0;
  let premiumTage = 0;
  let jackpotChance = 0;

  const anzahl = n ** 5;
  for (let index = 0; index < anzahl; index += 1) {
    const f = tabelle.faktor[index]!;
    const t = tabelle.premiumTage[index]!;
    const j = tabelle.jackpot[index]!;
    if (f === 0 && t === 0 && j === 0) {
      continue;
    }
    let wahrscheinlich = 1;
    let rest = index;
    for (let walze = 0; walze < 5; walze += 1) {
      wahrscheinlich *= p[rest % n]!;
      rest = Math.trunc(rest / n);
      if (wahrscheinlich === 0) {
        break;
      }
    }
    if (wahrscheinlich === 0) {
      continue;
    }
    faktor += wahrscheinlich * f;
    premiumTage += wahrscheinlich * t;
    jackpotChance += wahrscheinlich * j;
  }

  return { faktor, premiumTage, jackpot: jackpotChance };
}

/** `P(mindestens k von 15)` bei Einzelwahrscheinlichkeit `p`. */
export function mindestens(k: number, p: number, felder = ZELLEN): number {
  if (k <= 0) {
    return 1;
  }
  if (p <= 0) {
    return 0;
  }
  let summe = 0;
  for (let treffer = k; treffer <= felder; treffer += 1) {
    summe += binom(felder, treffer) * p ** treffer * (1 - p) ** (felder - treffer);
  }
  return summe;
}

function binom(n: number, k: number): number {
  let wert = 1;
  for (let schritt = 0; schritt < k; schritt += 1) {
    wert = (wert * (n - schritt)) / (schritt + 1);
  }
  return wert;
}

/** Die Einstellungen, die der Bonus zur Rechnung beitraegt. */
export interface BonusAnnahmen {
  /** Die garantierten Freispiele der ersten Stufe. */
  freispiele: number;
  /** Die zweite Stufe der Leiter. */
  leiter1: number;
  /** Die dritte Stufe der Leiter. */
  leiter2: number;
  /** Gewinnchance der ersten Risikowahl, als Anteil. */
  chance1: number;
  /** Gewinnchance der zweiten Risikowahl, als Anteil. */
  chance2: number;
  retriggerSpins: number;
  stickyWilds: boolean;
}

/**
 * Rechnet die Quote aus der Konfiguration.
 *
 * Wirft nicht: eine unspielbare Konfiguration bekommt `fehler` gefuellt und
 * eine Quote von 0. Das Dashboard soll sagen koennen, *was* nicht stimmt,
 * und nicht in einen Fehler laufen.
 */
export function rechneRtp(regeln: Spielregeln, bonus: BonusAnnahmen): RtpErgebnis {
  const hinweise: string[] = [];
  const fehler: string[] = [];

  const verteilt = verteilung(regeln);
  if (verteilt.length === 0) {
    return {
      rtp: 0,
      rtpGrundspiel: 0,
      rtpBonus: 0,
      rtpBonusOhneRisiko: 0,
      leiterWahl: [],
      rtpJackpot: 0,
      bonusChance: 0,
      jackpotChance: 0,
      freispieleJeBonus: 0,
      premiumTageJe1000: 0,
      maxFaktor: 0,
      deckelErreichbar: false,
      hinweise,
      fehler: ['Kein Symbol hat ein Gewicht groesser als 0 - es laesst sich nicht spielen.'],
    };
  }

  const tabelle = baueLinientabelle(regeln);
  /*
   * Die Verteilung in der Reihenfolge der Tabelle.
   *
   * Die Tabelle enthaelt jedes Symbol mit Gewicht; ein Premiumsymbol bei
   * abgeschaltetem Premium hat in `verteilung` keine Zeile und bekommt
   * hier deshalb die Wahrscheinlichkeit 0 - es liegt nicht auf den Walzen.
   */
  const pNachKey = new Map(verteilt.map((eintrag) => [eintrag.symbol.key, eintrag.p]));
  const pGrund = tabelle.symbole.map((symbol) => pNachKey.get(symbol.key) ?? 0);

  const grund = linienErwartung(tabelle, pGrund);
  const linien = LINIEN.length;
  const rtpGrundspiel = grund.faktor * linien;
  const jackpotChance = 1 - (1 - grund.jackpot) ** linien;

  // Der Jackpotbeitrag: dieselbe Aufzaehlung, aber nur die Jackpotzeilen.
  const jackpotSymbol = regeln.symbole.find((symbol) => symbol.rolle === 'JACKPOT');
  const rtpJackpot = jackpotSymbol ? grund.jackpot * regeln.jackpotMultiplikator * linien : 0;

  // --- Bonus ---------------------------------------------------------------
  const bonusSymbol = regeln.symbole.find((symbol) => symbol.rolle === 'SCATTER');
  const pBonusZelle = bonusSymbol ? (pNachKey.get(bonusSymbol.key) ?? 0) : 0;
  const bonusChance = bonusSymbol ? mindestens(regeln.bonusAusloeser, pBonusZelle) : 0;

  const wildSymbol = regeln.symbole.find((symbol) => symbol.rolle === 'WILD');
  const pWild = wildSymbol ? (pNachKey.get(wildSymbol.key) ?? 0) : 0;

  /*
   * Erwartete Freispiele je zugesagter Zahl.
   *
   * Jedes Freispiel kann die Runde um `retriggerSpins` verlaengern. Mit
   * konstanter Chance `r` je Spiel loest das `T = n + s * r * T`, also
   * `T = n / (1 - s * r)`. Wird der Nenner null oder negativ, waere die
   * Runde im Mittel unendlich - das ist kein Rechenfehler, sondern eine
   * unspielbare Konfiguration, und sie wird als Fehler gemeldet.
   */
  const retriggerChance = bonusChance;
  const nenner = 1 - bonus.retriggerSpins * retriggerChance;
  if (bonus.freispiele > 0 && nenner <= 0.05) {
    fehler.push(
      'Die Retrigger-Chance ist so hoch, dass eine Bonusrunde im Mittel nicht endet. Bitte das Gewicht des Bonussymbols senken oder weniger Zusatzspiele vergeben.',
    );
  }
  const erwarteteSpiele = (zugesagt: number): number =>
    zugesagt <= 0 ? 0 : nenner > 0.05 ? zugesagt / nenner : zugesagt;

  /**
   * Der Wert einer Bonusrunde mit `zugesagt` Freispielen, Spiel fuer Spiel.
   *
   * Im `i`-ten Freispiel (ab 1) steht eine Zelle genau dann als Sticky Wild,
   * wenn in einem der `i - 1` vorherigen Spiele ein Wild darauf fiel:
   * `q = 1 - (1 - pWild)^(i-1)`. Andernfalls wird sie frisch gezogen. Die
   * Zellen sind unabhaengig, also ist das die vollstaendige Verteilung - und
   * die Linienaufzaehlung laeuft damit erneut.
   *
   * Hier liegt der Grund fuer die Ueberproportionalitaet: `q` waechst mit
   * jedem Spiel, also ist das zehnte Freispiel mehr wert als das erste.
   */
  const rundenwert = (zugesagt: number): { faktor: number; premiumTage: number; spiele: number } => {
    const spieleGesamt = erwarteteSpiele(zugesagt);
    let faktor = 0;
    let premiumTage = 0;
    for (let i = 1; i <= Math.ceil(spieleGesamt); i += 1) {
      const q = bonus.stickyWilds && wildSymbol ? 1 - (1 - pWild) ** (i - 1) : 0;
      const p = tabelle.symbole.map((symbol) => {
        const basis = pNachKey.get(symbol.key) ?? 0;
        return symbol.rolle === 'WILD' ? q + (1 - q) * basis : (1 - q) * basis;
      });
      const spiel = linienErwartung(tabelle, p);
      // Das letzte Spiel zaehlt nur zum Bruchteil mit, wenn die erwartete
      // Zahl der Freispiele keine ganze ist.
      const anteil = Math.min(1, spieleGesamt - (i - 1));
      faktor += spiel.faktor * linien * anteil;
      premiumTage += spiel.premiumTage * linien * anteil;
    }
    return { faktor, premiumTage, spiele: spieleGesamt };
  };

  const stufe0 = rundenwert(bonus.freispiele);
  const stufe1 = rundenwert(bonus.leiter1);
  const stufe2 = rundenwert(bonus.leiter2);

  /*
   * Die beste Wahl, von hinten nach vorne.
   *
   * Auf der letzten Stufe gibt es nichts mehr zu riskieren. Auf den beiden
   * davor gilt der grooessere von zwei Werten: nehmen (der Rundenwert dieser
   * Stufe) oder riskieren (die Chance mal dem Wert der naechsten Stufe - bei
   * Verlust ist die Runde weg, das sind null).
   */
  const wert2 = stufe2;
  const riskieren2 = bonus.chance2 * wert2.faktor;
  const besser2 = riskieren2 > stufe1.faktor ? 'riskieren' : 'nehmen';
  const wert1Faktor = Math.max(stufe1.faktor, riskieren2);
  const wert1Tage = besser2 === 'riskieren' ? bonus.chance2 * wert2.premiumTage : stufe1.premiumTage;

  const riskieren1 = bonus.chance1 * wert1Faktor;
  const besser1 = riskieren1 > stufe0.faktor ? 'riskieren' : 'nehmen';
  const bestFaktor = Math.max(stufe0.faktor, riskieren1);
  const bestTage = besser1 === 'riskieren' ? bonus.chance1 * wert1Tage : stufe0.premiumTage;

  const leiterWahl = [
    {
      stufe: 1,
      freispiele: bonus.freispiele,
      nehmen: stufe0.faktor,
      riskieren: riskieren1,
      besser: besser1 as 'nehmen' | 'riskieren',
    },
    {
      stufe: 2,
      freispiele: bonus.leiter1,
      nehmen: stufe1.faktor,
      riskieren: riskieren2,
      besser: besser2 as 'nehmen' | 'riskieren',
    },
  ];

  const freispieleJeBonus = stufe0.spiele;
  const rtpBonus = bonusChance * bestFaktor;
  const rtpBonusOhneRisiko = bonusChance * stufe0.faktor;
  const premiumProSpin = grund.premiumTage * linien + bonusChance * bestTage;

  // --- Deckel --------------------------------------------------------------
  const maxLinienfaktor = regeln.symbole.reduce((wert, symbol) => {
    if (symbol.rolle === 'SCATTER') {
      return wert;
    }
    if (symbol.rolle === 'PREMIUM' && !regeln.premiumAktiv) {
      return wert;
    }
    const eigen =
      symbol.rolle === 'JACKPOT' ? regeln.jackpotMultiplikator : (symbol.auszahlung[2] ?? 0) / BASISPUNKTE;
    return Math.max(wert, eigen);
  }, 0);
  const maxFaktor = maxLinienfaktor * linien;
  const deckel = regeln.maxGewinnMultiplikator;
  const deckelErreichbar = deckel > 0 && deckel < maxFaktor;

  if (deckel > 0) {
    hinweise.push(
      deckelErreichbar
        ? `Der Hoechstgewinn von ${deckel}x Einsatz liegt unter dem theoretischen Maximum von ${maxFaktor}x. Die ausgewiesene Quote ist deshalb eine Obergrenze.`
        : `Der Hoechstgewinn von ${deckel}x Einsatz liegt ueber dem theoretischen Maximum von ${maxFaktor}x und greift nie.`,
    );
  }
  if (bonusChance > 0 && rtpBonus > rtpBonusOhneRisiko * 1.02) {
    const auf = (rtpBonusOhneRisiko > 0 ? rtpBonus / rtpBonusOhneRisiko : 0).toFixed(2);
    hinweise.push(
      `Die Risikoleiter lohnt sich: wer immer riskiert, holt das ${auf}-fache aus dem Bonus. Die ausgewiesene Quote rechnet damit. Wer die garantierten Freispiele nimmt, kommt auf ${((rtpGrundspiel + rtpBonusOhneRisiko) * 100).toFixed(1)} Prozent. Niedrigere Risikochancen bringen die beiden Zahlen zusammen.`,
    );
  }
  if (premiumProSpin > 0) {
    hinweise.push(
      'Premium-Gewinne stehen bewusst neben der XP-Quote: Premium-Tage sind keine XP, und ein erfundener XP-Gegenwert wuerde die Quote beliebig machen.',
    );
  }

  return {
    rtp: rtpGrundspiel + rtpBonus,
    rtpGrundspiel,
    rtpBonus,
    rtpBonusOhneRisiko,
    leiterWahl,
    rtpJackpot,
    bonusChance,
    jackpotChance,
    freispieleJeBonus,
    premiumTageJe1000: premiumProSpin * 1000,
    maxFaktor,
    deckelErreichbar,
    hinweise,
    fehler,
  };
}

/** Die Bewertung einer Quote gegen die Zielspanne. */
export type RtpLage = 'zu_tief' | 'im_ziel' | 'zu_hoch';

export function rtpLage(rtp: number): RtpLage {
  if (rtp < RTP_ZIEL_MIN) {
    return 'zu_tief';
  }
  if (rtp > RTP_ZIEL_MAX) {
    return 'zu_hoch';
  }
  return 'im_ziel';
}

/**
 * Darf mit dieser Quote gespielt werden?
 *
 * Eine Quote ausserhalb der Zielspanne ist eine **Warnung**, keine Sperre:
 * 91 Prozent sind ein strenger Automat und kein Defekt, und ein Event darf
 * bewusst grosszuegiger sein. Gesperrt wird nur, was mathematisch nicht
 * aufgeht - eine Konfiguration ohne ziehbares Symbol oder eine Bonusrunde,
 * die im Mittel nicht endet. Wer jede Abweichung sperrt, hat ein Dashboard,
 * in dem sich nichts mehr einstellen laesst.
 */
export function spielbar(ergebnis: RtpErgebnis): boolean {
  return ergebnis.fehler.length === 0;
}
