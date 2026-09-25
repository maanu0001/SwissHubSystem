'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { backup } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { anforderungStellenAction } from '@/modules/backup/actions';

/**
 * Ein Knopf, der eine Anforderung an den Controller ablegt.
 *
 * Er startet nichts. Er legt eine Datei ab, und ein Dienst unter einem anderen
 * Benutzer arbeitet sie ab - siehe den Kopf von
 * `deploy/backup/bin/swisshub-backup-controller`.
 *
 * Deshalb ist die Rueckmeldung bewusst «abgelegt» und nicht «fertig»: ein
 * Vollbackup laeuft Minuten bis Stunden. Ein Knopf, der «erledigt» meldet,
 * bevor etwas erledigt ist, waere die Art Zusage, die man beim naechsten Mal
 * nicht mehr glaubt.
 */
export function AktionKnopf({
  operation,
  label,
  beschreibung,
  csrfToken,
  variante = 'outline',
  /**
   * Eine Bestaetigung vorschalten.
   *
   * Nicht fuer alles: ein Lesevorgang braucht keine. Fuer alles, was Stunden
   * laeuft oder den Server merklich belastet, schon - damit ein Fehlklick
   * nicht eine Stunde Rechenzeit kostet.
   */
  bestaetigung,
  /** Nur fuer Operationen, die einen Zeitpunkt annehmen. */
  zeitpunkt,
  deaktiviert,
  deaktiviertGrund,
}: {
  operation: backup.ControllerOperation;
  label: string;
  beschreibung?: string;
  csrfToken: string;
  variante?: 'default' | 'outline' | 'secondary' | 'destructive';
  bestaetigung?: { titel: string; text: string };
  zeitpunkt?: string;
  deaktiviert?: boolean;
  deaktiviertGrund?: string;
}): React.JSX.Element {
  const [laeuft, setLaeuft] = useState(false);
  const [dialogOffen, setDialogOffen] = useState(false);
  const [uebergang, starteUebergang] = useTransition();
  const router = useRouter();

  const ausfuehren = async (): Promise<void> => {
    setLaeuft(true);
    try {
      const antwort = await anforderungStellenAction({
        csrfToken,
        operation,
        ...(zeitpunkt ? { zeitpunkt } : {}),
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Anforderung liess sich nicht ablegen.');
        return;
      }
      const daten = antwort.data as { kennung: string; hinweis: string };
      toast.success(`${label} angefordert`, { description: daten.hinweis });
      // Die Seite neu laden, damit die laufende Anforderung erscheint.
      starteUebergang(() => router.refresh());
    } finally {
      setLaeuft(false);
      setDialogOffen(false);
    }
  };

  const beschaeftigt = laeuft || uebergang;

  const knopf = (
    <Button
      variant={variante}
      size="sm"
      disabled={beschaeftigt || deaktiviert}
      title={deaktiviert ? deaktiviertGrund : beschreibung}
      onClick={bestaetigung ? () => setDialogOffen(true) : ausfuehren}
    >
      {beschaeftigt ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
      {label}
    </Button>
  );

  if (!bestaetigung) {
    return knopf;
  }

  return (
    <>
      {knopf}
      <ConfirmationDialog
        open={dialogOffen}
        onOpenChange={setDialogOffen}
        title={bestaetigung.titel}
        description={bestaetigung.text}
        confirmLabel={label}
        onConfirm={ausfuehren}
      />
    </>
  );
}
