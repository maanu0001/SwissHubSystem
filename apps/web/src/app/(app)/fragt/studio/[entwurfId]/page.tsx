import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { ErrorState } from '@/components/shared/states';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { StudioEditor, type StudioAnsicht } from '@/modules/fragt/components/studio-editor';

export const metadata: Metadata = { title: 'Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Das Content Studio.
 *
 * Die Seite laedt den Entwurf und das festgeschriebene Ergebnis. Die Zahlen
 * gehen als Anzeige an den Editor - er hat kein Feld, sie zu aendern, und die
 * Server Action nimmt keines an.
 */
export default async function FragtStudioPage({
  params,
}: {
  params: Promise<{ entwurfId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.studio);
  const { entwurfId } = await params;

  const quelle = await fragt.holeEntwurfsDaten(entwurfId);
  if (!quelle) {
    notFound();
  }

  const zurueck = (
    <ZurueckLink fallback={systemRoutes.fragtErgebnis(quelle.abstimmung.id)} fallbackLabel="Ergebnis" />
  );

  if (!quelle.ergebnis) {
    return (
      <div className="space-y-6">
        {zurueck}
        <ErrorState
          title="Kein lesbares Ergebnis"
          description="Zu dieser Abstimmung liegt kein Ergebnis in der erwarteten Form vor. Ohne Zahlen lässt sich keine Grafik erzeugen - eine mit Nullen wäre schlimmer als keine."
        />
      </div>
    );
  }

  const ansicht: StudioAnsicht = {
    entwurfId: quelle.entwurf.id,
    status: quelle.entwurf.status,
    vorlage: quelle.entwurf.vorlage as fragt.Vorlage,
    format: quelle.entwurf.format as fragt.Format,
    ueberschrift: quelle.entwurf.ueberschrift,
    untertitel: quelle.entwurf.untertitel ?? '',
    cta: quelle.entwurf.cta,
    folien: quelle.folien,
    frageText: quelle.abstimmung.frageText,
    zahlen: {
      gesamt: quelle.ergebnis.gesamt,
      gewinner: quelle.ergebnis.gewinner?.label ?? null,
      prozent: quelle.ergebnis.gewinner?.prozent ?? null,
    },
  };

  return (
    <div className="space-y-6">
      {zurueck}
      <PageHeader title="Content Studio" description={quelle.abstimmung.frageText} />
      <StudioEditor csrfToken={csrfTokenFor(context)} ansicht={ansicht} />
    </div>
  );
}
