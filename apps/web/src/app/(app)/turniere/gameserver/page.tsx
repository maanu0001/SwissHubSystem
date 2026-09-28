import type { Metadata } from 'next';
import { tournaments } from '@swisshub/modules';
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
 * Sie beantwortet drei Fragen in dieser Reihenfolge: läuft die Sache
 * überhaupt, wie viele Server sind gerade da, und wartet etwas auf eine
 * Entscheidung. Alles Weitere steht in den anderen Bereichen.
 */
export default async function GameserverPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.gameserverView);
  const infrastruktur = await ladeInfrastruktur();

  const bereit =
    infrastruktur.eingeschaltet && infrastruktur.anbieterVorhanden && infrastruktur.zugangsdatenVorhanden;

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />

      <Panel
        title="Betriebsbereitschaft"
        icon="Server"
        description="Was fehlt, damit Matches automatisch einen Server bekommen."
      >
        <ul className="space-y-2 text-sm">
          <Zeile
            erfuellt={infrastruktur.eingeschaltet}
            text="Gameserver-Funktion in den Moduleinstellungen eingeschaltet"
            hinweis="System → Module → Turniere"
          />
          <Zeile
            erfuellt={infrastruktur.anbieterVorhanden}
            text="Mindestens ein Anbieter eingerichtet"
            hinweis="Bereich «Infrastruktur»"
          />
          <Zeile
            erfuellt={infrastruktur.zugangsdatenVorhanden}
            text="Zugangsdaten des Datacenters hinterlegt"
            hinweis="System → Integrationen → Virtual Datacenter"
          />
        </ul>

        {bereit ? null : (
          <p className="mt-4 text-sm text-muted-foreground">
            Solange etwas davon fehlt, laufen Turniere wie bisher - nur ohne automatische Server.
          </p>
        )}
      </Panel>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Laufende Server" value={infrastruktur.stand.laufend} icon="Server" />
        <StatCard
          label="In Bereitstellung"
          value={infrastruktur.stand.inBereitstellung}
          icon="RefreshCw"
          tone={infrastruktur.stand.inBereitstellung > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Fehlerhaft"
          value={infrastruktur.stand.fehlerhaft}
          icon="ShieldAlert"
          tone={infrastruktur.stand.fehlerhaft > 0 ? 'destructive' : 'default'}
          href="/turniere/gameserver/server"
        />
        <StatCard
          label="Wartet auf Entscheidung"
          value={infrastruktur.stand.wartetAufEntscheidung}
          hint="Resultat unklar oder Archivierung offen"
          icon="Gavel"
          tone={infrastruktur.stand.wartetAufEntscheidung > 0 ? 'warning' : 'default'}
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
              infrastruktur.stand.durchschnittProvisioningSekunden === null
                ? 'noch nicht gemessen'
                : `${infrastruktur.stand.durchschnittProvisioningSekunden} Sek.`
            }
          />
        </dl>
      </Panel>
    </div>
  );
}

function Zeile({
  erfuellt,
  text,
  hinweis,
}: {
  erfuellt: boolean;
  text: string;
  hinweis: string;
}): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Badge variant={erfuellt ? 'success' : 'warning'}>{erfuellt ? 'steht' : 'fehlt'}</Badge>
      <span>{text}</span>
      {erfuellt ? null : <span className="text-xs text-muted-foreground">{hinweis}</span>}
    </li>
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
