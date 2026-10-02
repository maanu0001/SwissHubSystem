import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveGuildId } from '@swisshub/discord';
import { socialmedia } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { ladeExportKarten, ladeSocialMediaStand, socialMediaBereiche } from '@/server/socialmedia';

export const metadata: Metadata = { title: 'Wrapped' };
export const dynamic = 'force-dynamic';

/**
 * Der Reiter «Wrapped» im Social-Media-Bereich.
 *
 * ## Warum das Studio liegen bleibt, wo es ist
 *
 * Das Wrapped Studio ist kein Export, sondern eine Werkstatt: Zeitraum,
 * Szenenfolge, Quellenlage, Momentaufnahmen, Freigabe. Es liegt unter
 * `/system/wrapped`, und dorthin fuehrt diese Seite.
 *
 * Es umzuziehen waere ein Umbau quer durch Routenhelfer, `revalidatePath`,
 * Audit-Kontext und ein Dutzend Verweise - fuer eine Adresse, die niemand
 * liest. Was fehlte, war nicht der Ort, sondern der Weg dorthin: in der
 * Seitenleiste stand «Wrapped Studio» unter System, wo niemand nach etwas sucht,
 * das man postet. Dieser Eintrag ist deshalb weg, und der Weg laeuft von hier.
 *
 * Die alte Adresse bleibt gueltig - ein Lesezeichen soll nicht ins Leere laufen.
 */
export default async function SocialMediaWrappedPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(socialmedia.SOCIAL_MEDIA_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const stand = await ladeSocialMediaStand(context, guildId);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="Social Media ist derzeit ausgeschaltet." />;
  }
  if (!stand.wrappedOffen) {
    notFound();
  }

  const karten = (await ladeExportKarten(stand)).filter((karte) => karte.quelle === 'wrapped');

  return (
    <div className="space-y-6">
      <ModulNavigation
        eintraege={socialMediaBereiche(stand)}
        aktiv="wrapped"
        label="Bereiche in Social Media"
      />

      <Panel
        title="Rückblicke"
        description="Jede Zeile führt auf das Blatt der Kampagne im Wrapped Studio - dort entstehen die Folien und die Freigabe."
        icon="Gift"
        action={
          <Link
            href={systemRoutes.wrappedStudio()}
            className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Zum Wrapped Studio
          </Link>
        }
      >
        {karten.length === 0 ? (
          <EmptyState
            title="Noch kein Rückblick"
            description="Ein Rückblick beginnt als Entwurf im Studio: Zeitraum wählen, Szenen prüfen, Momentaufnahmen erzeugen - und erst dann veröffentlichen."
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{karte.hinweis}</span>
                    {karte.offen ? <Badge variant="default">Veröffentlicht</Badge> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
