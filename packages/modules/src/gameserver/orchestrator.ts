/**
 * Der Orchestrator.
 *
 * ## Was er ist
 *
 * Die Schicht zwischen einem Match und einer Maschine. Er weiss, dass ein
 * Match einen Server braucht, sorgt dafuer, dass genau einer entsteht,
 * fuehrt ihn durch seinen Lebenslauf und raeumt ihn wieder weg.
 *
 * ## Was er nicht ist
 *
 * Er ist kein zweites Turniersystem. Wer gegen wen spielt, wie viele Maps,
 * wer gewonnen hat und wer weiterkommt - das steht im Turniermodul, und der
 * Orchestrator liest es dort und schreibt es dorthin zurueck. Er hat keine
 * eigene Bracket-Logik, keine eigenen Teams und keine eigene Resultattabelle.
 *
 * Er kennt auch kein Spiel. Im ganzen Orchestrator steht kein `CS2` - was
 * auf der Maschine passiert, macht der Game Adapter. Ein Test haelt das fest.
 *
 * ## Der Riegel gegen doppeltes Provisionieren
 *
 * Dieselbe Bauart wie ueberall in diesem Repository: die Zeile ist der
 * Riegel. `MatchServerAssignment` traegt `@@unique([matchId, generation])`
 * und wird **zuerst** geschrieben - vor der Grenzwertpruefung, vor dem
 * Anbieter. Wer sie nicht anlegen kann, hat verloren und tut nichts. Zwei
 * gleichzeitige Durchgaenge, zwei Bot-Instanzen, ein Retry nach einem
 * Neustart: keiner kommt an der Datenbank vorbei.
 */
import {
  AUDIT_ACTIONS,
  prisma,
  safeRecordAudit,
  type GameServerGame,
  type MatchServerPhase,
  type Prisma,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { GAMESERVER_INTEGRATION_ID, encryptSecret, decryptSecret, getSecret } from '@swisshub/secrets';
import { TOURNAMENTS_MODULE_ID } from '../tournaments/config';
import { anbieterTreiber, brauchteTreiber, type Zugangsdaten } from './anbieter';
import { gameAdapter } from './adapter';
import { agentZugriff, type AgentTransport } from './agent-client';
import { erzeugeAgentToken, erzeugeRconPasswort, erzeugeServerPasswort } from './agent-protokoll';
import { darfProvisionieren, type Grenzwerte } from './grenzwerte';
import { baueStartskript } from './startskript';

const log = createLogger('gameserver:orchestrator');

/** Die Adresse, unter der Geheimnisse dieses Moduls liegen. */
const geheimnisAdresse = (schluessel: string) =>
  ({ scope: 'GLOBAL', guildId: '', provider: GAMESERVER_INTEGRATION_ID, key: schluessel }) as const;

/**
 * Die Zugangsdaten des Datacenters.
 *
 * Aus dem verschluesselten Speicher, nicht aus der Umgebung und nicht aus
 * einer Spalte. Sie verlassen diese Funktion nur als Argument an den Treiber.
 */
export async function ladeZugang(): Promise<Zugangsdaten> {
  const [endpoint, identity, secret, project] = await Promise.all([
    getSecret(GAMESERVER_INTEGRATION_ID, 'endpoint'),
    getSecret(GAMESERVER_INTEGRATION_ID, 'identity'),
    getSecret(GAMESERVER_INTEGRATION_ID, 'secret'),
    getSecret(GAMESERVER_INTEGRATION_ID, 'project'),
  ]);
  return Object.freeze({
    endpoint: endpoint ?? '',
    identity: identity ?? '',
    secret: secret ?? '',
    project: project ?? '',
  });
}

export interface OrchestratorEinstellungen extends Grenzwerte {
  enabled: boolean;
  provisionLeadMinutes: number;
  provisioningTimeoutMinutes: number;
  idleTimeoutMinutes: number;
}

// ---------------------------------------------------------------------------
// Bereitstellung
// ---------------------------------------------------------------------------

export interface BereitstellErgebnis {
  assignmentId: string;
  /** Hat **dieser** Aufruf die Zuordnung angelegt? */
  neu: boolean;
  phase: MatchServerPhase;
  /** Warum nichts passiert ist - im Klartext, falls nichts passiert ist. */
  grund?: string;
}

/**
 * Dafuer sorgen, dass dieses Match eine Serverzuordnung hat.
 *
 * Legt nur die Zuordnung an; die Maschine entsteht im naechsten Schritt.
 * Diese Trennung ist Absicht: das Anlegen ist billig und muss idempotent
 * sein, das Provisionieren ist teuer und darf scheitern.
 */
export async function sorgeFuerZuordnung(
  matchId: string,
  profileId: string | null,
  provisionAfterAt: Date | null,
): Promise<BereitstellErgebnis> {
  const vorhanden = await prisma.matchServerAssignment.findFirst({
    where: { matchId },
    orderBy: { generation: 'desc' },
  });

  if (vorhanden && vorhanden.phase !== 'SERVER_REMOVED') {
    return { assignmentId: vorhanden.id, neu: false, phase: vorhanden.phase };
  }

  const generation = (vorhanden?.generation ?? 0) + 1;

  try {
    const zuordnung = await prisma.matchServerAssignment.create({
      data: { matchId, generation, profileId, provisionAfterAt },
    });
    return { assignmentId: zuordnung.id, neu: true, phase: zuordnung.phase };
  } catch (fehler) {
    if (!istEindeutigkeitsfehler(fehler)) {
      throw fehler;
    }
    /*
     * Ein anderer Durchgang war schneller. Kein Fehler - der Normalfall bei
     * zwei Workern. Seine Zuordnung ist genauso gut wie unsere gewesen waere.
     */
    const gewinner = await prisma.matchServerAssignment.findUniqueOrThrow({
      where: { matchId_generation: { matchId, generation } },
    });
    return { assignmentId: gewinner.id, neu: false, phase: gewinner.phase };
  }
}

/**
 * Die Maschine tatsaechlich anfordern.
 *
 * Gibt `false` zurueck, wenn nichts zu tun war oder eine Grenze im Weg
 * stand - beides ist kein Fehler, und beides steht danach als Grund in der
 * Zuordnung.
 */
export async function provisioniere(
  assignmentId: string,
  einstellungen: OrchestratorEinstellungen,
  jetzt = new Date(),
): Promise<{ ok: boolean; grund?: string }> {
  const zuordnung = await prisma.matchServerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      profile: { include: { template: { include: { provider: true } } } },
      match: { select: { id: true, matchNumber: true, tournamentId: true, bestOf: true } },
    },
  });

  if (!zuordnung || zuordnung.phase !== 'WAITING_FOR_SERVER') {
    return { ok: false, grund: 'Für diese Zuordnung ist keine Bereitstellung offen.' };
  }
  if (zuordnung.provisionAfterAt && zuordnung.provisionAfterAt > jetzt) {
    return { ok: false, grund: 'Noch zu früh.' };
  }

  const profil = zuordnung.profile;
  const template = profil?.template;
  const anbieter = template?.provider;

  if (!profil || !template || !anbieter) {
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      'Es fehlt ein Game Profile, ein Template oder ein Anbieter.',
    );
  }
  if (!anbieter.enabled) {
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      `Der Anbieter «${anbieter.name}» ist ausgeschaltet.`,
    );
  }

  const grenze = await darfProvisionieren(profil.game, zuordnung.match.tournamentId, einstellungen);
  if (!grenze.erlaubt) {
    /*
     * **Kein** Fehlerzustand. Die Grenze ist eine Entscheidung, keine
     * Stoerung - die Zuordnung bleibt wartend, und der naechste Durchgang
     * versucht es wieder. Waere das ein Fehler, muesste jemand ihn von Hand
     * zuruecksetzen, nur weil gerade viel los war.
     */
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { lastError: grenze.grund },
    });
    return { ok: false, grund: grenze.grund };
  }

  /*
   * Fehlt der Treiber, bricht das hier ab - lesbar und ohne Ausnahme.
   *
   * `brauchteTreiber` wirft; das faengt der Durchgang zwar ab, aber die
   * Zuordnung bliebe ohne Begruendung wartend. Besser: die Frage hier
   * stellen und die Antwort in die Zeile schreiben, damit sie in der
   * Oberflaeche steht.
   */
  const treiber = anbieterTreiber(anbieter.driver);
  if (!treiber) {
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      `Für den Anbieter «${anbieter.name}» gibt es keinen Treiber («${anbieter.driver}»). Ohne Treiber lassen sich keine Server erstellen.`,
    );
  }

  const zugang = await ladeZugang();

  const agentToken = erzeugeAgentToken();
  const rconPasswort = erzeugeRconPasswort();
  const serverPasswort =
    profil.passwordStrategy === 'NONE'
      ? ''
      : profil.passwordStrategy === 'FIXED'
        ? (profil.fixedPassword ?? '')
        : erzeugeServerPasswort();

  const name = maschinenname(zuordnung.match.tournamentId, zuordnung.match.matchNumber, zuordnung.generation);

  const adapter = gameAdapter(profil.game);
  if (!adapter) {
    return merkeFehler(assignmentId, 'PROVISION_FAILED', `Für ${profil.game} gibt es keinen Adapter.`);
  }
  const ports = adapter.benoetigtePorts({ gotvEnabled: profil.gotvEnabled });

  /*
   * Die Geheimnisse verschluesseln - bevor irgendetwas geschrieben wird.
   *
   * `encryptSecret` verlangt `MASTER_ENCRYPTION_KEY`. Fehlt er, waere das
   * eine Ausnahme mitten im Anlegen; der Durchgang faengt sie zwar, aber die
   * Zuordnung bliebe ohne Begruendung stehen. Hier gefragt, steht die
   * Antwort in der Zeile und damit in der Oberflaeche.
   */
  let rconVerschluesselt: string;
  let tokenVerschluesselt: string;
  try {
    rconVerschluesselt = encryptSecret(rconPasswort, geheimnisAdresse(`rcon:${name}`));
    tokenVerschluesselt = encryptSecret(agentToken, geheimnisAdresse(`agent:${name}`));
  } catch {
    /*
     * Die Ausnahme selbst wird nicht weitergereicht: sie nennt den
     * Schluessel und seine Laenge. Was hier steht, reicht zum Beheben.
     */
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      'Die Zugangsdaten des Servers liessen sich nicht verschlüsseln - vermutlich fehlt MASTER_ENCRYPTION_KEY.',
    );
  }

  // Die Zeile zuerst: auch ein gescheiterter Versuch soll nachher dastehen.
  const instanz = await prisma.gameServerInstance.create({
    data: {
      providerId: anbieter.id,
      templateId: template.id,
      profileId: profil.id,
      game: profil.game,
      name,
      status: 'PROVISIONING',
      region: profil.region ?? template.region ?? anbieter.region,
      gamePort: ports.game,
      tvPort: ports.tv,
      agentPort: template.agentPort,
      rconPasswordEnc: rconVerschluesselt,
      agentTokenEnc: tokenVerschluesselt,
      serverPassword: serverPasswort || null,
      tournamentId: zuordnung.match.tournamentId,
      provisionStartedAt: jetzt,
    },
  });

  const versuch = await prisma.provisioningAttempt.create({
    data: {
      instanceId: instanz.id,
      matchId: zuordnung.matchId,
      generation: zuordnung.generation,
      attempt: zuordnung.generation,
    },
  });

  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { phase: 'PROVISIONING', instanceId: instanz.id, lastError: null },
  });

  try {
    const maschine = await treiber.createServer(zugang, {
      name,
      imageRef: template.imageRef,
      region: instanz.region ?? null,
      cpuCores: template.cpuCores,
      memoryMb: template.memoryMb,
      diskGb: template.diskGb,
      startskript: baueStartskript({
        agentToken,
        agentPort: template.agentPort,
        rconPasswort,
        game: profil.game,
        gamePort: ports.game,
        tvPort: ports.tv,
      }),
      offenePorts: [ports.game, ...(ports.tv ? [ports.tv] : []), template.agentPort],
      optionen: (template.driverOptions as Record<string, unknown>) ?? {},
    });

    await prisma.$transaction([
      prisma.gameServerInstance.update({
        where: { id: instanz.id },
        data: {
          providerRef: maschine.ref,
          publicHost: maschine.netzwerk.host,
          status: maschine.status === 'RUNNING' ? 'BOOTING' : 'PROVISIONING',
        },
      }),
      prisma.provisioningAttempt.update({
        where: { id: versuch.id },
        data: { succeeded: true, endedAt: new Date(), durationMs: Date.now() - jetzt.getTime() },
      }),
      prisma.matchServerAssignment.update({
        where: { id: assignmentId },
        data: { phase: 'SERVER_BOOTING' },
      }),
    ]);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.GAMESERVER_PROVISIONED,
      module: TOURNAMENTS_MODULE_ID,
      actorDiscordId: null,
      actorUsername: null,
      targetLabel: name,
      success: true,
      metadata: {
        matchId: zuordnung.matchId,
        instanceId: instanz.id,
        anbieter: anbieter.name,
        game: profil.game,
      },
    });

    return { ok: true };
  } catch (fehler) {
    const meldung = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
    log.warn('Bereitstellung fehlgeschlagen', { assignmentId, instanzId: instanz.id, fehler });

    await prisma.$transaction([
      prisma.gameServerInstance.update({
        where: { id: instanz.id },
        data: { status: 'FAILED', lastError: meldung.slice(0, 2000) },
      }),
      prisma.provisioningAttempt.update({
        where: { id: versuch.id },
        data: {
          succeeded: false,
          endedAt: new Date(),
          durationMs: Date.now() - jetzt.getTime(),
          error: meldung.slice(0, 2000),
        },
      }),
    ]);

    return merkeFehler(assignmentId, 'PROVISION_FAILED', meldung);
  }
}

/**
 * Der Name, unter dem die Maschine beim Anbieter steht.
 *
 * Aus Turnier, Match und Anlauf - damit jemand, der in der Oberflaeche des
 * Datacenters steht, ohne SwissHub weiss, wozu die Maschine gehoert. Nur
 * Kleinbuchstaben, Ziffern und Bindestriche: manche Anbieter verlangen das,
 * und ein Name, der beim Anlegen abgewiesen wird, kostet einen ganzen
 * Durchgang.
 */
export function maschinenname(tournamentId: string, matchNumber: number, generation: number): string {
  const kurz = tournamentId
    .slice(-8)
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
  return `sh-${kurz}-m${matchNumber}-g${generation}`;
}

async function merkeFehler(
  assignmentId: string,
  phase: MatchServerPhase,
  meldung: string,
): Promise<{ ok: false; grund: string }> {
  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { phase, lastError: meldung.slice(0, 2000) },
  });
  return { ok: false, grund: meldung };
}

function istEindeutigkeitsfehler(fehler: unknown): boolean {
  return (
    typeof fehler === 'object' &&
    fehler !== null &&
    'code' in fehler &&
    (fehler as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}

// ---------------------------------------------------------------------------
// Zugriff auf eine Maschine
// ---------------------------------------------------------------------------

/**
 * Den Agent-Zugriff fuer eine Maschine bauen.
 *
 * Entschluesselt das Token genau hier und gibt es nicht zurueck - der
 * Aufrufer bekommt einen Zugriff, kein Geheimnis.
 */
export async function zugriffAuf(instanceId: string, transport?: AgentTransport) {
  const instanz = await prisma.gameServerInstance.findUnique({ where: { id: instanceId } });
  if (!instanz?.publicHost || !instanz.agentPort || !instanz.agentTokenEnc) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Dieser Server ist noch nicht erreichbar.',
      internalMessage: `Instanz ${instanceId} ohne Adresse oder Token`,
    });
  }
  const token = decryptSecret(instanz.agentTokenEnc, geheimnisAdresse(`agent:${instanz.name}`));
  return agentZugriff({ host: instanz.publicHost, port: instanz.agentPort, token }, transport);
}

/**
 * Das RCON-Passwort einer Maschine.
 *
 * Bewusst eine eigene Funktion mit diesem Namen: wer sie aufruft, tut es
 * absichtlich. Sie wird **nirgends** in einer Antwort an den Browser
 * verwendet - ein Test durchsucht die Server-Actions und die Seiten danach.
 */
export async function rconPasswort(instanceId: string): Promise<string | null> {
  const instanz = await prisma.gameServerInstance.findUnique({
    where: { id: instanceId },
    select: { name: true, rconPasswordEnc: true },
  });
  if (!instanz?.rconPasswordEnc) {
    return null;
  }
  return decryptSecret(instanz.rconPasswordEnc, geheimnisAdresse(`rcon:${instanz.name}`));
}

// ---------------------------------------------------------------------------
// Aufraeumen
// ---------------------------------------------------------------------------

export interface AufraeumErgebnis {
  geloescht: number;
  uebersprungen: number;
}

/**
 * Maschinen loeschen, deren Zeit um ist.
 *
 * **Die Reihenfolge ist die Zusage.** Geloescht wird erst, wenn die
 * Archivierung bestaetigt ist - eine Demo, die es nicht mehr gibt, weil die
 * Maschine schneller weg war, laesst sich nicht nachreichen. Eine
 * Zuordnung in `ARCHIVE_ERROR` wird deshalb uebersprungen und nicht
 * geloescht, bis jemand hinsieht.
 */
export async function raeumeAuf(jetzt = new Date()): Promise<AufraeumErgebnis> {
  const faellig = await prisma.gameServerInstance.findMany({
    where: {
      status: { in: ['RUNNING', 'AGENT_READY', 'BOOTING', 'FAILED', 'STOPPING'] },
      deleteAfterAt: { not: null, lte: jetzt },
      heldByDiscordId: null,
    },
    include: { provider: true, assignments: { orderBy: { generation: 'desc' }, take: 1 } },
    take: 20,
  });

  let geloescht = 0;
  let uebersprungen = 0;

  for (const instanz of faellig) {
    const zuordnung = instanz.assignments[0];
    if (zuordnung && zuordnung.phase === 'ARCHIVE_ERROR') {
      /*
       * Die Archivierung ist schiefgegangen. Die Maschine bleibt stehen -
       * lieber eine Maschine zu viel als eine Demo zu wenig. Das Dashboard
       * zeigt sie als «wartet auf Entscheidung».
       */
      uebersprungen += 1;
      continue;
    }

    try {
      if (instanz.providerRef) {
        const treiber = brauchteTreiber(instanz.provider.driver);
        await treiber.deleteServer(await ladeZugang(), instanz.providerRef);
      }
      await prisma.gameServerInstance.update({
        where: { id: instanz.id },
        data: {
          status: 'REMOVED',
          removedAt: jetzt,
          // Die Geheimnisse gehen mit der Maschine. Ein RCON-Passwort fuer
          // eine Maschine, die es nicht mehr gibt, ist kein Geheimnis
          // mehr - es ist nur noch ein Risiko.
          rconPasswordEnc: null,
          agentTokenEnc: null,
        },
      });
      if (zuordnung) {
        await prisma.matchServerAssignment.update({
          where: { id: zuordnung.id },
          data: { phase: 'SERVER_REMOVED' },
        });
      }
      await safeRecordAudit({
        action: AUDIT_ACTIONS.GAMESERVER_DELETED,
        module: TOURNAMENTS_MODULE_ID,
        actorDiscordId: null,
        actorUsername: null,
        targetLabel: instanz.name,
        success: true,
        metadata: { instanceId: instanz.id, automatisch: true },
      });
      geloescht += 1;
    } catch (fehler) {
      log.warn('Maschine konnte nicht geloescht werden', { instanceId: instanz.id, fehler });
      await prisma.gameServerInstance.update({
        where: { id: instanz.id },
        data: {
          lastError: (fehler instanceof Error ? fehler.message : 'Unbekannter Fehler').slice(0, 2000),
        },
      });
      uebersprungen += 1;
    }
  }

  return { geloescht, uebersprungen };
}

/** Wie viele Server gerade laufen - fuer das Dashboard. */
export async function infrastrukturStand(): Promise<{
  laufend: number;
  inBereitstellung: number;
  fehlerhaft: number;
  wartetAufEntscheidung: number;
  durchschnittProvisioningSekunden: number | null;
}> {
  const [laufend, inBereitstellung, fehlerhaft, wartetAufEntscheidung, dauern] = await Promise.all([
    prisma.gameServerInstance.count({ where: { status: { in: ['RUNNING', 'AGENT_READY'] } } }),
    prisma.gameServerInstance.count({ where: { status: { in: ['PENDING', 'PROVISIONING', 'BOOTING'] } } }),
    prisma.gameServerInstance.count({ where: { status: 'FAILED' } }),
    prisma.matchServerAssignment.count({
      where: { phase: { in: ['ARCHIVE_ERROR', 'RESULT_ERROR', 'MATCH_INTERRUPTED'] } },
    }),
    prisma.provisioningAttempt.aggregate({
      where: { succeeded: true, durationMs: { not: null } },
      _avg: { durationMs: true },
    }),
  ]);

  const schnitt = dauern._avg.durationMs;
  return {
    laufend,
    inBereitstellung,
    fehlerhaft,
    wartetAufEntscheidung,
    // Nur, wenn es tatsaechlich Messwerte gibt. Eine 0 sähe aus wie «sofort».
    durchschnittProvisioningSekunden: schnitt === null ? null : Math.round(schnitt / 1000),
  };
}

export type { GameServerGame };

// ---------------------------------------------------------------------------
// Ansichten fuer die Oberflaeche
// ---------------------------------------------------------------------------

/**
 * Was die Oberflaeche ueber einen Server erfaehrt.
 *
 * **Kein Geheimnis in dieser Form.** Kein RCON-Passwort, kein Agent-Token,
 * keine Zugangsdaten des Anbieters. Das ist nicht Nachlaessigkeit, die
 * spaeter behoben wird, sondern die Zusage: wenn dieser Typ die Grenze zum
 * Browser ist, kann kein Geheimnis versehentlich mitreisen, weil keines
 * darin vorkommt. Ein Test durchsucht die Server-Actions danach.
 */
export interface ServerAnsicht {
  id: string;
  name: string;
  providerName: string;
  /** Die Kennung beim Anbieter - hilfreich, um in dessen Oberflaeche zu suchen. */
  providerRef: string | null;
  game: string;
  status: string;
  region: string | null;
  publicHost: string | null;
  gamePort: number | null;
  currentMap: string | null;
  playerCount: number | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  diskFreeMb: number | null;
  lastHeartbeatAt: Date | null;
  provisionStartedAt: Date | null;
  /** Wie lange sie schon laeuft, in Minuten. */
  laufzeitMinuten: number | null;
  deleteAfterAt: Date | null;
  heldByDiscordId: string | null;
  heldReason: string | null;
  lastError: string | null;
  /** Das Match, dem sie gerade gehoert. */
  matchNumber: number | null;
  tournamentName: string | null;
}

export async function listeServer(jetzt = new Date()): Promise<ServerAnsicht[]> {
  const instanzen = await prisma.gameServerInstance.findMany({
    where: { status: { not: 'REMOVED' } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      provider: { select: { name: true } },
      assignments: {
        orderBy: { generation: 'desc' },
        take: 1,
        include: {
          match: {
            select: { matchNumber: true, tournament: { select: { name: true } } },
          },
        },
      },
    },
  });

  return instanzen.map((instanz) => {
    const zuordnung = instanz.assignments[0];
    const start = instanz.provisionEndedAt ?? instanz.provisionStartedAt;
    return {
      id: instanz.id,
      name: instanz.name,
      providerName: instanz.provider.name,
      providerRef: instanz.providerRef,
      game: instanz.game,
      status: instanz.status,
      region: instanz.region,
      publicHost: instanz.publicHost,
      gamePort: instanz.gamePort,
      currentMap: instanz.currentMap,
      playerCount: instanz.playerCount,
      cpuPercent: instanz.cpuPercent,
      memoryMb: instanz.memoryMb,
      diskFreeMb: instanz.diskFreeMb,
      lastHeartbeatAt: instanz.lastHeartbeatAt,
      provisionStartedAt: instanz.provisionStartedAt,
      laufzeitMinuten: start ? Math.round((jetzt.getTime() - start.getTime()) / 60_000) : null,
      deleteAfterAt: instanz.deleteAfterAt,
      heldByDiscordId: instanz.heldByDiscordId,
      heldReason: instanz.heldReason,
      lastError: instanz.lastError,
      matchNumber: zuordnung?.match.matchNumber ?? null,
      tournamentName: zuordnung?.match.tournament.name ?? null,
    };
  });
}

/**
 * Eine Maschine vom Aufraeumen ausnehmen - oder wieder freigeben.
 *
 * Die Berechtigung prueft der Aufrufer; hier steht die Wirkung und der
 * Protokolleintrag.
 */
export async function haltServer(
  instanceId: string,
  akteur: { discordId: string; username: string },
  grund: string | null,
): Promise<void> {
  const instanz = await prisma.gameServerInstance.update({
    where: { id: instanceId },
    data: { heldByDiscordId: akteur.discordId, heldReason: grund?.slice(0, 300) ?? null },
  });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HELD,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: instanz.name,
    success: true,
    metadata: { instanceId, grund },
  });
}

export async function gibServerFrei(
  instanceId: string,
  akteur: { discordId: string; username: string },
): Promise<void> {
  const instanz = await prisma.gameServerInstance.update({
    where: { id: instanceId },
    data: { heldByDiscordId: null, heldReason: null },
  });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_RELEASED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: instanz.name,
    success: true,
    metadata: { instanceId },
  });
}

/**
 * Eine Maschine sofort loeschen.
 *
 * Auch vor der Schonfrist und auch, wenn die Archivierung noch offen ist -
 * das ist der Unterschied zum Durchgang. Wer diesen Knopf drueckt, hat
 * entschieden; die Oberflaeche fragt vorher nach, und das Protokoll haelt
 * fest, wer.
 */
export async function loescheServerSofort(
  instanceId: string,
  akteur: { discordId: string; username: string },
): Promise<void> {
  const instanz = await prisma.gameServerInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { provider: true },
  });

  if (instanz.providerRef) {
    const treiber = brauchteTreiber(instanz.provider.driver);
    await treiber.deleteServer(await ladeZugang(), instanz.providerRef);
  }

  await prisma.gameServerInstance.update({
    where: { id: instanceId },
    data: {
      status: 'REMOVED',
      removedAt: new Date(),
      rconPasswordEnc: null,
      agentTokenEnc: null,
      heldByDiscordId: null,
      heldReason: null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_DELETED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: instanz.name,
    success: true,
    metadata: { instanceId, automatisch: false },
  });
}

/**
 * Die Verbindung zu einem Anbieter pruefen.
 *
 * Liegt hier und nicht in der Server Action, obwohl beides serverseitig
 * laeuft. Der Grund ist die Reichweite eines Fehlers: eine Action, die
 * `ladeZugang()` kennt, ist eine Zeile `return { zugang }` von einem
 * Geheimnis im Browser entfernt. Eine, die nur `{ ok, meldung }` bekommt,
 * ist es nicht - und ein Test haelt fest, dass an der Grenze zum Browser
 * weder `ladeZugang` noch `getSecret` vorkommt.
 *
 * Das Ergebnis wird am Anbieter vermerkt, damit das Dashboard sagen kann,
 * wann zuletzt geprueft wurde - und «nie geprueft», wenn nie.
 */
export async function pruefeAnbieter(providerId: string): Promise<{ ok: boolean; meldung: string }> {
  const anbieter = await prisma.gameServerProvider.findUniqueOrThrow({ where: { id: providerId } });

  const ergebnis = await (async () => {
    try {
      const treiber = brauchteTreiber(anbieter.driver);
      return await treiber.pruefe(await ladeZugang());
    } catch (fehler) {
      /*
       * Die Meldung des Treibers wird gekuerzt weitergegeben, aber nicht
       * erfunden: was schiefging, soll dastehen. Ein Stacktrace nicht - er
       * gehoert ins Protokoll.
       */
      log.warn('Anbieterpruefung fehlgeschlagen', { providerId, fehler });
      return {
        ok: false,
        meldung: fehler instanceof Error ? fehler.message : 'Unbekannter Fehler',
      };
    }
  })();

  await prisma.gameServerProvider.update({
    where: { id: providerId },
    data: {
      lastCheckAt: new Date(),
      lastCheckOk: ergebnis.ok,
      lastCheckMessage: ergebnis.meldung.slice(0, 500),
    },
  });

  return { ok: ergebnis.ok, meldung: ergebnis.meldung.slice(0, 500) };
}
