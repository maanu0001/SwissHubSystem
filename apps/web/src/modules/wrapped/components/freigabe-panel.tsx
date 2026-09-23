'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Archive, CheckCircle2, Info, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  wrappedArchivierenAction,
  wrappedVeroeffentlichenAction,
  wrappedZurueckziehenAction,
} from '@/modules/wrapped/aktionen';

/**
 * Der Weg nach draussen.
 *
 * ## Zwei Listen, nicht eine
 *
 * **Blocker** verhindern die Veroeffentlichung. **Hinweise** nicht - sie
 * sind Dinge, die jemand wissen sollte, bevor er den Knopf drueckt. Beides
 * in einer Liste zu zeigen hiesse, dass man sie einzeln lesen muesste, um
 * zu wissen, welche davon wirklich zaehlen.
 *
 * ## Warum trotzdem gefragt wird
 *
 * Veroeffentlichen erreicht jedes Mitglied gleichzeitig und schreibt
 * moeglicherweise nach Discord. Das ist die Art Handlung, bei der eine
 * Ruecknahme zwar technisch geht, die erste Reaktion aber schon passiert
 * ist. Also eine Frage dazwischen - mit der Zahl, um die es geht.
 */
export function FreigabePanel({
  campaignId,
  status,
  pruefung,
  kuendigtAn,
  csrfToken,
  darfVeroeffentlichen,
}: {
  campaignId: string;
  status: string;
  pruefung: { bereit: boolean; blocker: string[]; hinweise: string[]; snapshots: number; szenen: number };
  kuendigtAn: boolean;
  csrfToken: string;
  darfVeroeffentlichen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [frage, setFrage] = useState<'publish' | 'unpublish' | 'archive' | null>(null);
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function fuehreAus(
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(true);
    const antwort = await aktion();
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      throw new Error('fehlgeschlagen');
    }
    toast.success(erfolg);
    setFrage(null);
    router.refresh();
  }

  const veroeffentlicht = status === 'PUBLISHED';
  const archiviert = status === 'ARCHIVED';

  return (
    <div className="space-y-4">
      {pruefung.blocker.length > 0 ? (
        <ul className="space-y-2">
          {pruefung.blocker.map((eintrag) => (
            <li
              key={eintrag}
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {eintrag}
            </li>
          ))}
        </ul>
      ) : veroeffentlicht || archiviert ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Bereit: {pruefung.szenen} Szenen eingeschaltet, {pruefung.snapshots} Momentaufnahmen geschrieben.
        </p>
      )}

      {pruefung.hinweise.length > 0 ? (
        <ul className="space-y-2">
          {pruefung.hinweise.map((eintrag) => (
            <li
              key={eintrag}
              className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {eintrag}
            </li>
          ))}
        </ul>
      ) : null}

      {darfVeroeffentlichen ? (
        <div className="flex flex-wrap gap-2">
          {!veroeffentlicht && !archiviert ? (
            <Button onClick={() => setFrage('publish')} disabled={!pruefung.bereit || laeuft}>
              {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Veröffentlichen
            </Button>
          ) : null}

          {veroeffentlicht ? (
            <Button variant="outline" onClick={() => setFrage('unpublish')} disabled={laeuft}>
              <Undo2 className="size-4" aria-hidden="true" />
              Zurückziehen
            </Button>
          ) : null}

          {/*
            Waehrend ein Durchgang laeuft, geht es nicht - er schriebe in
            eine Kampagne, die man gerade wegraeumen will. Der Knopf
            verschwindet dann, statt eine Absage zu ernten.
          */}
          {!archiviert && status !== 'PREPARING' ? (
            <Button variant="ghost" onClick={() => setFrage('archive')} disabled={laeuft}>
              <Archive className="size-4" aria-hidden="true" />
              Archivieren
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmationDialog
        open={frage === 'publish'}
        onOpenChange={(offen) => setFrage(offen ? 'publish' : null)}
        title="Rückblick veröffentlichen?"
        description={`${pruefung.snapshots} Mitglieder können ihren Rückblick danach sofort öffnen.${
          kuendigtAn ? ' Die Ankündigung wird einmalig nach Discord geschrieben.' : ''
        }`}
        confirmLabel="Veröffentlichen"
        onConfirm={() =>
          fuehreAus(
            () => wrappedVeroeffentlichenAction({ csrfToken, campaignId }),
            'Der Rückblick ist draussen.',
          )
        }
      />

      <ConfirmationDialog
        open={frage === 'unpublish'}
        onOpenChange={(offen) => setFrage(offen ? 'unpublish' : null)}
        title="Rückblick zurückziehen?"
        description="Er ist danach für niemanden mehr erreichbar. Die Momentaufnahmen bleiben erhalten."
        confirmLabel="Zurückziehen"
        destructive
        onConfirm={() =>
          fuehreAus(
            () => wrappedZurueckziehenAction({ csrfToken, campaignId, grund: grund.trim() }),
            'Zurückgezogen.',
          )
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="wrapped-grund">Grund (steht im Protokoll)</Label>
          <Input
            id="wrapped-grund"
            value={grund}
            onChange={(ereignis) => setGrund(ereignis.target.value)}
            placeholder="z. B. Zahlen im Voice stimmen nicht"
            maxLength={300}
          />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={frage === 'archive'}
        onOpenChange={(offen) => setFrage(offen ? 'archive' : null)}
        title="Rückblick archivieren?"
        description="Archivierte Rückblicke lassen sich nicht mehr bearbeiten oder veröffentlichen."
        confirmLabel="Archivieren"
        destructive
        onConfirm={() => fuehreAus(() => wrappedArchivierenAction({ csrfToken, campaignId }), 'Archiviert.')}
      />
    </div>
  );
}
