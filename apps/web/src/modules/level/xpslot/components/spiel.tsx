'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Music, Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { level } from '@swisshub/modules';
import { formatSwissNumber } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Gewinnlinie, Partikel, Walzen } from './walzen';
import { Infotafel } from './infotafel';
import { Leiter } from './leiter';
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

/** Die Zeiten der Inszenierung. */
const ZEITEN = {
  grund: 620,
  staffel: 160,
  /** Zuschlag je Sweat-Walze - die Spannung, die der Server bestaetigt hat. */
  sweat: 700,
  schnellGrund: 230,
  schnellStaffel: 55,
  /** Wie lange ein Treffer je Linie hervorgehoben wird. */
  linie: 520,
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
    const staffel = schnell ? ZEITEN.schnellStaffel : ZEITEN.staffel;

    // Mindestlaufzeit: der Server ist schneller als das Auge.
    await warte(Math.max(0, grund - (Date.now() - begonnen)));
    if (!lebtRef.current) {
      return { weiter: false, grund: null };
    }
    setGrid(spin.grid);

    // Die Stopps, Walze fuer Walze. Die Sweat-Walzen laufen laenger - und
    // zwar, weil der Server gesagt hat, dass dort wirklich etwas offen war.
    for (let walze = 0; walze < ansicht.walzen; walze += 1) {
      const sweat = spin.sweatAbWalze !== null && walze >= spin.sweatAbWalze && !wenigerBewegung && !schnell;
      if (sweat && walze === spin.sweatAbWalze) {
        ton.spiele('bonus_sweat');
      }
      await warte(staffel + (sweat ? ZEITEN.sweat : 0));
      if (!lebtRef.current) {
        return { weiter: false, grund: null };
      }
      setLaufend((vorher) => vorher.map((wert, index) => (index === walze ? false : wert)));
      ton.spiele('reel_stop');
    }
    ton.stoppeSchleife('reel_loop');

    setErgebnis(spin);
    ton.spiele(STUFEN_KLANG[spin.stufe] ?? 'no_win');
    if (spin.premiumTage > 0) {
      ton.spiele('premium_win');
    }
    if (spin.bonusAusgeloest) {
      ton.spiele(spin.art === 'BONUS_ROUND' ? 'retrigger' : 'bonus_trigger');
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

  const bonusEntscheiden = useCallback(
    async (riskieren: boolean) => {
      const runde = spieler.bonus;
      if (!runde || beschaeftigt) {
        return;
      }
      setBeschaeftigt(true);
      ton.spiele(riskieren ? 'gamble_start' : 'ui_button');
      try {
        const antwort = riskieren
          ? await bonusRiskierenAction({ csrfToken, rundeId: runde.id })
          : await bonusNehmenAction({ csrfToken, rundeId: runde.id });
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          return;
        }
        const neu = antwort.data.bonus;
        if (riskieren && 'gewonnen' in antwort.data) {
          ton.spiele(antwort.data.gewonnen ? 'gamble_win' : 'gamble_lose');
          setLeiterVerloren(!antwort.data.gewonnen);
          if (!antwort.data.gewonnen) {
            toast.error('Das Risiko ist nicht aufgegangen - die Bonusrunde ist weg.');
          }
        } else {
          ton.spiele('bonus_reveal');
        }
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
    },
    [beschaeftigt, csrfToken, spieler.bonus, ton],
  );

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
    <div className="space-y-4">
      {/* --- Kopfzeile: XP, Einsatz, Freispiele - immer sichtbar --- */}
      <div className="grid gap-2 sm:grid-cols-4">
        <Wert label="Deine XP" wert={formatSwissNumber(spieler.xp)} />
        <Wert label="Einsatz" wert={`${wirksamerEinsatz} XP`} hinweis={festerEinsatz ? 'festgelegt' : null} />
        <Wert
          label="Freispiele"
          wert={String(freispieleRest)}
          hinweis={festerEinsatz ? `zu ${festerEinsatz} XP` : null}
        />
        <Wert
          label={imFreispiel ? 'Bonusgewinn' : 'Letzter Gewinn'}
          wert={`${formatSwissNumber(imFreispiel ? (spieler.bonus?.gewinn ?? 0) : (ergebnis?.gewinn ?? 0))} XP`}
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
          <p className="slot-frei-schild relative pt-4 text-center text-xs font-bold uppercase text-[hsl(42_95%_60%)]">
            Free Spins · {freispieleRest} übrig
            {spieler.bonus?.retriggers ? ` · ${spieler.bonus.retriggers}× verlängert` : ''}
          </p>
        ) : null}

        <div className="relative">
          <Walzen
            grid={grid}
            symbole={ansicht.symbole}
            laufend={laufend}
            treffer={trefferZellen}
            klebend={spieler.bonus?.stufe === 'SPINS' ? spieler.bonus.stickyZellen : []}
            sweatAbWalze={ergebnis?.sweatAbWalze ?? null}
            reihen={ansicht.reihen}
            walzen={ansicht.walzen}
          />
          {linienPfad ? (
            <Gewinnlinie zellen={linienPfad} reihen={ansicht.reihen} walzen={ansicht.walzen} />
          ) : null}
        </div>

        {ergebnis && ergebnis.gewinn > 0 && !laufend.some(Boolean) ? (
          <div className="relative pb-4 text-center">
            <p className="slot-gewinn text-3xl font-black text-[hsl(var(--primary-bright))]">
              +{formatSwissNumber(ergebnis.gewinn)} XP
            </p>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {stufe === 'jackpot'
                ? 'Jackpot'
                : stufe === 'mega'
                  ? 'Mega Win'
                  : stufe === 'gross'
                    ? 'Big Win'
                    : `${ergebnis.treffer.length} ${ergebnis.treffer.length === 1 ? 'Linie' : 'Linien'}`}
              {ergebnis.gedeckelt ? ' · Höchstgewinn erreicht' : ''}
            </p>
            {ergebnis.premiumTage > 0 ? (
              <p className="mt-1 text-sm font-semibold text-[hsl(42_95%_60%)]">
                + {ergebnis.premiumTage} Tage Premium
              </p>
            ) : null}
          </div>
        ) : null}

        {(stufe === 'gross' || stufe === 'mega' || stufe === 'jackpot') && !wenigerBewegung ? (
          <Partikel anzahl={stufe === 'jackpot' ? 18 : 12} />
        ) : null}
      </div>

      {/* --- Die Entscheidung der Bonusrunde --- */}
      {entscheidung && spieler.bonus ? (
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

      {/* --- Steuerung --- */}
      <div className="rounded-xl border border-border bg-card p-4">
        {spieler.gesperrt ? (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {spieler.gesperrt}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label className="text-xs">Einsatz</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ansicht.einsaetze.map((wert) => (
                <Button
                  key={wert}
                  size="sm"
                  variant={wirksamerEinsatz === wert ? 'default' : 'outline'}
                  disabled={beschaeftigt || festerEinsatz !== null}
                  /*
                   * Ein eigener Name, obwohl «100» dasteht.
                   *
                   * Die Auto-Spin-Knoepfe tragen dieselben Zahlen. Wer die
                   * Seite nur hoert, bekaeme zwei Knoepfe «100» ohne
                   * Unterschied - und derselbe Grund liess den Browser-Smoke
                   * zwei Treffer finden.
                   */
                  aria-label={`Einsatz ${wert} XP`}
                  onClick={() => {
                    ton.spiele('ui_button');
                    setEinsatz(wert);
                  }}
                >
                  {wert}
                </Button>
              ))}
            </div>
            {festerEinsatz !== null ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Freispiele laufen mit ihrem festgelegten Einsatz.
              </p>
            ) : null}
          </div>

          <Button
            size="lg"
            className={cn(
              'slot-knopf min-w-[9rem]',
              ansicht.design.knopfStil === 'puls' && 'slot-knopf--puls',
              ansicht.design.knopfStil === 'ring' && 'slot-knopf--ring',
            )}
            disabled={beschaeftigt || entscheidung || spieler.gesperrt !== null}
            onClick={() => void spin()}
          >
            {beschaeftigt && autoRest === 0 ? (
              <Sparkles aria-hidden="true" className="animate-pulse" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {imFreispiel ? 'Freispiel' : 'Spin'}
          </Button>

          {autoRest > 0 ? (
            <Button
              size="lg"
              variant="destructive"
              onClick={() => {
                abbrechenRef.current = true;
              }}
            >
              <Pause aria-hidden="true" />
              Stop ({autoRest})
            </Button>
          ) : (
            <div>
              <Label className="text-xs">Auto-Spin</Label>
              <div className="mt-1 flex gap-1.5">
                {ansicht.autoSpinZahlen.map((anzahl) => (
                  <Button
                    key={anzahl}
                    size="sm"
                    variant="outline"
                    disabled={beschaeftigt || entscheidung || spieler.gesperrt !== null}
                    aria-label={`Auto-Spin über ${anzahl} Runden`}
                    onClick={() => void autoStarten(anzahl)}
                  >
                    {anzahl}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <Infotafel ansicht={ansicht} />

          <label className="flex items-center gap-2 text-xs">
            {/*
              Ein eigener Name auf dem Schalter.

              Die drei Schalter stehen in einer Reihe mit der Infotafel; ohne
              eigenen Namen sind sie nur ueber ihre Position zu finden - fuer
              Screenreader und fuer den Browser-Smoke gleichermassen. Der
              Smoke griff dadurch die Infotafel statt den Schalter.
            */}
            <Switch aria-label="Quick Spin" checked={schnell} onCheckedChange={setzeSchnell} />
            <Zap aria-hidden="true" className="size-3.5" />
            Quick Spin
          </label>

          <label className="flex items-center gap-2 text-xs">
            <Switch
              aria-label="Effekte"
              checked={ton.einstellungen.effekteAn}
              onCheckedChange={(wert) => {
                ton.freigeben();
                ton.setzeEinstellungen({ effekteAn: wert });
              }}
            />
            {ton.einstellungen.effekteAn ? (
              <Volume2 aria-hidden="true" className="size-3.5" />
            ) : (
              <VolumeX aria-hidden="true" className="size-3.5" />
            )}
            Effekte
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={ton.einstellungen.effekteLaut}
            aria-label="Lautstärke der Effekte"
            className="w-24 accent-[hsl(var(--primary-bright))]"
            onChange={(ereignis) => ton.setzeEinstellungen({ effekteLaut: Number(ereignis.target.value) })}
          />

          <label className="flex items-center gap-2 text-xs">
            <Switch
              aria-label="Musik"
              checked={ton.einstellungen.musikAn}
              onCheckedChange={(wert) => {
                ton.freigeben();
                ton.setzeEinstellungen({ musikAn: wert });
                if (!wert) {
                  ton.stoppeSchleife('musik');
                  ton.stoppeSchleife('freespin_loop');
                }
              }}
            />
            <Music aria-hidden="true" className="size-3.5" />
            Musik
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={ton.einstellungen.musikLaut}
            aria-label="Lautstärke der Musik"
            className="w-24 accent-[hsl(var(--primary-bright))]"
            onChange={(ereignis) => ton.setzeEinstellungen({ musikLaut: Number(ereignis.target.value) })}
          />

          <Button variant="ghost" size="sm" onClick={() => void standAktualisieren()}>
            <RotateCcw aria-hidden="true" />
            Stand aktualisieren
          </Button>
        </div>
      </div>

      {/* --- Sitzungsstatistik --- */}
      <div className="grid gap-2 sm:grid-cols-5">
        <Wert label="Spins (Sitzung)" wert={String(spieler.statistik.spins)} />
        <Wert label="Eingesetzt" wert={`${formatSwissNumber(spieler.statistik.einsatz)} XP`} />
        <Wert label="Gewonnen" wert={`${formatSwissNumber(spieler.statistik.gewinn)} XP`} />
        <Wert
          label="Saldo"
          wert={`${spieler.statistik.saldo > 0 ? '+' : ''}${formatSwissNumber(spieler.statistik.saldo)} XP`}
        />
        <Wert label="Bester Spin" wert={`${formatSwissNumber(spieler.statistik.bestesSpin)} XP`} />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Spiele bewusst mit deinen XP. Theoretische Auszahlungsquote: {(ansicht.rtp * 100).toFixed(1)} % über
        viele Spins.
      </p>
    </div>
  );
}

function Wert({
  label,
  wert,
  hinweis = null,
}: {
  label: string;
  wert: string;
  hinweis?: string | null;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{wert}</p>
      {hinweis ? <p className="text-[11px] text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}

/** Das Startbild: die ersten Symbole, damit das Feld nicht leer beginnt. */
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

/**
 * Hex nach HSL-Bestandteilen.
 *
 * Die Akzentfarbe ist im Dashboard ein Hex-Wert, die Designvariablen des
 * Systems sind HSL-Bestandteile (`358 79% 52%`). Umgerechnet wird hier, weil
 * genau eine Variable gesetzt wird und ein zweites Farbsystem im CSS die
 * Alternative waere.
 */
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
