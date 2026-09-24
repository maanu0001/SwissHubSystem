'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { clipRundeReaktivierenAction } from '@/modules/clips/admin-actions';

const ZIEL_TEXT: Record<string, string> = {
  DRAFT: 'vorbereitet - die Einreichungen öffnen wie geplant',
  SUBMISSION: 'Einreichungen offen',
  VOTING: 'Voting läuft',
};

/**
 * Die verbleibende Zeit, in Worten.
 *
 * Grob und mit Absicht: es geht um die Frage «lohnt sich das noch», nicht um
 * Sekunden. Gerechnet wird gegen einen Zeitpunkt, den der Server bestimmt
 * hat - die Uhr des Browsers entscheidet hier nichts.
 */
function verbleibend(bis: Date, jetzt: number): string {
  const ms = bis.getTime() - jetzt;
  if (ms <= 0) {
    return 'abgelaufen';
  }
  const stunden = Math.floor(ms / 3_600_000);
  if (stunden >= 24) {
    const tage = Math.floor(stunden / 24);
    return `noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'}`;
  }
  if (stunden >= 1) {
    return `noch ${stunden} ${stunden === 1 ? 'Stunde' : 'Stunden'}`;
  }
  return `noch ${Math.max(1, Math.floor(ms / 60_000))} Minuten`;
}

/**
 * Eine abgebrochene Runde zurueckholen.
 *
 * Erscheint nur, wo `clips.reaktivierungsLage` es zulaesst - also bei einer
 * ausdruecklich abgebrochenen Runde, innerhalb ihrer eigenen Woche, solange
 * ueberhaupt noch eine Frist laeuft. Die Seite entscheidet das serverseitig;
 * diese Komponente bekommt nur noch das Ergebnis und sagt vor der
 * Bestaetigung, was danach gilt: welcher Zustand, und wie lange noch.
 */
export function RundeReaktivieren({
  competitionId,
  nummer,
  ziel,
  phaseEndetAm,
  csrfToken,
}: {
  competitionId: string;
  nummer: number;
  ziel: string;
  phaseEndetAm: string;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const ende = new Date(phaseEndetAm);
  const rest = verbleibend(ende, Date.now());
  const endeText = ende.toLocaleString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

  async function reaktiviere(): Promise<void> {
    setLaeuft(true);
    const antwort = await clipRundeReaktivierenAction({ csrfToken, competitionId });
    setLaeuft(false);
    setOffen(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      // Die Lage hat sich geändert - die Seite soll den neuen Stand zeigen.
      router.refresh();
      return;
    }
    toast.success(`Runde #${nummer} läuft wieder.`);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOffen(true)}
        disabled={laeuft}
        // Auf dem Telefon nur das Zeichen: mit der Beschriftung wird die
        // Tabelle breiter als der Bildschirm, und dann scrollt die ganze
        // Seite seitlich. Der Name bleibt trotzdem lesbar - unten steht er
        // als `sr-only`, und `title` zeigt ihn auf dem Zeiger.
        title="Wieder aktivieren"
      >
        {laeuft ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-4" aria-hidden="true" />
        )}
        <span className="sr-only sm:not-sr-only">Wieder aktivieren</span>
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={(auf) => !auf && setOffen(false)}
        title={`Runde #${nummer} wieder aktivieren?`}
        description={`Die Runde kehrt in ihre ursprüngliche Woche zurück: ${
          ZIEL_TEXT[ziel] ?? ziel
        }. Die Fristen bleiben unverändert - Ende am ${endeText} (${rest}). Eingereichte Clips und bereits abgegebene Stimmen bleiben erhalten.`}
        confirmLabel="Wieder aktivieren"
        onConfirm={() => void reaktiviere()}
      />
    </>
  );
}
