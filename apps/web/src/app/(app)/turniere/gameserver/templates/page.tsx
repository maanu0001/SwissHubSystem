import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { tournaments } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { TemplateVerwaltung } from '@/modules/gameserver/components/template-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Server-Templates' };
export const dynamic = 'force-dynamic';

/** Die Maschinenzuschnitte. */
export default async function TemplatesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.templatesManage);

  const [templates, anbieter, csrfToken] = await Promise.all([
    prisma.gameServerTemplate.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      include: { provider: { select: { name: true } } },
    }),
    prisma.gameServerProvider.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    csrfTokenFor(context),
  ]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />

      {anbieter.length === 0 ? (
        <EmptyState
          title="Erst ein Anbieter, dann ein Template"
          description="Ein Template beschreibt eine Maschine bei einem bestimmten Anbieter. Richte zuerst unter «Infrastruktur» einen ein."
        />
      ) : (
        <TemplateVerwaltung
          templates={templates.map((eintrag) => ({
            id: eintrag.id,
            name: eintrag.name,
            providerName: eintrag.provider.name,
            game: eintrag.game,
            imageRef: eintrag.imageRef,
            cpuCores: eintrag.cpuCores,
            memoryMb: eintrag.memoryMb,
            diskGb: eintrag.diskGb,
            maxRuntimeMinutes: eintrag.maxRuntimeMinutes,
            cleanupDelayMinutes: eintrag.cleanupDelayMinutes,
            enabled: eintrag.enabled,
          }))}
          anbieter={anbieter}
          csrfToken={csrfToken}
        />
      )}
    </div>
  );
}
