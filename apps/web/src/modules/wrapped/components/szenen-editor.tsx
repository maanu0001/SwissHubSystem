'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, Loader2, RotateCcw } from 'lucide-react';
import { WRAPPED_SZENEN } from '@swisshub/modules/wrapped/szenen';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { wrappedSzenenSetzenAction } from '@/modules/wrapped/aktionen';
import type { SzenenBefund } from '@swisshub/modules/wrapped/szenen';

/**
 * Der Szenen-Editor.
 *
 * ## Warum Pfeiltasten statt Ziehen
 *
 * Ziehen sieht besser aus und ist fuer einen Teil der Leute nicht
 * bedienbar: mit der Tastatur, mit einem Screenreader, mit zittriger Hand
 * auf dem Telefon. Vierzehn Zeilen lassen sich mit zwei Knoepfen je Zeile
 * genauso schnell ordnen, und die Knoepfe funktionieren ueberall. Wenn eines
 * von beidem fehlen muss, dann das Ziehen.
 *
 * ## Warum der Befund je Szene dabeisteht
 *
 * Eine ausgeschaltete Szene und eine Szene ohne Daten sehen in einer Liste
 * gleich aus - «erscheint nicht». Es sind aber zwei verschiedene Dinge, und
 * nur eines davon ist ein Problem. Der Befund kommt aus der Vorschau und
 * bezieht sich immer auf die dort gewaehlte Person.
 */

export interface SzenenZeile {
  sceneKey: string;
  enabled: boolean;
  position: number;
}

const BEFUND_TEXT: Record<
  SzenenBefund,
  { label: string; variante: 'success' | 'secondary' | 'warning' | 'outline' }
> = {
  aktiv: { label: 'erscheint', variante: 'success' },
  ausgeschaltet: { label: 'ausgeschaltet', variante: 'secondary' },
  'keine-quelle': { label: 'Quelle fehlt', variante: 'warning' },
  'zu-wenig-daten': { label: 'zu wenig Daten', variante: 'outline' },
};

export function SzenenEditor({
  campaignId,
  zeilen: anfang,
  befunde,
  befundFuer,
  csrfToken,
  schreibbar,
  vorschauHref,
}: {
  campaignId: string;
  zeilen: SzenenZeile[];
  /** Befund je Szenenschluessel aus der Vorschau - optional. */
  befunde?: Record<string, SzenenBefund>;
  /** Auf wen sich der Befund bezieht. */
  befundFuer?: string | null;
  csrfToken: string;
  schreibbar: boolean;
  vorschauHref: string;
}): React.JSX.Element {
  const router = useRouter();
  const [zeilen, setZeilen] = useState(() => sortiere(anfang));
  const [laeuft, setLaeuft] = useState(false);

  const registry = useMemo(() => new Map(WRAPPED_SZENEN.map((szene) => [szene.key, szene])), []);
  const veraendert = useMemo(() => !gleich(sortiere(anfang), zeilen), [anfang, zeilen]);

  const verschiebe = (index: number, richtung: -1 | 1): void => {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= zeilen.length) {
      return;
    }
    const kopie = [...zeilen];
    const [eintrag] = kopie.splice(index, 1);
    kopie.splice(ziel, 0, eintrag!);
    // Die Positionen werden nach dem Verschieben neu durchnummeriert. Ohne
    // das blieben Luecken stehen, und eine spaeter eingefuegte Szene landete
    // an einer ueberraschenden Stelle.
    setZeilen(kopie.map((eintrag, position) => ({ ...eintrag, position })));
  };

  const schalte = (sceneKey: string, enabled: boolean): void =>
    setZeilen((alt) => alt.map((zeile) => (zeile.sceneKey === sceneKey ? { ...zeile, enabled } : zeile)));

  const zuruecksetzen = (): void =>
    setZeilen(
      WRAPPED_SZENEN.map((szene, position) => ({
        sceneKey: szene.key,
        enabled: szene.standardAktiv,
        position,
      })),
    );

  async function speichern(): Promise<void> {
    setLaeuft(true);
    const antwort = await wrappedSzenenSetzenAction({ csrfToken, campaignId, szenen: zeilen });
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Szenen gespeichert.');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {befundFuer ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden="true" />
          Der Befund rechts gilt für <strong className="text-foreground">{befundFuer}</strong>.
          <Link href={vorschauHref} className="underline underline-offset-2">
            Andere Person wählen
          </Link>
        </p>
      ) : null}

      <ol className="divide-y divide-border rounded-xl border border-border">
        {zeilen.map((zeile, index) => {
          const szene = registry.get(zeile.sceneKey);
          const befund = befunde?.[zeile.sceneKey];
          return (
            <li key={zeile.sceneKey} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
              <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{szene?.label ?? zeile.sceneKey}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {szene?.beschreibung ?? 'Diese Szene gibt es im Code nicht mehr.'}
                </p>
              </div>

              {befund ? (
                <Badge variant={BEFUND_TEXT[befund].variante} className="hidden shrink-0 sm:inline-flex">
                  {BEFUND_TEXT[befund].label}
                </Badge>
              ) : null}

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => verschiebe(index, -1)}
                  disabled={!schreibbar || index === 0}
                  aria-label={`${szene?.label ?? zeile.sceneKey} nach oben`}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => verschiebe(index, 1)}
                  disabled={!schreibbar || index === zeilen.length - 1}
                  aria-label={`${szene?.label ?? zeile.sceneKey} nach unten`}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Switch
                  checked={zeile.enabled}
                  onCheckedChange={(wert) => schalte(zeile.sceneKey, wert)}
                  disabled={!schreibbar}
                  aria-label={`${szene?.label ?? zeile.sceneKey} einschalten`}
                />
              </div>
            </li>
          );
        })}
      </ol>

      {schreibbar ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void speichern()} disabled={laeuft || !veraendert}>
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Reihenfolge speichern
          </Button>
          <Button type="button" variant="ghost" onClick={zuruecksetzen} disabled={laeuft}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Auf Vorgabe zurücksetzen
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const sortiere = (zeilen: SzenenZeile[]): SzenenZeile[] =>
  [...zeilen].sort((links, rechts) => links.position - rechts.position);

const gleich = (links: SzenenZeile[], rechts: SzenenZeile[]): boolean =>
  links.length === rechts.length &&
  links.every(
    (zeile, index) => zeile.sceneKey === rechts[index]?.sceneKey && zeile.enabled === rechts[index]?.enabled,
  );
