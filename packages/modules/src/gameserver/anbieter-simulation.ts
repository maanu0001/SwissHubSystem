/**
 * Ein Anbieter, der keine Maschinen erzeugt - und das auch sagt.
 *
 * ## Wozu
 *
 * Zwei Dinge, die beide echt sind:
 *
 * **Tests.** Der ganze Lebenslauf eines Matches - provisionieren, booten,
 * konfigurieren, spielen, archivieren, aufraeumen - laesst sich damit
 * durchspielen, ohne dass irgendwo eine Maschine entsteht. Kein Test in
 * diesem Repository darf eine echte VM starten.
 *
 * **Einrichtung.** Solange fuer das tatsaechliche Datacenter noch kein
 * Treiber existiert, kann das Team Templates, Game Profiles und den ganzen
 * Ablauf einrichten und ansehen. Die Oberflaeche zeigt dabei ausdruecklich
 * «Simulation» - nicht «verbunden».
 *
 * ## Was er ausdruecklich nicht ist
 *
 * Er ist **kein** erfundener Anbieter und traegt keine erfundenen
 * Zugangsdaten. Er hat keine, er ruft nichts auf, und er behauptet nichts
 * ueber ein Datacenter, das er nicht kennt. Wer ihn produktiv einschaltet,
 * bekommt Server, die nur in der Datenbank existieren - und genau das steht
 * im Dashboard.
 *
 * ## Warum er trotzdem Zeit vergehen laesst
 *
 * Weil ein Provisionieren, das sofort fertig ist, die haeufigsten Fehler
 * verdeckt: Zustaende, die uebersprungen werden, Wartelogik, die nie
 * greift, ein Agent, auf den nie gewartet wird. Der simulierte Anbieter
 * braucht deshalb eine einstellbare Zeit und kann auf Wunsch scheitern -
 * das ist der Unterschied zwischen einem Doppelgaenger, der etwas beweist,
 * und einem, der nur nickt.
 */
import {
  registriereAnbieter,
  type ErstellEingabe,
  type InfrastrukturAnbieter,
  type Maschine,
} from './anbieter';

export const SIMULATION_TREIBER = 'simulation';

interface SimulierteMaschine extends Maschine {
  erstelltAm: number;
  /** Ab wann sie als `RUNNING` gilt. */
  bereitAb: number;
}

/**
 * Der Zustand liegt im Modul und nicht in der Datenbank.
 *
 * Das ist Absicht: eine Simulation, die einen Neustart ueberlebt, waere eine
 * halbe Wahrheit. Nach einem Neustart meldet sie `null` fuer jede Maschine,
 * und der Orchestrator behandelt das wie jeden anderen Anbieter, der eine
 * Maschine nicht mehr kennt - genau der Fall, der sonst nie getestet wuerde.
 */
const MASCHINEN = new Map<string, SimulierteMaschine>();

let zaehler = 0;

/** Wie lange eine simulierte Maschine zum Starten braucht. */
let startdauerMs = 0;
/** Der naechste Aufruf von `createServer` scheitert. Fuer Tests. */
let naechsterFehler: string | null = null;

export function simulationEinstellen(optionen: { startdauerMs?: number }): void {
  if (optionen.startdauerMs !== undefined) {
    startdauerMs = Math.max(0, optionen.startdauerMs);
  }
}

/** Den naechsten Erstellversuch scheitern lassen - nur fuer Tests. */
export function simulationNaechsterFehler(meldung: string | null): void {
  naechsterFehler = meldung;
}

/** Alles vergessen - nur fuer Tests. */
export function simulationZuruecksetzen(): void {
  MASCHINEN.clear();
  zaehler = 0;
  startdauerMs = 0;
  naechsterFehler = null;
}

function aktualisiere(maschine: SimulierteMaschine): SimulierteMaschine {
  if (maschine.status === 'PROVISIONING' && Date.now() >= maschine.bereitAb) {
    maschine.status = 'RUNNING';
  }
  return maschine;
}

export const simulationsAnbieter: InfrastrukturAnbieter = registriereAnbieter({
  key: SIMULATION_TREIBER,
  label: 'Simulation (erzeugt keine echten Maschinen)',
  benoetigteFelder: [],

  async pruefe() {
    return {
      ok: true,
      meldung: 'Simulation - es wird kein Datacenter angesprochen. Server entstehen nur in der Datenbank.',
    };
  },

  async createServer(_zugang, eingabe: ErstellEingabe) {
    if (naechsterFehler) {
      const meldung = naechsterFehler;
      naechsterFehler = null;
      throw new Error(meldung);
    }

    zaehler += 1;
    const ref = `sim-${zaehler}-${eingabe.name}`;
    const jetzt = Date.now();
    const maschine: SimulierteMaschine = {
      ref,
      status: startdauerMs > 0 ? 'PROVISIONING' : 'RUNNING',
      netzwerk: {
        /*
         * Eine Adresse aus dem Dokumentationsbereich (RFC 5737). Sie fuehrt
         * garantiert nirgendwohin - eine erfundene echte Adresse koennte
         * einen fremden Rechner treffen.
         */
        host: `192.0.2.${(zaehler % 250) + 1}`,
        internalHost: null,
      },
      fehler: null,
      erstelltAm: jetzt,
      bereitAb: jetzt + startdauerMs,
    };
    MASCHINEN.set(ref, maschine);
    return { ...maschine };
  },

  async getServer(_zugang, ref) {
    const maschine = MASCHINEN.get(ref);
    return maschine ? { ...aktualisiere(maschine) } : null;
  },

  async startServer(_zugang, ref) {
    const maschine = MASCHINEN.get(ref);
    if (maschine) {
      maschine.status = 'RUNNING';
    }
  },

  async stopServer(_zugang, ref) {
    const maschine = MASCHINEN.get(ref);
    if (maschine) {
      maschine.status = 'STOPPED';
    }
  },

  async deleteServer(_zugang, ref) {
    MASCHINEN.delete(ref);
  },
});
