import type { level } from '@swisshub/modules';

/**
 * Welche Gewinnlinien in welcher Reihenfolge gezeigt werden.
 *
 * ## Der Fehler, den diese Datei behebt
 *
 * In der Spieloberflaeche stand eine Zeile:
 *
 *     const einzelneLinien = spin.treffer.length > 1 && !schnell && !wenigerBewegung;
 *
 * und darunter zwei Zweige: der eine zeigte die Linien der Reihe nach, der
 * andere - `else if (spin.treffer.length === 1)` - zeigte eine einzelne. Bei
 * Quick Spin mit vier Gewinnlinien war `einzelneLinien` falsch und die Zahl
 * nicht eins: **keine** Linie wurde gezeigt, kein XP-Schild, kein
 * Linienklang. Dasselbe bei reduzierter Bewegung. Und bei genau einer Linie
 * gab es nie `winLineShown`, nur den Gesamtklang - und `sichtbareLinie` blieb
 * bis zum naechsten Spin stehen.
 *
 * Es war also kein Timing-Fehler und keine Race Condition, sondern eine
 * Fallunterscheidung, die zwei Faelle hatte und drei gebraucht haette.
 *
 * ## Warum die Entscheidung hier steht und nicht dort
 *
 * Weil sie sich hier pruefen laesst. Die Oberflaeche braucht einen Browser,
 * einen Spin und eine Stoppuhr; diese Funktion braucht eine Liste. Der Test
 * dazu stellt die Gleichung auf, die das Konzept verlangt:
 *
 *     linienfolge(treffer, lage).schritte.length === treffer.length
 *
 * fuer jede Lage - Quick Spin, reduzierte Bewegung, Bonus, Freispiel - und
 * fuer jede Anzahl. Was die Oberflaeche daraus macht, ist eine Schleife ueber
 * `schritte`, und eine Schleife kann keine Linie auslassen, die darin steht.
 *
 * ## Was die Lage noch beeinflusst - und was nicht
 *
 * **Nicht** die Anzahl. Quick Spin verkuerzt die Walzen, nicht die
 * Gewinnlinien; wer ueberspringt, ueberspringt das Warten auf das Ergebnis
 * und nicht das Ergebnis. Beide Angaben stehen deshalb in `FolgeLage`, ohne
 * `schritte` zu beruehren - sie sind der ausdrueckliche Teil der Zusage und
 * der Grund, warum der Test sie durchprobieren kann.
 *
 * Beeinflusst wird die **Dauer** je Linie und der Vorlauf vor der ersten.
 */

/** Was von einem Treffer gebraucht wird, um ihn zu zeigen. */
export interface LinienTrefferSicht {
  /** Index in `LINIEN`. */
  linie: number;
  stufe: level.xpslot.Gewinnstufe;
}

export interface FolgeLage {
  /** Quick Spin - verkuerzt die Anzeige je Linie, nicht ihre Anzahl. */
  schnell: boolean;
  /** Reduzierte Bewegung - dasselbe. */
  wenigerBewegung: boolean;
  /**
   * Der Spin wurde uebersprungen.
   *
   * Das ist der **eine** Fall, in dem die Reihe entfaellt - und er entfaellt
   * nicht aus Versehen, sondern weil jemand ausdruecklich darum gebeten hat.
   * Wer waehrend des Spins noch einmal drueckt, will das Ergebnis und nicht
   * die Vorfuehrung: Walzen sofort, alle Gewinnzellen sofort, der Gesamtgewinn
   * sofort, ein Klang. Wie das «Fast Stop» eines Automaten.
   *
   * Am Ergebnis aendert das nichts. Was gebucht ist, ist gebucht, bevor hier
   * irgendetwas gezeigt wird - der Sprung kuerzt die Inszenierung und nicht
   * den Spin.
   */
  uebersprungen: boolean;
  /**
   * Die Gewinnstufe des ganzen Spins - serverseitig bestimmt.
   *
   * Sie entscheidet ueber die grosse Meldung und die Fanfare danach. Gerechnet
   * wird sie nicht hier: `gewinnstufe()` im Modulkern kennt die Schwellen aus
   * der Konfiguration, und zwei Rechnungen fuer dieselbe Frage gehen
   * irgendwann auseinander.
   */
  stufe: level.xpslot.Gewinnstufe;
  /**
   * Ein Bonus ist ausgeloest.
   *
   * Dann klingt zuerst der Bonus, und die erste Linie wartet einen Moment -
   * sonst fallen zwei Klaenge auf denselben Augenblick und man hoert keinen
   * von beiden.
   */
  bonusAusgeloest: boolean;
}

export interface LinienSchritt {
  linie: number;
  stufe: level.xpslot.Gewinnstufe;
}

export interface LinienFolge {
  /** Die Linien - jede genau einmal, in der Reihenfolge des Servers. */
  schritte: LinienSchritt[];
  /** Wie lange jede Linie steht. */
  dauerMs: number;
  /** Pause vor der ersten Linie. */
  vorlaufMs: number;
  /**
   * Der Gesamtklang des Spins.
   *
   * Nur wenn keine Linie klingt: sonst waeren es fuenf Klaenge fuer vier
   * Linien, und der erste wuerde die Reihe verderben. Ein ausgeloester Bonus
   * hat seinen eigenen Klang und ersetzt ihn ebenfalls.
   */
  gesamtklang: boolean;
  /**
   * Alle Gewinnzellen sofort hervorheben.
   *
   * Nur beim Sprung. Im gewoehnlichen Ablauf gehoert jede Zelle genau zu der
   * Linie, die gerade steht - ein gemeinsames Aufleuchten **vor** der Reihe
   * verraet das Ergebnis, bevor die Reihe es erzaehlt.
   */
  sofortAlle: boolean;
  /**
   * Die grosse Meldung - oder `null`.
   *
   * Big Win, Mega Win, Jackpot. Die Schwellen dafuer stehen in der
   * Konfiguration und sind hier schon angewandt: was ankommt, ist die Stufe.
   */
  meldung: level.xpslot.Gewinnstufe | null;
  /** Wie lange die grosse Meldung steht - Mega laenger als Big. */
  meldungMs: number;
  /**
   * Die Fanfare nach der Reihe - oder `null`.
   *
   * Sie faellt weg, wenn genau eine Linie lief und diese Linie schon denselben
   * Klang gespielt hat: derselbe Ton zweimal im Abstand einer halben Sekunde
   * klingt nach einem Fehler, nicht nach einem Gewinn. Beim Sprung faellt sie
   * ebenfalls weg - dort ist der Gesamtklang schon der eine Klang.
   */
  abschlussklang: level.xpslot.Gewinnstufe | null;
}

export const LINIEN_ZEITEN = {
  /** Die Ruhe, in der man die Linie und ihr XP-Schild liest. */
  ruhig: 520,
  /** Quick Spin und reduzierte Bewegung: knapper, aber lesbar. */
  knapp: 340,
  /** Der Abstand zum Bonusklang. */
  vorlauf: 170,
  /** Wie lange «BIG WIN» steht. */
  meldung: 1900,
  /** Mega und Jackpot stehen laenger - sie sind seltener und mehr wert. */
  meldungStark: 2600,
};

/** Die Stufen, die eine grosse Meldung bekommen. */
const GROSSE_STUFEN: readonly level.xpslot.Gewinnstufe[] = ['gross', 'mega', 'jackpot'];

export function linienfolge(treffer: readonly LinienTrefferSicht[], lage: FolgeLage): LinienFolge {
  /*
   * Jeder Treffer wird ein Schritt - ohne `Set`, ohne `filter`, ohne
   * Zusammenfassen.
   *
   * Zwei Treffer koennen dieselbe Stufe haben und sogar denselben Gewinn;
   * was sie unterscheidet, ist die Linie, und die ist je Treffer genau
   * einmal belegt. Wer hier entdoppeln wollte, muesste wissen, was ein
   * Duplikat ist - und das weiss nur der Server, der sie geschickt hat.
   */
  const schritte = lage.uebersprungen
    ? []
    : treffer.map((eintrag) => ({ linie: eintrag.linie, stufe: eintrag.stufe }));

  const gross = GROSSE_STUFEN.includes(lage.stufe);
  /*
   * Die Fanfare - und wann sie stoert.
   *
   * Bei genau einer Linie hat diese Linie ihren Klang schon gespielt, und bei
   * einem Einlinien-Gewinn ist ihre Stufe die des ganzen Spins. Ein zweites
   * Mal derselbe Ton waere kein zweiter Gewinn, sondern ein Echo.
   */
  const echo = schritte.length === 1 && schritte[0]?.stufe === lage.stufe;

  return {
    schritte,
    dauerMs: lage.schnell || lage.wenigerBewegung ? LINIEN_ZEITEN.knapp : LINIEN_ZEITEN.ruhig,
    vorlaufMs: lage.bonusAusgeloest && schritte.length > 0 ? LINIEN_ZEITEN.vorlauf : 0,
    /*
     * Beim Sprung klingt der Spin als Ganzes - ein Klang statt einer Kette.
     * Sonst nur, wenn keine Linie klingt.
     */
    gesamtklang: (lage.uebersprungen || schritte.length === 0) && !lage.bonusAusgeloest,
    sofortAlle: lage.uebersprungen,
    meldung: gross ? lage.stufe : null,
    meldungMs: lage.stufe === 'gross' ? LINIEN_ZEITEN.meldung : LINIEN_ZEITEN.meldungStark,
    abschlussklang: gross && !lage.uebersprungen && !echo ? lage.stufe : null,
  };
}
