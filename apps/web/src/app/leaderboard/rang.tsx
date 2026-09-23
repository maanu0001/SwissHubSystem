import type { level } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';

type Eintrag = Awaited<ReturnType<typeof level.getPublicLeaderboard>>['entries'][number];

/**
 * Die Darstellung eines Rangs.
 *
 * Zwei Formen, eine Sprache: die Karte fuer die ersten drei, die Zeile fuer
 * alle weiteren. Beide zeigen dieselben vier Angaben - Rang, Person, Level,
 * XP - in derselben Reihenfolge, damit der Blick beim Uebergang nicht neu
 * sucht.
 *
 * Gold, Silber und Bronze kommen vor, aber leise: als duenner Rand und als
 * Farbe der Rangziffer. Ein gemaltes Podest waere eine zweite Aussage neben
 * der Zahl, die es ohnehin schon sagt.
 *
 * Die Avatare kommen aus `DiscordAvatar` - der einzigen Avatar-Darstellung
 * der Anwendung. Sie liefert immer ein Bild: fehlt der Hash, kommt Discords
 * Standardbild, und scheitert auch das, ein Monogramm. Ein kaputtes Bild kann
 * auf einer oeffentlichen Seite nicht stehenbleiben.
 */

/** Die Tonfolge der ersten drei Plaetze. */
const EDELMETALL: Record<number, { rand: string; ring: string; ziffer: string; schimmer: string }> = {
  1: {
    rand: 'border-amber-300/35',
    ring: 'ring-amber-300/40',
    ziffer: 'text-amber-200',
    schimmer: 'from-amber-200/[0.10]',
  },
  2: {
    rand: 'border-slate-300/30',
    ring: 'ring-slate-300/35',
    ziffer: 'text-slate-200',
    schimmer: 'from-slate-200/[0.08]',
  },
  3: {
    rand: 'border-orange-400/30',
    ring: 'ring-orange-400/35',
    ziffer: 'text-orange-300',
    schimmer: 'from-orange-300/[0.08]',
  },
};

const xp = (wert: number): string => wert.toLocaleString('de-CH');

/** Karte fuer die ersten drei Plaetze. */
export function RangKarte({ eintrag }: { eintrag: Eintrag }): React.JSX.Element {
  const ton = EDELMETALL[eintrag.rank] ?? EDELMETALL[3]!;
  const erster = eintrag.rank === 1;

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-card/60 px-5 text-center backdrop-blur-sm',
        ton.rand,
        // Der erste Platz ist hoeher - auf dem Telefon steht er schlicht
        // oben, nebeneinander wird daraus ein Podest ohne gemaltes Podest.
        erster ? 'py-8 sm:py-10' : 'py-6 sm:py-7',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent',
          ton.schimmer,
        )}
        aria-hidden="true"
      />

      <div className="relative">
        <span className={cn('block text-xs font-semibold tracking-[0.2em]', ton.ziffer)}>
          #{eintrag.rank}
        </span>

        <DiscordAvatar
          discordId={eintrag.discordId}
          avatarHash={eintrag.avatarHash}
          name={eintrag.displayName}
          size={erster ? 96 : 64}
          className={cn('mx-auto mt-4 ring-1', ton.ring)}
        />

        <h2
          className={cn(
            'mt-4 truncate font-semibold tracking-tight',
            erster ? 'text-lg sm:text-xl' : 'text-base',
          )}
          title={eintrag.displayName}
        >
          {eintrag.displayName}
        </h2>

        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Level {eintrag.level}</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{xp(eintrag.xp)} XP</span>
        </p>

        {eintrag.progress === null ? null : <Fortschritt wert={eintrag.progress} className="mt-4" />}
      </div>
    </article>
  );
}

/** Zeile ab Rang 4. */
export function RangZeile({ eintrag }: { eintrag: Eintrag }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-card/70 sm:gap-4 sm:px-5">
      <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground sm:w-12 sm:text-base">
        {eintrag.rank}
      </span>

      <DiscordAvatar
        discordId={eintrag.discordId}
        avatarHash={eintrag.avatarHash}
        name={eintrag.displayName}
        size={40}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium sm:text-base" title={eintrag.displayName}>
          {eintrag.displayName}
        </p>
        {/*
          Auf dem Telefon steht die XP-Zahl unter dem Namen statt in einer
          eigenen Spalte - drei Spalten auf 320 px zwingen sonst entweder zum
          Querscrollen oder schneiden den Namen ab.
        */}
        <p className="text-xs tabular-nums text-muted-foreground sm:hidden">
          Level {eintrag.level} · {xp(eintrag.xp)} XP
        </p>
      </div>

      <div className="hidden shrink-0 items-center gap-6 sm:flex">
        <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">
          {xp(eintrag.xp)} XP
        </span>
        <span className="w-20 rounded-md border border-border/70 bg-background/60 py-1 text-center text-xs font-medium tabular-nums">
          Level {eintrag.level}
        </span>
      </div>
    </div>
  );
}

/** Fortschritt ins naechste Level. */
function Fortschritt({ wert, className }: { wert: number; className?: string }): React.JSX.Element {
  const prozent = Math.round(wert * 100);
  return (
    <div
      className={cn('h-1 overflow-hidden rounded-full bg-border/70', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={prozent}
      aria-label="Fortschritt zum nächsten Level"
    >
      <div className="h-full rounded-full bg-[hsl(var(--primary-bright))]" style={{ width: `${prozent}%` }} />
    </div>
  );
}
