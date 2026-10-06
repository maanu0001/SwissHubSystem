'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { premiumVergabeWiderrufenAction } from '@/modules/premium/actions';

/**
 * Eine Vergabe vorzeitig beenden (§11).
 *
 * Mit Bestaetigung und mit Pflichtgrund: wer jemandem etwas wegnimmt, soll
 * sagen, warum - der Grund steht danach in der Historie und im Protokoll. Ein
 * Widerruf ohne Begruendung ist in drei Wochen nicht mehr nachvollziehbar.
 */
export function VergabeWiderruf({
  csrfToken,
  grantId,
  person,
  produkt,
  laeuftBis,
}: {
  csrfToken: string;
  grantId: string;
  person: string;
  produkt: string;
  laeuftBis: string;
}): React.JSX.Element {
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const widerrufen = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await premiumVergabeWiderrufenAction({ csrfToken, grantId, grund: grund.trim() });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Der Widerruf ist fehlgeschlagen.');
      return;
    }
    toast.success('Die Vergabe ist beendet.');
    setOffen(false);
    setGrund('');
  };

  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <Ban aria-hidden="true" />
          Widerrufen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vergabe widerrufen</DialogTitle>
          <DialogDescription>
            {produkt} für {person} endet damit sofort statt am {laeuftBis}. Die Rolle und ein allfälliges
            Stübli werden über den gewöhnlichen Abgleich entfernt. Die Historie bleibt vollständig.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs" htmlFor={`widerruf-grund-${grantId}`}>
            Grund
          </Label>
          <Input
            id={`widerruf-grund-${grantId}`}
            className="mt-1"
            placeholder="Versehentlich doppelt vergeben"
            maxLength={500}
            value={grund}
            onChange={(ereignis) => setGrund(ereignis.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOffen(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={laeuft || grund.trim().length === 0}
            onClick={() => void widerrufen()}
          >
            {laeuft ? 'Wird beendet …' : 'Endgültig beenden'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
