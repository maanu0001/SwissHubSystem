import type { Metadata } from 'next';
import { streamer } from '@swisshub/modules';
import { kanalAdresse } from '@swisshub/modules/streamer/typen';
import { formatDateTime } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';
import { BewerbungsListe } from '@/modules/streamer/components/bewerbungs-liste';

export const metadata: Metadata = { title: 'Bewerbungen' };
export const dynamic = 'force-dynamic';

/**
 * Offene Streamer-Bewerbungen.
 *
 * Die Seite laedt und prueft; entschieden wird in der Client-Komponente, und
 * jede Entscheidung laeuft ueber eine Server Action mit `streamer.review`.
 */
export default async function BewerbungenSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.review);
  const csrfToken = csrfTokenFor(context);

  const zeilen = await streamer.ladeStreamerListe({ status: ['PENDING'] });

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="bewerbungen"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader title="Bewerbungen" description="Kanäle prüfen, bevor SwissHub sie an alle ankündigt." />

      <BewerbungsListe
        csrfToken={csrfToken}
        zeilen={zeilen.map((zeile) => ({
          id: zeile.id,
          discordId: zeile.discordId,
          anzeigename: zeile.anzeigename,
          avatarHash: zeile.avatarHash,
          slug: zeile.slug,
          beschreibung: zeile.beschreibung,
          sprachen: zeile.sprachen,
          eingereichtAm: zeile.eingereichtAm ? formatDateTime(zeile.eingereichtAm) : null,
          kanaele: zeile.kanaele.map((kanal) => ({
            id: kanal.id,
            plattform: kanal.plattform,
            handle: kanal.handle,
            anzeigename: kanal.anzeigename,
            adresse: kanalAdresse(kanal.plattform, kanal.handle),
            verifikation: kanal.verifikation,
          })),
        }))}
      />
    </div>
  );
}
