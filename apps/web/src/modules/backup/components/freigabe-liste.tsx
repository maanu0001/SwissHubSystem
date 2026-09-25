'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { restoreFreigebenAction, restoreZurueckziehenAction } from '@/modules/backup/actions';

export interface FreigabeAnzeige {
  id: string;
  umfangLabel: string;
  zielZeitpunkt: string | null;
  begruendung: string;
  angefordertVon: string;
  angefordertVonName: string | null;
  angefordertAm: string;
  freigegebenVonName: string | null;
  freigegebenAm: string | null;
  gueltigBis: string;
  status: string;
  jetztGueltig: boolean;
  /** Der Befehl, der nach der Freigabe auszufuehren ist. */
  befehl: string;
}

const STATUS_VARIANTE: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  ANGEFORDERT: 'warning',
  FREIGEGEBEN: 'success',
  ABGELEHNT: 'secondary',
  VERWENDET: 'default',
  ABGELAUFEN: 'secondary',
};

const STATUS_TEXT: Record<string, string> = {
  ANGEFORDERT: 'Wartet auf zweite Person',
  FREIGEGEBEN: 'Freigegeben',
  ABGELEHNT: 'Zurückgezogen',
  VERWENDET: 'Verwendet',
  ABGELAUFEN: 'Abgelaufen',
};

/**
 * Die Liste der Restore-Anforderungen.
 *
 * Der Knopf «Freigeben» erscheint nur, wenn der Betrachter freigeben DARF und
 * die Anforderung nicht seine eigene ist. Das ist Darstellung - die Pruefung
 * steht serverseitig, und ein Aufruf, der die Oberflaeche umgeht, wird dort
 * abgelehnt und protokolliert.
 */
export function FreigabeListe({
  freigaben,
  csrfToken,
  eigeneDiscordId,
  darfFreigeben,
}: {
  freigaben: FreigabeAnzeige[];
  csrfToken: string;
  eigeneDiscordId: string;
  darfFreigeben: boolean;
}): React.JSX.Element {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const router = useRouter();

  if (freigaben.length === 0) {
    return (
      <EmptyState
        title="Keine Restore-Anforderungen"
        description="Das ist der gute Zustand. Eine Anforderung entsteht nur, wenn jemand Daten verwerfen will."
      />
    );
  }

  const freigeben = async (id: string): Promise<void> => {
    setLaeuft(id);
    try {
      const antwort = await restoreFreigebenAction({ csrfToken, id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Freigabe hat nicht geklappt.');
        return;
      }
      toast.success('Freigegeben', {
        description:
          'Die Wiederherstellung darf jetzt auf der Kommandozeile ausgeführt werden. Der Befehl steht in der Zeile.',
      });
      router.refresh();
    } finally {
      setLaeuft(null);
    }
  };

  const zurueckziehen = async (id: string): Promise<void> => {
    setLaeuft(id);
    try {
      const antwort = await restoreZurueckziehenAction({ csrfToken, id, grund: '' });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das Zurückziehen hat nicht geklappt.');
        return;
      }
      toast.success('Zurückgezogen');
      router.refresh();
    } finally {
      setLaeuft(null);
    }
  };

  return (
    <ul className="space-y-3">
      {freigaben.map((freigabe) => {
        const eigene = freigabe.angefordertVon === eigeneDiscordId;
        const offen = freigabe.status === 'ANGEFORDERT';
        return (
          <li key={freigabe.id} className="rounded-lg border border-border/70 bg-card/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_VARIANTE[freigabe.status] ?? 'secondary'}>
                    {STATUS_TEXT[freigabe.status] ?? freigabe.status}
                  </Badge>
                  <span className="text-sm font-medium">{freigabe.umfangLabel}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {freigabe.zielZeitpunkt ?? 'jüngstmöglicher Stand'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Angefordert von {freigabe.angefordertVonName ?? freigabe.angefordertVon} am{' '}
                  {new Date(freigabe.angefordertAm).toLocaleString('de-CH')}
                  {freigabe.freigegebenAm
                    ? ` · freigegeben von ${freigabe.freigegebenVonName ?? '?'} am ${new Date(freigabe.freigegebenAm).toLocaleString('de-CH')}`
                    : ''}
                </p>
                <p className="text-sm">{freigabe.begruendung}</p>
                {offen ? (
                  <p className="text-xs text-muted-foreground">
                    Gültig bis {new Date(freigabe.gueltigBis).toLocaleString('de-CH')}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 gap-2">
                {offen && darfFreigeben && !eigene ? (
                  <Button
                    size="sm"
                    variant="default"
                    disabled={laeuft === freigabe.id}
                    onClick={() => freigeben(freigabe.id)}
                  >
                    {laeuft === freigabe.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="size-3.5" aria-hidden="true" />
                    )}
                    Freigeben
                  </Button>
                ) : null}
                {offen && eigene ? (
                  <span
                    className="self-center text-xs text-muted-foreground"
                    title="Eine eigene Anforderung kann man nicht selbst freigeben."
                  >
                    Wartet auf eine zweite Person
                  </span>
                ) : null}
                {offen || freigabe.status === 'FREIGEGEBEN' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={laeuft === freigabe.id}
                    onClick={() => zurueckziehen(freigabe.id)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Zurückziehen
                  </Button>
                ) : null}
              </div>
            </div>

            {freigabe.jetztGueltig ? (
              <div className="mt-3 rounded-lg border border-success/40 bg-success/5 p-3">
                <p className="text-xs font-medium text-success">Freigegeben. Auf dem Server auszuführen:</p>
                <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
                  {freigabe.befehl}
                </pre>
                <p className="mt-2 text-xs text-muted-foreground">
                  Das Werkzeug prüft diese Freigabe, bevor es die Produktion anfasst. Sie gilt einmalig und
                  läuft am {new Date(freigabe.gueltigBis).toLocaleString('de-CH')} ab.
                </p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
