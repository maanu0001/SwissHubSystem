import type { Metadata } from 'next';
import { missions } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { ErrorState } from '@/components/shared/states';
import { StatCard } from '@/components/shared/stat-card';
import { MissionsSectionNav } from '@/modules/missions/components/section-nav';
import { MissionsVerwaltung } from '@/modules/missions/components/missions-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { missionsAbschnitte } from '@/server/missionen';
import { typAuswahl } from '@/server/missions-typen';

export const metadata: Metadata = { title: 'Missionen' };
export const dynamic = 'force-dynamic';

/**
 * Der Bereich «Missionen» der Verwaltung.
 *
 * Die Zahlen oben, die Liste darunter, das Formular zuletzt - in der
 * Reihenfolge, in der jemand hinsieht: erst «wie steht es», dann «was
 * laeuft», dann «ich will etwas Neues».
 */
export default async function MissionenVerwaltungPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(missions.MISSIONS_PERMISSIONS.manage);
  const guildId = await resolveGuildId().catch(() => null);
  const nav = <MissionsSectionNav abschnitte={missionsAbschnitte(context)} />;

  if (!guildId) {
    return (
      <div className="space-y-6">
        {nav}
        <ErrorState
          title="Kein Discord-Server verbunden"
          description="Ohne verbundenen Server lassen sich keine Missionen anlegen."
        />
      </div>
    );
  }

  const [zahlen, liste, vorlagen, csrfToken] = await Promise.all([
    missions.uebersicht(guildId),
    missions.ansicht(guildId, ['LAEUFT', 'GEPLANT', 'ABGESCHLOSSEN', 'ABGEBROCHEN'], null, 40),
    missions.aktiveVorlagen(),
    csrfTokenFor(context),
  ]);

  return (
    <div className="space-y-6">
      {nav}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Läuft gerade" value={zahlen.laufend} icon="Target" />
        <StatCard label="Geplant" value={zahlen.geplant} icon="CalendarDays" />
        <StatCard label="Abgeschlossen" value={zahlen.abgeschlossen} icon="CalendarCheck" />
        <StatCard
          label="Vergebene Belohnungen"
          value={zahlen.belohnungenGesamt}
          hint={zahlen.xpGesamt > 0 ? `${zahlen.xpGesamt} XP insgesamt` : undefined}
          icon="Gift"
        />
      </section>

      <MissionsVerwaltung
        missionen={liste}
        vorlagen={vorlagen.map((vorlage) => ({
          id: vorlage.id,
          name: vorlage.name,
          art: vorlage.art,
          titel: vorlage.titel,
          ziel: vorlage.ziel,
        }))}
        typen={typAuswahl()}
        csrfToken={csrfToken}
      />
    </div>
  );
}
