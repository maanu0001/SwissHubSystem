'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { fragtSchliessenAction } from '@/modules/fragt/actions';

/**
 * Eine laufende Abstimmung vorzeitig beenden.
 *
 * Mit Rueckfrage, weil es nicht rueckgaengig zu machen ist: das Ergebnis wird
 * festgeschrieben, das Embed im Kanal ersetzt und die Frage wieder
 * freigegeben. Ein Klick daneben waere eine Abstimmung, die zwei Tage vor der
 * Zeit endet.
 */
export function AbstimmungSchliessen({
  csrfToken,
  abstimmungId,
  frageText,
  stimmen,
  endetAm,
}: {
  /** Der CSRF-Token der Sitzung - jede Server Action verlangt ihn. */
  csrfToken: string;
  abstimmungId: string;
  frageText: string;
  stimmen: number;
  endetAm: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOffen(true)}>
        <Square className="size-4" aria-hidden="true" />
        Jetzt schliessen
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={setOffen}
        title="Abstimmung jetzt schliessen?"
        description={`«${frageText}» läuft regulär bis ${endetAm}. Beim Schliessen wird das Ergebnis mit den bisherigen ${stimmen} ${stimmen === 1 ? 'Stimme' : 'Stimmen'} festgeschrieben, der Beitrag auf Discord zeigt danach das Ergebnis, und die Knöpfe verschwinden. Das lässt sich nicht zurücknehmen.`}
        confirmLabel="Schliessen"
        onConfirm={async () => {
          const antwort = await fragtSchliessenAction({ csrfToken, abstimmungId });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          toast.success(`Geschlossen - ${antwort.data.stimmen} Stimmen gezählt.`);
          router.refresh();
        }}
      />
    </>
  );
}
