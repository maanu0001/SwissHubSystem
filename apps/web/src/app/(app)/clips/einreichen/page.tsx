import type { Metadata } from 'next';
import { clips, games } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { ErrorState } from '@/components/shared/states';
import { EinreichAssistent } from '@/modules/clips/components/einreich-assistent';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { ladeClipStand } from '@/server/clips';

export const metadata: Metadata = { title: 'Clip einreichen' };
export const dynamic = 'force-dynamic';

/**
 * Einreichen.
 *
 * Die Seite entscheidet nur, ob der Assistent ueberhaupt erscheint. Ob eine
 * Einreichung angenommen wird, entscheidet `reicheEin()` - auch dann, wenn
 * die Phase eine Minute nach dem Laden dieser Seite endet.
 */
export default async function ClipEinreichenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.submit);
  const stand = await ladeClipStand(context);

  const zurueck = <ZurueckLink fallback={systemRoutes.clips()} fallbackLabel="Clip of the Week" />;

  if (!stand.aktiv || !stand.runde) {
    return (
      <div className="space-y-6">
        {zurueck}
        <ErrorState
          title="Keine Runde offen"
          description="Zurzeit läuft keine Runde, für die eingereicht werden kann."
        />
      </div>
    );
  }

  if (stand.phase !== 'einreichen') {
    return (
      <div className="space-y-6">
        {zurueck}
        <ErrorState
          title="Die Einreichungen sind geschlossen"
          description={
            stand.phase === 'voting'
              ? 'Für diese Runde wird bereits abgestimmt. Die nächste Runde öffnet am Montag.'
              : 'Sobald die nächste Runde startet, kannst du hier einreichen.'
          }
        />
      </div>
    );
  }

  const [eigene, spiele] = await Promise.all([
    clips.eigeneEinreichungen(stand.runde.id, context.user.discordId),
    // Der zentrale Spielekatalog - derselbe, aus dem Turniere und «Was
    // spielen wir?» schoepfen. Eine eigene Liste waere die zweite Wahrheit.
    games.listGames(),
  ]);

  const offeneEigene = eigene.filter(
    (eintrag) => eintrag.status === 'PENDING' || eintrag.status === 'APPROVED',
  );

  return (
    <div className="space-y-6">
      {zurueck}
      <PageHeader
        title="Clip einreichen"
        description={`Runde #${stand.runde.number} · Einreichungen bis ${stand.runde.submissionEndsAt.toLocaleString(
          'de-CH',
          { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' },
        )}`}
      />
      <EinreichAssistent
        csrfToken={csrfTokenFor(context)}
        spiele={spiele}
        limitErreicht={offeneEigene.length >= stand.runde.submissionsPerMember}
      />
    </div>
  );
}
