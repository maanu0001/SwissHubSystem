import type { Metadata } from 'next';
import { gameserver, tournaments } from '@swisshub/modules';
import { StatCard } from '@/components/shared/stat-card';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte, ladeInfrastruktur } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Gameserver' };
export const dynamic = 'force-dynamic';

/**
 * Die Übersicht.
 *
 * ## Was sie zuerst beantwortet
 *
 * «Läuft das hier überhaupt?» - und zwar ehrlich. Gameserver sind eine
 * freiwillige Erweiterung; die meisten Installationen werden nie eine
 * haben. «Nicht eingerichtet» ist deshalb kein Fehler, sondern eine
 * Auskunft, und diese Seite sagt sie in einem Satz, mit der Liste dessen,
 * was fehlt, und der Stelle, an der man es einträgt.
 *
 * Was sie **nicht** tut: so aussehen, als wäre etwas kaputt. Kein rotes
 * Banner, keine Fehlermeldung. Ein Turnier ohne Gameserver ist ein normales
 * Turnier.
 */
export default async function GameserverPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.gameserverView);
  const infrastruktur = await ladeInfrastruktur();
  const { stand, zahlen } = infrastruktur;

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />

      <Panel
        title="Betriebsbereitschaft"
        icon="Server"
        description={
          !stand.ermittelt
            ? 'Der Zustand lässt sich gerade nicht ermitteln.'
            : stand.bereit
              ? stand.nurSimulation
                ? 'Eingerichtet - aber nur mit dem Simulationstreiber. Es entstehen keine echten Maschinen.'
                : 'Eingerichtet. Matches bekommen automatisch einen Server.'
              : 'Noch nicht eingerichtet. Turniere laufen unverändert weiter - nur ohne automatische Server.'
        }
      >
        {!stand.ermittelt ? (
          <p className="text-sm text-muted-foreground">
            Sobald die Datenbank wieder antwortet, steht hier, was noch fehlt.
          </p>
        ) : stand.luecken.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">bereit</Badge>
            {stand.nurSimulation ? <Badge variant="warning">nur Simulation</Badge> : null}
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {stand.luecken.map((luecke) => {
              const eintrag = gameserver.LUECKEN_TEXT[luecke];
              return (
                <li key={luecke} className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline">offen</Badge>
                  <span>{eintrag.text}</span>
                  <span className="text-xs text-muted-foreground">{eintrag.wo}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Laufende Server" value={zahlen.laufend} icon="Server" />
        <StatCard
          label="In Bereitstellung"
          value={zahlen.inBereitstellung}
          icon="RefreshCw"
          tone={zahlen.inBereitstellung > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Fehlerhaft"
          value={zahlen.fehlerhaft}
          icon="ShieldAlert"
          tone={zahlen.fehlerhaft > 0 ? 'destructive' : 'default'}
          href="/turniere/gameserver/server"
        />
        <StatCard
          label="Wartet auf Entscheidung"
          value={zahlen.wartetAufEntscheidung}
          hint="Resultat unklar oder Archivierung offen"
          icon="Gavel"
          tone={zahlen.wartetAufEntscheidung > 0 ? 'warning' : 'default'}
        />
      </section>

      <Panel title="Grenzwerte" icon="Gauge" description="Eingestellt unter System → Module → Turniere.">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Wert name="Server insgesamt" wert={infrastruktur.grenzen.maxTotal} />
          <Wert name="Je Spiel" wert={infrastruktur.grenzen.maxPerGame} />
          <Wert name="Gleichzeitige Bereitstellungen" wert={infrastruktur.grenzen.maxParallelProvisioning} />
          <Wert name="Je Turnier" wert={infrastruktur.grenzen.maxPerTournament} />
          <Wert name="Leerlauf bis zum Aufräumen" wert={`${infrastruktur.grenzen.idleTimeoutMinutes} Min.`} />
          <Wert
            name="Durchschnittliche Bereitstellung"
            wert={
              zahlen.durchschnittProvisioningSekunden === null
                ? 'noch nicht gemessen'
                : `${zahlen.durchschnittProvisioningSekunden} Sek.`
            }
          />
        </dl>
      </Panel>
    </div>
  );
}

function Wert({ name, wert }: { name: string; wert: string | number }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="font-medium tabular-nums">{wert}</dd>
    </div>
  );
}
