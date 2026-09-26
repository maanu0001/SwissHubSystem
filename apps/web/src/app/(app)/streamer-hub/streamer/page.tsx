import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { streamer } from '@swisshub/modules';
import { kanalAdresse } from '@swisshub/modules/streamer/typen';
import { formatDateTime } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';
import { StreamerListe } from '@/modules/streamer/components/streamer-liste';

export const metadata: Metadata = { title: 'Streamer' };
export const dynamic = 'force-dynamic';

/**
 * Die freigegebenen und pausierten Streamer.
 *
 * Die Suche ist ein `<form method="get">` - sie steht damit in der Adresse,
 * ist teilbar und funktioniert ohne JavaScript. Gesucht wird im Anzeigenamen
 * und in den Kanalnamen, nicht in Discord-Kennungen: eine Suche nach Kennungen
 * waere ein Werkzeug, um herauszufinden, ob eine bestimmte Person streamt.
 */
export default async function StreamerVerwaltungSeite({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);
  const { q } = await searchParams;

  const zeilen = await streamer.ladeStreamerListe({
    status: ['APPROVED', 'SUSPENDED'],
    suche: q,
  });

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="streamer"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader
        title="Streamer"
        description={`${zeilen.length} ${zeilen.length === 1 ? 'Eintrag' : 'Einträge'}`}
      />

      <form method="get" className="flex max-w-md gap-2">
        <Input name="q" defaultValue={q ?? ''} placeholder="Name oder Kanal" />
        <Button type="submit" variant="outline">
          Suchen
        </Button>
      </form>

      <StreamerListe
        csrfToken={csrfToken}
        darfVerwalten={can(context, streamer.STREAMER_PERMISSIONS.manage)}
        darfSpotlight={can(context, streamer.STREAMER_PERMISSIONS.spotlight)}
        zeilen={zeilen.map((zeile) => ({
          id: zeile.id,
          discordId: zeile.discordId,
          anzeigename: zeile.anzeigename,
          avatarHash: zeile.avatarHash,
          slug: zeile.slug,
          status: zeile.status === 'SUSPENDED' ? 'SUSPENDED' : 'APPROVED',
          ankuendigungAktiv: zeile.ankuendigungAktiv,
          liveSeit: zeile.liveSeit ? formatDateTime(zeile.liveSeit) : null,
          pausierungsGrund: zeile.pausierungsGrund,
          kanaele: zeile.kanaele.map((kanal) => ({
            plattform: kanal.plattform,
            handle: kanal.handle,
            adresse: kanalAdresse(kanal.plattform, kanal.handle),
            verifikation: kanal.verifikation,
            letzterFehler: kanal.letzterFehler,
          })),
        }))}
      />
    </div>
  );
}
