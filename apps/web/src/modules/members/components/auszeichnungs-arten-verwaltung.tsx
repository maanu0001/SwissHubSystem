'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { systemRoutes } from '@swisshub/shared';
import { NavIcon } from '@/components/layout/nav-icon';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';
import {
  auszeichnungAnlegenAction,
  auszeichnungArchivierenAction,
  auszeichnungBearbeitenAction,
  auszeichnungEntfernenAction,
  auszeichnungZurueckholenAction,
} from '../auszeichnungs-aktionen';

type Stufe = 'bronze' | 'silber' | 'gold';

export interface ArtZeile {
  id: string;
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  aktiv: boolean;
  archiviert: boolean;
  sortierung: number;
  /** Wie viele Mitglieder sie tragen. */
  verliehen: number;
}

const STUFEN: readonly { wert: Stufe; label: string }[] = [
  { wert: 'bronze', label: 'Bronze' },
  { wert: 'silber', label: 'Silber' },
  { wert: 'gold', label: 'Gold' },
];

const STUFEN_FARBE: Record<Stufe, string> = {
  gold: 'border-[#e0a83a]/50 bg-[#e0a83a]/10',
  silber: 'border-border bg-card',
  bronze: 'border-[#a86a3a]/40 bg-[#a86a3a]/10',
};

interface Entwurf {
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: Stufe;
  aktiv: boolean;
}

const LEER: Entwurf = { label: '', beschreibung: '', symbol: 'Award', stufe: 'bronze', aktiv: true };

/**
 * Die verleihbaren Auszeichnungen verwalten.
 *
 * ## Was hier passiert und was nicht
 *
 * Hier entsteht eine Auszeichnung - ihr Name, ihre Beschreibung, ihr
 * Symbol, ihre Stufe. **Verliehen** wird sie woanders: in der Akte eines
 * Mitglieds. Die Trennung ist keine Geschmacksfrage, sondern der Grund,
 * warum ein Moderator «Gute Seele» vergeben kann, ohne sie umbenennen zu
 * duerfen - eine Umbenennung wirkt auf jedes Profil, das sie schon traegt.
 *
 * ## Drei Zustaende
 *
 * Aktiv, abgeschaltet und archiviert. Keiner davon nimmt jemandem etwas
 * weg: wer «Event-Held» hat, behaelt ihn auch, wenn die Art morgen
 * archiviert wird. Nur das Vergeben hoert auf.
 *
 * ## Entfernen
 *
 * Gibt es, aber nur fuer Auszeichnungen, die niemand hat. Die Zahl steht
 * an jeder Karte; ist sie groesser als null, sagt der Server beim Versuch,
 * wie viele Mitglieder betroffen waeren, und entfernt nichts.
 */
export function ArtenVerwaltung({
  csrfToken,
  arten,
  symbole,
  darfVerleihen,
}: {
  csrfToken: string;
  arten: ArtZeile[];
  symbole: string[];
  /** Blendet den Hinweis ein, wo verliehen wird. */
  darfVerleihen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  /** `null` = zu, `'neu'` = Anlegen, sonst die ID der Zeile, die bearbeitet wird. */
  const [offen, setOffen] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>(LEER);

  const aktive = arten.filter((art) => !art.archiviert);
  const archivierte = arten.filter((art) => art.archiviert);

  const oeffneNeu = (): void => {
    setEntwurf(LEER);
    setOffen('neu');
  };

  const oeffneBearbeiten = (art: ArtZeile): void => {
    setEntwurf({
      label: art.label,
      beschreibung: art.beschreibung,
      symbol: art.symbol,
      stufe: art.stufe,
      aktiv: art.aktiv,
    });
    setOffen(art.id);
  };

  const speichern = (): void => {
    starte(async () => {
      const antwort =
        offen === 'neu'
          ? await auszeichnungAnlegenAction({ csrfToken, ...entwurf })
          : await auszeichnungBearbeitenAction({ csrfToken, id: offen!, ...entwurf });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(offen === 'neu' ? 'Angelegt.' : 'Gespeichert.');
      setOffen(null);
      router.refresh();
    });
  };

  const archivieren = (art: ArtZeile): void => {
    starte(async () => {
      const antwort = await auszeichnungArchivierenAction({ csrfToken, id: art.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(`«${art.label}» archiviert. Verliehene bleiben bestehen.`);
      router.refresh();
    });
  };

  const zurueckholen = (art: ArtZeile): void => {
    starte(async () => {
      const antwort = await auszeichnungZurueckholenAction({ csrfToken, id: art.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(`«${art.label}» zurückgeholt - abgeschaltet, bis du sie aktivierst.`);
      router.refresh();
    });
  };

  const entfernen = (art: ArtZeile): void => {
    if (
      !window.confirm(
        `«${art.label}» endgültig entfernen? Das lässt sich nicht rückgängig machen. Archivieren behält sie lesbar.`,
      )
    ) {
      return;
    }
    starte(async () => {
      const antwort = await auszeichnungEntfernenAction({ csrfToken, id: art.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(`«${art.label}» entfernt.`);
      router.refresh();
    });
  };

  const formular = (
    <div className="space-y-3 rounded-xl border border-primary-bright/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {offen === 'neu' ? 'Neue Auszeichnung' : 'Auszeichnung bearbeiten'}
        </p>
        <button
          type="button"
          onClick={() => setOffen(null)}
          className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          Abbrechen
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            type="text"
            value={entwurf.label}
            maxLength={40}
            onChange={(ereignis) => setEntwurf((v) => ({ ...v, label: ereignis.target.value }))}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
            placeholder="z.B. Turnierhelfer"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Stufe</span>
          <select
            value={entwurf.stufe}
            onChange={(ereignis) => setEntwurf((v) => ({ ...v, stufe: ereignis.target.value as Stufe }))}
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            {STUFEN.map((stufe) => (
              <option key={stufe.wert} value={stufe.wert}>
                {stufe.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Beschreibung</span>
        <input
          type="text"
          value={entwurf.beschreibung}
          maxLength={160}
          onChange={(ereignis) => setEntwurf((v) => ({ ...v, beschreibung: ereignis.target.value }))}
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
          placeholder="Ein Satz: wofür gibt es sie?"
        />
      </label>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">Symbol</legend>
        <div className="flex flex-wrap gap-1.5">
          {symbole.map((symbol) => (
            <button
              key={symbol}
              type="button"
              aria-pressed={entwurf.symbol === symbol}
              aria-label={symbol}
              onClick={() => setEntwurf((v) => ({ ...v, symbol }))}
              className={`grid size-10 place-items-center rounded-lg border transition-colors [&_svg]:size-4 ${
                entwurf.symbol === symbol
                  ? 'border-primary-bright bg-primary-bright/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <NavIcon name={symbol} />
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={entwurf.aktiv}
          onChange={(ereignis) => setEntwurf((v) => ({ ...v, aktiv: ereignis.target.checked }))}
          className="size-4 rounded border-border"
        />
        Wird vergeben
        <span className="text-xs text-muted-foreground">
          - abgeschaltet heisst: keine neuen Verleihungen, bestehende bleiben.
        </span>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={laeuft || entwurf.label.trim().length < 2 || entwurf.beschreibung.trim().length < 4}
          onClick={speichern}
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          {offen === 'neu' ? 'Anlegen' : 'Speichern'}
        </button>
      </div>
    </div>
  );

  const karte = (art: ArtZeile): React.JSX.Element => (
    <li
      key={art.id}
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        art.archiviert ? 'border-dashed border-border opacity-70' : STUFEN_FARBE[art.stufe]
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary [&_svg]:size-4">
          <NavIcon name={art.symbol} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{art.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{art.beschreibung}</p>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[0.7rem]">{art.key}</span>
        <span>{art.archiviert ? 'Archiviert' : art.aktiv ? 'Wird vergeben' : 'Nicht mehr vergeben'}</span>
        <span aria-hidden="true">·</span>
        <span>
          {art.verliehen} {art.verliehen === 1 ? 'Mitglied' : 'Mitglieder'}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={laeuft}
          onClick={() => oeffneBearbeiten(art)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:border-primary-bright disabled:opacity-50"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Bearbeiten
        </button>

        {art.archiviert ? (
          <button
            type="button"
            disabled={laeuft}
            onClick={() => zurueckholen(art)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <ArchiveRestore className="size-4" aria-hidden="true" />
            Zurückholen
          </button>
        ) : (
          <button
            type="button"
            disabled={laeuft}
            onClick={() => archivieren(art)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Archive className="size-4" aria-hidden="true" />
            Archivieren
          </button>
        )}

        {/* Entfernen steht nur dort, wo es auch gelingen kann. Ein Knopf, der
            verlässlich in eine Fehlermeldung läuft, ist keiner. */}
        {art.verliehen === 0 ? (
          <button
            type="button"
            disabled={laeuft}
            onClick={() => entfernen(art)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Entfernen
          </button>
        ) : null}
      </div>
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Diese Auszeichnungen vergibt ein Mensch - für das, wofür es keine Zahl gibt. Verliehen werden sie in
          der Akte eines Mitglieds, unter «Community».
          {darfVerleihen ? (
            <>
              {' '}
              <Link href={systemRoutes.mitglieder()} className="text-primary-bright hover:underline">
                Zu den Mitgliedern
              </Link>
            </>
          ) : null}
        </p>
        {offen === null ? (
          <button type="button" onClick={oeffneNeu} className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus aria-hidden="true" />
            Neue Auszeichnung
          </button>
        ) : null}
      </div>

      {offen === 'neu' ? formular : null}

      {aktive.length === 0 && offen !== 'neu' ? (
        <EmptyState
          title="Noch keine verleihbaren Auszeichnungen"
          description="Lege eine an - etwa für Leute, die den Server tragen, ohne dass es dafür eine Statistik gibt."
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {aktive.map((art) => (offen === art.id ? <li key={art.id}>{formular}</li> : karte(art)))}
        </ul>
      )}

      {archivierte.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Archiviert</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Werden nicht mehr vergeben. Wer sie hat, behält sie - am Profil stehen sie weiterhin.
            </p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
            {archivierte.map((art) => (offen === art.id ? <li key={art.id}>{formular}</li> : karte(art)))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
