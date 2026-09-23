'use client';

import { Gamepad2, Trophy } from 'lucide-react';
import { aktiveTageText, eventsText, levelText, messagesText } from '@swisshub/modules/wrapped/texte';
import { formatSwissNumber } from '@swisshub/shared';
import { Faden } from '../teile/faden';
import { Nachsatz, Satz, SzenenRahmen, Vorzeile, ZaehlZahl } from '../teile/bausteine';
import type { SzenenProps } from './registry';

/**
 * Die Nachrichten.
 *
 * ## Die Idee
 *
 * Dieselbe Bauform wie die Sprachzeit - grosse Zahl, Satz davor, Satz
 * danach -, aber ein anderes Bild dahinter: Sprechblasen, die hereinschweben
 * und stehenbleiben. Die Wiederholung der Bauform ist Absicht: sie macht die
 * beiden Zahlen vergleichbar.
 *
 * **Keine Inhalte.** Die Blasen sind leer. Was jemand geschrieben hat, geht
 * diesen Rueckblick nichts an - gezaehlt wird, nie gelesen.
 */
export function NachrichtenSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  const text = messagesText(daten.messages.total);
  const proTag =
    daten.messages.daysWithMessages > 0
      ? Math.round(daten.messages.total / daten.messages.daysWithMessages)
      : 0;

  return (
    <SzenenRahmen>
      {/* Leere Sprechblasen - Form, kein Inhalt. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {BLASEN.map((blase, index) => (
          <span
            key={index}
            className="w-auf absolute rounded-[1.25rem] border border-white/[0.07] bg-white/[0.025]"
            style={{
              left: `${blase.x}%`,
              top: `${blase.y}%`,
              width: `${blase.w}rem`,
              height: `${blase.h}rem`,
              ['--verzug' as string]: `${300 + index * 90}ms`,
            }}
          />
        ))}
      </div>

      <div className="relative space-y-7">
        <Satz verzug={150}>{text.setup}</Satz>

        <div>
          <ZaehlZahl wert={daten.messages.total} verzug={900} dauer={1800} stillstand={stillstand} />
          <p className="w-auf w-label mt-3 text-white/55" style={{ ['--verzug' as string]: '1600ms' }}>
            Nachrichten
          </p>
        </div>

        {proTag > 0 ? (
          <Nachsatz verzug={2200}>
            {/* Ausdrücklich «je Tag mit Nachrichten» - nicht je Kalendertag.
                Die schwächere Aussage ist die richtige. */}
            Das sind {proTag} an jedem Tag, an dem du überhaupt etwas geschrieben hast.
          </Nachsatz>
        ) : null}
      </div>
    </SzenenRahmen>
  );
}

/*
 * Bewusst nur oben und unten.
 *
 * Die erste Fassung streute die Blasen ueber die ganze Flaeche - zwei davon
 * landeten genau auf Hoehe der grossen Zahl und machten sie unleserlich.
 * Der Hintergrund darf den Inhalt rahmen, nicht durch ihn hindurchlaufen:
 * das mittlere Drittel bleibt frei.
 */
const BLASEN = [
  { x: 8, y: 14, w: 7, h: 2.5 },
  { x: 60, y: 8, w: 5, h: 2.2 },
  { x: 12, y: 78, w: 6, h: 2.4 },
  { x: 62, y: 86, w: 8, h: 2.6 },
  { x: 40, y: 22, w: 4, h: 2 },
  { x: 74, y: 18, w: 4.5, h: 2.1 },
  { x: 4, y: 88, w: 5.5, h: 2.3 },
];

/**
 * Die aktiven Tage.
 *
 * ## Die Idee
 *
 * Das Jahr als Raster: zwoelf Spalten, je ein Punkt pro aktivem Tag. Die
 * Punkte erscheinen von links nach rechts, Monat fuer Monat - das Jahr
 * laeuft noch einmal ab. Danach steht die Zahl.
 *
 * Es ist dieselbe Information wie «286 aktive Tage», aber mit einer Form:
 * man sieht, wann es dicht war und wann duenn.
 */
const MONATE = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Punkte je Spalte: vierzehn fuer den staerksten Monat, mindestens einer. */
const HOECHSTE_SPALTE = 14;
function punkte(tage: number, spitze: number): number {
  if (tage <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((tage / spitze) * HOECHSTE_SPALTE));
}

export function AktiveTageSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  const text = aktiveTageText(daten.aktivitaet.activeDays);
  const monate = daten.aktivitaet.daysPerMonth;
  const spitze = Math.max(1, ...monate);

  return (
    <SzenenRahmen>
      <div className="space-y-8">
        <Vorzeile verzug={100}>Dein Jahr</Vorzeile>

        {/*
          Zwoelf Spalten, Hoehe im Verhaeltnis zum staerksten Monat.

          Die erste Fassung setzte einen Punkt je Tag und deckelte bei 14.
          Wer in jedem Monat mehr als vierzehn Tage da war, bekam zwoelf
          identische Spalten - eine Grafik, die nichts mehr zeigte. Jetzt
          fuellt der staerkste Monat die Spalte, alle anderen stehen dazu
          im Verhaeltnis; ein Monat mit auch nur einem Tag behaelt einen
          Punkt, damit «wenig» und «gar nichts» unterscheidbar bleiben.
        */}
        <div
          className="mx-auto max-w-md space-y-2 sm:max-w-xl"
          role="img"
          aria-label={`Aktive Tage je Monat: ${monate.map((tage, monat) => `${MONATE[monat] ?? ''} ${tage}`).join(', ')}`}
        >
          <div className="flex h-36 items-end justify-between gap-1.5 sm:gap-2.5">
            {monate.map((tage, monat) => (
              <div key={monat} className="flex flex-1 flex-col-reverse items-center gap-[3px]">
                {Array.from({ length: punkte(tage, spitze) }, (_, punkt) => (
                  <span
                    key={punkt}
                    className="w-punkt size-[5px] rounded-full bg-[hsl(var(--w-rot-hell))] sm:size-1.5"
                    style={{
                      ['--von-y' as string]: '-28px',
                      ['--verzug' as string]: `${250 + monat * 90 + punkt * 22}ms`,
                      opacity: 0.5 + (tage / spitze) * 0.5,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-end justify-between gap-1.5 sm:gap-2.5" aria-hidden="true">
            {MONATE.map((kuerzel, monat) => (
              <span
                key={monat}
                className="w-auf flex-1 text-center text-[0.6rem] font-semibold uppercase tracking-widest text-white/30"
                style={{ ['--verzug' as string]: `${400 + monat * 60}ms` }}
              >
                {kuerzel}
              </span>
            ))}
          </div>
        </div>

        <div>
          <ZaehlZahl
            wert={daten.aktivitaet.activeDays}
            verzug={1700}
            dauer={1500}
            stillstand={stillstand}
            className="w-zahl-klein"
          />
          <p className="w-auf w-label mt-2 text-white/55" style={{ ['--verzug' as string]: '2200ms' }}>
            aktive Tage
          </p>
        </div>

        <Satz verzug={2450} className="text-white/85">
          {text.setup}
        </Satz>
      </div>
    </SzenenRahmen>
  );
}

/**
 * Die Spiele.
 *
 * ## Die vorsichtige Formulierung
 *
 * Es steht nicht «dein meistgespieltes Spiel» da, sondern «am häufigsten
 * gesucht». Der Grund ist einfach: dieses System weiss nicht, was jemand
 * gespielt hat. Es weiss, bei welchen Spielen er in der Spielersuche dabei
 * war. Das ist weniger, und genau das wird gesagt.
 *
 * Eine schoenere Behauptung waere hier leicht gewesen - und falsch.
 */
export function SpieleSzene({ daten }: SzenenProps): React.JSX.Element {
  const [oben, ...weitere] = daten.spiele.top;
  if (!oben) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }

  return (
    <SzenenRahmen ausrichtung="links">
      <div className="w-full space-y-6">
        <Vorzeile verzug={100}>
          <span className="inline-flex items-center gap-2">
            <Gamepad2 className="size-3.5" aria-hidden="true" />
            Gesucht wurde vor allem
          </span>
        </Vorzeile>

        <div className="space-y-2">
          <p
            className="w-vorhang text-[clamp(1.9rem,9vw,4rem)] font-extrabold leading-[0.95] tracking-tight"
            style={{ ['--verzug' as string]: '300ms' }}
          >
            {oben.name}
          </p>
          <Faden
            variante="linie"
            className="h-5 w-full max-w-xs text-[hsl(var(--w-rot-hell))]"
            verzug={850}
            breite={5}
          />
          <p className="w-auf w-label text-white/50" style={{ ['--verzug' as string]: '1000ms' }}>
            {oben.sessions}× dabei
          </p>
        </div>

        {weitere.length > 0 ? (
          <ul className="space-y-2 pt-2">
            {weitere.slice(0, 3).map((spiel, index) => (
              <li
                key={spiel.gameId}
                className="w-auf flex items-baseline justify-between gap-4 text-white/45"
                style={{ ['--verzug' as string]: `${1200 + index * 140}ms` }}
              >
                <span className="min-w-0 truncate text-base">{spiel.name}</span>
                <span className="shrink-0 text-sm tabular-nums">{spiel.sessions}×</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Die Einschränkung gehört sichtbar in die Szene, nicht ins Kleingedruckte. */}
        <Nachsatz verzug={1700} className="text-white/35">
          Gezählt werden die Spielersuchen, bei denen du dabei warst - nicht deine Spielzeit.
        </Nachsatz>
      </div>
    </SzenenRahmen>
  );
}

/**
 * Events und Turniere.
 *
 * ## Die Idee
 *
 * Drei Zahlen diagonal versetzt, im Winkel des Logos. Kein Raster aus
 * Kacheln - die Staffelung erzeugt Bewegung im Standbild und macht aus drei
 * Werten eine Komposition.
 *
 * Wer gewonnen hat, bekommt eine eigene Zeile mit Pokal. Ein Sieg ist keine
 * vierte Zahl.
 */
export function EventsSzene({ daten }: SzenenProps): React.JSX.Element {
  const text = eventsText(daten.wettkampf.tournamentsPlayed, daten.wettkampf.tournamentWins);
  const werte = [
    {
      wert: daten.wettkampf.tournamentsPlayed,
      label: daten.wettkampf.tournamentsPlayed === 1 ? 'Turnier' : 'Turniere',
    },
    {
      wert: daten.wettkampf.eventsAttended,
      label: daten.wettkampf.eventsAttended === 1 ? 'Event' : 'Events',
    },
  ].filter((eintrag) => eintrag.wert > 0);

  return (
    <SzenenRahmen ausrichtung="links">
      <div className="w-full space-y-8">
        <Satz verzug={120}>{text.setup}</Satz>

        <div className="space-y-4">
          {werte.map((eintrag, index) => (
            <div
              key={eintrag.label}
              className="w-tiefe flex items-baseline gap-4"
              style={{
                ['--verzug' as string]: `${450 + index * 260}ms`,
                // Diagonal versetzt - im Winkel des Fadens.
                marginLeft: `${index * 2.5}rem`,
              }}
            >
              <span className="w-zahl-klein text-[hsl(var(--w-rot-hell))]">{eintrag.wert}</span>
              <span className="w-label text-white/60">{eintrag.label}</span>
            </div>
          ))}
        </div>

        {daten.wettkampf.tournamentWins > 0 ? (
          <div
            className="w-einrasten inline-flex items-center gap-3 rounded-full bg-[hsl(var(--w-rot))] px-5 py-2.5"
            style={{ ['--verzug' as string]: `${500 + werte.length * 260}ms` }}
          >
            <Trophy className="size-5 text-[hsl(45_92%_62%)]" aria-hidden="true" />
            <span className="font-semibold">{daten.wettkampf.tournamentWins}× gewonnen</span>
          </div>
        ) : null}

        {daten.wettkampf.tournamentTitles[0] ? (
          <Nachsatz verzug={900 + werte.length * 260}>{daten.wettkampf.tournamentTitles[0]}</Nachsatz>
        ) : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Das Level.
 *
 * ## Die Idee
 *
 * Ein Ring, der sich von der alten zur neuen Zahl fuellt. Die Zahl in der
 * Mitte wechselt dabei - von «12» auf «38». Das ist der Uebergang
 * `object_continuity`: der Kreis war in der Szene davor die Uhr, hier ist er
 * der Fortschritt.
 */
export function LevelSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  if (!daten.level) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }
  const { levelStart, levelEnd, xpGained } = daten.level;
  const text = levelText(levelStart, levelEnd);
  const umfang = 2 * Math.PI * 78;

  return (
    <SzenenRahmen>
      <div className="space-y-8">
        <Satz verzug={120}>{text.setup}</Satz>

        <div className="relative mx-auto aspect-square w-full max-w-[16rem]">
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
            <circle
              cx={100}
              cy={100}
              r={78}
              fill="none"
              stroke="white"
              strokeOpacity={0.08}
              strokeWidth={8}
            />
            <circle
              className="wrapped-faden"
              style={{
                ['--faden-laenge' as string]: String(umfang),
                ['--faden-verzug' as string]: stillstand ? '0ms' : '700ms',
              }}
              cx={100}
              cy={100}
              r={78}
              stroke="hsl(var(--w-rot-hell))"
              strokeWidth={8}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="w-auf w-label text-white/40" style={{ ['--verzug' as string]: '300ms' }}>
              Level
            </span>
            {/*
              Untereinander, nicht nebeneinander.
              Der Startwert stand zuerst durchgestrichen neben der grossen
              Zahl - die beiden beruehrten sich, und ein durchgestrichener
              Wert sieht aus wie ein Fehler. «von 12» sagt dasselbe und
              stoert die Zahl nicht.
            */}
            <ZaehlZahl
              wert={levelEnd}
              verzug={900}
              dauer={1500}
              stillstand={stillstand}
              className="w-zahl-klein"
            />
            <span
              className="w-auf text-sm font-medium text-white/40"
              style={{ ['--verzug' as string]: '1800ms' }}
            >
              von {levelStart}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <p
            className="w-einrasten text-[clamp(1.1rem,5vw,1.6rem)] font-bold text-[hsl(var(--w-rot-hell))]"
            style={{ ['--verzug' as string]: '2100ms' }}
          >
            +{formatSwissNumber(xpGained)} XP
          </p>
          <Nachsatz verzug={2350}>
            {levelEnd > levelStart
              ? `${levelEnd - levelStart} Level in einem Jahr.`
              : 'Gesammelt hast du trotzdem einiges.'}
          </Nachsatz>
        </div>
      </div>
    </SzenenRahmen>
  );
}
