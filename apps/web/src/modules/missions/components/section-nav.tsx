'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';
import type { MissionsAbschnitt } from '@/server/missionen';

/**
 * Die vier Bereiche des Moduls.
 *
 * Wie bei den uebrigen Modulen steht hier fast nichts: die Leiste gehoert
 * allen Modulen, und welche Bereiche es gibt und wer sie sehen darf,
 * entscheidet `missionen.ts` serverseitig.
 */
export function MissionsSectionNav({
  abschnitte,
}: {
  abschnitte: MissionsAbschnitt[];
}): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = abschnitte.map((abschnitt) => ({
    href: abschnitt.href,
    label: abschnitt.label,
  }));

  return <ModulNavigation eintraege={eintraege} label="Missionsbereiche" />;
}
