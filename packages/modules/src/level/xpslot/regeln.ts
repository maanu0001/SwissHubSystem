/**
 * Die Spielregeln des XP-Slots - ohne Datenbank, ohne Uhr, ohne Discord.
 *
 * ## Warum das hier getrennt steht
 *
 * Weil an jedem Ergebnis echte XP haengen. Alles, was ueber einen Gewinn
 * entscheidet, steht in dieser Datei und in `auswertung.ts`: reine Funktionen
 * mit einer hereingegebenen Zufallsquelle. Dadurch laesst sich jede Regel
 * nachrechnen, ohne eine Umgebung aufzubauen - und dadurch kann die RTP in
 * `rtp.ts` dieselben Funktionen aufzaehlen, die im Betrieb spielen. Eine
 * zweite Rechnung fuer die Vorschau waere eine zweite Wahrheit.
 *
 * ## Die Form des Spielfelds
 *
 * Fuenf Walzen mit je drei sichtbaren Symbolen, also 15 Zellen. Der Index
 * einer Zelle ist `walze * 3 + reihe`; Walze 0 ist links, Reihe 0 ist oben.
 * Diese eine Rechnung steht in `zelle()` und wird nirgends wiederholt.
 *
 * ## Warum jede Zelle einzeln gezogen wird
 *
 * Echte Automaten haben Walzenbaender: ein Band mit festen Positionen, das
 * an einer Stelle anhaelt, womit die drei sichtbaren Symbole einer Walze
 * zusammenhaengen. Hier wird jede der 15 Zellen unabhaengig gezogen.
 *
 * Das ist eine bewusste Entscheidung, und sie hat einen Grund, der mehr wiegt
 * als die Nachbildung einer Mechanik: **die RTP bleibt exakt berechenbar.**
 * Bei unabhaengigen Zellen besteht eine Gewinnlinie aus fuenf unabhaengigen
 * Ziehungen, und der Erwartungswert einer Linie laesst sich durch
 * vollstaendige Aufzaehlung aller Kombinationen ausrechnen - nicht schaetzen.
 * Bei Walzenbaendern haetten wir stattdessen eine Simulation, und damit eine
 * Zahl im Dashboard, die bei jedem Aufruf etwas anderes sagt.
 *
 * Fuer die Spielerin ist der Unterschied nicht wahrnehmbar; fuer die Frage
 * «zahlt dieser Automat 93 Prozent aus?» ist er der ganze Unterschied.
 */

import type { RandomSource } from '../../zufall';

/**
 * Ein ganzer Einsatz in Basispunkten.
 *
 * Auszahlungen liegen ganzzahlig in dieser Einheit in der Datenbank; `10000`
 * ist ein ganzer Einsatz. Umgerechnet wird genau an einer Stelle, in
 * `besterLinienfaktor`.
 */
export const BASISPUNKTE = 10_000;

/** Fuenf Walzen. */
export const WALZEN = 5;
/** Drei sichtbare Symbole je Walze. */
export const REIHEN = 3;
/** 15 Zellen. */
export const ZELLEN = WALZEN * REIHEN;

/** Der Index einer Zelle im Spielfeld. */
export function zelle(walze: number, reihe: number): number {
  return walze * REIHEN + reihe;
}

/**
 * Die zehn festen Gewinnlinien.
 *
 * Je Linie eine Reihe pro Walze, von links nach rechts. Die ersten drei sind
 * die Waagrechten, dann die beiden Diagonalen, dann fuenf Zickzacklinien -
 * das uebliche Zehnerbild, bei dem jede Linie jede Walze genau einmal
 * beruehrt. Mehr Linien waeren mehr Zahlen auf der Infotafel und kein
 * besseres Spiel; weniger waeren ein leeres Spielfeld.
 *
 * Die Liste ist fest und nicht einstellbar: eine Linie zu entfernen wuerde
 * jede Auszahlung in der Tabelle verschieben, ohne dass es jemand am Namen
 * «Linie 7» merkt.
 */
export const LINIEN: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 1, 2, 1],
];

/** Die Zellindizes einer Linie. */
export function linienZellen(linie: number): number[] {
  const reihen = LINIEN[linie];
  if (!reihen) {
    return [];
  }
  return reihen.map((reihe, walze) => zelle(walze, reihe));
}

/**
 * Ein Symbol, so wie die Auswertung es braucht.
 *
 * Bewusst nicht die Prisma-Zeile: die Auswertung soll sich ohne Datenbank
 * aufrufen lassen, und sie braucht weder Bild noch Name noch Zeitstempel.
 */
export interface SpielSymbol {
  key: string;
  rolle: 'NORMAL' | 'WILD' | 'SCATTER' | 'JACKPOT' | 'PREMIUM';
  gewicht: number;
  /**
   * Auszahlung in Basispunkten des Einsatzes, Index 0 = drei Gleiche.
   *
   * `10000` ist ein ganzer Einsatz. Die Einheit ist ungewoehnlich und hat
   * einen Grund: zehn Linien zahlen gleichzeitig, deshalb liegt ein Dreier
   * des haeufigsten Symbols bei etwa 0,04x Einsatz. Als ganzzahlige
   * Basispunkte laesst sich das speichern, vergleichen und aufaddieren, ohne
   * dass an einer Stelle gerundet wird, an der echte XP entstehen.
   */
  auszahlung: readonly [number, number, number];
  /** Nur bei `PREMIUM`: Tage statt XP, Index 0 = drei Gleiche. */
  premiumTage: readonly [number, number, number];
}

/** Die Regeln, unter denen ein Spielfeld ausgewertet wird. */
export interface Spielregeln {
  symbole: readonly SpielSymbol[];
  /** `Einsatz * jackpotMultiplikator` bei fuenf Logos auf einer Linie. */
  jackpotMultiplikator: number;
  /** Nur fuenf echte Logos zahlen den Jackpot - kein Wild dazwischen. */
  jackpotNurEcht: boolean;
  /** Ersetzt das Wild auch Logo, Premium und Bonus? */
  wildErsetztAlles: boolean;
  /** Wie viele Bonussymbole den Bonus ausloesen. */
  bonusAusloeser: number;
  /** Deckel je Spin als Vielfaches des Einsatzes. `0` = kein Deckel. */
  maxGewinnMultiplikator: number;
  /** Premium-Gewinne nur, wenn eingeschaltet. */
  premiumAktiv: boolean;
}

/**
 * Die Symbole, die tatsaechlich auf die Walzen kommen.
 *
 * Ein Gewicht von `0` heisst «kommt nicht vor» - und ein Premiumsymbol kommt
 * nicht vor, solange Premium aus ist. Das ist der Riegel aus dem Konzept:
 * ohne aktive Premiumkonfiguration ist das Symbol **nicht im Spiel**, nicht
 * bloss nicht auszahlbar. Waere es im Spiel und zahlte nicht, waere es eine
 * Niete mit Premiumbild.
 */
export function ziehbareSymbole(regeln: Spielregeln): SpielSymbol[] {
  return regeln.symbole.filter(
    (symbol) => symbol.gewicht > 0 && (regeln.premiumAktiv || symbol.rolle !== 'PREMIUM'),
  );
}

/** Die Wahrscheinlichkeit je Symbol - Gewicht geteilt durch Gesamtgewicht. */
export function verteilung(regeln: Spielregeln): Array<{ symbol: SpielSymbol; p: number }> {
  const ziehbar = ziehbareSymbole(regeln);
  const summe = ziehbar.reduce((wert, symbol) => wert + symbol.gewicht, 0);
  if (summe <= 0) {
    return [];
  }
  return ziehbar.map((symbol) => ({ symbol, p: symbol.gewicht / summe }));
}

/**
 * Zieht ein Symbol entsprechend seinem Gewicht.
 *
 * Dieselbe Technik wie bei der Verlosung: ein Punkt auf der Gewichtsachse,
 * dann vorwaerts aufaddieren. Die Quelle kommt von aussen - im Betrieb
 * `secureRandom`, im Test eine nachrechenbare.
 */
export function ziehSymbol(symbole: readonly SpielSymbol[], random: RandomSource): SpielSymbol {
  const summe = symbole.reduce((wert, symbol) => wert + symbol.gewicht, 0);
  const punkt = random.integer(summe);
  let laufend = 0;
  for (const symbol of symbole) {
    laufend += symbol.gewicht;
    if (punkt < laufend) {
      return symbol;
    }
  }
  return symbole[symbole.length - 1]!;
}

/**
 * Ein neues Spielfeld - 15 Symbolschluessel.
 *
 * `festeWilds` sind Zellen, die als Wild stehen bleiben: die Sticky Wilds der
 * Bonusrunde. Sie werden nicht neu gezogen, sondern gesetzt - deshalb stehen
 * sie hier und nicht in der Bonuslogik: wer ein Spielfeld erzeugt, muss alle
 * Regeln kennen, die darueber entscheiden, was darauf steht.
 */
export function dreheWalzen(
  regeln: Spielregeln,
  random: RandomSource,
  festeWilds: readonly number[] = [],
): string[] {
  const ziehbar = ziehbareSymbole(regeln);
  if (ziehbar.length === 0) {
    throw new Error('Es gibt kein ziehbares Symbol - die Konfiguration ist unspielbar.');
  }
  const wild = regeln.symbole.find((symbol) => symbol.rolle === 'WILD');
  const fest = new Set(festeWilds);

  return Array.from({ length: ZELLEN }, (_unused, index) => {
    if (wild && fest.has(index)) {
      return wild.key;
    }
    return ziehSymbol(ziehbar, random).key;
  });
}

/**
 * Wo die Bonusrunde beginnt - abhaengig davon, wie viele Scatter kamen.
 *
 * ## Die Regel
 *
 * Mehr Scatter als noetig heben den **Einstieg in die Risikoleiter**, nicht
 * den Gewinn daneben. Mit der Vorgabe (Ausloeser 3, garantiert 8, Leiter 12
 * und 16) heisst das:
 *
 *     3 Scatter   8 nehmen  oder auf 12 riskieren, dann auf 16
 *     4 Scatter  12 nehmen  oder auf 16 riskieren
 *     5 Scatter  12 nehmen  oder auf 16 riskieren
 *     6 Scatter  16 sofort, ohne Leiter
 *
 * ## Warum relativ zum Ausloeser und nicht «ab vier»
 *
 * Weil der Ausloeser einstellbar ist. Stuende hier die feste Zahl vier,
 * waere die Staffel bei einem Ausloeser von fuenf sinnlos: der erste
 * moegliche Treffer waere schon die zweite Stufe. Gezaehlt wird deshalb, wie
 * viele Scatter **ueber** dem Ausloeser liegen - einer mehr hebt eine
 * Sprosse, drei mehr geben das Maximum sofort.
 *
 * ## Warum nie nach unten
 *
 * Eine abgeschaltete Leiter traegt die Null (`leiter1`, `leiter2`), und eine
 * Null waere ein Rueckschritt: sechs Scatter duerfen nicht weniger bringen
 * als drei. Die Stufe faellt deshalb zurueck, solange die naechste nicht
 * mehr Freispiele traegt als die vorige. `pruefeKonfig` stellt sicher, dass
 * eine eingeschaltete Leiter echt steigt - diese Pruefung deckt den Fall ab,
 * dass sie ganz aus ist.
 */
export interface BonusEinstieg {
  stufe: 'LADDER_1' | 'LADDER_2' | 'SPINS';
  /** Die Freispiele, die sofort anstehen - nur bei `SPINS` gesetzt. */
  freispiele: number;
}

export function bonusEinstieg(
  scatter: number,
  werte: {
    bonusAusloeser: number;
    bonusFreispiele: number;
    leiter1: number;
    leiter2: number;
  },
): BonusEinstieg {
  const sprossen: Array<{ stufe: BonusEinstieg['stufe']; wert: number }> = [
    { stufe: 'LADDER_1', wert: werte.bonusFreispiele },
    { stufe: 'LADDER_2', wert: werte.leiter1 },
    { stufe: 'SPINS', wert: werte.leiter2 },
  ];

  const ueber = scatter - werte.bonusAusloeser;
  let ziel = ueber >= 3 ? 2 : ueber >= 1 ? 1 : 0;
  while (ziel > 0 && (sprossen[ziel]?.wert ?? 0) <= (sprossen[ziel - 1]?.wert ?? 0)) {
    ziel -= 1;
  }

  const sprosse = sprossen[ziel] ?? sprossen[0];
  return {
    stufe: sprosse?.stufe ?? 'LADDER_1',
    freispiele: sprosse?.stufe === 'SPINS' ? (sprosse.wert ?? 0) : 0,
  };
}
