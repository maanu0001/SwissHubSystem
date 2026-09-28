import 'server-only';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { gameserver, tournaments } from '@swisshub/modules';
import { GAMESERVER_INTEGRATION_ID, hasSecret } from '@swisshub/secrets';
import type { AuthContext } from '@swisshub/auth';

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
    abschnitte.push({ href: '/turniere/gameserver/server', label: 'Aktive Server' });
  }
  if (can(context, P.gameProfilesManage)) {
    abschnitte.push({ href: '/turniere/gameserver/profile', label: 'Game Profiles' });
  }
  if (can(context, P.templatesManage)) {
    abschnitte.push({ href: '/turniere/gameserver/templates', label: 'Templates' });
  }
  if (can(context, P.infrastructureManage)) {
    abschnitte.push({ href: '/turniere/gameserver/infrastruktur', label: 'Infrastruktur' });
  }
  if (can(context, P.manage)) {
    abschnitte.push({ href: `/modules/${tournaments.TOURNAMENTS_MODULE_ID}`, label: 'Einstellungen' });
  }

  return abschnitte;
}

export interface InfrastrukturAnsicht {
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
  stand: Awaited<ReturnType<typeof gameserver.infrastrukturStand>>;
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

  const [anbieter, stand, zugang] = await Promise.all([
    prisma.gameServerProvider.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { templates: true } } },
    }),
    gameserver.infrastrukturStand(),
    hasSecret(GAMESERVER_INTEGRATION_ID, 'secret'),
  ]);

  return {
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
    stand,
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
export async function ladeMatchRoom(matchId: string, discordId: string): Promise<MatchRoomAnsicht | null> {
  const zuordnung = await prisma.matchServerAssignment.findFirst({
    where: { matchId },
    orderBy: { generation: 'desc' },
    include: {
      instance: {
        select: { publicHost: true, gamePort: true, serverPassword: true, status: true, currentMap: true },
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
