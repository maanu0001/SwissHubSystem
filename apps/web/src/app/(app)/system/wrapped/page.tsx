import type { Metadata } from 'next';
import Link from 'next/link';
import { Gift, Images, Users } from 'lucide-react';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { StatCard } from '@/components/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { KampagneAnlegen } from '@/modules/wrapped/components/kampagne-anlegen';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import {
  WRAPPED_STATUS_FARBE,
  WRAPPED_STATUS_TEXT,
  ladeWrappedStand,
  wrappedBereiche,
  wrappedTag,
} from '@/server/wrapped';

export const metadata: Metadata = { title: 'Wrapped Studio' };
export const dynamic = 'force-dynamic';

/**
 * Das Studio - die Uebersicht.
 *
 * Was hier steht, ist bewusst wenig: welche Rueckblicke es gibt, in welchem
 * Zustand sie sind, und wie man einen neuen anlegt. Alles Weitere gehoert
 * auf das Blatt einer einzelnen Kampagne - eine Uebersicht, die schon alles
 * kann, ist keine Uebersicht mehr.
 */
export default async function WrappedStudioPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.studioView);
  const stand = await ladeWrappedStand(context);

  if (!stand.aktiv) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="SwissHub Wrapped ist derzeit ausgeschaltet. In den Moduleinstellungen lässt es sich einschalten."
      />
    );
  }

  const kampagnen = await prisma.wrappedCampaign.findMany({
    where: { guildId: stand.guildId },
    orderBy: [{ displayYear: 'desc' }, { createdAt: 'desc' }],
    take: 25,
    include: { _count: { select: { snapshots: true, views: true } } },
  });

  const csrfToken = await csrfTokenFor(context);
  const laufende = kampagnen.find((kampagne) => kampagne.status === 'PUBLISHED');

  return (
    <div className="space-y-6">
      {/*
       * Keine eigene Kopfzeile: «Wrapped Studio» steht schon in der
       * Navigation und damit in `AppHeader`. Hier stand derselbe Titel ein
       * zweites Mal, direkt darunter.
       *
       * Die Aktion bleibt - sie gehoert zur Seite und nicht in die
       * Kopfzeile der Anwendung.
       */}
      {/*
       * Die Leiste, die hier gefehlt hat.
       *
       * Die Seitenleiste führt auf diese Seite, und von hier gab es keinen
       * Weg zu den Ausgaben oder den Community Moments - nur umgekehrt. Wer
       * den angebotenen Einstieg nahm, sass fest.
       */}
      <ModulNavigation
        eintraege={wrappedBereiche(context)}
        aktiv="studio"
        label="Bereiche in SwissHub Wrapped"
      />

      {stand.darfBearbeiten ? (
        <div className="flex justify-end">
          <KampagneAnlegen csrfToken={csrfToken} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Rückblicke"
          value={kampagnen.length}
          icon={<Gift aria-hidden="true" />}
          hint={kampagnen.length === 1 ? 'einer angelegt' : 'angelegt'}
        />
        <StatCard
          label="Momentaufnahmen"
          value={laufende?._count.snapshots ?? 0}
          icon={<Images aria-hidden="true" />}
          hint={laufende ? `im laufenden Rückblick ${laufende.displayYear}` : 'nichts veröffentlicht'}
        />
        <StatCard
          label="Angesehen"
          value={laufende?._count.views ?? 0}
          icon={<Users aria-hidden="true" />}
          hint={laufende ? 'Mitglieder haben ihn geöffnet' : '–'}
        />
      </div>

      {kampagnen.length === 0 ? (
        <EmptyState
          title="Noch kein Rückblick"
          description="Ein Rückblick beginnt als Entwurf: Zeitraum wählen, Szenen prüfen, Momentaufnahmen erzeugen - und erst dann veröffentlichen."
        />
      ) : (
        <ul className="grid gap-3">
          {kampagnen.map((kampagne) => (
            <li key={kampagne.id}>
              <Link
                href={systemRoutes.wrappedKampagne(kampagne.id)}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{kampagne.title}</h3>
                    <Badge variant={WRAPPED_STATUS_FARBE[kampagne.status] ?? 'secondary'}>
                      {WRAPPED_STATUS_TEXT[kampagne.status] ?? kampagne.status}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {wrappedTag(kampagne.periodStart)} bis {wrappedTag(kampagne.periodEnd)} ·{' '}
                    <code>/wrapped/{kampagne.key}</code>
                  </p>
                </div>
                <dl className="flex shrink-0 gap-6 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Momentaufnahmen</dt>
                    <dd className="font-semibold tabular-nums">{kampagne._count.snapshots}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Angesehen</dt>
                    <dd className="font-semibold tabular-nums">{kampagne._count.views}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
