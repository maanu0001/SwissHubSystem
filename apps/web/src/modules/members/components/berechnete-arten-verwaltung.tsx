'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Calculator, Power, RotateCcw, Save } from 'lucide-react';
import { NavIcon } from '@/components/layout/nav-icon';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  berechneteAuszeichnungAbschaltenAction,
  berechneteAuszeichnungBearbeitenAction,
  berechneteAuszeichnungZuruecksetzenAction,
  berechneteAuszeichnungZurueckholenAction,
} from '@/modules/members/auszeichnungs-aktionen';

/**
 * Die gerechneten Auszeichnungen verwalten.
 *
 * ## Was hier fehlt, und warum
 *
 * Kein «Anlegen» und kein «Verleihen». Eine gerechnete Auszeichnung
 * entsteht daraus, dass jemand ein Turnier gewinnt - nicht daraus, dass ein
 * Admin einen Haken setzt. Wer das aufweicht, hat ein Profil, das Erfolge
 * zeigt, die die Daten nicht hergeben.
 *
 * Kein «Loeschen» im Wortsinn: die Regel steht im Code, sie laesst sich
 * hier nicht entfernen. Was es gibt, ist **Abschalten** - sie wird nicht
 * mehr gerechnet und erscheint in keinem Profil. Dabei geht nichts
 * verloren, denn gespeichert war nie etwas: die Auszeichnung entsteht bei
 * jeder Anzeige neu.
 *
 * ## Warum der Schwellenwert ein Zahlenfeld ist
 *
 * Weil mehr nicht einstellbar sein soll. Was gezaehlt wird - Turniersiege,
 * Level, erhaltene Stimmen - steht daneben als Text und kommt aus dem Code.
 * Ein Feld, in dem sich die Bedingung selbst schreiben liesse, waere eine
 * Ausfuehrungsumgebung in einem Textfeld.
 */
export interface BerechneteArt {
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: 'bronze' | 'silber' | 'gold';
  aktiv: boolean;
  archiviert: boolean;
  schwelleEinstellbar: boolean;
  schwelle: number | null;
  schwelleVorgabe: number | null;
  messwert: string | null;
  einheit: string | null;
  angepasst: boolean;
}

const STUFEN = [
  { wert: 'bronze', label: 'Bronze' },
  { wert: 'silber', label: 'Silber' },
  { wert: 'gold', label: 'Gold' },
] as const;

export function BerechneteArtenVerwaltung({
  csrfToken,
  symbole,
  arten,
}: {
  csrfToken: string;
  symbole: string[];
  arten: BerechneteArt[];
}): React.JSX.Element {
  const [offen, setOffen] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="size-4" aria-hidden="true" />
          Gerechnete Auszeichnungen
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Diese {arten.length} entstehen aus echten Daten - Turnieren, Clip-Runden, dem Level, dem
          Beitrittsdatum. Bezeichnung, Symbol, Stufe und Schwellenwert lassen sich ändern; vergeben lassen
          sie sich nicht, und genau das ist ihr Wert: sie stimmen.
        </p>
      </div>

      <ul className="space-y-2">
        {arten.map((art) => (
          <li
            key={art.key}
            className={`rounded-lg border px-3 py-2.5 ${
              art.aktiv ? 'border-border' : 'border-dashed border-border bg-secondary/30'
            }`}
          >
            <Zeile
              art={art}
              csrfToken={csrfToken}
              symbole={symbole}
              offen={offen === art.key}
              aufKlappen={() => setOffen(offen === art.key ? null : art.key)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Zeile({
  art,
  csrfToken,
  symbole,
  offen,
  aufKlappen,
}: {
  art: BerechneteArt;
  csrfToken: string;
  symbole: string[];
  offen: boolean;
  aufKlappen: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [entwurf, setEntwurf] = useState({
    label: art.label,
    beschreibung: art.beschreibung,
    symbol: art.symbol,
    stufe: art.stufe as 'bronze' | 'silber' | 'gold',
    schwelle: art.schwelle,
  });

  async function rufe(
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(true);
    const antwort = await aktion();
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">
          <NavIcon name={art.symbol} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-sm font-medium">{art.label}</span>
            <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{art.stufe}</span>
            {!art.aktiv ? (
              <span className="text-[0.7rem] text-warning">abgeschaltet</span>
            ) : art.angepasst ? (
              <span className="text-[0.7rem] text-muted-foreground">angepasst</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{art.beschreibung}</p>
          {art.messwert ? (
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              Zählt: {art.messwert}
              {art.schwelle !== null ? ` · ab ${art.schwelle} ${art.einheit ?? ''}`.trimEnd() : ''}
            </p>
          ) : (
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              Ja-Nein-Merkmal - hier gibt es keinen Schwellenwert.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={aufKlappen} disabled={laeuft}>
          {offen ? 'Schliessen' : 'Bearbeiten'}
        </Button>
      </div>

      {offen ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`label-${art.key}`}>Bezeichnung</Label>
              <Input
                id={`label-${art.key}`}
                value={entwurf.label}
                maxLength={60}
                onChange={(e) => setEntwurf({ ...entwurf, label: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`stufe-${art.key}`}>Stufe</Label>
              <Select
                value={entwurf.stufe}
                onValueChange={(wert) =>
                  setEntwurf({ ...entwurf, stufe: wert as 'bronze' | 'silber' | 'gold' })
                }
              >
                <SelectTrigger id={`stufe-${art.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STUFEN.map((stufe) => (
                    <SelectItem key={stufe.wert} value={stufe.wert}>
                      {stufe.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`text-${art.key}`}>Beschreibung</Label>
            <Textarea
              id={`text-${art.key}`}
              value={entwurf.beschreibung}
              maxLength={200}
              rows={2}
              onChange={(e) => setEntwurf({ ...entwurf, beschreibung: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`symbol-${art.key}`}>Symbol</Label>
              <Select value={entwurf.symbol} onValueChange={(wert) => setEntwurf({ ...entwurf, symbol: wert })}>
                <SelectTrigger id={`symbol-${art.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {symbole.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {art.schwelleEinstellbar ? (
              <div className="space-y-1.5">
                <Label htmlFor={`schwelle-${art.key}`}>
                  Schwellenwert{art.einheit ? ` (${art.einheit})` : ''}
                </Label>
                <Input
                  id={`schwelle-${art.key}`}
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={entwurf.schwelle ?? ''}
                  onChange={(e) =>
                    setEntwurf({ ...entwurf, schwelle: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
                <p className="text-[0.7rem] text-muted-foreground">
                  Vorgabe: {art.schwelleVorgabe}. Zählt wird {art.messwert} - das legt der Code fest.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={laeuft}
              onClick={() =>
                void rufe(
                  () =>
                    berechneteAuszeichnungBearbeitenAction({
                      csrfToken,
                      key: art.key,
                      label: entwurf.label,
                      beschreibung: entwurf.beschreibung,
                      symbol: entwurf.symbol,
                      stufe: entwurf.stufe,
                      schwelle: art.schwelleEinstellbar ? entwurf.schwelle : null,
                      aktiv: art.aktiv,
                    }),
                  'Gespeichert.',
                )
              }
            >
              <Save className="size-4" aria-hidden="true" />
              Speichern
            </Button>

            {art.aktiv ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={laeuft}
                onClick={() => {
                  if (
                    !window.confirm(
                      `«${art.label}» wird nicht mehr gerechnet und verschwindet aus allen Profilen. Sie lässt sich jederzeit wieder einschalten - es geht dabei nichts verloren. Trotzdem?`,
                    )
                  ) {
                    return;
                  }
                  void rufe(
                    () => berechneteAuszeichnungAbschaltenAction({ csrfToken, key: art.key }),
                    'Abgeschaltet.',
                  );
                }}
              >
                <Power className="size-4" aria-hidden="true" />
                Abschalten
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={laeuft}
                onClick={() =>
                  void rufe(
                    () => berechneteAuszeichnungZurueckholenAction({ csrfToken, key: art.key }),
                    'Wieder aktiv.',
                  )
                }
              >
                <Power className="size-4" aria-hidden="true" />
                Wieder einschalten
              </Button>
            )}

            {art.angepasst ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={laeuft}
                onClick={() =>
                  void rufe(
                    () => berechneteAuszeichnungZuruecksetzenAction({ csrfToken, key: art.key }),
                    'Auf die Vorgabe zurückgesetzt.',
                  )
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Zurücksetzen
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
