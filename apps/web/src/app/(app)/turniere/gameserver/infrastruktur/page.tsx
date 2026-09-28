import type { Metadata } from 'next';
import { gameserver, tournaments } from '@swisshub/modules';
import { Panel } from '@/components/shared/panel';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@swisshub/shared';
import { GameserverSectionNav } from '@/modules/gameserver/components/section-nav';
import { AnbieterVerwaltung } from '@/modules/gameserver/components/anbieter-verwaltung';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { gameserverAbschnitte, ladeInfrastruktur } from '@/server/gameserver';

export const metadata: Metadata = { title: 'Infrastruktur' };
export const dynamic = 'force-dynamic';

/**
 * Die Anbieter.
 *
 * ## Was diese Seite nicht zeigt
 *
 * Die Zugangsdaten. Sie liegen verschlüsselt im Integrationsspeicher und
 * werden unter System → Integrationen gepflegt - hier steht nur, ob welche
 * da sind und ob die letzte Prüfung gestanden hat. Ein Dashboard, das
 * Geheimnisse anzeigt, ist ein Dashboard, aus dem Geheimnisse herausfallen.
 */
export default async function InfrastrukturPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tournaments.TOURNAMENT_PERMISSIONS.infrastructureManage);
  const [infrastruktur, csrfToken] = await Promise.all([ladeInfrastruktur(), csrfTokenFor(context)]);

  return (
    <div className="space-y-6">
      <GameserverSectionNav abschnitte={gameserverAbschnitte(context)} />

      <Panel
        title="Zugangsdaten"
        icon="KeyRound"
        description="Verschlüsselt gespeichert, nie angezeigt. Gepflegt unter System → Integrationen → Virtual Datacenter."
      >
        <Badge variant={infrastruktur.zugangsdatenVorhanden ? 'success' : 'warning'}>
          {infrastruktur.zugangsdatenVorhanden ? 'hinterlegt' : 'nicht eingerichtet'}
        </Badge>
      </Panel>

      <Panel title="Angebundene Anbieter" icon="Server">
        {infrastruktur.anbieter.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch kein Anbieter. Lege unten einen an - mit dem Treiber, der zu eurem Datacenter passt.
          </p>
        ) : (
          <ul className="space-y-2">
            {infrastruktur.anbieter.map((anbieter) => (
              <li
                key={anbieter.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{anbieter.name}</span>
                    <Badge variant={anbieter.enabled ? 'success' : 'outline'}>
                      {anbieter.enabled ? 'aktiv' : 'aus'}
                    </Badge>
                    {anbieter.simulation ? <Badge variant="warning">Simulation</Badge> : null}
                    {anbieter.treiberVorhanden ? null : <Badge variant="destructive">Treiber fehlt</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Treiber {anbieter.driver}
                    {anbieter.region ? ` · ${anbieter.region}` : ''} · {anbieter.templateAnzahl} Templates
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {anbieter.lastCheckAt === null
                      ? 'Verbindung nie geprüft.'
                      : `${anbieter.lastCheckOk ? 'Zuletzt in Ordnung' : 'Zuletzt fehlgeschlagen'} (${formatDateTime(anbieter.lastCheckAt)})${anbieter.lastCheckMessage ? ` - ${anbieter.lastCheckMessage}` : ''}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AnbieterVerwaltung
        anbieter={infrastruktur.anbieter.map((a) => ({ id: a.id, name: a.name }))}
        treiber={gameserver.listeAnbieterTreiber().map((t) => ({ key: t.key, label: t.label }))}
        csrfToken={csrfToken}
      />
    </div>
  );
}
