/**
 * Der SwissHub Game Agent.
 *
 * ## Was er ist
 *
 * Ein kleiner HTTP-Dienst, der auf einem **Gameserver-Host** laeuft und
 * genau die Aktionen aus `gameserver.AGENT_AKTIONEN` anbietet. Er erstellt, startet,
 * stoppt und entfernt Match-Container, legt Matchkonfigurationen ab,
 * pausiert, setzt fort, stellt wieder her und sagt, wie es dem Host geht.
 *
 * ## Was er ausdruecklich nicht ist
 *
 * Keine Fernwartung. Es gibt keinen Endpunkt, der einen Befehl entgegennimmt,
 * keinen, der einen Pfad entgegennimmt, keinen, der Docker-Argumente
 * entgegennimmt, und keinen, der eine Datei ausliefert, die nicht im
 * Datenverzeichnis einer Instanz liegt. Wer mehr braucht, braucht SSH - und
 * SSH gehoert nicht in eine WebApp.
 *
 * ## Wie er prueft
 *
 * Mit `gameserver.pruefeAnfrage` aus `@swisshub/modules` - derselben Funktion, gegen die
 * SwissHub signiert. Beide Seiten lesen dieselbe Datei; ein Protokoll, das an
 * zwei Stellen beschrieben ist, ist zwei Protokolle.
 *
 * Gegen Wiedereinspielung merkt er sich die gesehenen Einmalwerte, solange
 * ihr Zeitfenster laeuft. Die Karte bleibt klein: was aelter ist als das
 * Fenster, kann ohnehin nicht mehr gelten.
 *
 * ## Woher sein Token kommt
 *
 * Aus einer einmaligen Registrierung bei SwissHub, nicht aus einer
 * Konfigurationsdatei, die jemand von Hand pflegt. Siehe `registrierung.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { cpus, totalmem } from 'node:os';
/*
 * Ueber die Namensraum-Ausfuhr, nicht flach.
 *
 * `@swisshub/modules` gibt die Gameserver-Teile als `gameserver` heraus -
 * flache Namen gibt es dort nicht. Vorher stand hier ein flacher Import;
 * er lief zur Laufzeit ins Leere und fiel nicht auf, weil der Agent in
 * keiner Typpruefung lag. Er liegt jetzt in einer.
 */
import { gameserver } from '@swisshub/modules';
import {
  abbildLaden,
  abbilder,
  dateien,
  hostStatus,
  instanzErstellen,
  instanzLoeschen,
  instanzNeustart,
  instanzStarten,
  instanzStatus,
  instanzStoppen,
  instanzen,
  matchConfigure,
  matchPause,
  matchRestore,
  matchStatus,
  matchUnpause,
  type AgentUmgebung,
} from './aktionen';
import { dockerVerfuegbar } from './docker';
import { besorgeIdentitaet } from './registrierung';

export const AGENT_VERSION = '2.0.0';

function lies(name: string, vorgabe?: string): string {
  const wert = process.env[name]?.trim();
  if (!wert && vorgabe === undefined) {
    throw new Error(`${name} fehlt - der Agent startet nicht.`);
  }
  return wert || (vorgabe as string);
}

export function umgebung(): AgentUmgebung & { port: number } {
  return {
    port: Number.parseInt(lies('SWISSHUB_AGENT_PORT', '9443'), 10),
    datenWurzel: lies('SWISSHUB_HOST_DATA_ROOT', '/var/lib/swisshub/instances'),
    dockerBefehl: lies('SWISSHUB_DOCKER', 'docker'),
    version: AGENT_VERSION,
  };
}

/** Gesehene Einmalwerte, mit ihrem Zeitstempel. */
const gesehen = new Map<string, number>();

function merkeNonce(wert: string, zeitpunkt: number): void {
  gesehen.set(wert, zeitpunkt);
  if (gesehen.size > 5000) {
    const grenze = Math.floor(Date.now() / 1000) - gameserver.ZEITFENSTER_SEKUNDEN;
    for (const [schluessel, zeit] of gesehen) {
      if (zeit < grenze) {
        gesehen.delete(schluessel);
      }
    }
  }
}

/**
 * Welcher Pfad welche Aktion ist.
 *
 * Aus `gameserver.AGENT_AKTIONEN` abgeleitet statt danebengeschrieben. Eine zweite
 * Liste waere eine zweite Wahrheit - und der Unterschied faellt erst auf,
 * wenn ein Endpunkt ins Leere laeuft.
 */
const AKTION_JE_PFAD = new Map<string, gameserver.AgentAktion>(
  Object.entries(gameserver.AGENT_AKTIONEN).map(([name, eintrag]) => [
    eintrag.pfad,
    name as gameserver.AgentAktion,
  ]),
);

async function leseRumpf(anfrage: IncomingMessage): Promise<string> {
  const teile: Buffer[] = [];
  let groesse = 0;
  for await (const stueck of anfrage) {
    groesse += (stueck as Buffer).length;
    if (groesse > 512 * 1024) {
      // Eine Matchkonfiguration ist wenige Kilobyte gross. Alles darueber
      // ist kein Match, sondern ein Versuch, den Speicher zu fuellen.
      throw new Error('Anfrage zu gross.');
    }
    teile.push(stueck as Buffer);
  }
  return Buffer.concat(teile).toString('utf8');
}

function antworte(antwort: ServerResponse, status: number, inhalt: unknown): void {
  const koerper = JSON.stringify(inhalt);
  antwort.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(koerper),
  });
  antwort.end(koerper);
}

export function baueAgent(konfiguration: AgentUmgebung, token: string) {
  return createServer((anfrage, antwort) => {
    void (async () => {
      const pfad = (anfrage.url ?? '').split('?')[0] ?? '';

      if (!gameserver.ERLAUBTE_PFADE.includes(pfad)) {
        antworte(antwort, 404, { error: 'Unbekannte Aktion.' });
        return;
      }

      let rumpf = '';
      try {
        rumpf = anfrage.method === 'GET' ? '' : await leseRumpf(anfrage);
      } catch {
        antworte(antwort, 400, { error: 'Anfrage nicht lesbar.' });
        return;
      }

      const kopf = (name: string): string | null => {
        const wert = anfrage.headers[name];
        return typeof wert === 'string' ? wert : null;
      };

      const geprueft = gameserver.pruefeAnfrage({
        token,
        methode: anfrage.method ?? 'GET',
        pfad,
        zeitstempel: kopf(gameserver.KOPF_ZEIT),
        einmalwert: kopf(gameserver.KOPF_NONCE),
        signatur: kopf(gameserver.KOPF_SIGNATUR),
        rumpf,
        kennstDuDenNonce: (wert) => gesehen.has(wert),
      });

      if (!geprueft.ok) {
        antworte(antwort, geprueft.status, { error: geprueft.grund });
        return;
      }

      const einmalwert = kopf(gameserver.KOPF_NONCE);
      if (einmalwert) {
        merkeNonce(einmalwert, Math.floor(Date.now() / 1000));
      }

      const aktion = AKTION_JE_PFAD.get(pfad);
      if (!aktion) {
        antworte(antwort, 404, { error: 'Unbekannte Aktion.' });
        return;
      }

      let nutzlast: unknown = {};
      if (rumpf) {
        try {
          nutzlast = JSON.parse(rumpf);
        } catch {
          antworte(antwort, 400, { error: 'Rumpf ist kein JSON.' });
          return;
        }
      }

      const nutzlastGeprueft = gameserver.pruefeNutzlast(aktion, nutzlast);
      if (!nutzlastGeprueft.ok) {
        antworte(antwort, 400, { error: nutzlastGeprueft.grund });
        return;
      }

      try {
        antworte(antwort, 200, await fuehreAus(aktion, konfiguration, nutzlast));
      } catch (fehler) {
        /*
         * Die Fehlermeldung geht an SwissHub, nicht an einen Benutzer.
         * SwissHub protokolliert sie und zeigt der Oberflaeche einen
         * eigenen Text - was hier steht, kann Pfade und Containernamen
         * enthalten.
         */
        antworte(antwort, 500, {
          error: fehler instanceof Error ? fehler.message : 'Unbekannter Fehler',
        });
      }
    })();
  });
}

/** Die Nutzlast, wie sie nach `gameserver.pruefeNutzlast` aussieht. */
interface Nutzlast {
  instanceId?: string;
  spec?: gameserver.ContainerSpezifikation;
  config?: unknown;
  round?: number;
  force?: boolean;
  image?: string;
}

async function fuehreAus(
  aktion: gameserver.AgentAktion,
  konfiguration: AgentUmgebung,
  roh: unknown,
): Promise<unknown> {
  const nutzlast = (roh ?? {}) as Nutzlast;
  // Nach `gameserver.pruefeNutzlast` steht die Kennung bei allen Instanzaktionen fest.
  const kennung = nutzlast.instanceId ?? '';

  switch (aktion) {
    case 'health':
      return {
        ok: true,
        agentVersion: AGENT_VERSION,
        dockerAvailable: await dockerVerfuegbar(konfiguration),
        uptimeSeconds: Math.round(process.uptime()),
      };
    case 'hostStatus':
      return hostStatus(konfiguration);

    case 'imageListe':
      return { images: await abbilder(konfiguration) };
    case 'imagePull':
      await abbildLaden(konfiguration, nutzlast.image as string);
      return { ok: true };

    case 'instanzen':
      return { instances: await instanzen(konfiguration) };
    case 'instanzErstellen':
      return instanzErstellen(konfiguration, kennung, nutzlast.spec as gameserver.ContainerSpezifikation);
    case 'instanzStarten':
      await instanzStarten(konfiguration, kennung);
      return { ok: true };
    case 'instanzStoppen':
      await instanzStoppen(konfiguration, kennung, nutzlast.force === true);
      return { ok: true };
    case 'instanzNeustart':
      await instanzNeustart(konfiguration, kennung);
      return { ok: true };
    case 'instanzLoeschen':
      await instanzLoeschen(konfiguration, kennung, nutzlast.force === true);
      return { ok: true };
    case 'instanzStatus':
      return instanzStatus(konfiguration, kennung);
    case 'dateien':
      return { files: await dateien(konfiguration, kennung) };

    case 'matchConfigure':
      await matchConfigure(konfiguration, kennung, nutzlast.config);
      return { ok: true };
    case 'matchPause':
      await matchPause(konfiguration, kennung);
      return { ok: true };
    case 'matchUnpause':
      await matchUnpause(konfiguration, kennung);
      return { ok: true };
    case 'matchRestore':
      await matchRestore(konfiguration, kennung, nutzlast.round as number);
      return { ok: true };
    case 'matchStatus':
      return { status: await matchStatus(konfiguration, kennung) };
  }
}

/**
 * Der Start.
 *
 * Erst die Identitaet, dann der Dienst. Ein Agent, der ohne Token lauscht,
 * ist ein offener Dienst - deshalb wird gar nicht erst gelauscht, wenn die
 * Registrierung nicht geklappt hat.
 */
export async function starte(): Promise<void> {
  const konfiguration = umgebung();

  const identitaet = await besorgeIdentitaet({
    swisshubUrl: lies('SWISSHUB_URL'),
    tokenDatei: lies('SWISSHUB_AGENT_TOKEN_FILE', '/etc/swisshub/agent-token'),
    registrierungsToken: process.env.SWISSHUB_REGISTRATION_TOKEN?.trim() || null,
    meldung: {
      agentVersion: AGENT_VERSION,
      cpuCores: cpus().length,
      memoryMb: Math.round(totalmem() / 1024 / 1024),
      diskGb: 0,
      dockerAvailable: await dockerVerfuegbar(konfiguration),
    },
  });

  if (!identitaet.ok) {
    process.stderr.write(`${identitaet.grund}\n`);
    process.exitCode = 1;
    return;
  }

  if (identitaet.neu) {
    process.stdout.write(`Registriert als «${identitaet.hostName}».\n`);
  }

  baueAgent(konfiguration, identitaet.token).listen(konfiguration.port, () => {
    process.stdout.write(`SwissHub Game Agent ${AGENT_VERSION} lauscht auf ${String(konfiguration.port)}\n`);
  });
}

// Nur starten, wenn diese Datei der Einstiegspunkt ist - so laesst sie sich
// in einem Test laden, ohne einen Port zu belegen.
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void starte();
}
