'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { purgeJailsAction } from '@/modules/jail/actions';

interface PurgeJailsButtonProps {
  csrfToken: string;
  /** Wie viele Jails gerade laufen - die Zahl, über die entschieden wird. */
  aktive: number;
}

/**
 * Alle laufenden Jails aufheben und löschen.
 *
 * Der Knopf nennt die Zahl, um die es geht, und der Dialog sagt beides
 * getrennt: wer freikommt und was verschwindet. «Alle Jails löschen» allein
 * liesse offen, ob die Betroffenen dabei ihre Rollen zurückbekommen - genau
 * die Frage, auf die es hier ankommt.
 *
 * Gibt es nichts zu tun, erscheint der Knopf nicht. Eine Schaltfläche, die
 * nichts bewirkt, lädt zum Ausprobieren ein - und das ist bei dieser die
 * schlechteste aller Einladungen.
 */
export function PurgeJailsButton({ csrfToken, aktive }: PurgeJailsButtonProps): React.JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  if (aktive === 0) {
    return null;
  }

  async function handleConfirm(): Promise<void> {
    const key = idempotencyKey ?? crypto.randomUUID();
    const response = await purgeJailsAction({ csrfToken, erwartet: aktive, idempotencyKey: key });

    if (!response.ok) {
      toast.error(response.error.message);
      setIdempotencyKey(null);
      // Bei einem abweichenden Bestand hilft nur der frische Stand - sonst
      // stünde im Dialog weiterhin die alte Zahl.
      router.refresh();
      return;
    }

    const { freigelassen, geloescht, fehlgeschlagen, warnings } = response.data;

    if (fehlgeschlagen.length > 0) {
      // Kein «erledigt» über einem halben Ergebnis: wer hängen geblieben ist,
      // trägt seine Jail-Rolle weiter, und sein Eintrag steht noch da.
      toast.warning(`${freigelassen} freigelassen, ${fehlgeschlagen.length} nicht möglich.`, {
        description: fehlgeschlagen
          .slice(0, 3)
          .map((eintrag) => `${eintrag.label}: ${eintrag.grund}`)
          .join(' · '),
        duration: 10_000,
      });
    } else {
      toast.success(`${freigelassen} Mitglieder freigelassen, ${geloescht} Einträge gelöscht.`);
    }

    for (const warnung of warnings.slice(0, 5)) {
      toast.warning(warnung);
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
        <Trash2 aria-hidden="true" />
        Alle Jails aufheben ({aktive})
      </Button>

      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={
          aktive === 1
            ? 'Den laufenden Jail aufheben und löschen?'
            : `Alle ${aktive} laufenden Jails aufheben und löschen?`
        }
        confirmLabel="Aufheben und löschen"
        description={
          <>
            <p className="text-foreground">
              {aktive === 1 ? 'Ein Mitglied wird' : `${aktive} Mitglieder werden`} sofort freigelassen. Die
              Jail-Rolle wird entfernt, die vorherigen Rollen werden - soweit zulässig - wiederhergestellt.
            </p>
            <p className="text-foreground">
              Danach {aktive === 1 ? 'wird der Eintrag' : 'werden diese Einträge'}{' '}
              <strong>unwiderruflich gelöscht</strong>. Das lässt sich nicht rückgängig machen.
            </p>
            <p>
              Der Verlauf unter «Vergangen» bleibt unberührt, ebenso die Moderationshistorie der Betroffenen.
              Jede Freilassung erscheint im Moderationslog und im Audit Log.
            </p>
          </>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
