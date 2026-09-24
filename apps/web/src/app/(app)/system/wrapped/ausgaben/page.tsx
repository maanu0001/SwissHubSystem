import type { Metadata } from 'next';
import Link from 'next/link';
import { Images, Sparkles } from 'lucide-react';
import { prisma } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { can } from '@swisshub/auth';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { AusgabeAnlegen, AusgabenListe } from '@/modules/wrapped/components/ausgaben-uebersicht';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeWrappedStand } from '@/server/wrapped';

export const metadata: Metadata = { title: 'Wrapped Ausgaben' };
export const dynamic = 'force-dynamic';

/**
 * Die Monats- und Jahresausgaben.
 *
 * Im Studio und nicht daneben: es ist dasselbe Modul, dieselbe Berechtigung
 * und dieselbe Arbeit. Ein eigener Hauptpunkt in der Seitenleiste waere ein
 * zweiter Ort, an dem man «Wrapped» sucht.
 */
export default async function WrappedAusgabenPage(): Promise<React.JSX.Element> {
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

  const guildId = await resolveGuildId();
  const zeilen = await prisma.wrappedEdition.findMany({
    where: { guildId },
    orderBy: [{ periodStart: 'desc' }],
    take: 40,
    select: {
      id: true,
      type: true,
      periodKey: true,
      title: true,
      status: true,
      generatedAt: true,
      failureReason: true,
      _count: { select: { slides: true } },
    },
  });

  const jetzt = new Date();
  const monat = wrapped.letzterAbgeschlossenerMonat(jetzt);
  const jahr = wrapped.letztesAbgeschlossenesJahr(jetzt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ausgaben"
        description="Monats- und Jahresrückblicke über die Community - als fertige Bilder für Social Media."
        actions={
          <div className="flex gap-2">
            <Link
              href={systemRoutes.wrappedMomente()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30"
            >
              <Images className="size-4" aria-hidden="true" />
              Community Moments
            </Link>
            <Link
              href={systemRoutes.wrappedStudio()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm transition-colors hover:border-foreground/30"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Jahresrückblick je Mitglied
            </Link>
          </div>
        }
      />

      {can(context, wrapped.WRAPPED_PERMISSIONS.generate) ? (
        <AusgabeAnlegen
          csrfToken={csrfTokenFor(context)}
          monatsVorschlag={monat.key}
          jahresVorschlag={jahr.key}
        />
      ) : null}

      <AusgabenListe
        ausgaben={zeilen.map((zeile) => ({
          id: zeile.id,
          type: zeile.type,
          periodKey: zeile.periodKey,
          titel: zeile.title,
          status: zeile.status,
          folien: zeile._count.slides,
          generatedAt: zeile.generatedAt,
          failureReason: zeile.failureReason,
        }))}
      />
    </div>
  );
}
