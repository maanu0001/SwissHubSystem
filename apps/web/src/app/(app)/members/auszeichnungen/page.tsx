import type { Metadata } from 'next';
import { members, profile } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import { NavIcon } from '@/components/layout/nav-icon';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ArtenVerwaltung } from '@/modules/members/components/auszeichnungs-arten-verwaltung';

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
 * ## Und warum die gerechneten hier nur dastehen
 *
 * Turniersiege, Clip-Siege, Level und Zugehoerigkeit entstehen aus echten
 * Daten. Sie lassen sich nicht anlegen, nicht umbenennen und nicht
 * vergeben - sonst zeigte ein Profil Erfolge, die die Daten nicht
 * hergeben. Sie stehen unten trotzdem, weil die zweite Frage nach «wo lege
 * ich eine an» immer «warum finde ich Turniersieg nicht» ist.
 */
export default async function AuszeichnungenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(members.MEMBER_PERMISSIONS.awardsDefine);
  const csrfToken = csrfTokenFor(context);

  const arten = await profile.listeAuszeichnungsArtenMitZahlen({
    mitAbgeschalteten: true,
    mitArchivierten: true,
  });

  const gerechnet = profile.alleAuszeichnungsArten();

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

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Gerechnete Auszeichnungen</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Diese {gerechnet.length} entstehen aus echten Daten - Turnieren, Clip-Runden, dem Level, dem
            Beitrittsdatum. Sie lassen sich weder anlegen noch von Hand vergeben, und genau das ist ihr Wert:
            sie stimmen.
          </p>
        </div>

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
          {gerechnet.map((art) => (
            <li
              key={art.key}
              className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-3.5">
                <NavIcon name={art.symbol} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{art.label}</p>
                <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{art.beschreibung}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
