'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, Eye, EyeOff, Info, Loader2, Lock, RefreshCw, Send, Unlock } from 'lucide-react';
import type { WrappedVariante } from '@swisshub/modules/wrapped/vorlagen';
import {
  ausgabeEntsperrenAction,
  ausgabeFinalisierenAction,
  ausgabeRegenerierenAction,
  ausgabeVeroeffentlichtAction,
  folieSchaltenAction,
  folieTextAction,
} from '@/modules/wrapped/ausgabe-aktionen';
import { AUSGABE_MASSE, zeichneAusgabeFolie } from '@/modules/wrapped/ausgabe-folie';
import type { AusgabeFormat } from '@/modules/wrapped/ausgabe-folie';

/**
 * Der Editor einer Ausgabe.
 *
 * ## Die Trennung, um die es hier geht
 *
 * Links stehen die Folien mit ihren **Zahlen** - unveraenderlich, aus dem
 * Schnappschuss. Rechts stehen **Ueberschrift und Begleitsatz** - frei
 * bearbeitbar. Ein Tippfehler im Begleitsatz kann deshalb keine Statistik
 * verfaelschen; es gibt kein Feld, ueber das man an die Zahlen herankaeme.
 *
 * ## Warum die Vorschau dasselbe Bauteil ist wie der Export
 *
 * `zeichneAusgabeFolie` - dieselbe Funktion, die `ImageResponse` rastert.
 * Hier laeuft sie im Browser und wird per `transform` verkleinert. Was man
 * sieht, ist damit nicht eine Nachbildung des Exports, sondern der Export.
 */

export interface EditorFolie {
  id: string;
  storyKey: string;
  templateKey: string;
  position: number;
  enabled: boolean;
  daten: unknown;
  editorial: { ueberschrift: string; text: string };
}

export interface EditorAusgabe {
  id: string;
  titel: string;
  periodKey: string;
  status: 'DRAFT' | 'FINALIZED' | 'PUBLISHED' | 'ARCHIVED';
  variante: string;
  folien: EditorFolie[];
  gruende: Array<{ storyKey: string; label: string; lage: string; erklaerung: string }>;
}

export interface EditorRechte {
  bearbeiten: boolean;
  erzeugen: boolean;
  einfrieren: boolean;
  entsperren: boolean;
  veroeffentlichen: boolean;
  exportieren: boolean;
}

const LAGE_TEXT: Record<string, string> = {
  nicht_erhoben: 'nicht erhoben',
  nur_teilweise_erhoben: 'nur teilweise erhoben',
  nichts_passiert: 'nichts passiert',
  zu_wenig_vergleich: 'zu wenig Vergleich',
};

export function AusgabeEditor({
  csrfToken,
  ausgabe,
  rechte,
  host,
}: {
  csrfToken: string;
  ausgabe: EditorAusgabe;
  rechte: EditorRechte;
  host: string;
}): React.JSX.Element {
  const router = useRouter();
  const [format, setFormat] = useState<AusgabeFormat>('story');
  const [offen, setOffen] = useState<string | null>(ausgabe.folien[0]?.id ?? null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const entwurf = ausgabe.status === 'DRAFT';
  const gewaehlt = ausgabe.folien.find((folie) => folie.id === offen) ?? ausgabe.folien[0] ?? null;

  const rufe = async (
    name: string,
    fn: () => Promise<{ ok: boolean; error?: { message?: string } }>,
    erfolg: string,
  ): Promise<void> => {
    setLaeuft(name);
    const antwort = await fn();
    setLaeuft(null);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {rechte.erzeugen && entwurf ? (
          <button
            type="button"
            disabled={laeuft !== null}
            onClick={() =>
              void rufe(
                'regenerieren',
                () =>
                  ausgabeRegenerierenAction({
                    csrfToken,
                    editionId: ausgabe.id,
                    texteBehalten: true,
                  }),
                'Neu erhoben. Deine Texte sind geblieben.',
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30 disabled:opacity-50"
          >
            {laeuft === 'regenerieren' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            Neu erheben
          </button>
        ) : null}

        {rechte.einfrieren && entwurf ? (
          <button
            type="button"
            disabled={laeuft !== null || ausgabe.folien.length === 0}
            onClick={() =>
              void rufe(
                'einfrieren',
                () => ausgabeFinalisierenAction({ csrfToken, editionId: ausgabe.id }),
                'Eingefroren. Die Zahlen ändern sich jetzt nicht mehr.',
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30 disabled:opacity-50"
          >
            <Lock className="size-4" aria-hidden="true" />
            Einfrieren
          </button>
        ) : null}

        {rechte.entsperren && !entwurf ? (
          <button
            type="button"
            disabled={laeuft !== null}
            onClick={() => {
              if (
                !window.confirm(
                  'Diese Ausgabe ist eingefroren. Beim Entsperren kann sich ändern, was du bereits veröffentlicht hast. Trotzdem?',
                )
              ) {
                return;
              }
              void rufe(
                'entsperren',
                () => ausgabeEntsperrenAction({ csrfToken, editionId: ausgabe.id }),
                'Entsperrt. Sie ist wieder ein Entwurf.',
              );
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-warning/50 disabled:opacity-50"
          >
            <Unlock className="size-4" aria-hidden="true" />
            Entsperren
          </button>
        ) : null}

        {rechte.veroeffentlichen && ausgabe.status === 'FINALIZED' ? (
          <button
            type="button"
            disabled={laeuft !== null}
            onClick={() =>
              void rufe(
                'veroeffentlicht',
                () => ausgabeVeroeffentlichtAction({ csrfToken, editionId: ausgabe.id }),
                'Als veröffentlicht vermerkt.',
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-success/40 px-3 text-sm text-success transition-colors disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            Als veröffentlicht markieren
          </button>
        ) : null}

        {rechte.exportieren ? (
          <div className="ml-auto flex gap-2">
            <a
              href={`/api/wrapped/ausgabe/${ausgabe.id}/export?format=story`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary-bright px-3 text-sm font-semibold text-white"
            >
              <Download className="size-4" aria-hidden="true" />
              Story-ZIP
            </a>
            <a
              href={`/api/wrapped/ausgabe/${ausgabe.id}/export?format=feed`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30"
            >
              <Download className="size-4" aria-hidden="true" />
              Feed-ZIP
            </a>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <ul className="space-y-2">
            {ausgabe.folien.map((folie) => (
              <li key={folie.id}>
                <FolienZeile
                  csrfToken={csrfToken}
                  folie={folie}
                  offen={offen === folie.id}
                  entwurf={entwurf && rechte.bearbeiten}
                  onOeffnen={() => setOffen(folie.id)}
                  onGeaendert={() => router.refresh()}
                />
              </li>
            ))}
          </ul>

          {ausgabe.gruende.length > 0 ? (
            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Warum {ausgabe.gruende.length} mögliche Folien fehlen
              </summary>
              <ul className="mt-3 space-y-2">
                {ausgabe.gruende.map((grund) => (
                  <li key={grund.storyKey} className="flex gap-2 text-xs">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="font-medium">{grund.label}</span>{' '}
                      <span className="text-muted-foreground">
                        ({LAGE_TEXT[grund.lage] ?? grund.lage}) — {grund.erklaerung}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                ['story', 'Story 1080×1920'],
                ['feed', 'Feed 1080×1350'],
              ] as const
            ).map(([wert, label]) => (
              <button
                key={wert}
                type="button"
                aria-pressed={format === wert}
                onClick={() => setFormat(wert)}
                className={`min-h-9 flex-1 rounded-lg border px-2 text-xs transition-colors ${
                  format === wert
                    ? 'border-primary-bright bg-primary-bright/12'
                    : 'border-border text-muted-foreground hover:border-foreground/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {gewaehlt ? (
            <Vorschau
              folie={gewaehlt}
              format={format}
              variante={ausgabe.variante as WrappedVariante}
              titel={ausgabe.titel}
              host={host}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Diese Ausgabe hat keine Folien.
            </p>
          )}

          {gewaehlt && rechte.exportieren ? (
            <a
              href={`/api/wrapped/ausgabe/${ausgabe.id}/folie/${gewaehlt.id}?format=${format}`}
              className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border text-sm transition-colors hover:border-foreground/30"
            >
              <Download className="size-4" aria-hidden="true" />
              Diese Folie als PNG
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Die Vorschau.
 *
 * Das Bild entsteht in voller Groesse und wird per `transform` verkleinert -
 * nicht in kleiner Groesse neu gesetzt. Nur so stimmen Schriftgroessen,
 * Abstaende und Umbrueche mit dem Export ueberein; ein bei 340 Pixeln
 * gesetztes Layout saehe bei 1080 anders aus.
 */
function Vorschau({
  folie,
  format,
  variante,
  titel,
  host,
}: {
  folie: EditorFolie;
  format: AusgabeFormat;
  variante: WrappedVariante;
  titel: string;
  host: string;
}): React.JSX.Element {
  const mass = AUSGABE_MASSE[format];
  const breite = 340;
  const faktor = breite / mass.breite;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      style={{ width: breite, height: Math.round(mass.hoehe * faktor) }}
    >
      <div
        style={{
          width: mass.breite,
          height: mass.hoehe,
          transform: `scale(${faktor})`,
          transformOrigin: 'top left',
          display: 'flex',
        }}
      >
        {zeichneAusgabeFolie({
          folie: {
            templateKey: folie.templateKey as never,
            daten: folie.daten,
            editorial: folie.editorial,
          },
          format,
          variante,
          titel,
          host,
        })}
      </div>
    </div>
  );
}

/** Eine Folie in der Liste - mit ihren Zahlen und ihrem Text. */
function FolienZeile({
  csrfToken,
  folie,
  offen,
  entwurf,
  onOeffnen,
  onGeaendert,
}: {
  csrfToken: string;
  folie: EditorFolie;
  offen: boolean;
  entwurf: boolean;
  onOeffnen: () => void;
  onGeaendert: () => void;
}): React.JSX.Element {
  const [ueberschrift, setUeberschrift] = useState(folie.editorial.ueberschrift);
  const [text, setText] = useState(folie.editorial.text);
  const [speichert, setSpeichert] = useState(false);

  const schmutzig = ueberschrift !== folie.editorial.ueberschrift || text !== folie.editorial.text;

  const speichern = async (): Promise<void> => {
    setSpeichert(true);
    const antwort = await folieTextAction({ csrfToken, slideId: folie.id, ueberschrift, text });
    setSpeichert(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Text gespeichert.');
    onGeaendert();
  };

  const schalten = async (): Promise<void> => {
    const antwort = await folieSchaltenAction({
      csrfToken,
      slideId: folie.id,
      enabled: !folie.enabled,
    });
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    onGeaendert();
  };

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card transition-colors ${
        offen ? 'border-primary-bright' : 'border-border'
      } ${folie.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-center gap-3 p-3">
        <button type="button" onClick={onOeffnen} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="flex items-center gap-2">
            <span className="text-[0.65rem] tabular-nums text-muted-foreground">
              {String(folie.position + 1).padStart(2, '0')}
            </span>
            <span className="truncate text-sm font-semibold">
              {folie.editorial.ueberschrift || folie.storyKey}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{folie.templateKey}</span>
        </button>

        {entwurf ? (
          <button
            type="button"
            onClick={() => void schalten()}
            aria-label={folie.enabled ? 'Folie ausschalten' : 'Folie einschalten'}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
          >
            {folie.enabled ? (
              <Eye className="size-4" aria-hidden="true" />
            ) : (
              <EyeOff className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {offen ? (
        <div className="space-y-3 border-t border-border p-4">
          {/*
            Die Zahlen - nur zum Ansehen.

            Es gibt hier absichtlich kein Eingabefeld. Was erhoben wurde,
            steht im Schnappschuss; wer es ändern will, muss neu erheben.
          */}
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Erhoben — nicht bearbeitbar
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[0.7rem] text-muted-foreground">
              {JSON.stringify(folie.daten, null, 1)}
            </pre>
          </div>

          <div>
            <label className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Überschrift
              <input
                value={ueberschrift}
                onChange={(event) => setUeberschrift(event.target.value)}
                maxLength={60}
                disabled={!entwurf}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm normal-case tracking-normal text-foreground outline-none focus-visible:border-primary-bright disabled:opacity-60"
              />
            </label>
          </div>

          <div>
            <label className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Begleitsatz
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={200}
                rows={2}
                disabled={!entwurf}
                className="mt-1 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm normal-case tracking-normal text-foreground outline-none focus-visible:border-primary-bright disabled:opacity-60"
              />
            </label>
          </div>

          {entwurf ? (
            <button
              type="button"
              onClick={() => void speichern()}
              disabled={!schmutzig || speichert}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {speichert ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Text speichern
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Diese Ausgabe ist eingefroren. Entsperre sie, um noch etwas zu ändern.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
