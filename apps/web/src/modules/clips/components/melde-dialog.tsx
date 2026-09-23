'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clipMeldenAction } from '@/modules/clips/actions';
import { cn } from '@/lib/utils';

type Grund = 'INAPPROPRIATE' | 'RIGHTS' | 'HARASSMENT' | 'OTHER';

const GRUENDE: Array<{ key: Grund; label: string; hinweis: string }> = [
  {
    key: 'INAPPROPRIATE',
    label: 'Unpassender Inhalt',
    hinweis: 'Gewalt, Sexuelles, Verstoss gegen die Regeln',
  },
  { key: 'RIGHTS', label: 'Rechte', hinweis: 'Fremdes Material ohne Erlaubnis' },
  { key: 'HARASSMENT', label: 'Belästigung', hinweis: 'Richtet sich gegen eine bestimmte Person' },
  { key: 'OTHER', label: 'Etwas anderes', hinweis: 'Bitte kurz beschreiben' },
];

/**
 * Einen Clip melden.
 *
 * Die Antwort ist immer dieselbe - «ist beim Team». Wer schon gemeldet hat,
 * erfaehrt das nicht: sonst liesse sich an der Meldung ablesen, wer sonst
 * noch gemeldet hat. Die Entscheidung trifft ohnehin die Moderation, nicht
 * die Zahl der Meldungen.
 */
export function MeldeDialog({
  offen,
  aufOeffnenAendern,
  clipId,
  titel,
  csrfToken,
}: {
  offen: boolean;
  aufOeffnenAendern: (offen: boolean) => void;
  clipId: string;
  titel: string;
  csrfToken: string;
}): React.JSX.Element {
  const [grund, setGrund] = useState<Grund | null>(null);
  const [notiz, setNotiz] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function senden(): Promise<void> {
    if (!grund || laeuft) {
      return;
    }
    setLaeuft(true);
    const antwort = await clipMeldenAction({
      csrfToken,
      clipId,
      grund,
      ...(notiz.trim() ? { notiz: notiz.trim() } : {}),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Danke - die Meldung liegt beim Team.');
    aufOeffnenAendern(false);
    setGrund(null);
    setNotiz('');
  }

  return (
    <Dialog open={offen} onOpenChange={aufOeffnenAendern}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clip melden</DialogTitle>
        </DialogHeader>

        <p className="truncate text-sm text-muted-foreground">{titel}</p>

        <div className="space-y-2">
          {GRUENDE.map((eintrag) => (
            <button
              key={eintrag.key}
              type="button"
              onClick={() => setGrund(eintrag.key)}
              className={cn(
                'w-full rounded-xl border px-4 py-3 text-left transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                grund === eintrag.key
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40 hover:bg-secondary/50',
              )}
            >
              <span className="block text-sm font-medium">{eintrag.label}</span>
              <span className="block text-xs text-muted-foreground">{eintrag.hinweis}</span>
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="melde-notiz">Notiz (optional)</Label>
          <Input
            id="melde-notiz"
            value={notiz}
            maxLength={300}
            onChange={(ereignis) => setNotiz(ereignis.target.value)}
            placeholder="Was stimmt nicht?"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => aufOeffnenAendern(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => void senden()} disabled={!grund || laeuft}>
            Melden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
