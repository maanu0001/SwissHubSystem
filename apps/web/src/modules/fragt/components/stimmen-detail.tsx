'use client';

import { useMemo, useState } from 'react';
import { Search, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Wer für welche Antwort gestimmt hat.
 *
 * ## Warum als Tabelle und nicht als Liste je Antwort
 *
 * Der Auftrag lässt beides zu. Eine Tabelle passt hier besser, weil sie die
 * Frage beantwortet, die man tatsächlich stellt: «hat Anna abgestimmt, und
 * wofür?» Eine Gruppierung nach Antwort beantwortet die umgekehrte Frage -
 * die stellt sich seltener, und wer sie hat, filtert nach der Antwort und
 * bekommt dieselbe Gruppe.
 *
 * Die Zahlen je Antwort stehen als Leiste darüber, damit die Aufteilung
 * trotzdem auf einen Blick da ist. Sie ändern sich beim Filtern nicht -
 * sonst läse jemand aus einer gefilterten Liste ein Ergebnis heraus.
 *
 * ## Was diese Komponente nicht ist
 *
 * Kein Schutz. Sie bekommt die Zeilen nur, wenn die Seite vorher
 * `fragt.votes.detail` geprüft hat; ohne die Berechtigung werden sie gar
 * nicht erst geladen. Hätte sie eine eigene Bedingung, wäre das «das
 * Frontend versteckt es» - und die Namen stünden trotzdem im HTML.
 */

export interface StimmenZeileAnsicht {
  optionId: string;
  antwort: string;
  discordId: string;
  name: string | null;
  /** Bereits formatiert. */
  abgegebenAm: string;
  geaendert: boolean;
}

export function StimmenDetail({
  zeilen,
  proAntwort,
}: {
  zeilen: StimmenZeileAnsicht[];
  proAntwort: Array<{ optionId: string; antwort: string; stimmen: number }>;
}): React.JSX.Element {
  const [antwort, setAntwort] = useState<string>('alle');
  const [suche, setSuche] = useState('');

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return zeilen.filter((zeile) => {
      if (antwort !== 'alle' && zeile.optionId !== antwort) {
        return false;
      }
      if (!begriff) {
        return true;
      }
      return (zeile.name ?? '').toLowerCase().includes(begriff) || zeile.discordId.includes(begriff);
    });
  }, [zeilen, antwort, suche]);

  if (zeilen.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Für diese Abstimmung wurde keine Stimme abgegeben.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={antwort === 'alle' ? 'default' : 'outline'}
          onClick={() => setAntwort('alle')}
        >
          Alle ({zeilen.length})
        </Button>
        {proAntwort.map((eintrag) => (
          <Button
            key={eintrag.optionId}
            type="button"
            size="sm"
            variant={antwort === eintrag.optionId ? 'default' : 'outline'}
            onClick={() => setAntwort(eintrag.optionId)}
          >
            {eintrag.antwort} ({eintrag.stimmen})
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="stimmen-suche" className="sr-only">
          Mitglied suchen
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="stimmen-suche"
            value={suche}
            placeholder="Name oder Discord-Kennung"
            onChange={(event) => setSuche(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {gefiltert.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Keine Stimme passt zu dieser Auswahl.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Mitglied
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Antwort
                </th>
                <th scope="col" className="py-2 font-medium">
                  Zeitpunkt
                </th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((zeile) => (
                <tr key={zeile.discordId} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    {zeile.name ? (
                      <span className="font-medium">{zeile.name}</span>
                    ) : (
                      /*
                        Wer nicht mehr im Abgleich steht, ist ausgetreten oder
                        gebannt. Die Stimme bleibt gezaehlt - sie wurde
                        abgegeben, und eine Auswertung, aus der Stimmen
                        verschwinden, sobald jemand geht, waere keine. Was
                        bleibt, ist die Kennung; einen Namen zu erfinden waere
                        schlimmer als keiner.
                      */
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <UserX className="size-3.5 shrink-0" aria-hidden="true" />
                        Nicht mehr auf dem Server
                      </span>
                    )}
                    <span className="block font-mono text-[0.7rem] text-muted-foreground">
                      {zeile.discordId}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{zeile.antwort}</td>
                  <td className="py-2 text-muted-foreground">
                    <span className="tabular-nums">{zeile.abgegebenAm}</span>
                    {zeile.geaendert ? (
                      <Badge variant="outline" className="ml-2">
                        geändert
                      </Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Diese Aufstellung ist ausschliesslich hier sichtbar. Im Kanal und in jeder öffentlichen Auswertung
        bleiben die Ergebnisse zusammengefasst und ohne Namen.
      </p>
    </div>
  );
}
