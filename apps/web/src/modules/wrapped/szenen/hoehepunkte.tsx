'use client';

import { useState } from 'react';
import { Play, Trophy } from 'lucide-react';
import { ARCHETYP_NACH_KEY } from '@swisshub/modules/wrapped/archetyp';
import { formatSwissNumber } from '@swisshub/shared';
import { clipsText } from '@swisshub/modules/wrapped/texte';
import type { WrappedDaten } from '@swisshub/modules/wrapped/daten';
import { Faden } from '../teile/faden';
import { enge, Nachsatz, Satz, SzenenRahmen, Vorzeile } from '../teile/bausteine';
import type { SzenenProps } from './registry';

/**
 * Der Clip.
 *
 * ## Warum hier ein Standbild und kein Player
 *
 * Eine Story ist kein Ort fuer ein Video, das erst laedt und dann vielleicht
 * mit Ton losgeht. Was hier steht, ist das Vorschaubild mit einem
 * Abspielknopf - und wer ihn drueckt, verlaesst den Rueckblick und landet
 * beim Clip. Das ist ehrlicher als ein Rahmen, der im Hintergrund
 * mitrechnet, waehrend die Geschichte weiterlaeuft.
 *
 * Kein Autoplay, kein Ton. Nie.
 */
export function ClipSzene({ daten }: SzenenProps): React.JSX.Element {
  const clip = daten.clips.best;
  const [bildKaputt, setBildKaputt] = useState(false);
  if (!clip) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }
  const text = clipsText(daten.clips.wins);

  return (
    <SzenenRahmen>
      <div className="space-y-6">
        <Satz verzug={120}>{text.setup}</Satz>

        <a
          href={clip.canonicalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="w-vorhang group relative mx-auto block w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          style={{ ['--verzug' as string]: '450ms' }}
        >
          <div className="aspect-video w-full bg-black/60">
            {clip.thumbnailUrl && !bildKaputt ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={clip.thumbnailUrl}
                alt=""
                className="size-full object-cover opacity-80 transition group-hover:opacity-100"
                loading="eager"
                onError={() => setBildKaputt(true)}
              />
            ) : null}
          </div>
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-16 place-items-center rounded-full bg-[hsl(var(--w-rot))] shadow-xl transition group-hover:scale-105">
              <Play className="size-7 translate-x-px fill-current" aria-hidden="true" />
            </span>
          </span>
        </a>

        <div className="space-y-2">
          <p
            className="w-auf text-balance text-lg font-semibold leading-snug"
            style={{ ['--verzug' as string]: '1100ms' }}
          >
            {clip.title}
          </p>
          <p className="w-auf w-label text-white/45" style={{ ['--verzug' as string]: '1280ms' }}>
            {clip.votes} {clip.votes === 1 ? 'Stimme' : 'Stimmen'}
            {clip.rank !== null ? ` · Platz ${clip.rank}` : ''}
          </p>
        </div>

        {daten.clips.wins > 0 ? (
          <div
            className="w-einrasten mx-auto inline-flex items-center gap-2.5 rounded-full bg-[hsl(var(--w-rot))] px-5 py-2.5"
            style={{ ['--verzug' as string]: '1500ms' }}
          >
            <Trophy className="size-5 text-[hsl(45_92%_62%)]" aria-hidden="true" />
            <span className="font-semibold">{daten.clips.wins}× Clip of the Week</span>
          </div>
        ) : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Der eine Moment.
 *
 * ## Die Idee
 *
 * Die karge Szene des Rueckblicks. Ein Wert, ein Label, ein Satz - und sehr
 * viel Schwarz drumherum. Nach dreizehn Kapiteln mit Diagrammen und
 * Avataren ist Leere die staerkste Betonung, die noch uebrig ist.
 */
export function HighlightSzene({ daten }: SzenenProps): React.JSX.Element {
  const highlight = daten.highlight;
  if (!highlight) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }

  return (
    <SzenenRahmen>
      <div className="space-y-6">
        <Vorzeile verzug={150}>Dein Moment</Vorzeile>

        <p
          className="w-einrasten w-zahl-klein text-[hsl(var(--w-rot-hell))]"
          style={{ ...enge(highlight.value), ['--verzug' as string]: '500ms' }}
        >
          {highlight.value}
        </p>

        <p
          className="w-auf text-[clamp(1.1rem,5.5vw,1.9rem)] font-semibold"
          style={{ ['--verzug' as string]: '1100ms' }}
        >
          {highlight.label}
        </p>

        {highlight.detail ? <Nachsatz verzug={1400}>{highlight.detail}</Nachsatz> : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Der Typ.
 *
 * ## Die Idee
 *
 * Das Band aus dem Logo zeichnet sich gross in den Hintergrund, davor steht
 * das Etikett. Die Form der Marke traegt die Aussage - das ist die einzige
 * Szene, in der sie so gross vorkommt, und sie hat es sich bis hierher
 * verdient.
 *
 * ## Was das Etikett ist
 *
 * Ein spielerischer Name fuer ein Aktivitaetsmuster. Der Untertitel sagt das
 * auch: welche Zahl dahintersteht. Niemand soll den Eindruck bekommen, hier
 * werde etwas ueber ihn als Person behauptet.
 */
export function ArchetypSzene({ daten }: SzenenProps): React.JSX.Element {
  const typ = ARCHETYP_NACH_KEY.get(daten.archetyp.key as never);
  const begruendung = begruende(daten);

  return (
    <SzenenRahmen>
      {/* Das Band - gross, gedaempft, hinter allem. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
        {/*
          Weit ueber den Rand hinaus und sehr leise.

          Bei 110vw endete das Band noch im Bild - das sah nach einer
          verirrten Form aus statt nach einem Anschnitt. Und bei 30 Prozent
          Deckkraft lief es so kraeftig durch den Fliesstext, dass der
          schlechter zu lesen war als der Hintergrund.
        */}
        <Faden
          variante="band"
          className="h-[55vh] w-[150vw] max-w-4xl text-[hsl(var(--w-rot))] opacity-[0.16] sm:h-[60vh]"
          breite={4}
          verzug={200}
        />
      </div>

      <div className="relative space-y-6">
        <Vorzeile verzug={400}>Du warst</Vorzeile>

        <p
          className="w-vorhang text-balance text-[clamp(2rem,11vw,4.5rem)] font-extrabold uppercase leading-[0.92] tracking-tight"
          style={{ ['--verzug' as string]: '700ms' }}
        >
          {typ?.label ?? 'The Regular'}
        </p>

        <Satz verzug={1500} className="text-white/80">
          {typ?.claim ?? 'Das war dein Jahr.'}
        </Satz>

        {begruendung ? (
          <Nachsatz verzug={1800} className="text-white/40">
            {begruendung}
          </Nachsatz>
        ) : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Warum dieser Typ.
 *
 * Die Zahl, die ihn ausgeloest hat - damit das Etikett nachvollziehbar
 * bleibt. Ein Typ ohne Begruendung waere eine Behauptung.
 */
function begruende(daten: WrappedDaten): string | null {
  const stunden = Math.round(daten.voice.seconds / 3600);
  switch (daten.archetyp.key) {
    case 'voice_resident':
      return `${stunden} Stunden im Sprachkanal.`;
    case 'night_owl':
      return 'Ein grosser Teil deiner Sprachzeit lag zwischen 22 und 5 Uhr.';
    case 'clip_machine':
      return `${daten.clips.approved} Clips eingereicht, ${daten.clips.wins} davon gewonnen.`;
    case 'competitor':
      return `${daten.wettkampf.tournamentsPlayed} Turniere und ${daten.wettkampf.eventsAttended} Events.`;
    case 'chatter':
      return `${formatSwissNumber(daten.messages.total)} Nachrichten.`;
    case 'allrounder':
      return 'Voice, Chat und Wettbewerb - überall dabei.';
    default:
      return `${daten.aktivitaet.activeDays} Tage, an denen du da warst.`;
  }
}
