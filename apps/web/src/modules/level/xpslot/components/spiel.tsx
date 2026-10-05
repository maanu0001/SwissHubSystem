'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Gauge,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { level } from '@swisshub/modules';
import { formatSwissNumber } from '@swisshub/shared';
import { cn } from '@/lib/utils';
import { Partikel, Walzen } from './walzen';
import { LINIEN_ZEITEN, linienfolge } from './linienfolge';
import { symbolBild } from '../adressen';
import { Hochzaehlen, SlotOverlay } from './meldung';
import { Infotafel } from './infotafel';
import { Leiter } from './leiter';
import { Rad } from './rad';
import { useTon, useWenigerBewegung } from './klang';
import { useKlangEreignisse } from './klangereignisse';
import {
  bonusGeschenkStartenAction,
  bonusNehmenAction,
  bonusRiskierenAction,
  meinStandAction,
  meldungGesehenAction,
  spinAction,
} from '../../xpslot-actions';
import '../xpslot.css';

type Ansicht = Awaited<ReturnType<typeof level.xpslot.slotAnsicht>>;
type Spieler = Awaited<ReturnType<typeof level.xpslot.spielerAnsicht>>;
type Ergebnis = Awaited<ReturnType<typeof level.xpslot.dreheSpin>>;
type Meldungen = Spieler['meldungen'];

/**
 * Das Spiel.
 *
 * ## Die Trennung, auf der alles aufbaut
 *
 * Diese Komponente entscheidet **nichts** ueber ein Ergebnis. Sie ruft
 * `spinAction` auf, bekommt ein fertiges Spielfeld samt Treffern,
 * XP-Staenden und Bonuszustand zurueck und spielt das ab. Alles hier - wie
 * lange eine Walze laeuft, welcher Klang kommt, wie der Gewinn hochzaehlt -
 * ist Inszenierung eines bereits feststehenden Ergebnisses. Quick Spin
 * verkuerzt die Inszenierung und sonst nichts.
 *
 * ## Warum die Mindestlaufzeit
 *
 * Der Server antwortet in wenigen Millisekunden. Ohne Mindestlaufzeit waere
 * das Ergebnis da, bevor die Walzen anlaufen - und der Automat waere eine
 * Tabelle. Also: Walzen starten, Antwort abwarten, und erst nach
 * `laufzeit` die Stopps staffeln. Es wird nie auf eine Animation gewartet,
 * bevor gebucht wird - gebucht ist schon.
 *
 * ## Warum genau eine Auto-Spin-Schleife
 *
 * `laeuftRef` ist der Riegel. Ein zweiter Klick auf «Auto-Spin» findet die
 * Schleife laufend und tut nichts; eine zweite Schleife waere ein Spiel, das
 * doppelt so schnell XP verbraucht, wie es anzeigt. Dasselbe fuer den
 * einzelnen Spin: `beschaeftigt` sperrt den Knopf, und der Schluessel gegen
 * Doppelklicks sperrt den Server.
 */

/**
 * Die Zeiten der Inszenierung.
 *
 * ## Quick Spin haelt alle Walzen zusammen an
 *
 * Vorher staffelte er sie nur enger - 55 Millisekonden Abstand, fuenfmal
 * hintereinander. Das war ein schnelles Nacheinander und kein Sofort, und mit
 * fuenf Stoppklaengen in 220 Millisekunden klang es nach Stottern. Jetzt
 * halten alle fuenf im selben Bild, und es gibt **einen** Stoppklang.
 *
 * Die Ausnahme bleibt der Sweat: stehen zwei Bonussymbole und kann das dritte
 * noch kommen, dreht die entscheidende Walze weiter - auch im Quick Spin.
 * Genau das ist der Moment, den niemand verkuerzt haben will.
 */
const ZEITEN = {
  grund: 620,
  staffel: 160,
  /** Zuschlag je Sweat-Walze - die Spannung, die der Server bestaetigt hat. */
  sweat: 700,
  schnellGrund: 230,
  /** Quick Spin mit Sweat: die vorderen Walzen halten gemeinsam, dann die letzte. */
  schnellSweat: 520,
  /**
   * Der Abstand zwischen dem letzten Einrasten und dem Gewinnklang.
   *
   * Ohne ihn fallen Stoppklang und Fanfare auf denselben Moment, und man
   * hoert beides nicht richtig. Mit 170 Millisekunden sitzt zuerst die Walze,
   * dann kommt das Ergebnis - so, wie es im Konzept steht: «erst nach finalem
   * Reel Stop».
   */
  ergebnis: 170,
};

const warte = (ms: number): Promise<void> =>
  new Promise((aufloesen) => {
    setTimeout(aufloesen, ms);
  });

const SCHNELL_SPEICHER = 'swisshub.xpslot.schnell';

export interface SpielProps {
  csrfToken: string;
  ansicht: Ansicht;
  spieler: Spieler;
}

export function Spiel({ csrfToken, ansicht, spieler: start }: SpielProps): React.JSX.Element {
  const ton = useTon(ansicht.klaenge);
  const melde = useKlangEreignisse(ton);
  const wenigerBewegung = useWenigerBewegung();

  const [spieler, setSpieler] = useState<Spieler>(start);
  const [einsatz, setEinsatz] = useState<number>(start.einsatz);
  const [grid, setGrid] = useState<string[]>(() => startfeld(ansicht));
  const [laufend, setLaufend] = useState<boolean[]>(() =>
    Array.from({ length: ansicht.walzen }, () => false),
  );
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [sichtbareLinie, setSichtbareLinie] = useState<number | null>(null);
  /**
   * Wie lange die gerade gezeigte Linie steht.
   *
   * Dieselbe Zahl, mit der der Sequencer wartet - sonst laeuft die
   * Zeichenanimation der Linie gegen eine andere Uhr als die Anzeige.
   */
  const [linienDauer, setLinienDauer] = useState(LINIEN_ZEITEN.ruhig);
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const [autoRest, setAutoRest] = useState(0);
  const [schnell, setSchnell] = useState(false);
  const [leiterVerloren, setLeiterVerloren] = useState(false);
  /*
   * Das Risiko-Rad.
   *
   * `radErgebnis` ist die Antwort des Servers; sie liegt hier, bis das Rad
   * ausgefahren ist. `radFolge` ist der Zustand, der danach gilt - er wird
   * erst uebernommen, wenn das Rad steht, damit die Zahl im HUD nicht vor
   * dem Rad die Antwort verraet.
   */
  /*
   * Die grossen Meldungen.
   *
   * Sie kommen vom Server und werden dort vermerkt, wenn sie gesehen sind -
   * nicht im `localStorage`. Der Unterschied zaehlt: ein geschenktes
   * Bonusspiel soll man einmal angekuendigt bekommen, und zwar auf jedem
   * Geraet einmal insgesamt und nicht einmal je Browser. Ein Neuladen
   * mitten im Overlay darf die Ankuendigung nicht verschlucken.
   *
   * Es gibt vier davon, und sie liegen in **einem** Zustand: so kann nie
   * mehr als eine gleichzeitig auf dem Bildschirm stehen, und die
   * Reihenfolge ist entschieden statt zufaellig.
   */
  const [meldungen, setMeldungen] = useState<Meldungen>(start.meldungen);
  /**
   * Der Gewinn des zuletzt **abgeschlossenen** Spins.
   *
   * ## Warum eigener Zustand und nicht `ergebnis?.gewinn`
   *
   * Weil `ergebnis` beim Start des naechsten Spins geleert wird - die Anzeige
   * stuende dann waehrend des ganzen Laufs auf null und spraenge am Ende
   * wieder hoch. «Letzter Gewinn» soll stehen bleiben, bis es einen neuen
   * gibt; das ist die Zusage der Beschriftung.
   *
   * ## Warum nicht der Bonusgewinn
   *
   * Weil das eine andere Zahl ist. Waehrend Freispielen stand hier
   * `bonus.gewinn`, also die Summe der ganzen Runde - und damit zeigte das
   * Feld bei einem Freispiel ohne Treffer trotzdem einen Betrag. Die
   * Rundensumme gehoert in die Bonusanzeige und in das Abschluss-Overlay,
   * nicht hierher.
   *
   * ## Warum der Verlauf den Anfangswert gibt
   *
   * Damit ein Neuladen die Zahl nicht verliert. `verlauf[0]` ist der jüngste
   * gebuchte Spin dieser Person - dieselbe Quelle, aus der die Historie
   * unten auf der Seite liest. Kein zweiter Speicher, keine Schaetzung im
   * Browser.
   */
  const [letzterGewinn, setLetzterGewinn] = useState<number>(() => start.verlauf[0]?.gewinn ?? 0);
  /** Der Ausgang des Rads - er steht, bis jemand wegklickt. */
  const [radAusgang, setRadAusgang] = useState<{ gewonnen: boolean; freispiele: number } | null>(null);
  const [radAn, setRadAn] = useState(false);
  const [radErgebnis, setRadErgebnis] = useState<'gewonnen' | 'verloren' | null>(null);
  const radFolge = useRef<Spieler['bonus']>(null);
  /** Die mit dem Wurf erreichte Freispielzahl - direkt aus der Serverantwort. */
  const radFreispiele = useRef(0);
  /** Die Abschlusswerte, falls das Rad die Runde beendet hat. */
  const radEnde = useRef<Meldungen['bonusEnde']>(null);

  const laeuftRef = useRef(false);
  const abbrechenRef = useRef(false);
  const lebtRef = useRef(true);

  /*
   * Der Sprung - der zweite Klick auf den Spin-Knopf.
   *
   * ## Was er ist und was er nicht ist
   *
   * Er verkuerzt die **Inszenierung** und sonst nichts. Das Ergebnis steht
   * in dem Moment, in dem der Server geantwortet hat; der zweite Klick zeigt
   * es nur sofort. Er dreht nicht, er bucht nicht, er fragt nicht nach - ein
   * zweiter Spin aus einem Skip-Klick waere ein Einsatz, den niemand
   * gesetzt hat.
   *
   * ## Wie
   *
   * `uebersprungenRef` ist die Absicht, `sprungRef` der Hebel: jedes Warten
   * innerhalb eines Spins hinterlegt dort seinen Abbruch. Ein Klick zieht
   * ihn, das laufende Warten endet sofort, und der Ablauf findet an der
   * naechsten Stelle `uebersprungenRef` gesetzt vor und faellt in den
   * kurzen Zweig. Kein zweiter Zustandsautomat, kein paralleler Ablauf.
   */
  const sprungRef = useRef<(() => void) | null>(null);
  const uebersprungenRef = useRef(false);

  /** Ein Warten, das der zweite Klick beenden kann. */
  const warteOderSpringe = useCallback(
    (ms: number): Promise<void> =>
      new Promise((aufloesen) => {
        if (uebersprungenRef.current) {
          aufloesen();
          return;
        }
        const uhr = setTimeout(() => {
          sprungRef.current = null;
          aufloesen();
        }, ms);
        sprungRef.current = () => {
          clearTimeout(uhr);
          sprungRef.current = null;
          aufloesen();
        };
      }),
    [],
  );

  const ueberspringen = useCallback(() => {
    if (!laeuftRef.current || uebersprungenRef.current) {
      return;
    }
    uebersprungenRef.current = true;
    sprungRef.current?.();
  }, []);

  useEffect(() => {
    lebtRef.current = true;
    return () => {
      lebtRef.current = false;
      abbrechenRef.current = true;
    };
  }, []);

  // Quick Spin gehoert zu diesem Browser, nicht zum Konto.
  useEffect(() => {
    try {
      setSchnell(window.localStorage.getItem(SCHNELL_SPEICHER) === '1');
    } catch {
      // Ohne Speicher bleibt es aus - das ist die ruhigere Vorgabe.
    }
  }, []);

  const setzeSchnell = useCallback((wert: boolean) => {
    setSchnell(wert);
    try {
      window.localStorage.setItem(SCHNELL_SPEICHER, wert ? '1' : '0');
    } catch {
      // Siehe oben.
    }
  }, []);

  /*
   * Der Einsatz als Position in der Liste.
   *
   * Die spielbaren Einsaetze sind eine Aufzaehlung und keine Spanne - «plus»
   * heisst darum «der naechste erlaubte Wert» und nicht «plus hundert». Steht
   * der aktuelle Wert nicht in der Liste (etwa weil die Verwaltung die Stufen
   * geaendert hat, waehrend jemand spielte), ist der Index -1 und beide
   * Knoepfe fuehren zurueck in die Liste.
   */
  const einsatzIndex = ansicht.einsaetze.indexOf(einsatz);
  const einsatzSchritt = useCallback(
    (richtung: 1 | -1) => {
      const jetzt = ansicht.einsaetze.indexOf(einsatz);
      const naechster = jetzt < 0 ? 0 : Math.min(ansicht.einsaetze.length - 1, Math.max(0, jetzt + richtung));
      const wert = ansicht.einsaetze[naechster];
      if (wert === undefined || wert === einsatz) {
        return;
      }
      melde({ art: 'uiClick' });
      setEinsatz(wert);
    },
    [ansicht.einsaetze, einsatz, melde],
  );

  /*
   * Der Schluessel des Wild-Symbols.
   *
   * Gebraucht fuer die haftende Lage: ein Sticky Wild muss waehrend des Laufs
   * sichtbar bleiben, und dafuer muss die Walzenansicht wissen, welches
   * Symbol sie dort zeichnen soll. Die Rolle kommt aus der Ansicht - es gibt
   * keine zweite Liste, in der «wild» als Zeichenkette steht.
   */
  /*
   * Die Symbolbilder liegen fertig dekodiert bereit, bevor jemand dreht.
   *
   * ## Warum nicht einfach «der Browser laedt sie ja»
   *
   * Weil Laden und Dekodieren zwei Dinge sind. Ein `<img>` holt die Datei,
   * sobald es im Baum steht - dekodiert wird sie aber erst, wenn sie
   * gezeichnet werden soll. Im Lauf wechseln die Fuellsymbole, und ein
   * Symbol, das zum ersten Mal sichtbar wird, wird in genau diesem Bild
   * dekodiert. Auf einem Telefon ist das der Ruck, den niemand erklaeren
   * kann: er haengt nicht am Spin, sondern daran, welches Symbol zuerst
   * vorbeikommt.
   *
   * `decode()` nimmt diese Arbeit vorweg, einmal, bei stehender Buehne. Die
   * mitgelieferten Symbole sind kleine SVG-Dateien von rund einem Kilobyte;
   * hochgeladene koennen groesser sein, und genau fuer die lohnt es sich.
   *
   * Fehler sind hier belanglos: ein Bild, das sich nicht vorab dekodieren
   * laesst, wird spaeter dekodiert - also genau so, wie es vorher immer war.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.Image !== 'function') {
      return;
    }
    for (const symbol of ansicht.symbole) {
      const adresse = symbolBild(symbol);
      if (!adresse) {
        continue;
      }
      const bild = new window.Image();
      bild.src = adresse;
      void bild.decode?.().catch(() => undefined);
    }
  }, [ansicht.symbole]);

  const wildKey = useMemo(
    () => ansicht.symbole.find((symbol) => symbol.rolle === 'WILD')?.key ?? null,
    [ansicht.symbole],
  );

  const imFreispiel = spieler.bonus?.stufe === 'SPINS' || spieler.freispieleOffen > 0;
  const freispieleRest =
    (spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.offen : 0) + spieler.freispieleOffen;
  const festerEinsatz = spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.einsatz : spieler.freispielEinsatz;
  /*
   * Wann «Freispiele» ueberhaupt eine Auskunft ist.
   *
   * Genau dann, wenn Freispiele laufen: ein geschenktes Paket oder die
   * Freispiele einer Bonusrunde. Im Basegame gibt es nichts zu zeigen -
   * dort stand bisher dauerhaft eine Null, und eine Null, die nie etwas
   * anderes wird, ist ein leeres Feld mit Beschriftung.
   *
   * ## Warum nicht schon auf der Risikoleiter
   *
   * Weil dort noch keine Zahl feststeht. Wer zwischen acht und zwoelf
   * waehlt, hat null offene Freispiele - und «Freispiele 0» waere in diesem
   * Moment die falsche Auskunft. Die Zahlen, um die es geht, stehen auf der
   * Leiter selbst, gross und zur Wahl.
   */
  const zeigeFreispiele = imFreispiel;
  const wirksamerEinsatz = festerEinsatz ?? einsatz;

  /*
   * Die Grundstimmung: Freispielmusik, solange Freispiele laufen.
   *
   * Der Wechsel ist eine Ueberblendung und kein Schnitt - das steckt im
   * Ereignis, nicht hier. Diese Zeilen sagen nur, **welche** Stimmung gilt.
   */
  useEffect(() => {
    if (!ton.freigegeben) {
      return;
    }
    melde({ art: 'stimmung', freispiel: imFreispiel });
  }, [imFreispiel, melde, ton.freigegeben]);

  const trefferZellen = useMemo(
    () =>
      ergebnis && !laufend.some(Boolean)
        ? ergebnis.treffer
            .filter((treffer) => sichtbareLinie === null || treffer.linie === sichtbareLinie)
            .flatMap((treffer) => treffer.zellen)
        : [],
    [ergebnis, laufend, sichtbareLinie],
  );

  const linienPfad = useMemo(() => {
    if (sichtbareLinie === null || !ergebnis) {
      return null;
    }
    return ergebnis.treffer.find((treffer) => treffer.linie === sichtbareLinie)?.zellen ?? null;
  }, [ergebnis, sichtbareLinie]);

  /** Was genau die gerade gezeigte Linie wert ist - fuer das Schild an ihr. */
  const linienGewinn = useMemo(() => {
    if (sichtbareLinie === null || !ergebnis) {
      return null;
    }
    return ergebnis.treffer.find((treffer) => treffer.linie === sichtbareLinie)?.gewinn ?? null;
  }, [ergebnis, sichtbareLinie]);

  /** Ein Spin, vollstaendig: Anfrage, Inszenierung, Fortschreibung. */
  const dreheEinmal = useCallback(async (): Promise<{ weiter: boolean; grund: string | null }> => {
    ton.freigeben();
    uebersprungenRef.current = false;
    sprungRef.current = null;
    setErgebnis(null);
    setSichtbareLinie(null);
    setLeiterVerloren(false);
    setLaufend(Array.from({ length: ansicht.walzen }, () => true));
    melde({ art: 'spinStarted' });

    const begonnen = Date.now();
    const antwort = await spinAction({
      csrfToken,
      einsatz: wirksamerEinsatz,
      // Der Schluessel gegen den zweiten Klick. Zufall plus Zeit: zwei
      // Spins koennen damit nie denselben tragen, und ein Doppelklick
      // schickt zweimal denselben.
      schluessel: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    });

    if (!antwort.ok) {
      melde({ art: 'spinAborted' });
      setLaufend(Array.from({ length: ansicht.walzen }, () => false));
      return { weiter: false, grund: antwort.error.message };
    }

    const spin = antwort.data;
    const grund = schnell ? ZEITEN.schnellGrund : ZEITEN.grund;
    const staffel = ZEITEN.staffel;

    // Mindestlaufzeit: der Server ist schneller als das Auge. Der zweite
    // Klick verkuerzt sie - am Ergebnis aendert er nichts, das steht hier
    // schon fertig in `spin`.
    await warteOderSpringe(Math.max(0, grund - (Date.now() - begonnen)));
    if (!lebtRef.current) {
      return { weiter: false, grund: null };
    }
    setGrid(spin.grid);

    /*
     * Die Stopps.
     *
     * Vier Faelle, und sie unterscheiden sich nur in der Zeit - nie im
     * Ergebnis: das steht fertig in `spin`.
     *
     *  1. **Sprung**: alle noch laufenden Walzen halten im selben Bild.
     *  2. **Quick Spin ohne Sweat**: alle fuenf halten im selben Bild.
     *  3. **Quick Spin mit Sweat**: die Walzen vor der entscheidenden halten
     *     gemeinsam, dann dreht die letzte weiter.
     *  4. **Normal**: einzeln von links nach rechts, mit Zuschlag auf den
     *     Sweat-Walzen.
     *
     * Was alle vier gemeinsam haben: **jede** Walze meldet ihren eigenen
     * Stopp. Vorher gab es im Quick Spin einen Klang fuer fuenf Walzen, und
     * das war an der Buehne zu hoeren - fuenf Dinge rasten ein, eines macht
     * ein Geraeusch.
     */
    const sweatAb = spin.sweatAbWalze;
    const sweatSpielt = sweatAb !== null && !wenigerBewegung;

    /** Walzen 0 bis `bis` - 1 halten; alles ab `bis` dreht weiter. */
    const haltBis = (bis: number): void => {
      setLaufend((vorher) => vorher.map((wert, index) => (index < bis ? false : wert)));
    };
    const haltAlles = (): void => {
      setLaufend(Array.from({ length: ansicht.walzen }, () => false));
    };
    const meldeStopps = (von: number, bis: number): void => {
      for (let walze = von; walze < bis; walze += 1) {
        melde({ art: 'reelStopped', walze });
      }
    };

    if (uebersprungenRef.current) {
      haltAlles();
      melde({ art: 'spinSkipped', walzen: ansicht.walzen });
    } else if (schnell && !sweatSpielt) {
      haltAlles();
      meldeStopps(0, ansicht.walzen);
    } else if (schnell && sweatAb !== null) {
      /*
       * Quick Spin mit Sweat.
       *
       * Hier hielten vorher **alle** Walzen - auch die entscheidende -, und
       * danach lief der Sweat-Klang ueber ein stehendes Bild. Jetzt haelt
       * nur, was vor der entscheidenden Walze liegt; die dreht weiter, und
       * genau das ist der Moment, den niemand verkuerzt haben will.
       */
      if (sweatAb > 0) {
        haltBis(sweatAb);
        meldeStopps(0, sweatAb);
      }
      melde({ art: 'bonusSweatStarted' });
      await warteOderSpringe(ZEITEN.schnellSweat);
      if (!lebtRef.current) {
        return { weiter: false, grund: null };
      }
      haltAlles();
      meldeStopps(sweatAb, ansicht.walzen);
    } else {
      for (let walze = 0; walze < ansicht.walzen; walze += 1) {
        const sweat = sweatSpielt && sweatAb !== null && walze >= sweatAb;
        if (sweat && walze === sweatAb) {
          melde({ art: 'bonusSweatStarted' });
        }
        await warteOderSpringe(staffel + (sweat ? ZEITEN.sweat : 0));
        if (!lebtRef.current) {
          return { weiter: false, grund: null };
        }
        if (uebersprungenRef.current) {
          // Mitten in der Staffel gesprungen: der Rest kommt in einem Bild -
          // und jede davon betroffene Walze bekommt ihren Stoppklang.
          haltAlles();
          melde({ art: 'spinSkipped', walzen: ansicht.walzen - walze });
          break;
        }
        setLaufend((vorher) => vorher.map((wert, index) => (index === walze ? false : wert)));
        melde({ art: 'reelStopped', walze });
      }
    }
    melde({ art: 'reelsFinished' });

    /*
     * Der Sprung ist hier verbraucht.
     *
     * Was er abkuerzen sollte, ist vorbei: die Walzen stehen. Die
     * Gewinnlinien danach laufen wieder normal - sie sind nicht das Warten,
     * das jemand ueberspringen wollte, sondern das, worauf er gewartet hat.
     */
    uebersprungenRef.current = false;
    sprungRef.current = null;

    setErgebnis(spin);

    /*
     * Erst sitzt die letzte Walze, dann kommt das Ergebnis.
     *
     * Die kurze Pause ist der Unterschied zwischen «zwei Klaenge
     * gleichzeitig» und «zuerst der Stopp, dann die Fanfare». Gebucht ist zu
     * diesem Zeitpunkt alles; das hier ist reine Inszenierung.
     */
    await warte(ZEITEN.ergebnis);
    if (!lebtRef.current) {
      return { weiter: false, grund: null };
    }

    /*
     * Der Plan fuer die Gewinnlinien - und was dazu klingt.
     *
     * Was gezeigt wird, entscheidet `linienfolge` aus den Treffern des
     * Servers: jeder genau einmal, unabhaengig von Quick Spin, reduzierter
     * Bewegung und Sprung. Hier wird nur noch abgespielt, was dort steht.
     *
     * Klingt eine Linie, klingt **jede** einzeln, und der Gesamtklang
     * entfaellt: sonst waeren es fuenf Klaenge fuer vier Linien, und der
     * erste wuerde die Reihe verderben. Ein ausgeloester Bonus ersetzt den
     * Gewinnklang, er kommt nicht dazu - vorher spielten beide, und die
     * wichtigere Aussage ging unter.
     */
    const folge = linienfolge(spin.treffer, {
      schnell,
      wenigerBewegung,
      bonusAusgeloest: spin.bonusAusgeloest,
    });
    if (spin.bonusAusgeloest) {
      melde({ art: 'bonusTriggered', retrigger: spin.art === 'BONUS_ROUND' });
    } else if (folge.gesamtklang) {
      melde({ art: 'spinResult', stufe: spin.stufe });
    }
    if (spin.premiumTage > 0) {
      melde({ art: 'premiumWin' });
    }

    // Dieser Spin ist durch - er ist jetzt der letzte Gewinn, auch mit null.
    setLetzterGewinn(spin.gewinn);

    // Den eigenen Stand fortschreiben - ohne die Seite neu zu laden.
    setSpieler((vorher) => ({
      ...vorher,
      xp: spin.xpNachher,
      freispieleOffen: spin.freispieleOffen,
      freispielEinsatz: spin.freispielEinsatz,
      bonus: spin.bonus,
      statistik: {
        ...vorher.statistik,
        spins: vorher.statistik.spins + 1,
        einsatz: vorher.statistik.einsatz + (spin.art === 'PAID' ? spin.einsatz : 0),
        gewinn: vorher.statistik.gewinn + spin.gewinn,
        bestesSpin: Math.max(vorher.statistik.bestesSpin, spin.gewinn),
        saldo: vorher.statistik.saldo + spin.netto,
      },
    }));

    /*
     * Schliesst dieser Spin eine Bonusrunde ab, gehoert das Overlay dazu.
     *
     * Die Zahlen stehen in derselben Antwort - serverseitig gezaehlt, ueber
     * die ganze Runde. Die Oberflaeche summiert nichts: sie zeigt, was in der
     * Zeile steht, und braucht dafuer keine zweite Abfrage.
     */
    if (spin.bonusEnde) {
      melde({ art: 'bonusFinished', gewonnen: !spin.bonusEnde.verloren });
      setMeldungen((vorher) => ({ ...vorher, bonusEnde: spin.bonusEnde }));
    }

    /*
     * Und dasselbe fuer ein geschenktes Freispielpaket.
     *
     * ## Der Fehler, den das behebt
     *
     * Die Abschlussmeldung hing allein an der Ansicht, die beim Oeffnen der
     * Seite geladen wird. Wer sein letztes geschenktes Freispiel drehte, sah
     * also **nichts** - die Meldung erschien erst beim naechsten Besuch,
     * ohne Zusammenhang zu dem Spin, der sie ausgeloest hatte. Gefunden hat
     * das der Browser-Smoke: in der Phase danach stand sie da, in der Phase,
     * die sie erwartete, nicht.
     *
     * Jetzt kommt sie mit der Spinantwort - mit denselben serverseitig
     * gezaehlten Zahlen, in dem Moment, in dem sie endgueltig sind. Die
     * Ansicht beim Oeffnen bleibt als zweiter Weg bestehen: wer den Tab
     * schliesst, bevor er wegklickt, soll sie beim naechsten Mal sehen.
     */
    if (spin.freispielEnde) {
      melde({ art: 'freespinsFinished' });
      setMeldungen((vorher) => ({ ...vorher, freispielEnde: spin.freispielEnde }));
    }

    /*
     * Die Linien einzeln zeigen - jede mit ihrem Klang und ihrem XP-Schild.
     *
     * Eine Schleife ueber `folge.schritte`, und sonst nichts: keine zweite
     * Fallunterscheidung, keine Kette unabhaengiger Zeitgeber, kein Zweig,
     * der bei vier Linien in keinen von beiden faellt. Was der Server
     * geschickt hat, laeuft hier genau einmal durch.
     *
     * Abgebrochen wird nur, wenn die Seite verlassen wurde (`lebtRef`) -
     * nicht durch einen harmlosen Re-Render und nicht durch den Sprung, der
     * oben nach dem Walzenstopp verbraucht wurde.
     */
    if (folge.schritte.length > 0) {
      setLinienDauer(folge.dauerMs);
      if (folge.vorlaufMs > 0) {
        await warte(folge.vorlaufMs);
        if (!lebtRef.current) {
          return { weiter: false, grund: null };
        }
      }
      for (const schritt of folge.schritte) {
        setSichtbareLinie(schritt.linie);
        melde({ art: 'winLineShown', stufe: schritt.stufe });
        await warte(folge.dauerMs);
        if (!lebtRef.current) {
          return { weiter: false, grund: null };
        }
      }
      /*
       * Danach die Gesamtansicht: alle Gewinnzellen hervorgehoben, der
       * Gesamtgewinn in der Gewinnzeile. Beides haengt an `sichtbareLinie`,
       * und `null` heisst «keine einzelne Linie mehr, sondern alle».
       */
      setSichtbareLinie(null);
      melde({ art: 'allLinesFinished' });
    }

    /*
     * Die Stoppgruende des Auto-Spins.
     *
     * Alle vier sind Momente, in denen jemand hinsehen soll: ein Bonus, ein
     * grosser Gewinn, ein Jackpot, ein Premium-Gewinn. Ein Auto-Spin, der
     * ueber einen Jackpot hinwegdreht, nimmt dem Spiel seinen Moment.
     */
    const halt =
      spin.bonusAusgeloest ||
      spin.jackpot ||
      spin.premiumTage > 0 ||
      spin.stufe === 'gross' ||
      spin.stufe === 'mega';

    return { weiter: !halt, grund: null };
  }, [ansicht.walzen, csrfToken, melde, schnell, ton, warteOderSpringe, wenigerBewegung, wirksamerEinsatz]);

  const spin = useCallback(async () => {
    if (laeuftRef.current) {
      return;
    }
    laeuftRef.current = true;
    setBeschaeftigt(true);
    try {
      const { grund } = await dreheEinmal();
      if (grund) {
        toast.error(grund);
      }
    } finally {
      laeuftRef.current = false;
      setBeschaeftigt(false);
    }
  }, [dreheEinmal]);

  const autoStarten = useCallback(
    async (anzahl: number) => {
      if (laeuftRef.current) {
        return;
      }
      laeuftRef.current = true;
      abbrechenRef.current = false;
      setBeschaeftigt(true);
      setAutoRest(anzahl);
      try {
        for (let rest = anzahl; rest > 0; rest -= 1) {
          if (abbrechenRef.current || !lebtRef.current) {
            break;
          }
          setAutoRest(rest);
          const { weiter, grund } = await dreheEinmal();
          if (grund) {
            toast.error(grund);
            break;
          }
          if (!weiter) {
            break;
          }
          await warte(schnell ? 120 : 320);
        }
      } finally {
        setAutoRest(0);
        laeuftRef.current = false;
        setBeschaeftigt(false);
      }
    },
    [dreheEinmal, schnell],
  );

  /**
   * Die Entscheidung der Bonusrunde.
   *
   * ## Nehmen
   *
   * Ein Klick, eine Antwort, fertig. Hier ist nichts zu inszenieren: wer
   * nimmt, will die Freispiele und keine Animation.
   *
   * ## Riskieren
   *
   * Das Rad dreht los, **dann** geht die Anfrage hinaus, und das Rad faehrt
   * auf die Antwort aus. Die Reihenfolge ist wichtig: dreht es erst nach der
   * Antwort los, sieht man eine Verzoegerung; entscheidet es selbst, ist es
   * ein zweites Spiel. Der Zustand wird erst uebernommen, wenn das Rad steht
   * - sonst stuende die neue Zahl im HUD, bevor das Rad sie zeigt.
   */
  const bonusEntscheiden = useCallback(
    async (riskieren: boolean) => {
      const runde = spieler.bonus;
      if (!runde || beschaeftigt) {
        return;
      }
      setBeschaeftigt(true);

      if (!riskieren) {
        melde({ art: 'uiClick' });
        try {
          const antwort = await bonusNehmenAction({ csrfToken, rundeId: runde.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          const neu = antwort.data.bonus;
          melde({ art: 'bonusRevealed' });
          if (neu.stufe === 'SPINS') {
            melde({ art: 'freespinsStarted' });
            toast.success(`${neu.offen} Freispiele - viel Glück.`);
          }
          setSpieler((vorher) => ({
            ...vorher,
            bonus: neu.stufe === 'LOST' || neu.stufe === 'FINISHED' ? null : neu,
          }));
        } finally {
          setBeschaeftigt(false);
        }
        return;
      }

      // Das Rad erscheint und dreht frei - noch ohne Ergebnis.
      setRadErgebnis(null);
      radFolge.current = null;
      radEnde.current = null;
      radFreispiele.current = 0;
      setRadAn(true);
      melde({ art: 'gambleStarted' });

      try {
        const antwort = await bonusRiskierenAction({ csrfToken, rundeId: runde.id });
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          ton.stoppeSchleife('gamble_spin', { sofort: true });
          setRadAn(false);
          setBeschaeftigt(false);
          return;
        }
        // Ab hier steht das Ergebnis fest. Das Rad faehrt darauf aus; der
        // Zustand folgt in `radFertig`.
        radFolge.current = antwort.data.bonus;
        radFreispiele.current = antwort.data.freispiele;
        radEnde.current = antwort.data.ende;
        setRadErgebnis(antwort.data.gewonnen ? 'gewonnen' : 'verloren');
      } catch (fehler) {
        ton.stoppeSchleife('gamble_spin', { sofort: true });
        setRadAn(false);
        setBeschaeftigt(false);
        throw fehler;
      }
    },
    [beschaeftigt, csrfToken, melde, spieler.bonus, ton],
  );

  /**
   * Das Rad steht - jetzt gilt, was der Server gesagt hat.
   *
   * Das Ergebnis bekommt ein eigenes Overlay und keinen Toast. Ein Toast am
   * Bildschirmrand ist die Form fuer «gespeichert» und nicht fuer «zwoelf
   * Freispiele» oder «der Bonus ist weg»: beides ist der Moment, auf den die
   * ganze Drehung hingelaufen ist.
   */
  const radFertig = useCallback(() => {
    const neu = radFolge.current;
    const gewonnen = radErgebnis === 'gewonnen';
    melde({ art: 'gambleLanded', gewonnen });
    setLeiterVerloren(!gewonnen);
    if (gewonnen && neu?.stufe === 'SPINS') {
      melde({ art: 'freespinsStarted' });
    }
    /*
     * Eine Meldung, nicht zwei.
     *
     * Hat das Rad die Runde beendet - das ist der verlorene Fall -, dann ist
     * der Abschluss die Nachricht, und der Ausgang des Rads steht schon auf
     * dem Rad selbst. Zwei Overlays hintereinander fuer dasselbe Ereignis
     * waeren keine Feier, sondern zweimal Wegklicken.
     */
    const ende = radEnde.current;
    radEnde.current = null;
    if (ende) {
      melde({ art: 'bonusFinished', gewonnen: !ende.verloren });
      setMeldungen((vorher) => ({ ...vorher, bonusEnde: ende }));
    } else {
      /*
       * Die Zahl kommt vom Server und nicht aus dem Folgezustand.
       *
       * Hier stand `neu.stufe === 'SPINS' ? neu.offen : 0`. Nach einem
       * gewonnenen Wurf auf der ersten Stufe steht die Runde aber auf
       * `LADDER_2` - es gibt wieder eine Wahl -, und `offen` ist dann null.
       * Die Meldung sagte deshalb «0 Freispiele», obwohl gerade zwoelf
       * gewonnen waren. `freispiele` ist genau die erreichte Stufe.
       */
      setRadAusgang({ gewonnen, freispiele: radFreispiele.current });
    }
    radFreispiele.current = 0;
    setSpieler((vorher) => ({
      ...vorher,
      bonus: !neu || neu.stufe === 'LOST' || neu.stufe === 'FINISHED' ? null : neu,
    }));
    setRadAn(false);
    setRadErgebnis(null);
    radFolge.current = null;
    setBeschaeftigt(false);
  }, [melde, radErgebnis]);

  /**
   * Eine Meldung wegklicken - und das dem Server sagen.
   *
   * Beides gehoert zusammen: wer nur den Zustand hier leert, sieht dieselbe
   * Ankuendigung beim naechsten Laden wieder, und wer nur den Server
   * benachrichtigt, sieht sie bis zum Neuladen weiter. Der Vermerk laeuft
   * ohne `await`: dass das Overlay weggeht, haengt nicht an einer Antwort -
   * und wenn der Vermerk fehlschlaegt, kommt die Meldung noch einmal, was
   * die harmlosere Richtung des Fehlers ist.
   */
  const schliesseMeldung = useCallback(
    (art: 'freispiel-intro' | 'freispiel-ende' | 'bonus-intro' | 'bonus-ende', id: string) => {
      melde({ art: 'uiClick' });
      setMeldungen((vorher) => ({
        freispielIntro: art === 'freispiel-intro' ? null : vorher.freispielIntro,
        freispielEnde: art === 'freispiel-ende' ? null : vorher.freispielEnde,
        bonusIntro: art === 'bonus-intro' ? null : vorher.bonusIntro,
        bonusEnde: art === 'bonus-ende' ? null : vorher.bonusEnde,
      }));
      void meldungGesehenAction({ csrfToken, art, id });
    },
    [csrfToken, melde],
  );

  /**
   * «Bonus starten» aus der Ankuendigung.
   *
   * Der Server legt daraus eine gewoehnliche Bonusrunde auf der ersten
   * Leiterstufe an - dieselbe, die ein Scatter-Treffer erzeugt. Es gibt keine
   * zweite Bonuslogik fuer Geschenke, und genau deshalb gilt ab hier alles,
   * was fuer jede Bonusrunde gilt: nehmen oder riskieren, acht Freispiele
   * oder zwoelf, und bei Pech ist alles weg.
   */
  const starteGeschenk = useCallback(
    async (grantId: string) => {
      melde({ art: 'uiClick' });
      const antwort = await bonusGeschenkStartenAction({ csrfToken, grantId });
      if (!antwort.ok) {
        /*
         * Die Ankuendigung bleibt stehen.
         *
         * Haette sie der Klick schon weggenommen, waere das Geschenk nach
         * einem Fehler nicht mehr erreichbar - ohne Neuladen gaebe es keinen
         * zweiten Knopf. Ein Overlay, das nach einem Fehler noch da ist, ist
         * die harmlosere Richtung.
         */
        toast.error(antwort.error.message);
        return;
      }
      setMeldungen((vorher) => ({ ...vorher, bonusIntro: null }));
      melde({ art: 'bonusRevealed' });
      setSpieler((vorher) => ({ ...vorher, bonus: antwort.data.bonus }));
    },
    [csrfToken, melde],
  );

  /** Den Stand neu holen - nach einem Fehler oder einer Sperre. */
  const standAktualisieren = useCallback(async () => {
    const antwort = await meinStandAction({ csrfToken });
    if (antwort.ok) {
      setSpieler(antwort.data);
      // Auch «Letzter Gewinn» kommt von dort - aus dem Verlauf, der dieselbe
      // Quelle ist wie beim ersten Laden der Seite.
      setLetzterGewinn(antwort.data.verlauf[0]?.gewinn ?? 0);
    }
  }, [csrfToken]);

  // Ist die Bonusrunde fertig, soll die Freispielmusik enden und der Stand
  // stimmen - die Rundensumme steht erst dann fest.
  useEffect(() => {
    if (spieler.bonus === null && !beschaeftigt && ergebnis?.art === 'BONUS_ROUND') {
      // Nur der Stand - der Abschlussklang haengt am Abschluss selbst und
      // nicht an diesem Effekt, der auch bei einem Rendern mehr anschlaegt.
      void standAktualisieren();
    }
  }, [beschaeftigt, ergebnis?.art, spieler.bonus, standAktualisieren]);

  const stufe = ergebnis && !laufend.some(Boolean) ? ergebnis.stufe : 'keine';
  /*
   * Kann der zweite Klick jetzt etwas abkuerzen?
   *
   * Genau dann, wenn noch eine Walze dreht. Das deckt auch den Sweat ab: dort
   * stehen vier und eine laeuft, und das ist der Moment, in dem jemand am
   * ehesten nicht mehr warten will.
   */
  const springbar = laufend.some(Boolean);
  const entscheidung = spieler.bonus?.stufe === 'LADDER_1' || spieler.bonus?.stufe === 'LADDER_2';

  if (!ansicht.spielbar) {
    return (
      <div className="slot-buehne p-10 text-center">
        <Gauge aria-hidden="true" className="mx-auto mb-3 size-10 text-muted-foreground" />
        <p className="text-lg font-semibold">Der XP-Slot ist gerade geschlossen</p>
        <p className="mt-1 text-sm text-muted-foreground">{ansicht.grund}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[54rem] space-y-3">
      {/*
        Der Wartungsmodus - fuer die Verwaltung sichtbar, nicht versteckt.

        Wer hier spielt, waehrend `wartung` steht, spielt als einzige Person:
        die Mitglieder bekommen die Wartungsansicht. Das muss dastehen. Ein
        Wartungsmodus, der sich fuer Admins unsichtbar macht, fuehrt zu dem
        einen Satz, den niemand hoeren will - «bei mir lief es doch».
      */}
      {ansicht.wartung ? (
        <p className="flex items-center justify-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-center text-sm font-semibold text-warning">
          <Gauge aria-hidden="true" className="size-4 shrink-0" />
          Wartungsmodus aktiv – Admin-Zugriff. Für Mitglieder ist der Slot gesperrt.
        </p>
      ) : null}
      {/*
        Das HUD.

        Vier Werte, die waehrend des Spielens nie verschwinden duerfen: was ich
        habe, was ich setze, was ich gewonnen habe, was noch frei ist. Sie
        stehen oben und nicht unten, weil der Blick beim Spielen auf dem
        Spielfeld liegt und von dort nach oben kuerzer ist als nach unten
        ueber die Steuerung hinweg.
      */}
      <div className="slot-hud">
        <HudFeld label="XP" wert={spieler.xp} />
        <HudFeld
          label="Einsatz"
          wert={wirksamerEinsatz}
          notiz={festerEinsatz !== null ? 'festgelegt' : null}
          still
        />
        {/*
          «Freispiele» steht nur da, wenn es Freispiele gibt.

          Im Basegame war das Feld dauerhaft sichtbar und zeigte null - eine
          Auskunft ueber etwas, das gerade nicht stattfindet. Jetzt erscheint
          es mit dem Bonus und verschwindet mit ihm; das Raster zaehlt seine
          Spalten selbst, es bleibt also keine Luecke.
        */}
        {zeigeFreispiele ? (
          <HudFeld
            label="Freispiele"
            wert={freispieleRest}
            notiz={festerEinsatz !== null ? `zu ${festerEinsatz} XP` : null}
            still
          />
        ) : null}
        <HudFeld label="Letzter Gewinn" wert={letzterGewinn} vorzeichen />
      </div>

      {/* --- Die Bühne --- */}
      <div
        className={cn(
          'slot-buehne',
          /*
            Solange eine Walze laeuft, ruhen die Nebenanimationen.

            Die Klasse haengt an genau dem Zustand, der die Walzen dreht -
            nicht an einem eigenen Zeitgeber, der daneben laufen und
            auseinanderfallen koennte.
          */
          laufend.some(Boolean) && 'slot-buehne--dreht',
          imFreispiel && 'slot-buehne--frei',
          stufe === 'gross' && 'slot-buehne--gross',
          stufe === 'mega' && 'slot-buehne--mega',
          stufe === 'jackpot' && 'slot-buehne--jackpot',
        )}
        style={
          ansicht.design.akzentfarbe
            ? ({
                ['--primary-bright' as string]: hexZuHsl(ansicht.design.akzentfarbe),
              } as React.CSSProperties)
            : undefined
        }
      >
        {ansicht.design.hintergrund ? (
          <div
            className="slot-buehne__bild"
            style={{ backgroundImage: `url(${ansicht.design.hintergrund})` }}
          />
        ) : null}
        <div className="slot-buehne__schleier" style={{ opacity: ansicht.design.overlay / 100 }} />
        <div className="slot-buehne__puls" style={{ opacity: ansicht.design.glow / 100 }} />

        {imFreispiel ? (
          <p className="slot-frei-schild relative pt-3 text-center text-[11px] font-bold uppercase text-[hsl(42_95%_60%)]">
            Free Spins · {freispieleRest} übrig
            {spieler.bonus?.retriggers ? ` · ${spieler.bonus.retriggers}× verlängert` : ''}
          </p>
        ) : null}

        {/*
          Der Container fuer die Walzenbreite.
          
          `container-type: inline-size` steht hier und nicht an den Walzen
          selbst: ein Element kann seine eigene Breite nicht abfragen. Erst
          dadurch kann das Raster darunter in `cqw` rechnen - also in Prozent
          **dieses** Kastens statt in Prozent des Fensters. Das war die
          Ursache der schmalen Walzen auf dem iPad.
        */}
        <div className="slot-feld">
          <Walzen
            grid={grid}
            symbole={ansicht.symbole}
            laufend={laufend}
            treffer={trefferZellen}
            klebend={spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.stickyZellen : []}
            wildKey={wildKey}
            sweatAbWalze={ergebnis?.sweatAbWalze ?? null}
            reihen={ansicht.reihen}
            walzen={ansicht.walzen}
            linie={linienPfad}
            linienGewinn={linienGewinn}
            linienDauerMs={linienDauer}
          />
        </div>

        {/*
          Die Gewinnzeile hat immer dieselbe Hoehe - auch ohne Gewinn.

          Sonst waechst die Buehne in dem Moment, in dem ein Gewinn erscheint,
          und schiebt die Steuerung nach unten. Genau diese Art von Sprung soll
          dieser Umbau beseitigen; ein leerer Platz ist der Preis dafuer.
        */}
        <div className="slot-gewinnzeile relative">
          {/*
            Der Gesamtgewinn erst, wenn keine einzelne Linie mehr steht.

            Waehrend der Reihe gehoert die Buehne der Linie und ihrem
            eigenen XP-Schild; die Summe darueber waere die Antwort, bevor
            die Frage fertig gestellt ist. `sichtbareLinie === null` ist
            genau «die Reihe ist durch» - und bei einem Spin ohne Gewinnlinie
            von Anfang an wahr.
          */}
          {ergebnis && ergebnis.gewinn > 0 && !laufend.some(Boolean) && sichtbareLinie === null ? (
            <div className="text-center">
              <p className="slot-gewinn text-2xl font-black text-[hsl(var(--primary-bright))] sm:text-3xl">
                +<Hochzaehlen ziel={ergebnis.gewinn} ruhig={wenigerBewegung} /> XP
              </p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {stufe === 'jackpot'
                  ? 'Jackpot'
                  : stufe === 'mega'
                    ? 'Mega Win'
                    : stufe === 'gross'
                      ? 'Big Win'
                      : `${ergebnis.treffer.length} ${ergebnis.treffer.length === 1 ? 'Linie' : 'Linien'}`}
                {ergebnis.gedeckelt ? ' · Höchstgewinn erreicht' : ''}
                {ergebnis.premiumTage > 0 ? ` · +${ergebnis.premiumTage} Tage Premium` : ''}
              </p>
            </div>
          ) : null}
        </div>

        {(stufe === 'gross' || stufe === 'mega' || stufe === 'jackpot') && !wenigerBewegung ? (
          <Partikel anzahl={stufe === 'jackpot' ? 18 : 12} />
        ) : null}
      </div>

      {/*
        Die grossen Meldungen.

        Eine zur Zeit, in einer festen Reihenfolge: was eben passiert ist,
        steht vor dem, was als naechstes kommt. Wer eine Bonusrunde beendet
        und gleichzeitig ein neues Geschenk offen hat, soll erst den Abschluss
        sehen - sonst wird aus zwei Momenten einer, und der erste geht
        verloren.
      */}
      {radAusgang ? (
        <SlotOverlay
          stimmung={radAusgang.gewonnen ? 'gewinn' : 'verlust'}
          augenbraue="Risiko"
          titel={radAusgang.gewonnen ? 'Gamble gewonnen' : 'Gamble verloren'}
          gross={
            radAusgang.gewonnen
              ? `${formatSwissNumber(radAusgang.freispiele)} Freispiele`
              : 'Dein Bonus ist beendet.'
          }
          zeilen={
            radAusgang.gewonnen
              ? ['Die Freispiele laufen mit festem Einsatz - viel Glück.']
              : ['Das Risiko ist nicht aufgegangen - die Bonusrunde ist weg.']
          }
          knopf={radAusgang.gewonnen ? 'Los geht’s' : 'Schade'}
          ruhig={wenigerBewegung}
          aufSchliessen={() => {
            melde({ art: 'uiClick' });
            setRadAusgang(null);
          }}
        />
      ) : meldungen.bonusEnde ? (
        <SlotOverlay
          stimmung={meldungen.bonusEnde.verloren ? 'verlust' : 'gewinn'}
          augenbraue={meldungen.bonusEnde.geschenkt ? 'Geschenktes Bonusspiel' : 'Bonusrunde'}
          titel={meldungen.bonusEnde.verloren ? 'Bonus verloren' : 'Bonus abgeschlossen'}
          zahl={{
            wert: meldungen.bonusEnde.gewinn,
            einheit: 'XP',
            vorzeichen: !meldungen.bonusEnde.verloren,
          }}
          zeilen={[
            meldungen.bonusEnde.verloren
              ? 'Das Risiko ist nicht aufgegangen - die Bonusrunde ist weg.'
              : `${formatSwissNumber(meldungen.bonusEnde.gespielt)} Freispiele gespielt zu ${formatSwissNumber(meldungen.bonusEnde.einsatz)} XP.`,
            meldungen.bonusEnde.retriggers > 0 ? `${meldungen.bonusEnde.retriggers}× verlängert.` : '',
          ].filter((zeile) => zeile.length > 0)}
          knopf="Weiter"
          ruhig={wenigerBewegung}
          aufSchliessen={() => schliesseMeldung('bonus-ende', meldungen.bonusEnde!.rundeId)}
        />
      ) : meldungen.freispielEnde ? (
        <SlotOverlay
          stimmung="gewinn"
          augenbraue="Geschenkte Freispiele"
          titel="Freispiele abgeschlossen"
          zahl={{ wert: meldungen.freispielEnde.gewinn, einheit: 'XP' }}
          zeilen={[
            /*
             * Die Zahl steht oben und nicht auch noch im Satz.
             *
             * Hier stand sie zweimal - einmal als hochzaehlende Summe, einmal
             * ausgeschrieben im Text. Das liest sich wie ein Fehler, und das
             * Hochzaehlen verliert seinen Zweck, wenn das Ergebnis schon
             * daneben steht.
             */
            'Das ist dein gesamter Gewinn aus diesem Freispielpaket.',
            `${formatSwissNumber(meldungen.freispielEnde.gespielt)} Freispiele zu ${formatSwissNumber(meldungen.freispielEnde.einsatz)} XP.`,
            'Ab deinem nächsten Spin spielst du wieder mit deinen eigenen XP.',
          ]}
          knopf="Weiter spielen"
          ruhig={wenigerBewegung}
          aufSchliessen={() => schliesseMeldung('freispiel-ende', meldungen.freispielEnde!.paketId)}
        />
      ) : meldungen.bonusIntro ? (
        <SlotOverlay
          stimmung="geschenk"
          augenbraue="Geschenk vom Team"
          titel="Du hast ein Bonus-Spiel erhalten!"
          gross={`${formatSwissNumber(meldungen.bonusIntro.freispiele)} Freispiele`}
          zeilen={[
            `${formatSwissNumber(meldungen.bonusIntro.freispiele)} Freispiele mit ${formatSwissNumber(meldungen.bonusIntro.einsatz)} XP Einsatz.`,
            'Du kannst sie nehmen - oder riskieren und um mehr spielen. Geht das Risiko schief, ist der Bonus weg.',
            meldungen.bonusIntro.grund ? `Grund: ${meldungen.bonusIntro.grund}` : '',
          ].filter((zeile) => zeile.length > 0)}
          knopf="Bonus starten"
          ruhig={wenigerBewegung}
          aufSchliessen={() => void starteGeschenk(meldungen.bonusIntro!.grantId)}
        />
      ) : meldungen.freispielIntro ? (
        <SlotOverlay
          stimmung="geschenk"
          augenbraue="Geschenk vom Team"
          titel={`Du hast ${formatSwissNumber(meldungen.freispielIntro.anzahl)} Freispiele erhalten!`}
          gross={`${formatSwissNumber(meldungen.freispielIntro.anzahl)} Freispiele`}
          zeilen={[
            `${formatSwissNumber(meldungen.freispielIntro.anzahl)} Freispiele mit ${formatSwissNumber(meldungen.freispielIntro.einsatz)} XP Einsatz.`,
            meldungen.freispielIntro.grund ? `Grund: ${meldungen.freispielIntro.grund}` : '',
          ].filter((zeile) => zeile.length > 0)}
          knopf="Los geht’s"
          ruhig={wenigerBewegung}
          aufSchliessen={() => schliesseMeldung('freispiel-intro', meldungen.freispielIntro!.paketId)}
        />
      ) : null}

      {/* --- Das Risiko-Rad, solange es dreht --- */}
      {radAn && spieler.bonus?.wahl ? (
        <Rad
          chance={spieler.bonus.wahl.chanceBp / 10000}
          riskierenAuf={spieler.bonus.wahl.riskierenAuf}
          nehmen={spieler.bonus.wahl.nehmen}
          ergebnis={radErgebnis}
          aufEnde={radFertig}
        />
      ) : null}

      {/* --- Die Entscheidung der Bonusrunde --- */}
      {entscheidung && spieler.bonus && !radAn ? (
        <Leiter
          nehmen={spieler.bonus.wahl?.nehmen ?? 0}
          riskierenAuf={spieler.bonus.wahl?.riskierenAuf ?? null}
          chance={(spieler.bonus.wahl?.chanceBp ?? 0) / 10000}
          stufen={ansicht.leiter}
          aktuell={spieler.bonus.stufe === 'LADDER_1' ? 0 : 1}
          verloren={leiterVerloren}
          beschaeftigt={beschaeftigt}
          onNehmen={() => void bonusEntscheiden(false)}
          onRiskieren={() => void bonusEntscheiden(true)}
        />
      ) : null}

      {spieler.gesperrt ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-center text-sm text-warning">
          {spieler.gesperrt}
        </p>
      ) : null}

      {/*
        Die Hauptsteuerung: Einsatz, Spin, Auto-Spin.

        Eine Zeile, zentriert, mit dem Spin-Knopf in der Mitte. Alles andere -
        Lautstaerke, Infotafel, Statistik - steht darunter und darf scrollen;
        diese drei duerfen es nicht.
      */}
      <div className={cn('slot-steuerung', imFreispiel && 'slot-steuerung--frei')}>
        <div className="slot-einsatz">
          <button
            type="button"
            className="slot-einsatz__schritt"
            aria-label="Einsatz verringern"
            disabled={beschaeftigt || festerEinsatz !== null || einsatzIndex <= 0}
            onClick={() => einsatzSchritt(-1)}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <span
            className={cn('slot-einsatz__wert', festerEinsatz !== null && 'slot-einsatz__wert--fest')}
            aria-live="polite"
          >
            {formatSwissNumber(wirksamerEinsatz)}
            <span className="ml-1 text-[11px] font-semibold text-muted-foreground">XP</span>
          </span>
          <button
            type="button"
            className="slot-einsatz__schritt"
            aria-label="Einsatz erhöhen"
            disabled={beschaeftigt || festerEinsatz !== null || einsatzIndex >= ansicht.einsaetze.length - 1}
            onClick={() => einsatzSchritt(1)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>

        {/*
          Der Spin-Knopf - und waehrend der Walzen der Stop-Knopf.

          Ein Knopf, zwei Rollen, so wie an jedem Automaten: der zweite Klick
          bringt das Ergebnis sofort. Dass er dabei anders heisst und anders
          aussieht, ist nicht Kosmetik - ein Knopf, der «Spin» sagt und etwas
          anderes tut, ist eine Luege, und jemand wuerde darauf klicken, um
          einen zweiten Spin zu bekommen.

          Gesperrt bleibt er trotzdem, solange etwas laeuft, das man nicht
          ueberspringen kann: die Gewinnlinien, das Rad, eine Entscheidung.
        */}
        <button
          type="button"
          className={cn(
            'slot-spin',
            beschaeftigt && 'slot-spin--laeuft',
            springbar && 'slot-spin--stop',
            ansicht.design.knopfStil === 'puls' && 'slot-knopf--puls',
            ansicht.design.knopfStil === 'ring' && 'slot-knopf--ring',
          )}
          disabled={(beschaeftigt && !springbar) || entscheidung || spieler.gesperrt !== null}
          onClick={() => {
            if (springbar) {
              ueberspringen();
              return;
            }
            void spin();
          }}
        >
          {springbar ? (
            <Square aria-hidden="true" className="size-5" />
          ) : beschaeftigt ? (
            <Sparkles aria-hidden="true" className="size-5 animate-pulse" />
          ) : (
            <Play aria-hidden="true" className="size-5" />
          )}
          {springbar ? 'Stop' : imFreispiel ? 'Freispiel' : 'Spin'}
        </button>

        {autoRest > 0 ? (
          <button
            type="button"
            className="slot-chip slot-chip--an"
            onClick={() => {
              abbrechenRef.current = true;
            }}
          >
            <Pause aria-hidden="true" className="size-3.5" />
            Stop ({autoRest})
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Auto
            </span>
            {ansicht.autoSpinZahlen.map((anzahl) => (
              <button
                key={anzahl}
                type="button"
                className="slot-chip"
                disabled={beschaeftigt || entscheidung || spieler.gesperrt !== null}
                aria-label={`Auto-Spin über ${anzahl} Runden`}
                onClick={() => void autoStarten(anzahl)}
              >
                {anzahl}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={cn('slot-chip', schnell && 'slot-chip--an')}
          aria-label="Quick Spin"
          aria-pressed={schnell}
          onClick={() => {
            melde({ art: 'uiClick' });
            setzeSchnell(!schnell);
          }}
        >
          <Zap aria-hidden="true" className="size-3.5" />
          Quick Spin
        </button>
      </div>

      {/*
        Die Werkzeuge.

        Infotafel, Ton, Stand - alles, was man einmal einstellt und dann in
        Ruhe laesst. Auf dem Telefon rutscht die Zeile unter die Steuerung und
        darf dort auch ausserhalb des Bildschirms liegen.
      */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Infotafel ansicht={ansicht} />

        <button
          type="button"
          className={cn('slot-chip', ton.einstellungen.effekteAn && 'slot-chip--an')}
          aria-label="Effekte"
          aria-pressed={ton.einstellungen.effekteAn}
          onClick={() => {
            ton.freigeben();
            ton.setzeEinstellungen({ effekteAn: !ton.einstellungen.effekteAn });
          }}
        >
          {ton.einstellungen.effekteAn ? (
            <Volume2 aria-hidden="true" className="size-3.5" />
          ) : (
            <VolumeX aria-hidden="true" className="size-3.5" />
          )}
          Effekte
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={ton.einstellungen.effekteLaut}
          aria-label="Lautstärke der Effekte"
          className="h-1 w-20 accent-[hsl(var(--primary-bright))]"
          onChange={(ereignis) => ton.setzeEinstellungen({ effekteLaut: Number(ereignis.target.value) })}
        />

        <button
          type="button"
          className={cn('slot-chip', ton.einstellungen.musikAn && 'slot-chip--an')}
          aria-label="Musik"
          aria-pressed={ton.einstellungen.musikAn}
          onClick={() => {
            const wert = !ton.einstellungen.musikAn;
            ton.freigeben();
            ton.setzeEinstellungen({ musikAn: wert });
            if (!wert) {
              ton.stoppeSchleife('musik');
              ton.stoppeSchleife('freespin_loop');
            }
          }}
        >
          <Music aria-hidden="true" className="size-3.5" />
          Musik
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={ton.einstellungen.musikLaut}
          aria-label="Lautstärke der Musik"
          className="h-1 w-20 accent-[hsl(var(--primary-bright))]"
          onChange={(ereignis) => ton.setzeEinstellungen({ musikLaut: Number(ereignis.target.value) })}
        />

        <button
          type="button"
          className="slot-chip"
          aria-label="Stand aktualisieren"
          onClick={() => void standAktualisieren()}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Stand
        </button>
      </div>

      {/* --- Sitzungsstatistik: eine Zeile, kein Kachelfeld --- */}
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-[11px] text-muted-foreground">
        <span>
          Sitzung: <strong className="tabular-nums text-foreground">{spieler.statistik.spins}</strong> Spins
        </span>
        <span>
          Eingesetzt{' '}
          <strong className="tabular-nums text-foreground">
            {formatSwissNumber(spieler.statistik.einsatz)}
          </strong>
        </span>
        <span>
          Gewonnen{' '}
          <strong className="tabular-nums text-foreground">
            {formatSwissNumber(spieler.statistik.gewinn)}
          </strong>
        </span>
        <span>
          Saldo{' '}
          <strong className="tabular-nums text-foreground">
            {spieler.statistik.saldo > 0 ? '+' : ''}
            {formatSwissNumber(spieler.statistik.saldo)}
          </strong>
        </span>
        <span>
          Bester Spin{' '}
          <strong className="tabular-nums text-foreground">
            {formatSwissNumber(spieler.statistik.bestesSpin)}
          </strong>
        </span>
      </p>

      <p className="text-center text-[11px] text-muted-foreground">
        Spiele bewusst mit deinen XP. Theoretische Auszahlungsquote: {(ansicht.rtp * 100).toFixed(1)} % über
        viele Spins.
      </p>
    </div>
  );
}

/**
 * Ein Feld im HUD.
 *
 * Es merkt sich seinen vorherigen Wert und blitzt auf, wenn er sich aendert -
 * nach oben rot und gross, nach unten ein kurzes Absacken. Ohne das taeuscht
 * ein Spiel, bei dem die wichtigste Zahl lautlos ausgewechselt wird, Stillstand
 * vor.
 *
 * `still` schaltet die Reaktion ab: Einsatz und Freispielzahl aendern sich,
 * weil jemand sie geaendert hat - da ist ein Aufblitzen keine Nachricht,
 * sondern Unruhe.
 */
function HudFeld({
  label,
  wert,
  notiz = null,
  vorzeichen = false,
  still = false,
}: {
  label: string;
  wert: number;
  notiz?: string | null;
  vorzeichen?: boolean;
  still?: boolean;
}): React.JSX.Element {
  const [richtung, setRichtung] = useState<'auf' | 'ab' | null>(null);
  const vorher = useRef(wert);

  useEffect(() => {
    if (still || wert === vorher.current) {
      vorher.current = wert;
      return undefined;
    }
    setRichtung(wert > vorher.current ? 'auf' : 'ab');
    vorher.current = wert;
    // Die Klasse muss wieder weg, sonst laeuft die Animation beim naechsten
    // Rendern nicht erneut an - eine CSS-Animation startet nur beim Wechsel.
    const uhr = window.setTimeout(() => setRichtung(null), 700);
    return () => window.clearTimeout(uhr);
  }, [still, wert]);

  return (
    <div
      className={cn(
        'slot-hud__feld',
        richtung === 'auf' && 'slot-hud__feld--auf',
        richtung === 'ab' && 'slot-hud__feld--ab',
      )}
    >
      <p className="slot-hud__label">{label}</p>
      <p className="slot-hud__wert">
        {vorzeichen && wert > 0 ? '+' : ''}
        {formatSwissNumber(wert)}
      </p>
      {notiz ? <p className="slot-hud__notiz">{notiz}</p> : null}
    </div>
  );
}

/**
 * Das Spielfeld vor dem ersten Spin.
 *
 * Kein leeres Raster und keine Zufallsziehung im Browser: ein fester Satz
 * Symbole, damit die Maschine beim Laden aussieht wie eine Maschine. Welche
 * Symbole das sind, bedeutet nichts - gespielt wird erst mit dem ersten Spin,
 * und der kommt vom Server.
 */
function startfeld(ansicht: Ansicht): string[] {
  const keys = ansicht.symbole.map((symbol) => symbol.key);
  if (keys.length === 0) {
    return [];
  }
  return Array.from(
    { length: ansicht.walzen * ansicht.reihen },
    (_unused, index) => keys[(index * 5 + 2) % keys.length]!,
  );
}

function hexZuHsl(hex: string): string {
  const roh = hex.replace('#', '');
  const r = Number.parseInt(roh.slice(0, 2), 16) / 255;
  const g = Number.parseInt(roh.slice(2, 4), 16) / 255;
  const b = Number.parseInt(roh.slice(4, 6), 16) / 255;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return '358 79% 52%';
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
