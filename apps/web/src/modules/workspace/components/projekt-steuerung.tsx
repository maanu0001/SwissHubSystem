'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import type { WorkspaceMemberRole } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ROLLE_LABEL } from '../labels';
import {
  workspaceMitgliederSetzenAction,
  workspaceProjektArchivierenAction,
  workspaceProjektZurueckholenAction,
} from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Mitglieder, Archivieren, Zurückholen.
 *
 * ## Warum Archivieren eine Bestätigung braucht und Zurückholen nicht
 *
 * Weil das eine das Projekt aus allen Ansichten nimmt und das andere es
 * wiederbringt. Ein versehentliches Zurückholen merkt man sofort und macht es
 * mit einem Klick rückgängig; ein versehentliches Archivieren merkt man
 * vielleicht in zwei Wochen, wenn jemand sein Projekt nicht mehr findet.
 *
 * ## Warum die Projektleitung im Formular steht und nicht als Knopf
 *
 * Weil mindestens eine gebraucht wird. Ein «Leitung entfernen»-Knopf je Zeile
 * führte zwangsläufig in den Zustand ohne Leitung - der Server lehnt ihn ab,
 * und eine Oberfläche, deren Knöpfe scheitern, ist schlechter als eine, die
 * den Zustand gar nicht anbietet.
 */

export function Mitgliederverwaltung({
  csrfToken,
  projectId,
  mitglieder,
  team,
}: {
  csrfToken: string;
  projectId: string;
  mitglieder: ReadonlyArray<{ discordId: string; rolle: WorkspaceMemberRole }>;
  team: Teammitglied[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [stand, setStand] = useState<Record<string, WorkspaceMemberRole | 'keine'>>(() => {
    const anfang: Record<string, WorkspaceMemberRole | 'keine'> = {};
    for (const mitglied of team) {
      anfang[mitglied.discordId] = 'keine';
    }
    for (const mitglied of mitglieder) {
      anfang[mitglied.discordId] = mitglied.rolle;
    }
    return anfang;
  });

  const gewaehlt = Object.entries(stand).filter(([, rolle]) => rolle !== 'keine');
  const hatLeitung = gewaehlt.some(([, rolle]) => rolle === 'LEAD');

  const speichern = (): void => {
    if (!hatLeitung) {
      toast.error('Das Projekt braucht mindestens eine Projektleitung.');
      return;
    }
    starte(async () => {
      const antwort = await workspaceMitgliederSetzenAction({
        csrfToken,
        projectId,
        mitglieder: gewaehlt.map(([discordId, rolle]) => ({
          discordId,
          rolle: rolle as WorkspaceMemberRole,
        })),
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Mitglieder gespeichert.');
      router.refresh();
    });
  };

  /*
   * Personen, die im Projekt stehen, aber nicht im Team.
   *
   * Zum Beispiel, weil jemand seine Berechtigung verloren hat. Sie wegzulassen
   * hiesse, sie beim nächsten Speichern stillschweigend aus dem Projekt zu
   * entfernen - deshalb stehen sie dabei, mit Hinweis.
   */
  const ausserhalb = mitglieder.filter(
    (mitglied) => !team.some((eintrag) => eintrag.discordId === mitglied.discordId),
  );

  return (
    <div className={cn('space-y-4', laeuft && 'pointer-events-none opacity-70')}>
      <ul className="space-y-2">
        {team.map((mitglied) => (
          <li key={mitglied.discordId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm">{mitglied.name}</span>
            <Select
              value={stand[mitglied.discordId] ?? 'keine'}
              onValueChange={(wert): void =>
                setStand((bisher) => ({
                  ...bisher,
                  [mitglied.discordId]: wert as WorkspaceMemberRole | 'keine',
                }))
              }
            >
              <SelectTrigger className="w-44 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keine">Nicht beteiligt</SelectItem>
                <SelectItem value="MEMBER">{ROLLE_LABEL.MEMBER}</SelectItem>
                <SelectItem value="LEAD">{ROLLE_LABEL.LEAD}</SelectItem>
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>

      {ausserhalb.length > 0 ? (
        <p className="text-xs text-warning">
          {ausserhalb.length === 1 ? 'Eine Person' : `${ausserhalb.length} Personen`} im Projekt darf den
          Workspace nicht mehr öffnen. Beim Speichern {ausserhalb.length === 1 ? 'fällt sie' : 'fallen sie'}{' '}
          heraus.
        </p>
      ) : null}

      {!hatLeitung ? (
        <p className="text-xs text-destructive">Mindestens eine Projektleitung ist nötig.</p>
      ) : null}

      <Button size="sm" onClick={speichern} disabled={laeuft || !hatLeitung}>
        Mitglieder speichern
      </Button>
    </div>
  );
}

export function ArchivKnopf({
  csrfToken,
  projectId,
  archiviert,
  titel,
}: {
  csrfToken: string;
  projectId: string;
  archiviert: boolean;
  titel: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [bestaetigt, setBestaetigt] = useState(false);

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
      setBestaetigt(false);
      toast.success(erfolg);
      router.refresh();
    });
  };

  if (archiviert) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={laeuft}
        onClick={(): void =>
          ruf(() => workspaceProjektZurueckholenAction({ csrfToken, projectId }), 'Projekt zurückgeholt.')
        }
      >
        Zurückholen
      </Button>
    );
  }

  if (!bestaetigt) {
    return (
      <Button variant="outline" size="sm" onClick={(): void => setBestaetigt(true)}>
        <Archive className="size-4" />
        Archivieren
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        «{titel}» ins Archiv? Aufgaben und Verlauf bleiben, nur aus den Listen ist es weg.
      </span>
      <Button
        size="sm"
        disabled={laeuft}
        onClick={(): void =>
          ruf(() => workspaceProjektArchivierenAction({ csrfToken, projectId }), 'Projekt archiviert.')
        }
      >
        Ja, archivieren
      </Button>
      <Button variant="ghost" size="sm" onClick={(): void => setBestaetigt(false)}>
        Abbrechen
      </Button>
    </div>
  );
}
