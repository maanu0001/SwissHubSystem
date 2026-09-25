import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

/**
 * Rahmen der oeffentlichen Profilseite.
 *
 * Ausserhalb der geschuetzten Routengruppe - wie die Rangliste, die
 * Turniere und der Premium-Shop. Ein Profil-Link, der zum Login fuehrt,
 * waere kein Profil-Link; genau das ist der Zweck dieser Seite.
 *
 * Die Anmeldung liegt in SwissHub nicht in der Middleware, sondern im
 * Layout von `(app)`. Diese Seite liegt daneben und ist deshalb anonym
 * erreichbar, ohne dass an der Middleware etwas geaendert werden musste -
 * was die oeffentliche Rangliste mitbeschaedigt haette.
 *
 * ## Warum dieser Rahmen so duenn ist
 *
 * Er war einmal derselbe schmale Streifen wie bei der Rangliste, mit einer
 * festen Breite von fuenf Spalten und Polstern ringsum. Das passte zu einer
 * Liste und nicht zu einem Profil: die Gestaltung eines Mitglieds endete an
 * einer Kante, die nicht ihm gehoerte, und dahinter lag wieder die Flaeche
 * der Anwendung.
 *
 * Jetzt traegt die Kopfzeile nur noch die Herkunft, und darunter beginnt
 * das Profil - ohne Rand, ohne feste Breite. Wie breit es wird, entscheidet
 * seine Komposition; sieben Themes haben sieben Antworten darauf.
 *
 * Keine Seitenleiste, keine Verwaltung: hier ist jemand zu Besuch.
 */
export default async function OeffentlichesProfilLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="relative z-20 flex items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={branding.name}
        >
          <BrandMark size={34} logoUrl={logoUrl} />
          <span className="hidden text-sm font-medium tracking-wide text-muted-foreground sm:inline">
            Profil
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link href={context?.isMember ? '/dashboard' : '/'} className={cn(buttonVariants({ size: 'sm' }))}>
            {context?.isMember ? 'Zum Dashboard' : `${branding.name} entdecken`}
          </Link>
        </nav>
      </header>

      {/*
        Randlos bis zur Kante.

        Die Seitenpolster stehen hier trotzdem, aber klein: auf dem Telefon
        darf Text nicht am Displayrand kleben. Die eigentliche Breite
        bestimmt das Profil selbst.
      */}
      <main className="relative z-10 flex-1 px-3 py-4 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <footer className="relative z-10 border-t border-border/70 px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName}
      </footer>
    </div>
  );
}
