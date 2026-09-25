import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Activity, Eye, Images, ListOrdered, Rocket, Settings2 } from 'lucide-react';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/states';
import { DurchgangPanel } from '@/modules/wrapped/components/durchgang-panel';
import { FreigabePanel } from '@/modules/wrapped/components/freigabe-panel';
import { KampagneEditor } from '@/modules/wrapped/components/kampagne-editor';
import { SzenenEditor } from '@/modules/wrapped/components/szenen-editor';
import { QuellenTafel } from '@/modules/wrapped/components/quellen-tafel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import {
  WRAPPED_STATUS_FARBE,
  WRAPPED_STATUS_TEXT,
  ladeWrappedStand,
  wrappedBereiche,
  wrappedZeit,
} from '@/server/wrapped';
import { ladeQuellenlage } from '@/server/wrapped-vorschau';

export const metadata: Metadata = { title: 'Rückblick' };
export const dynamic = 'force-dynamic';

/** Ein `Date` als `YYYY-MM-TT` - das Format, das ein Datumsfeld erwartet. */
const alsFeld = (datum: Date): string => datum.toISOString().slice(0, 10);

/**
 * Das Blatt einer Kampagne.
 *
 * ## Die Reihenfolge der Felder ist die Reihenfolge der Arbeit
 *
 * Erst wird eingestellt, was der Rueckblick ist (Zeitraum, Texte), dann
 * woraus er besteht (Szenen), dann wird nachgesehen, ob die Daten dafuer
 * ueberhaupt da sind (Quellen), dann werden die Momentaufnahmen erzeugt -
 * und erst ganz unten steht der Knopf, der ihn nach draussen gibt. Wer von
 * oben nach unten arbeitet, hat nichts vergessen.
 */
export default async function WrappedKampagnePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.studioView);
  const stand = await ladeWrappedStand(context);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="SwissHub Wrapped ist ausgeschaltet." />;
  }

  const campaign = await prisma.wrappedCampaign.findUnique({
    where: { id },
    include: { scenes: true, _count: { select: { snapshots: true, views: true } } },
  });
  if (!campaign || campaign.guildId !== stand.guildId) {
    notFound();
  }

  const [lauf, pruefung, quellen, kandidaten] = await Promise.all([
    wrapped.letzterDurchgang(campaign.id),
    wrapped.pruefeFreigabe(campaign.id),
    ladeQuellenlage(campaign),
    wrapped.zaehleKandidaten(campaign),
  ]);

  const csrfToken = await csrfTokenFor(context);
  const festgeschrieben = campaign.status === 'PUBLISHED' || campaign.status === 'ARCHIVED';
  const schreibbar = stand.darfBearbeiten && campaign.status !== 'ARCHIVED';

  return (
    <div className="space-y-6">
      <ZurueckLink fallback={systemRoutes.wrappedStudio()} fallbackLabel="Wrapped Studio" />

      {/* Auch von einem einzelnen Rückblick aus: die übrigen Bereiche des
          Moduls sollen von jeder Seite erreichbar sein, nicht nur von der
          Übersicht. */}
      <ModulNavigation
        eintraege={wrappedBereiche(context)}
        aktiv="studio"
        label="Bereiche in SwissHub Wrapped"
      />

      <PageHeader
        title={campaign.title}
        description={`/wrapped/${campaign.key} · ${campaign._count.snapshots} Momentaufnahmen · ${campaign._count.views} mal geöffnet`}
        actions={
          <>
            <Badge variant={WRAPPED_STATUS_FARBE[campaign.status] ?? 'secondary'}>
              {WRAPPED_STATUS_TEXT[campaign.status] ?? campaign.status}
            </Badge>
            {stand.darfVorschau ? (
              <Button asChild variant="outline">
                <Link href={systemRoutes.wrappedVorschau(campaign.id)}>
                  <Eye className="size-4" aria-hidden="true" />
                  Vorschau
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Panel
        title="Einstellungen"
        icon={<Settings2 aria-hidden="true" />}
        description="Zeitraum, Texte und wer überhaupt einen Rückblick bekommt."
        bodyClassName="p-5"
      >
        <KampagneEditor
          csrfToken={csrfToken}
          schreibbar={schreibbar}
          festgeschrieben={festgeschrieben}
          werte={{
            campaignId: campaign.id,
            title: campaign.title,
            displayYear: campaign.displayYear,
            periodStart: alsFeld(campaign.periodStart),
            periodEnd: alsFeld(campaign.periodEnd),
            introText: campaign.introText ?? '',
            outroText: campaign.outroText ?? '',
            shareCardsEnabled: campaign.shareCardsEnabled,
            announceEnabled: campaign.announceEnabled,
            announcementChannelId: campaign.announcementChannelId ?? '',
            minActiveDays: campaign.minActiveDays,
            minMessages: campaign.minMessages,
            minVoiceMinutes: campaign.minVoiceMinutes,
          }}
        />
      </Panel>

      <Panel
        title="Szenen"
        icon={<ListOrdered aria-hidden="true" />}
        description="Reihenfolge und welche Kapitel erscheinen dürfen."
        bodyClassName="p-5"
      >
        <SzenenEditor
          campaignId={campaign.id}
          csrfToken={csrfToken}
          schreibbar={schreibbar}
          vorschauHref={systemRoutes.wrappedVorschau(campaign.id)}
          zeilen={campaign.scenes.map((szene) => ({
            sceneKey: szene.sceneKey,
            enabled: szene.enabled,
            position: szene.position,
          }))}
        />
      </Panel>

      <Panel
        title="Datenquellen"
        icon={<Activity aria-hidden="true" />}
        description="Woher die Zahlen kommen - und seit wann es sie gibt."
        bodyClassName="p-5"
      >
        <QuellenTafel quellen={quellen} />
      </Panel>

      <Panel
        title="Momentaufnahmen"
        icon={<Images aria-hidden="true" />}
        description="Für jedes Mitglied wird der Rückblick einmal ausgerechnet und eingefroren."
        bodyClassName="p-5"
      >
        <DurchgangPanel
          campaignId={campaign.id}
          csrfToken={csrfToken}
          darfErzeugen={stand.darfErzeugen}
          gesperrt={festgeschrieben}
          kandidaten={kandidaten}
          snapshots={campaign._count.snapshots}
          lauf={
            lauf
              ? {
                  id: lauf.id,
                  status: lauf.status,
                  total: lauf.total,
                  processed: lauf.processed,
                  created: lauf.created,
                  skipped: lauf.skipped,
                  failed: lauf.failed,
                  grund: lauf.failureReason,
                  /*
                   * Die Wartezeit wird hier gerechnet, nicht im Browser.
                   *
                   * Eine falsch gestellte Uhr im Browser ergaebe sonst eine
                   * Warnung, die es nicht gibt - oder keine, wo es eine
                   * braeuchte.
                   */
                  wartetSeit:
                    lauf.status === 'QUEUED'
                      ? Math.max(0, Math.round((Date.now() - lauf.createdAt.getTime()) / 1000))
                      : null,
                }
              : null
          }
        />
        {lauf && lauf.failed > 0 ? <Fehlerliste lauf={lauf} /> : null}
      </Panel>

      <Panel
        title="Veröffentlichen"
        icon={<Rocket aria-hidden="true" />}
        description={
          campaign.publishedAt
            ? `Veröffentlicht am ${wrappedZeit(campaign.publishedAt)}`
            : 'Der letzte Schritt - danach sehen es alle.'
        }
        bodyClassName="p-5"
      >
        <FreigabePanel
          campaignId={campaign.id}
          csrfToken={csrfToken}
          darfVeroeffentlichen={stand.darfVeroeffentlichen}
          kuendigtAn={campaign.announceEnabled && campaign.announcementChannelId !== null}
          pruefung={pruefung}
          status={campaign.status}
        />
      </Panel>
    </div>
  );
}

/**
 * Was beim letzten Durchgang schiefging.
 *
 * Mit Kennung, weil genau diese Personen keinen Rueckblick haben - und weil
 * ein Fehler ohne Adresse sich nicht nachstellen laesst. Die Liste steht im
 * Studio und sonst nirgends.
 */
function Fehlerliste({ lauf }: { lauf: Parameters<typeof wrapped.fehlerVon>[0] }): React.JSX.Element {
  const fehler = wrapped.fehlerVon(lauf);
  if (fehler.length === 0) {
    return <></>;
  }
  return (
    <details className="mt-4 rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{fehler.length} gescheiterte Momentaufnahmen</summary>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {fehler.map((eintrag) => (
          <li key={eintrag.discordId} className="truncate">
            <code>{eintrag.discordId}</code> – {eintrag.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
