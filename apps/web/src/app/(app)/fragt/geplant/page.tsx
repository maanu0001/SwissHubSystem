import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { fragtNavigation } from '@/modules/fragt/navigation';
import { PlanungsListe, type PlanbareFrage } from '@/modules/fragt/components/planungs-liste';

export const metadata: Metadata = { title: 'Geplante Fragen' };
export const dynamic = 'force-dynamic';

const zeit = (wert: Date, zone: string): string =>
  wert.toLocaleString('de-CH', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });

/**
 * Die Planung.
 *
 * Zeigt, was wann kommt - und in welcher Zeitzone das gilt. Die Zone steht in
 * den Moduleinstellungen; sie hier zu verschweigen hiesse, «Freitag 18:00»
 * jedem in seiner eigenen Zeit anzuzeigen, und dann stimmt die Absprache im
 * Team nicht mehr.
 */
export default async function FragtGeplantPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.schedule);
  const guildId = await resolveGuildId();

  const [geplant, freigegeben, konfiguration, laufend] = await Promise.all([
    fragt.geplanteFragen(guildId),
    fragt.listeFragen(guildId, { status: ['READY'] }, 200),
    fragt.einstellungen(),
    fragt.laufendeAbstimmung(guildId),
  ]);

  const zone = konfiguration.timezone;

  const geplanteAnsicht: PlanbareFrage[] = geplant.map((frage) => ({
    id: frage.id,
    text: frage.text,
    kategorie: frage.kategorie,
    geplantAnzeige: frage.geplantAt ? zeit(frage.geplantAt, zone) : null,
  }));

  const freigegebeneAnsicht: PlanbareFrage[] = freigegeben.map((frage) => ({
    id: frage.id,
    text: frage.text,
    kategorie: frage.kategorie,
    geplantAnzeige: null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geplant"
        description={`Termine in ${zone} · Auswahl: ${konfiguration.selectionMode === 'automatisch' ? 'automatisch aus der Bibliothek' : 'nur manuell geplante Fragen'}`}
      />
      <ModulNavigation
        eintraege={fragtNavigation(context)}
        aktiv="geplant"
        label="Bereiche in SwissHub fragt"
      />

      <PlanungsListe
        csrfToken={csrfTokenFor(context)}
        geplant={geplanteAnsicht}
        freigegeben={freigegebeneAnsicht}
        darfVeroeffentlichen={can(context, fragt.FRAGT_PERMISSIONS.publish)}
        laufendeAbstimmung={laufend !== null}
        naechsterTermin={
          konfiguration.autoPublish ? zeit(fragt.naechsterTermin(new Date(), konfiguration), zone) : null
        }
      />
    </div>
  );
}
