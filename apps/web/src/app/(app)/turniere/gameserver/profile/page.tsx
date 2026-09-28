import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { tournaments } from '@swisshub/modules';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { ProfilVerwaltung } from '@/modules/gameserver/components/profil-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Game Profiles' };
export const dynamic = 'force-dynamic';

/**
 * Die spielbezogenen Turniereinstellungen.
 *
 * Ein Turnier wählt anschliessend nur noch ein Profil - und bekommt damit
 * Map-Pool, Overtime, Pausen, GOTV, Demos und Ready-Regel auf einmal. Das
 * ist der Punkt: die Entscheidungen fallen einmal und nicht je Turnier neu.
 */
export default async function GameProfilesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.gameProfilesManage);

  const [profile, templates, csrfToken] = await Promise.all([
    prisma.gameProfile.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      include: { template: { select: { name: true } } },
    }),
    prisma.gameServerTemplate.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    csrfTokenFor(context),
  ]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />
      <ProfilVerwaltung
        profile={profile.map((eintrag) => ({
          id: eintrag.id,
          name: eintrag.name,
          game: eintrag.game,
          templateName: eintrag.template?.name ?? null,
          mapPool: eintrag.mapPool,
          slots: eintrag.slots,
          overtime: eintrag.overtime,
          knifeRound: eintrag.knifeRound,
          gotvEnabled: eintrag.gotvEnabled,
          demoRecording: eintrag.demoRecording,
          readyRule: eintrag.readyRule,
          enabled: eintrag.enabled,
        }))}
        templates={templates}
        csrfToken={csrfToken}
      />
    </div>
  );
}
