import Link from 'next/link';
import { UserX } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Kein Profil unter dieser Adresse.
 *
 * Ein Satz, und bewusst derselbe fuer drei verschiedene Gruende: die
 * Adresse gibt es nicht, das Mitglied ist nicht mehr da, oder das Profil
 * steht nicht oeffentlich. Wer die drei unterscheiden koennte, koennte
 * Adressen durchprobieren und herausfinden, wer ein Profil hat, das er
 * nicht zeigt.
 */
export default function ProfilNichtGefunden(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <span className="grid size-16 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
        <UserX className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Dieses Profil gibt es nicht</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Vielleicht wurde der Link falsch kopiert, vielleicht ist das Profil nicht öffentlich.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
        {branding.name} entdecken
      </Link>
    </div>
  );
}
