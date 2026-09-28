/**
 * Die Container-Laufzeit des Agenten.
 *
 * ## Die Regel dieser Datei
 *
 * `docker` wird ausschliesslich ueber `spawn` mit einer **Argumentliste**
 * aufgerufen. Es gibt keine Zeile, die zusammengesetzt und einer Shell
 * gegeben wird, und keine Funktion, die eine Argumentliste von aussen
 * entgegennimmt. Jedes Argument entsteht hier aus einem Wert, der vorher
 * durch `gameserver.pruefeSpezifikation` gegangen ist.
 *
 * Das ist der Unterschied zwischen einer Laufzeitschicht und einer
 * Docker-CLI im Browser: hier gibt es keinen Weg, `--privileged`,
 * `--network host`, `-v /:/host` oder ein fremdes Abbild unterzubringen,
 * weil keine Stelle existiert, die solche Argumente durchreichen koennte.
 *
 * ## Warum die Mountpfade der Agent bildet
 *
 * Ein Container schreibt Demos und Logs in ein Verzeichnis auf dem Host.
 * **Welches**, entscheidet der Agent aus seinem eigenen Wurzelverzeichnis
 * und der Instanzkennung - nie die Anfrage. Ein Pfad aus einer Anfrage
 * waere `-v /etc:/etc` einen Tippfehler entfernt.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gameserver } from '@swisshub/modules';

export interface DockerUmgebung {
  /** Unter welchem Verzeichnis die Instanzdaten liegen. */
  datenWurzel: string;
  /** Wie der Docker-Befehl heisst. Fuer Tests austauschbar. */
  dockerBefehl: string;
}

export class DockerFehler extends Error {
  constructor(
    message: string,
    readonly ausgabe: string,
  ) {
    super(message);
    this.name = 'DockerFehler';
  }
}

/**
 * Docker aufrufen.
 *
 * `spawn` ohne `shell`, mit Argumentliste. Die einzige Stelle in diesem
 * Repository, die einen Docker-Prozess startet - und sie ist nicht
 * exportiert.
 */
function docker(umgebung: DockerUmgebung, argumente: string[], zeitgrenzeMs = 60_000): Promise<string> {
  return new Promise((aufloesen, ablehnen) => {
    const kind = spawn(umgebung.dockerBefehl, argumente, { stdio: ['ignore', 'pipe', 'pipe'] });

    let aus = '';
    let fehler = '';
    let beendet = false;

    const uhr = setTimeout(() => {
      beendet = true;
      kind.kill('SIGKILL');
      ablehnen(new DockerFehler('Docker hat nicht rechtzeitig geantwortet.', aus + fehler));
    }, zeitgrenzeMs);

    kind.stdout.on('data', (stueck: Buffer) => {
      // Die Ausgabe wird begrenzt: `docker logs` gibt es hier zwar nicht,
      // aber ein Abbild-Download schreibt viel, und der Speicher des
      // Agenten ist knapp bemessen.
      if (aus.length < 256 * 1024) {
        aus += stueck.toString('utf8');
      }
    });
    kind.stderr.on('data', (stueck: Buffer) => {
      if (fehler.length < 64 * 1024) {
        fehler += stueck.toString('utf8');
      }
    });

    kind.on('error', (ursache) => {
      clearTimeout(uhr);
      if (!beendet) {
        ablehnen(new DockerFehler(`Docker liess sich nicht starten: ${ursache.message}`, ''));
      }
    });

    kind.on('close', (code) => {
      clearTimeout(uhr);
      if (beendet) {
        return;
      }
      if (code === 0) {
        aufloesen(aus.trim());
      } else {
        ablehnen(new DockerFehler(`Docker endete mit ${String(code)}.`, (fehler || aus).slice(0, 2000)));
      }
    });
  });
}

/** Laeuft Docker ueberhaupt? */
export async function dockerVerfuegbar(umgebung: DockerUmgebung): Promise<boolean> {
  try {
    await docker(umgebung, ['version', '--format', '{{.Server.Version}}'], 10_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Das Datenverzeichnis einer Instanz auf dem Host.
 *
 * Die Kennung wird hier noch einmal geprueft, obwohl sie schon geprueft
 * ankam. Diese Funktion baut einen Pfad - sie ist die letzte Stelle, an der
 * eine Kennung mit einem Schraegstrich darin Schaden anrichten koennte, und
 * eine Pruefung an der letzten Stelle gilt auch dann noch, wenn jemand
 * spaeter einen anderen Weg hierher baut.
 */
export function instanzVerzeichnis(
  umgebung: DockerUmgebung,
  instanceId: string,
  unter: 'data' | 'config',
): string {
  if (!gameserver.KENNUNG_MUSTER.test(instanceId)) {
    throw new Error('Ungültige Instanzkennung.');
  }
  return join(umgebung.datenWurzel, instanceId, unter);
}

export interface ErstellErgebnis {
  containerRef: string;
}

/**
 * Einen Match-Container erstellen und starten.
 *
 * Die Argumentliste entsteht Zeile fuer Zeile aus geprueften Werten. Wer
 * hier etwas ergaenzt, das aus einer Anfrage stammt, ohne dass es durch
 * `gameserver.pruefeSpezifikation` gegangen ist, hebt die Zusage dieser Datei auf.
 */
export async function erstelleInstanz(
  umgebung: DockerUmgebung,
  instanceId: string,
  spez: gameserver.ContainerSpezifikation,
): Promise<ErstellErgebnis> {
  const geprueft = gameserver.pruefeSpezifikation(spez);
  if (!geprueft.ok) {
    // Doppelt geprueft: SwissHub hat schon geprueft, bevor es gesendet hat.
    // Der Agent verlaesst sich darauf nicht - er ist die Stelle, an der ein
    // Fehler tatsaechlich einen Container erzeugt.
    throw new Error(geprueft.grund);
  }
  if (!gameserver.KENNUNG_MUSTER.test(instanceId)) {
    throw new Error('Ungültige Instanzkennung.');
  }

  const daten = instanzVerzeichnis(umgebung, instanceId, 'data');
  const konfiguration = instanzVerzeichnis(umgebung, instanceId, 'config');
  await mkdir(daten, { recursive: true });
  await mkdir(konfiguration, { recursive: true });

  const argumente: string[] = [
    'run',
    '--detach',
    '--name',
    spez.name,
    // Ein Container, der nach einem Neustart des Hosts von selbst
    // wiederkommt, waere ein Match, das niemand angefordert hat.
    '--restart',
    'no',
    '--cpus',
    spez.cpuLimit.toFixed(2),
    '--memory',
    `${String(spez.memoryLimitMb)}m`,
    // Kein `--privileged`, kein `--network host`, keine zusaetzlichen
    // Faehigkeiten. Ein Spielserver braucht nichts davon.
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--label',
    'swisshub=match',
    '--label',
    `swisshub-instance=${instanceId}`,
    '--volume',
    `${daten}:${spez.dataMountPath}`,
    '--volume',
    `${konfiguration}:${spez.configMountPath}`,
  ];

  for (const port of spez.ports) {
    argumente.push('--publish', `${String(port.host)}:${String(port.container)}/${port.protokoll}`);
  }

  for (const [schluessel, wert] of Object.entries(spez.env)) {
    argumente.push('--env', `${schluessel}=${wert}`);
  }

  argumente.push(spez.image, ...spez.command);

  const kennung = await docker(umgebung, argumente, 180_000);
  return { containerRef: kennung.split('\n')[0]?.trim() ?? '' };
}

export async function starteInstanz(umgebung: DockerUmgebung, name: string): Promise<void> {
  await docker(umgebung, ['start', name]);
}

export async function stoppeInstanz(
  umgebung: DockerUmgebung,
  name: string,
  erzwingen: boolean,
): Promise<void> {
  // `--time` statt `kill`: ein Spielserver darf seine Demo zu Ende
  // schreiben. Erzwungen sind es fuenf Sekunden statt dreissig.
  await docker(umgebung, ['stop', '--time', erzwingen ? '5' : '30', name], 60_000);
}

export async function neustarteInstanz(umgebung: DockerUmgebung, name: string): Promise<void> {
  await docker(umgebung, ['restart', '--time', '30', name], 120_000);
}

export async function entferneInstanz(
  umgebung: DockerUmgebung,
  name: string,
  erzwingen: boolean,
): Promise<void> {
  const argumente = ['rm'];
  if (erzwingen) {
    argumente.push('--force');
  }
  argumente.push(name);
  await docker(umgebung, argumente);
}

export interface ContainerBefund {
  instanceId: string;
  containerRef: string | null;
  running: boolean;
  status: string;
}

/** Was der Host an SwissHub-Containern hat. */
export async function listeInstanzen(umgebung: DockerUmgebung): Promise<ContainerBefund[]> {
  const ausgabe = await docker(umgebung, [
    'ps',
    '--all',
    '--filter',
    'label=swisshub=match',
    '--format',
    '{{.ID}}\t{{.Label "swisshub-instance"}}\t{{.State}}\t{{.Status}}',
  ]);

  return ausgabe
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length > 0)
    .flatMap((zeile): ContainerBefund[] => {
      const [ref, instanceId, zustand, status] = zeile.split('\t');
      if (!instanceId || !gameserver.KENNUNG_MUSTER.test(instanceId)) {
        return [];
      }
      return [
        {
          instanceId,
          containerRef: ref ?? null,
          running: zustand === 'running',
          status: (status ?? zustand ?? 'unbekannt').slice(0, 64),
        },
      ];
    });
}

export async function instanzBefund(
  umgebung: DockerUmgebung,
  instanceId: string,
): Promise<ContainerBefund | null> {
  const alle = await listeInstanzen(umgebung);
  return alle.find((eintrag) => eintrag.instanceId === instanceId) ?? null;
}

export interface AbbildBefund {
  image: string;
  tag: string | null;
  sizeBytes: number | null;
}

export async function listeAbbilder(umgebung: DockerUmgebung): Promise<AbbildBefund[]> {
  const ausgabe = await docker(umgebung, ['image', 'ls', '--format', '{{.Repository}}\t{{.Tag}}\t{{.Size}}']);

  return ausgabe
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length > 0 && !zeile.startsWith('<none>'))
    .flatMap((zeile): AbbildBefund[] => {
      const [repo, tag, groesse] = zeile.split('\t');
      if (!repo) {
        return [];
      }
      return [
        {
          image: repo,
          tag: tag && tag !== '<none>' ? tag : null,
          sizeBytes: leseGroesse(groesse ?? ''),
        },
      ];
    });
}

/** Ein Abbild laden. Der Name kam durch dieselbe Pruefung wie beim Erstellen. */
export async function ladeAbbild(umgebung: DockerUmgebung, abbild: string): Promise<void> {
  await docker(umgebung, ['pull', abbild], 900_000);
}

/**
 * Was eine Instanz hinterlassen hat.
 *
 * Liest **ein** Verzeichnis, das der Agent selbst gebildet hat - nicht
 * einen Pfad aus der Anfrage. Es gibt keinen Endpunkt, der ein Verzeichnis
 * entgegennimmt.
 */
export interface DateiAngabe {
  kind: 'DEMO' | 'SERVER_LOG' | 'MATCH_DATA';
  name: string;
  sizeBytes: number;
}

export async function instanzDateien(umgebung: DockerUmgebung, instanceId: string): Promise<DateiAngabe[]> {
  const verzeichnis = instanzVerzeichnis(umgebung, instanceId, 'data');
  const eintraege = await readdir(verzeichnis).catch(() => [] as string[]);
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
    const angaben = await stat(join(verzeichnis, name)).catch(() => null);
    if (!angaben?.isFile()) {
      continue;
    }
    ergebnis.push({ kind, name, sizeBytes: angaben.size });
  }

  return ergebnis;
}

/**
 * Die Umgebung eines Containers lesen.
 *
 * Damit findet der Agent das RCON-Passwort und den Spielport einer Instanz
 * wieder, ohne sie in einer eigenen Datei zu fuehren - ein Neustart des
 * Agenten verliert damit nichts.
 */
export async function leseContainerUmgebung(
  umgebung: DockerUmgebung,
  name: string,
): Promise<Record<string, string>> {
  const ausgabe = await docker(umgebung, ['inspect', '--format', '{{json .Config.Env}}', name]);
  let roh: unknown;
  try {
    roh = JSON.parse(ausgabe);
  } catch {
    return {};
  }
  if (!Array.isArray(roh)) {
    return {};
  }
  const werte: Record<string, string> = {};
  for (const eintrag of roh) {
    if (typeof eintrag !== 'string') {
      continue;
    }
    const trenner = eintrag.indexOf('=');
    if (trenner > 0) {
      werte[eintrag.slice(0, trenner)] = eintrag.slice(trenner + 1);
    }
  }
  return werte;
}

/** Den auf dem Host veroeffentlichten Port eines Containers lesen. */
export async function leseVeroeffentlichtenPort(
  umgebung: DockerUmgebung,
  name: string,
  containerPort: number,
  protokoll: 'tcp' | 'udp',
): Promise<number | null> {
  const ausgabe = await docker(umgebung, [
    'inspect',
    '--format',
    `{{json (index .NetworkSettings.Ports "${String(containerPort)}/${protokoll}")}}`,
    name,
  ]);
  try {
    const roh = JSON.parse(ausgabe) as Array<{ HostPort?: string }> | null;
    const erster = roh?.[0]?.HostPort;
    const port = erster ? Number.parseInt(erster, 10) : Number.NaN;
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

function leseGroesse(text: string): number | null {
  const treffer = /^([\d.]+)\s*([KMGT]?B)$/iu.exec(text.trim());
  if (!treffer) {
    return null;
  }
  const zahl = Number.parseFloat(treffer[1] ?? '');
  if (!Number.isFinite(zahl)) {
    return null;
  }
  const faktor: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round(zahl * (faktor[(treffer[2] ?? 'B').toUpperCase()] ?? 1));
}
