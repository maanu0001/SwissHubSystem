'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkspaceMilestone } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fristText } from '../labels';
import {
  workspaceMeilensteinAendernAction,
  workspaceMeilensteinErstellenAction,
  workspaceMeilensteinLoeschenAction,
} from '../actions';

/**
 * Die Meilensteine eines Projekts.
 *
 * ## Warum ein Meilenstein keine Aufgabe ist
 *
 * Weil er nichts ist, was jemand tut. «Anmeldung offen» ist ein Zeitpunkt, an
 * dem ein Zustand erreicht sein muss - ihm einen Zuständigen und eine
 * Checkliste zu geben hiesse, ihn mit den Aufgaben zu verwechseln, die auf ihn
 * zulaufen. Deshalb hat er hier Titel, Datum und ein Häkchen, und sonst
 * nichts.
 *
 * Und deshalb zählt er nicht in den Fortschritt: der kommt aus Aufgaben. Ein
 * Projekt, dessen Fortschritt an abgehakten Meilensteinen hängt, springt von
 * 0 auf 50 Prozent, weil jemand ein Datum bestätigt hat.
 */
export function Meilensteine({
  csrfToken,
  projectId,
  meilensteine,
  darfBearbeiten,
}: {
  csrfToken: string;
  projectId: string;
  meilensteine: WorkspaceMilestone[];
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [titel, setTitel] = useState('');
  const [datum, setDatum] = useState('');

  const ruf = (
    aufruf: () => Promise<{ ok: boolean; error?: { message: string } | null }>,
    erfolg?: string,
  ): void => {
    starte(async () => {
      const antwort = await aufruf();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (erfolg) {
        toast.success(erfolg);
      }
      router.refresh();
    });
  };

  return (
    <div className={cn('space-y-3', laeuft && 'opacity-70')}>
      {meilensteine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Kein Meilenstein. Für ein Projekt mit festen Zwischenpunkten - «Anmeldung offen», «Regelwerk steht»
          - sind sie das Gerüst, an dem die Aufgaben hängen.
        </p>
      ) : (
        <ol className="space-y-1">
          {meilensteine.map((meilenstein) => (
            <li key={meilenstein.id} className="flex items-center gap-2">
              <label
                className={cn(
                  'flex min-h-11 flex-1 items-center gap-2 text-sm',
                  darfBearbeiten ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <input
                  type="checkbox"
                  checked={meilenstein.erledigt}
                  disabled={!darfBearbeiten}
                  onChange={(ereignis): void =>
                    ruf(() =>
                      workspaceMeilensteinAendernAction({
                        csrfToken,
                        meilensteinId: meilenstein.id,
                        projectId,
                        erledigt: ereignis.target.checked,
                      }),
                    )
                  }
                  className="size-4 rounded border-input"
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    meilenstein.erledigt && 'text-muted-foreground line-through',
                  )}
                >
                  {meilenstein.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {fristText(meilenstein.dueAt)}
                </span>
              </label>
              {darfBearbeiten ? (
                <button
                  type="button"
                  aria-label={`«${meilenstein.title}» entfernen`}
                  onClick={(): void =>
                    ruf(() =>
                      workspaceMeilensteinLoeschenAction({
                        csrfToken,
                        meilensteinId: meilenstein.id,
                        projectId,
                      }),
                    )
                  }
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {darfBearbeiten ? (
        <form
          onSubmit={(ereignis): void => {
            ereignis.preventDefault();
            if (titel.trim() === '' || datum === '') {
              toast.error('Ein Meilenstein braucht Titel und Datum.');
              return;
            }
            ruf(async () => {
              const antwort = await workspaceMeilensteinErstellenAction({
                csrfToken,
                projectId,
                titel,
                dueAt: datum,
              });
              if (antwort.ok) {
                setTitel('');
                setDatum('');
              }
              return antwort;
            }, 'Meilenstein angelegt.');
          }}
          className="space-y-2 border-t border-border/60 pt-3"
        >
          <Input
            value={titel}
            maxLength={120}
            onChange={(ereignis): void => setTitel(ereignis.target.value)}
            placeholder="Was muss erreicht sein?"
            aria-label="Titel des Meilensteins"
          />
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={datum}
              onChange={(ereignis): void => setDatum(ereignis.target.value)}
              aria-label="Datum des Meilensteins"
            />
            <Button type="submit" variant="outline" size="sm" disabled={laeuft}>
              <Plus className="size-4" />
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
