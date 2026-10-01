'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, Lock, Plus } from 'lucide-react';
import { aendereEigeneRolleAction } from '../actions';
import { cn } from '@/lib/utils';

/**
 * Der Knopf an einer Rolle.
 *
 * ## Vier Zustände, und jeder sagt etwas anderes
 *
 * 1. **Nehmen.** Die Rolle ist frei und du hast sie nicht.
 * 2. **Du hast sie.** Mit Haken; ein Klick gibt sie wieder ab, wenn das
 *    erlaubt ist.
 * 3. **Gesperrt.** Mit Grund im `title` - kein stummer, grauer Knopf.
 * 4. **Kein Knopf.** Die Rolle ist nicht zur Selbstvergabe gedacht; dann ist
 *    auch kein Platzhalter dafür nötig.
 *
 * ## Warum der Knopf nichts entscheidet
 *
 * Er zeigt nur, was der Server beim Aufbau der Seite geantwortet hat. Ob die
 * Zuweisung geschieht, entscheidet `aendereEigeneRolle` beim Klick noch
 * einmal - die Seite kann Minuten alt sein. Ein manipuliertes `disabled` im
 * Browser bringt deshalb nichts.
 */
export function RollenKnopf({
  discordRoleId,
  name,
  csrfToken,
  hatSie,
  vergebbar,
  entfernbar,
  sperrText,
}: {
  discordRoleId: string;
  name: string;
  csrfToken: string;
  hatSie: boolean;
  vergebbar: boolean;
  entfernbar: boolean;
  sperrText: string | null;
}): React.JSX.Element | null {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  if (!vergebbar && !hatSie) {
    // Gesperrt und begründet: eine Erklärung ist mehr wert als ein Knopf, der
    // nichts tut. Ohne Grund gibt es gar nichts - dann ist es einfach eine
    // Rolle, die das Team verteilt.
    return sperrText ? (
      <span
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2.5 text-xs text-muted-foreground"
        title={sperrText}
      >
        <Lock className="size-3.5 shrink-0" aria-hidden="true" />
        Vom Team verteilt
      </span>
    ) : null;
  }

  const richtung = hatSie ? 'entfernen' : 'hinzufuegen';
  const gesperrt = laeuft || (hatSie && !entfernbar);

  const klick = (): void => {
    starte(async () => {
      const antwort = await aendereEigeneRolleAction({ csrfToken, discordRoleId, richtung });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (!antwort.data.erfolg) {
        // Kein Fehler, sondern eine Antwort: «darfst du nicht» kommt als Satz
        // zurück und nicht als rote Störung.
        toast.info(antwort.data.nachricht);
        router.refresh();
        return;
      }
      toast.success(antwort.data.nachricht);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={klick}
      disabled={gesperrt}
      aria-label={hatSie ? `${name} abgeben` : `${name} nehmen`}
      title={hatSie && !entfernbar ? 'Diese Rolle lässt sich nicht selbst abgeben.' : undefined}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        hatSie
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {laeuft ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : hatSie ? (
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Plus className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {hatSie ? 'Du hast sie' : 'Nehmen'}
    </button>
  );
}
