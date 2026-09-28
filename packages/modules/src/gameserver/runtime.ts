/**
 * Was ein Match-Container ist - und was er nicht sein darf.
 *
 * ## Die Regel dieser Datei
 *
 * Eine Container-Spezifikation entsteht **ausschliesslich** aus einem
 * Runtime-Image und einem Game Profile, beide aus der Datenbank, beide
 * ueber Formulare mit einzelnen Feldern gepflegt. Es gibt kein Feld fuer
 * «zusaetzliche Docker-Argumente», keines fuer eine Kommandozeile als Text
 * und keines fuer einen frei waehlbaren Mount. Wer so ein Feld ergaenzt,
 * baut die Docker-CLI in den Browser - nur mit mehr Schritten.
 *
 * ## Warum hier trotzdem geprueft wird
 *
 * Weil «kommt aus der Datenbank» keine Herkunft ist, auf die man ein
 * `docker run` stuetzt. In die Datenbank kommt, was ein Admin eingetippt
 * hat; ein Admin kann sich vertippen, und eine Berechtigung ist kein
 * Ersatz fuer eine Pruefung. `pruefeSpezifikation` ist deshalb die letzte
 * Instanz vor dem Host - und sie laeuft **auf beiden Seiten**: SwissHub
 * prueft, bevor es sendet, und der Agent prueft, bevor er startet. Beide
 * lesen diese Datei, damit es nur eine Regel gibt.
 */

/** Ein Port, wie der Container ihn nach aussen gibt. */
export interface ContainerPort {
  /** Der Port innerhalb des Containers. */
  container: number;
  /** Der Port auf dem Host. */
  host: number;
  protokoll: 'tcp' | 'udp';
}

/**
 * Alles, was ein Container braucht - und nichts darueber hinaus.
 *
 * Bewusst keine offene Erweiterung: kein `extraArgs`, kein `volumes` mit
 * freien Pfaden, kein `privileged`, kein `network: host`. Was fehlt, fehlt
 * mit Absicht.
 */
export interface ContainerSpezifikation {
  /** Der Containername. Wird vom Agenten auch zum Wiederfinden benutzt. */
  name: string;
  /** Abbild samt Tag, etwa `ghcr.io/example/cs2:2026-09`. */
  image: string;
  /** Das Startkommando als Argumentliste. Leer heisst: das des Abbilds. */
  command: string[];
  env: Record<string, string>;
  ports: ContainerPort[];
  /** Kerne, als Kommazahl - `2.5` sind zweieinhalb. */
  cpuLimit: number;
  memoryLimitMb: number;
  /** Wohin im Container das Datenverzeichnis gehaengt wird. */
  dataMountPath: string;
  /** Wohin im Container das Konfigurationsverzeichnis gehaengt wird. */
  configMountPath: string;
}

export type SpezPruefung = { ok: true } | { ok: false; grund: string };

/** Ein Containername, wie Docker ihn akzeptiert - und nichts sonst. */
const NAME_MUSTER = /^[a-z0-9][a-z0-9_.-]{2,62}$/u;

/**
 * Ein Abbildname mit Tag.
 *
 * Bewusst eng: Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich,
 * Schraegstrich, ein optionaler Port beim Registry-Teil, dann ein Tag. Kein
 * `@sha256:` - ein Digest waere fein, aber die Oberflaeche pflegt Tags, und
 * zwei Schreibweisen sind zwei Pruefungen.
 */
const ABBILD_MUSTER =
  /^[a-z0-9][a-z0-9._-]*(?::\d{1,5})?(?:\/[a-z0-9][a-z0-9._-]*)*:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

/** Eine Umgebungsvariable, wie sie ueblich heisst. */
const ENV_SCHLUESSEL_MUSTER = /^[A-Z][A-Z0-9_]{0,63}$/u;

/**
 * Ein Mountpfad im Container.
 *
 * Absolut, ohne Rueckwaertsschritte und **mindestens zwei Ebenen tief**.
 * Die zweite Ebene ist kein Schoenheitsmass: ein Mount direkt unter der
 * Wurzel legt sich ueber ein Systemverzeichnis des Abbilds - `/etc`,
 * `/usr`, `/var` - und macht aus einem Tippfehler einen Container, der
 * nicht mehr startet oder, schlimmer, mit einem leeren `/etc` startet.
 */
const PFAD_MUSTER = /^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/u;

export const GRENZEN = {
  maxKommandoTeile: 32,
  maxKommandoLaenge: 256,
  maxEnvEintraege: 48,
  maxEnvLaenge: 1024,
  maxPorts: 8,
  maxCpu: 64,
  maxMemoryMb: 262_144,
} as const;

/**
 * Die Pruefung, die vor jedem Containerstart laeuft.
 *
 * Gibt einen Grund im Klartext zurueck statt nur `false`. Wer ein
 * Runtime-Image falsch eingetragen hat, soll erfahren, welches Feld es war -
 * nicht, dass «die Spezifikation ungültig» sei.
 */
export function pruefeSpezifikation(spez: ContainerSpezifikation): SpezPruefung {
  if (!NAME_MUSTER.test(spez.name)) {
    return { ok: false, grund: 'Der Containername enthält unerlaubte Zeichen.' };
  }
  if (!ABBILD_MUSTER.test(spez.image)) {
    return { ok: false, grund: `Das Abbild «${spez.image.slice(0, 80)}» ist kein gültiger Name mit Tag.` };
  }

  if (spez.command.length > GRENZEN.maxKommandoTeile) {
    return { ok: false, grund: 'Das Startkommando hat zu viele Teile.' };
  }
  for (const teil of spez.command) {
    if (typeof teil !== 'string' || teil.length === 0 || teil.length > GRENZEN.maxKommandoLaenge) {
      return { ok: false, grund: 'Ein Teil des Startkommandos ist leer oder zu lang.' };
    }
    if (/[\0\n\r]/u.test(teil)) {
      return { ok: false, grund: 'Ein Teil des Startkommandos enthält Steuerzeichen.' };
    }
  }

  const envEintraege = Object.entries(spez.env);
  if (envEintraege.length > GRENZEN.maxEnvEintraege) {
    return { ok: false, grund: 'Es sind zu viele Umgebungsvariablen gesetzt.' };
  }
  for (const [schluessel, wert] of envEintraege) {
    if (!ENV_SCHLUESSEL_MUSTER.test(schluessel)) {
      return { ok: false, grund: `«${schluessel.slice(0, 40)}» ist kein gültiger Variablenname.` };
    }
    if (typeof wert !== 'string' || wert.length > GRENZEN.maxEnvLaenge) {
      return { ok: false, grund: `Der Wert von ${schluessel} ist zu lang.` };
    }
    if (/[\0\n\r]/u.test(wert)) {
      return { ok: false, grund: `Der Wert von ${schluessel} enthält Steuerzeichen.` };
    }
  }

  if (spez.ports.length === 0) {
    return { ok: false, grund: 'Ohne Port kann niemand auf den Server.' };
  }
  if (spez.ports.length > GRENZEN.maxPorts) {
    return { ok: false, grund: 'Es sind zu viele Ports angegeben.' };
  }
  for (const port of spez.ports) {
    if (!istPort(port.container) || !istPort(port.host)) {
      return { ok: false, grund: 'Ein Port liegt ausserhalb von 1–65535.' };
    }
    if (port.protokoll !== 'tcp' && port.protokoll !== 'udp') {
      return { ok: false, grund: 'Ein Port hat ein unbekanntes Protokoll.' };
    }
  }

  if (!Number.isFinite(spez.cpuLimit) || spez.cpuLimit <= 0 || spez.cpuLimit > GRENZEN.maxCpu) {
    return { ok: false, grund: 'Das CPU-Limit ist unbrauchbar.' };
  }
  if (
    !Number.isInteger(spez.memoryLimitMb) ||
    spez.memoryLimitMb < 256 ||
    spez.memoryLimitMb > GRENZEN.maxMemoryMb
  ) {
    return { ok: false, grund: 'Das Speicherlimit ist unbrauchbar.' };
  }

  for (const [name, pfad] of [
    ['Datenverzeichnis', spez.dataMountPath],
    ['Konfigurationsverzeichnis', spez.configMountPath],
  ] as const) {
    if (!PFAD_MUSTER.test(pfad) || pfad.includes('..')) {
      return {
        ok: false,
        grund: `Das ${name} muss ein absoluter Pfad mit mindestens zwei Ebenen sein, etwa /swisshub/data.`,
      };
    }
  }
  if (spez.dataMountPath === spez.configMountPath) {
    return { ok: false, grund: 'Daten- und Konfigurationsverzeichnis dürfen nicht dasselbe sein.' };
  }

  return { ok: true };
}

function istPort(wert: unknown): boolean {
  return typeof wert === 'number' && Number.isInteger(wert) && wert >= 1 && wert <= 65_535;
}

/**
 * Der Name eines Match-Containers.
 *
 * Aus Spiel und Instanzkennung - damit jemand, der auf dem Host `docker ps`
 * tippt, ohne SwissHub weiss, wozu der Container gehoert. Kleinbuchstaben
 * und Bindestriche, weil Docker nichts anderes mag.
 */
export function containerName(game: string, instanceId: string): string {
  const spiel = game.toLowerCase().replace(/[^a-z0-9]/gu, '');
  const kennung = instanceId.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return `swisshub-${spiel}-${kennung}`.slice(0, 63);
}

/**
 * Ein Abbild samt Tag zusammensetzen.
 *
 * Der Tag wird hier **nicht** aus dem Abbildfeld gelesen: die beiden stehen
 * in getrennten Spalten, damit ein Update den Tag aendern kann, ohne den
 * Abbildnamen anzufassen.
 */
export function abbildMitTag(image: string, tag: string): string {
  return `${image.trim()}:${tag.trim()}`;
}
