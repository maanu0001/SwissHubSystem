'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { missions } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { missionAbbrechenAction, missionAusVorlageAction } from '@/modules/missions/actions';
import { MissionsFormular, type TypAuswahl } from './missions-formular';

export interface VerwaltungsVorlage {
  id: string;
  name: string;
  art: string;
  titel: string;
  ziel: number;
}

/**
 * Die Liste der Missionen, mit den beiden Wegen, eine neue anzulegen.
 *
 * ## Warum die Vorlagen oben stehen
 *
 * Weil das der Weg ist, der «unter einer Minute» moeglich macht: ein Klick
 * auf eine Vorlage legt die Mission fuer die laufende Missionswoche an,
 * ohne ein einziges Feld. Das ausfuehrliche Formular steht darunter - es
 * ist die Ausnahme, nicht der Regelfall, und soll auch so aussehen.
 */
export function MissionsVerwaltung({
  missionen,
  vorlagen,
  typen,
  csrfToken,
}: {
  missionen: missions.MissionsAnsicht[];
  vorlagen: VerwaltungsVorlage[];
  typen: TypAuswahl[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [abzubrechen, setAbzubrechen] = useState<missions.MissionsAnsicht | null>(null);

  async function ausVorlage(vorlageId: string): Promise<void> {
    setLaeuft(vorlageId);
    const antwort = await missionAusVorlageAction({ csrfToken, vorlageId });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Mission läuft.');
    router.refresh();
  }

  async function brichAb(): Promise<void> {
    if (!abzubrechen) {
      return;
    }
    setLaeuft(abzubrechen.id);
    const antwort = await missionAbbrechenAction({ csrfToken, missionId: abzubrechen.id });
    setLaeuft(null);
    setAbzubrechen(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Mission abgebrochen. Es wurde nichts belohnt.');
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Aus einer Vorlage starten</h2>
        {vorlagen.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Vorlage. Unter «Vorlagen» legst du eine an - danach ist eine Mission ein Klick.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vorlagen.map((vorlage) => (
              <Button
                key={vorlage.id}
                variant="outline"
                // Grosse Flaeche: auf einem Telefon ist das der meistgenutzte
                // Knopf des ganzen Moduls.
                className="h-auto min-h-12 flex-col items-start gap-0.5 py-2 text-left"
                disabled={laeuft !== null}
                onClick={() => void ausVorlage(vorlage.id)}
              >
                <span className="flex items-center gap-2 font-medium">
                  {laeuft === vorlage.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {vorlage.name}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {vorlage.art === 'CHALLENGE' ? 'Challenge' : 'Wochenmission'} · Ziel {vorlage.ziel}
                </span>
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Missionen</h2>
        {missionen.length === 0 ? (
          <EmptyState
            title="Noch keine Mission"
            description="Starte eine aus einer Vorlage oder lege unten eine eigene an."
          />
        ) : (
          <ul className="space-y-2">
            {missionen.map((mission) => (
              <li
                key={mission.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{mission.titel}</span>
                    <Badge variant={statusFarbe(mission.status)}>{statusText(mission.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {mission.art === 'CHALLENGE' ? 'Community Challenge' : 'Wochenmission'} ·{' '}
                    {mission.typLabel} · Ziel {mission.ziel} {mission.einheit} · {mission.teilnehmende} machen
                    mit
                  </p>
                </div>
                {mission.status === 'LAEUFT' || mission.status === 'GEPLANT' ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={laeuft !== null}
                    onClick={() => setAbzubrechen(mission)}
                  >
                    Abbrechen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Eigene Mission anlegen</h2>
        <MissionsFormular typen={typen} csrfToken={csrfToken} />
      </section>

      <ConfirmationDialog
        open={abzubrechen !== null}
        onOpenChange={(offen) => !offen && setAbzubrechen(null)}
        title="Mission abbrechen?"
        description={
          abzubrechen
            ? `«${abzubrechen.titel}» wird beendet, ohne dass jemand belohnt wird. Der Fortschritt bleibt sichtbar. Das lässt sich nicht zurücknehmen.`
            : ''
        }
        confirmLabel="Abbrechen"
        destructive
        onConfirm={() => void brichAb()}
      />
    </div>
  );
}

function statusText(status: string): string {
  switch (status) {
    case 'LAEUFT':
      return 'Läuft';
    case 'GEPLANT':
      return 'Geplant';
    case 'ABGESCHLOSSEN':
      return 'Abgeschlossen';
    case 'ABGEBROCHEN':
      return 'Abgebrochen';
    default:
      return 'Entwurf';
  }
}

function statusFarbe(status: string): 'default' | 'secondary' | 'success' | 'outline' | 'destructive' {
  switch (status) {
    case 'LAEUFT':
      return 'default';
    case 'ABGESCHLOSSEN':
      return 'success';
    case 'ABGEBROCHEN':
      return 'destructive';
    default:
      return 'outline';
  }
}
