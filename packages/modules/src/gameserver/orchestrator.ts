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
import { brauchteTreiber, type Zugangsdaten } from './anbieter';
import { gameAdapter } from './adapter';
import { hostZugriff, type AgentTransport } from './agent-client';
import { erzeugeRconPasswort, erzeugeServerPasswort } from './agent-protokoll';
import { rconAdresse } from './geheimnis';
import {
  BELEGENDE_ZUSTAENDE,
  ENTSTEHENDE_ZUSTAENDE,
  darfProvisionieren,
  type Grenzwerte,
} from './grenzwerte';
import { hostAgentToken, hostGesundheit } from './hosts';
import { reserviereAufHost, waehleHosts, type HostAnforderung } from './host-scheduler';
import { gibPortsFrei, reservierePorts, type ReserviertePorts } from './ports';
import { abbildMitTag, containerName, type ContainerSpezifikation } from './runtime';

const log = createLogger('gameserver:orchestrator');

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
 * Die Instanz tatsaechlich anlegen.
 *
 * ## Der Ablauf, und warum er diese Reihenfolge hat
 *
 *   1. **Grenzen pruefen** - global, gegen die Datenbank.
 *   2. **Host waehlen** - eine Liste, nicht einen. Zwischen Auswahl und
 *      Reservierung kann jemand schneller sein.
 *   3. **Kapazitaet reservieren** - unter Zeilensperre auf den Host. Erst
 *      hier entsteht die Instanzzeile.
 *   4. **Ports reservieren** - eigener Riegel, eigene Tabelle.
 *   5. **Container erstellen** - der einzige Schritt, der den Host
 *      tatsaechlich anfasst, und der letzte.
 *
 * Alles, was schiefgehen kann, geht vor dem Container schief. Ein
 * gescheiterter Versuch hinterlaesst eine Zeile mit einer Begruendung und
 * gibt seine Ports zurueck - keine Karteileiche auf dem Host.
 *
 * Gibt `false` zurueck, wenn nichts zu tun war oder eine Grenze im Weg
 * stand - beides ist kein Fehler, und beides steht danach als Grund in der
 * Zuordnung.
 */
export async function provisioniere(
  assignmentId: string,
  einstellungen: OrchestratorEinstellungen,
  jetzt = new Date(),
  /**
   * Wie der Host angesprochen wird.
   *
   * Nur fuer Tests gesetzt - und ausdruecklich als **Argument**, nicht als
   * globaler Schalter. Ein Schalter, den ein Test umlegt, bleibt umgelegt,
   * wenn der Test abbricht; ein Argument kann das nicht.
   */
  transport?: AgentTransport,
): Promise<{ ok: boolean; grund?: string }> {
  const zuordnung = await prisma.matchServerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      profile: { include: { runtimeImage: true } },
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
  if (!profil) {
    return merkeFehler(assignmentId, 'PROVISION_FAILED', 'Diesem Match ist kein Game Profile zugeordnet.');
  }

  const abbild = profil.runtimeImage;
  if (!abbild) {
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      `Dem Game Profile «${profil.name}» ist kein Runtime-Image zugeordnet. Ohne Abbild lässt sich kein Container starten.`,
    );
  }
  if (!abbild.enabled) {
    return merkeFehler(assignmentId, 'PROVISION_FAILED', `Das Abbild «${abbild.name}» ist ausgeschaltet.`);
  }

  const adapter = gameAdapter(profil.game);
  if (!adapter) {
    return merkeFehler(assignmentId, 'PROVISION_FAILED', `Für ${profil.game} gibt es keinen Adapter.`);
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

  const name = maschinenname(zuordnung.match.tournamentId, zuordnung.match.matchNumber, zuordnung.generation);

  const rconPasswort = erzeugeRconPasswort();
  const serverPasswort =
    profil.passwordStrategy === 'NONE'
      ? ''
      : profil.passwordStrategy === 'FIXED'
        ? (profil.fixedPassword ?? '')
        : erzeugeServerPasswort();

  let rconVerschluesselt: string;
  try {
    rconVerschluesselt = encryptSecret(rconPasswort, rconAdresse(name));
  } catch {
    /*
     * Die Ausnahme selbst wird nicht weitergereicht: sie nennt den
     * Schluessel und seine Laenge. Was hier steht, reicht zum Beheben.
     */
    return merkeFehler(
      assignmentId,
      'PROVISION_FAILED',
      'Das RCON-Passwort liess sich nicht verschlüsseln - vermutlich fehlt MASTER_ENCRYPTION_KEY.',
    );
  }

  const anforderung: HostAnforderung = {
    game: profil.game,
    cpu: profil.cpuLimit,
    memoryMb: profil.memoryLimitMb,
    bevorzugteGruppeId: profil.preferredGroupId,
    region: profil.region,
    erzwungenerHostId: zuordnung.forcedHostId,
  };

  const auswahl = await waehleHosts(anforderung, jetzt);
  if (auswahl.kandidaten.length === 0) {
    /*
     * Kein passender Host ist **kein** Fehlerzustand, sondern ein Warten -
     * genau wie eine Grenze. Ein Host kann in zehn Minuten wieder frei
     * sein; die Zuordnung soll dann von selbst weiterlaufen und nicht auf
     * jemanden warten, der sie zurueckstellt.
     */
    const grund =
      auswahl.abgelehnt.length === 0
        ? 'Es ist kein Gameserver-Host eingerichtet.'
        : `Kein Host verfügbar: ${auswahl.abgelehnt.map((a) => `${a.hostName} – ${a.grund}`).join(' | ')}`;
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { lastError: grund.slice(0, 2000) },
    });
    return { ok: false, grund };
  }

  const schnappschuss = profilSchnappschuss(profil, abbild);

  /*
   * Die Kandidaten der Reihe nach. Der erste, der die Zeilensperre
   * gewinnt und noch Platz hat, bekommt das Match - wer zwischendurch voll
   * gelaufen ist, wird uebersprungen statt das Match scheitern zu lassen.
   */
  let instanceId: string | null = null;
  let host = null as (typeof auswahl.kandidaten)[number]['host'] | null;
  const absagen: string[] = [];

  for (const kandidat of auswahl.kandidaten) {
    const reserviert = await reserviereAufHost(kandidat.host.id, anforderung, {
      name,
      game: profil.game,
      profileId: profil.id,
      runtimeImageId: abbild.id,
      imageTag: abbild.tag,
      region: profil.region,
      tournamentId: zuordnung.match.tournamentId,
      cpuLimit: profil.cpuLimit,
      memoryLimitMb: profil.memoryLimitMb,
      diskLimitMb: profil.diskLimitMb,
      maxRuntimeMinutes: profil.maxRuntimeMinutes,
      profileSnapshot: schnappschuss,
      rconPasswordEnc: rconVerschluesselt,
      serverPassword: serverPasswort || null,
    });

    if (reserviert.ok) {
      instanceId = reserviert.instanceId;
      host = kandidat.host;
      break;
    }
    absagen.push(`${kandidat.host.name} – ${reserviert.grund}`);
  }

  if (!instanceId || !host) {
    const grund = `Kein Host hat die Reservierung angenommen: ${absagen.join(' | ')}`;
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { lastError: grund.slice(0, 2000) },
    });
    return { ok: false, grund };
  }

  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: { phase: 'PROVISIONING', instanceId, lastError: null },
  });

  const versuch = await prisma.provisioningAttempt.create({
    data: {
      instanceId,
      matchId: zuordnung.matchId,
      generation: zuordnung.generation,
      attempt: zuordnung.generation,
    },
  });

  try {
    const ports = await reservierePorts(host.id, instanceId, host, {
      query: abbild.queryPortInContainer !== null,
      tv: abbild.tvPortInContainer !== null && profil.gotvEnabled,
    });

    const spezifikation = baueSpezifikation({
      instanceId,
      adapter,
      abbild,
      profil,
      ports,
      rconPasswort,
      serverPasswort,
      turnierName: null,
      matchNummer: zuordnung.match.matchNumber,
      schnappschuss,
    });

    await prisma.gameServerInstance.update({
      where: { id: instanceId },
      data: {
        status: 'CREATING',
        gamePort: ports.game,
        queryPort: ports.query,
        tvPort: ports.tv,
        publicHost: host.hostname,
      },
    });

    const token = await hostAgentToken(host.id);
    if (!token) {
      throw new AppError('CONFIGURATION_MISSING', {
        userMessage: `Für den Host «${host.name}» liegt keine lesbare Identität vor. Wurde er registriert?`,
        internalMessage: `Host ${host.id} ohne lesbares Agent-Token`,
      });
    }

    const agent = hostZugriff({ host: host.hostname, port: host.agentPort, token }, transport);
    const erstellt = await agent.instanzErstellen(instanceId, spezifikation);

    await prisma.$transaction([
      prisma.gameServerInstance.update({
        where: { id: instanceId },
        data: { status: 'STARTING', containerRef: erstellt.containerRef, startedAt: new Date() },
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
        instanceId,
        host: host.name,
        game: profil.game,
        image: `${abbild.image}:${abbild.tag}`,
      },
    });

    return { ok: true };
  } catch (fehler) {
    const meldung = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
    log.warn('Bereitstellung fehlgeschlagen', { assignmentId, instanceId, fehler });

    /*
     * **Aufraeumen ist hier Pflicht, nicht Hoeflichkeit.** Eine Instanz,
     * die gescheitert ist und ihre Ports behaelt, frisst den Portbereich
     * des Hosts auf - nach genug Fehlversuchen nimmt er gar nichts mehr an.
     */
    await gibPortsFrei(instanceId).catch(() => 0);

    await prisma.$transaction([
      prisma.gameServerInstance.update({
        where: { id: instanceId },
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
 * Das Game Profile so festhalten, wie es jetzt aussieht.
 *
 * **Der Grund.** Wer ein Profil mitten in einem Turnier aendert, darf ein
 * laufendes Match nicht treffen; und wer hinterher fragt, mit welchen
 * Einstellungen gespielt wurde, soll eine Antwort bekommen statt der
 * heutigen Einstellungen. Der Schnappschuss ist die Antwort.
 */
export function profilSchnappschuss(
  profil: Record<string, unknown>,
  abbild: Record<string, unknown>,
): Prisma.InputJsonValue {
  const nimm = (quelle: Record<string, unknown>, felder: readonly string[]) =>
    Object.fromEntries(felder.filter((feld) => feld in quelle).map((feld) => [feld, quelle[feld]]));

  return {
    erstelltAm: new Date().toISOString(),
    profil: nimm(profil, [
      'id',
      'name',
      'game',
      'mapPool',
      'slots',
      'overtime',
      'knifeRound',
      'tacticalPauses',
      'technicalPauses',
      'gotvEnabled',
      'demoRecording',
      'restoreSupport',
      'warmupSeconds',
      'readyRule',
      'passwordStrategy',
      'serverNameTemplate',
      'defaultBestOf',
      'pauseSeconds',
      'techPauseSeconds',
      'overtimeMaxRounds',
      'overtimeStartMoney',
      'restoreMaxRounds',
      'gotvDelaySeconds',
      'coachSlots',
      'casterSlots',
      'matchPlugin',
      'pluginSettings',
      'tickrate',
      'cpuLimit',
      'memoryLimitMb',
      'diskLimitMb',
      'maxRuntimeMinutes',
      'adapterOptions',
    ]),
    abbild: nimm(abbild, [
      'id',
      'name',
      'image',
      'tag',
      'gamePortInContainer',
      'queryPortInContainer',
      'tvPortInContainer',
    ]),
  } as Prisma.InputJsonValue;
}

/**
 * Die Container-Spezifikation bauen.
 *
 * Kein Spielname in dieser Funktion. Was der Container an Umgebung braucht,
 * liefert der Adapter; was er an Ports und Pfaden bekommt, steht im
 * Runtime-Image; die Geheimnisse setzt der Orchestrator, weil er sie erzeugt.
 */
function baueSpezifikation(eingabe: {
  instanceId: string;
  adapter: ReturnType<typeof gameAdapter> & object;
  abbild: {
    image: string;
    tag: string;
    command: string[];
    env: unknown;
    dataMountPath: string;
    configMountPath: string;
    gamePortInContainer: number;
    queryPortInContainer: number | null;
    tvPortInContainer: number | null;
  };
  profil: {
    game: GameServerGame;
    slots: number;
    tickrate: number;
    gotvEnabled: boolean;
    serverNameTemplate: string;
    cpuLimit: number;
    memoryLimitMb: number;
  };
  ports: ReserviertePorts;
  rconPasswort: string;
  serverPasswort: string;
  turnierName: string | null;
  matchNummer: number;
  schnappschuss: Prisma.InputJsonValue;
}): ContainerSpezifikation {
  const serverName = eingabe.profil.serverNameTemplate
    .replaceAll('{tournament}', eingabe.turnierName ?? 'SwissHub')
    .replaceAll('{match}', String(eingabe.matchNummer))
    .slice(0, 64);

  const vomAdapter = eingabe.adapter.laufzeitUmgebung({
    serverName,
    slots: eingabe.profil.slots,
    tickrate: eingabe.profil.tickrate,
    gamePortImContainer: eingabe.abbild.gamePortInContainer,
    gotvEnabled: eingabe.profil.gotvEnabled,
    profil: eingabe.schnappschuss as Record<string, unknown>,
  });

  const ausAbbild =
    typeof eingabe.abbild.env === 'object' &&
    eingabe.abbild.env !== null &&
    !Array.isArray(eingabe.abbild.env)
      ? Object.fromEntries(
          Object.entries(eingabe.abbild.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : {};

  const ports: ContainerSpezifikation['ports'] = [
    // Der Spielport zweimal: UDP fuer das Spiel, TCP fuer RCON. Ein
    // Spielserver ohne TCP waere ein Server, den niemand fernsteuern kann.
    { container: eingabe.abbild.gamePortInContainer, host: eingabe.ports.game, protokoll: 'udp' },
    { container: eingabe.abbild.gamePortInContainer, host: eingabe.ports.game, protokoll: 'tcp' },
  ];
  if (eingabe.abbild.queryPortInContainer !== null && eingabe.ports.query !== null) {
    ports.push({
      container: eingabe.abbild.queryPortInContainer,
      host: eingabe.ports.query,
      protokoll: 'udp',
    });
  }
  if (eingabe.abbild.tvPortInContainer !== null && eingabe.ports.tv !== null) {
    ports.push({ container: eingabe.abbild.tvPortInContainer, host: eingabe.ports.tv, protokoll: 'udp' });
  }

  return {
    name: containerName(eingabe.profil.game, eingabe.instanceId),
    image: abbildMitTag(eingabe.abbild.image, eingabe.abbild.tag),
    command: eingabe.abbild.command,
    env: {
      ...ausAbbild,
      ...vomAdapter,
      SWISSHUB_RCON_PASSWORD: eingabe.rconPasswort,
      SWISSHUB_SERVER_PASSWORD: eingabe.serverPasswort,
    },
    ports,
    cpuLimit: eingabe.profil.cpuLimit,
    memoryLimitMb: eingabe.profil.memoryLimitMb,
    dataMountPath: eingabe.abbild.dataMountPath,
    configMountPath: eingabe.abbild.configMountPath,
  };
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
 * Den Zugriff auf den Host einer Instanz bauen.
 *
 * Entschluesselt das Token genau hier und gibt es nicht zurueck - der
 * Aufrufer bekommt einen Zugriff, kein Geheimnis.
 */
export async function hostZugriffFuerInstanz(instanceId: string, transport?: AgentTransport) {
  const instanz = await prisma.gameServerInstance.findUnique({
    where: { id: instanceId },
    include: { host: { select: { id: true, name: true, hostname: true, agentPort: true } } },
  });

  if (!instanz?.host) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Instanz gehört zu keinem Host.',
      internalMessage: `Instanz ${instanceId} ohne Host`,
    });
  }

  const token = await hostAgentToken(instanz.host.id);
  if (!token) {
    throw new AppError('CONFIGURATION_MISSING', {
      userMessage: `Für den Host «${instanz.host.name}» liegt keine lesbare Identität vor.`,
      internalMessage: `Host ${instanz.host.id} ohne lesbares Agent-Token`,
    });
  }

  return hostZugriff({ host: instanz.host.hostname, port: instanz.host.agentPort, token }, transport);
}

/**
 * Der `AgentZugriff`, den der Game Adapter auf eine Instanz bekommt.
 *
 * Heisst weiterhin `zugriffAuf` und gibt weiterhin dieselbe Schnittstelle
 * zurueck - der CS2-Adapter musste fuer den Umbau auf Container nicht
 * angefasst werden. Dahinter liegt heute ein Host statt einer Maschine.
 */
export async function zugriffAuf(instanceId: string, transport?: AgentTransport) {
  const agent = await hostZugriffFuerInstanz(instanceId, transport);
  return agent.fuerInstanz(instanceId);
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
  return decryptSecret(instanz.rconPasswordEnc, rconAdresse(instanz.name));
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
export async function raeumeAuf(jetzt = new Date(), transport?: AgentTransport): Promise<AufraeumErgebnis> {
  const faellig = await prisma.gameServerInstance.findMany({
    where: {
      status: { in: [...ABBAUBARE_ZUSTAENDE] },
      deleteAfterAt: { not: null, lte: jetzt },
      heldByDiscordId: null,
    },
    include: {
      host: { select: { id: true, name: true, hostname: true, agentPort: true } },
      assignments: { orderBy: { generation: 'desc' }, take: 1 },
    },
    take: 20,
  });

  let geloescht = 0;
  let uebersprungen = 0;

  for (const instanz of faellig) {
    const zuordnung = instanz.assignments[0];
    if (zuordnung && zuordnung.phase === 'ARCHIVE_ERROR') {
      /*
       * Die Archivierung ist schiefgegangen. Der Container bleibt stehen -
       * lieber eine Instanz zu viel als eine Demo zu wenig. Das Dashboard
       * zeigt sie als «wartet auf Entscheidung».
       */
      uebersprungen += 1;
      continue;
    }

    try {
      await entferneInstanz(instanz.id, instanz.host, { erzwingen: false }, transport);
      await vermerkeEntfernt(instanz.id, jetzt, zuordnung?.id ?? null);
      await safeRecordAudit({
        action: AUDIT_ACTIONS.GAMESERVER_DELETED,
        module: TOURNAMENTS_MODULE_ID,
        actorDiscordId: null,
        actorUsername: null,
        targetLabel: instanz.name,
        success: true,
        metadata: { instanceId: instanz.id, host: instanz.host?.name ?? null, automatisch: true },
      });
      geloescht += 1;
    } catch (fehler) {
      log.warn('Instanz konnte nicht entfernt werden', { instanceId: instanz.id, fehler });
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

/** Zustaende, aus denen ein Abbau ueberhaupt Sinn ergibt. */
export const ABBAUBARE_ZUSTAENDE = [
  'RESERVED',
  'CREATING',
  'STARTING',
  'CONFIGURING',
  'READY',
  'LIVE',
  'STOPPING',
  'STOPPED',
  'ARCHIVING',
  'FAILED',
  // Aus der VM-Welt, solange es sie noch gibt.
  'RUNNING',
  'AGENT_READY',
  'BOOTING',
] as const;

/**
 * Den Container einer Instanz entfernen.
 *
 * **Die Reihenfolge ist die Zusage.** Erst stoppen, dann entfernen, dann die
 * Ports freigeben. Ein Port, der vor dem Container freigegeben wird, kann
 * schon an ein neues Match gehen, waehrend das alte ihn noch haelt - und
 * dann startet der neue Container nicht.
 *
 * Fehlt der Host, wird trotzdem aufgeraeumt: was SwissHub nicht mehr
 * erreichen kann, darf nicht ewig Kapazitaet und Ports binden.
 */
async function entferneInstanz(
  instanceId: string,
  host: { id: string; name: string; hostname: string; agentPort: number } | null,
  optionen: { erzwingen: boolean },
  transport?: AgentTransport,
): Promise<void> {
  if (host) {
    const token = await hostAgentToken(host.id);
    if (token) {
      const agent = hostZugriff({ host: host.hostname, port: host.agentPort, token }, transport);
      // Stoppen darf scheitern - ein Container, der schon steht, meldet das
      // als Fehler, und daran soll das Entfernen nicht haengen.
      await agent.instanzStoppen(instanceId, optionen.erzwingen).catch(() => undefined);
      await agent.instanzLoeschen(instanceId, optionen.erzwingen);
    } else {
      log.warn('Instanz ohne lesbares Host-Token entfernt', { instanceId, hostId: host.id });
    }
  }

  await gibPortsFrei(instanceId);
}

async function vermerkeEntfernt(instanceId: string, jetzt: Date, assignmentId: string | null): Promise<void> {
  await prisma.gameServerInstance.update({
    where: { id: instanceId },
    data: {
      status: 'REMOVED',
      removedAt: jetzt,
      stoppedAt: jetzt,
      containerRef: null,
      // Die Geheimnisse gehen mit dem Container. Ein RCON-Passwort fuer
      // eine Instanz, die es nicht mehr gibt, ist kein Geheimnis mehr -
      // es ist nur noch ein Risiko.
      rconPasswordEnc: null,
      agentTokenEnc: null,
    },
  });

  if (assignmentId) {
    await prisma.matchServerAssignment.update({
      where: { id: assignmentId },
      data: { phase: 'SERVER_REMOVED' },
    });
  }
}

/**
 * Die Zahlen des Infrastruktur-Dashboards.
 *
 * Hosts **und** Instanzen, weil beides zusammen die Frage beantwortet, die
 * jemand vor einem Turnierabend hat: «reicht das?». Eine Zahl ohne die
 * andere reicht dafuer nicht - zwanzig freie Plaetze auf einem Host, der
 * offline ist, sind keine freien Plaetze.
 */
export async function infrastrukturStand(jetzt = new Date()): Promise<{
  hostsGesamt: number;
  hostsOnline: number;
  hostsOffline: number;
  hostsDraining: number;
  hostsWartung: number;
  laufend: number;
  inBereitstellung: number;
  fehlerhaft: number;
  wartetAufEntscheidung: number;
  plaetzeFrei: number;
  cpuReserviert: number;
  memoryReserviertMb: number;
  durchschnittProvisioningSekunden: number | null;
}> {
  const [hosts, laufend, inBereitstellung, fehlerhaft, wartetAufEntscheidung, dauern, summen] =
    await Promise.all([
      prisma.gameServerHost.findMany({
        select: {
          id: true,
          status: true,
          registeredAt: true,
          lastHeartbeatAt: true,
          dockerAvailable: true,
          diskFreeMb: true,
          minFreeDiskGb: true,
          lastError: true,
          maxInstances: true,
        },
      }),
      prisma.gameServerInstance.count({
        where: { status: { in: ['READY', 'LIVE', 'RUNNING', 'AGENT_READY'] } },
      }),
      prisma.gameServerInstance.count({
        where: { status: { in: [...ENTSTEHENDE_ZUSTAENDE] } },
      }),
      prisma.gameServerInstance.count({ where: { status: 'FAILED' } }),
      prisma.matchServerAssignment.count({
        where: { phase: { in: ['ARCHIVE_ERROR', 'RESULT_ERROR', 'MATCH_INTERRUPTED'] } },
      }),
      prisma.provisioningAttempt.aggregate({
        where: { succeeded: true, durationMs: { not: null } },
        _avg: { durationMs: true },
      }),
      prisma.gameServerInstance.aggregate({
        where: { status: { in: [...BELEGENDE_ZUSTAENDE] } },
        _sum: { cpuLimit: true, memoryLimitMb: true },
      }),
    ]);

  const gesund = hosts.filter(
    (host) => host.status === 'ACTIVE' && hostGesundheit(host, jetzt).wert === 'HEALTHY',
  );

  const belegt = await prisma.gameServerInstance.groupBy({
    by: ['hostId'],
    where: { status: { in: [...BELEGENDE_ZUSTAENDE] }, hostId: { not: null } },
    _count: { _all: true },
  });
  const belegtJeHost = new Map(belegt.map((zeile) => [zeile.hostId, zeile._count._all]));

  const schnitt = dauern._avg.durationMs;

  return {
    hostsGesamt: hosts.length,
    hostsOnline: gesund.length,
    hostsOffline: hosts.filter(
      (host) => hostGesundheit(host, jetzt).wert === 'OFFLINE' || host.status === 'DISABLED',
    ).length,
    hostsDraining: hosts.filter((host) => host.status === 'DRAINING').length,
    hostsWartung: hosts.filter((host) => host.status === 'MAINTENANCE').length,
    laufend,
    inBereitstellung,
    fehlerhaft,
    wartetAufEntscheidung,
    // Nur die gesunden Hosts zaehlen: ein freier Platz auf einem Host, der
    // nicht antwortet, ist kein freier Platz.
    plaetzeFrei: gesund.reduce(
      (summe, host) => summe + Math.max(0, host.maxInstances - (belegtJeHost.get(host.id) ?? 0)),
      0,
    ),
    cpuReserviert: summen._sum.cpuLimit ?? 0,
    memoryReserviertMb: summen._sum.memoryLimitMb ?? 0,
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
  /** Auf welchem Host die Instanz laeuft. `null` bei Zeilen aus der VM-Welt. */
  hostName: string | null;
  hostId: string | null;
  /** Der Anbieter, falls die Zeile aus der VM-Welt stammt. */
  providerName: string | null;
  /** Die Kennung beim Anbieter - hilfreich, um in dessen Oberflaeche zu suchen. */
  providerRef: string | null;
  /** Die Kennung des Containers auf dem Host. */
  containerRef: string | null;
  /** Welches Abbild und welcher Tag beim Erstellen benutzt wurden. */
  imageTag: string | null;
  queryPort: number | null;
  tvPort: number | null;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
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
      host: { select: { id: true, name: true } },
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
      hostName: instanz.host?.name ?? null,
      hostId: instanz.host?.id ?? null,
      providerName: instanz.provider?.name ?? null,
      providerRef: instanz.providerRef,
      containerRef: instanz.containerRef,
      imageTag: instanz.imageTag,
      queryPort: instanz.queryPort,
      tvPort: instanz.tvPort,
      cpuLimit: instanz.cpuLimit,
      memoryLimitMb: instanz.memoryLimitMb,
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
 * Eine Instanz sofort entfernen.
 *
 * Auch vor der Schonfrist und auch, wenn die Archivierung noch offen ist -
 * das ist der Unterschied zum Durchgang. Wer diesen Knopf drueckt, hat
 * entschieden; die Oberflaeche fragt vorher nach, und das Protokoll haelt
 * fest, wer.
 */
export async function loescheServerSofort(
  instanceId: string,
  akteur: { discordId: string; username: string },
  transport?: AgentTransport,
): Promise<void> {
  const instanz = await prisma.gameServerInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: {
      host: { select: { id: true, name: true, hostname: true, agentPort: true } },
      assignments: { orderBy: { generation: 'desc' }, take: 1, select: { id: true } },
    },
  });

  // Von Hand heisst mit Nachdruck: wer hier drueckt, will den Container
  // weghaben, auch wenn er sich nicht sauber beenden laesst.
  await entferneInstanz(instanceId, instanz.host, { erzwingen: true }, transport);
  await vermerkeEntfernt(instanceId, new Date(), instanz.assignments[0]?.id ?? null);

  await prisma.gameServerInstance.update({
    where: { id: instanceId },
    data: { heldByDiscordId: null, heldReason: null },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_DELETED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: instanz.name,
    success: true,
    metadata: { instanceId, host: instanz.host?.name ?? null, automatisch: false },
  });
}

/**
 * Eine Instanz neu erstellen.
 *
 * Der Fall aus §28: der Container ist kaputt, das Match aber nicht. Die
 * **Turnier-Match-Kennung bleibt**, die Zuordnung bleibt, das Veto bleibt -
 * es entsteht eine neue Generation mit einem neuen Container.
 *
 * Die Ports werden dabei absichtlich neu gezogen: der alte Container kann
 * sie noch eine Weile halten, und ein neuer Container auf einem belegten
 * Port startet nicht.
 */
export async function erstelleInstanzNeu(
  assignmentId: string,
  einstellungen: OrchestratorEinstellungen,
  akteur: { discordId: string; username: string },
  jetzt = new Date(),
  transport?: AgentTransport,
): Promise<{ ok: boolean; grund?: string }> {
  const zuordnung = await prisma.matchServerAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      instance: {
        include: { host: { select: { id: true, name: true, hostname: true, agentPort: true } } },
      },
      match: { select: { matchNumber: true } },
    },
  });

  if (!zuordnung) {
    return { ok: false, grund: 'Diese Zuordnung gibt es nicht.' };
  }

  if (zuordnung.instance) {
    await entferneInstanz(
      zuordnung.instance.id,
      zuordnung.instance.host,
      { erzwingen: true },
      transport,
    ).catch((fehler: unknown) => {
      // Ein Container, der sich nicht entfernen laesst, darf das
      // Neuerstellen nicht verhindern - er wird als Fehler vermerkt und
      // das Match bekommt trotzdem einen Server.
      log.warn('Alter Container liess sich nicht entfernen', {
        instanceId: zuordnung.instance?.id,
        fehler,
      });
    });
    await vermerkeEntfernt(zuordnung.instance.id, jetzt, null);
  }

  /*
   * **Die Generation wird hochgezaehlt.**
   *
   * Nicht aus Buchhaltung: der Name einer Instanz entsteht aus Turnier,
   * Match und Generation und ist eindeutig. Ohne Hochzaehlen traegt die
   * neue Instanz den Namen der alten - und das Anlegen scheitert an einer
   * Eindeutigkeit, mitten im Neuerstellen. Ein Test hat genau das gefunden.
   *
   * Es ist ausserdem die ehrlichere Zahl: «der zweite Server fuer dieses
   * Match» ist genau das, was hier passiert.
   */
  await prisma.matchServerAssignment.update({
    where: { id: assignmentId },
    data: {
      phase: 'WAITING_FOR_SERVER',
      instanceId: null,
      lastError: null,
      provisionAfterAt: null,
      generation: { increment: 1 },
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.GAMESERVER_INSTANCE_RECREATED,
    module: TOURNAMENTS_MODULE_ID,
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username,
    targetLabel: `Match ${String(zuordnung.match.matchNumber)}`,
    success: true,
    metadata: { assignmentId, alteInstanz: zuordnung.instance?.id ?? null },
  });

  return provisioniere(assignmentId, einstellungen, jetzt, transport);
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
