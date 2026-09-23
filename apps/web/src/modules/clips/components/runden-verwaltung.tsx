'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  clipRundeAbbrechenAction,
  clipRundeAbschliessenAction,
  clipRundeAnlegenAction,
} from '@/modules/clips/admin-actions';

/**
 * Die Knoepfe, die eine Runde von Hand bewegen.
 *
 * Alle drei greifen in laufende Ergebnisse ein und fragen deshalb nach. Der
 * Normalfall ist die Zeitsteuerung - diese Knoepfe sind fuer den Fall, dass
 * etwas dazwischenkam.
 */
export function RundenVerwaltung({
  competitionId,
  status,
  csrfToken,
  kannAnlegen,
}: {
  competitionId: string | null;
  status: string | null;
  csrfToken: string;
  kannAnlegen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [frage, setFrage] = useState<'abschliessen' | 'abbrechen' | null>(null);

  async function fuehreAus(
    name: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const antwort = await aktion();
    setLaeuft(null);
    setFrage(null);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  const laufend =
    status === 'DRAFT' || status === 'SUBMISSION' || status === 'VOTING' || status === 'FINALIZING';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {kannAnlegen ? (
          <Button
            variant="outline"
            onClick={() =>
              void fuehreAus(
                'anlegen',
                () => clipRundeAnlegenAction({ csrfToken }),
                'Runde dieser Woche bereit.',
              )
            }
            disabled={laeuft !== null}
          >
            {laeuft === 'anlegen' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Runde dieser Woche anlegen
          </Button>
        ) : null}

        {competitionId && (status === 'VOTING' || status === 'FINALIZING') ? (
          <Button variant="outline" onClick={() => setFrage('abschliessen')} disabled={laeuft !== null}>
            Jetzt abschliessen
          </Button>
        ) : null}

        {competitionId && laufend ? (
          <Button variant="destructive" onClick={() => setFrage('abbrechen')} disabled={laeuft !== null}>
            Runde abbrechen
          </Button>
        ) : null}
      </div>

      <ConfirmationDialog
        open={frage === 'abschliessen'}
        onOpenChange={(offen) => !offen && setFrage(null)}
        title="Runde jetzt abschliessen?"
        description="Die Stimmen werden gezählt, das Ergebnis festgeschrieben und der Gewinner auf Discord angekündigt. Das lässt sich nicht rückgängig machen."
        confirmLabel="Abschliessen"
        onConfirm={() =>
          competitionId
            ? void fuehreAus(
                'abschliessen',
                () => clipRundeAbschliessenAction({ csrfToken, competitionId }),
                'Runde abgeschlossen.',
              )
            : undefined
        }
      />

      <ConfirmationDialog
        open={frage === 'abbrechen'}
        onOpenChange={(offen) => !offen && setFrage(null)}
        title="Runde abbrechen?"
        description="Es wird kein Gewinner bestimmt und nichts angekündigt. Die eingereichten Clips bleiben erhalten."
        confirmLabel="Runde abbrechen"
        destructive
        onConfirm={() =>
          competitionId
            ? void fuehreAus(
                'abbrechen',
                () => clipRundeAbbrechenAction({ csrfToken, competitionId }),
                'Runde abgebrochen.',
              )
            : undefined
        }
      />
    </>
  );
}
