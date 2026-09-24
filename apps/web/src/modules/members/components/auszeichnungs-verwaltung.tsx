'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { NavIcon } from '@/components/layout/nav-icon';
import { entzieheAuszeichnungAction, verleiheAuszeichnungAction } from '../actions';

interface Art {
  key: string;
  label: string;
  beschreibung: string;
  symbol: string;
  stufe: 'bronze' | 'silber' | 'gold';
  /**
   * Laesst sie sich gerade vergeben?
   *
   * `false` bei abgeschalteten und archivierten Arten. Sie stehen trotzdem
   * in der Liste, wenn dieses Mitglied sie **hat** - sonst verschwaende mit
   * der Karte auch der Knopf, mit dem man sie entzieht.
   */
  vergebbar: boolean;
}

interface Verliehen {
  key: string;
  am: string;
  notiz: string | null;
}

const STUFEN_FARBE: Record<Art['stufe'], string> = {
  gold: 'border-[#e0a83a]/50 bg-[#e0a83a]/10',
  silber: 'border-border bg-card',
  bronze: 'border-[#a86a3a]/40 bg-[#a86a3a]/10',
};

/**
 * Verleihen und entziehen.
 *
 * Die Liste zeigt **alle** verleihbaren Arten, nicht nur die vergebenen:
 * wer eine verleihen will, soll nicht erst wissen muessen, welche es gibt.
 * Was schon vergeben ist, traegt das Datum und die Begruendung.
 *
 * Nach jeder Aktion `router.refresh()` - der Server hat die Wahrheit, und
 * die oeffentliche Seite wurde gerade neu geladen. Einen eigenen Zustand
 * hier zu fuehren hiesse, zwei Wahrheiten zu haben.
 */
export function AuszeichnungsVerwaltung({
  discordId,
  csrfToken,
  arten,
  verliehen,
}: {
  discordId: string;
  csrfToken: string;
  arten: Art[];
  verliehen: Verliehen[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [notizen, setNotizen] = useState<Record<string, string>>({});
  const vergeben = new Map(verliehen.map((eintrag) => [eintrag.key, eintrag]));

  const verleihen = (key: string): void => {
    starte(async () => {
      const antwort = await verleiheAuszeichnungAction({
        csrfToken,
        discordId,
        key,
        notiz: notizen[key]?.trim() || null,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(antwort.data?.neu ? 'Verliehen.' : 'Hatte diese Auszeichnung schon.');
      setNotizen((vorher) => ({ ...vorher, [key]: '' }));
      router.refresh();
    });
  };

  const entziehen = (key: string): void => {
    starte(async () => {
      const antwort = await entzieheAuszeichnungAction({ csrfToken, discordId, key });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Entzogen.');
      router.refresh();
    });
  };

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
      {arten.map((art) => {
        const hat = vergeben.get(art.key);
        return (
          <li
            key={art.key}
            className={`flex flex-col gap-3 rounded-xl border p-4 ${hat ? STUFEN_FARBE[art.stufe] : 'border-dashed border-border'}`}
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary [&_svg]:size-4">
                <NavIcon name={art.symbol} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{art.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{art.beschreibung}</p>
              </div>
            </div>

            {hat ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-success" aria-hidden="true" />
                  Verliehen am {hat.am}
                </p>
                {hat.notiz ? <p className="text-xs italic text-muted-foreground">«{hat.notiz}»</p> : null}
                <button
                  type="button"
                  disabled={laeuft}
                  onClick={() => entziehen(art.key)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden="true" />
                  Entziehen
                </button>
              </div>
            ) : !art.vergebbar ? (
              <p className="text-xs text-muted-foreground">Wird nicht mehr vergeben.</p>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={notizen[art.key] ?? ''}
                  onChange={(ereignis) =>
                    setNotizen((vorher) => ({ ...vorher, [art.key]: ereignis.target.value }))
                  }
                  placeholder="Begründung (freiwillig)"
                  maxLength={200}
                  className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  disabled={laeuft}
                  onClick={() => verleihen(art.key)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:border-primary-bright disabled:opacity-50"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Verleihen
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
