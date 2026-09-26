import Link from 'next/link';
import { Clapperboard, Trophy, Vote } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { Countdown } from './countdown';
import { cn } from '@/lib/utils';
import type { ClipPhase } from '@/server/clips';

/**
 * Die Buehne oben auf der Seite.
 *
 * ## Warum das keine Kennzahlenkacheln sind
 *
 * Ein Wettbewerb hat zu jedem Zeitpunkt genau eine Frage an die Person, die
 * ihn oeffnet: «reich einen Clip ein», «stimm ab», «schau, wer gewonnen
 * hat». Vier Kacheln mit Zahlen beantworten keine davon - sie sind die
 * Sprache eines Verwaltungsbereichs, und dies ist keiner.
 *
 * Deshalb: ein Satz, eine Uhr, ein Knopf. Die Zahlen stehen darunter, klein.
 */
export function PhasenBuehne({
  phase,
  nummer,
  endetAm,
  freigegeben,
  teilnehmende,
  darfEinreichen,
  eigeneEinreichung,
  verbleibendeStimmen,
}: {
  phase: ClipPhase;
  nummer: number | null;
  endetAm: Date | null;
  freigegeben: number;
  teilnehmende: number;
  darfEinreichen: boolean;
  eigeneEinreichung: boolean;
  verbleibendeStimmen: number;
}): React.JSX.Element {
  const inhalt = buehnenInhalt({
    phase,
    darfEinreichen,
    eigeneEinreichung,
    verbleibendeStimmen,
    freigegeben,
  });

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card">
      {/* Markenlicht, ruhig - kein Farbverlauf ueber die ganze Flaeche. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_100%_at_0%_0%,hsl(var(--primary)/0.14)_0%,transparent_60%)]"
      />

      <div className="relative space-y-5 p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <inhalt.Symbol className="size-4 text-primary" aria-hidden="true" />
          {nummer !== null ? `Clip of the Week #${nummer}` : 'Clip of the Week'}
        </div>

        <div className="space-y-2">
          <h2 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">{inhalt.titel}</h2>
          <p className="max-w-xl text-pretty text-sm text-muted-foreground sm:text-base">{inhalt.text}</p>
        </div>

        {endetAm ? <Countdown ziel={endetAm.toISOString()} label={inhalt.uhrLabel} /> : null}

        <div className="flex flex-wrap items-center gap-3">
          {inhalt.knopf ? (
            <Link href={inhalt.knopf.href} className={cn(buttonVariants({ size: 'lg' }), 'rounded-full')}>
              <inhalt.Symbol className="size-4" aria-hidden="true" />
              {inhalt.knopf.label}
            </Link>
          ) : null}

          {freigegeben > 0 ? (
            <Link
              href={systemRoutes.clipsZufall()}
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'rounded-full')}
            >
              Zufälliger Clip
            </Link>
          ) : null}
        </div>

        {freigegeben > 0 ? (
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground tabular-nums">{freigegeben}</strong>{' '}
            {freigegeben === 1 ? 'Clip' : 'Clips'} im Rennen
            {teilnehmende > 0 ? (
              <>
                {' · '}
                <strong className="text-foreground tabular-nums">{teilnehmende}</strong>{' '}
                {teilnehmende === 1 ? 'Person hat' : 'Personen haben'} abgestimmt
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface BuehnenInhalt {
  titel: string;
  text: string;
  uhrLabel: string;
  Symbol: typeof Clapperboard;
  knopf: { href: string; label: string } | null;
}

function buehnenInhalt({
  phase,
  darfEinreichen,
  eigeneEinreichung,
  verbleibendeStimmen,
  freigegeben,
}: {
  phase: ClipPhase;
  darfEinreichen: boolean;
  eigeneEinreichung: boolean;
  verbleibendeStimmen: number;
  freigegeben: number;
}): BuehnenInhalt {
  switch (phase) {
    case 'einreichen':
      return {
        titel: eigeneEinreichung ? 'Dein Clip ist im Rennen.' : 'Dein bester Moment dieser Woche.',
        text: eigeneEinreichung
          ? 'Sobald die Einreichungen schliessen, stimmt die Community ab. Bis dahin: schau dir an, was die anderen hochgeladen haben.'
          : 'Reiche deinen Clip ein - Twitch, YouTube oder Medal, Link genügt. Am Freitag entscheidet die Community.',
        uhrLabel: 'Einreichen noch',
        Symbol: Clapperboard,
        knopf:
          darfEinreichen && !eigeneEinreichung
            ? { href: systemRoutes.clipEinreichen(), label: 'Clip einreichen' }
            : null,
      };
    case 'voting':
      return {
        titel: verbleibendeStimmen > 0 ? 'Jetzt bist du dran.' : 'Deine Stimmen sind vergeben.',
        text:
          verbleibendeStimmen > 0
            ? `Du hast ${verbleibendeStimmen} ${verbleibendeStimmen === 1 ? 'Stimme' : 'Stimmen'}. Schau dir die Clips an und gib sie weiter.`
            : 'Du kannst eine Stimme jederzeit zurückziehen und neu setzen, solange abgestimmt wird.',
        uhrLabel: 'Voting endet in',
        Symbol: Vote,
        knopf: null,
      };
    case 'ergebnis':
      return {
        titel: 'Der Clip der Woche steht fest.',
        text: 'Danke fürs Mitmachen. Die nächste Runde startet am Montag - und dein Clip gehört hinein.',
        uhrLabel: '',
        Symbol: Trophy,
        knopf: { href: systemRoutes.hallOfFame(), label: 'Hall of Fame' },
      };
    case 'vorbereitung':
      return {
        titel: 'Die nächste Runde steht bereit.',
        text: 'Sobald sie öffnet, kannst du deinen Clip einreichen.',
        uhrLabel: 'Startet in',
        Symbol: Clapperboard,
        knopf: null,
      };
    default:
      return {
        titel: 'Gerade läuft keine Runde.',
        text:
          freigegeben > 0
            ? 'Schau dir in der Zwischenzeit an, was bisher gewonnen hat.'
            : 'Sobald eine neue Runde startet, siehst du sie hier.',
        uhrLabel: '',
        Symbol: Clapperboard,
        knopf: { href: systemRoutes.hallOfFame(), label: 'Hall of Fame' },
      };
  }
}
