import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { ErrorState } from '@/components/shared/states';
import { VorschauWerkbank } from '@/modules/wrapped/components/vorschau-werkbank';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeWrappedStand } from '@/server/wrapped';
import { baueVorschau, vorschlaegeFuerTestperson } from '@/server/wrapped-vorschau';

export const metadata: Metadata = { title: 'Wrapped Vorschau' };
export const dynamic = 'force-dynamic';

/**
 * Die Vorschau.
 *
 * ## Eine Zusage, die an dieser Seite haengt
 *
 * Alles hier ist lesend. Diese Seite und die eine Aktion, die sie ruft,
 * fassen keine Momentaufnahme an, vergeben kein XP, verschicken nichts und
 * vermerken bei niemandem, sein Rueckblick sei gesehen worden. Deshalb darf
 * man hier die Zahlen eines echten Mitglieds ansehen: es passiert dieser
 * Person dabei nichts.
 *
 * Der erste Aufbau geschieht auf dem Server, damit die Seite nicht leer
 * beginnt und dann nachlaedt. Danach uebernimmt die Werkbank.
 */
export default async function WrappedVorschauPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.preview);
  const stand = await ladeWrappedStand(context);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="SwissHub Wrapped ist ausgeschaltet." />;
  }

  const campaign = await prisma.wrappedCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.guildId !== stand.guildId) {
    notFound();
  }

  const [ergebnis, testpersonen, csrfToken] = await Promise.all([
    baueVorschau(campaign, { quelle: 'fixture', persona: wrapped.WRAPPED_PERSONAS[0]?.key ?? null }),
    vorschlaegeFuerTestperson(campaign),
    csrfTokenFor(context),
  ]);

  return (
    <div className="space-y-6">
      <ZurueckLink
        fallback={systemRoutes.wrappedKampagne(campaign.id)}
        fallbackLabel="Zurück zum Rückblick"
      />

      <PageHeader title="Vorschau" description={`${campaign.title} · nur gelesen, nichts wird verändert`} />

      <VorschauWerkbank
        campaignId={campaign.id}
        csrfToken={csrfToken}
        personas={wrapped.WRAPPED_PERSONAS.map((persona) => ({
          key: persona.key,
          label: persona.label,
          beschreibung: persona.beschreibung,
        }))}
        testpersonen={testpersonen}
        anfang={{
          daten: ergebnis.daten,
          sceneKeys: ergebnis.sceneKeys,
          abdeckung: ergebnis.abdeckung.map((eintrag) => ({
            sceneKey: eintrag.szene.key,
            label: eintrag.szene.label,
            befund: eintrag.befund,
          })),
          herkunft: ergebnis.herkunft,
        }}
      />
    </div>
  );
}
