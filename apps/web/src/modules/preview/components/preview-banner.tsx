'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { beendeVorschauAction } from '@/modules/preview/actions';

interface PreviewBannerProps {
  kind: 'USER' | 'ROLE';
  label: string;
  csrfToken: string;
}

/**
 * Der Banner über der gesamten Oberfläche, solange eine Vorschau läuft.
 *
 * Er ist nicht zu übersehen, und das ist seine einzige Aufgabe. Ein Admin,
 * der vergisst, dass eine Vorschau läuft, hält das halbe Dashboard für
 * kaputt - Knöpfe fehlen, Seiten antworten mit «nicht sichtbar», und nichts
 * davon ist ein Fehler.
 *
 * «Rollenvorschau» steht ausdrücklich da: was eine Rolle erlaubt, ist nicht
 * dasselbe wie das, was eine konkrete Person mit dieser Rolle sieht - sie
 * trägt meist noch andere, und es kann ausdrückliche Ausnahmen geben.
 */
export function PreviewBanner({ kind, label, csrfToken }: PreviewBannerProps): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  function beende(): void {
    starte(() => {
      void beendeVorschauAction({ csrfToken }).then((antwort) => {
        if (!antwort.ok) {
          toast.error(antwort.error.message);
          return;
        }
        router.refresh();
      });
    });
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-warning/50 bg-warning/15 px-4 py-2 text-sm sm:px-6"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Eye className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="min-w-0">
          <strong className="font-semibold">
            {kind === 'ROLE' ? 'Rollenvorschau aktiv' : 'Vorschau aktiv'}:
          </strong>{' '}
          <span className="truncate">{label}</span>
          <span className="ml-1 text-muted-foreground">
            {kind === 'ROLE'
              ? '· zeigt, was diese Rolle erlaubt - eine Person trägt meist mehrere.'
              : '· nur zum Ansehen, es lässt sich nichts ausführen.'}
          </span>
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={beende} disabled={laeuft}>
        <X aria-hidden="true" />
        Vorschau beenden
      </Button>
    </div>
  );
}
