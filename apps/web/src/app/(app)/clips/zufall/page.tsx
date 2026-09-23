import type { Metadata } from 'next';
import { clips } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { ZufallsAnsicht } from '@/modules/clips/components/zufalls-ansicht';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { ladeClipStand } from '@/server/clips';

export const metadata: Metadata = { title: 'Zufälliger Clip' };
export const dynamic = 'force-dynamic';

/** Durchblaettern, ohne zu suchen. */
export default async function ClipZufallPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(clips.CLIPS_PERMISSIONS.view);
  const stand = await ladeClipStand(context);
  const zurueck = <ZurueckLink fallback={systemRoutes.clips()} fallbackLabel="Clip of the Week" />;

  const karte =
    stand.aktiv && stand.runde ? await clips.zufaelligerClip(stand.runde.id, context.user.discordId) : null;

  if (!stand.runde || !karte) {
    return (
      <div className="space-y-6">
        {zurueck}
        <EmptyState
          title="Nichts zum Durchblättern"
          description="In dieser Runde ist noch kein Clip freigegeben."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {zurueck}
      <ZufallsAnsicht
        competitionId={stand.runde.id}
        erste={karte}
        einbettung={clips.einbettung(karte, stand.hostname)}
        csrfToken={csrfTokenFor(context)}
      />
    </div>
  );
}
