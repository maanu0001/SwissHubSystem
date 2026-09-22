'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { beendeVorschauAction } from '@/modules/preview/actions';

/** «Vorschau beenden» - überall dieselbe Wirkung, überall derselbe Weg. */
export function BeendeVorschauKnopf({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  return (
    <Button
      disabled={laeuft}
      onClick={() =>
        starte(() => {
          void beendeVorschauAction({ csrfToken }).then((antwort) => {
            if (!antwort.ok) {
              toast.error(antwort.error.message);
              return;
            }
            router.refresh();
          });
        })
      }
    >
      <X aria-hidden="true" />
      Vorschau beenden
    </Button>
  );
}
