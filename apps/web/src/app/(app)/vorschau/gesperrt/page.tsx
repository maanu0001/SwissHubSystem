import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EyeOff } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { BeendeVorschauKnopf } from '@/modules/preview/components/beende-vorschau-knopf';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'In der Vorschau nicht sichtbar' };
export const dynamic = 'force-dynamic';

/**
 * «Diese Seite wäre für … nicht sichtbar.»
 *
 * Das Ergebnis einer Vorschau, keine Panne - und deshalb bewusst nicht die
 * 403-Seite. Sie beantwortete die Frage zwar auch, sähe aber aus wie ein
 * Fehler, und der Admin wüsste im Zweifel nicht, ob die Vorschau schuld war
 * oder seine eigenen Rechte.
 *
 * Läuft keine Vorschau, hat diese Seite nichts zu sagen: dann geht es zurück
 * aufs Dashboard.
 */
export default async function VorschauGesperrtPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requireMember();
  if (!context.preview) {
    redirect(systemRoutes.dashboard());
  }
  const { permission } = await searchParams;

  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-card p-8 text-center">
      <EyeOff className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">Diese Seite wäre für {context.preview.label} nicht sichtbar.</h2>
      <p className="text-sm text-muted-foreground">
        {context.preview.kind === 'ROLE'
          ? 'Der Rolle fehlt die nötige Berechtigung.'
          : 'Dieser Person fehlt die nötige Berechtigung.'}
        {permission ? (
          <>
            {' '}
            Verlangt wird <code className="rounded bg-muted px-1 py-0.5 text-xs">{permission}</code>.
          </>
        ) : null}
      </p>
      <p className="text-sm text-muted-foreground">
        Beende die Vorschau, um die Seite mit deinen eigenen Rechten zu öffnen.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
        <Link href={systemRoutes.dashboard()} className={cn(buttonVariants({ variant: 'outline' }))}>
          Zum Dashboard
        </Link>
        <BeendeVorschauKnopf csrfToken={csrfTokenFor(context)} />
      </div>
    </section>
  );
}
