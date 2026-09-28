/**
 * Gameserver-Hosts: anlegen, registrieren, beurteilen, verwalten.
 *
 * ## Was ein Host ist
 *
 * Eine lang laufende Linux-Maschine mit Docker und dem SwissHub Game Agent.
 * Sie wird **einmal** eingerichtet - danach laeuft der gesamte normale
 * Betrieb ueber die WebApp. Was pro Match entsteht, ist ein Container auf
 * ihr, keine neue Maschine.
 *
 * ## Die Registrierung
 *
 * Der heikelste Vorgang in dieser Datei, deshalb gleich vorweg, wie er
 * gebaut ist:
 *
 *   1. Ein Admin legt den Host im Dashboard an und oeffnet die
 *      Registrierung. SwissHub erzeugt ein Token, zeigt es **einmal** und
 *      speichert nur dessen SHA-256.
 *   2. Der Agent meldet sich mit diesem Token. SwissHub prueft den Hash,
 *      erzeugt eine dauerhafte Identitaet, verschluesselt sie und gibt sie
 *      **einmal** zurueck.
 *   3. Das Registrierungs-Token ist danach ungueltig - egal ob die Meldung
 *      geklappt hat oder nicht.
 *
 * Drei Eigenschaften, die keine Bequemlichkeit sind:
 *
 * **Einmalig.** Ein Token, das zweimal geht, oeffnet einem Zweiten
 * dieselbe Tuer. Die Entwertung passiert in einer bedingten Schreiboperation
 * - wer sie gewinnt, registriert; wer sie verliert, bekommt eine Absage.
 *
 * **Kurzlebig.** Ein Token, das ein halbes Jahr in einem Chatverlauf liegt,
 * ist irgendwann kein Geheimnis mehr.
 *
 * **Nur als Hash gespeichert.** Wer die Datenbank liest, soll sich damit
 * nicht als Host ausgeben koennen.
 *
 * Es gibt ausdruecklich **kein** gemeinsames Agent-Token fuer alle Hosts.
 * Ein Token oeffnet genau einen Host.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  AUDIT_ACTIONS,
  prisma,
  safeRecordAudit,
  type GameServerGame,
  type GameServerHost,
  type GameServerHostStatus,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { encryptSecret, decryptSecret } from '@swisshub/secrets';
import { AppError } from '@swisshub/shared';
import type { AgentTransport } from './agent-client';
import { TOURNAMENTS_MODULE_ID } from '../tournaments/config';
import { hostTokenAdresse } from './geheimnis';
import { bereichsGroesse } from './ports';

const log = createLogger('gameserver:hosts');

/**
 * Wie lange ein Lebenszeichen zaehlt.
 *
 * Der Durchgang fragt jede Minute; drei verpasste Abfragen sind ein
 * Ausfall. Eine verpasste ist ein Paketverlust oder ein Durchgang, der
 * gerade laenger gebraucht hat - und ein Host, der bei jedem Paketverlust
 * aus dem Scheduler faellt, macht mehr Aerger als er verhindert.
 */
export const HEARTBEAT_FRIST_SEKUNDEN = 210;

/** Wie lange ein Registrierungs-Token standardmaessig gilt. */
export const REGISTRIERUNG_GUELTIG_MINUTEN = 60;

// ---------------------------------------------------------------------------
// Registrierung
// ---------------------------------------------------------------------------

/** Ein Registrierungs-Token. 32 Bytes - niemand tippt das ab. */
export function erzeugeRegistrierungsToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Der Hash, der in der Datenbank steht. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface RegistrierungsAngebot {
  /** Das Token im Klartext. **Einmal** - es wird nirgends gespeichert. */
  token: string;
  ablauf: Date;
}

/**
 * Die Registrierung fuer einen Host oeffnen.
 *
 * Ueberschreibt ein eventuell noch offenes Token. Das ist Absicht: wer
 * erneut auf den Knopf drueckt, hat das alte verlegt, und ein verlegtes
 * Token soll nicht weiter gelten.
 */
export async function oeffneRegistrierung(
  hostId: string,
  akteur: { discordId: string; username: string },
  gueltigMinuten = REGISTRIERUNG_GUELTIG_MINUTEN,
  jetzt = new Date(),
): Promise<RegistrierungsAngebot> {
  const token = erzeugeRegistrierungsToken();
  const ablauf = new Date(jetzt.getTime() + gueltigMinuten * 60_000);

  const host = await prisma.gameServerHost.update({
    where: { id: hostId },
    data: { registrationTokenHash: tokenHash(token), registrationExpiresAt: ablauf },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HOST_UPDATED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: host.name,
    success: true,
    // Das Token selbst steht nicht im Protokoll. Ein Protokoll, das
    // Geheimnisse enthaelt, ist ein zweiter Ort, an dem sie liegen.
    metadata: { hostId, was: 'Registrierung geöffnet', ablauf: ablauf.toISOString() },
  });

  return { token, ablauf };
}

/** Was der Agent bei der Registrierung ueber sich sagt. */
export interface HostMeldung {
  agentVersion?: string;
  cpuCores?: number;
  memoryMb?: number;
  diskGb?: number;
  dockerAvailable?: boolean;
}

export type RegistrierErgebnis =
  { ok: true; hostId: string; hostName: string; agentToken: string } | { ok: false; grund: string };

/**
 * Einen Host registrieren.
 *
 * Wird von einem oeffentlichen Endpunkt aufgerufen - der Agent hat zu
 * diesem Zeitpunkt noch keine Identitaet, mit der er sich sonst ausweisen
 * koennte. Deshalb ist das Token hier die ganze Berechtigung, und deshalb
 * ist es einmalig und kurzlebig.
 *
 * Die Absagegruende sind bewusst wortkarg: «Dieses Registrierungs-Token
 * gilt nicht.» sagt einem Angreifer nicht, ob es das Token gab, ob es
 * abgelaufen ist oder ob es schon benutzt wurde.
 */
export async function registriereHost(
  token: string,
  meldung: HostMeldung = {},
  jetzt = new Date(),
): Promise<RegistrierErgebnis> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 256) {
    return { ok: false, grund: 'Dieses Registrierungs-Token gilt nicht.' };
  }

  const hash = tokenHash(token);

  /*
   * Erst suchen, dann entwerten - und **die Entwertung ist der Riegel.**
   *
   * Die Suche findet nur die Zeile; entschieden wird im `updateMany`. Es
   * traegt den Hash und die Frist noch einmal in seiner Bedingung, und nur
   * wer `count === 1` bekommt, hat registriert. Ein zweiter Aufruf - ein
   * Retry, eine zweite Maschine mit demselben Token, ein Angreifer - findet
   * die Bedingung nicht mehr erfuellt, weil der Hash dann `null` ist.
   *
   * Zwischen Suche und Schreiben kann sich nichts einschleichen: die Suche
   * gibt keine Berechtigung, sie gibt eine Kennung.
   */
  const kandidat = await prisma.gameServerHost.findFirst({
    where: { registrationTokenHash: hash, registrationExpiresAt: { gt: jetzt } },
    select: { id: true, name: true },
  });

  if (!kandidat) {
    log.warn('Registrierung abgewiesen', { grund: 'Token unbekannt oder abgelaufen' });
    return { ok: false, grund: 'Dieses Registrierungs-Token gilt nicht.' };
  }

  const entwertet = await prisma.gameServerHost.updateMany({
    where: {
      id: kandidat.id,
      registrationTokenHash: hash,
      registrationExpiresAt: { gt: jetzt },
    },
    data: { registrationTokenHash: null, registrationExpiresAt: null },
  });

  if (entwertet.count !== 1) {
    log.warn('Registrierung abgewiesen', { grund: 'Token bereits verbraucht' });
    return { ok: false, grund: 'Dieses Registrierungs-Token gilt nicht.' };
  }

  const host = kandidat;

  const agentToken = randomBytes(32).toString('base64url');

  let verschluesselt: string;
  try {
    verschluesselt = encryptSecret(agentToken, hostTokenAdresse(host.id));
  } catch {
    /*
     * Ohne Hauptschluessel keine Identitaet. Die Ausnahme selbst wird nicht
     * weitergereicht - sie nennt den Schluessel und seine Laenge.
     */
    return {
      ok: false,
      grund: 'Die Identität liess sich nicht verschlüsseln - vermutlich fehlt MASTER_ENCRYPTION_KEY.',
    };
  }

  await prisma.gameServerHost.update({
    where: { id: host.id },
    data: {
      agentTokenEnc: verschluesselt,
      registeredAt: jetzt,
      agentVersion: meldung.agentVersion?.slice(0, 50) ?? null,
      dockerAvailable: meldung.dockerAvailable ?? null,
      // Was der Host ueber sich meldet, wird nur uebernommen, wenn es
      // plausibel ist. Eine Maschine mit 0 Kernen gibt es nicht, und eine
      // mit 4096 auch nicht.
      ...(plausibel(meldung.cpuCores, 1, 512) ? { cpuCores: Math.trunc(meldung.cpuCores as number) } : {}),
      ...(plausibel(meldung.memoryMb, 512, 4_194_304)
        ? { memoryMb: Math.trunc(meldung.memoryMb as number) }
        : {}),
      ...(plausibel(meldung.diskGb, 1, 1_048_576) ? { diskGb: Math.trunc(meldung.diskGb as number) } : {}),
      lastError: null,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HOST_REGISTERED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: null,
    actorUsername: null,
    targetLabel: host.name,
    success: true,
    metadata: { hostId: host.id, agentVersion: meldung.agentVersion ?? null },
  });

  return { ok: true, hostId: host.id, hostName: host.name, agentToken };
}

function plausibel(wert: unknown, min: number, max: number): boolean {
  return typeof wert === 'number' && Number.isFinite(wert) && wert >= min && wert <= max;
}

// ---------------------------------------------------------------------------
// Gesundheit
// ---------------------------------------------------------------------------

/**
 * Wie es einem Host geht.
 *
 * **Abgeleitet, nicht gespeichert.** Ein gespeicherter Gesundheitswert
 * behauptet nach einem Neustart etwas ueber die Vergangenheit: «HEALTHY»
 * steht dann in der Zeile, obwohl sich seit einer Stunde niemand gemeldet
 * hat. Abgeleitet kann das nicht passieren - die Antwort entsteht aus dem
 * letzten Lebenszeichen und der aktuellen Uhrzeit.
 */
export type HostGesundheit = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'MAINTENANCE' | 'DISABLED' | 'UNREGISTERED';

export interface GesundheitsBefund {
  wert: HostGesundheit;
  /** Warum - im Klartext, fuer das Dashboard. */
  grund: string;
}

/** Was ein Host mindestens mitbringen muss, damit sich das beurteilen laesst. */
export type BeurteilbarerHost = Pick<
  GameServerHost,
  | 'status'
  | 'registeredAt'
  | 'lastHeartbeatAt'
  | 'dockerAvailable'
  | 'diskFreeMb'
  | 'minFreeDiskGb'
  | 'lastError'
>;

export function hostGesundheit(host: BeurteilbarerHost, jetzt = new Date()): GesundheitsBefund {
  if (!host.registeredAt) {
    return { wert: 'UNREGISTERED', grund: 'Der Agent hat sich noch nie gemeldet.' };
  }
  if (host.status === 'DISABLED') {
    return { wert: 'DISABLED', grund: 'Dieser Host ist abgeschaltet.' };
  }
  if (host.status === 'MAINTENANCE') {
    return { wert: 'MAINTENANCE', grund: 'Dieser Host steht in Wartung.' };
  }

  const alter = host.lastHeartbeatAt
    ? Math.round((jetzt.getTime() - host.lastHeartbeatAt.getTime()) / 1000)
    : null;

  if (alter === null || alter > HEARTBEAT_FRIST_SEKUNDEN) {
    return {
      wert: 'OFFLINE',
      grund:
        alter === null
          ? 'Seit der Registrierung kam kein Lebenszeichen.'
          : `Das letzte Lebenszeichen ist ${String(alter)} Sekunden alt.`,
    };
  }

  if (host.dockerAvailable === false) {
    return { wert: 'DEGRADED', grund: 'Auf dem Host antwortet Docker nicht.' };
  }
  if (host.diskFreeMb !== null && host.diskFreeMb < host.minFreeDiskGb * 1024) {
    return {
      wert: 'DEGRADED',
      grund: `Nur noch ${String(Math.round(host.diskFreeMb / 1024))} GB frei - die Untergrenze liegt bei ${String(host.minFreeDiskGb)} GB.`,
    };
  }
  if (host.lastError) {
    return { wert: 'DEGRADED', grund: host.lastError.slice(0, 200) };
  }

  return { wert: 'HEALTHY', grund: 'Alles in Ordnung.' };
}

// ---------------------------------------------------------------------------
// Kapazitaet
// ---------------------------------------------------------------------------

/**
 * Zustaende, in denen eine Instanz Kapazitaet auf einem Host belegt.
 *
 * Ab der Reservierung, nicht erst ab dem laufenden Container: zwanzig
 * gleichzeitige Anforderungen waeren sonst alle «unter der Grenze», weil
 * noch keine fertig ist.
 */
export const BELEGENDE_INSTANZ_ZUSTAENDE = [
  'RESERVED',
  'CREATING',
  'STARTING',
  'CONFIGURING',
  'READY',
  'LIVE',
  'STOPPING',
  'STOPPED',
  'ARCHIVING',
  // Die VM-Welt zaehlt mit, solange sie noch existiert.
  'PENDING',
  'PROVISIONING',
  'BOOTING',
  'AGENT_READY',
  'RUNNING',
] as const;

/** Zustaende, in denen eine Instanz gerade erst entsteht. */
export const STARTENDE_INSTANZ_ZUSTAENDE = ['RESERVED', 'CREATING', 'STARTING', 'CONFIGURING'] as const;

export interface HostKapazitaet {
  instanzen: number;
  maxInstanzen: number;
  startend: number;
  maxParallelStarts: number;
  /** Was die laufenden Instanzen zusammen reserviert haben. */
  cpuReserviert: number;
  memoryReserviertMb: number;
  /** Was uebrig ist, nachdem die Systemreserve abgezogen ist. */
  cpuFrei: number;
  memoryFreiMb: number;
  /** Wie viele Spielports der Bereich noch hergibt. */
  gamePortsFrei: number;
}

type KapazitaetsHost = Pick<
  GameServerHost,
  | 'id'
  | 'cpuCores'
  | 'memoryMb'
  | 'reservedCpuCores'
  | 'reservedMemoryMb'
  | 'maxInstances'
  | 'maxParallelStarts'
  | 'gamePortFrom'
  | 'gamePortTo'
>;

/**
 * Was auf einem Host noch Platz hat.
 *
 * Gerechnet wird gegen die **Datenbank**, nicht gegen das, was der Host
 * meldet. Der gemeldete Speicherverbrauch hinkt immer hinterher; eine
 * Instanz, die SwissHub vor zwei Sekunden angefordert hat, taucht dort noch
 * nicht auf - in der Datenbank schon.
 */
export async function hostKapazitaet(host: KapazitaetsHost): Promise<HostKapazitaet> {
  const [instanzen, startend, summen, belegtePorts] = await Promise.all([
    prisma.gameServerInstance.count({
      where: { hostId: host.id, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
    }),
    prisma.gameServerInstance.count({
      where: { hostId: host.id, status: { in: [...STARTENDE_INSTANZ_ZUSTAENDE] } },
    }),
    prisma.gameServerInstance.aggregate({
      where: { hostId: host.id, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
      _sum: { cpuLimit: true, memoryLimitMb: true },
    }),
    prisma.hostPortReservation.count({
      where: { hostId: host.id, kind: 'GAME' },
    }),
  ]);

  const cpuReserviert = summen._sum.cpuLimit ?? 0;
  const memoryReserviertMb = summen._sum.memoryLimitMb ?? 0;

  return {
    instanzen,
    maxInstanzen: host.maxInstances,
    startend,
    maxParallelStarts: host.maxParallelStarts,
    cpuReserviert,
    memoryReserviertMb,
    cpuFrei: Math.max(0, host.cpuCores - host.reservedCpuCores - cpuReserviert),
    memoryFreiMb: Math.max(0, host.memoryMb - host.reservedMemoryMb - memoryReserviertMb),
    gamePortsFrei: Math.max(0, bereichsGroesse(host.gamePortFrom, host.gamePortTo) - belegtePorts),
  };
}

// ---------------------------------------------------------------------------
// Lebenszeichen
// ---------------------------------------------------------------------------

export interface HostLebenszeichen extends HostMeldung {
  cpuPercent?: number;
  memoryUsedMb?: number;
  diskFreeMb?: number;
  uptimeSeconds?: number;
  runningCount?: number;
}

/**
 * Ein Lebenszeichen entgegennehmen.
 *
 * Schreibt den aktuellen Stand an den Host und **nicht** bei jedem Mal eine
 * Verlaufszeile: bei zehn Hosts im Halbminutentakt waeren das 28'800 Zeilen
 * am Tag, von denen niemand je eine liest. Der Verlauf wird ausgeduennt -
 * gespeichert wird nur, was weiter zurueckliegt als das eingestellte
 * Intervall.
 */
export async function nimmHostLebenszeichen(
  hostId: string,
  meldung: HostLebenszeichen,
  jetzt = new Date(),
  verlaufIntervallMinuten = 5,
): Promise<void> {
  const host = await prisma.gameServerHost.update({
    where: { id: hostId },
    data: {
      lastHeartbeatAt: jetzt,
      agentVersion: meldung.agentVersion?.slice(0, 50) ?? undefined,
      dockerAvailable: meldung.dockerAvailable ?? undefined,
      cpuPercent: plausibel(meldung.cpuPercent, 0, 100) ? meldung.cpuPercent : undefined,
      memoryUsedMb: plausibel(meldung.memoryUsedMb, 0, 4_194_304)
        ? Math.trunc(meldung.memoryUsedMb as number)
        : undefined,
      diskFreeMb: plausibel(meldung.diskFreeMb, 0, 1_073_741_824)
        ? Math.trunc(meldung.diskFreeMb as number)
        : undefined,
      uptimeSeconds: plausibel(meldung.uptimeSeconds, 0, 3_153_600_000)
        ? Math.trunc(meldung.uptimeSeconds as number)
        : undefined,
      runningCount: plausibel(meldung.runningCount, 0, 1000)
        ? Math.trunc(meldung.runningCount as number)
        : undefined,
    },
    select: { id: true },
  });

  const letzte = await prisma.serverHeartbeat.findFirst({
    where: { hostId: host.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const faellig = !letzte || jetzt.getTime() - letzte.createdAt.getTime() >= verlaufIntervallMinuten * 60_000;

  if (faellig) {
    await prisma.serverHeartbeat.create({
      data: {
        hostId: host.id,
        cpuPercent: meldung.cpuPercent ?? null,
        memoryMb: meldung.memoryUsedMb ?? null,
        diskFreeMb: meldung.diskFreeMb ?? null,
        agentVersion: meldung.agentVersion?.slice(0, 50) ?? null,
        dockerAvailable: meldung.dockerAvailable ?? null,
        instanceCount: meldung.runningCount ?? null,
        createdAt: jetzt,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Verwaltung
// ---------------------------------------------------------------------------

/**
 * Den Status eines Hosts setzen.
 *
 * `DRAINING` und `MAINTENANCE` nehmen ihm **keine** laufenden Instanzen weg.
 * Wer einen Host in Wartung schickt, waehrend darauf ein Halbfinale laeuft,
 * will das Halbfinale zu Ende spielen lassen - nicht abbrechen.
 */
export async function setzeHostStatus(
  hostId: string,
  status: GameServerHostStatus,
  akteur: { discordId: string; username: string },
): Promise<{ name: string; laufende: number }> {
  const host = await prisma.gameServerHost.update({ where: { id: hostId }, data: { status } });

  const laufende = await prisma.gameServerInstance.count({
    where: { hostId, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HOST_STATUS_CHANGED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: host.name,
    success: true,
    metadata: { hostId, status, laufendeInstanzen: laufende },
  });

  return { name: host.name, laufende };
}

/**
 * Das Agent-Token eines Hosts.
 *
 * Eigene Funktion mit diesem Namen, damit klar ist, wer sie aufruft. Sie
 * wird **nirgends** in einer Antwort an den Browser verwendet - ein Test
 * durchsucht die Server-Actions und die Seiten danach.
 */
export async function hostAgentToken(hostId: string): Promise<string | null> {
  const host = await prisma.gameServerHost.findUnique({
    where: { id: hostId },
    select: { agentTokenEnc: true },
  });
  if (!host?.agentTokenEnc) {
    return null;
  }
  try {
    return decryptSecret(host.agentTokenEnc, hostTokenAdresse(hostId));
  } catch (fehler) {
    log.warn('Agent-Token nicht lesbar', { hostId, fehler });
    return null;
  }
}

/**
 * Darf dieser Host dieses Spiel?
 *
 * Eine leere Liste heisst **nein**, nicht «alles». Ein Host, bei dem
 * niemand etwas eingetragen hat, bekommt nichts zugewiesen - das ist die
 * sichere Richtung, und sie faellt beim Einrichten sofort auf.
 */
export function hostKannSpiel(host: Pick<GameServerHost, 'allowedGames'>, game: GameServerGame): boolean {
  return host.allowedGames.includes(game);
}

/** Einen Host verwerfen - nur, wenn nichts mehr darauf laeuft. */
export async function loescheHost(
  hostId: string,
  akteur: { discordId: string; username: string },
): Promise<void> {
  const laufende = await prisma.gameServerInstance.count({
    where: { hostId, status: { in: [...BELEGENDE_INSTANZ_ZUSTAENDE] } },
  });
  if (laufende > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `Auf diesem Host laufen noch ${String(laufende)} Instanzen. Erst leeren, dann entfernen.`,
      internalMessage: `Host ${hostId} hat ${String(laufende)} belegende Instanzen`,
    });
  }

  const host = await prisma.gameServerHost.delete({ where: { id: hostId } });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HOST_DELETED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: host.name,
    success: true,
    metadata: { hostId },
  });
}

// ---------------------------------------------------------------------------
// Verbindung und Abbilder
// ---------------------------------------------------------------------------

/**
 * Die Verbindung zu einem Host pruefen.
 *
 * Liegt hier und nicht in der Server Action, obwohl beides serverseitig
 * laeuft. Der Grund ist die Reichweite eines Fehlers: eine Action, die
 * `hostAgentToken()` kennt, ist eine Zeile `return { token }` von einem
 * Geheimnis im Browser entfernt. Eine, die nur `{ ok, meldung }` bekommt,
 * ist es nicht - und ein Test haelt fest, dass an der Grenze zum Browser
 * weder `hostAgentToken` noch `getSecret` vorkommt.
 */
export async function pruefeHost(
  hostId: string,
  jetzt = new Date(),
  transport?: AgentTransport,
): Promise<{ ok: boolean; meldung: string }> {
  const host = await prisma.gameServerHost.findUnique({
    where: { id: hostId },
    select: { id: true, name: true, hostname: true, agentPort: true, registeredAt: true },
  });

  if (!host) {
    return { ok: false, meldung: 'Diesen Host gibt es nicht.' };
  }
  if (!host.registeredAt) {
    return { ok: false, meldung: 'Dieser Host hat sich noch nie registriert.' };
  }

  const token = await hostAgentToken(hostId);
  if (!token) {
    return { ok: false, meldung: 'Die Identität dieses Hosts lässt sich nicht lesen.' };
  }

  try {
    const { hostZugriff } = await import('./agent-client');
    const agent = hostZugriff({ host: host.hostname, port: host.agentPort, token }, transport);
    const meldung = await agent.hostStatus();

    await nimmHostLebenszeichen(
      hostId,
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
    await prisma.gameServerHost.update({ where: { id: hostId }, data: { lastError: null } });

    return {
      ok: true,
      meldung: meldung.dockerAvailable
        ? `Agent ${meldung.agentVersion ?? 'unbekannter Version'} antwortet, Docker läuft.`
        : `Agent ${meldung.agentVersion ?? 'unbekannter Version'} antwortet, aber Docker nicht.`,
    };
  } catch (fehler) {
    /*
     * Die Meldung des Agenten wird gekuerzt weitergegeben, aber nicht
     * erfunden: was schiefging, soll dastehen. Ein Stacktrace nicht - er
     * gehoert ins Protokoll.
     */
    const meldung = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
    log.warn('Hostpruefung fehlgeschlagen', { hostId, fehler });
    await prisma.gameServerHost
      .update({ where: { id: hostId }, data: { lastError: meldung.slice(0, 2000) } })
      .catch(() => undefined);
    return { ok: false, meldung: meldung.slice(0, 500) };
  }
}

export interface AbbildAbgleich {
  geprueft: number;
  aktuell: number;
  geladen: number;
  fehler: number;
}

/**
 * Den Abbildbestand eines Hosts mit dem Katalog abgleichen.
 *
 * **Ohne `laden` wird nichts geladen.** Der Abgleich sagt dann nur, was
 * fehlt - das ist der Normalfall, und er ist billig. Mit `laden` holt der
 * Host, was fehlt oder veraltet ist; das dauert Minuten und wird deshalb
 * bewusst angestossen und nicht nebenbei gemacht.
 *
 * Ein laufendes Match wird dabei **nicht** angefasst. `docker pull` laedt
 * ein neues Abbild neben das alte; ein Container, der schon laeuft, laeuft
 * auf dem alten weiter, bis er ohnehin entfernt wird.
 */
export async function synchronisiereAbbilder(
  hostId: string,
  laden: boolean,
  akteur: { discordId: string; username: string },
  jetzt = new Date(),
  transport?: AgentTransport,
): Promise<AbbildAbgleich> {
  const ergebnis: AbbildAbgleich = { geprueft: 0, aktuell: 0, geladen: 0, fehler: 0 };

  const host = await prisma.gameServerHost.findUnique({
    where: { id: hostId },
    select: { id: true, name: true, hostname: true, agentPort: true },
  });
  if (!host) {
    return ergebnis;
  }

  const token = await hostAgentToken(hostId);
  if (!token) {
    return ergebnis;
  }

  const { hostZugriff } = await import('./agent-client');
  const agent = hostZugriff({ host: host.hostname, port: host.agentPort, token }, transport);

  const [abbilder, vorhanden] = await Promise.all([
    prisma.gameRuntimeImage.findMany({ where: { enabled: true } }),
    agent.images().catch(() => null),
  ]);

  if (vorhanden === null) {
    return { ...ergebnis, fehler: abbilder.length };
  }

  for (const abbild of abbilder) {
    ergebnis.geprueft += 1;

    const treffer = vorhanden.filter((eintrag) => eintrag.image === abbild.image);
    const passend = treffer.find((eintrag) => eintrag.tag === abbild.tag);

    let fehlertext: string | null = null;
    let geladen = false;

    if (!passend && laden) {
      try {
        await agent.imagePull(`${abbild.image}:${abbild.tag}`);
        geladen = true;
        ergebnis.geladen += 1;
      } catch (fehler) {
        fehlertext = (fehler instanceof Error ? fehler.message : 'Unbekannter Fehler').slice(0, 2000);
        ergebnis.fehler += 1;
      }
    }

    if (passend || geladen) {
      ergebnis.aktuell += 1;
    }

    await prisma.hostImageState.upsert({
      where: { hostId_imageId: { hostId, imageId: abbild.id } },
      create: {
        hostId,
        imageId: abbild.id,
        presentTag: passend || geladen ? abbild.tag : (treffer[0]?.tag ?? null),
        sizeBytes: passend?.sizeBytes ? BigInt(passend.sizeBytes) : null,
        lastSeenAt: jetzt,
        lastError: fehlertext,
      },
      update: {
        presentTag: passend || geladen ? abbild.tag : (treffer[0]?.tag ?? null),
        sizeBytes: passend?.sizeBytes ? BigInt(passend.sizeBytes) : null,
        lastSeenAt: jetzt,
        pulling: false,
        lastError: fehlertext,
      },
    });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_HOST_IMAGE_SYNCED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: host.name,
    success: ergebnis.fehler === 0,
    metadata: { hostId, ...ergebnis, geladen: laden },
  });

  return ergebnis;
}
