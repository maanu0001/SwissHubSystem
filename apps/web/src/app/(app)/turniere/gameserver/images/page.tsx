import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { AbbildVerwaltung } from '@/modules/gameserver/components/abbild-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte, ladeAbbilder } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Runtime-Images' };
export const dynamic = 'force-dynamic';

/** Die Container-Abbilder, aus denen Match-Instanzen entstehen. */
export default async function ImagesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.runtimeImagesManage);
  const [abbilder, csrfToken] = await Promise.all([ladeAbbilder(), csrfTokenFor(context)]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />
      <AbbildVerwaltung abbilder={abbilder} csrfToken={csrfToken} />
    </div>
  );
}
