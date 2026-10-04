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
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { level } from '@swisshub/modules';
import { formatSwissNumber } from '@swisshub/shared';
import { cn } from '@/lib/utils';
import { Partikel, Walzen } from './walzen';
import { Infotafel } from './infotafel';
import { Leiter } from './leiter';
import { Rad } from './rad';
import { useTon, useWenigerBewegung } from './klang';
import { bonusNehmenAction, bonusRiskierenAction, meinStandAction, spinAction } from '../../xpslot-actions';
import '../xpslot.css';

type Ansicht = Awaited<ReturnType<typeof level.xpslot.slotAnsicht>>;
type Spieler = Awaited<ReturnType<typeof level.xpslot.spielerAnsicht>>;
type Ergebnis = Awaited<ReturnType<typeof level.xpslot.dreheSpin>>;

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
  /** Wie lange ein Treffer je Linie hervorgehoben wird. */
  linie: 520,
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

/** Welcher Klang zu welcher Gewinnstufe gehoert. */
const STUFEN_KLANG: Record<string, string> = {
  keine: 'no_win',
  klein: 'win_small',
  normal: 'win_normal',
  gross: 'win_big',
  mega: 'win_mega',
  jackpot: 'jackpot',
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
  const wenigerBewegung = useWenigerBewegung();

  const [spieler, setSpieler] = useState<Spieler>(start);
  const [einsatz, setEinsatz] = useState<number>(start.einsatz);
  const [grid, setGrid] = useState<string[]>(() => startfeld(ansicht));
  const [laufend, setLaufend] = useState<boolean[]>(() =>
    Array.from({ length: ansicht.walzen }, () => false),
  );
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [sichtbareLinie, setSichtbareLinie] = useState<number | null>(null);
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
  const [radAn, setRadAn] = useState(false);
  const [radErgebnis, setRadErgebnis] = useState<'gewonnen' | 'verloren' | null>(null);
  const radFolge = useRef<Spieler['bonus']>(null);

  const laeuftRef = useRef(false);
  const abbrechenRef = useRef(false);
  const lebtRef = useRef(true);

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
      ton.spiele('ui_button');
      setEinsatz(wert);
    },
    [ansicht.einsaetze, einsatz, ton],
  );

  /*
   * Der Schluessel des Wild-Symbols.
   *
   * Gebraucht fuer die haftende Lage: ein Sticky Wild muss waehrend des Laufs
   * sichtbar bleiben, und dafuer muss die Walzenansicht wissen, welches
   * Symbol sie dort zeichnen soll. Die Rolle kommt aus der Ansicht - es gibt
   * keine zweite Liste, in der «wild» als Zeichenkette steht.
   */
  const wildKey = useMemo(
    () => ansicht.symbole.find((symbol) => symbol.rolle === 'WILD')?.key ?? null,
    [ansicht.symbole],
  );

  const imFreispiel = spieler.bonus?.stufe === 'SPINS' || spieler.freispieleOffen > 0;
  const freispieleRest =
    (spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.offen : 0) + spieler.freispieleOffen;
  const festerEinsatz = spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.einsatz : spieler.freispielEinsatz;
  const wirksamerEinsatz = festerEinsatz ?? einsatz;

  // Die Freispielmusik laeuft, solange Freispiele laufen - und nur dann.
  useEffect(() => {
    if (!ton.freigegeben) {
      return;
    }
    if (imFreispiel) {
      ton.stoppeSchleife('musik');
      ton.starteSchleife('freespin_loop');
    } else {
      ton.stoppeSchleife('freespin_loop');
      if (ton.einstellungen.musikAn) {
        ton.starteSchleife('musik');
      }
    }
  }, [imFreispiel, ton]);

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

  /** Ein Spin, vollstaendig: Anfrage, Inszenierung, Fortschreibung. */
  const dreheEinmal = useCallback(async (): Promise<{ weiter: boolean; grund: string | null }> => {
    ton.freigeben();
    setErgebnis(null);
    setSichtbareLinie(null);
    setLeiterVerloren(false);
    setLaufend(Array.from({ length: ansicht.walzen }, () => true));
    ton.spiele('spin_start');
    ton.starteSchleife('reel_loop');

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
      ton.stoppeSchleife('reel_loop');
      setLaufend(Array.from({ length: ansicht.walzen }, () => false));
      return { weiter: false, grund: antwort.error.message };
    }

    const spin = antwort.data;
    const grund = schnell ? ZEITEN.schnellGrund : ZEITEN.grund;
    const staffel = ZEITEN.staffel;

    // Mindestlaufzeit: der Server ist schneller als das Auge.
    await warte(Math.max(0, grund - (Date.now() - begonnen)));
    if (!lebtRef.current) {
      return { weiter: false, grund: null };
    }
    setGrid(spin.grid);

    /*
     * Die Stopps.
     *
     * Drei Faelle, und sie unterscheiden sich nur in der Zeit - nie im
     * Ergebnis: das steht fertig in `spin`.
     *
     *  1. **Quick Spin ohne Sweat**: alle fuenf halten im selben Bild, ein
     *     Stoppklang.
     *  2. **Quick Spin mit Sweat**: die Walzen vor der entscheidenden halten
     *     gemeinsam, dann dreht die letzte weiter.
     *  3. **Normal**: einzeln von links nach rechts, mit Zuschlag auf den
     *     Sweat-Walzen.
     */
    const sweatAb = spin.sweatAbWalze;
    const sweatSpielt = sweatAb !== null && !wenigerBewegung;

    const haltAlle = (von: number): void => {
      setLaufend((vorher) => vorher.map((wert, index) => (index >= von ? false : wert)));
    };

    if (schnell && !sweatSpielt) {
      haltAlle(0);
      ton.spiele('reel_stop');
    } else if (schnell && sweatAb !== null) {
      if (sweatAb > 0) {
        haltAlle(0);
        ton.spiele('reel_stop');
      }
      ton.spiele('bonus_sweat');
      await warte(ZEITEN.schnellSweat);
      if (!lebtRef.current) {
        return { weiter: false, grund: null };
      }
      setLaufend(Array.from({ length: ansicht.walzen }, () => false));
      ton.spiele('reel_stop');
    } else {
      for (let walze = 0; walze < ansicht.walzen; walze += 1) {
        const sweat = sweatSpielt && sweatAb !== null && walze >= sweatAb;
        if (sweat && walze === sweatAb) {
          ton.spiele('bonus_sweat');
        }
        await warte(staffel + (sweat ? ZEITEN.sweat : 0));
        if (!lebtRef.current) {
          return { weiter: false, grund: null };
        }
        setLaufend((vorher) => vorher.map((wert, index) => (index === walze ? false : wert)));
        ton.spiele('reel_stop');
      }
    }
    ton.stoppeSchleife('reel_loop');

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
     * Ein ausgeloester Bonus ersetzt den Gewinnklang, er kommt nicht dazu.
     *
     * Vorher spielten beide: «kein Gewinn» und darueber der Bonusklang - das
     * waren zwei Aussagen zur selben Zeit, und die wichtigere ging unter.
     */
    if (spin.bonusAusgeloest) {
      ton.spiele(spin.art === 'BONUS_ROUND' ? 'retrigger' : 'bonus_trigger');
    } else {
      ton.spiele(STUFEN_KLANG[spin.stufe] ?? 'no_win');
    }
    if (spin.premiumTage > 0) {
      ton.spiele('premium_win');
    }

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

    // Die Linien einzeln zeigen, dann alle zusammen. Nicht bei Quick Spin
    // und nicht bei weniger Bewegung - dort steht das Ergebnis sofort.
    if (spin.treffer.length > 1 && !schnell && !wenigerBewegung) {
      for (const treffer of spin.treffer) {
        setSichtbareLinie(treffer.linie);
        await warte(ZEITEN.linie);
        if (!lebtRef.current) {
          return { weiter: false, grund: null };
        }
      }
      setSichtbareLinie(null);
    } else if (spin.treffer.length === 1) {
      setSichtbareLinie(spin.treffer[0]!.linie);
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
  }, [ansicht.walzen, csrfToken, schnell, ton, wenigerBewegung, wirksamerEinsatz]);

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
        ton.spiele('ui_button');
        try {
          const antwort = await bonusNehmenAction({ csrfToken, rundeId: runde.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          const neu = antwort.data.bonus;
          ton.spiele('bonus_reveal');
          if (neu.stufe === 'SPINS') {
            ton.spiele('freespin_start');
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
      setRadAn(true);
      ton.spiele('gamble_start');
      ton.starteSchleife('gamble_spin');
      ton.spiele('gamble_tension');

      try {
        const antwort = await bonusRiskierenAction({ csrfToken, rundeId: runde.id });
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          ton.stoppeSchleife('gamble_spin');
          setRadAn(false);
          setBeschaeftigt(false);
          return;
        }
        // Ab hier steht das Ergebnis fest. Das Rad faehrt darauf aus; der
        // Zustand folgt in `radFertig`.
        radFolge.current = antwort.data.bonus;
        setRadErgebnis(antwort.data.gewonnen ? 'gewonnen' : 'verloren');
      } catch (fehler) {
        ton.stoppeSchleife('gamble_spin');
        setRadAn(false);
        setBeschaeftigt(false);
        throw fehler;
      }
    },
    [beschaeftigt, csrfToken, spieler.bonus, ton],
  );

  /** Das Rad steht - jetzt gilt, was der Server gesagt hat. */
  const radFertig = useCallback(() => {
    ton.stoppeSchleife('gamble_spin');
    const neu = radFolge.current;
    const gewonnen = radErgebnis === 'gewonnen';
    ton.spiele(gewonnen ? 'gamble_win' : 'gamble_lose');
    setLeiterVerloren(!gewonnen);
    if (neu?.stufe === 'SPINS') {
      ton.spiele('freespin_start');
      toast.success(`${neu.offen} Freispiele - viel Glück.`);
    }
    if (!gewonnen) {
      toast.error('Das Risiko ist nicht aufgegangen - die Bonusrunde ist weg.');
    }
    setSpieler((vorher) => ({
      ...vorher,
      bonus: !neu || neu.stufe === 'LOST' || neu.stufe === 'FINISHED' ? null : neu,
    }));
    setRadAn(false);
    setRadErgebnis(null);
    radFolge.current = null;
    setBeschaeftigt(false);
  }, [radErgebnis, ton]);

  /** Den Stand neu holen - nach einem Fehler oder einer Sperre. */
  const standAktualisieren = useCallback(async () => {
    const antwort = await meinStandAction({ csrfToken });
    if (antwort.ok) {
      setSpieler(antwort.data);
    }
  }, [csrfToken]);

  // Ist die Bonusrunde fertig, soll die Freispielmusik enden und der Stand
  // stimmen - die Rundensumme steht erst dann fest.
  useEffect(() => {
    if (spieler.bonus === null && !beschaeftigt && ergebnis?.art === 'BONUS_ROUND') {
      ton.spiele('freespin_end');
      void standAktualisieren();
    }
  }, [beschaeftigt, ergebnis?.art, spieler.bonus, standAktualisieren, ton]);

  const stufe = ergebnis && !laufend.some(Boolean) ? ergebnis.stufe : 'keine';
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
        <HudFeld
          label="Gewinn"
          wert={imFreispiel ? (spieler.bonus?.gewinn ?? 0) : (ergebnis?.gewinn ?? 0)}
          vorzeichen
        />
        <HudFeld
          label="Freispiele"
          wert={freispieleRest}
          notiz={festerEinsatz !== null ? `zu ${festerEinsatz} XP` : null}
          still
        />
      </div>

      {/* --- Die Bühne --- */}
      <div
        className={cn(
          'slot-buehne',
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
          />
        </div>

        {/*
          Die Gewinnzeile hat immer dieselbe Hoehe - auch ohne Gewinn.

          Sonst waechst die Buehne in dem Moment, in dem ein Gewinn erscheint,
          und schiebt die Steuerung nach unten. Genau diese Art von Sprung soll
          dieser Umbau beseitigen; ein leerer Platz ist der Preis dafuer.
        */}
        <div className="slot-gewinnzeile relative">
          {ergebnis && ergebnis.gewinn > 0 && !laufend.some(Boolean) ? (
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

        <button
          type="button"
          className={cn(
            'slot-spin',
            beschaeftigt && 'slot-spin--laeuft',
            ansicht.design.knopfStil === 'puls' && 'slot-knopf--puls',
            ansicht.design.knopfStil === 'ring' && 'slot-knopf--ring',
          )}
          disabled={beschaeftigt || entscheidung || spieler.gesperrt !== null}
          onClick={() => void spin()}
        >
          {beschaeftigt ? (
            <Sparkles aria-hidden="true" className="size-5 animate-pulse" />
          ) : (
            <Play aria-hidden="true" className="size-5" />
          )}
          {imFreispiel ? 'Freispiel' : 'Spin'}
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
            ton.spiele('ui_button');
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
 * Eine Zahl, die hochzaehlt.
 *
 * Ueber `requestAnimationFrame` und nicht ueber einen Intervall: der Browser
 * entscheidet, wann ein Bild faellig ist, und bei einem Hintergrundtab faellt
 * gar keines an. Ein Intervall zaehlte dort weiter und waere beim Zurueckkommen
 * mitten im Sprung.
 *
 * Bei `prefers-reduced-motion` steht die Endzahl sofort da. Wer weniger
 * Bewegung will, will das Ergebnis und nicht die Vorfuehrung.
 */
function Hochzaehlen({ ziel, ruhig }: { ziel: number; ruhig: boolean }): React.JSX.Element {
  const [wert, setWert] = useState(ruhig ? ziel : 0);

  useEffect(() => {
    if (ruhig) {
      setWert(ziel);
      return undefined;
    }
    const dauer = 650;
    const start = performance.now();
    let bild = 0;
    const schritt = (jetzt: number): void => {
      const p = Math.min(1, (jetzt - start) / dauer);
      // Weich auslaufen: schnell los, ruhig an die Endzahl heran.
      setWert(Math.round(ziel * (1 - Math.pow(1 - p, 3))));
      if (p < 1) {
        bild = requestAnimationFrame(schritt);
      }
    };
    bild = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(bild);
  }, [ruhig, ziel]);

  return <>{formatSwissNumber(wert)}</>;
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
