import { describe, expect, it } from 'vitest';
import { level } from '@swisshub/modules';
import { quelleAusSeed, type RandomSource } from '@swisshub/modules';

const S = level.xpslot;

/*
 * Die Typen ueber `typeof` statt ueber `Spielregeln`.
 *
 * `S` ist ein **Wert** (ein Namensraumobjekt), kein TypeScript-Namensraum -
 * `Spielregeln` als Typ sieht richtig aus, ist es aber nicht. Vitest
 * uebersetzt mit esbuild und verwirft Typen, also lief der Test; `tsc` wies
 * ihn zurueck. Genau diese Luecke hat das Quality Gate gefunden.
 */
type SpielSymbol = Parameters<typeof S.ziehSymbol>[0][number];
type Spielregeln = Parameters<typeof S.werteAus>[1];

/**
 * Die Spiellogik des XP-Slots.
 *
 * ## Warum hier keine Datenbank vorkommt
 *
 * Weil die Regeln keine brauchen. `dreheWalzen`, `werteAus` und
 * `gewinnstufe` sind reine Funktionen mit hereingegebener Zufallsquelle -
 * genau deshalb lassen sich Wild, Jackpot und Deckel hier mit von Hand
 * gelegten Spielfeldern pruefen, statt auf einen zufaelligen Treffer zu
 * warten.
 *
 * ## Warum die Spielfelder von Hand stehen
 *
 * Ein Test, der dreht, bis ein Jackpot fallt, laeuft im Mittel 275 000 Spins
 * und faellt gelegentlich aus. Ein Test, der das Spielfeld setzt, prueft die
 * Regel - und das ist die Frage.
 */

/** Ein Spielfeld aus walzenweisen Dreiergruppen: `['a','b','c'], ...`. */
function feld(...walzen: Array<[string, string, string]>): string[] {
  return walzen.flat();
}

const symbole = (teile: Partial<Record<string, Partial<SpielSymbol>>> = {}): SpielSymbol[] =>
  [
    /*
     * `x` ist das Fuellsymbol: bekannt, aber ohne Auszahlung.
     *
     * Ein frei erfundener Schluessel waere kein Fuellsymbol, sondern ein
     * unbekanntes - und `werteAus` ueberspringt eine Linie mit unbekanntem
     * Schluessel vollstaendig. Der Test haette dann nicht die Regel geprueft,
     * sondern den Rueckfall.
     */
    { key: 'x', rolle: 'NORMAL' as const, gewicht: 1, auszahlung: [0, 0, 0] as const },
    { key: 'a', rolle: 'NORMAL' as const, gewicht: 30, auszahlung: [1000, 4000, 13000] as const },
    { key: 'b', rolle: 'NORMAL' as const, gewicht: 20, auszahlung: [2000, 8000, 26000] as const },
    { key: 'logo', rolle: 'JACKPOT' as const, gewicht: 5, auszahlung: [13000, 66000, 0] as const },
    { key: 'wild', rolle: 'WILD' as const, gewicht: 7, auszahlung: [0, 0, 0] as const },
    { key: 'bonus', rolle: 'SCATTER' as const, gewicht: 3, auszahlung: [0, 0, 0] as const },
    { key: 'prem', rolle: 'PREMIUM' as const, gewicht: 2, auszahlung: [20000, 90000, 260000] as const },
  ].map((eintrag) => ({
    key: eintrag.key,
    rolle: eintrag.rolle,
    gewicht: eintrag.gewicht,
    auszahlung: eintrag.auszahlung as [number, number, number],
    premiumTage: (eintrag.key === 'prem' ? [1, 3, 7] : [0, 0, 0]) as [number, number, number],
    ...teile[eintrag.key],
  }));

const regeln = (teil: Partial<Spielregeln> = {}): Spielregeln => ({
  symbole: symbole(),
  jackpotMultiplikator: 500,
  jackpotNurEcht: true,
  wildErsetztAlles: false,
  bonusAusloeser: 3,
  maxGewinnMultiplikator: 2500,
  premiumAktiv: false,
  ...teil,
});

describe('Spielfeld und Linien', () => {
  it('hat fünf Walzen, drei Reihen und fünfzehn Zellen', () => {
    expect(S.WALZEN).toBe(5);
    expect(S.REIHEN).toBe(3);
    expect(S.ZELLEN).toBe(15);
  });

  it('hat genau zehn Linien, jede über alle fünf Walzen', () => {
    expect(S.LINIEN).toHaveLength(10);
    for (const linie of S.LINIEN) {
      expect(linie).toHaveLength(5);
      for (const reihe of linie) {
        expect(reihe).toBeGreaterThanOrEqual(0);
        expect(reihe).toBeLessThan(S.REIHEN);
      }
    }
  });

  it('berührt mit jeder Linie jede Walze genau einmal', () => {
    for (let index = 0; index < S.LINIEN.length; index += 1) {
      const zellen = S.linienZellen(index);
      const walzen = zellen.map((zelle) => Math.trunc(zelle / S.REIHEN));
      expect(walzen).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('hat keine zwei gleichen Linien', () => {
    const formen = S.LINIEN.map((linie) => linie.join(''));
    expect(new Set(formen).size).toBe(S.LINIEN.length);
  });

  it('dreht fünfzehn Zellen und nur ziehbare Symbole', () => {
    const grid = S.dreheWalzen(regeln(), quelleAusSeed('test-1'));
    expect(grid).toHaveLength(15);
    // Das Premiumsymbol ist aus - es darf nicht auf den Walzen liegen.
    expect(grid).not.toContain('prem');
  });

  it('lässt ein Symbol mit Gewicht 0 nicht auf die Walzen', () => {
    const ohneB = regeln({ symbole: symbole({ b: { gewicht: 0 } }) });
    const grid = S.dreheWalzen(ohneB, quelleAusSeed('test-2'));
    expect(grid).not.toContain('b');
  });

  it('setzt feste Wilds in die vorgegebenen Zellen', () => {
    const grid = S.dreheWalzen(regeln(), quelleAusSeed('test-3'), [0, 7, 14]);
    expect(grid[0]).toBe('wild');
    expect(grid[7]).toBe('wild');
    expect(grid[14]).toBe('wild');
  });

  it('wirft, wenn kein Symbol ziehbar ist', () => {
    const leer = regeln({
      symbole: symbole().map((eintrag) => ({ ...eintrag, gewicht: 0 })),
    });
    expect(() => S.dreheWalzen(leer, quelleAusSeed('test-4'))).toThrow(/unspielbar/u);
  });
});

describe('Auswertung', () => {
  /*
   * Linie 0 ist die Mittelreihe: Zellen 1, 4, 7, 10, 13 - also das zweite
   * Symbol jeder Walze. Die Felder unten legen dort die Kette.
   */
  const mitte = (...kette: string[]): string[] =>
    feld(
      ['x', kette[0] ?? 'x', 'x'],
      ['x', kette[1] ?? 'x', 'x'],
      ['x', kette[2] ?? 'x', 'x'],
      ['x', kette[3] ?? 'x', 'x'],
      ['x', kette[4] ?? 'x', 'x'],
    );

  it('zahlt nichts ohne Kette', () => {
    const ergebnis = S.werteAus(mitte('a', 'b', 'a', 'b', 'a'), regeln(), 100);
    expect(ergebnis.treffer).toHaveLength(0);
    expect(ergebnis.gewinn).toBe(0);
  });

  it('zahlt drei Gleiche von links', () => {
    const ergebnis = S.werteAus(mitte('a', 'a', 'a', 'b', 'b'), regeln(), 100);
    const treffer = ergebnis.treffer.find((eintrag) => eintrag.linie === 0);
    expect(treffer?.laenge).toBe(3);
    // 1000 bp von 100 XP = 10 XP.
    expect(treffer?.gewinn).toBe(10);
  });

  it('zählt nicht, was erst auf Walze 2 beginnt', () => {
    const ergebnis = S.werteAus(mitte('b', 'a', 'a', 'a', 'b'), regeln(), 100);
    expect(ergebnis.treffer.filter((eintrag) => eintrag.linie === 0)).toHaveLength(0);
  });

  it('zahlt vier und fünf Gleiche entsprechend höher', () => {
    const vier = S.werteAus(mitte('a', 'a', 'a', 'a', 'b'), regeln(), 100).treffer[0];
    const fuenf = S.werteAus(mitte('a', 'a', 'a', 'a', 'a'), regeln(), 100).treffer[0];
    expect(vier?.laenge).toBe(4);
    expect(vier?.gewinn).toBe(40);
    expect(fuenf?.laenge).toBe(5);
    expect(fuenf?.gewinn).toBe(130);
  });

  it('lässt das Wild ein gewöhnliches Symbol ersetzen', () => {
    const ergebnis = S.werteAus(mitte('a', 'wild', 'a', 'b', 'b'), regeln(), 100);
    const treffer = ergebnis.treffer.find((eintrag) => eintrag.linie === 0);
    expect(treffer?.symbolKey).toBe('a');
    expect(treffer?.laenge).toBe(3);
  });

  it('zahlt je Linie nur den höchsten Treffer', () => {
    /*
     * Drei Wilds koennten fuer `a`, `b` und `x` zaehlen. `x` zahlt nichts,
     * `b` zahlt mehr als `a` - also `b`. Fuer `logo` zaehlt das Wild nicht,
     * weil `wildErsetztAlles` aus ist, und Premium ist abgeschaltet.
     */
    const ergebnis = S.werteAus(mitte('wild', 'wild', 'wild', 'x', 'x'), regeln(), 100);
    const treffer = ergebnis.treffer.filter((eintrag) => eintrag.linie === 0);
    expect(treffer).toHaveLength(1);
    expect(treffer[0]?.symbolKey).toBe('b');
    expect(treffer[0]?.gewinn).toBe(20);
  });

  it('addiert mehrere Linien', () => {
    // Alle drei Reihen voll mit `a`: die drei Waagrechten treffen, dazu die
    // Zickzacklinien, die ebenfalls nur `a` berühren.
    const voll = feld(['a', 'a', 'a'], ['a', 'a', 'a'], ['a', 'a', 'a'], ['a', 'a', 'a'], ['a', 'a', 'a']);
    const ergebnis = S.werteAus(voll, regeln(), 100);
    expect(ergebnis.treffer).toHaveLength(10);
    expect(ergebnis.gewinn).toBe(10 * 130);
  });

  it('zahlt den Jackpot nur bei fünf echten Logos', () => {
    const echt = S.werteAus(mitte('logo', 'logo', 'logo', 'logo', 'logo'), regeln(), 100);
    expect(echt.jackpot).toBe(true);
    expect(echt.treffer[0]?.gewinn).toBe(100 * 500);

    const mitWild = S.werteAus(mitte('logo', 'logo', 'logo', 'logo', 'wild'), regeln(), 100);
    expect(mitWild.jackpot).toBe(false);
  });

  it('erlaubt den Jackpot mit Wild, wenn es so eingestellt ist', () => {
    const offen = regeln({ jackpotNurEcht: false, wildErsetztAlles: true });
    const ergebnis = S.werteAus(mitte('logo', 'logo', 'logo', 'logo', 'wild'), offen, 100);
    expect(ergebnis.jackpot).toBe(true);
  });

  it('deckelt den Gesamtgewinn, nicht die einzelne Linie', () => {
    const voll = feld(
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
    );
    const ergebnis = S.werteAus(voll, regeln({ maxGewinnMultiplikator: 1000 }), 100);
    expect(ergebnis.gewinnUngedeckelt).toBe(10 * 100 * 500);
    expect(ergebnis.gewinn).toBe(100 * 1000);
    expect(ergebnis.gedeckelt).toBe(true);
  });

  it('zahlt ohne Deckel alles aus', () => {
    const voll = feld(
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
      ['logo', 'logo', 'logo'],
    );
    const ergebnis = S.werteAus(voll, regeln({ maxGewinnMultiplikator: 0 }), 100);
    expect(ergebnis.gedeckelt).toBe(false);
    expect(ergebnis.gewinn).toBe(10 * 100 * 500);
  });

  it('löst den Bonus ohne Linie aus - drei irgendwo genügen', () => {
    const verstreut = feld(
      ['bonus', 'x', 'x'],
      ['x', 'x', 'x'],
      ['x', 'x', 'bonus'],
      ['x', 'x', 'x'],
      ['x', 'bonus', 'x'],
    );
    const ergebnis = S.werteAus(verstreut, regeln(), 100);
    expect(ergebnis.bonusSymbole).toBe(3);
    expect(ergebnis.bonusAusgeloest).toBe(true);
    expect(ergebnis.treffer).toHaveLength(0);
  });

  it('löst den Bonus bei zwei Symbolen nicht aus', () => {
    const zwei = feld(
      ['bonus', 'x', 'x'],
      ['x', 'x', 'x'],
      ['x', 'x', 'bonus'],
      ['x', 'x', 'x'],
      ['x', 'x', 'x'],
    );
    const ergebnis = S.werteAus(zwei, regeln(), 100);
    expect(ergebnis.bonusAusgeloest).toBe(false);
  });

  it('zahlt Premium-Tage nur bei eingeschaltetem Premium', () => {
    const aus = S.werteAus(mitte('prem', 'prem', 'prem', 'x', 'x'), regeln(), 100);
    expect(aus.premiumTage).toBe(0);

    const an = S.werteAus(mitte('prem', 'prem', 'prem', 'x', 'x'), regeln({ premiumAktiv: true }), 100);
    expect(an.premiumTage).toBe(1);
    expect(an.gewinn).toBe(200);
  });

  it('übersteht einen unbekannten Symbolschlüssel im Spielfeld', () => {
    const ergebnis = S.werteAus(mitte('weg', 'weg', 'weg', 'x', 'x'), regeln(), 100);
    expect(ergebnis.gewinn).toBe(0);
  });
});

describe('Bonus-Sweat', () => {
  it('nennt die Walze, ab der genau ein Bonussymbol fehlte', () => {
    // Zwei Bonussymbole auf den Walzen 0 und 1 - ab Walze 2 war es offen.
    expect(S.sweatWalze([0, 3], 3)).toBe(2);
  });

  it('nennt keine Walze, wenn es nie spannend war', () => {
    expect(S.sweatWalze([], 3)).toBeNull();
    expect(S.sweatWalze([0], 3)).toBeNull();
  });

  it('nennt die Walze auch dann, wenn der Bonus dort fällt', () => {
    /*
     * Zwei Bonussymbole auf Walze 0, das dritte auf Walze 1. Ab Walze 1 war
     * es offen - und genau dort fiel es. Das ist der spannendste Fall und
     * nicht der langweiligste: die Inszenierung soll ihn zeigen.
     */
    expect(S.sweatWalze([0, 1, 3], 3)).toBe(1);
  });

  it('nennt keine Walze, wenn der Bonus auf der ersten schon voll war', () => {
    // Drei Bonussymbole auf Walze 0: es war zu keinem Zeitpunkt «eins zu
    // wenig», also gibt es nichts zu zittern.
    expect(S.sweatWalze([0, 1, 2], 3)).toBeNull();
  });

  it('erkennt den Sweat auf der letzten Walze', () => {
    expect(S.sweatWalze([0, 3, 6, 9], 5)).toBe(4);
  });
});

describe('Gewinnstufen', () => {
  const schwellen = { gross: 10, mega: 25 };

  it('nennt keinen Gewinn «keine»', () => {
    expect(S.gewinnstufe(0, 100, schwellen)).toBe('keine');
  });

  it('nennt einen Gewinn unter dem Einsatz «klein»', () => {
    expect(S.gewinnstufe(40, 100, schwellen)).toBe('klein');
  });

  it('nennt alles ab dem Einsatz «normal»', () => {
    expect(S.gewinnstufe(100, 100, schwellen)).toBe('normal');
    expect(S.gewinnstufe(900, 100, schwellen)).toBe('normal');
  });

  it('nennt ab der Big-Win-Schwelle «gross»', () => {
    expect(S.gewinnstufe(1000, 100, schwellen)).toBe('gross');
  });

  it('nennt ab der Mega-Schwelle «mega»', () => {
    expect(S.gewinnstufe(2500, 100, schwellen)).toBe('mega');
  });

  it('nennt einen Jackpot «jackpot», unabhängig von der Höhe', () => {
    expect(S.gewinnstufe(10, 100, schwellen, true)).toBe('jackpot');
  });

  it('trennt an genau der eingestellten Schwelle', () => {
    /*
     * Die vier Faelle, die das Konzept nennt - bei Big 10x und Mega 25x. Sie
     * stehen hier als Grenzfaelle, weil zwischen «9x» und «10x» die ganze
     * Inszenierung haengt: ab der Schwelle faehrt eine grosse Meldung auf.
     */
    expect(S.gewinnstufe(900, 100, schwellen)).toBe('normal');
    expect(S.gewinnstufe(1000, 100, schwellen)).toBe('gross');
    expect(S.gewinnstufe(2400, 100, schwellen)).toBe('gross');
    expect(S.gewinnstufe(2500, 100, schwellen)).toBe('mega');
  });

  it('richtet sich nach den eingestellten Schwellen und nicht nach festen Zahlen', () => {
    // Dieselben Gewinne, andere Konfiguration - andere Stufen.
    const streng = { gross: 20, mega: 50 };
    expect(S.gewinnstufe(1000, 100, streng)).toBe('normal');
    expect(S.gewinnstufe(2000, 100, streng)).toBe('gross');
    expect(S.gewinnstufe(5000, 100, streng)).toBe('mega');
  });
});

describe('Zufallsquelle', () => {
  it('ist nachrechenbar, wenn ein Seed hereingegeben wird', () => {
    const eins = S.dreheWalzen(regeln(), quelleAusSeed('gleich'));
    const zwei = S.dreheWalzen(regeln(), quelleAusSeed('gleich'));
    expect(eins).toEqual(zwei);
  });

  it('zieht Symbole entsprechend ihrem Gewicht', () => {
    /*
     * Eine Quelle, die der Reihe nach jede Zahl zurueckgibt. Damit laesst
     * sich pruefen, dass die Gewichtsachse stimmt - ohne auf Statistik zu
     * hoffen.
     */
    let zaehler = 0;
    const reihum: RandomSource = {
      integer: () => zaehler++,
      hex: () => '00',
    };
    const liste = symbole().filter((eintrag) => eintrag.gewicht > 0);
    const summe = liste.reduce((wert, eintrag) => wert + eintrag.gewicht, 0);

    const gezogen = new Map<string, number>();
    for (let index = 0; index < summe; index += 1) {
      const symbol = S.ziehSymbol(liste, reihum);
      gezogen.set(symbol.key, (gezogen.get(symbol.key) ?? 0) + 1);
    }
    for (const eintrag of liste) {
      expect(gezogen.get(eintrag.key)).toBe(eintrag.gewicht);
    }
  });
});
