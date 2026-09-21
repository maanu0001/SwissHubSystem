'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { resetLevelsAction } from '@/modules/level/actions';

interface ResetLevelsButtonProps {
  csrfToken: string;
  /** Wie viele Mitglieder derzeit XP tragen - die Zahl, über die entschieden wird. */
  betroffen: number;
  /** XP, die gerade in einer laufenden Verlosung gebunden sind. */
  verlosungsEinsaetze: number;
}

/**
 * Alle Level und XP auf null zurücksetzen.
 *
 * Der Knopf nennt die Zahl, um die es geht, und der Dialog sagt, was das
 * heisst: nicht nur «XP weg», sondern auch, dass alle wieder am Anfang der
 * Kurve stehen, dass die Meilenstein-Rollen entzogen werden und was unberührt
 * bleibt.
 *
 * Gibt es nichts zurückzusetzen, erscheint der Knopf nicht. Eine Schaltfläche,
 * die nichts bewirkt, lädt zum Ausprobieren ein - und das ist bei dieser die
 * schlechteste aller Einladungen.
 */
export function ResetLevelsButton({
  csrfToken,
  betroffen,
  verlosungsEinsaetze,
}: ResetLevelsButtonProps): React.JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  if (betroffen === 0) {
    return null;
  }

  async function handleConfirm(): Promise<void> {
    const key = idempotencyKey ?? crypto.randomUUID();
    const response = await resetLevelsAction({ csrfToken, erwartet: betroffen, idempotencyKey: key });

    if (!response.ok) {
      toast.error(response.error.message);
      setIdempotencyKey(null);
      // Bei einem abweichenden Bestand hilft nur der frische Stand - sonst
      // stünde im Dialog weiterhin die alte Zahl.
      router.refresh();
      return;
    }

    const { zurueckgesetzt, entzogeneXp, rollenEntzogen, warnings } = response.data;

    toast.success(
      `${zurueckgesetzt} Mitglieder auf 0 XP gesetzt, ${entzogeneXp.toLocaleString('de-CH')} XP entzogen.`,
      rollenEntzogen > 0 ? { description: `${rollenEntzogen} Meilenstein-Rollen entzogen.` } : undefined,
    );

    for (const warnung of warnings.slice(0, 5)) {
      toast.warning(warnung, { duration: 10_000 });
    }

    router.refresh();
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setIdempotencyKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <RotateCcw aria-hidden="true" />
        Alle XP zurücksetzen ({betroffen})
      </Button>

      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={
          betroffen === 1
            ? 'Den XP-Stand zurücksetzen?'
            : `Alle ${betroffen} XP-Stände auf null zurücksetzen?`
        }
        confirmLabel="Auf null zurücksetzen"
        description={
          <>
            <p className="text-foreground">
              {betroffen === 1 ? 'Ein Mitglied steht' : `${betroffen} Mitglieder stehen`} danach bei
              <strong> 0 XP</strong> und damit wieder am Anfang der Kurve, auf Level 1. Das lässt sich nicht
              rückgängig machen.
            </p>
            <p className="text-foreground">
              Die Meilenstein-Rollen werden entzogen - wer wieder bei null steht, behält keine
              «Level&nbsp;X»-Rolle auf Discord.
            </p>
            {verlosungsEinsaetze > 0 ? (
              <p className="text-foreground">
                <strong>Achtung:</strong> In einer laufenden Verlosung sind derzeit{' '}
                {verlosungsEinsaetze.toLocaleString('de-CH')} XP als Einsatz gebunden. Wird diese Verlosung
                später abgebrochen, bekommen die Teilnehmenden ihren Einsatz zurück - und hätten dann wieder
                XP. Besser zuerst die Verlosung abschliessen.
              </p>
            ) : null}
            <p>
              Unberührt bleiben Nachrichten- und Voice-Zähler, die Levelkarten, die Spiel-Statistiken und das
              XP-Journal: jede Rücksetzung wird dort als Buchung festgehalten. Der Vorgang erscheint im
              XP-Protokoll und im Audit Log.
            </p>
          </>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
