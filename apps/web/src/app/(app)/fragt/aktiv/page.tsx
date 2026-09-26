import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { fragtNavigation } from '@/modules/fragt/navigation';
import { ErgebnisBalken } from '@/modules/fragt/components/ergebnis-balken';
import { AbstimmungSchliessen } from '@/modules/fragt/components/abstimmung-schliessen';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Aktive Abstimmung' };
export const dynamic = 'force-dynamic';

const zeit = (wert: Date): string =>
  wert.toLocaleString('de-CH', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

/**
 * Die laufende Abstimmung.
 *
 * ## Warum der Stand hier auch dann steht, wenn er oeffentlich verborgen ist
 *
 * Die Einstellung «Zwischenstand oeffentlich zeigen» regelt den Kanal. Wer das
 * Modul verwaltet, braucht die Zahl trotzdem - sonst laesst sich nicht
 * entscheiden, ob eine Frage laeuft oder nur dasteht.
 *
 * Was hier ausdruecklich nicht steht: wer wie gestimmt hat. Diese Seite zeigt
 * Summen.
 */
export default async function FragtAktivPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const laufend = await fragt.laufendeAbstimmung(guildId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aktive Abstimmung"
        description={laufend ? `Endet ${zeit(laufend.closesAt)}` : 'Zurzeit läuft keine Abstimmung.'}
        actions={
          laufend && can(context, fragt.FRAGT_PERMISSIONS.close) ? (
            <AbstimmungSchliessen
              csrfToken={csrfTokenFor(context)}
              abstimmungId={laufend.id}
              frageText={laufend.frageText}
              stimmen={(await fragt.zaehleStimmen(laufend.id)).gesamt}
              endetAm={zeit(laufend.closesAt)}
            />
          ) : null
        }
      />
      <ModulNavigation
        eintraege={fragtNavigation(context)}
        aktiv="aktiv"
        label="Bereiche in SwissHub fragt"
      />

      {laufend ? (
        <Panel
          title={laufend.frageText}
          icon="Radio"
          description={laufend.untertitel ?? undefined}
          action={
            <Link
              href={systemRoutes.fragtErgebnisse()}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Frühere Ergebnisse
            </Link>
          }
        >
          <div className="space-y-4">
            <ErgebnisBalken ergebnis={await fragt.zaehleStimmen(laufend.id)} />
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Gestartet {zeit(laufend.opensAt)}</span>
              <span>Endet {zeit(laufend.closesAt)}</span>
              <span>
                Zwischenstand im Kanal:{' '}
                {laufend.zwischenstandSichtbar ? 'sichtbar' : 'verborgen bis zum Ende'}
              </span>
              {laufend.messageId ? null : (
                <span className="text-amber-500">
                  Die Discord-Nachricht steht noch aus - der nächste Durchgang holt sie nach.
                </span>
              )}
            </div>
          </div>
        </Panel>
      ) : (
        <EmptyState
          title="Keine offene Abstimmung"
          description="Stelle in der Bibliothek eine Frage von Hand, oder warte auf den nächsten geplanten Termin."
        />
      )}
    </div>
  );
}
