'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Die Bereiche des Level-Systems.
 *
 * Wie bei den uebrigen Modulen: hier steht die Uebersetzung auf die
 * gemeinsame Leiste, nicht die Leiste selbst. Welche Bereiche jemand sieht,
 * entscheidet weiterhin die Berechtigungspruefung, die die Liste baut; jede
 * Seite prueft zusaetzlich serverseitig.
 */
export interface LevelSection {
  href: string;
  label: string;
  icon: keyof typeof SYMBOLE;
}

/** Die Bereichsschluessel auf Namen der gemeinsamen Symbolregistry. */
const SYMBOLE = {
  overview: 'LayoutDashboard',
  members: 'Users',
  leaderboard: 'Trophy',
  games: 'Dice5',
  slot: 'Cherry',
  roles: 'Shield',
  rules: 'Gauge',
  voice: 'Mic',
  card: 'IdCard',
  raffle: 'Ticket',
  decay: 'Moon',
  stats: 'LayoutDashboard',
  import: 'Database',
  settings: 'Settings',
} as const;

export function LevelSectionNav({ sections }: { sections: LevelSection[] }): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = sections.map((section) => ({
    href: section.href,
    label: section.label,
    icon: SYMBOLE[section.icon],
  }));

  return <ModulNavigation eintraege={eintraege} label="Level-System" />;
}
