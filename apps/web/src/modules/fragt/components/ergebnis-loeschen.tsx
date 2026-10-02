'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { fragtErgebnisLoeschenAction } from '@/modules/fragt/actions';

/**
 * Eine abgeschlossene Abstimmung löschen.
 *
 * ## Warum die Beschreibung so ausführlich ist
 *
 * Weil das die eine Stelle ist, an der jemand mehr wegwirft, als er glaubt.
 * «Ergebnis löschen» klingt wie «diese Ansicht aufräumen»; tatsächlich gehen
 * die Stimmen und der Social-Media-Entwurf mit. Der Dialog sagt beides, und er
 * sagt auch, was **bleibt** - die Frage in der Bibliothek. Wer sich darüber
 * nicht sicher ist, löscht nicht.
 *
 * ## Was dieser Knopf nicht entscheidet
 *
 * Ob es erlaubt ist. `fragt.delete` wird in der Server Action geprüft, und
 * `freshness: 'critical'` liest die Discord-Rolle dafür frisch. Diese
 * Komponente erscheint nur, wenn die Berechtigung schon beim Laden der Seite
 * vorlag - ein Knopf, der immer eine Absage bringt, ist kein Knopf, aber er
 * ist auch keine Erlaubnis.
 */
export function ErgebnisLoeschen({
  abstimmungId,
  frageText,
  stimmen,
  csrfToken,
}: {
  abstimmungId: string;
  /** Der Fragetext - im Dialog, damit niemand das falsche Ergebnis löscht. */
  frageText: string;
  stimmen: number;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={laeuft}
        onClick={() => setOffen(true)}
      >
        <Trash2 className="size-4" />
        Ergebnis löschen
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={setOffen}
        title="Ergebnis löschen?"
        description={
          <span className="space-y-2">
            <span className="block">
              «{frageText}» wird samt {stimmen} {stimmen === 1 ? 'Stimme' : 'Stimmen'} und dem
              Social-Media-Entwurf entfernt. Die Zahlen von damals lassen sich nicht neu erheben.
            </span>
            <span className="block text-muted-foreground">
              Die Frage selbst bleibt in der Bibliothek - gelöscht wird dieser Durchgang, nicht die Frage.
            </span>
          </span>
        }
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          setLaeuft(true);
          const antwort = await fragtErgebnisLoeschenAction({ csrfToken, abstimmungId });
          setLaeuft(false);
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          setOffen(false);
          toast.success('Ergebnis gelöscht. Die Frage steht weiterhin in der Bibliothek.');
          /*
           * Zur Liste, nicht neu laden: die Kennung im Pfad zeigt auf einen
           * Vorgang, den es nicht mehr gibt.
           */
          router.push('/fragt/ergebnisse');
        }}
      />
    </>
  );
}
