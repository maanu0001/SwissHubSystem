'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';
import type { GameserverAbschnitt } from '@/server/gameserver';

/**
 * Die Bereiche der Gameserver-Verwaltung.
 *
 * Dieselbe Leiste wie überall - welche Bereiche es gibt und wer sie sehen
 * darf, entscheidet `gameserver.ts` serverseitig.
 */
export function GameserverSectionNav({
  abschnitte,
}: {
  abschnitte: GameserverAbschnitt[];
}): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = abschnitte.map((abschnitt) => ({
    href: abschnitt.href,
    label: abschnitt.label,
  }));

  return <ModulNavigation eintraege={eintraege} label="Gameserver-Bereiche" />;
}
