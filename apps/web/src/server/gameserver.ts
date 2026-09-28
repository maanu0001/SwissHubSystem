import 'server-only';
import { can } from '@swisshub/auth';
import { createLogger } from '@swisshub/logger';
import { prisma } from '@swisshub/database';
import { gameserver, tournaments } from '@swisshub/modules';
import { GAMESERVER_INTEGRATION_ID, hasSecret } from '@swisshub/secrets';
import type { AuthContext } from '@swisshub/auth';

const logger = createLogger('web:gameserver');

/**
 * Was die Gameserver-Seiten laden.
 *
 * ## Die sechs Bereiche
 *
 * Übersicht, Aktive Server, Game Profiles, Templates, Infrastruktur,
 * Einstellungen - und alle liegen unter `/turniere/gameserver`. Das ist
 * kein Nebenmodul mit eigener Navigation, sondern ein Abschnitt des
 * Turniermoduls: die Berechtigungen heissen `tournaments.gameserver.*`, die
 * Modulkennung ist `tournaments`, und wer das Turniermodul abschaltet,
 * schaltet die Gameserver mit ab.
 */
export interface GameserverAbschnitt {
  href: string;
  label: string;
}

export function gameserverAbschnitte(context: AuthContext): GameserverAbschnitt[] {
  const P = tournaments.TOURNAMENT_PERMISSIONS;
  const abschnitte: GameserverAbschnitt[] = [{ href: '/turniere/gameserver', label: 'Übersicht' }];

  if (can(context, P.gameserverView)) {
    abschnitte.push({ href: '/turniere/gameserver/server', label: 'Aktive Matches' });
  }
  if (can(context, P.hostsManage) || can(context, P.gameserverView)) {
    abschnitte.push({ href: '/turniere/gameserver/hosts', label: 'Hosts' });
  }
  if (can(context, P.gameProfilesManage)) {
    abschnitte.push({ href: '/turniere/gameserver/profile', label: 'Game Profiles' });
  }
  if (can(context, P.runtimeImagesManage)) {
    abschnitte.push({ href: '/turniere/gameserver/images', label: 'Runtime-Images' });
  }
  if (can(context, P.infrastructureManage)) {
    abschnitte.push({ href: '/turniere/gameserver/infrastruktur', label: 'Infrastruktur' });
  }
  if (can(context, P.manage)) {
    abschnitte.push({ href: `/modules/${tournaments.TOURNAMENTS_MODULE_ID}`, label: 'Einstellungen' });
  }

  return abschnitte;
}

/*
 * Die Templates-Seite ist aus der Leiste verschwunden, nicht aus dem
 * System. Sie gehoert zur Bereitstellung ganzer Maschinen, und die ist
 * heute eine spaetere Ausbaustufe - wer sie braucht, findet sie unter
 * Infrastruktur. Eine Leiste mit sieben Eintraegen, von denen einer fuer
 * den normalen Betrieb nie gebraucht wird, ist eine Leiste zu lang.
 */

export interface InfrastrukturAnsicht {
  /**
   * Was fehlt, damit Matches automatisch einen Server bekommen.
   *
   * Nie geworfen: `konfigurationsStand()` gibt auch dann eine Antwort, wenn
   * die Datenbank nicht erreichbar ist - dann steht «unbekannt» da und
   * nicht «nicht eingerichtet».
   */
  stand: Awaited<ReturnType<typeof gameserver.konfigurationsStand>>;
  /** Ist überhaupt ein Anbieter eingerichtet? */
  anbieterVorhanden: boolean;
  /** Liegen Zugangsdaten im verschlüsselten Speicher? */
  zugangsdatenVorhanden: boolean;
  /** Ist die Gameserver-Funktion in den Moduleinstellungen eingeschaltet? */
  eingeschaltet: boolean;
  anbieter: Array<{
    id: string;
    name: string;
    driver: string;
    /** Gibt es für diesen Treiber überhaupt eine Umsetzung? */
    treiberVorhanden: boolean;
    /** Simuliert dieser Treiber nur? */
    simulation: boolean;
    enabled: boolean;
    region: string | null;
    lastCheckAt: Date | null;
    lastCheckOk: boolean | null;
    lastCheckMessage: string | null;
    templateAnzahl: number;
  }>;
  zahlen: Awaited<ReturnType<typeof gameserver.infrastrukturStand>>;
  grenzen: {
    maxTotal: number;
    maxPerGame: number;
    maxParallelProvisioning: number;
    maxPerTournament: number;
    idleTimeoutMinutes: number;
  };
}

/**
 * Der Zustand der Infrastruktur.
 *
 * **Keine erfundenen Werte.** Was der Anbieter nicht gemeldet hat, steht als
 * «nie geprüft» da und nicht als «in Ordnung»; ein Treiber, den es nicht
 * gibt, heisst «Treiber fehlt» und nicht «verbunden».
 */
export async function ladeInfrastruktur(): Promise<InfrastrukturAnsicht> {
  const settings = await tournaments.einstellungen();

  const [anbieter, zahlen, zugang, stand] = await Promise.all([
    prisma.gameServerProvider.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { templates: true } } },
    }),
    gameserver.infrastrukturStand(),
    hasSecret(GAMESERVER_INTEGRATION_ID, 'secret'),
    gameserver.konfigurationsStand(),
  ]);

  return {
    stand,
    anbieterVorhanden: anbieter.length > 0,
    zugangsdatenVorhanden: zugang,
    eingeschaltet: settings.gameserverEnabled,
    anbieter: anbieter.map((eintrag) => ({
      id: eintrag.id,
      name: eintrag.name,
      driver: eintrag.driver,
      treiberVorhanden: gameserver.anbieterTreiber(eintrag.driver) !== undefined,
      simulation: eintrag.driver === gameserver.SIMULATION_TREIBER,
      enabled: eintrag.enabled,
      region: eintrag.region,
      lastCheckAt: eintrag.lastCheckAt,
      lastCheckOk: eintrag.lastCheckOk,
      lastCheckMessage: eintrag.lastCheckMessage,
      templateAnzahl: eintrag._count.templates,
    })),
    zahlen,
    grenzen: {
      maxTotal: settings.gameserverMaxTotal,
      maxPerGame: settings.gameserverMaxPerGame,
      maxParallelProvisioning: settings.gameserverMaxParallelProvisioning,
      maxPerTournament: settings.gameserverMaxPerTournament,
      idleTimeoutMinutes: settings.gameserverIdleTimeoutMinutes,
    },
  };
}

// ---------------------------------------------------------------------------
// Match Room
// ---------------------------------------------------------------------------

export interface MatchRoomAnsicht {
  assignmentId: string;
  phase: string;
  /** Was die Phase im Klartext heisst. */
  phaseText: string;
  /** Die Serveradresse - nur, wenn es eine gibt. */
  serverAdresse: string | null;
  /** Das Serverpasswort. Bewusst sichtbar: es steht ohnehin in jeder Lobby. */
  serverPasswort: string | null;
  serverStatus: string | null;
  aktuelleMap: string | null;
  lastError: string | null;
  resultReview: boolean;
  resultReviewReason: string | null;
  veto: Awaited<ReturnType<typeof gameserver.vetoStand>> | null;
  /** Die Seite, für die der Betrachter sprechen darf. */
  eigeneSeite: 'A' | 'B' | null;
  /** Ist der Betrachter gerade am Zug? */
  amZug: boolean;
  dateien: Array<{
    id: string;
    kind: string;
    remoteName: string;
    sizeBytes: number;
    mapIndex: number | null;
  }>;
  /**
   * Was nur die Turnierleitung sieht.
   *
   * `null` fuer alle anderen. Es steht nicht nur ungenutzt im Objekt und
   * wird im Client ausgeblendet - es wird gar nicht erst geladen. Was nicht
   * im Objekt ist, kann nicht versehentlich gerendert werden.
   *
   * Auch hier kein Geheimnis: Host **name**, nicht Host-Token;
   * Container-Kennung, nicht RCON-Passwort.
   */
  technik: {
    hostName: string | null;
    hostId: string | null;
    instanzName: string | null;
    containerRef: string | null;
    imageTag: string | null;
    gamePort: number | null;
    queryPort: number | null;
    tvPort: number | null;
    cpuLimit: number | null;
    memoryLimitMb: number | null;
    instanzStatus: string | null;
    /** Ein von Hand vorgegebener Host, falls gesetzt. */
    erzwungenerHostId: string | null;
  } | null;
}

/**
 * Was ein Match Room zeigt.
 *
 * ## Was hier nicht drin ist
 *
 * Das RCON-Passwort, das Agent-Token, die Zugangsdaten des Anbieters, die
 * Kennung der Maschine beim Anbieter. Der Typ oben enthält keines davon -
 * ein Spieler braucht die Serveradresse und das Lobbypasswort, sonst nichts.
 *
 * Das Serverpasswort steht dagegen im Klartext da, und das ist kein
 * Versehen: es wird in eine Spielkonsole getippt und im Teamchat
 * weitergegeben. Ein Geheimnis, das man vorliest, ist keins - es zu
 * maskieren wäre Theater.
 */
export async function ladeMatchRoom(
  matchId: string,
  discordId: string,
  mitTechnik = false,
): Promise<MatchRoomAnsicht | null> {
  try {
    return await leseMatchRoom(matchId, discordId, mitTechnik);
  } catch (fehler) {
    /*
     * **Der Grund für dieses try.**
     *
     * Diese Funktion wird auf *jeder* Matchseite aufgerufen - auch auf
     * Matches, die mit Gameservern nie etwas zu tun hatten. Würfe sie,
     * nähme sie eine Seite mit, die es seit Monaten gibt und die
     * funktioniert.
     *
     * `null` heisst hier dasselbe wie «dieses Match hat keinen Server»:
     * die Seite sieht aus wie immer. Dass etwas schiefging, steht im
     * Protokoll, nicht im Weg.
     */
    logger.warn('Match Room nicht lesbar', { matchId, fehler });
    return null;
  }
}

async function leseMatchRoom(
  matchId: string,
  discordId: string,
  mitTechnik: boolean,
): Promise<MatchRoomAnsicht | null> {
  const zuordnung = await prisma.matchServerAssignment.findFirst({
    where: { matchId },
    orderBy: { generation: 'desc' },
    include: {
      instance: {
        select: {
          id: true,
          name: true,
          publicHost: true,
          gamePort: true,
          queryPort: true,
          tvPort: true,
          serverPassword: true,
          status: true,
          currentMap: true,
          containerRef: true,
          imageTag: true,
          cpuLimit: true,
          memoryLimitMb: true,
          host: { select: { id: true, name: true } },
        },
      },
      files: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, remoteName: true, sizeBytes: true, mapIndex: true },
      },
    },
  });

  if (!zuordnung) {
    return null;
  }

  const veto = await gameserver.vetoStand(zuordnung.id).catch(() => null);
  const eigeneSeite = await tournaments.getMatchSlot(matchId, discordId);

  const instanz = zuordnung.instance;
  const adresse =
    instanz?.publicHost && instanz.gamePort ? `${instanz.publicHost}:${String(instanz.gamePort)}` : null;

  return {
    assignmentId: zuordnung.id,
    phase: zuordnung.phase,
    phaseText: phasenText(zuordnung.phase),
    serverAdresse: adresse,
    serverPasswort: instanz?.serverPassword ?? null,
    serverStatus: instanz?.status ?? null,
    aktuelleMap: instanz?.currentMap ?? null,
    lastError: zuordnung.lastError,
    resultReview: zuordnung.resultReview,
    resultReviewReason: zuordnung.resultReviewReason,
    veto,
    eigeneSeite,
    amZug: eigeneSeite !== null && veto?.naechster?.actor === eigeneSeite,
    dateien: zuordnung.files,
    technik: mitTechnik
      ? {
          hostName: instanz?.host?.name ?? null,
          hostId: instanz?.host?.id ?? null,
          instanzName: instanz?.name ?? null,
          containerRef: instanz?.containerRef ?? null,
          imageTag: instanz?.imageTag ?? null,
          gamePort: instanz?.gamePort ?? null,
          queryPort: instanz?.queryPort ?? null,
          tvPort: instanz?.tvPort ?? null,
          cpuLimit: instanz?.cpuLimit ?? null,
          memoryLimitMb: instanz?.memoryLimitMb ?? null,
          instanzStatus: instanz?.status ?? null,
          erzwungenerHostId: zuordnung.forcedHostId,
        }
      : null,
  };
}

/**
 * Die Phase im Klartext.
 *
 * Kein `WAITING_FOR_SERVER` im Match Room. Ein Spieler soll lesen, was los
 * ist, nicht eine Kennung nachschlagen müssen.
 */
export function phasenText(phase: string): string {
  const texte: Record<string, string> = {
    WAITING_FOR_SERVER: 'Wartet auf einen Server',
    PROVISIONING: 'Server wird erstellt',
    SERVER_BOOTING: 'Server startet',
    AGENT_CONNECTING: 'Server meldet sich an',
    CONFIGURING: 'Match wird eingerichtet',
    READY_FOR_VETO: 'Bereit für das Map-Veto',
    VETO_RUNNING: 'Map-Veto läuft',
    WAITING_FOR_PLAYERS: 'Wartet auf die Spieler',
    READY_CHECK: 'Bereitmeldung',
    LIVE: 'Läuft',
    MATCH_FINISHED: 'Match beendet',
    RESULT_PROCESSING: 'Resultat wird übernommen',
    ARCHIVING: 'Demos und Logs werden gesichert',
    CLEANUP_PENDING: 'Server wird gleich entfernt',
    SERVER_REMOVED: 'Server entfernt',
    PROVISION_FAILED: 'Der Server konnte nicht erstellt werden',
    CONFIG_FAILED: 'Das Match konnte nicht eingerichtet werden',
    SERVER_ERROR: 'Der Server meldet einen Fehler',
    MATCH_INTERRUPTED: 'Das Match wurde unterbrochen',
    RESULT_ERROR: 'Das Resultat muss geprüft werden',
    ARCHIVE_ERROR: 'Demos oder Logs fehlen',
  };
  return texte[phase] ?? phase;
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------

/**
 * Was die Hostliste zeigt.
 *
 * **Kein Geheimnis in dieser Form.** Kein Agent-Token, kein
 * Registrierungs-Token, kein RCON-Passwort. Dass ein Host registriert ist,
 * steht als `registriert: boolean` da - nicht als Token.
 */
export interface HostAnsicht {
  id: string;
  name: string;
  beschreibung: string | null;
  hostname: string;
  agentPort: number;
  region: string | null;
  gruppe: string | null;
  status: string;
  /** Abgeleitet aus dem letzten Lebenszeichen - nicht gespeichert. */
  gesundheit: string;
  gesundheitGrund: string;
  registriert: boolean;
  /** Steht gerade ein Registrierungs-Token offen, und bis wann? */
  registrierungOffenBis: Date | null;
  agentVersion: string | null;
  lastHeartbeatAt: Date | null;
  dockerVerfuegbar: boolean | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  cpuPercent: number | null;
  memoryUsedMb: number | null;
  diskFreeMb: number | null;
  erlaubteSpiele: string[];
  maxInstanzen: number;
  instanzen: number;
  cpuFrei: number;
  memoryFreiMb: number;
  gamePortsFrei: number;
  portBereiche: { game: string; query: string; tv: string };
  lastError: string | null;
}

export async function ladeHosts(jetzt = new Date()): Promise<HostAnsicht[]> {
  const hosts = await prisma.gameServerHost.findMany({
    orderBy: { name: 'asc' },
    include: { group: { select: { name: true } } },
  });

  return Promise.all(hosts.map((host) => baueHostAnsicht(host, host.group?.name ?? null, jetzt)));
}

async function baueHostAnsicht(
  host: Awaited<ReturnType<typeof prisma.gameServerHost.findMany>>[number],
  gruppe: string | null,
  jetzt: Date,
): Promise<HostAnsicht> {
  const befund = gameserver.hostGesundheit(host, jetzt);
  const kapazitaet = await gameserver.hostKapazitaet(host);

  return {
    id: host.id,
    name: host.name,
    beschreibung: host.description,
    hostname: host.hostname,
    agentPort: host.agentPort,
    region: host.region,
    gruppe,
    status: host.status,
    gesundheit: befund.wert,
    gesundheitGrund: befund.grund,
    registriert: host.registeredAt !== null,
    registrierungOffenBis: host.registrationTokenHash ? host.registrationExpiresAt : null,
    agentVersion: host.agentVersion,
    lastHeartbeatAt: host.lastHeartbeatAt,
    dockerVerfuegbar: host.dockerAvailable,
    cpuCores: host.cpuCores,
    memoryMb: host.memoryMb,
    diskGb: host.diskGb,
    cpuPercent: host.cpuPercent,
    memoryUsedMb: host.memoryUsedMb,
    diskFreeMb: host.diskFreeMb,
    erlaubteSpiele: host.allowedGames,
    maxInstanzen: host.maxInstances,
    instanzen: kapazitaet.instanzen,
    cpuFrei: kapazitaet.cpuFrei,
    memoryFreiMb: kapazitaet.memoryFreiMb,
    gamePortsFrei: kapazitaet.gamePortsFrei,
    portBereiche: {
      game: `${String(host.gamePortFrom)}–${String(host.gamePortTo)}`,
      query: `${String(host.queryPortFrom)}–${String(host.queryPortTo)}`,
      tv: `${String(host.tvPortFrom)}–${String(host.tvPortTo)}`,
    },
    lastError: host.lastError,
  };
}

export interface HostDetail extends HostAnsicht {
  instanzenDetail: Array<{
    id: string;
    name: string;
    game: string;
    status: string;
    gamePort: number | null;
    matchNummer: number | null;
    turnier: string | null;
  }>;
  abbilder: Array<{
    id: string;
    name: string;
    gewuenscht: string;
    vorhanden: string | null;
    aktuell: boolean;
    laedt: boolean;
    lastError: string | null;
  }>;
  ports: { gesamt: number; jeArt: Record<string, number> };
}

export async function ladeHostDetail(hostId: string, jetzt = new Date()): Promise<HostDetail | null> {
  const host = await prisma.gameServerHost.findUnique({
    where: { id: hostId },
    include: { group: { select: { name: true } } },
  });
  if (!host) {
    return null;
  }

  const [basis, instanzen, abbilder, ports] = await Promise.all([
    baueHostAnsicht(host, host.group?.name ?? null, jetzt),
    prisma.gameServerInstance.findMany({
      where: { hostId, status: { not: 'REMOVED' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        assignments: {
          orderBy: { generation: 'desc' },
          take: 1,
          include: { match: { select: { matchNumber: true, tournament: { select: { name: true } } } } },
        },
      },
    }),
    prisma.gameRuntimeImage.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      include: { hostStates: { where: { hostId } } },
    }),
    gameserver.portBelegung(hostId),
  ]);

  return {
    ...basis,
    instanzenDetail: instanzen.map((instanz) => ({
      id: instanz.id,
      name: instanz.name,
      game: instanz.game,
      status: instanz.status,
      gamePort: instanz.gamePort,
      matchNummer: instanz.assignments[0]?.match.matchNumber ?? null,
      turnier: instanz.assignments[0]?.match.tournament.name ?? null,
    })),
    abbilder: abbilder.map((abbild) => {
      const zustand = abbild.hostStates[0];
      return {
        id: abbild.id,
        name: abbild.name,
        gewuenscht: `${abbild.image}:${abbild.tag}`,
        vorhanden: zustand?.presentTag ? `${abbild.image}:${zustand.presentTag}` : null,
        // «Aktuell» heisst: der Host hat genau den Tag, der gewuenscht ist.
        // Alles andere heisst «Update verfuegbar» und nicht «aktuell».
        aktuell: zustand?.presentTag === abbild.tag,
        laedt: zustand?.pulling ?? false,
        lastError: zustand?.lastError ?? null,
      };
    }),
    ports,
  };
}

// ---------------------------------------------------------------------------
// Runtime-Images
// ---------------------------------------------------------------------------

export interface AbbildAnsicht {
  id: string;
  name: string;
  game: string;
  image: string;
  tag: string;
  command: string[];
  dataMountPath: string;
  configMountPath: string;
  gamePortInContainer: number;
  queryPortInContainer: number | null;
  tvPortInContainer: number | null;
  healthTimeoutSeconds: number;
  enabled: boolean;
  profileAnzahl: number;
  /** Auf wie vielen Hosts das Abbild in der gewuenschten Fassung liegt. */
  hostsAktuell: number;
  hostsGesamt: number;
}

export async function ladeAbbilder(): Promise<AbbildAnsicht[]> {
  const [abbilder, hosts] = await Promise.all([
    prisma.gameRuntimeImage.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { profiles: true } }, hostStates: true },
    }),
    prisma.gameServerHost.count(),
  ]);

  return abbilder.map((abbild) => ({
    id: abbild.id,
    name: abbild.name,
    game: abbild.game,
    image: abbild.image,
    tag: abbild.tag,
    command: abbild.command,
    dataMountPath: abbild.dataMountPath,
    configMountPath: abbild.configMountPath,
    gamePortInContainer: abbild.gamePortInContainer,
    queryPortInContainer: abbild.queryPortInContainer,
    tvPortInContainer: abbild.tvPortInContainer,
    healthTimeoutSeconds: abbild.healthTimeoutSeconds,
    enabled: abbild.enabled,
    profileAnzahl: abbild._count.profiles,
    hostsAktuell: abbild.hostStates.filter((zustand) => zustand.presentTag === abbild.tag).length,
    hostsGesamt: hosts,
  }));
}
