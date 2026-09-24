import { EventEmitter } from 'node:events';

/**
 * Der Wecker fuer offene Live-Stroeme.
 *
 * ## Das Problem, das er loest
 *
 * Die bestehenden Live-Stroeme dieser Anwendung fragen die Datenbank in
 * festen Abstaenden - fuenf Sekunden beim Turnier-Leitstand. Fuer einen
 * Matchstand ist das richtig. Fuer eine Runde, in der sechs Leute
 * gleichzeitig abstimmen und ein Rad anlaeuft, ist es zu traege: der Beitritt
 * eines Freundes soll sofort auf allen Bildschirmen stehen, nicht irgendwann
 * in den naechsten fuenf Sekunden.
 *
 * Schneller zu pollen waere die falsche Antwort - es machte die Datenbank
 * beschaeftigt, ohne die Latenz verlaesslich zu senken.
 *
 * ## Warum das hier reicht
 *
 * Die WebApp laeuft in **einem** Node-Prozess (ein Container, keine
 * Replikate - siehe `docker-compose.prod.yml`). Server Actions und Route
 * Handler teilen sich denselben Speicher. Wer eine Session veraendert, kann
 * die offenen Stroeme derselben Session also direkt wecken.
 *
 * ## Warum die Korrektheit trotzdem nicht daran haengt
 *
 * Weil ein Wecker, der ausfaellt, nur Zeit kostet. Die Wahrheit steht in der
 * Datenbank, und jeder Strom liest sie ohnehin in einem langsamen Grundtakt.
 * Faellt der Wecker aus - weil der Bot geschrieben hat, weil der Prozess
 * neu gestartet ist, weil die Anwendung eines Tages doch auf zwei Container
 * verteilt wird -, wird die Runde langsamer, nicht falsch.
 *
 * Das ist der Unterschied zwischen einer Abkuerzung und einer Abhaengigkeit,
 * und er ist der Grund, warum hier kein zweiter Nachrichtendienst steht.
 */

/**
 * Ein Singleton, das einen Neuladen des Moduls uebersteht.
 *
 * In der Entwicklung laedt Next.js Module neu, wenn sich etwas aendert. Ein
 * gewoehnliches Modul-Level-`new EventEmitter()` waere danach ein anderer -
 * und die Stroeme, die noch am alten haengen, blieben fuer immer stumm.
 */
const SCHLUESSEL = Symbol.for('swisshub.live-bus');

interface Bus {
  emitter: EventEmitter;
}

const global = globalThis as unknown as Record<symbol, Bus | undefined>;

function bus(): Bus {
  let vorhanden = global[SCHLUESSEL];
  if (!vorhanden) {
    const emitter = new EventEmitter();
    /*
     * Zwanzig Zuschauer auf einer Session sind erlaubt und keine Warnung
     * wert. Die fachliche Obergrenze steht in den Einstellungen des Moduls;
     * hier geht es nur darum, dass Node nicht bei elf Zuhoerern meldet, es
     * koenne ein Speicherleck vorliegen.
     */
    emitter.setMaxListeners(0);
    vorhanden = { emitter };
    global[SCHLUESSEL] = vorhanden;
  }
  return vorhanden;
}

/** Weckt alle Stroeme, die auf dieses Thema hoeren. */
export function wecke(thema: string): void {
  bus().emitter.emit(thema);
}

/**
 * Auf ein Thema hoeren.
 *
 * Gibt die Abmeldung zurueck. Sie **muss** aufgerufen werden, wenn der Strom
 * endet - ein Zuhoerer, der bleibt, haelt den Abschluss im Speicher, und bei
 * einem Server, der Wochen laeuft, summiert sich das.
 */
export function hoere(thema: string, aufWecken: () => void): () => void {
  const { emitter } = bus();
  emitter.on(thema, aufWecken);
  return () => {
    emitter.off(thema, aufWecken);
  };
}

/** Das Thema einer Spielauswahl-Session. */
export function spielwahlThema(sessionId: string): string {
  return `spielwahl:${sessionId}`;
}
