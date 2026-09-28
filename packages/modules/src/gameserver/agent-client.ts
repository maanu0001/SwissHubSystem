/**
 * Die Seite von SwissHub aus gesehen.
 *
 * Jeder Aufruf geht durch `ruf()`, und `ruf()` kennt nur die Aktionen aus
 * `AGENT_AKTIONEN`. Es gibt keine Funktion, die einen Pfad entgegennimmt -
 * damit kann auch kein spaeterer Aufrufer versehentlich einen bauen.
 *
 * ## Zeitgrenzen
 *
 * Jeder Aufruf hat eine. Ein Agent, der nicht antwortet, darf den Durchgang
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
import type { AdapterDatei, AgentZugriff } from './adapter';

const log = createLogger('gameserver:agent');

/** Wie lange auf eine Antwort gewartet wird. */
const ZEITGRENZE_MS = 10_000;
/** Das Konfigurieren darf laenger dauern - der Server laedt dabei eine Map. */
const ZEITGRENZE_KONFIGURATION_MS = 45_000;

export interface AgentAdresse {
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
  adresse: AgentAdresse,
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
  const grenze = aktion === 'matchConfigure' ? ZEITGRENZE_KONFIGURATION_MS : ZEITGRENZE_MS;
  const uhr = setTimeout(() => abbruch.abort(), grenze);

  try {
    const antwort = await transport(`https://${adresse.host}:${adresse.port}${pfad}`, {
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
      throw new AgentFehler(`Der Server hat die Aktion abgelehnt (${antwort.status}).`, antwort.status);
    }

    return text ? (JSON.parse(text) as unknown) : {};
  } catch (fehler) {
    if (fehler instanceof AgentFehler || fehler instanceof AppError) {
      throw fehler;
    }
    const abgebrochen = fehler instanceof Error && fehler.name === 'AbortError';
    log.warn('Agent nicht erreichbar', { aktion, host: adresse.host, fehler });
    throw new AgentFehler(
      abgebrochen ? 'Der Server hat nicht rechtzeitig geantwortet.' : 'Der Server ist nicht erreichbar.',
      null,
    );
  } finally {
    clearTimeout(uhr);
  }
}

/** Ein `AgentZugriff` fuer eine bestimmte Maschine. */
export function agentZugriff(
  adresse: AgentAdresse,
  transport: AgentTransport = standardTransport,
): AgentZugriff {
  return {
    gameStart: async () => void (await ruf(adresse, 'gameStart', null, transport)),
    gameStop: async () => void (await ruf(adresse, 'gameStop', null, transport)),
    gameRestart: async () => void (await ruf(adresse, 'gameRestart', null, transport)),
    matchConfigure: async (nutzlast) => void (await ruf(adresse, 'matchConfigure', nutzlast, transport)),
    matchPause: async () => void (await ruf(adresse, 'matchPause', null, transport)),
    matchUnpause: async () => void (await ruf(adresse, 'matchUnpause', null, transport)),
    matchRestore: async (runde) => void (await ruf(adresse, 'matchRestore', { round: runde }, transport)),

    matchStatus: async () => (await ruf(adresse, 'matchStatus', null, transport)) as Record<string, unknown>,

    health: async () => {
      const roh = (await ruf(adresse, 'health', null, transport)) as Record<string, unknown>;
      return {
        ok: roh.ok === true,
        gameRunning: roh.gameRunning === true,
        details: roh,
      };
    },

    dateien: async () => {
      const roh = (await ruf(adresse, 'dateien', null, transport)) as { files?: unknown };
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
