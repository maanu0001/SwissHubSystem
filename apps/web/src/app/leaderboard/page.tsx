import Link from 'next/link';
import { z } from 'zod';
import { branding } from '@swisshub/config/client';
import { isModuleEnabled, level } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Kulisse } from './kulisse';
import { RangKarte, RangZeile } from './rang';

/**
 * Die oeffentliche Rangliste.
 *
 * Ohne Anmeldung erreichbar - deshalb liegt sie ausserhalb der geschuetzten
 * Routengruppe und prueft keine Berechtigung. Oeffentlich ist dabei
 * ausschliesslich, was `getPublicLeaderboard` abbildet: Rang, Name, Avatar,
 * Level und XP. Die Projektion sitzt im Level-Modul, nicht hier - der Server
 * entscheidet, was den Server verlaesst, und nicht die Anzeige.
 *
 * Gerechnet wird nichts: die Reihenfolge kommt aus derselben `getLeaderboard`
 * wie im Dashboard.
 */

/** Eintraege je Seite. Genug fuer einen Ueberblick, wenig genug fuers Telefon. */
const PRO_SEITE = 50;

const querySchema = z.object({
  seite: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

/*
 * Jeder Aufruf rechnet neu.
 *
 * XP aendern sich laufend; eine Rangliste, die eine Viertelstunde alt ist,
 * zeigt jemanden auf Rang 4, der laengst auf 3 steht. Die Abfrage ist eine
 * indizierte Seite ueber `LevelProfile` - das traegt auch oeffentlich.
 */
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const { seite } = querySchema.parse(await searchParams);

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <Rahmen>
        <EmptyState
          title="Die Rangliste ist derzeit nicht verfügbar"
          description="Das Level-System ist ausgeschaltet."
        />
      </Rahmen>
    );
  }

  const board = await level.getPublicLeaderboard({ page: seite, pageSize: PRO_SEITE });

  if (board.total === 0) {
    return (
      <Rahmen>
        <EmptyState
          title="Noch keine Rangliste"
          description={`Sobald auf ${branding.name} XP gesammelt werden, steht hier die Rangliste.`}
        />
      </Rahmen>
    );
  }

  /*
   * Das Podest gibt es nur auf der ersten Seite.
   *
   * Die Top 3 gehoeren an den Anfang der Rangliste, nicht auf jede Seite. Und
   * sie stehen **nicht** zusaetzlich in der Liste darunter - zweimal
   * dieselben drei Namen untereinander liest sich wie ein Fehler.
   */
  const podest = seite === 1 ? board.entries.slice(0, 3) : [];
  const liste = seite === 1 ? board.entries.slice(3) : board.entries;

  return (
    <Rahmen>
      {podest.length > 0 ? (
        <section aria-label="Die ersten drei Plätze" className="mb-10">
          {/*
            Reihenfolge auf dem Telefon: 1, 2, 3 - von oben nach unten, wie
            man eine Rangliste liest. Erst ab `sm` rueckt der erste Platz in
            die Mitte und wird groesser.
          */}
          <ol className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
            {podest.map((eintrag) => (
              <li
                key={eintrag.discordId}
                className={cn(
                  eintrag.rank === 1 && 'sm:order-2',
                  eintrag.rank === 2 && 'sm:order-1',
                  eintrag.rank === 3 && 'sm:order-3',
                )}
              >
                <RangKarte eintrag={eintrag} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {liste.length > 0 ? (
        <section aria-label="Rangliste">
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40">
            {liste.map((eintrag) => (
              <li key={eintrag.discordId}>
                <RangZeile eintrag={eintrag} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Blaettern seite={board.page} seiten={board.totalPages} gesamt={board.total} />
    </Rahmen>
  );
}

/** Kulisse, Kopfbereich und Breite - fuer jeden Ausgang derselbe Rahmen. */
function Rahmen({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="relative">
      <Kulisse />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:px-8 sm:pt-14">
        {/*
          Der Kopfbereich bleibt kompakt. Er soll die Seite einordnen, nicht
          die Rangliste unter die Falz druecken - sie ist der Inhalt.
        */}
        <header className="mb-8 sm:mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[hsl(var(--primary-bright))]">
            {branding.name} Community
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Leaderboard</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Die aktivsten Mitglieder der {branding.name}-Community. Sortiert nach XP; bei Gleichstand zählt,
            wer den Stand zuerst erreicht hat.
          </p>
        </header>

        {children}
      </div>
    </div>
  );
}

/** Seitenwechsel plus der Hinweis aufs System. */
function Blaettern({
  seite,
  seiten,
  gesamt,
}: {
  seite: number;
  seiten: number;
  gesamt: number;
}): React.JSX.Element {
  const adresse = (ziel: number): string => (ziel <= 1 ? '/leaderboard' : `/leaderboard?seite=${ziel}`);

  return (
    <div className="mt-8 flex flex-col gap-6">
      {seiten > 1 ? (
        <nav aria-label="Seiten der Rangliste" className="flex items-center justify-between gap-3 text-sm">
          {seite > 1 ? (
            <Link
              href={adresse(seite - 1)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              rel="prev"
            >
              Zurück
            </Link>
          ) : (
            <span />
          )}

          <span className="text-muted-foreground tabular-nums">
            Seite {seite} von {seiten} · {gesamt.toLocaleString('de-CH')} Mitglieder
          </span>

          {seite < seiten ? (
            <Link
              href={adresse(seite + 1)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              rel="next"
            >
              Weiter
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {/*
        Der Aufruf zum System.

        Eine relative Adresse: diese Seite liegt selbst darauf, und eine
        ausgeschriebene Domain waere eine zweite Stelle, die beim naechsten
        Umzug falsch wird.
      */}
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-6 py-7 text-center">
        <p className="text-sm text-muted-foreground">
          XP sammelst du, indem du auf {branding.name} schreibst und im Sprachkanal dabei bist.
        </p>
        <Link href="/" className={cn(buttonVariants())}>
          Zum {branding.name} System
        </Link>
      </div>
    </div>
  );
}
