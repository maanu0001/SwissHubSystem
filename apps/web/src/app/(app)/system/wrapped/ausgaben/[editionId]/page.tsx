import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { AusgabeEditor } from '@/modules/wrapped/components/ausgabe-editor';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeWrappedStand } from '@/server/wrapped';

export const metadata: Metadata = { title: 'Wrapped Ausgabe' };
export const dynamic = 'force-dynamic';

/**
 * Eine Ausgabe bearbeiten.
 *
 * Was jemand hier tun darf, entscheidet die Permission Engine - und zwar
 * serverseitig. Die Knoepfe, die der Editor zeigt, richten sich nach
 * denselben Antworten; sichtbar ist aber nicht erlaubt: jede Aktion prueft
 * ihre Berechtigung noch einmal selbst.
 */
export default async function WrappedAusgabePage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<{ von?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.studioView);
  const stand = await ladeWrappedStand(context);

  if (!stand.aktiv) {
    return <ErrorState title="Modul deaktiviert" description="SwissHub Wrapped ist derzeit ausgeschaltet." />;
  }

  const [{ editionId }, { von }] = await Promise.all([params, searchParams]);
  const ausgabe = await wrapped.ladeAusgabe(editionId);
  if (!ausgabe || ausgabe.guildId !== stand.guildId) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <ZurueckLink von={von} fallback={systemRoutes.wrappedAusgaben()} fallbackLabel="Ausgaben" />

      <PageHeader
        title={ausgabe.title}
        description={
          ausgabe.failureReason
            ? `Die Erhebung ist gescheitert: ${ausgabe.failureReason}`
            : (ausgabe.subtitle ?? undefined)
        }
      />

      <AusgabeEditor
        csrfToken={csrfTokenFor(context)}
        host={new URL(appUrl('/')).host}
        ausgabe={{
          id: ausgabe.id,
          titel: ausgabe.title,
          periodKey: ausgabe.periodKey,
          status: ausgabe.status,
          variante: ausgabe.variant,
          folien: ausgabe.folien.map((folie) => ({
            id: folie.id,
            storyKey: folie.storyKey,
            templateKey: folie.templateKey,
            position: folie.position,
            enabled: folie.enabled,
            daten: folie.daten,
            editorial: folie.editorial,
          })),
          gruende: ausgabe.gruende,
        }}
        rechte={{
          bearbeiten: can(context, wrapped.WRAPPED_PERMISSIONS.studioEdit),
          erzeugen: can(context, wrapped.WRAPPED_PERMISSIONS.generate),
          einfrieren: can(context, wrapped.WRAPPED_PERMISSIONS.editionFinalize),
          entsperren: can(context, wrapped.WRAPPED_PERMISSIONS.editionUnlock),
          veroeffentlichen: can(context, wrapped.WRAPPED_PERMISSIONS.publish),
          exportieren: can(context, wrapped.WRAPPED_PERMISSIONS.export),
        }}
      />
    </div>
  );
}
