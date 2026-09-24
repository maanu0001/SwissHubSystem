'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ImageUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  momentAendernAction,
  momentAnlegenAction,
  momentLoeschenAction,
} from '@/modules/wrapped/ausgabe-aktionen';

/**
 * Community Moments pflegen.
 *
 * ## Warum das Datum entscheidet
 *
 * Ein Moment landet in der Ausgabe des Zeitraums, in dem er passiert ist -
 * nicht in der, die man gerade bearbeitet. Wer die GameNight vom 9. August
 * erfasst, findet sie in der August-Ausgabe, auch wenn er sie im November
 * eintraegt.
 *
 * ## Warum nichts automatisch veroeffentlicht wird
 *
 * Die beiden Haken sagen nur, **ob** ein Moment fuer eine Ausgabe in Frage
 * kommt. Ob er dort landet, entscheidet die Auswahl - und ob er hinausgeht,
 * entscheidet jemand, der die Ausgabe einfriert.
 */

export interface MomentZeile {
  id: string;
  title: string;
  description: string | null;
  happenedAt: Date;
  hatBild: boolean;
  includeMonthly: boolean;
  includeYearly: boolean;
  priority: number;
  verwendet: number;
}

const alsTag = (datum: Date): string => datum.toISOString().slice(0, 10);

export function MomenteVerwaltung({
  csrfToken,
  momente,
}: {
  csrfToken: string;
  momente: MomentZeile[];
}): React.JSX.Element {
  const router = useRouter();
  const [neu, setNeu] = useState(false);

  return (
    <div className="space-y-4">
      {neu ? (
        <MomentFormular
          csrfToken={csrfToken}
          onFertig={() => {
            setNeu(false);
            router.refresh();
          }}
          onAbbrechen={() => setNeu(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNeu(true)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm transition-colors hover:border-foreground/30"
        >
          <Plus className="size-4" aria-hidden="true" />
          Moment erfassen
        </button>
      )}

      {momente.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Noch kein Moment. Was einen Monat ausmacht, steht selten in einer Tabelle - hier kommt es hin.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {momente.map((moment) => (
            <li key={moment.id} className="min-w-0">
              <MomentKarte csrfToken={csrfToken} moment={moment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MomentKarte({ csrfToken, moment }: { csrfToken: string; moment: MomentZeile }): React.JSX.Element {
  const router = useRouter();
  const [laedt, setLaedt] = useState(false);
  const [bearbeiten, setBearbeiten] = useState(false);
  const dateiFeld = useRef<HTMLInputElement>(null);

  const hochladen = async (datei: File): Promise<void> => {
    setLaedt(true);
    const formular = new FormData();
    formular.set('csrfToken', csrfToken);
    formular.set('image', datei);
    const antwort = await fetch(`/api/wrapped/moment/${moment.id}`, {
      method: 'POST',
      body: formular,
    });
    const ergebnis = (await antwort.json()) as { ok: boolean; error?: { message?: string } };
    setLaedt(false);
    if (!ergebnis.ok) {
      toast.error(ergebnis.error?.message ?? 'Das Bild konnte nicht gespeichert werden.');
      return;
    }
    toast.success('Bild gespeichert.');
    router.refresh();
  };

  const loeschen = async (): Promise<void> => {
    if (!window.confirm(`«${moment.title}» wirklich löschen?`)) {
      return;
    }
    const antwort = await momentLoeschenAction({ csrfToken, momentId: moment.id });
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Gelöscht.');
    router.refresh();
  };

  if (bearbeiten) {
    return (
      <MomentFormular
        csrfToken={csrfToken}
        start={moment}
        onFertig={() => {
          setBearbeiten(false);
          router.refresh();
        }}
        onAbbrechen={() => setBearbeiten(false)}
      />
    );
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      {moment.hatBild ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/wrapped/moment/${moment.id}`}
          alt=""
          className="h-36 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-36 w-full items-center justify-center border-b border-border bg-card-elevated">
          <ImageUp className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <p className="break-words text-sm font-semibold leading-tight">{moment.title}</p>
        {moment.description ? (
          <p className="line-clamp-3 text-xs text-muted-foreground">{moment.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[0.65rem] text-muted-foreground">
          <span className="tabular-nums">{alsTag(moment.happenedAt)}</span>
          {moment.includeMonthly ? <span className="rounded bg-muted px-1.5 py-0.5">Monat</span> : null}
          {moment.includeYearly ? <span className="rounded bg-muted px-1.5 py-0.5">Jahr</span> : null}
          {moment.priority > 0 ? <span>Priorität {moment.priority}</span> : null}
          {moment.verwendet > 0 ? (
            <span className="text-success">
              in {moment.verwendet} {moment.verwendet === 1 ? 'Ausgabe' : 'Ausgaben'}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 border-t border-border pt-2">
          <input
            ref={dateiFeld}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const datei = event.target.files?.[0];
              if (datei) {
                void hochladen(datei);
              }
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => dateiFeld.current?.click()}
            disabled={laedt}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {laedt ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ImageUp className="size-3.5" aria-hidden="true" />
            )}
            {moment.hatBild ? 'Bild tauschen' : 'Bild'}
          </button>
          <button
            type="button"
            onClick={() => setBearbeiten(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => void loeschen()}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Löschen
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * Dasselbe Formular fuer Anlegen und Aendern.
 *
 * Zwei Formulare mit denselben sechs Feldern waeren zwei Stellen, an denen
 * eine Laengenbegrenzung stehen muesste - und die zweite waere beim
 * naechsten Feld vergessen. `start` entscheidet, welche Aktion am Ende
 * laeuft.
 */
function MomentFormular({
  csrfToken,
  start,
  onFertig,
  onAbbrechen,
}: {
  csrfToken: string;
  start?: MomentZeile;
  onFertig: () => void;
  onAbbrechen: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(start?.title ?? '');
  const [description, setDescription] = useState(start?.description ?? '');
  const [happenedOn, setHappenedOn] = useState(
    start ? alsTag(start.happenedAt) : new Date().toISOString().slice(0, 10),
  );
  const [includeMonthly, setIncludeMonthly] = useState(start?.includeMonthly ?? true);
  const [includeYearly, setIncludeYearly] = useState(start?.includeYearly ?? false);
  const [priority, setPriority] = useState(start?.priority ?? 0);
  const [laeuft, setLaeuft] = useState(false);

  const speichern = async (): Promise<void> => {
    setLaeuft(true);
    const felder = { csrfToken, title, description, happenedOn, includeMonthly, includeYearly, priority };
    const antwort = start
      ? await momentAendernAction({ ...felder, momentId: start.id })
      : await momentAnlegenAction(felder);
    setLaeuft(false);
    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(start ? 'Gespeichert.' : 'Moment erfasst. Das Bild lässt sich jetzt hochladen.');
    onFertig();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Titel
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            placeholder="GameNight im August"
            className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-primary-bright"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Wann war das?
          <input
            type="date"
            value={happenedOn}
            onChange={(event) => setHappenedOn(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-primary-bright"
          />
        </label>
      </div>

      <label className="block text-xs text-muted-foreground">
        Beschreibung
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Ein Satz - auf einer Folie ist kein Platz für mehr."
          className="mt-1 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary-bright"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['Monat', includeMonthly, setIncludeMonthly],
            ['Jahr', includeYearly, setIncludeYearly],
          ] as const
        ).map(([label, wert, setzen]) => (
          <button
            key={label}
            type="button"
            aria-pressed={wert}
            onClick={() => setzen(!wert)}
            className={`min-h-9 rounded-lg border px-3 text-xs transition-colors ${
              wert
                ? 'border-primary-bright bg-primary-bright/12'
                : 'border-border text-muted-foreground hover:border-foreground/30'
            }`}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto text-xs text-muted-foreground">
          Priorität
          <input
            type="number"
            min={0}
            max={100}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="ml-2 h-9 w-20 rounded-lg border border-border bg-card px-2 text-sm tabular-nums text-foreground outline-none focus-visible:border-primary-bright"
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void speichern()}
          disabled={laeuft || title.trim().length < 2}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {start ? 'Speichern' : 'Erfassen'}
        </button>
        <button
          type="button"
          onClick={onAbbrechen}
          className="min-h-10 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
