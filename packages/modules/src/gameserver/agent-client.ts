/**
 * Die Seite von SwissHub aus gesehen.
 *
 * Jeder Aufruf geht durch `ruf()`, und `ruf()` kennt nur die Aktionen aus
 * `AGENT_AKTIONEN`. Es gibt keine Funktion, die einen Pfad entgegennimmt -
 * damit kann auch kein spaeterer Aufrufer versehentlich einen bauen.
 *
 * ## Was sich mit den Hosts geaendert hat
 *
 * Ein Agent bedient nicht mehr eine Maschine, sondern einen **Host** mit
 * vielen Match-Instanzen. Die Adresse gehoert deshalb dem Host, die
 * Instanzkennung geht im signierten Rumpf mit.
 *
 * `fuerInstanz()` gibt trotzdem genau das zurueck, was der Game Adapter
 * immer schon bekommen hat: einen `AgentZugriff` mit `gameStart`,
 * `matchPause`, `dateien` und den uebrigen. Das ist kein Zufall, sondern
 * der Zweck der Schnittstelle - der CS2-Adapter musste fuer den ganzen
 * Umbau nicht angefasst werden.
 *
 * ## Zeitgrenzen
 *
 * Jeder Aufruf hat eine. Ein Host, der nicht antwortet, darf den Durchgang
 * nicht anhalten: dahinter warten andere Matches, und der Bot hat nur einen
 * Zeitplaner.
 */
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import {
  AGENT_AKTIONEN,
  KOPF_NONCE,
  KOPF_SIGNATUR,
  KOPF_ZEIT,
  nonce,
  pruefeNutzlast,
  signiere,
  type AgentAktion,
} from './agent-protokoll';
import type { ContainerSpezifikation } from './runtime';
import type { AdapterDatei, AgentZugriff } from './adapter';

const log = createLogger('gameserver:agent');

/** Wie lange auf eine Antwort gewartet wird. */
const ZEITGRENZE_MS = 10_000;
/** Das Erstellen und Konfigurieren darf laenger dauern - da laedt ein Spielserver. */
const ZEITGRENZE_LANG_MS = 120_000;
/** Ein Abbild zu laden dauert Minuten, nicht Sekunden. */
const ZEITGRENZE_PULL_MS = 900_000;

const LANGE_AKTIONEN: readonly AgentAktion[] = ['instanzErstellen', 'matchConfigure', 'instanzNeustart'];

export interface HostAdresse {
  host: string;
  port: number;
  token: string;
}

/**
 * Wie der Agent angesprochen wird.
 *
 * Austauschbar, damit Tests keinen HTTP-Server brauchen - und damit der
 * Agent in einem Test nicht erst erreichbar sein muss, um den Orchestrator
 * zu pruefen.
 */
export interface AgentTransport {
  (
    url: string,
    optionen: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
  ): Promise<{ status: number; text(): Promise<string> }>;
}

const standardTransport: AgentTransport = (url, optionen) =>
  fetch(url, optionen as RequestInit) as unknown as ReturnType<AgentTransport>;

export class AgentFehler extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'AgentFehler';
  }
}

async function ruf(
  adresse: HostAdresse,
  aktion: AgentAktion,
  nutzlast: Record<string, unknown> | null,
  transport: AgentTransport,
): Promise<unknown> {
  const { methode, pfad } = AGENT_AKTIONEN[aktion];

  const gepruefte = pruefeNutzlast(aktion, nutzlast ?? {});
  if (!gepruefte.ok) {
    // Vor dem Netzwerk, nicht danach: was hier nicht durchkommt, verlaesst
    // den Prozess nicht.
    throw new AppError('VALIDATION_FAILED', {
      userMessage: gepruefte.grund,
      internalMessage: `Ungültige Nutzlast für ${aktion}`,
    });
  }

  const rumpf = methode === 'GET' ? '' : JSON.stringify(nutzlast ?? {});
  const zeit = Math.floor(Date.now() / 1000);
  const einmalwert = nonce();

  const abbruch = new AbortController();
  const grenze =
    aktion === 'imagePull'
      ? ZEITGRENZE_PULL_MS
      : LANGE_AKTIONEN.includes(aktion)
        ? ZEITGRENZE_LANG_MS
        : ZEITGRENZE_MS;
  const uhr = setTimeout(() => abbruch.abort(), grenze);

  try {
    const antwort = await transport(`https://${adresse.host}:${String(adresse.port)}${pfad}`, {
      method: methode,
      headers: {
        'content-type': 'application/json',
        [KOPF_ZEIT]: String(zeit),
        [KOPF_NONCE]: einmalwert,
        [KOPF_SIGNATUR]: signiere(adresse.token, methode, pfad, zeit, einmalwert, rumpf),
      },
      ...(methode === 'GET' ? {} : { body: rumpf }),
      signal: abbruch.signal,
    });

    const text = await antwort.text();
    if (antwort.status < 200 || antwort.status >= 300) {
      /*
       * Die Antwort des Agenten geht **nicht** unveraendert an den Benutzer.
       * Sie ist die Ausgabe eines fremden Prozesses; was davon sichtbar
       * wird, entscheidet die Oberflaeche, nicht der Agent.
       */
      log.warn('Agent hat abgelehnt', { aktion, status: antwort.status, antwort: text.slice(0, 500) });
      throw new AgentFehler(`Der Host hat die Aktion abgelehnt (${String(antwort.status)}).`, antwort.status);
    }

    return text ? (JSON.parse(text) as unknown) : {};
  } catch (fehler) {
    if (fehler instanceof AgentFehler || fehler instanceof AppError) {
      throw fehler;
    }
    const abgebrochen = fehler instanceof Error && fehler.name === 'AbortError';
    log.warn('Agent nicht erreichbar', { aktion, host: adresse.host, fehler });
    throw new AgentFehler(
      abgebrochen ? 'Der Host hat nicht rechtzeitig geantwortet.' : 'Der Host ist nicht erreichbar.',
      null,
    );
  } finally {
    clearTimeout(uhr);
  }
}

// ---------------------------------------------------------------------------
// Was der Host meldet
// ---------------------------------------------------------------------------

export interface HostStatusMeldung {
  ok: boolean;
  agentVersion: string | null;
  dockerAvailable: boolean;
  cpuPercent: number | null;
  memoryUsedMb: number | null;
  diskFreeMb: number | null;
  uptimeSeconds: number | null;
  runningCount: number | null;
}

export interface InstanzMeldung {
  instanceId: string;
  containerRef: string | null;
  laeuft: boolean;
  status: string;
}

export interface AbbildMeldung {
  image: string;
  tag: string | null;
  sizeBytes: number | null;
}

export interface HostAgent {
  health(): Promise<{ ok: boolean; details: Record<string, unknown> }>;
  hostStatus(): Promise<HostStatusMeldung>;
  images(): Promise<AbbildMeldung[]>;
  imagePull(abbild: string): Promise<void>;
  instanzen(): Promise<InstanzMeldung[]>;
  instanzErstellen(
    instanceId: string,
    spez: ContainerSpezifikation,
  ): Promise<{ containerRef: string | null }>;
  instanzStarten(instanceId: string): Promise<void>;
  instanzStoppen(instanceId: string, erzwingen?: boolean): Promise<void>;
  instanzNeustart(instanceId: string): Promise<void>;
  instanzLoeschen(instanceId: string, erzwingen?: boolean): Promise<void>;
  instanzStatus(instanceId: string): Promise<InstanzMeldung>;
  /** Der Blick, den der Game Adapter auf eine einzelne Instanz hat. */
  fuerInstanz(instanceId: string): AgentZugriff;
}

/** Den Zugriff auf einen Host bauen. */
export function hostZugriff(adresse: HostAdresse, transport: AgentTransport = standardTransport): HostAgent {
  const r = (aktion: AgentAktion, nutzlast: Record<string, unknown> | null = null) =>
    ruf(adresse, aktion, nutzlast, transport);

  return {
    health: async () => {
      const roh = (await r('health')) as Record<string, unknown>;
      return { ok: roh.ok === true, details: roh };
    },

    hostStatus: async () => {
      const roh = (await r('hostStatus')) as Record<string, unknown>;
      return {
        ok: roh.ok === true,
        agentVersion: typeof roh.agentVersion === 'string' ? roh.agentVersion.slice(0, 50) : null,
        dockerAvailable: roh.dockerAvailable === true,
        cpuPercent: zahl(roh.cpuPercent),
        memoryUsedMb: ganzzahl(roh.memoryUsedMb),
        diskFreeMb: ganzzahl(roh.diskFreeMb),
        uptimeSeconds: ganzzahl(roh.uptimeSeconds),
        runningCount: ganzzahl(roh.runningCount),
      };
    },

    images: async () => {
      const roh = (await r('imageListe')) as { images?: unknown };
      if (!Array.isArray(roh.images)) {
        return [];
      }
      return roh.images.flatMap((eintrag): AbbildMeldung[] => {
        const zeile = eintrag as Record<string, unknown>;
        if (typeof zeile.image !== 'string') {
          // Was der Host an Unerwartetem meldet, faellt weg - es wird nicht
          // geraten, was gemeint gewesen sein koennte.
          return [];
        }
        return [
          {
            image: zeile.image.slice(0, 256),
            tag: typeof zeile.tag === 'string' ? zeile.tag.slice(0, 128) : null,
            sizeBytes: ganzzahl(zeile.sizeBytes),
          },
        ];
      });
    },

    imagePull: async (abbild) => void (await r('imagePull', { image: abbild })),

    instanzen: async () => {
      const roh = (await r('instanzen')) as { instances?: unknown };
      return Array.isArray(roh.instances) ? roh.instances.flatMap(leseInstanz) : [];
    },

    instanzErstellen: async (instanceId, spez) => {
      const roh = (await r('instanzErstellen', { instanceId, spec: spez })) as Record<string, unknown>;
      return { containerRef: typeof roh.containerRef === 'string' ? roh.containerRef.slice(0, 128) : null };
    },

    instanzStarten: async (instanceId) => void (await r('instanzStarten', { instanceId })),
    instanzStoppen: async (instanceId, erzwingen = false) =>
      void (await r('instanzStoppen', { instanceId, force: erzwingen })),
    instanzNeustart: async (instanceId) => void (await r('instanzNeustart', { instanceId })),
    instanzLoeschen: async (instanceId, erzwingen = false) =>
      void (await r('instanzLoeschen', { instanceId, force: erzwingen })),

    instanzStatus: async (instanceId) => {
      const roh = (await r('instanzStatus', { instanceId })) as Record<string, unknown>;
      const gelesen = leseInstanz(roh);
      return gelesen[0] ?? { instanceId, containerRef: null, laeuft: false, status: 'unbekannt' };
    },

    fuerInstanz: (instanceId) => instanzZugriff(adresse, instanceId, transport),
  };
}

/**
 * Der `AgentZugriff` fuer eine einzelne Instanz.
 *
 * Genau die Schnittstelle, die der Game Adapter seit jeher bekommt.
 * `gameStart` heisst heute «Container starten» statt «systemd-Dienst
 * starten» - der Adapter merkt davon nichts, und das ist der Punkt.
 */
export function instanzZugriff(
  adresse: HostAdresse,
  instanceId: string,
  transport: AgentTransport = standardTransport,
): AgentZugriff {
  const r = (aktion: AgentAktion, zusatz: Record<string, unknown> = {}) =>
    ruf(adresse, aktion, { instanceId, ...zusatz }, transport);

  return {
    gameStart: async () => void (await r('instanzStarten')),
    gameStop: async () => void (await r('instanzStoppen')),
    gameRestart: async () => void (await r('instanzNeustart')),

    matchConfigure: async (nutzlast) => void (await r('matchConfigure', { config: nutzlast })),
    matchPause: async () => void (await r('matchPause')),
    matchUnpause: async () => void (await r('matchUnpause')),
    matchRestore: async (runde) => void (await r('matchRestore', { round: runde })),

    matchStatus: async () => (await r('matchStatus')) as Record<string, unknown>,

    health: async () => {
      const roh = (await r('instanzStatus')) as Record<string, unknown>;
      return {
        ok: roh.ok === true || roh.laeuft === true || roh.running === true,
        gameRunning: roh.gameRunning === true || roh.running === true,
        details: roh,
      };
    },

    dateien: async () => {
      const roh = (await r('dateien')) as { files?: unknown };
      if (!Array.isArray(roh.files)) {
        return [];
      }
      return roh.files.flatMap((eintrag): AdapterDatei[] => {
        const datei = eintrag as Record<string, unknown>;
        const kind = datei.kind;
        const name = datei.name;
        const size = datei.sizeBytes;
        if (
          (kind !== 'DEMO' && kind !== 'SERVER_LOG' && kind !== 'MATCH_DATA') ||
          typeof name !== 'string' ||
          typeof size !== 'number'
        ) {
          // Was der Agent an Unerwartetem meldet, faellt weg - es wird nicht
          // geraten, was gemeint gewesen sein koennte.
          return [];
        }
        return [
          {
            kind,
            // Nur der Dateiname, nie ein Pfad: `../../etc/passwd` waere
            // sonst ein gueltiger «Name» aus einer fremden Antwort.
            name: name.split('/').pop()?.slice(0, 200) ?? '',
            sizeBytes: Math.max(0, Math.trunc(size)),
            ...(typeof datei.mapIndex === 'number' ? { mapIndex: Math.trunc(datei.mapIndex) } : {}),
          },
        ];
      });
    },
  };
}

function leseInstanz(eintrag: unknown): InstanzMeldung[] {
  const zeile = eintrag as Record<string, unknown>;
  if (typeof zeile.instanceId !== 'string') {
    return [];
  }
  return [
    {
      instanceId: zeile.instanceId.slice(0, 64),
      containerRef: typeof zeile.containerRef === 'string' ? zeile.containerRef.slice(0, 128) : null,
      laeuft: zeile.running === true || zeile.laeuft === true,
      status: typeof zeile.status === 'string' ? zeile.status.slice(0, 64) : 'unbekannt',
    },
  ];
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
}

function ganzzahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? Math.trunc(wert) : null;
}
