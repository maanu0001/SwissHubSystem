'use client';

import { ARCHETYP_NACH_KEY } from '@swisshub/modules/wrapped/archetyp';
import { introZeile } from '@swisshub/modules/wrapped/texte';
import { Faden } from '../teile/faden';
import { Nachsatz, SzenenRahmen, WrappedAvatar } from '../teile/bausteine';
import type { SzenenProps } from './registry';
import { formatSwissNumber } from '@swisshub/shared';

/**
 * Die Eroeffnung.
 *
 * ## Die Idee
 *
 * Drei Zeilen, die nacheinander erscheinen - und dazwischen der Faden, der
 * sich zeichnet. Erst danach kommt die Person ins Bild. Die Reihenfolge ist
 * die Aussage: zuerst das Jahr, dann du.
 *
 * ## Warum die Jahreszahl im Hintergrund steht
 *
 * Weil sie gross sein soll, ohne die Hauptsache zu sein. Als ausgeblasene
 * Kontur hinter dem Text traegt sie die ganze Flaeche und liest sich
 * trotzdem nicht als Ueberschrift.
 */
export function IntroSzene({ daten, jahr }: SzenenProps): React.JSX.Element {
  const name = daten.person.displayName ?? daten.person.username ?? 'Du';
  const zeilen = ['Dein Jahr.', 'Deine Mates.', 'Dein SwissHub.'];

  return (
    <SzenenRahmen>
      {/* Die Jahreszahl als Kontur - Flaeche, keine Ueberschrift. */}
      <span
        aria-hidden="true"
        className="w-auf pointer-events-none absolute inset-0 grid select-none place-items-center text-[38vw] font-black leading-none tracking-tighter text-white/[0.045] sm:text-[26rem]"
        style={{ ['--verzug' as string]: '150ms' }}
      >
        {jahr}
      </span>

      <div className="relative space-y-6">
        <Faden variante="band" className="mx-auto h-16 w-24 text-[hsl(var(--w-rot-hell))]" breite={7} />

        <div className="space-y-1">
          {zeilen.map((zeile, index) => (
            <p
              key={zeile}
              className="w-auf text-[clamp(1.75rem,9vw,3.5rem)] font-bold leading-[1.05] tracking-tight"
              style={{ ['--verzug' as string]: `${400 + index * 220}ms` }}
            >
              {zeile}
            </p>
          ))}
        </div>

        <div
          className="w-auf flex items-center justify-center gap-3 pt-4"
          style={{ ['--verzug' as string]: '1180ms' }}
        >
          <WrappedAvatar
            discordId={daten.person.discordId}
            avatarHash={daten.person.avatarHash}
            name={name}
            groesse={56}
            className="ring-2 ring-white/20"
          />
          <span className="min-w-0 truncate text-left text-lg font-semibold">{name}</span>
        </div>

        <Nachsatz verzug={1400}>{introZeile(daten)}</Nachsatz>
      </div>
    </SzenenRahmen>
  );
}

/**
 * Der Abschluss.
 *
 * ## Warum hier doch Zahlen nebeneinander stehen
 *
 * Weil es die letzte Szene ist. Bis hierher stand je eine Zahl allein auf
 * einem Bildschirm - und genau deshalb funktioniert die Zusammenfassung am
 * Ende: man erkennt sie wieder. Eine Liste am Anfang waere ein Dashboard
 * gewesen; dieselbe Liste am Ende ist ein Rueckblick.
 */
export function FinaleSzene({ daten, jahr, stillstand }: SzenenProps): React.JSX.Element {
  const stunden = Math.round(daten.voice.seconds / 3600);
  const typ = ARCHETYP_NACH_KEY.get(daten.archetyp.key as never);

  const zeilen = [
    daten.aktivitaet.activeDays >= 20 ? `${daten.aktivitaet.activeDays} aktive Tage.` : null,
    stunden >= 1 ? `${stunden} Stunden im Voice.` : null,
    daten.messages.total >= 50 ? `${formatSwissNumber(daten.messages.total)} Nachrichten.` : null,
    daten.clips.wins > 0 ? `${daten.clips.wins}× Clip of the Week.` : null,
    daten.wettkampf.tournamentWins > 0 ? `${daten.wettkampf.tournamentWins}× ein Turnier gewonnen.` : null,
  ].filter((zeile): zeile is string => zeile !== null);

  /*
   * Wenn nichts ueber der Schwelle liegt, zaehlt, was da ist.
   *
   * Die Schwellen oben sortieren aus, was in einer Aufzaehlung albern
   * wirkt - «3 aktive Tage.» neben «187 Stunden im Voice.». Bei einer
   * ruhigen Person bleibt dadurch aber gar nichts uebrig, und der Abspann
   * bestand nur noch aus «Unzaehlige Runden.». Dann lieber die kleinen
   * Zahlen: sie sind das, was diese Person tatsaechlich gemacht hat.
   */
  if (zeilen.length === 0) {
    const minuten = Math.round(daten.voice.seconds / 60);
    const klein = [
      daten.aktivitaet.activeDays > 0
        ? `${daten.aktivitaet.activeDays} ${daten.aktivitaet.activeDays === 1 ? 'Tag' : 'Tage'} dabei.`
        : null,
      minuten > 0 ? `${minuten} ${minuten === 1 ? 'Minute' : 'Minuten'} im Voice.` : null,
      daten.messages.total > 0
        ? `${formatSwissNumber(daten.messages.total)} ${daten.messages.total === 1 ? 'Nachricht' : 'Nachrichten'}.`
        : null,
    ].filter((zeile): zeile is string => zeile !== null);
    zeilen.push(...klein);
  }

  return (
    <SzenenRahmen ausrichtung="links">
      <div className="space-y-8">
        <div className="space-y-2">
          {zeilen.map((zeile, index) => (
            <p
              key={zeile}
              className="w-auf text-[clamp(1.25rem,6vw,2rem)] font-semibold leading-tight"
              style={{ ['--verzug' as string]: `${200 + index * 180}ms` }}
            >
              {zeile}
            </p>
          ))}
          <p
            className="w-auf text-[clamp(1.25rem,6vw,2rem)] font-semibold leading-tight text-white/55"
            style={{ ['--verzug' as string]: `${200 + zeilen.length * 180}ms` }}
          >
            Unzählige Runden.
          </p>
        </div>

        <Faden
          variante="linie"
          className="h-6 w-full text-[hsl(var(--w-rot-hell))]"
          verzug={stillstand ? 0 : 200 + zeilen.length * 180 + 200}
          breite={5}
        />

        <div className="space-y-3">
          <p
            className="w-auf w-fliess text-white/70"
            style={{ ['--verzug' as string]: `${600 + zeilen.length * 180}ms` }}
          >
            Danke, dass du Teil von SwissHub bist.
          </p>
          {typ ? (
            <p
              className="w-auf w-label text-[hsl(var(--w-rot-hell))]"
              style={{ ['--verzug' as string]: `${740 + zeilen.length * 180}ms` }}
            >
              {typ.label}
            </p>
          ) : null}
        </div>

        <p
          className="w-auf text-[0.7rem] font-semibold uppercase tracking-[0.35em] text-white/30"
          style={{ ['--verzug' as string]: `${900 + zeilen.length * 180}ms` }}
        >
          SwissHub · {jahr}
        </p>
      </div>
    </SzenenRahmen>
  );
}
