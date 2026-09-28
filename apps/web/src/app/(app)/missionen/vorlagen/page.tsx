import type { Metadata } from 'next';
import { missions } from '@swisshub/modules';
import { MissionsSectionNav } from '@/modules/missions/components/section-nav';
import { VorlagenVerwaltung } from '@/modules/missions/components/vorlagen-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { missionsAbschnitte } from '@/server/missionen';
import { typAuswahl } from '@/server/missions-typen';

export const metadata: Metadata = { title: 'Vorlagen' };
export const dynamic = 'force-dynamic';

/** Der Bereich «Vorlagen» der Verwaltung. */
export default async function MissionsVorlagenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(missions.MISSIONS_PERMISSIONS.manage);
  const [vorlagen, csrfToken] = await Promise.all([missions.alleVorlagen(), csrfTokenFor(context)]);
  const typen = typAuswahl();

  return (
    <div className="space-y-6">
      <MissionsSectionNav abschnitte={missionsAbschnitte(context)} />
      <VorlagenVerwaltung
        vorlagen={vorlagen.map((vorlage) => {
          const typ = typen.find((eintrag) => eintrag.key === vorlage.typ);
          return {
            id: vorlage.id,
            name: vorlage.name,
            art: vorlage.art,
            typ: vorlage.typ,
            typLabel: typ?.label ?? 'Unbekannter Typ',
            titel: vorlage.titel,
            ziel: vorlage.ziel,
            einheit: typ?.einheit ?? '',
            belohnungXp: vorlage.belohnungXp,
            belohnungPremiumTage: vorlage.belohnungPremiumTage,
            aktiv: vorlage.aktiv,
          };
        })}
        typen={typen}
        csrfToken={csrfToken}
      />
    </div>
  );
}
