import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { fragtNavigation } from '@/modules/fragt/navigation';
import {
  BibliothekArbeitsflaeche,
  type FrageAnsicht,
} from '@/modules/fragt/components/bibliothek-arbeitsflaeche';

export const metadata: Metadata = { title: 'Fragenbibliothek' };
export const dynamic = 'force-dynamic';

const datum = (wert: Date): string =>
  wert.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  });

/**
 * Die Fragenbibliothek.
 *
 * Die Seite laedt und prueft; gearbeitet wird in der Client-Komponente. Ob eine
 * Frage schon gestellt wurde, entscheidet hier die Datenbank und nicht der
 * Browser: davon haengt ab, ob die Antwortmöglichkeiten noch änderbar sind.
 */
export default async function FragtBibliothekPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.questions);
  const guildId = await resolveGuildId();

  const [fragen, kategorien, laufend, gestellt] = await Promise.all([
    fragt.listeFragen(guildId, {}, 200),
    fragt.kategorien(guildId),
    fragt.laufendeAbstimmung(guildId),
    // Eine Abfrage für alle: davon hängt ab, ob die Antwortmöglichkeiten einer
    // Frage noch geändert werden dürfen.
    fragt.gestellteFrageIds(guildId),
  ]);

  const ansichten: FrageAnsicht[] = fragen.map((frage) => ({
    id: frage.id,
    text: frage.text,
    untertitel: frage.untertitel,
    kategorie: frage.kategorie,
    typ: frage.typ,
    status: frage.status,
    antworten: frage.optionen.map((option) => option.label),
    dauerStunden: frage.dauerStunden,
    zuletztGestellt: frage.zuletztGestelltAt ? datum(frage.zuletztGestelltAt) : null,
    gestellt: gestellt.has(frage.id),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fragenbibliothek"
        description="Fragen schreiben, freigeben und für die Automatik bereitstellen."
      />
      <ModulNavigation
        eintraege={fragtNavigation(context)}
        aktiv="bibliothek"
        label="Bereiche in SwissHub fragt"
      />

      <BibliothekArbeitsflaeche
        csrfToken={csrfTokenFor(context)}
        fragen={ansichten}
        kategorien={kategorien}
        darfVeroeffentlichen={can(context, fragt.FRAGT_PERMISSIONS.publish)}
        laufendeAbstimmung={laufend !== null}
      />
    </div>
  );
}
