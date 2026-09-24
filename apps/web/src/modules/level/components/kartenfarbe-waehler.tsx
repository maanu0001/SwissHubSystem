'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import {
  PRESTIGE_TEXTFARBE,
  STANDARD_TEXTFARBE,
  normalisiereTextfarbe,
  pruefeKartenkontrast,
  renderLevelCardSvg,
} from '@swisshub/modules/level/karte';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setCustomCardTextColorAction } from '@/modules/level/actions';
import { cn } from '@/lib/utils';

/**
 * Die Textfarbe der eigenen Levelkarte.
 *
 * ## Warum die Vorschau dieselbe Karte ist
 *
 * `renderLevelCardSvg` ist genau die Funktion, die der Bot aufruft, bevor er
 * das SVG zu PNG rastert - sie steht als client-sicherer Einstiegspunkt zur
 * Verfuegung und rechnet nur (XP-Kurve, Schriftmasse, Farbpruefung). Was hier
 * im Browser steht, ist damit nicht eine Nachbildung der Karte, sondern die
 * Karte. Eine in CSS nachgebaute Vorschau waere die Stelle, an der gewaehlte
 * Farbe und ausgelieferte Karte auseinanderlaufen.
 *
 * ## Warum die Farbe nicht korrigiert wird
 *
 * Bei schwachem Kontrast steht hier eine Warnung - und sonst nichts. Die
 * Farbe wird genau so gespeichert, wie sie gewaehlt wurde. Eine Oberflaeche,
 * die die eigene Eingabe stillschweigend durch eine besser lesbare ersetzt,
 * ist schlimmer als eine schlecht lesbare Karte: beim naechsten Mal weiss
 * niemand mehr, was er eigentlich eingestellt hat.
 */

/** Ein paar Farben, die auf der Karte erfahrungsgemäss gut wirken. */
const VORSCHLAEGE: Array<{ farbe: string; name: string }> = [
  { farbe: STANDARD_TEXTFARBE, name: 'Weiss' },
  { farbe: PRESTIGE_TEXTFARBE, name: 'Gold' },
  { farbe: '#FF6B6B', name: 'Koralle' },
  { farbe: '#FF9F1C', name: 'Orange' },
  { farbe: '#4ADE80', name: 'Grün' },
  { farbe: '#38BDF8', name: 'Himmelblau' },
  { farbe: '#C084FC', name: 'Violett' },
  { farbe: '#F5D0FE', name: 'Rosé' },
];

export function KartenfarbeWaehler({
  csrfToken,
  anzeigename,
  xp,
  rang,
  akzentfarbe,
  gespeichert,
}: {
  csrfToken: string;
  anzeigename: string;
  xp: number;
  rang: number;
  akzentfarbe: string;
  /** Die gespeicherte Farbe - `null` heisst Standardfarbe. */
  gespeichert: string | null;
}): React.JSX.Element {
  const router = useRouter();
  /*
   * Zwei Zustaende, und der Unterschied ist der Punkt.
   *
   * `eingabe` ist, was im Feld steht - auch mitten im Tippen, wenn daraus
   * noch keine Farbe geworden ist. `entwurf` ist die letzte Eingabe, die
   * eine Farbe *war*.
   *
   * Die Gueltigkeit wird deshalb an `eingabe` gemessen: waere es `entwurf`,
   * stuende beim Tippen von «rot» weiterhin die Kontrastangabe der vorigen
   * Farbe unter dem Feld - eine Auskunft ueber etwas, das gar nicht mehr im
   * Feld steht.
   *
   * Die Vorschau zeigt dagegen `entwurf`: eine Karte, die bei jedem
   * Zwischenstand auf Weiss zurueckspringt, flackert nur.
   */
  const [entwurf, setEntwurf] = useState(gespeichert ?? STANDARD_TEXTFARBE);
  const [eingabe, setEingabe] = useState(gespeichert ?? STANDARD_TEXTFARBE);
  const [laeuft, setLaeuft] = useState<'speichern' | 'zuruecksetzen' | null>(null);

  const gueltig = normalisiereTextfarbe(eingabe);
  const kontrast = useMemo(() => (gueltig ? pruefeKartenkontrast(gueltig) : null), [gueltig]);

  const svg = useMemo(
    () =>
      renderLevelCardSvg({
        displayName: anzeigename,
        xp,
        rank: rang,
        accentColor: akzentfarbe,
        textColor: entwurf,
      }),
    [anzeigename, xp, rang, akzentfarbe, entwurf],
  );

  const unveraendert = (gespeichert ?? STANDARD_TEXTFARBE) === gueltig;

  async function uebernehmen(farbe: string | null): Promise<void> {
    setLaeuft(farbe === null ? 'zuruecksetzen' : 'speichern');
    const antwort = await setCustomCardTextColorAction({ csrfToken, farbe });
    setLaeuft(null);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    if (farbe === null) {
      setEntwurf(STANDARD_TEXTFARBE);
      setEingabe(STANDARD_TEXTFARBE);
      toast.success('Zurückgesetzt. Es gilt wieder die Standardfarbe.');
    } else {
      toast.success('Textfarbe gespeichert. Sie gilt ab der nächsten Karte auf Discord.');
    }
    router.refresh();
  }

  /** Übernimmt eine Eingabe, sobald sie eine Farbe ergibt. */
  function tippen(wert: string): void {
    setEingabe(wert);
    const normalisiert = normalisiereTextfarbe(wert);
    if (normalisiert) {
      setEntwurf(normalisiert);
    }
  }

  function waehlen(farbe: string): void {
    setEntwurf(farbe);
    setEingabe(farbe);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div>
        <p className="text-sm font-semibold">Textfarbe der Level-Card</p>
        <p className="text-xs text-muted-foreground">
          Gilt für alle Texte der Karte - Name, Level, Rang, XP und Fortschritt. Die Vorschau ist dieselbe
          Karte, die Discord bekommt; nur die Schrift kann dein Browser anders zeichnen.
        </p>
      </div>

      {/* Die Vorschau: dasselbe SVG, das der Bot rastert. */}
      <div
        className="overflow-hidden rounded-lg border border-border [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        /*
         * Die Zeichenkette kommt aus `renderLevelCardSvg` und aus keiner
         * anderen Quelle. Der einzige veraenderliche Teil darin ist der
         * Anzeigename, und den maskiert die Karte selbst (`escapeXml`); die
         * Farbe hat `normalisiereTextfarbe` vorher auf `#RRGGBB` gebracht.
         */
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border">
          <span className="sr-only">Farbe wählen</span>
          <input
            type="color"
            value={entwurf}
            onChange={(ereignis) => waehlen(ereignis.target.value.toUpperCase())}
            // Das Systemfeld selbst ist unsichtbar; sichtbar ist die Fläche
            // darunter. Sonst sähe der Wähler auf jedem Betriebssystem anders aus.
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0"
            aria-label="Textfarbe wählen"
          />
        </label>

        <Input
          value={eingabe}
          onChange={(ereignis) => tippen(ereignis.target.value)}
          // Beim Verlassen des Feldes bleibt stehen, was zuletzt eine Farbe war.
          onBlur={() => setEingabe(entwurf)}
          spellCheck={false}
          aria-label="Farbe als Hex-Wert"
          aria-invalid={gueltig === null}
          className={cn('w-32 font-mono uppercase', gueltig === null && 'border-destructive')}
          placeholder="#FF9F1C"
        />

        <Button
          type="button"
          size="sm"
          disabled={laeuft !== null || gueltig === null || unveraendert}
          onClick={() => void uebernehmen(gueltig)}
        >
          {laeuft === 'speichern' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Speichern
        </Button>

        {gespeichert ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={laeuft !== null}
            onClick={() => void uebernehmen(null)}
          >
            {laeuft === 'zuruecksetzen' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            Zurücksetzen
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {VORSCHLAEGE.map((vorschlag) => (
          <button
            key={vorschlag.farbe}
            type="button"
            onClick={() => waehlen(vorschlag.farbe)}
            title={`${vorschlag.name} (${vorschlag.farbe})`}
            aria-label={`${vorschlag.name}, ${vorschlag.farbe}`}
            aria-pressed={entwurf === vorschlag.farbe}
            className={cn(
              'size-7 rounded-full border transition',
              entwurf === vorschlag.farbe
                ? 'border-primary-bright ring-2 ring-primary-bright/40'
                : 'border-border hover:border-primary/60',
            )}
            style={{ backgroundColor: vorschlag.farbe }}
          />
        ))}
      </div>

      {gueltig === null ? (
        <p className="text-xs text-destructive">
          Das ist keine gültige Farbe. Erwartet wird ein Hex-Wert wie #FF9F1C.
        </p>
      ) : kontrast?.hinweis ? (
        <p
          className={cn(
            'flex items-start gap-1.5 text-xs',
            kontrast.stufe === 'kritisch' ? 'text-destructive' : 'text-warning',
          )}
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{kontrast.hinweis}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Kontrast {kontrast?.verhaeltnis ?? '-'}:1 - gut lesbar.
        </p>
      )}
    </div>
  );
}
