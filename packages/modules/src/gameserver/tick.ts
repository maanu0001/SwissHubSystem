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
 * ## Die vier Schritte
 *
 *   1. faellige Bereitstellungen anstossen
 *   2. bootende Maschinen weiterbringen
 *   3. haengengebliebene Bereitstellungen als gescheitert markieren
 *   4. aufraeumen, was fertig ist
 *
 * Jeder Schritt ist fuer sich wiederholbar und faengt seine Fehler selbst
 * ab. Ein Anbieter, der nicht antwortet, darf die anderen drei Schritte
 * nicht anhalten - und den Bot schon gar nicht.
 */
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from '../tournaments/config';
import { brauchteTreiber } from './anbieter';
import { konfigurationsStand } from './bereitschaft';
import { ladeZugang, provisioniere, raeumeAuf, type OrchestratorEinstellungen } from './orchestrator';

const log = createLogger('gameserver:tick');

export interface GameserverTickErgebnis {
  angestossen: number;
  fortgeschritten: number;
  abgelaufen: number;
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

export async function runGameserverTick(jetzt = new Date()): Promise<GameserverTickErgebnis> {
  const ergebnis: GameserverTickErgebnis = {
    angestossen: 0,
    fortgeschritten: 0,
    abgelaufen: 0,
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
  const stand = await konfigurationsStand();
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
     * Schalter umlegt, waehrend Maschinen laufen, will sie in aller Regel
     * behalten und selbst ansehen; ein Durchgang, der sie beim Ausschalten
     * als Erstes loescht, waere eine unangenehme Ueberraschung.
     */
    return ergebnis;
  }

  // --- 1. Was bereitgestellt werden soll ----------------------------------
  const wartend = await prisma.matchServerAssignment.findMany({
    where: {
      phase: 'WAITING_FOR_SERVER',
      OR: [{ provisionAfterAt: null }, { provisionAfterAt: { lte: jetzt } }],
    },
    orderBy: { provisionAfterAt: 'asc' },
    take: einstellungen.maxParallelProvisioning,
    select: { id: true },
  });

  for (const zuordnung of wartend) {
    const versuch = await provisioniere(zuordnung.id, einstellungen, jetzt).catch((fehler: unknown) => {
      log.warn('Bereitstellung warf', { assignmentId: zuordnung.id, fehler });
      return { ok: false as const };
    });
    if (versuch.ok) {
      ergebnis.angestossen += 1;
    }
  }

  // --- 2. Bootende Maschinen weiterbringen --------------------------------
  const bootend = await prisma.gameServerInstance.findMany({
    where: { status: { in: ['PROVISIONING', 'BOOTING'] }, providerRef: { not: null } },
    include: { provider: true },
    take: 20,
  });

  for (const instanz of bootend) {
    try {
      const treiber = brauchteTreiber(instanz.provider.driver);
      const maschine = await treiber.getServer(await ladeZugang(), instanz.providerRef as string);

      if (!maschine) {
        /*
         * Der Anbieter kennt die Maschine nicht mehr. Das ist kein
         * «noch nicht fertig», sondern ein Verlust - sie wurde ausserhalb
         * von SwissHub geloescht oder ist nie entstanden.
         */
        await prisma.gameServerInstance.update({
          where: { id: instanz.id },
          data: { status: 'FAILED', lastError: 'Der Anbieter kennt diese Maschine nicht mehr.' },
        });
        continue;
      }

      if (maschine.status === 'ERROR') {
        await prisma.gameServerInstance.update({
          where: { id: instanz.id },
          data: { status: 'FAILED', lastError: maschine.fehler ?? 'Der Anbieter meldet einen Fehler.' },
        });
        continue;
      }

      if (maschine.status === 'RUNNING' && instanz.status === 'PROVISIONING') {
        await prisma.gameServerInstance.update({
          where: { id: instanz.id },
          data: {
            status: 'BOOTING',
            publicHost: maschine.netzwerk.host ?? instanz.publicHost,
            provisionEndedAt: jetzt,
          },
        });
        ergebnis.fortgeschritten += 1;
      }
    } catch (fehler) {
      log.warn('Zustand konnte nicht abgefragt werden', { instanceId: instanz.id, fehler });
    }
  }

  // --- 3. Was zu lange braucht --------------------------------------------
  const frist = new Date(jetzt.getTime() - einstellungen.provisioningTimeoutMinutes * 60_000);
  const haengend = await prisma.gameServerInstance.updateMany({
    where: {
      status: { in: ['PENDING', 'PROVISIONING', 'BOOTING'] },
      provisionStartedAt: { not: null, lt: frist },
    },
    data: {
      status: 'FAILED',
      lastError: `Die Bereitstellung hat länger als ${einstellungen.provisioningTimeoutMinutes} Minuten gedauert.`,
    },
  });
  ergebnis.abgelaufen = haengend.count;

  if (haengend.count > 0) {
    // Die zugehoerigen Zuordnungen mitziehen, sonst warten sie ewig auf
    // eine Maschine, die als gescheitert markiert ist.
    await prisma.matchServerAssignment.updateMany({
      where: {
        phase: { in: ['PROVISIONING', 'SERVER_BOOTING', 'AGENT_CONNECTING'] },
        instance: { status: 'FAILED' },
      },
      data: { phase: 'PROVISION_FAILED', lastError: 'Die Bereitstellung ist abgelaufen.' },
    });
  }

  // --- 4. Aufraeumen ------------------------------------------------------
  const aufgeraeumt = await raeumeAuf(jetzt).catch((fehler: unknown) => {
    log.warn('Aufraeumen warf', { fehler });
    return { geloescht: 0, uebersprungen: 0 };
  });
  ergebnis.geloescht = aufgeraeumt.geloescht;

  // --- Heartbeats ausduennen ----------------------------------------------
  /*
   * Einmal in der Stunde, nicht jede Minute: ein `deleteMany` ueber eine
   * Tabelle mit Zehntausenden Zeilen ist keine Arbeit fuer den Minutentakt.
   * Die Minute 11 statt 0, damit nicht alle Wartungsarbeiten zusammenfallen.
   */
  if (jetzt.getMinutes() === 11) {
    const grenze = new Date(jetzt.getTime() - settings.gameserverHeartbeatRetentionHours * 3600_000);
    await prisma.serverHeartbeat
      .deleteMany({ where: { createdAt: { lt: grenze } } })
      .catch((fehler: unknown) => {
        log.warn('Heartbeats konnten nicht ausgeduennt werden', { fehler });
        return { count: 0 };
      });
  }

  return ergebnis;
}
