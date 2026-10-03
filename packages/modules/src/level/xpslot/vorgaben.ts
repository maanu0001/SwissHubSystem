/**
 * Die Vorgaben des XP-Slots: Symbole, Einsaetze, Klangslots.
 *
 * ## Warum Vorgaben im Code und Werte in der Datenbank
 *
 * Dieselbe Aufteilung wie bei den gerechneten Auszeichnungen: der **Bauplan**
 * steht im Code, die **Werte** stehen in der Datenbank. Welche acht Symbole es
 * gibt und welche Rolle jedes im Spiel hat, ist eine Aussage ueber das Spiel -
 * ein neunter Symbolschluessel braeuchte Auswertungsregeln, ein Bild in der
 * Infotafel und eine Zeile in der RTP-Rechnung. Gewicht, Auszahlung, Bild und
 * Name sind dagegen Einstellungen, und sie liegen in `XpSlotSymbol`.
 *
 * Deshalb kann die Verwaltung jedes Symbol austauschen, umbenennen,
 * abschalten und neu gewichten - aber nicht erfinden.
 *
 * ## Woher die Zahlen kommen
 *
 * Nicht aus dem Gefuehl: die Gewichte und Auszahlungen unten sind so gewaehlt,
 * dass `rechneRtp` auf eine Quote in der Zielspanne von 92 bis 95 Prozent
 * kommt. `tests/unit/xpslot-rtp.test.ts` prueft genau das - wer hier eine Zahl
 * aendert, bekommt es gesagt.
 */

import type { XpSlotSymbolRole } from '@swisshub/database';

/** Ein Symbol, wie es im Code steht. */
export interface SymbolVorgabe {
  key: string;
  name: string;
  rolle: XpSlotSymbolRole;
  gewicht: number;
  /** Drei, vier, fuenf Gleiche - in Basispunkten des Einsatzes, 10000 = 1x. */
  auszahlung: [number, number, number];
  /** Nur beim Premiumsymbol: Tage statt XP. */
  premiumTage: [number, number, number];
  glow: boolean;
  /** Was das Symbol im Spiel tut - steht auf der Infotafel. */
  beschreibung: string;
}

/**
 * Die acht Symbole.
 *
 * Die vier Zahlensymbole sind die Grundlage: sie kommen oft und zahlen wenig.
 * Logo, Wild und Bonus sind selten. Das Premiumsymbol ist das seltenste und
 * standardmaessig gar nicht im Spiel - es kommt erst mit einer aktiven
 * Premiumkonfiguration auf die Walzen.
 *
 * ## Die Zahlen, und warum genau diese
 *
 * Mit diesen Werten rechnet `rechneRtp` eine Quote von 92,6 Prozent, davon
 * 55 Punkte aus dem Grundspiel und 37 aus den Freispielen. Das Verhaeltnis
 * ist Absicht: ein Automat, der fast alles ueber das Bonusspiel ausschuettet,
 * fuehlt sich zwischen zwei Bonusrunden wie ein Totalausfall an.
 *
 * Das Premiumsymbol zahlt **XP und Tage**. Nur Tage waere ein Gewicht, das
 * die Quote senkt, ohne in XP etwas zurueckzugeben - jedes Event mit Premium
 * waere automatisch ein strengerer Automat. Dass es trotzdem rund fuenf
 * Punkte Quote kostet, es ueberhaupt einzuschalten, liegt an der
 * Verwaesserung aller anderen Gewichte; die Eventpruefung rechnet die Quote
 * nach und sagt es.
 */
export const SYMBOL_VORGABEN: readonly SymbolVorgabe[] = [
  {
    key: 'eins',
    name: '1',
    rolle: 'NORMAL',
    gewicht: 30,
    auszahlung: [1000, 4000, 13000],
    premiumTage: [0, 0, 0],
    glow: false,
    beschreibung: 'Das häufigste Symbol. Drei davon holen einen Teil des Einsatzes zurück.',
  },
  {
    key: 'drei',
    name: '3',
    rolle: 'NORMAL',
    gewicht: 24,
    auszahlung: [1600, 6500, 24000],
    premiumTage: [0, 0, 0],
    glow: false,
    beschreibung: 'Häufig, zahlt etwas besser als die 1.',
  },
  {
    key: 'fuenf',
    name: '5',
    rolle: 'NORMAL',
    gewicht: 17,
    auszahlung: [3200, 13000, 48000],
    premiumTage: [0, 0, 0],
    glow: false,
    beschreibung: 'Mittelhäufig. Fünf davon sind ein ordentlicher Treffer.',
  },
  {
    key: 'zehn',
    name: '10',
    rolle: 'NORMAL',
    gewicht: 11,
    auszahlung: [6500, 26500, 106000],
    premiumTage: [0, 0, 0],
    glow: true,
    beschreibung: 'Das wertvollste Zahlensymbol - fünf davon zahlen mehr als zehn Einsätze.',
  },
  {
    key: 'logo',
    name: 'SwissHub Logo',
    rolle: 'JACKPOT',
    gewicht: 5,
    auszahlung: [13000, 66000, 0],
    premiumTage: [0, 0, 0],
    glow: true,
    beschreibung: 'Fünf echte Logos auf einer Linie sind der Jackpot. Das Wild ersetzt das Logo dafür nicht.',
  },
  {
    key: 'wild',
    name: 'Wild',
    rolle: 'WILD',
    gewicht: 7,
    auszahlung: [0, 0, 0],
    premiumTage: [0, 0, 0],
    glow: true,
    beschreibung:
      'Ersetzt jedes gewöhnliche Symbol und vervollständigt damit Linien. In Freispielen bleibt es stehen.',
  },
  {
    key: 'bonus',
    name: 'Bonus',
    rolle: 'SCATTER',
    gewicht: 3,
    auszahlung: [0, 0, 0],
    premiumTage: [0, 0, 0],
    glow: true,
    beschreibung: 'Drei davon - irgendwo auf dem Feld, keine Linie nötig - starten die Bonusrunde.',
  },
  {
    key: 'premium',
    name: 'Premium',
    rolle: 'PREMIUM',
    gewicht: 1,
    auszahlung: [20000, 90000, 260000],
    premiumTage: [1, 3, 7],
    glow: true,
    beschreibung:
      'Das seltenste Symbol. Zahlt XP und zusätzlich Premium-Tage. Nur im Spiel, solange eine Premiumkonfiguration aktiv ist.',
  },
];

/** Die Einsaetze, die ohne weitere Einstellung spielbar sind. */
export const EINSATZ_VORGABEN: readonly number[] = [10, 25, 50, 100, 250, 500];

/**
 * Die Vorgaben der Konfiguration.
 *
 * Sie stehen hier und nicht nur als Prisma-Standardwerte, weil zwei Stellen
 * sie brauchen: das Anlegen der Zeile beim ersten Aufruf und die Pruefung in
 * den Tests. Zwei Kopien derselben Zahl liefen auseinander.
 */
export const KONFIG_VORGABEN = {
  jackpotMultiplikator: 500,
  jackpotNurEcht: true,
  wildErsetztAlles: false,
  bonusAusloeser: 3,
  bonusFreispiele: 8,
  leiter1: 12,
  leiter2: 16,
  /**
   * Die Chancen der Risikoleiter in Basispunkten - 3400 sind 34 Prozent.
   *
   * Nicht 50 Prozent, und das ist der wichtigste Wert in dieser Datei.
   * Freispiele mit Sticky Wilds sind ueberproportional wertvoll: zwoelf sind
   * fast dreimal so viel wert wie acht, nicht anderthalbmal. Bei einer
   * Chance von 50 Prozent waere Riskieren deshalb lohnend, und ein Automat,
   * bei dem Riskieren lohnt, zahlt an aufmerksame Spieler 114 Prozent aus.
   *
   * Mit 34 und 46 Prozent sind Nehmen und Riskieren etwa gleich viel wert.
   * Die Entscheidung bleibt spannend und kostet die Quote nichts - und
   * `rechneRtp` warnt, wenn jemand sie verschiebt.
   */
  gambleChance1Bp: 3400,
  gambleChance2Bp: 4600,
  retriggerSpins: 3,
  stickyWilds: true,
  /**
   * Der Hoechstgewinn je Spin als Vielfaches des Einsatzes.
   *
   * Theoretisch moeglich sind 5000x - zehn Jackpotlinien gleichzeitig. 2500
   * laesst einen Jackpot samt allem, was auf den anderen Linien dazukommt,
   * unangetastet und begrenzt nur das praktisch Unmoegliche. Ein Deckel, der
   * den grooessten Moment des Spiels abschneidet, waere der falsche Deckel.
   */
  maxGewinnMultiplikator: 2500,
  tierGross: 10,
  tierMega: 25,
} as const;

/** Die erlaubten Auto-Spin-Zahlen. Niemals unbegrenzt. */
export const AUTO_SPIN_VORGABEN: readonly number[] = [10, 25, 50, 100];

/**
 * Die Klangslots.
 *
 * Eine geschlossene Liste, weil jeder Slot an einer Stelle im Spiel
 * abgespielt wird - ein freier Name waere eine Datei, die niemand hoert. Die
 * Oberflaeche fragt ausschliesslich nach diesen Schluesseln; ein fehlender
 * Klang ist still und bricht nichts ab.
 */
export const KLANG_SLOTS = [
  { key: 'ui_button', label: 'UI-Knopf', gruppe: 'Oberfläche' },
  { key: 'spin_start', label: 'Spin-Start', gruppe: 'Walzen' },
  { key: 'reel_loop', label: 'Walzenlauf (Schleife)', gruppe: 'Walzen' },
  { key: 'reel_stop', label: 'Walzenstopp', gruppe: 'Walzen' },
  { key: 'no_win', label: 'Kein Gewinn', gruppe: 'Gewinn' },
  { key: 'win_small', label: 'Kleiner Gewinn', gruppe: 'Gewinn' },
  { key: 'win_normal', label: 'Normaler Gewinn', gruppe: 'Gewinn' },
  { key: 'win_big', label: 'Big Win', gruppe: 'Gewinn' },
  { key: 'win_mega', label: 'Mega Win', gruppe: 'Gewinn' },
  { key: 'jackpot', label: 'Jackpot', gruppe: 'Gewinn' },
  { key: 'bonus_trigger', label: 'Bonus ausgelöst', gruppe: 'Bonus' },
  { key: 'bonus_sweat', label: 'Bonus-Sweat', gruppe: 'Bonus' },
  { key: 'bonus_reveal', label: 'Bonus-Auflösung', gruppe: 'Bonus' },
  { key: 'freespin_start', label: 'Freispiele starten', gruppe: 'Freispiele' },
  { key: 'freespin_loop', label: 'Freispiel-Musik', gruppe: 'Freispiele' },
  { key: 'freespin_end', label: 'Freispiele vorbei', gruppe: 'Freispiele' },
  { key: 'retrigger', label: 'Retrigger', gruppe: 'Freispiele' },
  { key: 'premium_win', label: 'Premium-Gewinn', gruppe: 'Gewinn' },
  { key: 'gamble_start', label: 'Risiko-Start', gruppe: 'Risiko' },
  { key: 'gamble_win', label: 'Risiko gewonnen', gruppe: 'Risiko' },
  { key: 'gamble_lose', label: 'Risiko verloren', gruppe: 'Risiko' },
  { key: 'musik', label: 'Hintergrundmusik', gruppe: 'Oberfläche' },
] as const;

export type KlangSlot = (typeof KLANG_SLOTS)[number]['key'];

export const KLANG_SLOT_KEYS: readonly string[] = KLANG_SLOTS.map((eintrag) => eintrag.key);

/** Ist das ein Slot, den die Oberflaeche kennt? */
export function istKlangSlot(wert: string): wert is KlangSlot {
  return KLANG_SLOT_KEYS.includes(wert);
}

/**
 * Die Slots, die als Schleife laufen.
 *
 * Sie brauchen in der Oberflaeche eine andere Behandlung - sie werden
 * gestartet und gestoppt, nicht angespielt - und sie haengen am Musikregler
 * statt am Effektregler.
 */
export const MUSIK_SLOTS: readonly string[] = ['musik', 'freespin_loop'];

/** Die Stile des Spin-Knopfs. */
export const KNOPF_STILE = [
  { key: 'puls', label: 'Pulsierend' },
  { key: 'ring', label: 'Leuchtring' },
  { key: 'flach', label: 'Flach und ruhig' },
] as const;

export const KNOPF_STIL_KEYS: readonly string[] = KNOPF_STILE.map((eintrag) => eintrag.key);
