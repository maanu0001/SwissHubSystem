import type { Metadata } from 'next';
import { gameserver, tournaments } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { ServerListe } from '@/modules/gameserver/components/server-liste';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte } from '@/server/gameserver';
import { can } from '@swisshub/auth';

export const metadata: Metadata = { title: 'Aktive Server' };
export const dynamic = 'force-dynamic';

/**
 * Was gerade läuft.
 *
 * Die Angaben stammen aus dem letzten Heartbeat des Agents - nicht aus einer
 * Abfrage beim Seitenaufruf. Eine Seite, die beim Laden dreissig Maschinen
 * anspricht, lädt so lange wie die langsamste.
 */
export default async function AktiveServerPage(): Promise<React.JSX.Element> {
  const P = tournaments.TOURNAMENT_PERMISSIONS;
  const context = await requirePagePermission(P.gameserverView);
  const [server, csrfToken] = await Promise.all([gameserver.listeServer(), csrfTokenFor(context)]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />

      {server.length === 0 ? (
        <EmptyState
          title="Gerade läuft kein Server"
          description="Sobald ein Match einen Server braucht, entsteht er hier - und verschwindet nach dem Match wieder."
        />
      ) : (
        <ServerListe
          server={server}
          csrfToken={csrfToken}
          darfHalten={can(context, P.serverHold)}
          darfLoeschen={can(context, P.serverCleanup)}
        />
      )}
    </div>
  );
}
