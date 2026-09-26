import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';
import { SpotlightEditor } from '@/modules/streamer/components/spotlight-editor';

export const metadata: Metadata = { title: 'Spotlight' };
export const dynamic = 'force-dynamic';

/**
 * Ein Spotlight bearbeiten.
 *
 * Die Vorschau im Editor ist die Exportdatei selbst - `<img>` auf dieselbe
 * Route, die den Download liefert. Deshalb laedt diese Seite keine Bilddaten:
 * sie gibt nur die Texte und die Kennung weiter.
 */
export default async function SpotlightSeite({
  params,
}: {
  params: Promise<{ spotlightId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.spotlight);
  const csrfToken = csrfTokenFor(context);
  const { spotlightId } = await params;

  const [daten, einstellungen] = await Promise.all([
    streamer.holeSpotlightDaten(spotlightId),
    streamer.leseStreamerEinstellungen(),
  ]);
  /*
   * `null` heisst: es gibt den Entwurf nicht **oder** der Streamer ist nicht
   * mehr oeffentlich. Beides endet hier, weil aus nicht freigegebenen Daten
   * keine Grafik entstehen darf - und eine Fehlermeldung, die unterscheidet,
   * waere eine Auskunft ueber den Sichtbarkeitszustand einer Person.
   */
  if (!daten) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="studio"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader
        title={`Spotlight: ${daten.streamer.name}`}
        description="Name, Spiele und Kanal kommen aus dem öffentlichen Profil - bearbeitbar ist der Text."
      />

      <SpotlightEditor
        csrfToken={csrfToken}
        spotlightId={daten.spotlight.id}
        streamerName={daten.streamer.name}
        ueberschrift={daten.spotlight.ueberschrift ?? ''}
        beschreibung={daten.spotlight.beschreibung ?? ''}
        cta={daten.spotlight.cta ?? ''}
        status={daten.spotlight.status}
        veroeffentlichtAm={
          daten.spotlight.veroeffentlichtAm ? formatDateTime(daten.spotlight.veroeffentlichtAm) : null
        }
        darfVeroeffentlichen={can(context, streamer.STREAMER_PERMISSIONS.publish)}
        spotlightKanalGesetzt={einstellungen.spotlightChannelId !== ''}
      />
    </div>
  );
}
