/**
 * Ein Durchgang der Serverorchestrierung.
 *
 * ## Im bestehenden Zeitplaner
 *
 * Kein eigener Scheduler, kein `setTimeout`, keine zweite Bot-Instanz. Der
 * Durchgang laeuft im Job-Runner des Bots wie die Turniere selbst, und die
 * Datenbank bleibt Source of Truth: was waehrend eines Ausfalls faellig
 * wurde, holt der naechste Durchgang nach.
 *
 * ## Die sechs Schritte
 *
 *   1. Hosts abfragen - das ist zugleich ihr Lebenszeichen
 *   2. faellige Bereitstellungen anstossen
 *   3. anlaufende Instanzen weiterbringen
 *   4. haengengebliebene als gescheitert markieren
 *   5. ausgefallene Hosts melden
 *   6. aufraeumen, was fertig ist
 *
 * Jeder Schritt ist fuer sich wiederholbar und faengt seine Fehler selbst
 * ab. Ein Host, der nicht antwortet, darf die anderen fuenf Schritte nicht
 * anhalten - und den Bot schon gar nicht.
 *
 * ## Warum SwissHub fragt statt der Host zu melden
 *
 * Ein Host koennte seinen Zustand auch von sich aus schicken. Das haette
 * einen oeffentlichen Endpunkt gebraucht, der Meldungen entgegennimmt, und
 * damit eine zweite Stelle, an der ein fremder Prozess auf SwissHub
 * einwirkt. Der Durchgang laeuft ohnehin jede Minute - er fragt, und die
 * Antwort ist das Lebenszeichen. Eine Angriffsflaeche weniger, eine
 * Zeitsteuerung weniger.
 */
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from '../tournaments/config';
import { konfigurationsStand } from './bereitschaft';
import { hostZugriff, type AgentTransport } from './agent-client';
import { HEARTBEAT_FRIST_SEKUNDEN, hostAgentToken, nimmHostLebenszeichen } from './hosts';
import { provisioniere, raeumeAuf, type OrchestratorEinstellungen } from './orchestrator';
import { raeumeVerwaisteReservierungen } from './ports';

const log = createLogger('gameserver:tick');

export interface GameserverTickErgebnis {
  hostsGefragt: number;
  angestossen: number;
  fortgeschritten: number;
  abgelaufen: number;
  unterbrochen: number;
  geloescht: number;
}

/** Die Einstellungen in die Form bringen, die der Orchestrator erwartet. */
export function leseEinstellungen(settings: TournamentSettings): OrchestratorEinstellungen {
  return {
    enabled: settings.gameserverEnabled,
    maxTotal: settings.gameserverMaxTotal,
    maxPerGame: settings.gameserverMaxPerGame,
    maxParallelProvisioning: settings.gameserverMaxParallelProvisioning,
    maxPerTournament: settings.gameserverMaxPerTournament,
    provisionLeadMinutes: settings.gameserverProvisionLeadMinutes,
    provisioningTimeoutMinutes: settings.gameserverProvisioningTimeoutMinutes,
    idleTimeoutMinutes: settings.gameserverIdleTimeoutMinutes,
  };
}

export async function runGameserverTick(
  jetzt = new Date(),
  transport?: AgentTransport,
): Promise<GameserverTickErgebnis> {
  const ergebnis: GameserverTickErgebnis = {
    hostsGefragt: 0,
    angestossen: 0,
    fortgeschritten: 0,
    abgelaufen: 0,
    unterbrochen: 0,
    geloescht: 0,
  };

  /*
   * **Der wichtigste Absatz dieser Datei.**
   *
   * Der Durchgang laeuft im Minutentakt auf jedem Server, auf dem SwissHub
   * laeuft - auch dort, wo nie ein Gameserver eingerichtet wird. Er muss
   * deshalb in diesem Fall **nichts** tun und **nichts** melden: kein
   * Fehler, keine Warnung, keine Abfrage, die eine nicht vorhandene
   * Infrastruktur anspricht.
   *
   * `konfigurationsStand()` wirft nie und beantwortet genau das. Ist etwas
   * offen, ist der Durchgang hier zu Ende - lautlos.
   */
  const stand = await konfigurationsStand(jetzt);
  if (!stand.bereit) {
    return ergebnis;
  }

  if (!(await isModuleEnabled(TOURNAMENTS_MODULE_ID))) {
    return ergebnis;
  }
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  const einstellungen = leseEinstellungen(settings);
  if (!einstellungen.enabled) {
    /*
     * Ausgeschaltet heisst ausgeschaltet - auch das Aufraeumen ruht. Wer den
     * Schalter umlegt, waehrend Instanzen laufen, will sie in aller Regel
     * behalten und selbst ansehen; ein Durchgang, der sie beim Ausschalten
     * als Erstes loescht, waere eine unangenehme Ueberraschung.
     */
    return ergebnis;
  }

  ergebnis.hostsGefragt = await frageHosts(jetzt, transport);
  ergebnis.angestossen = await stosseAn(einstellungen, jetzt, transport);
  ergebnis.fortgeschritten = await bringeWeiter(jetzt, transport);
  ergebnis.abgelaufen = await markiereAbgelaufene(einstellungen, jetzt);
  ergebnis.unterbrochen = await meldeAusgefalleneHosts(jetzt);

  const aufgeraeumt = await raeumeAuf(jetzt, transport).catch((fehler: unknown) => {
    log.warn('Aufraeumen warf', { fehler });
    return { geloescht: 0, uebersprungen: 0 };
  });
  ergebnis.geloescht = aufgeraeumt.geloescht;

  await pflege(settings, jetzt);

  return ergebnis;
}

// ---------------------------------------------------------------------------
// 1. Hosts abfragen
// ---------------------------------------------------------------------------

async function frageHosts(jetzt: Date, transport?: AgentTransport): Promise<number> {
  const hosts = await prisma.gameServerHost.findMany({
    where: { status: { not: 'DISABLED' }, registeredAt: { not: null } },
    select: { id: true, name: true, hostname: true, agentPort: true },
    take: 50,
  });

  let gefragt = 0;

  for (const host of hosts) {
    try {
      const token = await hostAgentToken(host.id);
      if (!token) {
        await merkeHostFehler(host.id, 'Für diesen Host liegt keine lesbare Identität vor.');
        continue;
      }
      const agent = hostZugriff({ host: host.hostname, port: host.agentPort, token }, transport);
      const meldung = await agent.hostStatus();

      await nimmHostLebenszeichen(
        host.id,
        {
          agentVersion: meldung.agentVersion ?? undefined,
          dockerAvailable: meldung.dockerAvailable,
          cpuPercent: meldung.cpuPercent ?? undefined,
          memoryUsedMb: meldung.memoryUsedMb ?? undefined,
          diskFreeMb: meldung.diskFreeMb ?? undefined,
          uptimeSeconds: meldung.uptimeSeconds ?? undefined,
          runningCount: meldung.runningCount ?? undefined,
        },
        jetzt,
      );
      await prisma.gameServerHost.update({ where: { id: host.id }, data: { lastError: null } });
      gefragt += 1;
    } catch (fehler) {
      /*
       * Kein `lastHeartbeatAt` schreiben. Ein Host, der nicht antwortet,
       * soll durch das Alter seines letzten Lebenszeichens auf OFFLINE
       * laufen - ein Zeitstempel, den ein Fehlschlag setzt, waere die
       * Behauptung, es sei alles in Ordnung.
       */
      await merkeHostFehler(
        host.id,
        fehler instanceof Error ? fehler.message : 'Der Host hat nicht geantwortet.',
      );
    }
  }

  return gefragt;
}

async function merkeHostFehler(hostId: string, meldung: string): Promise<void> {
  await prisma.gameServerHost
    .update({ where: { id: hostId }, data: { lastError: meldung.slice(0, 2000) } })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// 2. Bereitstellen
// ---------------------------------------------------------------------------

async function stosseAn(
  einstellungen: OrchestratorEinstellungen,
  jetzt: Date,
  transport?: AgentTransport,
): Promise<number> {
  const wartend = await prisma.matchServerAssignment.findMany({
    where: {
      phase: 'WAITING_FOR_SERVER',
      OR: [{ provisionAfterAt: null }, { provisionAfterAt: { lte: jetzt } }],
    },
    orderBy: { provisionAfterAt: 'asc' },
    take: einstellungen.maxParallelProvisioning,
    select: { id: true },
  });

  let angestossen = 0;
  for (const zuordnung of wartend) {
    const versuch = await provisioniere(zuordnung.id, einstellungen, jetzt, transport).catch(
      (fehler: unknown) => {
        log.warn('Bereitstellung warf', { assignmentId: zuordnung.id, fehler });
        return { ok: false as const };
      },
    );
    if (versuch.ok) {
      angestossen += 1;
    }
  }
  return angestossen;
}

// ---------------------------------------------------------------------------
// 3. Anlaufende Instanzen weiterbringen
// ---------------------------------------------------------------------------

async function bringeWeiter(jetzt: Date, transport?: AgentTransport): Promise<number> {
  const anlaufend = await prisma.gameServerInstance.findMany({
    where: { status: { in: ['CREATING', 'STARTING'] }, hostId: { not: null } },
    include: { host: { select: { id: true, hostname: true, agentPort: true } } },
    take: 20,
  });

  let fortgeschritten = 0;

  for (const instanz of anlaufend) {
    if (!instanz.host) {
      continue;
    }
    try {
      const token = await hostAgentToken(instanz.host.id);
      if (!token) {
        continue;
      }
      const agent = hostZugriff(
        { host: instanz.host.hostname, port: instanz.host.agentPort, token },
        transport,
      );
      const befund = await agent.instanzStatus(instanz.id);

      if (!befund.containerRef) {
        /*
         * Der Host kennt den Container nicht mehr. Das ist kein «noch nicht
         * fertig», sondern ein Verlust - er wurde ausserhalb von SwissHub
         * entfernt oder ist nie entstanden.
         */
        await prisma.gameServerInstance.update({
          where: { id: instanz.id },
          data: { status: 'FAILED', lastError: 'Der Host kennt diesen Container nicht mehr.' },
        });
        continue;
      }

      if (befund.laeuft && instanz.status !== 'READY') {
        await prisma.gameServerInstance.update({
          where: { id: instanz.id },
          data: { status: 'READY', startedAt: instanz.startedAt ?? jetzt, lastError: null },
        });
        await prisma.matchServerAssignment.updateMany({
          where: { instanceId: instanz.id, phase: { in: ['PROVISIONING', 'SERVER_BOOTING'] } },
          data: { phase: 'AGENT_CONNECTING' },
        });
        fortgeschritten += 1;
      }
    } catch (fehler) {
      log.warn('Zustand einer Instanz nicht abfragbar', { instanceId: instanz.id, fehler });
    }
  }

  return fortgeschritten;
}

// ---------------------------------------------------------------------------
// 4. Was zu lange braucht
// ---------------------------------------------------------------------------

async function markiereAbgelaufene(einstellungen: OrchestratorEinstellungen, jetzt: Date): Promise<number> {
  const frist = new Date(jetzt.getTime() - einstellungen.provisioningTimeoutMinutes * 60_000);

  const haengend = await prisma.gameServerInstance.updateMany({
    where: {
      status: {
        in: ['RESERVED', 'CREATING', 'STARTING', 'CONFIGURING', 'PENDING', 'PROVISIONING', 'BOOTING'],
      },
      provisionStartedAt: { not: null, lt: frist },
    },
    data: {
      status: 'FAILED',
      lastError: `Die Bereitstellung hat länger als ${String(einstellungen.provisioningTimeoutMinutes)} Minuten gedauert.`,
    },
  });

  if (haengend.count > 0) {
    // Die zugehoerigen Zuordnungen mitziehen, sonst warten sie ewig auf
    // eine Instanz, die als gescheitert markiert ist.
    await prisma.matchServerAssignment.updateMany({
      where: {
        phase: { in: ['PROVISIONING', 'SERVER_BOOTING', 'AGENT_CONNECTING'] },
        instance: { status: 'FAILED' },
      },
      data: { phase: 'PROVISION_FAILED', lastError: 'Die Bereitstellung ist abgelaufen.' },
    });
  }

  return haengend.count;
}

// ---------------------------------------------------------------------------
// 5. Ausgefallene Hosts
// ---------------------------------------------------------------------------

/**
 * Was passiert, wenn ein ganzer Host ausfaellt.
 *
 * **Es wird nichts erfunden.** Die Instanzen gehen auf `FAILED`, die
 * betroffenen Matches auf `MATCH_INTERRUPTED`, und dort bleiben sie, bis
 * ein Mensch entscheidet. Kein automatischer Umzug auf einen anderen Host:
 * ein laufendes CS2-Match laesst sich nicht verlustfrei verschieben, und
 * ein Umzug, der so tut, als ginge es, kostet den Spielstand.
 *
 * Die Turnierleitung kann im Match Room «Instanz neu erstellen» waehlen -
 * mit demselben Match, derselben Zuordnung und demselben Veto.
 */
async function meldeAusgefalleneHosts(jetzt: Date): Promise<number> {
  const grenze = new Date(jetzt.getTime() - HEARTBEAT_FRIST_SEKUNDEN * 1000);

  const ausgefallen = await prisma.gameServerHost.findMany({
    where: {
      status: { not: 'DISABLED' },
      registeredAt: { not: null },
      OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: grenze } }],
    },
    select: { id: true, name: true },
  });

  if (ausgefallen.length === 0) {
    return 0;
  }

  const hostIds = ausgefallen.map((host) => host.id);

  const betroffen = await prisma.gameServerInstance.updateMany({
    where: {
      hostId: { in: hostIds },
      status: { in: ['CREATING', 'STARTING', 'CONFIGURING', 'READY', 'LIVE'] },
    },
    data: { status: 'FAILED', lastError: 'Der Host antwortet nicht mehr.' },
  });

  if (betroffen.count === 0) {
    return 0;
  }

  await prisma.matchServerAssignment.updateMany({
    where: {
      instance: { hostId: { in: hostIds }, status: 'FAILED' },
      phase: { notIn: ['SERVER_REMOVED', 'MATCH_INTERRUPTED', 'ARCHIVING', 'ARCHIVE_ERROR'] },
    },
    data: {
      phase: 'MATCH_INTERRUPTED',
      lastError: 'Der Gameserver-Host ist ausgefallen. Das Match wartet auf eine Entscheidung.',
    },
  });

  log.warn('Hosts ausgefallen', {
    hosts: ausgefallen.map((host) => host.name),
    betroffeneInstanzen: betroffen.count,
  });

  return betroffen.count;
}

// ---------------------------------------------------------------------------
// 6. Pflege
// ---------------------------------------------------------------------------

/**
 * Was einmal in der Stunde faellig ist.
 *
 * Nicht jede Minute: ein `deleteMany` ueber eine Tabelle mit Zehntausenden
 * Zeilen ist keine Arbeit fuer den Minutentakt. Die Minute 11 statt 0,
 * damit nicht alle Wartungsarbeiten zusammenfallen.
 */
async function pflege(settings: TournamentSettings, jetzt: Date): Promise<void> {
  if (jetzt.getMinutes() !== 11) {
    return;
  }

  const grenze = new Date(jetzt.getTime() - settings.gameserverHeartbeatRetentionHours * 3_600_000);
  await prisma.serverHeartbeat.deleteMany({ where: { createdAt: { lt: grenze } } }).catch(() => undefined);

  const verwaist = await raeumeVerwaisteReservierungen(jetzt).catch(() => 0);
  if (verwaist > 0) {
    log.warn('Verwaiste Portreservierungen entfernt', { anzahl: verwaist });
  }
}
