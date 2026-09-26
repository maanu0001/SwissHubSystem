import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { ErgebnisBalken } from '@/modules/fragt/components/ergebnis-balken';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ergebnis' };
export const dynamic = 'force-dynamic';

const zeit = (wert: Date | null): string =>
  wert
    ? wert.toLocaleString('de-CH', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Zurich',
      })
    : '–';

/**
 * Ein einzelnes Ergebnis.
 *
 * Die Zahlen kommen aus dem Schnappschuss, der beim Schliessen festgeschrieben
 * wurde - nicht aus einer Neuauszaehlung. Eine spaeter umbenannte Antwort
 * aendert sie damit nicht, und zweimal geoeffnet steht zweimal dasselbe.
 */
export default async function FragtErgebnisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.results);
  const { id } = await params;
  const ansicht = await fragt.ladeAbstimmung(id);
  if (!ansicht) {
    notFound();
  }

  const { abstimmung, ergebnis, entwurf } = ansicht;
  const laeuftNoch = abstimmung.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <ZurueckLink fallback={systemRoutes.fragtErgebnisse()} fallbackLabel="Ergebnisse" />
      <PageHeader
        title={abstimmung.frageText}
        description={
          laeuftNoch
            ? `Läuft noch bis ${zeit(abstimmung.closesAt)} - die Zahlen sind ein Zwischenstand.`
            : `Geschlossen am ${zeit(abstimmung.closedAt)}`
        }
        actions={
          can(context, fragt.FRAGT_PERMISSIONS.studio) && entwurf ? (
            <Link href={systemRoutes.fragtStudio(entwurf.id)} className={cn(buttonVariants({ size: 'sm' }))}>
              Content Studio
            </Link>
          ) : null
        }
      />

      {ergebnis ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Gültige Stimmen" value={String(ergebnis.gesamt)} icon="Users" />
            <StatCard
              label="Gewinner"
              value={
                ergebnis.gewinner
                  ? `${ergebnis.gewinner.prozent} %`
                  : ergebnis.gleichstand.length > 0
                    ? 'Gleichstand'
                    : '–'
              }
              hint={
                ergebnis.gewinner?.label ??
                (ergebnis.gleichstand.length > 0
                  ? ergebnis.gleichstand.map((zeile) => zeile.label).join(' und ')
                  : 'keine Stimmen')
              }
              icon="Trophy"
              tone={ergebnis.gewinner ? 'success' : 'default'}
            />
            <StatCard
              label="Antwortmöglichkeiten"
              value={String(ergebnis.zeilen.length)}
              hint={fragt.fragetyp(abstimmung.typ).label}
              icon="List"
            />
          </div>

          <Panel title="Verteilung" icon="BarChart3" description={abstimmung.untertitel ?? undefined}>
            <ErgebnisBalken ergebnis={ergebnis} />
          </Panel>

          <Panel title="Ablauf" icon="Clock">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Veröffentlicht</dt>
                <dd>{zeit(abstimmung.opensAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reguläres Ende</dt>
                <dd>{zeit(abstimmung.closesAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tatsächlich geschlossen</dt>
                <dd>{zeit(abstimmung.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Zwischenstand im Kanal</dt>
                <dd>{abstimmung.zwischenstandSichtbar ? 'war sichtbar' : 'war verborgen'}</dd>
              </div>
            </dl>
          </Panel>
        </>
      ) : (
        <EmptyState
          title="Kein lesbares Ergebnis"
          description="Zu dieser Abstimmung liegt kein Ergebnis in der erwarteten Form vor. Die Stimmen sind nicht verloren - sie lassen sich nur nicht darstellen."
        />
      )}
    </div>
  );
}
