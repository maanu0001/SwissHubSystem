'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarRange, Loader2, Plus } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { ausgabeErzeugenAction } from '@/modules/wrapped/ausgabe-aktionen';

/**
 * Eine Ausgabe von Hand erzeugen.
 *
 * ## Warum das auch der Weg fuer die Vergangenheit ist
 *
 * Der Job erzeugt den zuletzt abgeschlossenen Monat und das zuletzt
 * abgeschlossene Jahr - Wochen gar nicht. Wer weiter zurueck will, weil das
 * Modul erst jetzt eingeschaltet wurde, oder eine einzelne Woche will, weil in
 * ihr etwas war, traegt den Zeitraum hier ein. Erfunden wird dabei nichts: die Stories arbeiten auf
 * denselben Daten und lassen weg, wozu es nichts gibt. Ein Monat vor Beginn
 * der Sprachzeitmessung bekommt eben keine Sprachzeit-Folie.
 */
type PeriodenArt = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** Beschriftung und Eingabemuster je Art - an einer Stelle, nicht an dreien. */
const ARTEN: ReadonlyArray<{ wert: PeriodenArt; label: string; muster: string }> = [
  { wert: 'WEEKLY', label: 'Woche', muster: 'JJJJ-WNN' },
  { wert: 'MONTHLY', label: 'Monat', muster: 'JJJJ-MM' },
  { wert: 'YEARLY', label: 'Jahr', muster: 'JJJJ' },
];

export function AusgabeAnlegen({
  csrfToken,
  wochenVorschlag,
  monatsVorschlag,
  jahresVorschlag,
}: {
  csrfToken: string;
  wochenVorschlag: string;
  monatsVorschlag: string;
  jahresVorschlag: string;
}): React.JSX.Element {
  const router = useRouter();
  const [art, setArt] = useState<PeriodenArt>('MONTHLY');
  const [key, setKey] = useState(monatsVorschlag);
  const [laeuft, setLaeuft] = useState(false);

  const vorschlaege: Record<PeriodenArt, string> = {
    WEEKLY: wochenVorschlag,
    MONTHLY: monatsVorschlag,
    YEARLY: jahresVorschlag,
  };

  const wechsle = (neu: PeriodenArt): void => {
    setArt(neu);
    setKey(vorschlaege[neu]);
  };

  const erzeugen = async (): Promise<void> => {
    setLaeuft(true);
    const antwort = await ausgabeErzeugenAction({ csrfToken, type: art, periodKey: key.trim() });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    if (!antwort.data?.neu) {
      toast.info('Diese Ausgabe gibt es bereits.');
    } else {
      toast.success(`Erhoben: ${antwort.data.folien} Folien, ${antwort.data.uebersprungen} übersprungen.`);
    }
    if (antwort.data?.editionId) {
      router.push(systemRoutes.wrappedAusgabe(antwort.data.editionId));
    }
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="text-sm font-medium">Ausgabe erzeugen</p>
        <p className="text-xs text-muted-foreground">
          Nur für abgeschlossene Zeiträume. Ein laufender Monat hätte morgen andere Zahlen. Wochen zählen
          nach ISO 8601 - Montag bis Sonntag.
        </p>
      </div>

      <div className="flex gap-2">
        {ARTEN.map(({ wert, label }) => (
          <button
            key={wert}
            type="button"
            aria-pressed={art === wert}
            onClick={() => wechsle(wert)}
            className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
              art === wert
                ? 'border-primary-bright bg-primary-bright/12'
                : 'border-border text-muted-foreground hover:border-foreground/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="min-w-0">
        <span className="sr-only">Zeitraum</span>
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={ARTEN.find((eintrag) => eintrag.wert === art)?.muster}
          className="h-10 w-32 rounded-lg border border-border bg-card px-3 text-sm tabular-nums outline-none focus-visible:border-primary-bright"
        />
      </label>

      <button
        type="button"
        onClick={() => void erzeugen()}
        disabled={laeuft || key.trim().length === 0}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary-bright px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
      >
        {laeuft ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        Erheben
      </button>
    </div>
  );
}

export interface AusgabeZeile {
  id: string;
  type: PeriodenArt;
  periodKey: string;
  titel: string;
  status: string;
  folien: number;
  generatedAt: Date | null;
  failureReason: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Entwurf',
  FINALIZED: 'Eingefroren',
  PUBLISHED: 'Veröffentlicht',
  ARCHIVED: 'Archiviert',
};

const STATUS_FARBE: Record<string, string> = {
  DRAFT: 'border-border text-muted-foreground',
  FINALIZED: 'border-info/40 text-info',
  PUBLISHED: 'border-success/40 text-success',
  ARCHIVED: 'border-border text-muted-foreground',
};

export function AusgabenListe({ ausgaben }: { ausgaben: AusgabeZeile[] }): React.JSX.Element {
  if (ausgaben.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        Noch keine Ausgabe. Sobald ein Monat vorbei ist, erzeugt der Bot eine - oder du erhebst hier einen
        vergangenen Zeitraum.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ausgaben.map((ausgabe) => (
        <li key={ausgabe.id} className="min-w-0">
          <Link
            href={systemRoutes.wrappedAusgabe(ausgabe.id)}
            className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary-bright/60"
          >
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                {ARTEN.find((eintrag) => eintrag.wert === ausgabe.type)?.label ?? ausgabe.type}
              </span>
              <span
                className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[0.65rem] ${
                  STATUS_FARBE[ausgabe.status] ?? STATUS_FARBE.DRAFT
                }`}
              >
                {STATUS_TEXT[ausgabe.status] ?? ausgabe.status}
              </span>
            </div>

            <p className="break-words text-base font-semibold leading-tight">{ausgabe.titel}</p>

            {ausgabe.failureReason ? (
              <p className="text-xs text-destructive">Erhebung gescheitert: {ausgabe.failureReason}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ausgabe.folien} {ausgabe.folien === 1 ? 'Folie' : 'Folien'}
                {ausgabe.generatedAt
                  ? ` · erhoben am ${ausgabe.generatedAt.toLocaleDateString('de-CH')}`
                  : ' · noch nicht erhoben'}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
