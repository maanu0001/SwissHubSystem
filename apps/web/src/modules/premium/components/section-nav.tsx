'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';
import type { PremiumSection, PremiumSectionIcon } from '@/modules/premium/sections';

/**
 * Die Bereiche des Premium-Moduls.
 *
 * Die gemeinsame Leiste, wie ueberall. Angezeigt wird nur, wofuer die
 * Berechtigung vorliegt - jede Seite prueft zusaetzlich serverseitig.
 */
const SYMBOLE: Record<PremiumSectionIcon, string> = {
  overview: 'LayoutGrid',
  subscriptions: 'Users',
  products: 'Package',
  payments: 'CreditCard',
  stuebli: 'Mic',
  settings: 'Settings',
  me: 'Crown',
};

export function PremiumSectionNav({ sections }: { sections: PremiumSection[] }): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = sections.map((section) => ({
    href: section.href,
    label: section.label,
    icon: SYMBOLE[section.icon],
  }));

  return <ModulNavigation eintraege={eintraege} label="Premium" />;
}
