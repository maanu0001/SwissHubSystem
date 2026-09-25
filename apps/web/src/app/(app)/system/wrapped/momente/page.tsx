import type { Metadata } from 'next';
import { resolveGuildId } from '@swisshub/discord';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { MomenteVerwaltung } from '@/modules/wrapped/components/momente-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { ladeWrappedStand, wrappedBereiche } from '@/server/wrapped';

export const metadata: Metadata = { title: 'Community Moments' };
export const dynamic = 'force-dynamic';

/**
 * Community Moments.
 *
 * Eigene Berechtigung, weil es eine eigene Taetigkeit ist: hier entstehen
 * keine Zahlen, sondern Erinnerungen - und die kommen immer von einem
 * Menschen.
 */
export default async function WrappedMomentePage({
  searchParams,
}: {
  searchParams: Promise<{ von?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.momentsManage);
  const stand = await ladeWrappedStand(context);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="SwissHub Wrapped ist derzeit ausgeschaltet." />;
  }

  const { von } = await searchParams;
  const guildId = await resolveGuildId();
  const momente = await wrapped.listeMomente(guildId);

  return (
    <div className="space-y-5">
      {/* Der Rückweg bleibt: wer aus einer Ausgabe hierherkam, will dorthin
          zurück. Die Leiste darunter ist etwas anderes - sie zeigt, wo man
          im Modul überhaupt ist. */}
      <ZurueckLink von={von} fallback={systemRoutes.wrappedAusgaben()} fallbackLabel="Ausgaben" />

      <ModulNavigation
        eintraege={wrappedBereiche(context)}
        aktiv="momente"
        label="Bereiche in SwissHub Wrapped"
      />

      <PageHeader
        title="Community Moments"
        description="Was einen Monat ausgemacht hat und in keiner Statistik steht. Nichts davon wird automatisch veröffentlicht."
      />

      <MomenteVerwaltung csrfToken={csrfTokenFor(context)} momente={momente} />
    </div>
  );
}
