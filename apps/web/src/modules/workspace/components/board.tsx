'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { BOARD_SPALTEN, faelligkeitsstufe } from '@swisshub/modules/workspace/typen';
import { systemRoutes } from '@swisshub/shared';
import type { WorkspaceTaskStatus } from '@swisshub/database';
/*
 * Nur die Typen aus dem Haupteinstieg.
 *
 * Als Wert importiert zöge `@swisshub/modules` die Modul-Registry mitsamt
 * Prisma ins Browser-Bundle - `tests/unit/client-boundary.test.ts` hält das
 * fest. Die beiden Dinge, die diese Komponente zur Laufzeit braucht, stehen
 * im reinen Teil des Moduls und kommen von dort.
 */
import type { workspace } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import {
  AUFGABEN_STATUS_LABEL,
  FAELLIGKEIT_FARBE,
  PRIORITAET_FARBE,
  PRIORITAET_LABEL,
  fristText,
} from '../labels';
import { workspaceStatusSetzenAction } from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Das Board.
 *
 * ## Warum kein Drag-and-Drop-Paket
 *
 * Weil HTML5-Drag-and-Drop auf einem Touchgerät gar nicht stattfindet - es
 * gibt dort kein `dragstart`. Mobil braucht also ohnehin einen zweiten Weg,
 * und derselbe zweite Weg ist der, den die Tastatur braucht. Wenn der Weg
 * zweimal gebraucht wird, ist er der Hauptweg: die **Knopfreihe** unter jeder
 * Karte. Das Ziehen kommt obendrauf, für Maus und Trackpad, und kostet dafür
 * kein Paket.
 *
 * Die Knöpfe sind deshalb nicht die Behelfslösung. Sie sind die Oberfläche,
 * die überall funktioniert, und das Ziehen ist die Abkürzung.
 *
 * ## Warum der alte Status mitgeschickt wird
 *
 * Weil zwei Leute dasselbe Board offen haben. Wer eine Karte von «Offen» nach
 * «In Arbeit» zieht, hat auf seinem Bildschirm «Offen» gesehen; steht sie dort
 * inzwischen nicht mehr, ist der Zug kein Verschieben, sondern ein
 * Zurückdrehen. `erwarteterStatus` wird serverseitig in der `WHERE`-Bedingung
 * des `UPDATE` geprüft, und der Konflikt kommt als Meldung zurück.
 *
 * ## Warum die Karte sofort umspringt
 *
 * Damit das Ziehen sich wie Ziehen anfühlt und nicht wie ein Formular. Die
 * Verschiebung ist nur in diesem Bildschirm vorgezogen; scheitert der Aufruf,
 * springt sie zurück - `router.refresh()` holt danach den Stand vom Server, der
 * immer der gültige ist.
 */

const SPALTEN_FARBE: Record<workspace.BoardSpalte, string> = {
  OPEN: 'border-t-secondary',
  IN_PROGRESS: 'border-t-primary',
  BLOCKED: 'border-t-destructive',
  DONE: 'border-t-success',
};

export function Board({
  board,
  namen,
  jetzt,
  baldTage,
  darfBearbeiten,
  csrfToken,
}: {
  board: workspace.Board;
  namen: Record<string, Teammitglied>;
  jetzt: string;
  baldTage: number;
  darfBearbeiten: boolean;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  // Die vorgezogene Verschiebung: Kartenkennung auf Zielspalte. Nur, solange
  // der Aufruf läuft - danach gilt wieder der Stand vom Server.
  const [verschoben, setVerschoben] = useState<Record<string, WorkspaceTaskStatus>>({});
  const [ueberSpalte, setUeberSpalte] = useState<workspace.BoardSpalte | null>(null);
  const jetztDatum = new Date(jetzt);

  const verschiebe = (karte: workspace.BoardKarte, ziel: WorkspaceTaskStatus): void => {
    if (karte.status === ziel) {
      return;
    }
    setVerschoben((bisher) => ({ ...bisher, [karte.id]: ziel }));
    starte(async () => {
      const antwort = await workspaceStatusSetzenAction({
        csrfToken,
        taskId: karte.id,
        status: ziel,
        // Der Status, den dieser Bildschirm vor sich sah.
        erwarteterStatus: karte.status,
      });
      if (!antwort.ok) {
        // Zurückspringen, und die Meldung sagt, was los war. Ein stilles
        // Zurückspringen wäre eine Karte, die von selbst hüpft.
        setVerschoben((bisher) => {
          const kopie = { ...bisher };
          delete kopie[karte.id];
          return kopie;
        });
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      router.refresh();
    });
  };

  // Die vorgezogenen Verschiebungen auf das Board vom Server legen.
  const spalten = BOARD_SPALTEN.map((spalte) => ({
    spalte,
    karten: BOARD_SPALTEN.flatMap((quelle) =>
      board[quelle].filter((karte) => (verschoben[karte.id] ?? karte.status) === spalte),
    ),
  }));

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
        laeuft && 'pointer-events-none opacity-70',
      )}
    >
      {spalten.map(({ spalte, karten }) => (
        <section
          key={spalte}
          aria-label={AUFGABEN_STATUS_LABEL[spalte]}
          onDragOver={
            darfBearbeiten
              ? (ereignis): void => {
                  // Ohne `preventDefault` lehnt der Browser das Ablegen ab -
                  // das ist die Vorgabe und nicht unsere Entscheidung.
                  ereignis.preventDefault();
                  setUeberSpalte(spalte);
                }
              : undefined
          }
          onDragLeave={darfBearbeiten ? (): void => setUeberSpalte(null) : undefined}
          onDrop={
            darfBearbeiten
              ? (ereignis): void => {
                  ereignis.preventDefault();
                  setUeberSpalte(null);
                  const id = ereignis.dataTransfer.getData('text/plain');
                  const karte = BOARD_SPALTEN.flatMap((quelle) => board[quelle]).find(
                    (eintrag) => eintrag.id === id,
                  );
                  if (karte) {
                    verschiebe(karte, spalte);
                  }
                }
              : undefined
          }
          className={cn(
            'flex min-w-0 flex-col gap-2 rounded-xl border border-t-2 border-border bg-muted/20 p-2 transition-colors',
            SPALTEN_FARBE[spalte],
            ueberSpalte === spalte && 'bg-primary/5 ring-1 ring-primary/30',
          )}
        >
          <header className="flex items-baseline justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold">{AUFGABEN_STATUS_LABEL[spalte]}</h3>
            <span className="text-xs tabular-nums text-muted-foreground">{karten.length}</span>
          </header>

          {karten.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">–</p>
          ) : (
            karten.map((karte) => (
              <Karte
                key={karte.id}
                karte={karte}
                namen={namen}
                jetzt={jetztDatum}
                baldTage={baldTage}
                darfBearbeiten={darfBearbeiten}
                aufSpalte={spalte}
                verschiebe={verschiebe}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function Karte({
  karte,
  namen,
  jetzt,
  baldTage,
  darfBearbeiten,
  aufSpalte,
  verschiebe,
}: {
  karte: workspace.BoardKarte;
  namen: Record<string, Teammitglied>;
  jetzt: Date;
  baldTage: number;
  darfBearbeiten: boolean;
  aufSpalte: workspace.BoardSpalte;
  verschiebe: (karte: workspace.BoardKarte, ziel: WorkspaceTaskStatus) => void;
}): React.JSX.Element {
  const stufe = faelligkeitsstufe(karte.dueAt, jetzt, baldTage);
  const prioFarbe = PRIORITAET_FARBE[karte.prioritaet as keyof typeof PRIORITAET_FARBE];

  return (
    <article
      draggable={darfBearbeiten}
      onDragStart={
        darfBearbeiten
          ? (ereignis): void => {
              ereignis.dataTransfer.setData('text/plain', karte.id);
              ereignis.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
      className={cn(
        'rounded-lg border border-border bg-card p-3 text-sm',
        darfBearbeiten && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <Link
        href={systemRoutes.workspaceAufgabe(karte.id)}
        className="font-medium leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {karte.titel}
      </Link>

      {karte.projektTitel ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{karte.projektTitel}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {prioFarbe ? (
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', prioFarbe)}>
            {PRIORITAET_LABEL[karte.prioritaet as keyof typeof PRIORITAET_LABEL]}
          </span>
        ) : null}
        {karte.dueAt ? (
          <span className={cn('text-xs tabular-nums', FAELLIGKEIT_FARBE[stufe])}>
            {stufe === 'heute' ? 'heute' : fristText(karte.dueAt)}
          </span>
        ) : null}
        {karte.checklisteGesamt > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {karte.checklisteGesamt - karte.checklisteOffen}/{karte.checklisteGesamt}
          </span>
        ) : null}
      </div>

      {karte.zustaendige.length > 0 ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {karte.zustaendige.map((kennung) => namen[kennung]?.name ?? kennung).join(', ')}
        </p>
      ) : null}

      {darfBearbeiten ? (
        /*
         * Der Weg, der überall funktioniert.
         *
         * 44 Pixel hoch, weil das die Grösse ist, ab der ein Ziel auf einem
         * Telefon zuverlässig zu treffen ist - und weil genau dort das Ziehen
         * nicht stattfindet.
         */
        <div
          role="group"
          aria-label={`Status von «${karte.titel}» ändern`}
          className="mt-3 flex flex-wrap gap-1 border-t border-border/60 pt-2"
        >
          {BOARD_SPALTEN.filter((ziel) => ziel !== aufSpalte).map((ziel) => (
            <button
              key={ziel}
              type="button"
              onClick={(): void => verschiebe(karte, ziel)}
              className="min-h-11 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              → {AUFGABEN_STATUS_LABEL[ziel]}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** Ein Board ohne eine einzige Karte - mit dem Hinweis, was fehlt. */
export function BoardLeer({ darfAnlegen }: { darfAnlegen: boolean }): React.JSX.Element {
  return (
    <EmptyState
      title="Noch keine Aufgaben"
      description={
        darfAnlegen
          ? 'Lege die erste Aufgabe an - mit oder ohne Projekt. Sie landet in «Offen».'
          : 'Sobald das Team Aufgaben anlegt, stehen sie hier.'
      }
    />
  );
}
