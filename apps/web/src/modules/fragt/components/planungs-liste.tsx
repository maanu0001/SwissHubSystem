'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/states';
import {
  fragtPlanenAction,
  fragtPlanungAufhebenAction,
  fragtVeroeffentlichenAction,
} from '@/modules/fragt/actions';

export interface PlanbareFrage {
  id: string;
  text: string;
  kategorie: string;
  geplantAnzeige: string | null;
}

/**
 * Termine zuweisen und aufheben.
 *
 * ## Warum ein Termin und kein Wiederholungsmuster
 *
 * Das Muster steht in den Moduleinstellungen - «Freitag 18:00». Was hier
 * zugewiesen wird, ist die Antwort auf «welche Frage kommt an diesem Termin»,
 * und die ist einmalig. Ein zweites Wiederholungsmuster je Frage waere ein
 * zweiter Zeitplan neben dem bestehenden.
 *
 * ## Warum ein geplanter Termin die Automatik schlaegt
 *
 * Weil jemand entschieden hat. Die automatische Auswahl ist der Ersatz fuer
 * fehlende Planung, nicht ihre Korrektur - das entscheidet `waehleFrage` im
 * Modul, hier steht nur der Hinweis darauf.
 */
export function PlanungsListe({
  csrfToken,
  geplant,
  freigegeben,
  darfVeroeffentlichen,
  laufendeAbstimmung,
  naechsterTermin,
}: {
  /** Der CSRF-Token der Sitzung - jede Server Action verlangt ihn. */
  csrfToken: string;
  geplant: PlanbareFrage[];
  freigegeben: PlanbareFrage[];
  darfVeroeffentlichen: boolean;
  laufendeAbstimmung: boolean;
  naechsterTermin: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState('');
  const [termin, setTermin] = useState('');
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function plane(): Promise<void> {
    if (!auswahl || !termin) {
      return;
    }
    setLaeuft('plan');
    const antwort = await fragtPlanenAction({
      csrfToken,
      frageId: auswahl,
      // `datetime-local` liefert Ortszeit ohne Zone - der Browser rechnet sie
      // hier in UTC um, und der Server bekommt einen eindeutigen Zeitpunkt.
      termin: new Date(termin).toISOString(),
    });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Termin zugewiesen.');
    setAuswahl('');
    setTermin('');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="font-semibold">Termin zuweisen</h3>
        </div>
        {naechsterTermin ? (
          <p className="text-sm text-muted-foreground">
            Der nächste automatische Termin ist {naechsterTermin}. Eine hier geplante Frage hat Vorrang vor
            der automatischen Auswahl.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Die automatische Veröffentlichung ist aus - geplante Fragen werden erst gestellt, wenn du sie in
            den Einstellungen einschaltest oder sie von Hand stellst.
          </p>
        )}

        {freigegeben.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine freigegebene Frage vorhanden. Gib zuerst eine Frage in der Bibliothek frei.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="fragt-plan-frage">Frage</Label>
              <select
                id="fragt-plan-frage"
                value={auswahl}
                onChange={(ereignis) => setAuswahl(ereignis.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Bitte wählen ...</option>
                {freigegeben.map((frage) => (
                  <option key={frage.id} value={frage.id}>
                    {frage.text}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fragt-plan-termin">Termin</Label>
              <Input
                id="fragt-plan-termin"
                type="datetime-local"
                value={termin}
                onChange={(ereignis) => setTermin(ereignis.target.value)}
              />
            </div>
            <Button disabled={!auswahl || !termin || laeuft === 'plan'} onClick={() => void plane()}>
              {laeuft === 'plan' ? <Loader2 className="size-4 animate-spin" /> : null}
              Planen
            </Button>
          </div>
        )}
      </div>

      {geplant.length === 0 ? (
        <EmptyState
          title="Nichts geplant"
          description="Ohne zugewiesenen Termin entscheidet der Auswahlmodus: «manuell» stellt keine Frage, «automatisch» nimmt eine freigegebene aus der Bibliothek."
        />
      ) : (
        <ul className="space-y-2">
          {geplant.map((frage) => (
            <li
              key={frage.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="break-words font-medium leading-tight">{frage.text}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {frage.geplantAnzeige} · {frage.kategorie}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {darfVeroeffentlichen ? (
                  <Button
                    size="sm"
                    disabled={laeuft === frage.id || laufendeAbstimmung}
                    title={laufendeAbstimmung ? 'Es läuft bereits eine Abstimmung.' : 'Jetzt stellen'}
                    onClick={async () => {
                      setLaeuft(frage.id);
                      const antwort = await fragtVeroeffentlichenAction({ csrfToken, frageId: frage.id });
                      setLaeuft(null);
                      if (!antwort.ok) {
                        toast.error(antwort.error.message);
                        return;
                      }
                      toast.success('Die Frage steht auf Discord.');
                      router.refresh();
                    }}
                  >
                    <Send className="size-4" />
                    Jetzt stellen
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={laeuft === frage.id}
                  onClick={async () => {
                    setLaeuft(frage.id);
                    const antwort = await fragtPlanungAufhebenAction({ csrfToken, frageId: frage.id });
                    setLaeuft(null);
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    router.refresh();
                  }}
                >
                  <X className="size-4" />
                  Termin lösen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
