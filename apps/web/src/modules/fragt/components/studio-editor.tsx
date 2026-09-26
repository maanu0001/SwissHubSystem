'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, Download, Loader2, Lock, Package, Unlock } from 'lucide-react';
import type { fragt } from '@swisshub/modules';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  fragtEntwurfBearbeitenAction,
  fragtEntwurfFinalisierenAction,
  fragtEntwurfFreigebenAction,
  fragtEntwurfGepostetAction,
} from '@/modules/fragt/actions';
import { cn } from '@/lib/utils';

/**
 * Das Content Studio.
 *
 * ## Was hier bearbeitet werden kann
 *
 * Ueberschrift, Untertitel, Aufruf, Vorlage, Format, welche Folien mitkommen
 * und in welcher Reihenfolge.
 *
 * ## Was nicht
 *
 * Die Zahlen. Sie stehen in keinem Feld dieses Formulars, weil sie in keiner
 * Spalte des Entwurfs stehen: der Renderer holt sie aus dem Ergebnis, das beim
 * Schliessen festgeschrieben wurde. Es gibt also keinen Weg, eine 42 in eine 68
 * zu aendern - nicht weil es verboten waere, sondern weil das Feld fehlt.
 *
 * ## Warum die Vorschau ein Bild ist und kein HTML
 *
 * Weil sie sonst luege. Eine mit CSS nachgebaute Vorschau saehe im Browser
 * anders aus als das PNG, das Satori erzeugt - und der Unterschied faellt erst
 * auf Instagram auf. Hier laedt dieselbe Route, die auch der Export benutzt.
 */

export interface StudioAnsicht {
  entwurfId: string;
  status: string;
  vorlage: fragt.Vorlage;
  format: fragt.Format;
  ueberschrift: string;
  untertitel: string;
  cta: string;
  folien: Array<{ art: fragt.FolienArt; aktiv: boolean; position: number }>;
  frageText: string;
  /** Nur zur Anzeige - unveraenderlich. */
  zahlen: { gesamt: number; gewinner: string | null; prozent: number | null };
}

const VORLAGEN: Array<{ wert: fragt.Vorlage; label: string; hinweis: string }> = [
  { wert: 'winner', label: 'The Winner', hinweis: 'Eine Zahl, gross. Fokus auf die Gewinnerantwort.' },
  { wert: 'results', label: 'The Results', hinweis: 'Alle Antworten mit ihrer Verteilung.' },
  { wert: 'duel', label: 'The Duel', hinweis: 'Geteilte Fläche - nur für zwei Antworten sinnvoll.' },
];

const FORMATE: Array<{ wert: fragt.Format; label: string; masse: string }> = [
  { wert: 'story', label: 'Story', masse: '1080 × 1920' },
  { wert: 'feed', label: 'Feed / Carousel', masse: '1080 × 1350' },
  { wert: 'quadrat', label: 'Quadratisch', masse: '1080 × 1080' },
];

const FOLIEN_LABEL: Record<fragt.FolienArt, string> = {
  frage: 'Die Frage',
  gewinner: 'Der Gewinner',
  verteilung: 'Die Verteilung',
  duell: 'Das Duell',
  cta: 'Der Aufruf',
};

export function StudioEditor({
  csrfToken,
  ansicht,
}: {
  /** Der CSRF-Token der Sitzung - jede Server Action verlangt ihn. */
  csrfToken: string;
  ansicht: StudioAnsicht;
}): React.JSX.Element {
  const router = useRouter();
  const [vorlage, setVorlage] = useState(ansicht.vorlage);
  const [format, setFormat] = useState(ansicht.format);
  const [ueberschrift, setUeberschrift] = useState(ansicht.ueberschrift);
  const [untertitel, setUntertitel] = useState(ansicht.untertitel);
  const [cta, setCta] = useState(ansicht.cta);
  const [folien, setFolien] = useState(ansicht.folien);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  /*
   * Die Vorschau muss sich nach dem Speichern neu laden.
   *
   * Sie ist ein `<img>` auf eine Route; der Browser wuerde dieselbe Adresse
   * aus seinem Cache bedienen. Ein Zaehler im Query-String macht daraus bei
   * jeder Aenderung eine neue Adresse.
   */
  const [stand, setStand] = useState(0);

  const gesperrt = ansicht.status !== 'OFFEN';
  const gepostet = ansicht.status === 'VEROEFFENTLICHT';

  const vorschauAdresse = (art?: fragt.FolienArt): string =>
    `/api/fragt/grafik/${ansicht.entwurfId}?format=${format}${art ? `&art=${art}` : ''}&v=${stand}`;

  async function speichern(): Promise<void> {
    setLaeuft('speichern');
    const antwort = await fragtEntwurfBearbeitenAction({
      csrfToken,
      entwurfId: ansicht.entwurfId,
      vorlage,
      format,
      ueberschrift: ueberschrift.trim(),
      untertitel: untertitel.trim() || null,
      cta: cta.trim(),
      folien,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Gespeichert.');
    setStand((wert) => wert + 1);
    router.refresh();
  }

  function verschiebe(index: number, richtung: -1 | 1): void {
    setFolien((vorher) => {
      const ziel = index + richtung;
      if (ziel < 0 || ziel >= vorher.length) {
        return vorher;
      }
      const kopie = [...vorher];
      const [heraus] = kopie.splice(index, 1);
      kopie.splice(ziel, 0, heraus!);
      return kopie.map((folie, stelle) => ({ ...folie, position: stelle }));
    });
  }

  const aktiveFolien = folien.filter((folie) => folie.aktiv);

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        {gesperrt ? (
          <div
            className={cn(
              'flex items-start gap-3 rounded-xl border p-4 text-sm',
              gepostet ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-sky-500/40 bg-sky-500/5',
            )}
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-2">
              <p>
                {gepostet
                  ? 'Dieser Entwurf ist als veröffentlicht markiert. Was auf Instagram steht, lässt sich hier nicht mehr ändern.'
                  : 'Dieser Entwurf ist abgeschlossen. Gib ihn frei, um Texte zu ändern.'}
              </p>
              {!gepostet ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={laeuft === 'freigeben'}
                  onClick={async () => {
                    setLaeuft('freigeben');
                    const antwort = await fragtEntwurfFreigebenAction({
                      csrfToken,
                      entwurfId: ansicht.entwurfId,
                    });
                    setLaeuft(null);
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    router.refresh();
                  }}
                >
                  <Unlock className="size-4" />
                  Wieder freigeben
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Vorlage</h3>
          <div className="space-y-2">
            {VORLAGEN.map((eintrag) => (
              <button
                key={eintrag.wert}
                type="button"
                disabled={gesperrt}
                onClick={() => setVorlage(eintrag.wert)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition disabled:opacity-50',
                  vorlage === eintrag.wert
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <span className="block text-sm font-medium">{eintrag.label}</span>
                <span className="block text-xs text-muted-foreground">{eintrag.hinweis}</span>
              </button>
            ))}
          </div>

          <h3 className="pt-2 font-semibold">Format</h3>
          <div className="grid grid-cols-3 gap-2">
            {FORMATE.map((eintrag) => (
              <button
                key={eintrag.wert}
                type="button"
                disabled={gesperrt}
                onClick={() => setFormat(eintrag.wert)}
                className={cn(
                  'rounded-lg border p-2 text-center transition disabled:opacity-50',
                  format === eintrag.wert
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <span className="block text-xs font-medium">{eintrag.label}</span>
                <span className="block text-[0.65rem] tabular-nums text-muted-foreground">
                  {eintrag.masse}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Texte</h3>
          <div className="space-y-1.5">
            <Label htmlFor="studio-ueberschrift">Überschrift</Label>
            <Input
              id="studio-ueberschrift"
              value={ueberschrift}
              maxLength={240}
              disabled={gesperrt}
              onChange={(ereignis) => setUeberschrift(ereignis.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="studio-untertitel">Untertitel</Label>
            <Input
              id="studio-untertitel"
              value={untertitel}
              maxLength={240}
              disabled={gesperrt}
              onChange={(ereignis) => setUntertitel(ereignis.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="studio-cta">Aufruf</Label>
            <Input
              id="studio-cta"
              value={cta}
              maxLength={200}
              disabled={gesperrt}
              onChange={(ereignis) => setCta(ereignis.target.value)}
            />
          </div>

          {/* Die Zahlen - zur Ansicht, nicht zur Bearbeitung. */}
          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Aus der Abstimmung</p>
            <p className="mt-1">
              {ansicht.zahlen.gesamt} {ansicht.zahlen.gesamt === 1 ? 'Stimme' : 'Stimmen'}
              {ansicht.zahlen.gewinner
                ? ` · ${ansicht.zahlen.gewinner} mit ${ansicht.zahlen.prozent} %`
                : ' · kein eindeutiger Gewinner'}
            </p>
            <p className="mt-1.5">
              Diese Werte lassen sich nicht bearbeiten. Sie stammen aus dem Ergebnis, das beim Schliessen
              festgeschrieben wurde.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Folien im Carousel</h3>
          <ul className="space-y-1.5">
            {folien.map((folie, index) => (
              <li
                key={folie.art}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={folie.aktiv}
                  disabled={gesperrt}
                  aria-label={`${FOLIEN_LABEL[folie.art]} mitexportieren`}
                  onChange={(ereignis) =>
                    setFolien((vorher) =>
                      vorher.map((eintrag, stelle) =>
                        stelle === index ? { ...eintrag, aktiv: ereignis.target.checked } : eintrag,
                      ),
                    )
                  }
                  className="size-4 accent-[hsl(var(--primary))]"
                />
                <span className={cn('flex-1 text-sm', !folie.aktiv && 'text-muted-foreground line-through')}>
                  {index + 1}. {FOLIEN_LABEL[folie.art]}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gesperrt || index === 0}
                  onClick={() => verschiebe(index, -1)}
                  aria-label="Nach oben"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={gesperrt || index === folien.length - 1}
                  onClick={() => verschiebe(index, 1)}
                  aria-label="Nach unten"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {aktiveFolien.length} {aktiveFolien.length === 1 ? 'Folie' : 'Folien'} im ZIP-Export.
          </p>
        </div>

        {!gesperrt ? (
          <Button className="w-full" disabled={laeuft === 'speichern'} onClick={() => void speichern()}>
            {laeuft === 'speichern' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Speichern und Vorschau aktualisieren
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Vorschau</h3>
            <span className="text-xs text-muted-foreground">
              {FORMATE.find((eintrag) => eintrag.wert === format)?.masse}
            </span>
          </div>
          {/*
            Dasselbe Bild wie der Export.

            `img` und nicht `next/image`: die Route liefert das PNG dynamisch
            und mit `no-store`, eine Optimierungsschicht davor brächte nur einen
            zweiten Cache, der die Änderung verschluckt.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={vorschauAdresse()}
            alt={`Vorschau: ${ueberschrift}`}
            className="mx-auto w-full max-w-sm rounded-lg border border-border bg-black"
          />
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Export</h3>
          <div className="flex flex-wrap gap-2">
            {FORMATE.map((eintrag) => (
              <a
                key={eintrag.wert}
                href={`/api/fragt/grafik/${ansicht.entwurfId}?format=${eintrag.wert}`}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <Download className="size-4" />
                {eintrag.label} PNG
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {FORMATE.map((eintrag) => (
              <a
                key={eintrag.wert}
                href={`/api/fragt/grafik/${ansicht.entwurfId}/zip?format=${eintrag.wert}`}
                download
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <Package className="size-4" />
                Carousel-ZIP ({eintrag.label})
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Das ZIP enthält die aktivierten Folien in ihrer Reihenfolge, durchnummeriert - beim Hochladen
            entscheidet sie, was zuerst zu sehen ist.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Status</h3>
          <p className="text-sm text-muted-foreground">
            SwissHub postet nicht selbst auf Instagram - es gibt dafür keine Zugangsdaten und keinen Endpunkt.
            Wenn du die Grafiken von Hand gepostet hast, halte es hier fest.
          </p>
          <div className="flex flex-wrap gap-2">
            {ansicht.status === 'OFFEN' ? (
              <Button
                variant="outline"
                disabled={laeuft === 'final'}
                onClick={async () => {
                  setLaeuft('final');
                  const antwort = await fragtEntwurfFinalisierenAction({
                    csrfToken,
                    entwurfId: ansicht.entwurfId,
                  });
                  setLaeuft(null);
                  if (!antwort.ok) {
                    toast.error(antwort.error.message);
                    return;
                  }
                  toast.success('Abgeschlossen - bereit zum Posten.');
                  router.refresh();
                }}
              >
                <Lock className="size-4" />
                Entwurf abschliessen
              </Button>
            ) : null}
            {!gepostet ? (
              <Button
                disabled={laeuft === 'gepostet'}
                onClick={async () => {
                  setLaeuft('gepostet');
                  const antwort = await fragtEntwurfGepostetAction({
                    csrfToken,
                    entwurfId: ansicht.entwurfId,
                  });
                  setLaeuft(null);
                  if (!antwort.ok) {
                    toast.error(antwort.error.message);
                    return;
                  }
                  toast.success('Als veröffentlicht markiert.');
                  router.refresh();
                }}
              >
                <Check className="size-4" />
                Als gepostet markieren
              </Button>
            ) : (
              <p className="text-sm text-emerald-400">Als gepostet markiert.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
