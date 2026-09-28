'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { MatchRoomAnsicht } from '@/server/gameserver';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  matchAktionAction,
  vetoAbschliessenAction,
  vetoSchrittAction,
  vetoUebersteuernAction,
} from '@/modules/gameserver/actions';

/**
 * Der Match Room.
 *
 * ## Für wen er gemacht ist
 *
 * Für zwei Captains, die gleich spielen. Sie brauchen: gegen wen, welcher
 * Modus, wo der Server steht, welches Passwort, wer beim Veto dran ist.
 * Alles andere ist Verwaltung und steht woanders.
 *
 * ## Was ein Spieler hier nicht sieht
 *
 * Kein RCON-Passwort, kein Agent-Token, keine Kennung der Maschine beim
 * Anbieter. Die Daten kommen als `MatchRoomAnsicht`, und dieser Typ enthält
 * nichts davon.
 */
export function MatchRoom({
  raum,
  csrfToken,
  darfUebersteuern,
  darfSteuern,
}: {
  raum: MatchRoomAnsicht;
  csrfToken: string;
  darfUebersteuern: boolean;
  darfSteuern: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [frage, setFrage] = useState<'RESTART' | 'SERVER_RESTART' | null>(null);

  async function fuehreAus(
    marke: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(marke);
    const antwort = await aktion();
    setLaeuft(null);
    setFrage(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  const veto = raum.veto;
  const darfWaehlen = raum.amZug || (darfUebersteuern && veto?.naechster?.kind !== 'DECIDER');

  return (
    <div className="space-y-6">
      <Panel title="Server" icon="Server" description={raum.phaseText}>
        {raum.serverAdresse ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Wert name="Adresse" wert={raum.serverAdresse} gross />
            <Wert name="Passwort" wert={raum.serverPasswort ?? 'keines'} gross />
            <Wert name="Zustand" wert={raum.serverStatus ?? 'unbekannt'} />
            <Wert name="Map" wert={raum.aktuelleMap ?? 'noch keine'} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Der Server ist noch nicht bereit. Sobald er steht, erscheinen Adresse und Passwort hier.
          </p>
        )}

        {raum.lastError ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {raum.lastError}
          </p>
        ) : null}

        {raum.resultReview ? (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
            Das Resultat muss von der Turnierleitung geprüft werden.
            {raum.resultReviewReason ? ` ${raum.resultReviewReason}` : ''}
          </p>
        ) : null}
      </Panel>

      {veto ? (
        <Panel
          title="Map-Veto"
          icon="Swords"
          description={
            veto.fertig
              ? 'Abgeschlossen.'
              : veto.naechster?.kind === 'DECIDER'
                ? 'Die letzte Map bleibt übrig - die Turnierleitung schliesst ab.'
                : `${veto.naechster?.kind === 'BAN' ? 'Bann' : 'Pick'} · Seite ${veto.naechster?.actor ?? '?'} ist am Zug`
          }
        >
          {veto.gewaehlt.length > 0 ? (
            <div className="mb-4 space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Gespielt wird</h3>
              <ol className="flex flex-wrap gap-2">
                {veto.gewaehlt.map((map, i) => (
                  <li key={map}>
                    <Badge variant="success">
                      {i + 1}. {map}
                    </Badge>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {veto.verfuegbar.length > 0 && !veto.fertig ? (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {darfWaehlen ? 'Du bist dran' : 'Noch zur Wahl'}
              </h3>
              <div className="flex flex-wrap gap-2">
                {veto.verfuegbar.map((map) => (
                  <Button
                    key={map}
                    variant="outline"
                    // 44 Pixel Mindesthöhe: das hier wird auf einem Telefon
                    // geklickt, während fünfzig Leute warten.
                    className="min-h-11"
                    disabled={!darfWaehlen || laeuft !== null}
                    onClick={() =>
                      void fuehreAus(
                        map,
                        () =>
                          raum.amZug
                            ? vetoSchrittAction({ csrfToken, assignmentId: raum.assignmentId, map })
                            : vetoUebersteuernAction({ csrfToken, assignmentId: raum.assignmentId, map }),
                        `${map} ${veto.naechster?.kind === 'BAN' ? 'gebannt' : 'gewählt'}.`,
                      )
                    }
                  >
                    {laeuft === map ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    {map}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {veto.gebannt.length > 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Gebannt: {veto.gebannt.join(', ')}</p>
          ) : null}

          {darfSteuern && veto.naechster?.kind === 'DECIDER' ? (
            <Button
              className="mt-4"
              disabled={laeuft !== null}
              onClick={() =>
                void fuehreAus(
                  'abschliessen',
                  () => vetoAbschliessenAction({ csrfToken, assignmentId: raum.assignmentId }),
                  'Veto abgeschlossen.',
                )
              }
            >
              {laeuft === 'abschliessen' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Veto abschliessen
            </Button>
          ) : null}
        </Panel>
      ) : null}

      {darfSteuern ? (
        <Panel
          title="Match Control"
          icon="Gavel"
          description="Feste Aktionen - keine Serverkonsole. Jede steht im Protokoll."
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={laeuft !== null}
              onClick={() =>
                void fuehreAus(
                  'PAUSE',
                  () =>
                    matchAktionAction({
                      csrfToken,
                      assignmentId: raum.assignmentId,
                      aktion: 'PAUSE',
                      runde: null,
                    }),
                  'Match pausiert.',
                )
              }
            >
              Pause
            </Button>
            <Button
              variant="outline"
              disabled={laeuft !== null}
              onClick={() =>
                void fuehreAus(
                  'UNPAUSE',
                  () =>
                    matchAktionAction({
                      csrfToken,
                      assignmentId: raum.assignmentId,
                      aktion: 'UNPAUSE',
                      runde: null,
                    }),
                  'Match läuft weiter.',
                )
              }
            >
              Fortsetzen
            </Button>
            <Button variant="destructive" disabled={laeuft !== null} onClick={() => setFrage('RESTART')}>
              Match neu starten
            </Button>
            <Button
              variant="destructive"
              disabled={laeuft !== null}
              onClick={() => setFrage('SERVER_RESTART')}
            >
              Server neu starten
            </Button>
          </div>
        </Panel>
      ) : null}

      {raum.dateien.length > 0 ? (
        <Panel title="Dateien" icon="Database" description="Gesichert, bevor der Server entfernt wurde.">
          <ul className="space-y-1 text-sm">
            {raum.dateien.map((datei) => (
              <li key={datei.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">{dateiArt(datei.kind)}</Badge>
                  {datei.remoteName}
                  {datei.mapIndex === null ? '' : ` (Map ${datei.mapIndex})`}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(datei.sizeBytes / 1024 / 1024)} MB
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <ConfirmationDialog
        open={frage !== null}
        onOpenChange={(offen) => !offen && setFrage(null)}
        title={frage === 'SERVER_RESTART' ? 'Server neu starten?' : 'Match neu starten?'}
        description={
          frage === 'SERVER_RESTART'
            ? 'Der Spielserver startet neu. Alle Spieler fliegen kurz heraus und müssen sich neu verbinden.'
            : 'Das laufende Match beginnt von vorn. Der bisherige Punktestand ist weg.'
        }
        confirmLabel="Neu starten"
        destructive
        onConfirm={() =>
          frage
            ? void fuehreAus(
                frage,
                () =>
                  matchAktionAction({
                    csrfToken,
                    assignmentId: raum.assignmentId,
                    aktion: frage,
                    runde: null,
                  }),
                'Neustart ausgelöst.',
              )
            : undefined
        }
      />
    </div>
  );
}

function dateiArt(kind: string): string {
  switch (kind) {
    case 'DEMO':
      return 'Demo';
    case 'SERVER_LOG':
      return 'Server-Log';
    default:
      return 'Matchdaten';
  }
}

function Wert({ name, wert, gross }: { name: string; wert: string; gross?: boolean }): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{name}</dt>
      <dd className={gross ? 'font-mono text-base font-medium' : 'font-medium'}>{wert}</dd>
    </div>
  );
}
