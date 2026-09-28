/**
 * Der SwissHub Game Agent.
 *
 * ## Was er ist
 *
 * Ein kleiner HTTP-Dienst, der auf einem Gameserver laeuft und genau die
 * Aktionen aus `AGENT_AKTIONEN` anbietet. Er startet und stoppt den
 * Spielserver, legt eine Matchkonfiguration ab, pausiert, setzt fort,
 * stellt wieder her und sagt, wie es ihm geht.
 *
 * ## Was er ausdruecklich nicht ist
 *
 * Keine Fernwartung. Es gibt keinen Endpunkt, der einen Befehl entgegennimmt,
 * keinen, der einen Pfad entgegennimmt, und keinen, der eine Datei ausliefert,
 * die nicht in seinem Datenverzeichnis liegt. Wer mehr braucht, braucht SSH -
 * und SSH gehoert nicht in eine WebApp.
 *
 * ## Wie er prueft
 *
 * Mit `pruefeAnfrage` aus `@swisshub/modules` - derselben Funktion, gegen die
 * SwissHub signiert. Beide Seiten lesen dieselbe Datei; ein Protokoll, das an
 * zwei Stellen beschrieben ist, ist zwei Protokolle.
 *
 * Gegen Wiedereinspielung merkt er sich die gesehenen Einmalwerte, solange
 * ihr Zeitfenster laeuft. Die Karte bleibt klein: was aelter ist als das
 * Fenster, kann ohnehin nicht mehr gelten.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ERLAUBTE_PFADE,
  KOPF_NONCE,
  KOPF_SIGNATUR,
  KOPF_ZEIT,
  ZEITFENSTER_SEKUNDEN,
  pruefeAnfrage,
  pruefeNutzlast,
  type AgentAktion,
} from '@swisshub/modules';
import {
  dateien,
  gameRestart,
  gameStart,
  gameStop,
  matchConfigure,
  matchPause,
  matchRestore,
  matchStatus,
  matchUnpause,
  type AgentUmgebung,
} from './aktionen';

function umgebung(): AgentUmgebung & { token: string; port: number } {
  const lies = (name: string, vorgabe?: string): string => {
    const wert = process.env[name]?.trim();
    if (!wert && vorgabe === undefined) {
      // Ohne Token startet der Agent nicht. Ein Agent ohne Token waere ein
      // offener Dienst auf einer Maschine mit einer oeffentlichen Adresse.
      throw new Error(`${name} fehlt - der Agent startet nicht.`);
    }
    return wert || (vorgabe as string);
  };

  return {
    token: lies('SWISSHUB_AGENT_TOKEN'),
    port: Number.parseInt(lies('SWISSHUB_AGENT_PORT', '9443'), 10),
    gameDir: lies('SWISSHUB_GAME_DIR', '/opt/cs2/game/csgo'),
    dataDir: lies('SWISSHUB_DATA_DIR', '/opt/cs2/data'),
    rconPasswort: lies('SWISSHUB_RCON_PASSWORD'),
    gamePort: Number.parseInt(lies('SWISSHUB_GAME_PORT', '27015'), 10),
    serviceName: lies('SWISSHUB_GAME_SERVICE', 'cs2-server'),
  };
}

/** Gesehene Einmalwerte, mit ihrem Zeitstempel. */
const gesehen = new Map<string, number>();

function merkeNonce(wert: string, zeitpunkt: number): void {
  gesehen.set(wert, zeitpunkt);
  if (gesehen.size > 5000) {
    const grenze = Math.floor(Date.now() / 1000) - ZEITFENSTER_SEKUNDEN;
    for (const [schluessel, zeit] of gesehen) {
      if (zeit < grenze) {
        gesehen.delete(schluessel);
      }
    }
  }
}

const AKTION_JE_PFAD: Record<string, AgentAktion> = {
  '/health': 'health',
  '/match/status': 'matchStatus',
  '/files/demos': 'dateien',
  '/game/start': 'gameStart',
  '/game/stop': 'gameStop',
  '/game/restart': 'gameRestart',
  '/match/configure': 'matchConfigure',
  '/match/pause': 'matchPause',
  '/match/unpause': 'matchUnpause',
  '/match/restore': 'matchRestore',
};

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

export function baueAgent(konfiguration = umgebung()) {
  return createServer((anfrage, antwort) => {
    void (async () => {
      const pfad = (anfrage.url ?? '').split('?')[0] ?? '';

      if (!ERLAUBTE_PFADE.includes(pfad)) {
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

      const geprueft = pruefeAnfrage({
        token: konfiguration.token,
        methode: anfrage.method ?? 'GET',
        pfad,
        zeitstempel: kopf(KOPF_ZEIT),
        einmalwert: kopf(KOPF_NONCE),
        signatur: kopf(KOPF_SIGNATUR),
        rumpf,
        kennstDuDenNonce: (wert) => gesehen.has(wert),
      });

      if (!geprueft.ok) {
        antworte(antwort, geprueft.status, { error: geprueft.grund });
        return;
      }

      const einmalwert = kopf(KOPF_NONCE);
      if (einmalwert) {
        merkeNonce(einmalwert, Math.floor(Date.now() / 1000));
      }

      const aktion = AKTION_JE_PFAD[pfad];
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

      const nutzlastGeprueft = pruefeNutzlast(aktion, nutzlast);
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
         * eigenen Text - was hier steht, kann Pfade und Dienstnamen
         * enthalten.
         */
        antworte(antwort, 500, {
          error: fehler instanceof Error ? fehler.message : 'Unbekannter Fehler',
        });
      }
    })();
  });
}

async function fuehreAus(
  aktion: AgentAktion,
  konfiguration: AgentUmgebung,
  nutzlast: unknown,
): Promise<unknown> {
  switch (aktion) {
    case 'health': {
      const status = await matchStatus(konfiguration).catch(() => null);
      return {
        ok: true,
        gameRunning: status !== null,
        uptimeSeconds: Math.round(process.uptime()),
      };
    }
    case 'matchStatus':
      return { status: await matchStatus(konfiguration) };
    case 'dateien':
      return { files: await dateien(konfiguration) };
    case 'gameStart':
      await gameStart(konfiguration);
      return { ok: true };
    case 'gameStop':
      await gameStop(konfiguration);
      return { ok: true };
    case 'gameRestart':
      await gameRestart(konfiguration);
      return { ok: true };
    case 'matchConfigure':
      await matchConfigure(konfiguration, nutzlast);
      return { ok: true };
    case 'matchPause':
      await matchPause(konfiguration);
      return { ok: true };
    case 'matchUnpause':
      await matchUnpause(konfiguration);
      return { ok: true };
    case 'matchRestore':
      await matchRestore(konfiguration, (nutzlast as { round: number }).round);
      return { ok: true };
  }
}

// Nur starten, wenn diese Datei der Einstiegspunkt ist - so laesst sie sich
// in einem Test laden, ohne einen Port zu belegen.
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const konfiguration = umgebung();
  baueAgent(konfiguration).listen(konfiguration.port, () => {
    process.stdout.write(`SwissHub Game Agent lauscht auf ${String(konfiguration.port)}\n`);
  });
}
