'use client';

import { useState } from 'react';
import { Flag, Heart, Play, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ClipSpieler } from './clip-spieler';
import { MeldeDialog } from './melde-dialog';
import { clipAbstimmenAction, clipStimmeZurueckziehenAction } from '@/modules/clips/actions';
import { cn } from '@/lib/utils';
import type { clips } from '@swisshub/modules';

export interface ClipKartenProps {
  karte: clips.ClipKarte;
  einbettung: string;
  csrfToken: string;
  /** Darf jetzt gestimmt werden - Phase, Berechtigung, Restkontingent. */
  abstimmbar: boolean;
  verbleibendeStimmen: number;
  selbstwahlErlaubt: boolean;
  aufStimmeGeaendert?: (verbleibend: number) => void;
}

const RANG_FARBE: Record<number, string> = {
  1: 'bg-[hsl(45_92%_52%)] text-black',
  2: 'bg-[hsl(0_0%_78%)] text-black',
  3: 'bg-[hsl(28_60%_48%)] text-white',
};

/**
 * Ein Clip als Karte.
 *
 * ## Das Bild zuerst
 *
 * Ein Clip ist ein Video, und ein Video erkennt man am Bild, nicht an einer
 * Zeile Text. Die Karte ist deshalb zu zwei Dritteln Vorschaubild mit einem
 * Abspielknopf darauf; Titel, Person und Stimme stehen darunter.
 *
 * ## Ohne Vorschaubild
 *
 * Twitch nennt seine Vorschauadresse nicht ohne Abruf, und geraten wird sie
 * nicht. Statt eines kaputten Bildes steht dann eine dunkle Flaeche mit dem
 * Abspielknopf - dieselbe Form, dieselbe Groesse, keine springende Seite.
 *
 * ## Der Stimmknopf
 *
 * Er zeigt sofort um und nimmt das zurueck, wenn der Server widerspricht.
 * Das ist hier richtig: eine Stimme ist kein Geld, und der haeufige Fall ist
 * der, dass sie ankommt. Was der Server sagt, gilt trotzdem - er ist der
 * einzige, der das Kontingent wirklich kennt.
 */
export function ClipKarte({
  karte,
  einbettung,
  csrfToken,
  abstimmbar,
  verbleibendeStimmen,
  selbstwahlErlaubt,
  aufStimmeGeaendert,
}: ClipKartenProps): React.JSX.Element {
  const [spielerOffen, setSpielerOffen] = useState(false);
  const [meldenOffen, setMeldenOffen] = useState(false);
  const [gestimmt, setGestimmt] = useState(karte.eigeneStimme);
  const [stimmen, setStimmen] = useState(karte.stimmen);
  const [laeuft, setLaeuft] = useState(false);
  const [bildKaputt, setBildKaputt] = useState(false);

  const eigenerOhneSelbstwahl = karte.eigenerClip && !selbstwahlErlaubt;
  const kontingentLeer = !gestimmt && verbleibendeStimmen <= 0;
  const knopfGesperrt = !abstimmbar || laeuft || eigenerOhneSelbstwahl || kontingentLeer;

  const name = karte.einreicher.displayName ?? karte.einreicher.username ?? 'Unbekannt';

  async function stimmen_umschalten(): Promise<void> {
    if (knopfGesperrt) {
      return;
    }
    const vorher = { gestimmt, stimmen };
    setLaeuft(true);
    setGestimmt(!gestimmt);
    setStimmen((wert) => (wert === null ? null : wert + (gestimmt ? -1 : 1)));

    const antwort = gestimmt
      ? await clipStimmeZurueckziehenAction({ csrfToken, entryId: karte.entryId })
      : await clipAbstimmenAction({ csrfToken, entryId: karte.entryId });

    setLaeuft(false);
    if (!antwort.ok) {
      setGestimmt(vorher.gestimmt);
      setStimmen(vorher.stimmen);
      toast.error(antwort.error.message);
      return;
    }
    setStimmen(antwort.data.stimmen);
    aufStimmeGeaendert?.(antwort.data.verbleibend);
  }

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-2xl border border-border bg-card transition',
        'hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5',
        karte.rang === 1 && 'border-[hsl(45_92%_52%)]/50',
      )}
    >
      <button
        type="button"
        onClick={() => setSpielerOffen(true)}
        className="relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${karte.titel} abspielen`}
      >
        <div className="aspect-video w-full bg-secondary">
          {karte.thumbnailUrl && !bildKaputt ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={karte.thumbnailUrl}
              alt=""
              className="size-full object-cover transition duration-300 motion-safe:group-hover:scale-[1.03]"
              loading="lazy"
              onError={() => setBildKaputt(true)}
            />
          ) : null}
        </div>

        <span className="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/10">
          <span className="grid size-14 place-items-center rounded-full bg-primary/90 text-primary-foreground shadow-lg transition motion-safe:group-hover:scale-105">
            <Play className="size-6 translate-x-px fill-current" aria-hidden="true" />
          </span>
        </span>

        {karte.rang !== null && karte.rang <= 3 ? (
          <span
            className={cn(
              'absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
              RANG_FARBE[karte.rang] ?? 'bg-secondary text-foreground',
            )}
          >
            <Trophy className="size-3" aria-hidden="true" />
            Platz {karte.rang}
          </span>
        ) : null}

        <span className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2">
          {karte.spiel ? (
            <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-white backdrop-blur">
              {karte.spiel}
            </span>
          ) : null}
          {/*
            «dein Clip» gehoert aufs Bild, nicht hinter den Namen: dort war es
            auf 320 Pixeln das Erste, was abgeschnitten wurde - und damit
            genau die Auskunft, die verschwand, wenn man sie am noetigsten
            hat.
          */}
          {karte.eigenerClip ? (
            <span className="rounded-full bg-primary/90 px-2.5 py-1 text-xs font-medium text-primary-foreground">
              Dein Clip
            </span>
          ) : null}
        </span>
      </button>

      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold leading-tight">{karte.titel}</h3>
          {karte.beschreibung ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{karte.beschreibung}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <DiscordAvatar
              discordId={karte.einreicher.discordId}
              avatarHash={karte.einreicher.avatarHash}
              name={name}
              size={24}
            />
            <span className="truncate text-sm text-muted-foreground">{name}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setMeldenOffen(true)}
              className="grid size-8 place-items-center rounded-full text-muted-foreground/60 transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Clip melden"
              aria-label="Clip melden"
            >
              <Flag className="size-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => void stimmen_umschalten()}
              disabled={knopfGesperrt}
              title={
                eigenerOhneSelbstwahl
                  ? 'Für den eigenen Clip kannst du nicht stimmen.'
                  : kontingentLeer
                    ? 'Du hast alle Stimmen vergeben.'
                    : gestimmt
                      ? 'Stimme zurückziehen'
                      : 'Für diesen Clip stimmen'
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                gestimmt
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground hover:bg-secondary/70',
              )}
            >
              <Heart className={cn('size-4', gestimmt && 'fill-current')} aria-hidden="true" />
              {stimmen !== null ? <span className="tabular-nums">{stimmen}</span> : null}
              <span className="sr-only">{gestimmt ? 'Stimme zurückziehen' : 'Für diesen Clip stimmen'}</span>
            </button>
          </div>
        </div>
      </div>

      <ClipSpieler
        offen={spielerOffen}
        aufOeffnenAendern={setSpielerOffen}
        titel={karte.titel}
        einbettung={einbettung}
        quelle={karte.canonicalUrl}
      />
      <MeldeDialog
        offen={meldenOffen}
        aufOeffnenAendern={setMeldenOffen}
        clipId={karte.clipId}
        titel={karte.titel}
        csrfToken={csrfToken}
      />
    </article>
  );
}
