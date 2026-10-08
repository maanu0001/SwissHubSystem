'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { KOPF_KNOPF, KOPF_SYMBOL } from '@/lib/kopfzeile-geometrie';
import { BrandMark } from '@/components/shared/brand-mark';
import { SidebarNav, type NavigationGroup } from './sidebar-nav';

/**
 * Navigation als Drawer auf kleinen Bildschirmen.
 *
 * Nicht die schmalere Seitenleiste, sondern dieselbe Navigation mit
 * Fingermassen: hoehere Eintraege, mehr Luft zwischen den Abschnitten, und
 * die Marke oben mit Abstand statt buendig am Rand. Die Eintraege selbst -
 * Reihenfolge, Gruppen, Sichtbarkeit - sind dieselben; eine zweite Liste
 * waere eine, die irgendwann etwas anderes zeigt als die erste.
 */
export function MobileNav({
  groups,
  logoUrl,
}: {
  groups: NavigationGroup[];
  logoUrl?: string | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={cn(KOPF_KNOPF, 'lg:hidden')} aria-label="Navigation öffnen">
          <Menu className={KOPF_SYMBOL} aria-hidden="true" />
        </button>
      </DialogTrigger>
      {/*
        Die Geometrie steht als Name da und nicht als Gegenklassen-Liste.

        Vorher war sie das: `left-0 top-0 h-dvh translate-x-0 translate-y-0`
        gegen die mittige Vorgabe des Dialogs. Die Position wurde dadurch
        richtig - der Auftritt nicht. `zoom-in-95` hat keine Gegenklasse und
        blieb stehen, also wuchs der Drawer aus seiner eigenen Mitte: gemessen
        7,6 Pixel Seitwaertsweg der linken Kante, 15,2 Pixel Breite, 42 bis 59
        Pixel Hoehe waehrend der 200 Millisekunden. Das ist das Wackeln.

        `max-w-[calc(100%-3rem)]` statt `max-w-[85vw]`: `vw` zaehlt eine
        Bildlaufleiste mit, die es dort gar nicht gibt, und ergibt auf fast
        jedem Geraet eine gebrochene Pixelzahl. Prozent bezieht sich auf das,
        was der Browser tatsaechlich hat.

        `scrollbar-gutter: stable` haelt die Rinne frei, auch wenn die Liste
        einmal kuerzer ist als der Bildschirm. Sonst waere die nutzbare Breite
        auf der einen Seite acht Pixel groesser als auf der anderen - und die
        Navigation auf jeder Seite ein kleines Stueck anders.

        Die Abstaende stehen einzeln statt als `p-5`, weil links und unten die
        Aussparung gewinnen muss: quer gehalten liegt die Notch ueber der
        linken Kante des Drawers, und unten faehrt in iOS Safari die Leiste
        darueber. `max()` und nie `calc(... + ...)` - dieselbe Regel wie in
        Kopfzeile und Inhaltsbereich.
      */}
      <DialogContent
        geometrie="drawer"
        className="w-[19rem] max-w-[calc(100%-3rem)] overflow-y-auto rounded-none border-y-0 border-l-0 bg-sidebar pr-5 pt-5 scrollbar-slim [scrollbar-gutter:stable] pl-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="space-y-7 pb-6">
          <BrandMark logoUrl={logoUrl} />
          <SidebarNav groups={groups} touch onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
