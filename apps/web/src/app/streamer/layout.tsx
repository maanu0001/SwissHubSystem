import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

/**
 * Rahmen der oeffentlichen Streamer-Seiten.
 *
 * Ausserhalb der geschuetzten Routengruppe - wie das oeffentliche Profil, die
 * Rangliste und die Turniere. Die Anmeldung liegt in SwissHub nicht in der
 * Middleware, sondern im Layout von `(app)`; diese Seiten liegen daneben und
 * sind deshalb anonym erreichbar, ohne dass an der Middleware etwas geaendert
 * werden musste.
 *
 * ## Warum keine Admin-Seitenleiste
 *
 * Weil hier jemand zu Besuch ist, der SwissHub vielleicht nicht kennt. Eine
 * Navigation mit «Audit Log» und «Moduleinstellungen» wuerde einen Besucher
 * fragen lassen, wo er gelandet ist. Was er sieht, ist eine Seite ueber
 * Streamer - und einen Weg zu SwissHub.
 */
export default async function StreamerLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/*
        Die Kulisse. Ein roter Schimmer oben links, sonst dunkel - dasselbe
        Motiv wie im Rest der Anwendung, nur ohne Rahmen. `fixed` und
        `pointer-events-none`, damit sie beim Scrollen stehenbleibt und nichts
        abfaengt.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'radial-gradient(90% 60% at 10% -10%, hsl(var(--primary) / 0.18) 0%, transparent 60%), radial-gradient(70% 50% at 95% 0%, hsl(var(--primary) / 0.08) 0%, transparent 55%)',
        }}
      />

      <header className="relative z-20 flex items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur sm:px-8">
        <Link
          href="/streamer"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${branding.name} Streamer`}
        >
          <BrandMark size={34} logoUrl={logoUrl} />
          <span className="hidden text-sm font-medium tracking-wide text-muted-foreground sm:inline">
            Streamer
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href={context?.isMember ? '/dashboard' : '/'} className={cn(buttonVariants({ size: 'sm' }))}>
            {context?.isMember ? 'Zum Dashboard' : `${branding.name} entdecken`}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <footer className="relative z-10 border-t border-border/70 px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName}
      </footer>
    </div>
  );
}
