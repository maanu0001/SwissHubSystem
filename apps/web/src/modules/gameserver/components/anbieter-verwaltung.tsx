'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { anbieterPruefenAction, anbieterSpeichernAction } from '@/modules/gameserver/actions';

/**
 * Einen Anbieter anlegen und die Verbindung prüfen.
 *
 * Die Treiberliste kommt aus der Registry des Servers - es gibt kein freies
 * Textfeld für den Treiber. Ein Anbieter mit einem Treiber, den es nicht
 * gibt, liesse sich sonst einschalten und würde beim ersten Match scheitern:
 * mitten im Turnier statt beim Einrichten.
 */
export function AnbieterVerwaltung({
  anbieter,
  treiber,
  csrfToken,
}: {
  anbieter: Array<{ id: string; name: string }>;
  treiber: Array<{ key: string; label: string }>;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [aktiv, setAktiv] = useState(false);
  const [treiberKey, setTreiberKey] = useState(treiber[0]?.key ?? '');

  async function speichern(formular: FormData): Promise<void> {
    setLaeuft('speichern');
    const antwort = await anbieterSpeichernAction({
      csrfToken,
      name: String(formular.get('name') ?? ''),
      driver: treiberKey,
      region: String(formular.get('region') ?? '') || null,
      enabled: aktiv,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Anbieter gespeichert.');
    router.refresh();
  }

  async function pruefen(providerId: string): Promise<void> {
    setLaeuft(providerId);
    const antwort = await anbieterPruefenAction({ csrfToken, providerId });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Die Prüfung ist fehlgeschlagen.');
      return;
    }
    if (antwort.data.ok) {
      toast.success(antwort.data.meldung);
    } else {
      toast.error(antwort.data.meldung);
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {anbieter.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Verbindung prüfen</h2>
          <div className="flex flex-wrap gap-2">
            {anbieter.map((eintrag) => (
              <Button
                key={eintrag.id}
                variant="outline"
                size="sm"
                disabled={laeuft !== null}
                onClick={() => void pruefen(eintrag.id)}
              >
                {laeuft === eintrag.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {eintrag.name}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Neuer Anbieter</h2>
        <form
          action={(formular) => void speichern(formular)}
          className="space-y-4 rounded-xl border border-border p-4"
        >
          <div className="space-y-2">
            <Label htmlFor="anbieter-name">Name</Label>
            <Input id="anbieter-name" name="name" required maxLength={80} placeholder="Datacenter Zürich" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="anbieter-treiber">Treiber</Label>
            <select
              id="anbieter-treiber"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={treiberKey}
              onChange={(ereignis) => setTreiberKey(ereignis.target.value)}
            >
              {treiber.map((eintrag) => (
                <option key={eintrag.key} value={eintrag.key}>
                  {eintrag.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Nur Treiber, für die es eine Umsetzung gibt. Fehlt eurer, kommt er als eigene Datei dazu - der
              Rest des Moduls bleibt unberührt.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="anbieter-region">Region (freiwillig)</Label>
            <Input id="anbieter-region" name="region" maxLength={60} />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="anbieter-aktiv" checked={aktiv} onCheckedChange={setAktiv} />
            <Label htmlFor="anbieter-aktiv">Sofort aktiv</Label>
          </div>

          <Button type="submit" disabled={laeuft !== null || !treiberKey}>
            {laeuft === 'speichern' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Anbieter speichern
          </Button>
        </form>
      </section>
    </div>
  );
}
