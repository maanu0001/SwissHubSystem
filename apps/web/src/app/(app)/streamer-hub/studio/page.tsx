import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { streamer } from '@swisshub/modules';
import { formatDateTime, systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';

export const metadata: Metadata = { title: 'Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Das Content Studio - die Liste der Spotlight-Entwuerfe.
 *
 * Angelegt werden sie dort, wo die Streamer stehen: unter «Streamer», mit dem
 * Knopf an der Zeile. Das ist der Ort, an dem jemand entscheidet, wen er
 * vorstellen will - eine zweite Auswahlliste hier waere derselbe Schritt an
 * einer zweiten Stelle.
 */
export default async function StudioSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.spotlight);
  const entwuerfe = await streamer.listeSpotlights();

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="studio"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader
        title="Content Studio"
        description="Streamer Spotlights als Instagram-Grafik - Story, Feed und quadratisch."
      />

      {entwuerfe.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              Noch kein Spotlight
            </CardTitle>
            <CardDescription>
              Ein Spotlight entsteht bei einem Streamer:{' '}
              <Link
                href={systemRoutes.streamerHubStreamer()}
                className="text-primary underline-offset-4 hover:underline"
              >
                Streamer
              </Link>{' '}
              öffnen und dort auf «Spotlight» klicken. Voraussetzung ist ein öffentliches Profil - aus Daten,
              die nicht freigegeben sind, entsteht keine Grafik.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entwuerfe.map((entwurf) => (
            <Link
              key={entwurf.id}
              href={systemRoutes.streamerHubSpotlight(entwurf.id)}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{entwurf.anzeigename}</span>
                {entwurf.status === 'VEROEFFENTLICHT' ? (
                  <Badge variant="success">Veröffentlicht</Badge>
                ) : entwurf.status === 'FINAL' ? (
                  <Badge variant="outline">Abgeschlossen</Badge>
                ) : (
                  <Badge variant="secondary">Entwurf</Badge>
                )}
              </span>
              <span className="line-clamp-2 text-sm text-muted-foreground">
                {entwurf.beschreibung ?? entwurf.ueberschrift ?? 'Ohne Text'}
              </span>
              <span className="text-xs text-muted-foreground">{formatDateTime(entwurf.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
