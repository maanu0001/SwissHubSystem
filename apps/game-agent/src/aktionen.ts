/**
 * Was der Agent tut - und nichts sonst.
 *
 * ## Die Regel dieser Datei
 *
 * Jede Funktion hier ist eine **feste** Handlung. Keine nimmt eine
 * Zeichenkette entgegen, die irgendwo als Befehl endet. Die RCON-Kommandos
 * sind Konstanten; der einzige veraenderliche Wert im ganzen Modul ist eine
 * Rundenzahl, und die ist eine geprüfte Ganzzahl zwischen 1 und 60.
 *
 * Wer hier eine Funktion ergaenzt, die einen Text weiterreicht, hebt die
 * Zusage des ganzen Entwurfs auf. Ein Test in `tests/unit/gameserver-agent.test.ts`
 * liest diese Datei und faellt, wenn eine Zeichenkette aus einem Argument in
 * ein Kommando geraet.
 */
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AgentUmgebung {
  /** Wo die Spieldateien liegen. */
  gameDir: string;
  /** Wo Demos und Logs landen. */
  dataDir: string;
  rconPasswort: string;
  gamePort: number;
  /** Der Dienst, der den Spielserver haelt. */
  serviceName: string;
}

/**
 * Einen systemd-Dienst schalten.
 *
 * `spawn` mit Argumentliste, nicht `exec` mit einer Zeile: so gibt es keine
 * Shell, die etwas interpretieren koennte. `aktion` und `dienst` sind
 * ausserdem beide nicht frei - siehe die Aufrufer.
 */
function systemctl(aktion: 'start' | 'stop' | 'restart', dienst: string): Promise<void> {
  return new Promise((aufloesen, ablehnen) => {
    const kind = spawn('systemctl', [aktion, dienst], { stdio: 'ignore' });
    kind.on('error', ablehnen);
    kind.on('exit', (code) =>
      code === 0 ? aufloesen() : ablehnen(new Error(`systemctl ${aktion} endete mit ${String(code)}`)),
    );
  });
}

export const gameStart = (umgebung: AgentUmgebung) => systemctl('start', umgebung.serviceName);
export const gameStop = (umgebung: AgentUmgebung) => systemctl('stop', umgebung.serviceName);
export const gameRestart = (umgebung: AgentUmgebung) => systemctl('restart', umgebung.serviceName);

/**
 * Die RCON-Kommandos, die der Agent kennt.
 *
 * Eine feste Liste. `matchRestore` ist das einzige mit einem Platzhalter,
 * und der wird durch eine geprüfte Zahl ersetzt - nicht durch einen Text.
 */
const KOMMANDOS = {
  pause: 'get5_pause',
  unpause: 'get5_unpause',
  loadMatch: 'get5_loadmatch_url',
  status: 'get5_status',
} as const;

/**
 * Ein Kommando ueber RCON schicken.
 *
 * Nimmt **kein** Argument von aussen: `kommando` ist ein Schluessel aus
 * `KOMMANDOS`, nicht der Text selbst. Eine Funktion, die den Text
 * entgegennaehme, waere die freie Konsole, die es nicht geben soll.
 */
async function rcon(umgebung: AgentUmgebung, kommando: keyof typeof KOMMANDOS): Promise<string> {
  return sendeRcon(umgebung, KOMMANDOS[kommando]);
}

/**
 * Wiederherstellen.
 *
 * Die Rundenzahl wird hier ein zweites Mal geprueft. Sie kam schon geprüft
 * an - aber diese Datei ist die letzte Stelle vor dem Spielserver, und eine
 * Pruefung, die an der letzten Stelle steht, gilt auch dann noch, wenn
 * jemand spaeter einen anderen Weg hierher baut.
 */
export async function matchRestore(umgebung: AgentUmgebung, runde: number): Promise<string> {
  if (!Number.isInteger(runde) || runde < 1 || runde > 60) {
    throw new Error('Ungültige Rundenzahl.');
  }
  return sendeRcon(umgebung, `get5_loadbackup backup_round${String(runde)}.cfg`);
}

export const matchPause = (umgebung: AgentUmgebung) => rcon(umgebung, 'pause');
export const matchUnpause = (umgebung: AgentUmgebung) => rcon(umgebung, 'unpause');
export const matchStatus = (umgebung: AgentUmgebung) => rcon(umgebung, 'status');

/**
 * Die Matchkonfiguration anwenden.
 *
 * Sie wird als Datei abgelegt und dem Plugin ueber einen **Dateipfad**
 * bekannt gemacht, den der Agent selbst bildet - nicht ueber einen Pfad aus
 * der Anfrage. Der Inhalt ist JSON und wird als JSON geschrieben; er wird
 * nie in ein Kommando eingesetzt.
 */
export async function matchConfigure(umgebung: AgentUmgebung, konfiguration: unknown): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const pfad = join(umgebung.gameDir, 'cfg', 'swisshub-match.json');
  await writeFile(pfad, JSON.stringify(konfiguration, null, 2), 'utf8');
  await sendeRcon(umgebung, 'get5_loadmatch swisshub-match.json');
}

/**
 * Der eigentliche RCON-Versand.
 *
 * Bewusst als eigene Funktion **ohne** Export: von aussen ist sie nicht
 * erreichbar, und innerhalb dieser Datei rufen sie nur Stellen auf, deren
 * Text eine Konstante oder eine geprüfte Zahl ist.
 */
async function sendeRcon(umgebung: AgentUmgebung, kommando: string): Promise<string> {
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

    verbindung.connect(umgebung.gamePort, '127.0.0.1', () => {
      verbindung.write(rconPaket(3, 3, umgebung.rconPasswort));
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

export interface DateiAngabe {
  kind: 'DEMO' | 'SERVER_LOG' | 'MATCH_DATA';
  name: string;
  sizeBytes: number;
}

/**
 * Was nach dem Match dasteht.
 *
 * Liest **ein** Verzeichnis, nicht einen Pfad aus der Anfrage. Es gibt
 * keinen Endpunkt, der ein Verzeichnis entgegennimmt - sonst waere
 * `/files/demos?dir=/etc` ein gueltiger Aufruf.
 */
export async function dateien(umgebung: AgentUmgebung): Promise<DateiAngabe[]> {
  const eintraege = await readdir(umgebung.dataDir).catch(() => [] as string[]);
  const ergebnis: DateiAngabe[] = [];

  for (const name of eintraege) {
    if (name.includes('/') || name.includes('..')) {
      continue;
    }
    const kind = name.endsWith('.dem')
      ? ('DEMO' as const)
      : name.endsWith('.log')
        ? ('SERVER_LOG' as const)
        : name.endsWith('.json')
          ? ('MATCH_DATA' as const)
          : null;
    if (!kind) {
      continue;
    }
    const angaben = await stat(join(umgebung.dataDir, name)).catch(() => null);
    if (!angaben?.isFile()) {
      continue;
    }
    ergebnis.push({ kind, name, sizeBytes: angaben.size });
  }

  return ergebnis;
}
