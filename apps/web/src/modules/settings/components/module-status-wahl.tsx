'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ModulStatus } from '@swisshub/modules';
import { setModulStatusAction } from '@/modules/settings/actions';
import { cn } from '@/lib/utils';

/**
 * Der Statuswechsel eines Moduls - direkt in der Modulverwaltung.
 *
 * ## Warum drei Knoepfe und kein Schalter
 *
 * Hier stand ein Schalter mit zwei Stellungen. Drei Zustaende passen nicht
 * auf zwei Stellungen, und ein Schalter mit einem Aufklappmenue daneben waere
 * zwei Bedienelemente fuer eine Frage.
 *
 * Drei Knoepfe nebeneinander zeigen ausserdem, was es ueberhaupt gibt -
 * «Testmodus» ist neu, und niemand sucht nach einer Moeglichkeit, von der er
 * nicht weiss. Der aktuelle Zustand ist der hervorgehobene.
 *
 * ## Warum der Zustand sofort umspringt
 *
 * Damit das Druecken sich nach etwas anfuehlt. Scheitert der Aufruf, springt
 * er zurueck und die Meldung sagt, warum - das ist der ehrlichere Weg als ein
 * Knopf, der eine Sekunde lang nichts tut.
 */

const STUFEN: { status: ModulStatus; label: string; hinweis: string }[] = [
  {
    status: 'AKTIV',
    label: 'Aktiv',
    hinweis: 'Für alle Mitglieder sichtbar, entsprechend ihren Berechtigungen.',
  },
  {
    status: 'TESTMODUS',
    label: 'Testmodus',
    hinweis: 'Nur für berechtigte Admins und Moderatoren sichtbar.',
  },
  {
    status: 'DEAKTIVIERT',
    label: 'Deaktiviert',
    hinweis: 'Vollständig abgeschaltet - auch für das Team.',
  },
];

export function ModulStatusWahl({
  csrfToken,
  moduleId,
  moduleName,
  status,
  disabled = false,
}: {
  csrfToken: string;
  moduleId: string;
  moduleName: string;
  status: ModulStatus;
  disabled?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [aktuell, setAktuell] = useState<ModulStatus>(status);
  const [laeuft, setLaeuft] = useState(false);

  async function wechsle(naechster: ModulStatus): Promise<void> {
    if (naechster === aktuell) {
      return;
    }
    const vorher = aktuell;
    setLaeuft(true);
    setAktuell(naechster);

    const antwort = await setModulStatusAction({ csrfToken, moduleId, status: naechster });
    setLaeuft(false);

    if (antwort.ok) {
      const text =
        naechster === 'TESTMODUS'
          ? `${moduleName} läuft jetzt im Testmodus - nur für das Team sichtbar.`
          : naechster === 'AKTIV'
            ? `${moduleName} ist jetzt aktiv.`
            : `${moduleName} wurde deaktiviert.`;
      toast.success(text);
      router.refresh();
    } else {
      setAktuell(vorher);
      toast.error(antwort.error.message);
    }
  }

  return (
    <div
      role="group"
      aria-label={`Status von ${moduleName}`}
      /* Auf dem Telefon umbrechend statt scrollend: drei kurze Woerter
         passen in zwei Zeilen, und eine Statuswahl, die man wischen muss,
         verbirgt die dritte Moeglichkeit. */
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-card/60 p-1"
    >
      {STUFEN.map((stufe) => {
        const gewaehlt = stufe.status === aktuell;
        return (
          <button
            key={stufe.status}
            type="button"
            onClick={() => void wechsle(stufe.status)}
            disabled={disabled || laeuft}
            aria-pressed={gewaehlt}
            title={stufe.hinweis}
            className={cn(
              'min-h-9 rounded-md px-3 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-60',
              gewaehlt
                ? stufe.status === 'TESTMODUS'
                  ? 'bg-warning/20 text-warning ring-1 ring-warning/50'
                  : stufe.status === 'AKTIV'
                    ? 'bg-success/15 text-success ring-1 ring-success/40'
                    : 'bg-destructive/15 text-destructive ring-1 ring-destructive/40'
                : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
            )}
          >
            {stufe.label}
          </button>
        );
      })}
    </div>
  );
}
