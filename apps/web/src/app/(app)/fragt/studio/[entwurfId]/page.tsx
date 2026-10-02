import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { ErrorState } from '@/components/shared/states';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { markenVorgabe } from '@/modules/fragt/marke';
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

  /*
   * Die Vorgabe des Moduls - zur Beschriftung, nicht als Wert.
   *
   * Das Studio zeigt bei jedem der drei Felder die Wahl «wie im Modul» und
   * daneben, was das gerade ist. Ohne diese Angabe waere es eine Wahl ins
   * Ungewisse: man sieht die Farbe erst nach dem Speichern in der Vorschau.
   *
   * Dieselbe Normalisierung wie beim Zeichnen - was hier steht, ist genau das,
   * was ohne Uebersteuerung herauskaeme.
   */
  const vorgabe = await markenVorgabe();

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
    stimmenZeigen: quelle.entwurf.stimmenZeigen,
    /*
     * Farbe, Zeichen und Zusatztext dieses Exports.
     *
     * `null` heisst «wie im Modul» und ist der Normalfall - die Felder sind
     * neu, bestehende Entwuerfe haben sie nicht gesetzt. Hier stand nichts
     * davon, und genau das war die Luecke: die Werte existierten nur als
     * Moduleinstellungen, also nirgends im Studio.
     */
    marke: {
      akzentfarbe: quelle.entwurf.exportAkzentfarbe,
      logo: (quelle.entwurf.exportLogo as fragt.ExportLogoWahl | null) ?? null,
      zusatztext: quelle.entwurf.exportZusatztext,
    },
    vorgabe,
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
