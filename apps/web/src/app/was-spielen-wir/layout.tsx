import Link from 'next/link';
import { branding } from '@swisshub/config/client';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

/**
 * Der Rahmen einer Spielauswahl.
 *
 * ## Warum die Bühne aus `(app)` herausgezogen wurde
 *
 * Weil sie ohne Anmeldung erreichbar sein muss. Die Anmeldung liegt in
 * SwissHub nicht in der Middleware, sondern im Layout von `(app)` - wer dort
 * liegt, ist geschützt, wer daneben liegt, ist offen. Dasselbe Muster wie beim
 * öffentlichen Profil, der Rangliste, den Turnier- und Streamerseiten.
 *
 * Die Übersicht und der Spielkatalog bleiben in `(app)`: eine Liste eigener
 * Runden und ein Katalog zum Pflegen sind Sachen für Mitglieder. Öffentlich
 * ist genau die eine Adresse, die im Einladungslink steht.
 *
 * ## Warum keine Seitenleiste
 *
 * Weil hier jemand sitzt, der SwissHub vielleicht nicht kennt - der Kollege
 * aus dem Sprachkanal, das Geschwister am zweiten Rechner. Eine Navigation mit
 * «Audit Log» und «Moduleinstellungen» liesse ihn fragen, wo er gelandet ist.
 *
 * Für ein Mitglied ändert das etwas: es sieht auf dieser einen Seite die
 * Seitenleiste nicht mehr. Das ist verkraftbar und war es vorher schon fast so
 * - die Bühne ist eine Vollbildszene mit eigenem Zurück-Link, und der Weg zur
 * Übersicht steht oben rechts.
 */
export default async function SpielwahlLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [logoUrl, context] = await Promise.all([brandingModule.currentLogoUrl(), getOptionalAuthContext()]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/*
        Dieselbe Kulisse wie auf den übrigen öffentlichen Seiten: ein roter
        Schimmer oben, sonst dunkel. `fixed` und `pointer-events-none`, damit
        sie beim Scrollen stehenbleibt und keine Klicks abfängt.
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
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${branding.name} - Was spielen wir?`}
        >
          <BrandMark size={34} logoUrl={logoUrl} />
          <span className="hidden text-sm font-medium tracking-wide text-muted-foreground sm:inline">
            Was spielen wir?
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          {/*
            Für ein Mitglied der Weg zurück zu seinen Runden, für einen Gast
            eine Einladung. Zwei verschiedene Sätze, weil es zwei verschiedene
            Leute sind - «Zur Übersicht» führt einen Gast auf eine
            Anmeldeseite.
          */}
          <Link
            href={context?.isMember ? '/was-spielen-wir' : '/'}
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
          >
            {context?.isMember ? 'Meine Runden' : `${branding.name} entdecken`}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>

      <footer className="relative z-10 border-t border-border/70 px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        {branding.name} {branding.productName}
      </footer>
    </div>
  );
}
