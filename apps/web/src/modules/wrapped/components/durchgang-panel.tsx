'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Loader2, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  wrappedDurchgangAbbrechenAction,
  wrappedMomentaufnahmenStartenAction,
} from '@/modules/wrapped/aktionen';

/**
 * Die Momentaufnahmen erzeugen.
 *
 * ## Warum hier nur ein Knopf steht
 *
 * Die Arbeit macht der Bot. Dieses Feld bestellt sie und zeigt, wie weit
 * sie ist - mehr nicht. Ein Durchgang ueber mehrere tausend Mitglieder
 * darf nicht am geoeffneten Browserfenster haengen; wer die Seite schliesst,
 * soll nichts kaputtmachen.
 *
 * ## Warum es sich selbst nachlaedt
 *
 * Solange etwas laeuft, fragt die Seite alle fuenf Sekunden nach. Das ist
 * haeufig genug, dass der Balken lebt, und selten genug, dass es niemandem
 * auffaellt. Steht der Durchgang still, hoert das Nachfragen auf - ein Tab,
 * der stundenlang im Hintergrund pollt, ist eine Unart.
 */
export function DurchgangPanel({
  campaignId,
  lauf,
  kandidaten,
  snapshots,
  csrfToken,
  darfErzeugen,
  gesperrt,
}: {
  campaignId: string;
  lauf: {
    id: string;
    status: string;
    total: number;
    processed: number;
    created: number;
    skipped: number;
    failed: number;
    /** Warum er gescheitert ist - nur bei `FAILED` gesetzt. */
    grund: string | null;
    /**
     * Wie lange er schon auf den Bot wartet, in Sekunden.
     *
     * Serverseitig gerechnet, damit die Anzeige nicht von der Uhr des
     * Browsers abhaengt. `null`, sobald der Bot ihn aufgenommen hat.
     */
    wartetSeit: number | null;
  } | null;
  kandidaten: number;
  snapshots: number;
  csrfToken: string;
  darfErzeugen: boolean;
  /** Veroeffentlicht oder archiviert - dann laeuft nichts mehr. */
  gesperrt: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const aktiv = lauf !== null && (lauf.status === 'QUEUED' || lauf.status === 'RUNNING');

  useEffect(() => {
    if (!aktiv) {
      return;
    }
    const takt = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(takt);
  }, [aktiv, router]);

  async function fuehreAus(
    name: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const antwort = await aktion();
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  const anteil = lauf && lauf.total > 0 ? Math.min(1, lauf.processed / lauf.total) : 0;

  /*
   * Wann aus «wartet» ein «da stimmt etwas nicht» wird.
   *
   * Der Takt des Bots laeuft jede Minute. Nach fuenf Minuten in der
   * Warteschlange hat ihn also fuenfmal niemand geholt - dann laeuft der Bot
   * nicht, oder das Modul ist dort aus. Vorher stand hier nur «Wartet auf den
   * Bot», und zwar auch nach drei Tagen noch: der Knopf meldete Erfolg, es
   * geschah nichts, und nichts sagte warum.
   */
  const langeInWarteschlange = lauf?.status === 'QUEUED' && (lauf.wartetSeit ?? 0) > 300;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kennzahl label="Momentaufnahmen" wert={snapshots} />
        <Kennzahl label="Kandidaten" wert={kandidaten} />
        <Kennzahl label="Übersprungen" wert={lauf?.skipped ?? 0} />
        <Kennzahl label="Gescheitert" wert={lauf?.failed ?? 0} betont={(lauf?.failed ?? 0) > 0} />
      </dl>

      {lauf ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              {lauf.status === 'RUNNING'
                ? 'Läuft'
                : lauf.status === 'QUEUED'
                  ? 'Wartet auf den Bot'
                  : lauf.status === 'COMPLETED'
                    ? 'Abgeschlossen'
                    : lauf.status === 'CANCELLED'
                      ? 'Abgebrochen'
                      : 'Gescheitert'}
            </span>
            <span className="tabular-nums">
              {lauf.processed} / {lauf.total}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={lauf.total}
            aria-valuenow={lauf.processed}
            aria-label="Fortschritt des Durchgangs"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.round(anteil * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {lauf?.status === 'FAILED' ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Der Durchgang ist gescheitert.</span>{' '}
            {lauf.grund ?? 'Ein Grund wurde nicht festgehalten.'} Ein neuer Start beginnt von vorn.
          </span>
        </p>
      ) : null}

      {langeInWarteschlange ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Der Durchgang wartet seit {Math.round((lauf?.wartetSeit ?? 0) / 60)} Minuten auf den Bot. Die
            Arbeit macht der Bot, nicht diese Seite - laeuft er nicht oder ist das Wrapped-Modul dort
            abgeschaltet, bleibt es dabei.
          </span>
        </p>
      ) : null}

      {darfErzeugen && !gesperrt ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              void fuehreAus(
                'start',
                () => wrappedMomentaufnahmenStartenAction({ csrfToken, campaignId }),
                'Durchgang bestellt - der Bot beginnt gleich.',
              )
            }
            disabled={laeuft !== null || aktiv}
          >
            {laeuft === 'start' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {snapshots > 0 ? 'Neu erzeugen' : 'Momentaufnahmen erzeugen'}
          </Button>

          {aktiv && lauf ? (
            <Button
              variant="ghost"
              onClick={() =>
                void fuehreAus(
                  'stop',
                  () => wrappedDurchgangAbbrechenAction({ csrfToken, campaignId, runId: lauf.id }),
                  'Durchgang abgebrochen.',
                )
              }
              disabled={laeuft !== null}
            >
              <Square className="size-4" aria-hidden="true" />
              Abbrechen
            </Button>
          ) : null}
        </div>
      ) : null}

      {gesperrt ? (
        <p className="text-xs text-muted-foreground">
          Für einen veröffentlichten Rückblick lassen sich die Momentaufnahmen nicht neu erzeugen - sie stehen
          bereits.
        </p>
      ) : null}
    </div>
  );
}

function Kennzahl({
  label,
  wert,
  betont,
}: {
  label: string;
  wert: number;
  betont?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${betont ? 'text-destructive' : ''}`}>{wert}</dd>
    </div>
  );
}
