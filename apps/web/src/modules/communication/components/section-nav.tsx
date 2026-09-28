'use client';

import { ModulNavigation, type ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Die Bereiche des Kommunikationsmoduls.
 *
 * ## Warum hier fast nichts steht
 *
 * Weil die Leiste allen Modulen gehoert. Hier liegt nur die Uebersetzung von
 * den Bereichen dieses Moduls auf die Eintraege der gemeinsamen Navigation -
 * welche Bereiche es gibt und wer sie sehen darf, entscheidet weiterhin
 * serverseitig, wer die Liste zusammenstellt.
 *
 * ## Warum die Symbole Namen sind und keine Komponenten
 *
 * Diese Datei stand frueher mit einer eigenen `ICONS`-Zuordnung da, die drei
 * Lucide-Komponenten auf drei Schluessel abbildete - genau wie Level und
 * Premium, mit drei verschiedenen Zuordnungen. Die gemeinsame Leiste schlaegt
 * Symbole in **einer** Registry nach (`nav-icon.tsx`), und `SymbolName` macht
 * einen Namen, den es nicht gibt, zum Uebersetzungsfehler.
 */
export interface CommunicationSection {
  href: string;
  label: string;
  icon: 'compose' | 'history' | 'settings';
}

/** Die Bereichsschluessel dieses Moduls auf Namen der gemeinsamen Registry. */
const SYMBOLE: Record<CommunicationSection['icon'], string> = {
  compose: 'Megaphone',
  history: 'ScrollText',
  settings: 'Settings',
};

export function CommunicationSectionNav({
  sections,
}: {
  sections: CommunicationSection[];
}): React.JSX.Element | null {
  const eintraege: ModulNavigationEintrag[] = sections.map((section) => ({
    href: section.href,
    label: section.label,
    icon: SYMBOLE[section.icon],
  }));

  return <ModulNavigation eintraege={eintraege} label="Kommunikation" />;
}
