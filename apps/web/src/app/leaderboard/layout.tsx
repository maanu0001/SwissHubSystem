import type { Metadata } from 'next';
import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: `${branding.name} Leaderboard`,
  description: `Die aktivsten Mitglieder der ${branding.name}-Community: Rangliste nach Level und XP.`,
  openGraph: {
    title: `${branding.name} Leaderboard`,
    description: `Die aktivsten Mitglieder der ${branding.name}-Community.`,
    type: 'website',
  },
};

/**
 * Rahmen der oeffentlichen Rangliste.
 *
 * Wie bei Turnieren und dem Premium-Shop bewusst ausserhalb der geschuetzten
 * Routengruppe: eine Rangliste, die man nicht teilen kann, weil der Link zum
 * Login fuehrt, ist keine oeffentliche Rangliste.
 *
 * Dieselbe Anwendung, dieselbe Marke, dieselben Tokens - nur ohne
 * Seitenleiste. Kein zweites Frontend, und kein zweiter Header: der hier ist
 * derselbe schmale Streifen wie bei den Turnieren, damit die oeffentlichen
 * Seiten zusammengehoeren.
 */
export default async function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="relative z-20 flex items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur sm:px-8">
        <Link
          href="/leaderboard"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${branding.name} Leaderboard`}
        >
          <BrandMark size={34} logoUrl={logoUrl} />
          <span className="hidden text-sm font-medium tracking-wide text-muted-foreground sm:inline">
            Leaderboard
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            href={context?.isMember ? '/dashboard' : '/'}
            className={cn(buttonVariants({ size: 'sm' }))}
            /*
             * Der Verweis aufs System.
             *
             * Eine relative Adresse, keine ausgeschriebene Domain: diese Seite
             * liegt selbst auf dem System, und eine zweite Stelle mit der URL
             * waere eine zweite Stelle, die beim naechsten Umzug falsch wird.
             */
          >
            {context?.isMember ? 'Zum Dashboard' : `Zum ${branding.name} System`}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex-1">{children}</main>

      <footer className="relative z-10 border-t border-border/70 px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName} · Leaderboard
      </footer>
    </div>
  );
}
