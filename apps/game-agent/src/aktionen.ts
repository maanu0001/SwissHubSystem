/**
 * Was der Agent tut - und nichts sonst.
 *
 * ## Die Regel dieser Datei
 *
 * Jede Funktion hier ist eine **feste** Handlung. Keine nimmt eine
 * Zeichenkette entgegen, die irgendwo als Befehl endet. Die RCON-Kommandos
 * sind Konstanten; die einzigen veraenderlichen Werte im ganzen Modul sind
 * eine Instanzkennung im Kennungsformat und eine Rundenzahl zwischen 1 und
 * 60.
 *
 * Wer hier eine Funktion ergaenzt, die einen Text weiterreicht, hebt die
 * Zusage des ganzen Entwurfs auf. Ein Test in
 * `tests/unit/gameserver-agent.test.ts` liest diese Datei und faellt, wenn
 * eine Zeichenkette aus einem Argument in ein Kommando geraet.
 *
 * ## Was sich mit den Hosts geaendert hat
 *
 * Der Agent bedient nicht mehr einen Spielserver, sondern einen Host mit
 * vielen. Jede Match-Aktion bekommt deshalb eine Instanzkennung, und wohin
 * RCON geht, ergibt sich aus dem Container dieser Instanz - nicht aus einer
 * Umgebungsvariable des Agenten.
 */
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import {
  dockerVerfuegbar,
  entferneInstanz,
  erstelleInstanz,
  instanzBefund,
  instanzDateien,
  instanzVerzeichnis,
  leseContainerUmgebung,
  leseVeroeffentlichtenPort,
  listeAbbilder,
  listeInstanzen,
  ladeAbbild,
  neustarteInstanz,
  starteInstanz,
  stoppeInstanz,
  type DockerUmgebung,
} from './docker';
import type { gameserver } from '@swisshub/modules';

export interface AgentUmgebung extends DockerUmgebung {
  /** Die Version, die der Agent meldet. */
  version: string;
}

/** Der Name der Umgebungsvariable, in der das RCON-Passwort einer Instanz steht. */
export const RCON_VARIABLE = 'SWISSHUB_RCON_PASSWORD';
/** Der Port, auf dem der Spielserver im Container lauscht. */
export const GAME_PORT_VARIABLE = 'SWISSHUB_GAME_PORT';

// ---------------------------------------------------------------------------
// Der Host
// ---------------------------------------------------------------------------

export interface HostStatus {
  ok: boolean;
  agentVersion: string;
  dockerAvailable: boolean;
  cpuPercent: number | null;
  memoryUsedMb: number;
  diskFreeMb: number | null;
  uptimeSeconds: number;
  runningCount: number;
}

export async function hostStatus(umgebung: AgentUmgebung): Promise<HostStatus> {
  const docker = await dockerVerfuegbar(umgebung);
  const instanzen = docker ? await listeInstanzen(umgebung).catch(() => []) : [];

  return {
    ok: true,
    agentVersion: umgebung.version,
    dockerAvailable: docker,
    cpuPercent: auslastung(),
    memoryUsedMb: Math.round((totalmem() - freemem()) / 1024 / 1024),
    diskFreeMb: await freierSpeicherMb(umgebung.datenWurzel),
    uptimeSeconds: Math.round(uptime()),
    runningCount: instanzen.filter((eintrag) => eintrag.running).length,
  };
}

/**
 * Die Auslastung als Anteil der letzten Minute.
 *
 * `loadavg` durch die Kernzahl - grob, aber ohne zweite Messung und ohne
 * Fremdbibliothek. Der Wert dient der Anzeige und der Einstufung
 * «beansprucht», nicht einer Abrechnung.
 */
function auslastung(): number | null {
  const kerne = cpus().length;
  if (kerne === 0) {
    return null;
  }
  // `loadavg` gibt es nur auf Unix; auf Windows meldet Node Nullen. Eine
  // Null ist dann kein Messwert, sondern eine fehlende Messung - und wird
  // als solche gemeldet statt als «nicht ausgelastet».
  const [eineMinute] = loadavg();
  if (typeof eineMinute !== 'number' || eineMinute === 0) {
    return null;
  }
  return Math.min(100, Math.round((eineMinute / kerne) * 100));
}

async function freierSpeicherMb(pfad: string): Promise<number | null> {
  try {
    const angaben = await statfs(pfad);
    return Math.round((Number(angaben.bavail) * Number(angaben.bsize)) / 1024 / 1024);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Abbilder
// ---------------------------------------------------------------------------

export const abbilder = (umgebung: AgentUmgebung) => listeAbbilder(umgebung);
export const abbildLaden = (umgebung: AgentUmgebung, abbild: string) => ladeAbbild(umgebung, abbild);

// ---------------------------------------------------------------------------
// Instanzen
// ---------------------------------------------------------------------------

export const instanzen = (umgebung: AgentUmgebung) => listeInstanzen(umgebung);

export async function instanzErstellen(
  umgebung: AgentUmgebung,
  instanceId: string,
  spez: gameserver.ContainerSpezifikation,
): Promise<{ containerRef: string }> {
  return erstelleInstanz(umgebung, instanceId, spez);
}

/**
 * Den Containernamen einer Instanz bestimmen.
 *
 * Aus der Liste, nicht geraten: der Name entstand beim Erstellen aus Spiel
 * und Kennung, und welches Spiel es war, weiss der Agent nur aus dem
 * Etikett am Container.
 */
async function containerZu(umgebung: AgentUmgebung, instanceId: string): Promise<string> {
  const befund = await instanzBefund(umgebung, instanceId);
  if (!befund?.containerRef) {
    throw new Error('Diese Instanz gibt es auf diesem Host nicht.');
  }
  return befund.containerRef;
}

export async function instanzStarten(umgebung: AgentUmgebung, instanceId: string): Promise<void> {
  await starteInstanz(umgebung, await containerZu(umgebung, instanceId));
}

export async function instanzStoppen(
  umgebung: AgentUmgebung,
  instanceId: string,
  erzwingen: boolean,
): Promise<void> {
  await stoppeInstanz(umgebung, await containerZu(umgebung, instanceId), erzwingen);
}

export async function instanzNeustart(umgebung: AgentUmgebung, instanceId: string): Promise<void> {
  await neustarteInstanz(umgebung, await containerZu(umgebung, instanceId));
}

export async function instanzLoeschen(
  umgebung: AgentUmgebung,
  instanceId: string,
  erzwingen: boolean,
): Promise<void> {
  const befund = await instanzBefund(umgebung, instanceId);
  if (!befund?.containerRef) {
    // Schon weg. Kein Fehler - ein zweiter Loeschauftrag nach einem Retry
    // soll nichts tun und nicht scheitern.
    return;
  }
  await entferneInstanz(umgebung, befund.containerRef, erzwingen);
}

export async function instanzStatus(umgebung: AgentUmgebung, instanceId: string) {
  const befund = await instanzBefund(umgebung, instanceId);
  return {
    instanceId,
    containerRef: befund?.containerRef ?? null,
    running: befund?.running ?? false,
    status: befund?.status ?? 'nicht vorhanden',
  };
}

export const dateien = (umgebung: AgentUmgebung, instanceId: string) => instanzDateien(umgebung, instanceId);

// ---------------------------------------------------------------------------
// Das Match in einer Instanz
// ---------------------------------------------------------------------------

/**
 * Die RCON-Kommandos, die der Agent kennt.
 *
 * Eine feste Liste. `matchRestore` ist das einzige mit einem Platzhalter,
 * und der wird durch eine geprüfte Zahl ersetzt - nicht durch einen Text.
 */
const KOMMANDOS = {
  pause: 'get5_pause',
  unpause: 'get5_unpause',
  status: 'get5_status',
} as const;

interface RconZiel {
  port: number;
  passwort: string;
}

/**
 * Wohin RCON fuer diese Instanz geht.
 *
 * Aus dem Container selbst gelesen. Der Agent fuehrt bewusst **keine**
 * eigene Tabelle: ein Neustart des Agenten wuerde sie verlieren, und eine
 * Datei daneben waere ein zweiter Ort, an dem RCON-Passwoerter liegen.
 */
async function rconZiel(umgebung: AgentUmgebung, instanceId: string): Promise<RconZiel> {
  const name = await containerZu(umgebung, instanceId);
  const variablen = await leseContainerUmgebung(umgebung, name);

  const passwort = variablen[RCON_VARIABLE];
  if (!passwort) {
    throw new Error('Dieser Instanz fehlt ein RCON-Passwort.');
  }

  const imContainer = Number.parseInt(variablen[GAME_PORT_VARIABLE] ?? '27015', 10);
  const port = await leseVeroeffentlichtenPort(
    umgebung,
    name,
    Number.isInteger(imContainer) ? imContainer : 27015,
    'tcp',
  );
  if (port === null) {
    throw new Error('Für diese Instanz ist kein Spielport veröffentlicht.');
  }

  return { port, passwort };
}

async function rcon(
  umgebung: AgentUmgebung,
  instanceId: string,
  kommando: keyof typeof KOMMANDOS,
): Promise<string> {
  const ziel = await rconZiel(umgebung, instanceId);
  return sendeRcon(ziel, KOMMANDOS[kommando]);
}

export const matchPause = (umgebung: AgentUmgebung, instanceId: string) =>
  rcon(umgebung, instanceId, 'pause');
export const matchUnpause = (umgebung: AgentUmgebung, instanceId: string) =>
  rcon(umgebung, instanceId, 'unpause');
export const matchStatus = (umgebung: AgentUmgebung, instanceId: string) =>
  rcon(umgebung, instanceId, 'status');

/**
 * Wiederherstellen.
 *
 * Die Rundenzahl wird hier ein zweites Mal geprueft. Sie kam schon geprüft
 * an - aber diese Datei ist die letzte Stelle vor dem Spielserver, und eine
 * Pruefung, die an der letzten Stelle steht, gilt auch dann noch, wenn
 * jemand spaeter einen anderen Weg hierher baut.
 */
export async function matchRestore(
  umgebung: AgentUmgebung,
  instanceId: string,
  runde: number,
): Promise<string> {
  if (!Number.isInteger(runde) || runde < 1 || runde > 60) {
    throw new Error('Ungültige Rundenzahl.');
  }
  const ziel = await rconZiel(umgebung, instanceId);
  return sendeRcon(ziel, `get5_loadbackup backup_round${String(runde)}.cfg`);
}

/**
 * Die Matchkonfiguration anwenden.
 *
 * Sie wird als Datei in das Konfigurationsverzeichnis **dieser** Instanz
 * gelegt - einen Pfad, den der Agent selbst bildet - und dem Plugin ueber
 * einen festen Dateinamen bekannt gemacht. Der Inhalt ist JSON und wird als
 * JSON geschrieben; er wird nie in ein Kommando eingesetzt.
 */
export async function matchConfigure(
  umgebung: AgentUmgebung,
  instanceId: string,
  konfiguration: unknown,
): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const verzeichnis = instanzVerzeichnis(umgebung, instanceId, 'config');
  await mkdir(verzeichnis, { recursive: true });
  await writeFile(join(verzeichnis, 'swisshub-match.json'), JSON.stringify(konfiguration, null, 2), 'utf8');

  const ziel = await rconZiel(umgebung, instanceId);
  await sendeRcon(ziel, 'get5_loadmatch swisshub-match.json');
}

/**
 * Der eigentliche RCON-Versand.
 *
 * Bewusst als eigene Funktion **ohne** Export: von aussen ist sie nicht
 * erreichbar, und innerhalb dieser Datei rufen sie nur Stellen auf, deren
 * Text eine Konstante oder eine geprüfte Zahl ist.
 */
async function sendeRcon(ziel: RconZiel, kommando: string): Promise<string> {
  const { Socket } = await import('node:net');

  return new Promise((aufloesen, ablehnen) => {
    const verbindung = new Socket();
    let antwort = '';

    const aufgeben = (grund: string) => {
      verbindung.destroy();
      ablehnen(new Error(grund));
    };

    verbindung.setTimeout(5000, () => aufgeben('RCON hat nicht geantwortet.'));
    verbindung.on('error', (fehler) => aufgeben(fehler.message));
    verbindung.on('data', (daten) => {
      antwort += daten.toString('utf8');
    });
    verbindung.on('close', () => aufloesen(antwort));

    verbindung.connect(ziel.port, '127.0.0.1', () => {
      verbindung.write(rconPaket(3, 3, ziel.passwort));
      verbindung.write(rconPaket(4, 2, kommando));
      // Ein zweites, leeres Paket als Endmarke - so weiss der Agent, wann
      // die Antwort vollstaendig ist, ohne auf einen Timeout zu warten.
      verbindung.write(rconPaket(5, 2, ''));
      setTimeout(() => verbindung.end(), 500);
    });
  });
}

/** Ein RCON-Paket nach dem Source-Protokoll. */
function rconPaket(id: number, typ: number, nutzlast: string): Buffer {
  const koerper = Buffer.from(nutzlast, 'utf8');
  const puffer = Buffer.alloc(14 + koerper.length);
  puffer.writeInt32LE(10 + koerper.length, 0);
  puffer.writeInt32LE(id, 4);
  puffer.writeInt32LE(typ, 8);
  koerper.copy(puffer, 12);
  return puffer;
}

export type { DateiAngabe } from './docker';
