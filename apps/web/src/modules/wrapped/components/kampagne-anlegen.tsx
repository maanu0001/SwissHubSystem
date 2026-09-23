'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { wrappedKampagneAnlegenAction } from '@/modules/wrapped/aktionen';

/**
 * Eine neue Kampagne anlegen.
 *
 * ## Warum der Schluessel vorgeschlagen und nicht erzwungen wird
 *
 * Er steht spaeter in der Adresse (`/wrapped/2026`). Aus dem Jahr laesst er
 * sich ableiten, aber nicht immer - es kann zwei Rueckblicke in einem Jahr
 * geben, etwa einen zur Server-Eroeffnung. Deshalb ein Vorschlag, der sich
 * ueberschreiben laesst.
 *
 * ## Warum der Zeitraum vorbelegt ist
 *
 * Neunundneunzig von hundert Kampagnen gehen vom 1. Januar bis zum 1. Januar.
 * Wer die Felder trotzdem sieht, weiss, dass sie beweglich sind.
 */
export function KampagneAnlegen({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const jahr = new Date().getFullYear();
  const [werte, setWerte] = useState({
    key: String(jahr),
    title: `SwissHub Wrapped ${jahr}`,
    displayYear: String(jahr),
    periodStart: `${jahr}-01-01`,
    periodEnd: `${jahr + 1}-01-01`,
  });

  const setzeJahr = (rohwert: string): void => {
    const zahl = Number(rohwert);
    if (!Number.isInteger(zahl) || zahl < 2000 || zahl > 2100) {
      setWerte((alt) => ({ ...alt, displayYear: rohwert }));
      return;
    }
    // Schluessel, Titel und Zeitraum ziehen mit - solange niemand sie von
    // Hand geaendert hat, ist das genau das, was erwartet wird.
    setWerte((alt) => ({
      key: alt.key === String(Number(alt.displayYear)) ? String(zahl) : alt.key,
      title: alt.title === `SwissHub Wrapped ${alt.displayYear}` ? `SwissHub Wrapped ${zahl}` : alt.title,
      displayYear: rohwert,
      periodStart: `${zahl}-01-01`,
      periodEnd: `${zahl + 1}-01-01`,
    }));
  };

  async function absenden(ereignis: React.FormEvent): Promise<void> {
    ereignis.preventDefault();
    setLaeuft(true);
    const antwort = await wrappedKampagneAnlegenAction({ csrfToken, ...werte });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Rückblick angelegt.');
    router.push(systemRoutes.wrappedKampagne(antwort.data.campaignId));
  }

  if (!offen) {
    return (
      <Button onClick={() => setOffen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Neuer Rückblick
      </Button>
    );
  }

  return (
    <form
      onSubmit={(ereignis) => void absenden(ereignis)}
      className="grid w-full gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2"
    >
      <div className="space-y-1.5">
        <Label htmlFor="wrapped-jahr">Jahr</Label>
        <Input
          id="wrapped-jahr"
          inputMode="numeric"
          value={werte.displayYear}
          onChange={(ereignis) => setzeJahr(ereignis.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wrapped-key">Schlüssel in der Adresse</Label>
        <Input
          id="wrapped-key"
          value={werte.key}
          onChange={(ereignis) => setWerte((alt) => ({ ...alt, key: ereignis.target.value.toLowerCase() }))}
          pattern="[a-z0-9-]{3,48}"
          required
        />
        <p className="text-xs text-muted-foreground">
          Wird zu <code className="text-foreground">/wrapped/{werte.key || '…'}</code>
        </p>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="wrapped-titel">Titel</Label>
        <Input
          id="wrapped-titel"
          value={werte.title}
          onChange={(ereignis) => setWerte((alt) => ({ ...alt, title: ereignis.target.value }))}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wrapped-von">Zeitraum von</Label>
        <Input
          id="wrapped-von"
          type="date"
          value={werte.periodStart}
          onChange={(ereignis) => setWerte((alt) => ({ ...alt, periodStart: ereignis.target.value }))}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wrapped-bis">bis (ausschliesslich)</Label>
        <Input
          id="wrapped-bis"
          type="date"
          value={werte.periodEnd}
          onChange={(ereignis) => setWerte((alt) => ({ ...alt, periodEnd: ereignis.target.value }))}
          required
        />
      </div>

      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Anlegen
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOffen(false)} disabled={laeuft}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
