import { can } from '@swisshub/auth';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import type { AuthContext } from '@swisshub/auth';
import type { ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Die Bereiche von «SwissHub fragt».
 *
 * ## Warum das serverseitig entsteht
 *
 * Weil die Liste von Berechtigungen abhaengt. Ein Client, der sie selbst
 * zusammensetzt, bekaeme sie entweder vollstaendig geschickt - dann steht in
 * seinem HTML, welche Bereiche es gibt - oder er muesste sie nachladen.
 *
 * ## Warum jede Seite sie ruft
 *
 * Die Seitenleiste fuehrt auf genau einen Eintrag; die uebrigen sechs Bereiche
 * brauchen einen Weg, und zwar von **jeder** Seite aus. Genau daran ist
 * Wrapped einmal gescheitert: der Einstieg aus der Navigation war eine
 * Sackgasse.
 *
 * Diese Leiste ist Darstellung, keine Sicherheit - jede Seite prueft ihre
 * Berechtigung zusaetzlich selbst ueber `requirePagePermission`.
 */
export function fragtNavigation(context: AuthContext): ModulNavigationEintrag[] {
  const eintraege: ModulNavigationEintrag[] = [
    {
      key: 'uebersicht',
      label: 'Übersicht',
      href: systemRoutes.fragt(),
      icon: 'LayoutDashboard',
      hinweis: 'Was gerade läuft',
    },
  ];

  if (can(context, fragt.FRAGT_PERMISSIONS.questions)) {
    eintraege.push({
      key: 'bibliothek',
      label: 'Fragenbibliothek',
      href: systemRoutes.fragtBibliothek(),
      icon: 'Library',
      hinweis: 'Fragen schreiben und freigeben',
    });
  }

  if (can(context, fragt.FRAGT_PERMISSIONS.schedule)) {
    eintraege.push({
      key: 'geplant',
      label: 'Geplant',
      href: systemRoutes.fragtGeplant(),
      icon: 'CalendarClock',
      hinweis: 'Termine und Automatik',
    });
  }

  eintraege.push({
    key: 'aktiv',
    label: 'Aktive Abstimmung',
    href: systemRoutes.fragtAktiv(),
    icon: 'Radio',
    hinweis: 'Der laufende Stand',
  });

  if (can(context, fragt.FRAGT_PERMISSIONS.results)) {
    eintraege.push({
      key: 'ergebnisse',
      label: 'Ergebnisse',
      href: systemRoutes.fragtErgebnisse(),
      icon: 'BarChart3',
      hinweis: 'Abgeschlossene Abstimmungen',
    });
  }

  return eintraege;
}
