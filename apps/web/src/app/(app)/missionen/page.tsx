import type { Metadata } from 'next';
import { missions } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { MissionsSectionNav } from '@/modules/missions/components/section-nav';
import { MissionsKarte } from '@/modules/missions/components/missions-karte';
import { requirePagePermission } from '@/server/auth';
import { ladeMissionsStand, missionsAbschnitte } from '@/server/missionen';

export const metadata: Metadata = { title: 'Community Missions' };
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht - und zugleich die Mitgliederseite.
 *
 * Wenige Karten untereinander, ein grosser Balken je Karte, keine Tabelle.
 * Auf einem Telefon ist das eine Liste, durch die man scrollt; auf einem
 * Bildschirm stehen zwei nebeneinander. Mehr Spalten gaebe es nicht - drei
 * schmale Balken lesen sich schlechter als zwei breite.
 */
export default async function MissionenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(missions.MISSIONS_PERMISSIONS.view);
  const stand = await ladeMissionsStand(context);
  const jetzt = new Date();

  return (
    <div className="space-y-6">
      <MissionsSectionNav abschnitte={missionsAbschnitte(context)} />

      {stand.laufend.length === 0 ? (
        <EmptyState
          title="Gerade läuft keine Mission"
          description="Sobald das Team eine Wochenmission oder eine Community Challenge startet, steht sie hier - mit deinem Fortschritt."
        />
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {stand.laufend.map((mission) => (
            <MissionsKarte key={mission.id} mission={mission} jetzt={jetzt} />
          ))}
        </section>
      )}

      {stand.vergangen.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Zuletzt abgeschlossen</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {stand.vergangen.map((mission) => (
              <MissionsKarte key={mission.id} mission={mission} jetzt={jetzt} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
