/**
 * Die Auswertung eines Spielfelds - die Stelle, an der ein Gewinn entsteht.
 *
 * Rein rechnend: dasselbe Spielfeld und dieselben Regeln ergeben immer
 * dasselbe Ergebnis. Kein Zufall, keine Datenbank, keine Uhr. Das ist der
 * Grund, weshalb `rtp.ts` den Erwartungswert durch vollstaendige Aufzaehlung
 * bestimmen kann, statt zu simulieren: die Aufzaehlung ruft genau diese
 * Funktionen auf, mit denen auch gespielt wird.
 *
 * ## Die Regeln, in der Reihenfolge, in der sie wirken
 *
 * 1. **Von links.** Gezaehlt wird die Kette ab Walze 1. Eine Kette, die erst
 *    auf Walze 2 beginnt, zaehlt nicht - sonst waere jede Linie fast immer
 *    ein Gewinn.
 * 2. **Wild ersetzt.** Ein Wild gilt als das Symbol, das die Kette gerade
 *    bildet. Ob es auch Logo, Premium und Bonus ersetzt, ist einstellbar.
 * 3. **Ein Gewinn je Linie - der hoechste.** Eine Kette aus drei Wilds
 *    koennte fuer mehrere Symbole zaehlen; gezahlt wird das beste. Zwei
 *    Gewinne auf derselben Linie waeren eine doppelte Auszahlung fuer
 *    dieselben Felder.
 * 4. **Mehrere Linien zahlen zusammen.** Zehn Linien, bis zu zehn Gewinne,
 *    und sie werden addiert.
 * 5. **Der Bonus zaehlt ueberall.** Bonussymbole brauchen keine Linie: drei
 *    irgendwo auf den 15 Feldern loesen aus. Deshalb steht der Bonus
 *    ausserhalb der Linienrechnung.
 * 6. **Der Deckel am Ende.** Erst wird alles zusammengezaehlt, dann
 *    gedeckelt. Ein Deckel je Linie waere bei zehn Linien kein Deckel.
 */

import {
  BASISPUNKTE,
  LINIEN,
  linienZellen,
  REIHEN,
  WALZEN,
  ZELLEN,
  type SpielSymbol,
  type Spielregeln,
} from './regeln';

/** Ein Treffer auf einer Linie. */
export interface LinienTreffer {
  /** Index in `LINIEN`. */
  linie: number;
  symbolKey: string;
  /** Laenge der Kette: 3, 4 oder 5. */
  laenge: number;
  /** Auszahlung in XP. */
  gewinn: number;
  /** Premium-Tage statt XP - nur beim Premiumsymbol. */
  premiumTage: number;
  /** Fuenf echte Logos: der Jackpot. */
  jackpot: boolean;
  /** Die getroffenen Zellen, fuer die Hervorhebung in der Oberflaeche. */
  zellen: number[];
}

export interface Auswertung {
  treffer: LinienTreffer[];
  /** Summe der XP-Gewinne, bereits gedeckelt. */
  gewinn: number;
  /** Was ohne Deckel herausgekommen waere. */
  gewinnUngedeckelt: number;
  gedeckelt: boolean;
  premiumTage: number;
  jackpot: boolean;
  /** Wie viele Bonussymbole liegen - unabhaengig von Linien. */
  bonusSymbole: number;
  /** Zellen mit einem Bonussymbol. */
  bonusZellen: number[];
  bonusAusgeloest: boolean;
  /**
   * Ab welcher Walze der Bonus noch offen war - oder `null`.
   *
   * Dies ist die einzige Grundlage der Bonus-Sweat-Inszenierung, und es ist
   * eine **Tatsache ueber das fertige Ergebnis**, keine Dramatisierung: ab
   * dieser Walze lagen genau ein Bonussymbol zu wenig, und jede weitere
   * Walze konnte den Bonus noch bringen. Die Oberflaeche laesst diese Walzen
   * laenger laufen; am Ergebnis, das hier schon feststeht, aendert das
   * nichts.
   *
   * `null` heisst: es war nie spannend. Dann darf auch nichts so aussehen -
   * ein vorgetaeuschter Sweat bei einem gewoehnlichen Gewinn waere eine
   * Luege ueber die Walzen.
   */
  sweatAbWalze: number | null;
}

/**
 * Gilt dieses Feld als `ziel`?
 *
 * Ein Wild gilt als alles - oder, wenn `wildErsetztAlles` aus ist, nur als
 * die gewoehnlichen Symbole. Logo, Premium und Bonus sind dann vom Wild
 * ausgenommen: ein Jackpot entstuende sonst aus vier Logos und einem Wild,
 * und das Wild waere das wertvollste Symbol im Spiel.
 */
function giltAls(feld: SpielSymbol, ziel: SpielSymbol, regeln: Spielregeln): boolean {
  if (feld.key === ziel.key) {
    return true;
  }
  if (feld.rolle !== 'WILD') {
    return false;
  }
  if (regeln.wildErsetztAlles) {
    return true;
  }
  return ziel.rolle === 'NORMAL';
}

/** Die Laenge der Kette ab Walze 1 fuer ein Zielsymbol. */
function kettenlaenge(felder: readonly SpielSymbol[], ziel: SpielSymbol, regeln: Spielregeln): number {
  let laenge = 0;
  for (const feld of felder) {
    if (!giltAls(feld, ziel, regeln)) {
      break;
    }
    laenge += 1;
  }
  return laenge;
}

/** Der beste Treffer einer Linie als Vielfaches des Einsatzes. */
export interface LinienFaktor {
  symbol: SpielSymbol;
  laenge: number;
  /**
   * Auszahlung als Vielfaches des Einsatzes - `0.04` sind vier Prozent.
   *
   * Hier endet die Basispunkt-Rechnung: gespeichert wird ganzzahlig, gerechnet
   * wird mit dem Vielfachen, und gerundet wird genau einmal, naemlich beim
   * Umrechnen in XP. Der Zwischenwert ist bewusst eine Fliesskommazahl, weil
   * die RTP-Rechnung Erwartungswerte aufaddiert und dort jede fruehe Rundung
   * die Quote verschoeben haette.
   */
  faktor: number;
  premiumTage: number;
  jackpot: boolean;
}

/**
 * Der beste Treffer auf einer Linie - als Faktor, nicht als XP.
 *
 * ## Warum der Faktor und nicht der Betrag
 *
 * Weil die RTP-Rechnung in `rtp.ts` denselben Code aufzaehlen muss, mit dem
 * gespielt wird - und sie rechnet in Faktoren, nicht in XP. Gaebe diese
 * Funktion gerundete XP zurueck, muesste die RTP-Rechnung die Regeln
 * nachbauen, und es gaebe zwei Vorstellungen davon, was eine Linie zahlt.
 * Die Rundung passiert eine Ebene hoeher, genau einmal.
 *
 * Geprueft wird jedes Symbol, das ueberhaupt auszahlt. Das Wild selbst zahlt
 * nur dann als eigenes Symbol, wenn ihm eine Auszahlung eingestellt ist;
 * standardmaessig ist sie 0, und dann ist das Wild ein Ersatz und kein
 * Gewinn.
 */
export function besterLinienfaktor(felder: readonly SpielSymbol[], regeln: Spielregeln): LinienFaktor | null {
  let bester: LinienFaktor | null = null;

  for (const ziel of regeln.symbole) {
    // Das Bonussymbol zahlt nicht auf Linien - es loest aus, und zwar ueberall.
    if (ziel.rolle === 'SCATTER') {
      continue;
    }
    if (ziel.rolle === 'PREMIUM' && !regeln.premiumAktiv) {
      continue;
    }

    const laenge = kettenlaenge(felder, ziel, regeln);
    if (laenge < 3) {
      continue;
    }

    const stufe = Math.min(laenge, 5) - 3;
    const tage = ziel.rolle === 'PREMIUM' ? (ziel.premiumTage[stufe] ?? 0) : 0;

    /*
     * Der Jackpot: fuenf Logos auf einer Linie.
     *
     * `jackpotNurEcht` verlangt fuenf **echte** Logos. Ohne diese Bedingung
     * waeren vier Logos und ein Wild derselbe Jackpot, und der grooesste
     * Gewinn des Spiels haette eine Hintertuer.
     */
    const jackpot =
      ziel.rolle === 'JACKPOT' &&
      laenge === 5 &&
      (!regeln.jackpotNurEcht || felder.slice(0, 5).every((feld) => feld.key === ziel.key));
    const faktor = jackpot ? regeln.jackpotMultiplikator : (ziel.auszahlung[stufe] ?? 0) / BASISPUNKTE;

    if (faktor <= 0 && tage <= 0) {
      continue;
    }

    /*
     * Besser heisst: mehr XP. Bei gleichem Faktor entscheidet die Zahl der
     * Premiumtage - sonst verschwaende ein Premiumtreffer, der dieselbe
     * Auszahlung ergibt wie ein gewoehnlicher, seinen eigentlichen Wert.
     */
    const besserAls =
      !bester || faktor > bester.faktor || (faktor === bester.faktor && tage > bester.premiumTage);
    if (besserAls) {
      bester = { symbol: ziel, laenge: Math.min(laenge, 5), faktor, premiumTage: tage, jackpot };
    }
  }

  return bester;
}

/** Derselbe Treffer in XP - der Faktor mal dem Einsatz, einmal gerundet. */
export function besterLinientreffer(
  felder: readonly SpielSymbol[],
  regeln: Spielregeln,
  einsatz: number,
): { symbol: SpielSymbol; laenge: number; gewinn: number; premiumTage: number; jackpot: boolean } | null {
  const bester = besterLinienfaktor(felder, regeln);
  if (!bester) {
    return null;
  }
  return {
    symbol: bester.symbol,
    laenge: bester.laenge,
    gewinn: Math.trunc(einsatz * bester.faktor),
    premiumTage: bester.premiumTage,
    jackpot: bester.jackpot,
  };
}

/**
 * Wertet ein Spielfeld vollstaendig aus.
 *
 * `einsatz` ist der Einsatz dieses Spins - bei einem Freispiel der im Paket
 * oder in der Bonusrunde festgehaltene, nie ein vom Browser gesendeter.
 */
export function werteAus(grid: readonly string[], regeln: Spielregeln, einsatz: number): Auswertung {
  const nachKey = new Map(regeln.symbole.map((symbol) => [symbol.key, symbol]));
  const felder = grid.map((key) => nachKey.get(key) ?? null);

  const treffer: LinienTreffer[] = [];
  let ungedeckelt = 0;
  let premiumTage = 0;
  let jackpot = false;

  for (let linie = 0; linie < LINIEN.length; linie += 1) {
    const zellen = linienZellen(linie);
    const reihe = zellen.map((index) => felder[index]);
    // Ein unbekannter Schluessel im Spielfeld: die Linie zaehlt nicht. Das
    // passiert nur, wenn ein Symbol nach dem Spin entfernt wurde - dann ist
    // «kein Gewinn» richtiger als ein geratener.
    if (reihe.some((feld) => feld === null)) {
      continue;
    }

    const bester = besterLinientreffer(reihe as SpielSymbol[], regeln, einsatz);
    if (!bester) {
      continue;
    }

    treffer.push({
      linie,
      symbolKey: bester.symbol.key,
      laenge: bester.laenge,
      gewinn: bester.gewinn,
      premiumTage: bester.premiumTage,
      jackpot: bester.jackpot,
      zellen: zellen.slice(0, bester.laenge),
    });
    ungedeckelt += bester.gewinn;
    premiumTage += bester.premiumTage;
    jackpot = jackpot || bester.jackpot;
  }

  const bonus = regeln.symbole.find((symbol) => symbol.rolle === 'SCATTER');
  const bonusZellen: number[] = [];
  if (bonus) {
    for (let index = 0; index < ZELLEN; index += 1) {
      if (grid[index] === bonus.key) {
        bonusZellen.push(index);
      }
    }
  }

  const deckel =
    regeln.maxGewinnMultiplikator > 0 ? Math.trunc(einsatz * regeln.maxGewinnMultiplikator) : null;
  const gewinn = deckel !== null ? Math.min(ungedeckelt, deckel) : ungedeckelt;

  return {
    treffer,
    gewinn,
    gewinnUngedeckelt: ungedeckelt,
    gedeckelt: deckel !== null && ungedeckelt > deckel,
    premiumTage,
    jackpot,
    bonusSymbole: bonusZellen.length,
    bonusZellen,
    bonusAusgeloest: bonusZellen.length >= regeln.bonusAusloeser,
    sweatAbWalze: sweatWalze(bonusZellen, regeln.bonusAusloeser),
  };
}

/**
 * Ab welcher Walze noch genau ein Bonussymbol fehlte.
 *
 * Gezaehlt wird walzenweise von links. Sobald der Zaehler «eins zu wenig»
 * erreicht und noch Walzen uebrig sind, ist das die Walze, deren Stopp
 * entscheidet. Bleibt der Zaehler darunter oder ist der Bonus schon vor der
 * letzten Walze voll, gibt es nichts zu zittern.
 */
export function sweatWalze(bonusZellen: readonly number[], ausloeser: number): number | null {
  if (ausloeser < 2) {
    return null;
  }
  const jeWalze = new Array<number>(WALZEN).fill(0);
  for (const index of bonusZellen) {
    jeWalze[Math.trunc(index / REIHEN)] = (jeWalze[Math.trunc(index / REIHEN)] ?? 0) + 1;
  }
  let gezaehlt = 0;
  for (let walze = 0; walze < WALZEN; walze += 1) {
    if (gezaehlt === ausloeser - 1 && walze < WALZEN) {
      return walze;
    }
    gezaehlt += jeWalze[walze] ?? 0;
  }
  return null;
}

/** Die Gewinnstufen - sie steuern Inszenierung und Auto-Spin-Stopps. */
export type Gewinnstufe = 'keine' | 'klein' | 'normal' | 'gross' | 'mega' | 'jackpot';

/**
 * Welche Stufe ein Gewinn erreicht.
 *
 * Die Schwellen sind Vielfache des Einsatzes und einstellbar, weil ein
 * «grosser Gewinn» bei 10 XP Einsatz etwas anderes ist als bei 500. «Klein»
 * ist alles unter dem Einsatz: man hat gewonnen und trotzdem verloren, und
 * das soll sich nicht wie ein Treffer anhoeren.
 */
export function gewinnstufe(
  gewinn: number,
  einsatz: number,
  schwellen: { gross: number; mega: number },
  jackpot = false,
): Gewinnstufe {
  if (jackpot) {
    return 'jackpot';
  }
  if (gewinn <= 0) {
    return 'keine';
  }
  if (einsatz <= 0) {
    return 'normal';
  }
  const vielfach = gewinn / einsatz;
  if (vielfach >= schwellen.mega) {
    return 'mega';
  }
  if (vielfach >= schwellen.gross) {
    return 'gross';
  }
  if (vielfach < 1) {
    return 'klein';
  }
  return 'normal';
}
