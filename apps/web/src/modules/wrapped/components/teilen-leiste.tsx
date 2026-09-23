'use client';

import { Download, RotateCcw } from 'lucide-react';
import { KARTEN_FORMATE, type KartenSeite } from '@/modules/wrapped/share-karte';

/**
 * Die Leiste am Ende.
 *
 * ## Warum erst am Ende
 *
 * Ein Teilen-Knopf neben der zweiten Szene fragt nach einer Entscheidung,
 * bevor es etwas zu entscheiden gibt. Wer bis zum Abspann gekommen ist,
 * hat seinen Rueckblick gesehen und weiss, was auf einer Karte stuende.
 *
 * ## Warum ein Download und kein «Teilen auf …»
 *
 * Weil die Anwendung dann wissen muesste, wohin - und das ginge sie nichts
 * an. Sie liefert ein Bild; was damit geschieht, entscheidet die Person,
 * die es herunterlaedt.
 */
export function TeilenLeiste({
  schluessel,
  seite = 'story',
  aufZurueck,
}: {
  schluessel: string;
  seite?: KartenSeite;
  /** Noch einmal von vorn. */
  aufZurueck: () => void;
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black/70 p-2 backdrop-blur">
        {KARTEN_FORMATE.map((format) => (
          <a
            key={format.key}
            href={`/api/wrapped/share/${encodeURIComponent(schluessel)}?format=${format.key}&seite=${seite}`}
            // `download` ist ein Vorschlag; den endgueltigen Namen setzt der
            // Server im `Content-Disposition`. Beides, damit der Name auch
            // dann stimmt, wenn ein Browser das eine ignoriert.
            download
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {format.label}
          </a>
        ))}

        <button
          type="button"
          onClick={aufZurueck}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/60 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Nochmal
        </button>
      </div>
    </div>
  );
}
