import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { tournaments } from '@swisshub/modules';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { HostVerwaltung } from '@/modules/gameserver/components/host-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte, ladeHosts } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Gameserver-Hosts' };
export const dynamic = 'force-dynamic';

/**
 * Die vorbereiteten Maschinen, auf denen Matches laufen.
 *
 * Sichtbar fuer alle, die Gameserver sehen duerfen; anlegen und schalten
 * darf nur, wer `tournaments.gameserver.hosts` hat - ein Host entscheidet,
 * wo ein ganzes Turnier spielt.
 */
export default async function HostsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.gameserverView);

  const [hosts, gruppen, csrfToken] = await Promise.all([
    ladeHosts(),
    prisma.hostGroup.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    csrfTokenFor(context),
  ]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />
      <HostVerwaltung
        hosts={hosts}
        gruppen={gruppen}
        darfVerwalten={can(context, tournaments.TOURNAMENT_PERMISSIONS.hostsManage)}
        csrfToken={csrfToken}
      />
    </div>
  );
}
