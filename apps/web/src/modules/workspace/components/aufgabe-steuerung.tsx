'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { WorkspacePriority, WorkspaceTaskStatus } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { AUFGABEN_STATUS_LABEL, PRIORITAET_LABEL } from '../labels';
import {
  workspaceAufgabeLoeschenAction,
  workspacePrioritaetSetzenAction,
  workspaceStatusSetzenAction,
  workspaceZustaendigeSetzenAction,
} from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Was man auf der Detailseite einer Aufgabe tut.
 *
 * Status, Priorität, Zuständige, löschen - jedes als eigener Aufruf und nicht
 * als ein Formular mit Speicherknopf. Der Grund ist derselbe wie beim Board:
 * ein gemeinsames Speichern würde Felder mitschreiben, die zwischenzeitlich
 * jemand anders geändert hat.
 *
 * Der Statuswechsel schickt den Status mit, den diese Seite vor sich sah.
 */

const STATUS: WorkspaceTaskStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'];
const PRIORITAETEN: WorkspacePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function AufgabeSteuerung({
  csrfToken,
  taskId,
  status,
  prioritaet,
  zustaendige,
  team,
  darfBearbeiten,
  darfLoeschen,
  zurueckAuf,
}: {
  csrfToken: string;
  taskId: string;
  status: WorkspaceTaskStatus;
  prioritaet: WorkspacePriority;
  zustaendige: readonly string[];
  team: Teammitglied[];
  darfBearbeiten: boolean;
  darfLoeschen: boolean;
  /** Wohin es nach dem Löschen geht - die Aufgabe gibt es dann nicht mehr. */
  zurueckAuf: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [gewaehlt, setGewaehlt] = useState<string[]>([...zustaendige]);
  const [loeschenBestaetigt, setLoeschenBestaetigt] = useState(false);

  const ruf = (
    aufruf: () => Promise<{ ok: boolean; error?: { message: string } | null }>,
    erfolg: string,
  ): void => {
    starte(async () => {
      const antwort = await aufruf();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(erfolg);
      router.refresh();
    });
  };

  if (!darfBearbeiten) {
    return (
      <p className="text-sm text-muted-foreground">Zum Ändern dieser Aufgabe fehlt dir die Berechtigung.</p>
    );
  }

  return (
    <div className={cn('space-y-5', laeuft && 'pointer-events-none opacity-70')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="ws-d-status" className="text-sm font-medium">
            Status
          </label>
          <Select
            value={status}
            onValueChange={(wert): void =>
              ruf(
                () =>
                  workspaceStatusSetzenAction({
                    csrfToken,
                    taskId,
                    status: wert as WorkspaceTaskStatus,
                    // Der Status, den diese Seite geladen hat.
                    erwarteterStatus: status,
                  }),
                'Status geändert.',
              )
            }
          >
            <SelectTrigger id="ws-d-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS.map((wert) => (
                <SelectItem key={wert} value={wert}>
                  {AUFGABEN_STATUS_LABEL[wert]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label htmlFor="ws-d-prio" className="text-sm font-medium">
            Priorität
          </label>
          <Select
            value={prioritaet}
            onValueChange={(wert): void =>
              ruf(
                () =>
                  workspacePrioritaetSetzenAction({
                    csrfToken,
                    taskId,
                    prioritaet: wert as WorkspacePriority,
                  }),
                'Priorität geändert.',
              )
            }
          >
            <SelectTrigger id="ws-d-prio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITAETEN.map((wert) => (
                <SelectItem key={wert} value={wert}>
                  {PRIORITAET_LABEL[wert]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Zuständig</legend>
        <div className="flex flex-wrap gap-2">
          {team.map((mitglied) => {
            const an = gewaehlt.includes(mitglied.discordId);
            return (
              <label
                key={mitglied.discordId}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors',
                  an
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={an}
                  onChange={(): void =>
                    setGewaehlt((bisher) =>
                      bisher.includes(mitglied.discordId)
                        ? bisher.filter((eintrag) => eintrag !== mitglied.discordId)
                        : [...bisher, mitglied.discordId],
                    )
                  }
                  className="sr-only"
                />
                {mitglied.name}
              </label>
            );
          })}
        </div>
        {/*
          Hier ist ein Speicherknopf richtig: eine Zuweisung ist eine
          Entscheidung über mehrere Kästchen, und jeder Klick einzeln zu
          schicken hiesse, bei «A raus, B rein» zwischendurch einen Zustand
          ohne Zuständige herzustellen - und eine Meldung an B zu schicken,
          bevor man fertig überlegt hat.
        */}
        {gewaehlt.length !== zustaendige.length ||
        gewaehlt.some((kennung) => !zustaendige.includes(kennung)) ? (
          <Button
            size="sm"
            onClick={(): void =>
              ruf(
                () => workspaceZustaendigeSetzenAction({ csrfToken, taskId, discordIds: gewaehlt }),
                'Zuständige gespeichert.',
              )
            }
          >
            Zuständige speichern
          </Button>
        ) : null}
      </fieldset>

      {darfLoeschen ? (
        <div className="border-t border-border pt-4">
          {loeschenBestaetigt ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                Endgültig löschen? Kommentare und Verlauf gehen mit.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={(): void =>
                  starte(async () => {
                    const antwort = await workspaceAufgabeLoeschenAction({ csrfToken, taskId });
                    if (!antwort.ok) {
                      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
                      return;
                    }
                    toast.success('Aufgabe gelöscht.');
                    // Nicht `refresh`: die Seite, auf der wir stehen, gibt es
                    // nicht mehr.
                    router.push(zurueckAuf);
                  })
                }
              >
                Ja, löschen
              </Button>
              <Button variant="ghost" size="sm" onClick={(): void => setLoeschenBestaetigt(false)}>
                Abbrechen
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={(): void => setLoeschenBestaetigt(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Aufgabe löschen
            </Button>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Für erledigte Arbeit ist «Abgebrochen» der richtige Status - sie bleibt dann lesbar. Gelöscht
            wird, was nie eine Aufgabe war.
          </p>
        </div>
      ) : null}
    </div>
  );
}
