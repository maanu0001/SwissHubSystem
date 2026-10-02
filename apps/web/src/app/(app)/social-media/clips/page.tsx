import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { ladeExportKarten, ladeSocialMediaStand, socialMediaBereiche } from '@/server/socialmedia';

export const metadata: Metadata = { title: 'Clip of the Week' };
export const dynamic = 'force-dynamic';

/**
 * Der Reiter «Clip of the Week» im Social-Media-Bereich.
 *
 * ## Was die Teilen-Karte ist
 *
 * Eine gezeichnete Grafik mit Titel, Name, Woche und Stimmenzahl - entstanden
 * unter `/api/clips/share/<schluessel>`, erreichbar vom Blatt der Runde. Sie
 * zeigt bewusst kein Vorschaubild des Clips: das kaeme von einem fremden Server
 * und muesste dafuer abgerufen werden.
 *
 * ## Warum hier nur Runden stehen, die abgeschlossen sind
 *
 * Weil es vor dem Ende keinen Gewinner gibt. Eine Teilen-Karte zu einer
 * laufenden Abstimmung waere eine Aussage ueber ein Ergebnis, das noch nicht
 * feststeht - und am Montag eine andere als am Sonntag.
 *
 * Ausgeblendete Runden fehlen ebenfalls, und zwar schon in der Abfrage: eine
 * Runde, die aus der Hall of Fame genommen wurde, soll auch hier nicht zum
 * Posten angeboten werden.
 */
export default async function SocialMediaClipsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const stand = await ladeSocialMediaStand(context, guildId);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="Social Media ist derzeit ausgeschaltet." />;
  }
  if (!stand.clipsOffen) {
    notFound();
  }

  const karten = (await ladeExportKarten(stand)).filter((karte) => karte.quelle === 'clips');

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={socialMediaBereiche(stand)}
        aktiv="clips"
        label="Bereiche in Social Media"
      />

      <Panel
        title="Abgeschlossene Runden"
        description="Jede Zeile führt auf das Blatt der Runde - dort liegt die Teilen-Karte als PNG."
        icon="Clapperboard"
        action={
          <Link
            href="/clips/hall-of-fame"
            className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Zur Hall of Fame
          </Link>
        }
      >
        {karten.length === 0 ? (
          <EmptyState
            title="Noch keine abgeschlossene Runde"
            description="Eine Runde läuft eine Woche: einreichen, abstimmen, Ergebnis. Danach steht sie hier."
          />
        ) : (
          <ul className="grid gap-3">
            {karten.map((karte) => (
              <li key={karte.href}>
                <Link
                  href={karte.href}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4 transition hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="min-w-0 truncate text-sm font-medium">{karte.titel}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{karte.hinweis}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
