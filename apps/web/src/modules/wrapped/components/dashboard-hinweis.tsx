import Link from 'next/link';
import { ArrowRight, Gift } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { Faden } from '@/modules/wrapped/teile/faden';

/**
 * Der Hinweis auf der Startseite.
 *
 * ## Zwei Groessen, ein Bauteil
 *
 * Wer seinen Rueckblick noch nicht geoeffnet hat, bekommt ein Banner, das
 * man nicht uebersieht - es ist einmal im Jahr, und wenn es untergeht, ist
 * die Arbeit umsonst gewesen. Wer ihn gesehen hat, bekommt eine Zeile: der
 * Rueckblick bleibt erreichbar, draengt sich aber nicht mehr auf.
 *
 * Ein Hinweis, der nach dem Ansehen gleich gross bleibt, wird zur Tapete.
 */
export function WrappedDashboardHinweis({
  titel,
  schluessel,
  jahr,
  gesehen,
}: {
  titel: string;
  schluessel: string;
  jahr: number;
  gesehen: boolean;
}): React.JSX.Element {
  const href = systemRoutes.wrapped(schluessel);

  if (gesehen) {
    return (
      <Link
        href={href}
        className="flex items-center gap-2.5 rounded-lg border border-border px-4 py-2.5 text-sm transition hover:border-primary/40"
      >
        <Gift className="size-4 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Dein Rückblick {jahr} ist weiterhin da.</span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label={`${titel} öffnen`}
      className="group relative block overflow-hidden rounded-xl border border-[hsl(0_92%_45%/0.35)] bg-[linear-gradient(120deg,hsl(0_75%_14%),hsl(0_0%_7%)_62%)] p-6 text-white transition hover:border-[hsl(0_92%_55%/0.6)]"
    >
      {/* Das Band aus der Marke, gross und leise - dasselbe Zeichen wie im
          Rueckblick selbst, damit der Hinweis erkennbar dazugehoert. */}
      <Faden
        variante="band"
        className="pointer-events-none absolute -right-8 top-1/2 h-40 w-64 -translate-y-1/2 text-[hsl(0_92%_55%)] opacity-20"
        breite={5}
        verzug={0}
      />

      <div className="relative max-w-lg space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
          SwissHub Wrapped {jahr}
        </p>
        <h2 className="text-balance text-2xl font-bold leading-tight">
          Dein Jahr ist fertig. Schau es dir an.
        </h2>
        <p className="text-sm text-white/65">
          Ein paar Minuten, ein paar Zahlen und der eine Moment, den du vermutlich vergessen hast.
        </p>
        <span className="inline-flex items-center gap-2 pt-2 text-sm font-semibold">
          Ansehen
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  );
}
