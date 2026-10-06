'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { TocEintrag } from '../register';

/**
 * «Auf dieser Seite» - und welche Ueberschrift gerade sichtbar ist.
 *
 * ## Warum ein IntersectionObserver und kein Scroll-Handler
 *
 * Ein `scroll`-Listener feuert bei jedem Pixel; auf dem Telefon ist das die
 * Art von Arbeit, die eine Seite ruckeln laesst. Der Observer meldet nur,
 * wenn eine Ueberschrift die Marke kreuzt.
 *
 * Die Spalte gibt es erst ab `xl`. Darunter wuerde sie den Lesetext
 * schmaler machen, und das Inhaltsverzeichnis links beantwortet dieselbe
 * Frage schon.
 */
export function AufDieserSeite({
  eintraege,
}: {
  eintraege: readonly TocEintrag[];
}): React.JSX.Element | null {
  const [aktiv, setAktiv] = useState<string | null>(eintraege[0]?.anker ?? null);

  useEffect(() => {
    if (eintraege.length === 0) {
      return;
    }
    const knoten = eintraege
      .map((eintrag) => document.getElementById(eintrag.anker))
      .filter((element): element is HTMLElement => element !== null);

    const beobachter = new IntersectionObserver(
      (eintritte) => {
        const sichtbar = eintritte
          .filter((eintritt) => eintritt.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (sichtbar) {
          setAktiv(sichtbar.target.id);
        }
      },
      // Die Marke liegt im oberen Viertel: eine Ueberschrift gilt als
      // «hier», sobald sie oben steht - nicht erst in der Mitte.
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    for (const element of knoten) {
      beobachter.observe(element);
    }
    return () => beobachter.disconnect();
  }, [eintraege]);

  if (eintraege.length < 2) {
    // Eine Ueberschrift ist kein Inhaltsverzeichnis.
    return null;
  }

  return (
    <div className="hidden xl:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <p className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Auf dieser Seite
        </p>
        <ul className="space-y-1 border-l border-border/60">
          {eintraege.map((eintrag) => (
            <li key={eintrag.anker}>
              <a
                href={`#${eintrag.anker}`}
                className={cn(
                  '-ml-px block border-l-2 py-0.5 text-[13px] leading-snug transition-colors',
                  eintrag.ebene === 3 ? 'pl-5' : 'pl-3',
                  aktiv === eintrag.anker
                    ? 'border-primary font-medium text-primary-bright'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {eintrag.titel}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
