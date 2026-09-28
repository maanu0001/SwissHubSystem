'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';
import { cn } from '@/lib/utils';
import { teileBereiche, type TicketSection } from './bereiche';

export type { TicketSection };

/**
 * Die Kopfzeile des Ticket-Moduls.
 *
 * Links die Bereiche, in denen man arbeitet; rechts ein Zahnrad mit denen,
 * die das Modul einstellen. Vorher standen alle zwoelf nebeneinander und
 * sahen gleich wichtig aus - «Panels» so gross wie «Offene Tickets».
 *
 * Weggefallen ist keiner: das Zahnrad ist ein zweiter Platz in derselben
 * Zeile, kein Versteck. Wer gerade auf einer Einrichtungsseite steht, sieht
 * das am Zahnrad selbst - sonst waere man an einer Stelle, die die Navigation
 * nicht mehr anzeigt.
 *
 * ## Was sich geaendert hat und was nicht
 *
 * Die Reiter links sind jetzt die gemeinsame `ModulNavigation` - dieselbe
 * Leiste wie in jedem anderen Modul. Die Zweiteilung bleibt: sie ist eine
 * Entscheidung ueber **Wichtigkeit** und nicht ueber Aussehen, und eine
 * gemeinsame Gestaltung ist kein Grund, sie aufzugeben. Genau das meint
 * «konsistente Grundsprache, weiterhin modulbezogene Identitaet».
 */
export function TicketSectionNav({ sections }: { sections: TicketSection[] }): React.JSX.Element {
  const pfad = usePathname();
  const { arbeit, einrichtung } = teileBereiche(sections);
  const inEinrichtung = einrichtung.some((section) => pfad === section.href);

  const eintraege: ModulNavigationEintrag[] = arbeit.map((section) => ({
    href: section.href,
    label: section.label,
  }));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {/*
        Ein einzelner Arbeitsbereich ergibt keine Leiste - `ModulNavigation`
        gibt dann `null` zurueck. Das Zahnrad bleibt trotzdem stehen, sonst
        waere die Einrichtung von dieser Seite aus nicht erreichbar.
      */}
      <ModulNavigation eintraege={eintraege} label="Ticket-Bereiche" className="min-w-0 flex-1" />

      {einrichtung.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Einrichtung"
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              inEinrichtung ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
            Einrichtung
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Einrichtung</DropdownMenuLabel>
            {einrichtung.map((section) => (
              <DropdownMenuItem key={section.href} asChild>
                <Link href={section.href} aria-current={pfad === section.href ? 'page' : undefined}>
                  {section.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
