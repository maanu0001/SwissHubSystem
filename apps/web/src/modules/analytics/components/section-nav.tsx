'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';
import type { AnalyticsSection } from '@/modules/analytics/sections';

/**
 * Die Bereiche des Analytics-Moduls.
 *
 * ## Warum hier fast nichts steht
 *
 * Weil die Leiste allen Modulen gehoert. Hier liegt nur die Uebersetzung von
 * den Bereichen dieses Moduls auf die Eintraege der gemeinsamen Navigation -
 * welche Bereiche es gibt und wer sie sehen darf, entscheidet weiterhin
 * `sections.ts` serverseitig.
 *
 * Vorher stand hier eine eigene Leiste mit eigenen Klassen, eigenem aktivem
 * Zustand und eigenem Verhalten auf schmalen Geraeten. Sie war nicht falsch -
 * sie war die zehnte ihrer Art, und keine zwei sahen gleich aus.
 */
export function AnalyticsSectionNav({
  sections,
}: {
  sections: AnalyticsSection[];
}): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = sections.map((section) => ({
    href: section.href,
    label: section.label,
  }));

  return <ModulNavigation eintraege={eintraege} label="Analytics-Bereiche" />;
}
