import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { appBaseUrl } from '@swisshub/config';
import { tournaments } from '@swisshub/modules';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { HostDetailAnsicht } from '@/modules/gameserver/components/host-detail-ansicht';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte, ladeHostDetail } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Host' };
export const dynamic = 'force-dynamic';

/** Ein einzelner Host: Zustand, Ressourcen, Abbilder, laufende Matches. */
export default async function HostDetailPage({
  params,
}: {
  params: Promise<{ hostId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.gameserverView);
  const { hostId } = await params;

  const [host, csrfToken] = await Promise.all([ladeHostDetail(hostId), csrfTokenFor(context)]);
  if (!host) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />
      <HostDetailAnsicht
        host={host}
        darfVerwalten={can(context, tournaments.TOURNAMENT_PERMISSIONS.hostsManage)}
        darfAbbilder={can(context, tournaments.TOURNAMENT_PERMISSIONS.runtimeImagesManage)}
        swisshubUrl={appBaseUrl()}
        csrfToken={csrfToken}
      />
    </div>
  );
}
