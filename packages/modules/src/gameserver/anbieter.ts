/**
 * Die Abstraktion ueber das Virtual Datacenter.
 *
 * ## Warum eine Abstraktion und nicht einfach ein Treiber
 *
 * Weil der Orchestrator sonst den Anbieter kennen wuerde. Er soll wissen,
 * dass er eine Maschine braucht, ihre Adresse erfaehrt und sie wieder
 * loswird - nicht, ob das ueber `/api2/json/nodes/.../qemu` oder ueber
 * `/cloudapi/1.0.0/vdcs/.../vapps` geht. Ein neuer Anbieter ist damit eine
 * neue Datei, die dieses Interface erfuellt, und keine Aenderung am
 * Turniermodul.
 *
 * ## Was ein Treiber wissen darf und was nicht
 *
 * Ein Treiber bekommt seine Zugangsdaten als Argument und holt sie sich
 * nicht selbst. So laesst er sich in einem Test ohne Geheimnisspeicher
 * betreiben, und es gibt keinen zweiten Weg, an Zugangsdaten zu kommen.
 *
 * Er kennt **kein** Match, **kein** Turnier und **kein** Spiel. Was auf der
 * Maschine laeuft, entscheidet der Game Adapter; der Treiber liefert eine
 * Maschine mit einer Adresse.
 */
import { AppError } from '@swisshub/shared';

/** Die Zustaende, die jeder Anbieter melden koennen muss. */
export type AnbieterStatus = 'PROVISIONING' | 'RUNNING' | 'STOPPED' | 'REMOVED' | 'ERROR';

export interface Netzwerkangaben {
  /** Die Adresse, unter der die Maschine von aussen erreichbar ist. */
  host: string | null;
  /** Die Adresse innerhalb des Datacenters, falls es eine eigene gibt. */
  internalHost?: string | null;
}

export interface Maschine {
  /** Die Kennung beim Anbieter - undurchsichtig fuer SwissHub. */
  ref: string;
  status: AnbieterStatus;
  netzwerk: Netzwerkangaben;
  /** Was der Anbieter zuletzt gemeldet hat, falls etwas schieflief. */
  fehler?: string | null;
}

export interface ErstellEingabe {
  /** Der Name, unter dem die Maschine beim Anbieter stehen soll. */
  name: string;
  /** Die Vorlage beim Anbieter. */
  imageRef: string;
  region: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  /**
   * Was beim ersten Start ausgefuehrt werden soll - cloud-init oder das
   * Gegenstueck des Anbieters.
   *
   * Hier steht **kein Shell-Kommando aus einer Eingabe**. Der Inhalt entsteht
   * ausschliesslich in `startskript.ts` aus festen Bausteinen; der Treiber
   * reicht ihn nur weiter.
   */
  startskript: string;
  /** Die Ports, die von aussen erreichbar sein muessen. */
  offenePorts: number[];
  /** Was der jeweilige Anbieter zusaetzlich braucht. Nie Geheimnisse. */
  optionen: Record<string, unknown>;
}

/**
 * Was ein Anbieter koennen muss.
 *
 * Bewusst klein. Jede Methode hier ist eine, die irgendein Datacenter auch
 * wirklich anbietet - es gibt keinen Aufruf, den ein Treiber nur
 * vortaeuschen koennte.
 */
export interface InfrastrukturAnbieter {
  /** Der Schluessel, unter dem dieser Treiber in der Registry steht. */
  readonly key: string;
  /** Wie er im Dashboard heisst. */
  readonly label: string;
  /**
   * Was dieser Treiber an Zugangsdaten braucht - fuer die Einrichtungsseite
   * und fuer die Pruefung beim Start.
   */
  readonly benoetigteFelder: readonly string[];

  /** Steht die Verbindung? Fuer den Knopf «Verbindung pruefen». */
  pruefe(zugang: Zugangsdaten): Promise<{ ok: boolean; meldung: string }>;

  createServer(zugang: Zugangsdaten, eingabe: ErstellEingabe): Promise<Maschine>;
  getServer(zugang: Zugangsdaten, ref: string): Promise<Maschine | null>;
  startServer(zugang: Zugangsdaten, ref: string): Promise<void>;
  stopServer(zugang: Zugangsdaten, ref: string): Promise<void>;
  deleteServer(zugang: Zugangsdaten, ref: string): Promise<void>;
}

/**
 * Die Zugangsdaten eines Anbieters.
 *
 * Eine schlichte Karte statt eines Typs je Anbieter: was drinsteht,
 * entscheidet `benoetigteFelder` des Treibers, und die Pruefung passiert
 * beim Laden. Ein Typ je Anbieter haette im Kern dieses Moduls eine
 * Fallunterscheidung erzwungen - genau das, was die Abstraktion vermeiden
 * soll.
 */
export type Zugangsdaten = Readonly<Record<string, string>>;

/** Fehlt ein Feld, faellt es hier auf - und nicht mitten im Provisionieren. */
export function pflichtfeld(zugang: Zugangsdaten, feld: string): string {
  const wert = zugang[feld]?.trim();
  if (!wert) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Für diesen Anbieter fehlt die Angabe «${feld}». Trage sie unter System → Integrationen nach.`,
      internalMessage: `Zugangsfeld ${feld} fehlt`,
    });
  }
  return wert;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TREIBER = new Map<string, InfrastrukturAnbieter>();

/**
 * Einen Treiber eintragen.
 *
 * Wie bei den Modulen: der Treiber traegt sich selbst ein, wenn seine Datei
 * geladen wird. Es gibt keine zentrale Liste, die jemand vergessen kann, zu
 * ergaenzen.
 */
export function registriereAnbieter(anbieter: InfrastrukturAnbieter): InfrastrukturAnbieter {
  if (TREIBER.has(anbieter.key)) {
    throw new Error(`Anbieter-Treiber ${anbieter.key} ist bereits registriert.`);
  }
  TREIBER.set(anbieter.key, anbieter);
  return anbieter;
}

export function anbieterTreiber(key: string): InfrastrukturAnbieter | undefined {
  return TREIBER.get(key);
}

export function listeAnbieterTreiber(): InfrastrukturAnbieter[] {
  return [...TREIBER.values()];
}

/**
 * Den Treiber holen - oder klar sagen, dass es ihn nicht gibt.
 *
 * Kein stiller Rueckfall auf irgendeinen anderen Treiber: eine Maschine beim
 * falschen Anbieter zu erzeugen waere schlimmer als gar keine.
 */
export function brauchteTreiber(key: string): InfrastrukturAnbieter {
  const treiber = TREIBER.get(key);
  if (!treiber) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Für diesen Anbieter gibt es keinen Treiber («${key}»). Ohne Treiber lassen sich keine Server erstellen.`,
      internalMessage: `Unbekannter Anbieter-Treiber ${key}`,
    });
  }
  return treiber;
}
