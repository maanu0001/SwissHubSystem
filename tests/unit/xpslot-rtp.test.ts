import { describe, expect, it } from 'vitest';
import { level, quelleAusSeed } from '@swisshub/modules';

const S = level.xpslot;

/*
 * Die Typen ueber `typeof`, nicht ueber `Spielregeln`.
 *
 * Begruendung wie in `xpslot-logik.test.ts`: `S` ist ein Wert, kein
 * TypeScript-Namensraum. Vitest haette es durchgelassen, `tsc` nicht.
 */
type Spielregeln = Parameters<typeof S.rechneRtp>[0];
type BonusAnnahmen = Parameters<typeof S.rechneRtp>[1];
type SpielSymbol = Spielregeln['symbole'][number];

/**
 * Die Auszahlungsquote des XP-Slots.
 *
 * ## Warum hier gerechnet und nicht simuliert wird
 *
 * Weil es geht. Jede der 15 Zellen wird unabhaengig gezogen, eine Linie
 * besteht also aus fuenf unabhaengigen Ziehungen - und die lassen sich
 * vollstaendig aufzaehlen. Die Quote ist damit **exakt**, nicht geschaetzt.
 *
 * Die Simulation weiter unten ist eine Plausibilitaetspruefung und kein
 * Ersatz: sie zeigt, dass die aufgezaehlte Zahl und das tatsaechliche Drehen
 * zusammenpassen. Sie laeuft mit festem Seed, damit sie nicht gelegentlich
 * ausfaellt, und ihre Grenzen sind weit - eine Simulation mit 60 000 Spins
 * schwankt um mehrere Prozentpunkte, weil ein einzelner Jackpot mehr
 * ausschuettet als tausend gewoehnliche Spins.
 */

const vorgabeRegeln = (teil: Partial<Spielregeln> = {}): Spielregeln => ({
  symbole: S.SYMBOL_VORGABEN.map((eintrag): SpielSymbol => ({
    key: eintrag.key,
    rolle: eintrag.rolle,
    gewicht: eintrag.gewicht,
    auszahlung: eintrag.auszahlung,
    premiumTage: eintrag.premiumTage,
  })),
  jackpotMultiplikator: S.KONFIG_VORGABEN.jackpotMultiplikator,
  jackpotNurEcht: S.KONFIG_VORGABEN.jackpotNurEcht,
  wildErsetztAlles: S.KONFIG_VORGABEN.wildErsetztAlles,
  bonusAusloeser: S.KONFIG_VORGABEN.bonusAusloeser,
  maxGewinnMultiplikator: S.KONFIG_VORGABEN.maxGewinnMultiplikator,
  premiumAktiv: false,
  ...teil,
});

const vorgabeBonus = (teil: Partial<BonusAnnahmen> = {}): BonusAnnahmen => ({
  freispiele: S.KONFIG_VORGABEN.bonusFreispiele,
  leiter1: S.KONFIG_VORGABEN.leiter1,
  leiter2: S.KONFIG_VORGABEN.leiter2,
  chance1: S.KONFIG_VORGABEN.gambleChance1Bp / S.BASISPUNKTE,
  chance2: S.KONFIG_VORGABEN.gambleChance2Bp / S.BASISPUNKTE,
  retriggerSpins: S.KONFIG_VORGABEN.retriggerSpins,
  stickyWilds: S.KONFIG_VORGABEN.stickyWilds,
  ...teil,
});

describe('Die Vorgaben', () => {
  it('liegen in der Zielspanne von 92 bis 95 Prozent', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    expect(ergebnis.fehler).toEqual([]);
    expect(ergebnis.rtp).toBeGreaterThanOrEqual(S.RTP_ZIEL_MIN);
    expect(ergebnis.rtp).toBeLessThanOrEqual(S.RTP_ZIEL_MAX);
    expect(S.rtpLage(ergebnis.rtp)).toBe('im_ziel');
  });

  it('schütten den grösseren Teil im Grundspiel aus', () => {
    /*
     * Ein Automat, der fast alles ueber das Bonusspiel ausschuettet, fuehlt
     * sich zwischen zwei Bonusrunden wie ein Totalausfall an. Die Vorgaben
     * sollen den grooesseren Teil im Grundspiel zahlen.
     */
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    expect(ergebnis.rtpGrundspiel).toBeGreaterThan(ergebnis.rtpBonus);
  });

  it('machen die Risikoleiter etwa neutral', () => {
    /*
     * Der wichtigste Wert der Vorgaben. Freispiele mit Sticky Wilds sind
     * ueberproportional wertvoll; bei 50 Prozent Chance waere Riskieren
     * lohnend und die Quote stiege ueber 100 Prozent. Mit den Vorgaben
     * duerfen Nehmen und Riskieren nicht mehr als ein Prozent auseinander
     * liegen.
     */
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const ohne = ergebnis.rtpGrundspiel + ergebnis.rtpBonusOhneRisiko;
    expect(Math.abs(ergebnis.rtp - ohne)).toBeLessThan(0.01);
  });

  it('lösen den Bonus selten, aber nicht nie aus', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    expect(1 / ergebnis.bonusChance).toBeGreaterThan(40);
    expect(1 / ergebnis.bonusChance).toBeLessThan(400);
  });

  it('machen den Jackpot zu einem seltenen Ereignis', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    expect(1 / ergebnis.jackpotChance).toBeGreaterThan(50_000);
  });
});

describe('Was in die Quote einfliesst', () => {
  it('rechnet den Jackpot mit', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    expect(ergebnis.rtpJackpot).toBeGreaterThan(0);

    const ohne = S.rechneRtp(vorgabeRegeln({ jackpotMultiplikator: 1 }), vorgabeBonus());
    expect(ohne.rtp).toBeLessThan(ergebnis.rtp);
  });

  it('rechnet die Freispiele mit', () => {
    const mit = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const ohne = S.rechneRtp(vorgabeRegeln(), vorgabeBonus({ freispiele: 0, leiter1: 0, leiter2: 0 }));
    expect(ohne.rtpBonus).toBe(0);
    expect(ohne.rtp).toBeLessThan(mit.rtp);
  });

  it('rechnet die Sticky Wilds mit - sie machen die Freispiele viel wertvoller', () => {
    const mit = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const ohne = S.rechneRtp(vorgabeRegeln(), vorgabeBonus({ stickyWilds: false }));
    expect(mit.rtpBonus).toBeGreaterThan(ohne.rtpBonus * 3);
  });

  it('rechnet den Retrigger mit', () => {
    const mit = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const ohne = S.rechneRtp(vorgabeRegeln(), vorgabeBonus({ retriggerSpins: 0 }));
    expect(mit.freispieleJeBonus).toBeGreaterThan(ohne.freispieleJeBonus);
  });

  it('rechnet das Wild mit', () => {
    const regeln = vorgabeRegeln();
    const ohneWild = vorgabeRegeln({
      symbole: regeln.symbole.map((eintrag) =>
        eintrag.rolle === 'WILD' ? { ...eintrag, gewicht: 0 } : eintrag,
      ),
    });
    expect(S.rechneRtp(ohneWild, vorgabeBonus()).rtp).toBeLessThan(S.rechneRtp(regeln, vorgabeBonus()).rtp);
  });

  it('steigt, wenn das Wild auch Logo und Premium ersetzt', () => {
    const streng = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const offen = S.rechneRtp(vorgabeRegeln({ wildErsetztAlles: true }), vorgabeBonus());
    expect(offen.rtp).toBeGreaterThan(streng.rtp);
  });

  it('weist Premium-Tage neben der XP-Quote aus und nicht darin', () => {
    const aus = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const an = S.rechneRtp(vorgabeRegeln({ premiumAktiv: true }), vorgabeBonus());
    expect(aus.premiumTageJe1000).toBe(0);
    expect(an.premiumTageJe1000).toBeGreaterThan(0);
    expect(an.hinweise.join(' ')).toContain('Premium-Tage sind keine XP');
  });
});

describe('Reaktion auf Änderungen', () => {
  it('ändert sich, wenn die Auszahlungstabelle sich ändert', () => {
    const vorher = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    const doppelt = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) => ({
        ...eintrag,
        auszahlung: eintrag.auszahlung.map((wert) => wert * 2) as [number, number, number],
      })),
    });
    const nachher = S.rechneRtp(doppelt, vorgabeBonus());
    expect(nachher.rtp).toBeGreaterThan(vorher.rtp * 1.9);
  });

  it('ändert sich, wenn ein Gewicht sich ändert', () => {
    const haeufigeresLogo = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) =>
        eintrag.rolle === 'JACKPOT' ? { ...eintrag, gewicht: 20 } : eintrag,
      ),
    });
    expect(S.rechneRtp(haeufigeresLogo, vorgabeBonus()).rtp).not.toBeCloseTo(
      S.rechneRtp(vorgabeRegeln(), vorgabeBonus()).rtp,
      4,
    );
  });

  it('warnt unter 92 Prozent', () => {
    const karg = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) => ({
        ...eintrag,
        auszahlung: eintrag.auszahlung.map((wert) => Math.trunc(wert / 4)) as [number, number, number],
      })),
    });
    const ergebnis = S.rechneRtp(karg, vorgabeBonus());
    expect(ergebnis.rtp).toBeLessThan(S.RTP_ZIEL_MIN);
    expect(S.rtpLage(ergebnis.rtp)).toBe('zu_tief');
    // Eine Warnung, keine Sperre: 80 Prozent sind streng und kein Defekt.
    expect(S.spielbar(ergebnis)).toBe(true);
  });

  it('warnt über 95 Prozent', () => {
    const grosszuegig = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) => ({
        ...eintrag,
        auszahlung: eintrag.auszahlung.map((wert) => wert * 2) as [number, number, number],
      })),
    });
    const ergebnis = S.rechneRtp(grosszuegig, vorgabeBonus());
    expect(S.rtpLage(ergebnis.rtp)).toBe('zu_hoch');
    expect(S.spielbar(ergebnis)).toBe(true);
  });

  it('meldet eine lohnende Risikoleiter als Hinweis', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus({ chance1: 0.5, chance2: 0.5 }));
    expect(ergebnis.rtp).toBeGreaterThan(ergebnis.rtpGrundspiel + ergebnis.rtpBonusOhneRisiko);
    expect(ergebnis.leiterWahl.some((stufe) => stufe.besser === 'riskieren')).toBe(true);
    expect(ergebnis.hinweise.join(' ')).toContain('Risikoleiter lohnt sich');
  });
});

describe('Unspielbare Konfigurationen', () => {
  it('sperrt eine Konfiguration ohne ziehbares Symbol', () => {
    const leer = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) => ({ ...eintrag, gewicht: 0 })),
    });
    const ergebnis = S.rechneRtp(leer, vorgabeBonus());
    expect(S.spielbar(ergebnis)).toBe(false);
    expect(ergebnis.rtp).toBe(0);
  });

  it('sperrt eine Bonusrunde, die im Mittel nicht endet', () => {
    const haeufigerBonus = vorgabeRegeln({
      symbole: vorgabeRegeln().symbole.map((eintrag) =>
        eintrag.rolle === 'SCATTER' ? { ...eintrag, gewicht: 60 } : eintrag,
      ),
    });
    const ergebnis = S.rechneRtp(haeufigerBonus, vorgabeBonus({ retriggerSpins: 20 }));
    expect(S.spielbar(ergebnis)).toBe(false);
    expect(ergebnis.fehler.join(' ')).toContain('nicht endet');
  });
});

describe('Der Höchstgewinn', () => {
  it('nennt das theoretische Maximum und ob der Deckel greift', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln(), vorgabeBonus());
    // Zehn Linien mal dem Jackpot-Multiplikator.
    expect(ergebnis.maxFaktor).toBe(10 * S.KONFIG_VORGABEN.jackpotMultiplikator);
    expect(ergebnis.deckelErreichbar).toBe(true);
  });

  it('sagt, wenn der Deckel nie greift', () => {
    const ergebnis = S.rechneRtp(vorgabeRegeln({ maxGewinnMultiplikator: 999_999 }), vorgabeBonus());
    expect(ergebnis.deckelErreichbar).toBe(false);
    expect(ergebnis.hinweise.join(' ')).toContain('greift nie');
  });
});

describe('Plausibilitätsprüfung durch Simulation', () => {
  /**
   * Dreht das Grundspiel und vergleicht mit der aufgezaehlten Quote.
   *
   * Nur das Grundspiel: eine Bonusrunde samt Freispielen und Sticky Wilds zu
   * simulieren waere ein zweiter Spielablauf im Test, und der muesste dann
   * selbst geprueft werden. Die Freispiele sind exakt gerechnet; hier wird
   * geprueft, dass die Aufzaehlung des Grundspiels zum echten Drehen passt.
   */
  it('bestätigt die aufgezählte Quote des Grundspiels', () => {
    const regeln = vorgabeRegeln();
    const erwartet = S.rechneRtp(regeln, vorgabeBonus()).rtpGrundspiel;

    const einsatz = 10_000;
    const spins = 60_000;
    let gewinn = 0;
    const quelle = quelleAusSeed('rtp-plausibel');
    for (let index = 0; index < spins; index += 1) {
      const grid = S.dreheWalzen(regeln, quelle);
      gewinn += S.werteAus(grid, regeln, einsatz).gewinnUngedeckelt;
    }
    const gemessen = gewinn / (spins * einsatz);

    /*
     * Die Grenze ist weit, und das ist kein Nachlassen: ein einzelner
     * Jackpot zahlt 500 Einsaetze, also verschiebt er die gemessene Quote
     * dieser Stichprobe um fast einen Prozentpunkt. Eine engere Grenze waere
     * ein Test, der gelegentlich ausfaellt - und ein Test, der gelegentlich
     * ausfaellt, wird irgendwann abgeschaltet.
     */
    expect(Math.abs(gemessen - erwartet)).toBeLessThan(0.08);
  });

  it('bestätigt die Bonuschance', () => {
    const regeln = vorgabeRegeln();
    const erwartet = S.rechneRtp(regeln, vorgabeBonus()).bonusChance;

    const spins = 60_000;
    let bonus = 0;
    const quelle = quelleAusSeed('bonus-plausibel');
    for (let index = 0; index < spins; index += 1) {
      if (S.werteAus(S.dreheWalzen(regeln, quelle), regeln, 10).bonusAusgeloest) {
        bonus += 1;
      }
    }
    const gemessen = bonus / spins;
    expect(gemessen).toBeGreaterThan(erwartet * 0.7);
    expect(gemessen).toBeLessThan(erwartet * 1.3);
  });
});

describe('Hilfsrechnungen', () => {
  it('rechnet «mindestens k von 15» richtig', () => {
    expect(S.mindestens(0, 0.1)).toBe(1);
    expect(S.mindestens(1, 0)).toBe(0);
    // Mindestens eines von 15 bei 10 Prozent: 1 - 0.9^15.
    expect(S.mindestens(1, 0.1)).toBeCloseTo(1 - 0.9 ** 15, 10);
    expect(S.mindestens(16, 0.5)).toBe(0);
  });
});
