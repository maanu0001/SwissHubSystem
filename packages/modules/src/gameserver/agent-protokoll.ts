/**
 * Wie SwissHub mit einem Gameserver spricht.
 *
 * ## Die wichtigste Eigenschaft: es gibt kein `executeCommand`
 *
 * Der Agent kennt genau die Aktionen, die unten aufgezaehlt sind. Es gibt
 * keinen Endpunkt, der eine Zeichenkette entgegennimmt und sie einer Shell
 * gibt - weder mit noch ohne Pruefung. Das ist kein Vorsichtsmass, das sich
 * spaeter lockern liesse, sondern der Entwurf: haette der Agent eine Shell,
 * waere jede Berechtigung in der WebApp nur noch eine Bitte.
 *
 * Ein Test liest diese Datei und den Referenz-Agenten und faellt, wenn ein
 * Endpunkt hinzukommt, der nicht in `AGENT_AKTIONEN` steht.
 *
 * ## Wie sich SwissHub ausweist
 *
 * Nicht mit einem gemeinsamen Passwort fuer alle Maschinen. Jede Maschine
 * bekommt beim Provisionieren ein eigenes, zufaellig erzeugtes Token, das
 * verschluesselt in `GameServerInstance.agentTokenEnc` liegt und mit der
 * Maschine verschwindet. Ein Token, das irgendwo herausfaellt, oeffnet
 * genau eine Maschine, und die gibt es in einer Stunde nicht mehr.
 *
 * Unterschrieben wird nicht der Token selbst, sondern die Anfrage:
 *
 *     signatur = HMAC-SHA256(token, methode + "\n" + pfad + "\n" + zeit + "\n" + nonce + "\n" + sha256(rumpf))
 *
 * Damit nuetzt ein mitgelesener Aufruf niemandem: er gilt fuer genau diesen
 * Pfad, diesen Rumpf und dieses Zeitfenster. Der Agent weist alles zurueck,
 * was aelter ist als `ZEITFENSTER_SEKUNDEN` oder dessen Nonce er schon
 * gesehen hat.
 *
 * ## Warum die Kennung im Rumpf steht und nicht im Pfad
 *
 * Seit ein Agent nicht mehr eine Maschine, sondern einen **Host** mit vielen
 * Match-Instanzen bedient, braucht fast jede Aktion eine Instanzkennung.
 * Der naheliegende Weg waere `/instances/<id>/match/pause` gewesen - und er
 * haette die wichtigste Eigenschaft dieses Protokolls aufgegeben.
 *
 * Die Pfadpruefung ist ein **exakter** Vergleich gegen `ERLAUBTE_PFADE`:
 * was nicht in der Liste steht, ist 404, noch vor jeder Signaturpruefung.
 * Ein veraenderliches Pfadsegment zwingt zu einem Muster statt einer Liste,
 * und ein Muster ist eine Auslegungssache - genau das, was hier nirgends
 * sein soll.
 *
 * Die Kennung steht deshalb im Rumpf. Sie ist dadurch **nicht** weniger
 * geschuetzt: die Signatur deckt den SHA-256 des Rumpfes ab, also gilt ein
 * mitgelesener Aufruf fuer genau diese Instanz und keine andere. Die
 * Pfadliste bleibt eine Liste.
 *
 * ## Warum das Protokoll hier steht und nicht im Agenten
 *
 * Damit beide Seiten dieselbe Datei lesen. Ein Protokoll, das an zwei
 * Stellen beschrieben ist, ist zwei Protokolle - und der Unterschied faellt
 * erst auf, wenn eine Signatur nicht passt.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pruefeSpezifikation, type ContainerSpezifikation } from './runtime';

/**
 * Was der Agent kann. Vollstaendig.
 *
 * Jede Zeile ist eine Handlung mit einem festen Ergebnis - keine nimmt
 * einen Befehl entgegen. Die Parameter, die es gibt, sind Zahlen und
 * feststehende Werte; sie werden unten geprueft, bevor irgendetwas
 * passiert.
 */
export const AGENT_AKTIONEN = {
  // --- Der Host ----------------------------------------------------------
  health: { methode: 'GET', pfad: '/health' },
  hostStatus: { methode: 'GET', pfad: '/host/status' },

  // --- Abbilder ----------------------------------------------------------
  imageListe: { methode: 'GET', pfad: '/images' },
  imagePull: { methode: 'POST', pfad: '/images/pull' },

  // --- Instanzen ---------------------------------------------------------
  instanzen: { methode: 'GET', pfad: '/instances' },
  instanzErstellen: { methode: 'POST', pfad: '/instances/create' },
  instanzStarten: { methode: 'POST', pfad: '/instances/start' },
  instanzStoppen: { methode: 'POST', pfad: '/instances/stop' },
  instanzNeustart: { methode: 'POST', pfad: '/instances/restart' },
  instanzLoeschen: { methode: 'POST', pfad: '/instances/delete' },
  instanzStatus: { methode: 'POST', pfad: '/instances/status' },
  dateien: { methode: 'POST', pfad: '/instances/files' },

  // --- Das Match in einer Instanz ----------------------------------------
  matchConfigure: { methode: 'POST', pfad: '/instances/match/configure' },
  matchPause: { methode: 'POST', pfad: '/instances/match/pause' },
  matchUnpause: { methode: 'POST', pfad: '/instances/match/unpause' },
  matchRestore: { methode: 'POST', pfad: '/instances/match/restore' },
  matchStatus: { methode: 'POST', pfad: '/instances/match/status' },
} as const;

/**
 * Welche Aktionen sich auf **eine** Instanz beziehen.
 *
 * Sie verlangen alle `instanceId` in der Nutzlast - und zwar im Rumpf, nicht
 * im Pfad. Das ist der Grund, warum diese Liste existiert; siehe den Absatz
 * «Warum die Kennung im Rumpf steht» oben.
 */
export const INSTANZ_AKTIONEN = [
  'instanzErstellen',
  'instanzStarten',
  'instanzStoppen',
  'instanzNeustart',
  'instanzLoeschen',
  'instanzStatus',
  'dateien',
  'matchConfigure',
  'matchPause',
  'matchUnpause',
  'matchRestore',
  'matchStatus',
] as const;

export type AgentAktion = keyof typeof AGENT_AKTIONEN;

/** Die Pfade, die der Agent ueberhaupt bedient. Alles andere ist 404. */
export const ERLAUBTE_PFADE: readonly string[] = Object.values(AGENT_AKTIONEN).map((a) => a.pfad);

/** Wie lange eine Signatur gilt. Knapp genug, dass ein Mitschnitt verfaellt. */
export const ZEITFENSTER_SEKUNDEN = 120;

export const KOPF_ZEIT = 'x-swisshub-timestamp';
export const KOPF_NONCE = 'x-swisshub-nonce';
export const KOPF_SIGNATUR = 'x-swisshub-signature';

/** Ein frisches Agent-Token. 32 Bytes - kein Passwort, das jemand tippt. */
export function erzeugeAgentToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Ein frisches RCON-Passwort. Ebenfalls nie von Hand eingegeben. */
export function erzeugeRconPasswort(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Ein Serverpasswort fuer die Spieler.
 *
 * Kuerzer und ohne Sonderzeichen: es wird in einer Spielkonsole getippt,
 * gelegentlich von einem Telefon abgelesen. Ein Passwort, das niemand
 * fehlerfrei eingeben kann, wird weitergegeben, bis es alle haben.
 */
export function erzeugeServerPasswort(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export function nonce(): string {
  return randomBytes(16).toString('base64url');
}

/** Der Text, der unterschrieben wird. Beide Seiten bauen ihn gleich. */
export function signaturBasis(
  methode: string,
  pfad: string,
  zeitstempel: number,
  einmalwert: string,
  rumpf: string,
): string {
  const rumpfHash = createHash('sha256').update(rumpf, 'utf8').digest('hex');
  return [methode.toUpperCase(), pfad, String(zeitstempel), einmalwert, rumpfHash].join('\n');
}

export function signiere(
  token: string,
  methode: string,
  pfad: string,
  zeitstempel: number,
  einmalwert: string,
  rumpf: string,
): string {
  return createHmac('sha256', token)
    .update(signaturBasis(methode, pfad, zeitstempel, einmalwert, rumpf), 'utf8')
    .digest('base64url');
}

/**
 * Zwei Signaturen vergleichen, ohne zu verraten, ab welchem Zeichen sie sich
 * unterscheiden.
 *
 * `timingSafeEqual` verlangt gleiche Laenge und wirft sonst - deshalb die
 * Laengenpruefung davor. Sie verraet nur die Laenge, und die ist bei
 * HMAC-SHA256 ohnehin fest.
 */
export function signaturStimmt(erwartet: string, erhalten: string): boolean {
  const a = Buffer.from(erwartet, 'utf8');
  const b = Buffer.from(erhalten, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface PruefEingabe {
  token: string;
  methode: string;
  pfad: string;
  zeitstempel: string | null;
  einmalwert: string | null;
  signatur: string | null;
  rumpf: string;
  /** Hat der Agent diesen Einmalwert schon gesehen? */
  kennstDuDenNonce(wert: string): boolean;
  jetztSekunden?: number;
}

export type PruefErgebnis = { ok: true } | { ok: false; grund: string; status: 400 | 401 | 404 };

/**
 * Die Pruefung, die der Agent vor jeder Aktion macht.
 *
 * Steht hier und nicht im Agenten, damit sie sich ohne laufenden Server
 * testen laesst - und damit es nur eine gibt.
 */
export function pruefeAnfrage(eingabe: PruefEingabe): PruefErgebnis {
  if (!ERLAUBTE_PFADE.includes(eingabe.pfad)) {
    // Zuerst: was es nicht gibt, gibt es nicht. Noch vor der Signatur - ein
    // unbekannter Pfad soll nicht erst durch eine Pruefung laufen.
    return { ok: false, grund: 'Unbekannte Aktion.', status: 404 };
  }

  if (!eingabe.zeitstempel || !eingabe.einmalwert || !eingabe.signatur) {
    return { ok: false, grund: 'Signatur unvollständig.', status: 401 };
  }

  const zeit = Number.parseInt(eingabe.zeitstempel, 10);
  if (!Number.isFinite(zeit)) {
    return { ok: false, grund: 'Zeitstempel unlesbar.', status: 400 };
  }

  const jetzt = eingabe.jetztSekunden ?? Math.floor(Date.now() / 1000);
  if (Math.abs(jetzt - zeit) > ZEITFENSTER_SEKUNDEN) {
    /*
     * Auch in die Zukunft. Eine Anfrage mit einem Zeitstempel von morgen
     * waere sonst beliebig lange gueltig - der klassische Weg, das
     * Zeitfenster auszuhebeln.
     */
    return { ok: false, grund: 'Anfrage ist zu alt oder zu neu.', status: 401 };
  }

  if (eingabe.kennstDuDenNonce(eingabe.einmalwert)) {
    return { ok: false, grund: 'Diese Anfrage kam schon einmal.', status: 401 };
  }

  const erwartet = signiere(
    eingabe.token,
    eingabe.methode,
    eingabe.pfad,
    zeit,
    eingabe.einmalwert,
    eingabe.rumpf,
  );
  if (!signaturStimmt(erwartet, eingabe.signatur)) {
    return { ok: false, grund: 'Signatur stimmt nicht.', status: 401 };
  }

  return { ok: true };
}

/**
 * Die Parameter, die eine Aktion annimmt - und zwar nur diese.
 *
 * ## Die Regel
 *
 * Jede Aktion, die eine Instanz betrifft, verlangt eine **Kennung im
 * Kennungsformat** - keinen beliebigen Text. Damit kann aus einer
 * Instanzkennung kein Pfad und kein Argument werden, auch wenn jemand
 * spaeter einen Weg baut, der sie irgendwo einsetzt.
 *
 * `matchRestore` traegt zusaetzlich eine Rundenzahl zwischen 1 und 60,
 * `instanzErstellen` eine vollstaendige Container-Spezifikation, und die
 * wird von `pruefeSpezifikation` geprueft - derselben Funktion, die auch
 * der Agent aufruft, bevor er Docker anfasst.
 */
/** Eine Kennung, wie sie aus der Datenbank kommt. Nichts anderes. */
export const KENNUNG_MUSTER = /^[A-Za-z0-9_-]{8,64}$/u;

export function pruefeNutzlast(
  aktion: AgentAktion,
  nutzlast: unknown,
): { ok: true } | { ok: false; grund: string } {
  const objekt =
    typeof nutzlast === 'object' && nutzlast !== null && !Array.isArray(nutzlast)
      ? (nutzlast as Record<string, unknown>)
      : null;

  if ((INSTANZ_AKTIONEN as readonly string[]).includes(aktion)) {
    if (!objekt) {
      return { ok: false, grund: 'Diese Aktion verlangt ein Objekt.' };
    }
    const kennung = objekt.instanceId;
    if (typeof kennung !== 'string' || !KENNUNG_MUSTER.test(kennung)) {
      return { ok: false, grund: 'instanceId fehlt oder ist keine gültige Kennung.' };
    }
  }

  if (aktion === 'matchRestore') {
    const runde = objekt?.round;
    if (typeof runde !== 'number' || !Number.isInteger(runde) || runde < 1 || runde > 60) {
      return { ok: false, grund: 'restore verlangt eine Rundenzahl zwischen 1 und 60.' };
    }
    return { ok: true };
  }

  if (aktion === 'matchConfigure') {
    const konfiguration = objekt?.config;
    if (typeof konfiguration !== 'object' || konfiguration === null || Array.isArray(konfiguration)) {
      return { ok: false, grund: 'configure verlangt eine Matchkonfiguration als Objekt.' };
    }
    return { ok: true };
  }

  if (aktion === 'instanzErstellen') {
    const spez = objekt?.spec;
    if (typeof spez !== 'object' || spez === null || Array.isArray(spez)) {
      return { ok: false, grund: 'create verlangt eine Container-Spezifikation.' };
    }
    /*
     * **Hier steht die eigentliche Absicherung des Containerstarts.**
     *
     * Abbild, Kommando, Umgebung, Ports, Limits und Mountpfade werden
     * einzeln geprueft. Es gibt keinen Zweig, der eine Spezifikation
     * ungeprueft durchlaesst - auch nicht fuer «vertrauenswuerdige»
     * Aufrufer, denn die Vertrauensfrage stellt sich an dieser Stelle gar
     * nicht mehr: wer bis hierher kommt, hat eine gueltige Signatur.
     */
    const geprueft = pruefeSpezifikation(spez as ContainerSpezifikation);
    if (!geprueft.ok) {
      return geprueft;
    }
    return { ok: true };
  }

  if (aktion === 'instanzLoeschen' || aktion === 'instanzStoppen') {
    // `force` ist ein Schalter, kein Wert. Alles andere wird ignoriert.
    const erzwingen = objekt?.force;
    if (erzwingen !== undefined && typeof erzwingen !== 'boolean') {
      return { ok: false, grund: 'force muss ja oder nein sein.' };
    }
    return { ok: true };
  }

  if (aktion === 'imagePull') {
    const abbild = objekt?.image;
    if (typeof abbild !== 'string' || abbild.length === 0 || abbild.length > 256) {
      return { ok: false, grund: 'pull verlangt einen Abbildnamen.' };
    }
    /*
     * Dasselbe Muster wie in der Spezifikation - und **kein** zweites,
     * lockereres. Ein Abbild, das beim Erstellen abgewiesen wuerde, soll
     * auch nicht vorab geladen werden koennen.
     */
    const probe = pruefeSpezifikation({
      name: 'swisshub-pruefung',
      image: abbild,
      command: [],
      env: {},
      ports: [{ container: 1, host: 1, protokoll: 'udp' }],
      cpuLimit: 1,
      memoryLimitMb: 1024,
      dataMountPath: '/swisshub/data',
      configMountPath: '/swisshub/config',
    });
    if (!probe.ok) {
      return { ok: false, grund: 'Der Abbildname ist nicht gültig.' };
    }
    return { ok: true };
  }

  return { ok: true };
}
