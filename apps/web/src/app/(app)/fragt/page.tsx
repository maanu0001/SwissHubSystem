import type { Metadata } from 'next';
import Link from 'next/link';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { resolveGuildId } from '@swisshub/discord';
import { can } from '@swisshub/auth';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { QuickAction } from '@/components/shared/quick-action';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { fragtNavigation } from '@/modules/fragt/navigation';
import { ErgebnisBalken } from '@/modules/fragt/components/ergebnis-balken';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'SwissHub fragt' };
export const dynamic = 'force-dynamic';

const zeit = (wert: Date): string =>
  wert.toLocaleString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

/**
 * Die Übersicht.
 *
 * Was läuft, was kommt, was zuletzt war - und die Zahlen dazu. Kein zweiter
 * Seitentitel: die Kopfzeile oben nennt das Modul, die Panels darunter nennen
 * ihren Abschnitt.
 */
export default async function FragtUebersichtPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.view);
  const guildId = await resolveGuildId();
  const [uebersicht, konfiguration] = await Promise.all([
    fragt.ladeUebersicht(guildId),
    fragt.einstellungen(),
  ]);

  const darfVeroeffentlichen = can(context, fragt.FRAGT_PERMISSIONS.publish);
  const darfStudio = can(context, fragt.FRAGT_PERMISSIONS.studio);
  const darfFragen = can(context, fragt.FRAGT_PERMISSIONS.questions);

  return (
    <div className="space-y-6">
      {/*
        Kein `PageHeader` auf dieser Seite.

        Den Modulnamen rendert die Kopfzeile der Anwendung schon als `h1` - er
        steht in der Module Registry. Ein zweiter Titel darunter wäre dieselbe
        Überschrift zweimal; ein Test hält das fest. Was die Kopfzeile nicht
        sagen kann, steht unter der Navigation.
      */}
      <ModulNavigation
        eintraege={fragtNavigation(context)}
        aktiv="uebersicht"
        label="Bereiche in SwissHub fragt"
      />

      <p className="text-sm text-muted-foreground">
        {konfiguration.autoPublish && uebersicht.naechsterAutomatikTermin
          ? `Die nächste Frage ist für ${zeit(uebersicht.naechsterAutomatikTermin)} vorgesehen - Auswahl ${konfiguration.selectionMode === 'automatisch' ? 'automatisch aus der Bibliothek' : 'nur aus geplanten Fragen'}.`
          : 'Die automatische Veröffentlichung ist aus. Fragen werden von Hand gestellt.'}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Läuft gerade"
          value={uebersicht.laufend ? `${uebersicht.laufend.stand.gesamt}` : '–'}
          hint={uebersicht.laufend ? 'abgegebene Stimmen' : 'keine offene Abstimmung'}
          icon="Radio"
          tone={uebersicht.laufend ? 'success' : 'default'}
          href={systemRoutes.fragtAktiv()}
        />
        <StatCard
          label="Freigegeben"
          value={String(uebersicht.zahlen.freigegeben)}
          hint={`${uebersicht.zahlen.entwuerfe} Entwürfe · ${uebersicht.zahlen.geplant} geplant`}
          icon="Library"
          href={systemRoutes.fragtBibliothek()}
        />
        <StatCard
          label="Gestellte Fragen"
          value={String(uebersicht.zahlen.veroeffentlichteFragen)}
          hint={`${uebersicht.zahlen.stimmenGesamt} Stimmen insgesamt`}
          icon="MessageCircleQuestion"
          href={systemRoutes.fragtErgebnisse()}
        />
        <StatCard
          label="Noch nicht gepostet"
          value={String(uebersicht.zahlen.nichtExportiert)}
          hint="abgeschlossen, ohne Social-Media-Vermerk"
          icon="Image"
          tone={uebersicht.zahlen.nichtExportiert > 0 ? 'warning' : 'default'}
          href={systemRoutes.fragtErgebnisse()}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Aktuelle Frage"
          icon="Radio"
          description={
            uebersicht.laufend
              ? `Endet ${zeit(uebersicht.laufend.abstimmung.closesAt)}`
              : 'Zurzeit läuft keine Abstimmung.'
          }
          action={
            uebersicht.laufend ? (
              <Link
                href={systemRoutes.fragtAktiv()}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Ansehen
              </Link>
            ) : null
          }
        >
          {uebersicht.laufend ? (
            <div className="space-y-4">
              <p className="text-balance font-semibold leading-tight">
                {uebersicht.laufend.abstimmung.frageText}
              </p>
              {/* Der Stand für die Verwaltung - unabhängig davon, ob er
                  öffentlich im Kanal steht. */}
              <ErgebnisBalken ergebnis={uebersicht.laufend.stand} />
              {!uebersicht.laufend.abstimmung.zwischenstandSichtbar ? (
                <p className="text-xs text-muted-foreground">
                  Öffentlich sind diese Zahlen nicht - im Kanal erscheinen sie erst nach Ende.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="Keine offene Abstimmung"
              description={
                uebersicht.naechsterAutomatikTermin
                  ? `Die nächste Frage ist für ${zeit(uebersicht.naechsterAutomatikTermin)} vorgesehen.`
                  : 'Die automatische Veröffentlichung ist aus. Stelle eine Frage von Hand oder schalte sie in den Einstellungen ein.'
              }
            />
          )}
        </Panel>

        <Panel
          title="Zuletzt abgeschlossen"
          icon="BarChart3"
          description={
            uebersicht.letzte?.abstimmung.closedAt
              ? zeit(uebersicht.letzte.abstimmung.closedAt)
              : 'Noch keine abgeschlossene Abstimmung.'
          }
          action={
            uebersicht.letzte ? (
              <Link
                href={systemRoutes.fragtErgebnis(uebersicht.letzte.abstimmung.id)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Ergebnis
              </Link>
            ) : null
          }
        >
          {uebersicht.letzte?.ergebnis ? (
            <div className="space-y-4">
              <p className="text-balance font-semibold leading-tight">
                {uebersicht.letzte.abstimmung.frageText}
              </p>
              <ErgebnisBalken ergebnis={uebersicht.letzte.ergebnis} />
              {darfStudio && uebersicht.letzte.entwurf ? (
                <Link
                  href={systemRoutes.fragtStudio(uebersicht.letzte.entwurf.id)}
                  className={cn(buttonVariants({ size: 'sm' }), 'w-full sm:w-auto')}
                >
                  Social-Media-Grafiken erstellen
                </Link>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="Noch nichts abgeschlossen"
              description="Sobald die erste Abstimmung endet, steht das Ergebnis hier - und daraus entsteht ein Entwurf fürs Content Studio."
            />
          )}
        </Panel>
      </div>

      <Panel title="Schnell erledigt" icon="Zap">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {darfFragen ? (
            <QuickAction
              title="Neue Frage"
              description="In die Bibliothek schreiben"
              icon="Plus"
              href={systemRoutes.fragtBibliothek()}
            />
          ) : null}
          {darfVeroeffentlichen ? (
            <QuickAction
              title="Frage planen"
              description="Termin zuweisen"
              icon="CalendarClock"
              href={systemRoutes.fragtGeplant()}
            />
          ) : null}
          <QuickAction
            title="Aktuelle Abstimmung"
            description="Stand und Schliessen"
            icon="Radio"
            href={systemRoutes.fragtAktiv()}
          />
          <QuickAction
            title="Ergebnisse"
            description="Zahlen und Beteiligung"
            icon="BarChart3"
            href={systemRoutes.fragtErgebnisse()}
          />
        </div>
      </Panel>
    </div>
  );
}
