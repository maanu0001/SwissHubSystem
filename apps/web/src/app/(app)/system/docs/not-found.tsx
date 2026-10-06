import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DokuSuche } from '@/modules/docs/components/doku-suche';
import { sucheIndex } from '@/modules/docs/register';
import { WERKE } from '@/modules/docs/werk';

/**
 * Ein Pfad unter /system/docs, zu dem es kein Kapitel gibt.
 *
 * Erreicht wird diese Seite ueber `notFound()` aus den Kapitelrouten - also
 * **nach** der Berechtigungspruefung. Sie verraet damit nichts: wer hier
 * landet, durfte die Dokumentation ohnehin oeffnen. Ohne Berechtigung greift
 * vorher `requirePagePermission`, und die Antwort ist eine andere.
 *
 * Gesucht wird in beiden Werken gleichzeitig. Wer eine veraltete Adresse
 * aufruft, weiss meist, wonach er sucht, aber nicht, in welchem der beiden
 * Werke es heute steht.
 */
export default function DokuNichtGefunden(): React.JSX.Element {
  const index = WERKE.flatMap((werk) => sucheIndex(werk));

  return (
    <div className="mx-auto min-w-0 max-w-xl space-y-6 py-10">
      <div className="space-y-3 text-center">
        <FileQuestion className="mx-auto size-10 text-muted-foreground/60" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Dokumentationsseite nicht gefunden
        </h1>
        <p className="text-sm text-muted-foreground">
          Diese Adresse gehoert zu keinem Kapitel. Vielleicht wurde es umbenannt - die Suche findet es am
          Inhalt.
        </p>
      </div>

      <DokuSuche index={index} platzhalter="In beiden Dokumentationen suchen" />

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {WERKE.map((werk) => (
          <Link
            key={werk.id}
            href={werk.basis}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {werk.titel}
          </Link>
        ))}
      </div>
    </div>
  );
}
