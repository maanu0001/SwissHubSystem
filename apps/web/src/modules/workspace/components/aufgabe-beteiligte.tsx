'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ZustaendigWahl } from './zustaendig-wahl';
import { workspaceZustaendigeSetzenAction } from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Die Beteiligten einer Aufgabe.
 *
 * ## Warum eine eigene Kachel
 *
 * Weil es eine eigene Frage ist. Die Auswahl stand bisher in «Ändern», neben
 * Status, Priorität und dem Löschknopf - also neben Dingen, die man
 * gelegentlich tut, während «wer macht das» die Frage ist, die man an einer
 * Aufgabe als erstes stellt. Eine Kachel mit demselben Namen wie im Projekt
 * macht aus zwei Listen eine Gewohnheit.
 *
 * ## Beteiligt heisst hier verantwortlich
 *
 * Und zwar alle gleichwertig. An einer Aufgabe gibt es keine Projektleitung
 * und keine Unterstützung - diese Unterscheidung gehört ins Projekt, wo
 * jemand entscheidet, und nicht an die Aufgabe, wo jemand arbeitet. Wer hier
 * steht, ist zuständig; stehen drei Leute da, sind drei Leute zuständig.
 *
 * ## Warum ein Speicherknopf
 *
 * Weil eine Zuweisung eine Entscheidung über mehrere Kästchen ist. Jeden
 * Klick einzeln zu schicken hiesse, bei «A raus, B rein» zwischendurch eine
 * Aufgabe ohne Beteiligte herzustellen - und B eine Meldung zu schicken,
 * bevor man fertig überlegt hat.
 */
export function AufgabeBeteiligte({
  csrfToken,
  taskId,
  beteiligte,
  team,
  darfBearbeiten,
}: {
  csrfToken: string;
  taskId: string;
  beteiligte: readonly string[];
  team: Teammitglied[];
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [gewaehlt, setGewaehlt] = useState<string[]>([...beteiligte]);

  const geaendert =
    gewaehlt.length !== beteiligte.length || gewaehlt.some((kennung) => !beteiligte.includes(kennung));

  if (!darfBearbeiten) {
    /*
     * Ohne Berechtigung bleibt die Liste sichtbar, nur unveränderlich.
     *
     * Wer nicht zuweisen darf, will trotzdem wissen, wen er fragen muss -
     * eine leere Kachel wäre die schlechtere Auskunft.
     */
    return (
      <div className="space-y-2">
        <ZustaendigWahl
          team={team}
          gewaehlt={gewaehlt}
          aufAendern={(): void => undefined}
          disabled
          hinweis="Zum Ändern der Beteiligten fehlt dir die Berechtigung."
        />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', laeuft && 'pointer-events-none opacity-70')}>
      <ZustaendigWahl
        team={team}
        gewaehlt={gewaehlt}
        aufAendern={(discordId): void =>
          setGewaehlt((bisher) =>
            bisher.includes(discordId)
              ? bisher.filter((eintrag) => eintrag !== discordId)
              : [...bisher, discordId],
          )
        }
      />

      {geaendert ? (
        <Button
          size="sm"
          onClick={(): void =>
            starte(async () => {
              const antwort = await workspaceZustaendigeSetzenAction({
                csrfToken,
                taskId,
                discordIds: gewaehlt,
              });
              if (!antwort.ok) {
                toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
                return;
              }
              toast.success('Beteiligte gespeichert.');
              router.refresh();
            })
          }
        >
          Beteiligte speichern
        </Button>
      ) : null}
    </div>
  );
}
