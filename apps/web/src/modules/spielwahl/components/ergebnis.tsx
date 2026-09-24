'use client';

import { Dices, PartyPopper, Ticket, Vote } from 'lucide-react';
import { Cover } from './bausteine';
import type { Stand } from '@/modules/spielwahl/verbindung';

/**
 * Das Ergebnis.
 *
 * ## Warum dasteht, wie es zustande kam
 *
 * Weil eine Gruppe, die ein Ergebnis nicht mag, als Erstes fragt, wie es
 * zustande kam - und die Antwort «der Computer hat entschieden» ist die
 * schlechteste von allen. «Vier von sechs Stimmen» und «gelost, weil es
 * 3:3 stand» sind Antworten, mit denen man leben kann.
 *
 * Bei einer Auslosung steht zusätzlich der Wert, aus dem sie entstanden ist.
 * Kaum jemand wird ihn nachrechnen. Dass er dasteht, ist trotzdem der
 * Unterschied zwischen nachprüfbar und behauptet.
 */
const ART_TEXT: Record<string, { text: string; Symbol: typeof Dices }> = {
  roulette: { text: 'Ausgelost - jedes Spiel hatte ein Los.', Symbol: Dices },
  'roulette-gewichtet': { text: 'Ausgelost - gewichtet nach Unterstützern.', Symbol: Dices },
  abstimmung: { text: 'Mit den meisten Stimmen gewählt.', Symbol: Vote },
  'los-bei-gleichstand': { text: 'Gleichstand - das Los hat entschieden.', Symbol: Ticket },
  'los-ohne-stimmen': { text: 'Niemand hat gewählt - das Los hat entschieden.', Symbol: Ticket },
  ausscheidung: { text: 'Hat sich durch alle Duelle gesetzt.', Symbol: Vote },
  stichwahl: { text: 'Aus der Stichwahl hervorgegangen.', Symbol: Vote },
};

export function Ergebnis({ stand }: { stand: Stand }): React.JSX.Element | null {
  const gewinnerId = stand.ergebnisCandidateId ?? stand.runde?.gewinnerCandidateId ?? null;
  const gewinner = stand.kandidaten.find((kandidat) => kandidat.id === gewinnerId);
  if (!gewinner) {
    return null;
  }

  const art = stand.runde?.entscheidungsart ?? '';
  const erklaerung = ART_TEXT[art] ?? { text: 'Entschieden.', Symbol: PartyPopper };
  const Symbol = erklaerung.Symbol;

  /*
   * Stimmen nur dort, wo gestimmt wurde.
   *
   * Beim Roulette steht in der Zählung eine ehrliche Null - niemand hat
   * gewählt, es wurde ausgelost. Sie danebenzuschreiben ergäbe «Ausgelost.
   * 0 Stimmen.», und das liest sich wie ein Fehler.
   */
  const stimmen = stand.modus === 'ROULETTE' ? null : (stand.runde?.stimmen?.[gewinner.id] ?? null);
  const angenommen = stand.status === 'ABGESCHLOSSEN';

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <p
        className="sp-auf text-xs font-semibold uppercase tracking-[0.3em] text-[hsl(var(--sp-rot-hell))]"
        style={{ ['--verzug' as string]: '80ms' }}
      >
        {angenommen ? 'Heute Abend läuft' : 'Das Ergebnis'}
      </p>

      {/*
        Zwei Elemente für zwei Bewegungen.

        `sp-rast` blendet ein, `sp-glut` pulsiert - und beide setzen die
        Kurzschreibweise `animation`. Auf demselben Element gewinnt die
        zweite, und das Einblenden fiele aus: die Karte bliebe bei
        `opacity: 0` stehen. Genau das war zu sehen, bevor die beiden
        getrennt wurden.
      */}
      <div className="sp-rast w-full max-w-md" style={{ ['--verzug' as string]: '180ms' }}>
        <div className="sp-glut overflow-hidden rounded-2xl">
          <Cover name={gewinner.name} bannerUrl={gewinner.bannerUrl} className="aspect-[16/9] w-full" />
        </div>
      </div>

      <div className="sp-auf space-y-2" style={{ ['--verzug' as string]: '420ms' }}>
        <h2 className="text-[clamp(1.9rem,8vw,3.4rem)] font-black leading-[0.98] tracking-tight text-white">
          {gewinner.name}
        </h2>
        <p className="inline-flex items-center gap-2 text-sm text-white/50">
          <Symbol className="size-4 shrink-0 text-[hsl(var(--sp-rot-hell))]" aria-hidden="true" />
          {erklaerung.text}
          {stimmen !== null ? ` ${stimmen} ${stimmen === 1 ? 'Stimme' : 'Stimmen'}.` : ''}
        </p>
        {gewinner.maxSquadSize ? (
          <p className="text-xs text-white/30">Bis {gewinner.maxSquadSize} Spieler.</p>
        ) : null}
      </div>

      {stand.runde?.losPunkt !== null && stand.runde?.losGesamt ? (
        <p
          className="sp-auf max-w-md text-[0.7rem] leading-relaxed text-white/25"
          style={{ ['--verzug' as string]: '620ms' }}
        >
          Nachvollziehbar: Los {stand.runde.losPunkt} von {stand.runde.losGesamt}, gezogen auf dem Server aus{' '}
          <span className="font-mono">{stand.runde.seed.slice(0, 12)}…</span> - bevor sich das Rad gedreht
          hat.
        </p>
      ) : null}
    </div>
  );
}
