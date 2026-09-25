import type { Metadata } from 'next';
import { members, profile } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ArtenVerwaltung } from '@/modules/members/components/auszeichnungs-arten-verwaltung';
import { BerechneteArtenVerwaltung } from '@/modules/members/components/berechnete-arten-verwaltung';

export const metadata: Metadata = { title: 'Auszeichnungen' };
export const dynamic = 'force-dynamic';

/**
 * Die verleihbaren Auszeichnungen - global.
 *
 * ## Warum es diese Seite gibt
 *
 * Verliehen wurde schon immer in der Mitgliederakte. Was sich verleihen
 * liess, stand dagegen als Konstante im Quelltext: fuenf Eintraege, nicht
 * aenderbar. Genau deshalb war im Betrieb keine Verwaltung auffindbar - es
 * gab keine.
 *
 * ## Und was mit den gerechneten geht
 *
 * Turniersiege, Clip-Siege, Level und Zugehoerigkeit entstehen aus echten
 * Daten. **Vergeben** lassen sie sich deshalb nicht - sonst zeigte ein
 * Profil Erfolge, die die Daten nicht hergeben. **Pflegen** lassen sie sich
 * sehr wohl: Beschriftung, Beschreibung, Symbol, Stufe, Schwellenwert und
 * der Schalter «aktiv». Was gezaehlt wird, bleibt im Code; verwaltbar ist
 * die Darstellung und eine Zahl.
 */
export default async function AuszeichnungenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(members.MEMBER_PERMISSIONS.awardsDefine);
  const csrfToken = csrfTokenFor(context);

  const arten = await profile.listeAuszeichnungsArtenMitZahlen({
    mitAbgeschalteten: true,
    mitArchivierten: true,
  });

  const gerechnet = await profile.berechneteArtenZurVerwaltung();

  return (
    <>
      <ArtenVerwaltung
        csrfToken={csrfToken}
        symbole={[...profile.AUSZEICHNUNGS_SYMBOLE]}
        darfVerleihen={can(context, members.MEMBER_PERMISSIONS.awardsManage)}
        arten={arten.map((art) => ({
          id: art.id,
          key: art.key,
          label: art.label,
          beschreibung: art.beschreibung,
          symbol: art.symbol,
          stufe: art.stufe,
          aktiv: art.aktiv,
          archiviert: art.archiviert,
          sortierung: art.sortierung,
          verliehen: art.verliehen ?? 0,
        }))}
      />

      <BerechneteArtenVerwaltung
        csrfToken={csrfToken}
        symbole={[...profile.AUSZEICHNUNGS_SYMBOLE]}
        arten={gerechnet}
      />
    </>
  );
}
