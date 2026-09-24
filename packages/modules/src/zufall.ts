import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Die Ziehung.
 *
 * Der Gewinner entsteht ausschliesslich hier, auf dem Server. Das Rad im
 * Browser dreht sich zu einem Ergebnis, das zu diesem Zeitpunkt längst
 * feststeht - es bestimmt nichts.
 */

export interface WeightedTicket {
  entryId: string;
  discordId: string;
  weight: number;
}

export interface DrawSelection {
  winner: WeightedTicket;
  /** Der gezogene Punkt auf der Gewichtsachse, `0 <= ticket < totalWeight`. */
  ticket: number;
  totalWeight: number;
}

/**
 * Quelle für Zufall.
 *
 * Im Betrieb kryptographisch sicher. Tests reichen eine eigene Quelle herein,
 * damit sich eine Ziehung nachrechnen lässt, ohne dass der Test von echtem
 * Zufall abhängt und dadurch gelegentlich fehlschlägt.
 */
export interface RandomSource {
  /** Gleichverteilte Ganzzahl in `[0, maxExclusive)`. */
  integer(maxExclusive: number): number;
  /** Zufällige Bytes als Hex-Zeichenkette. */
  hex(bytes: number): string;
}

/**
 * `crypto.randomInt` verwirft Werte ausserhalb des grössten passenden
 * Vielfachen, statt mit Modulo zu rechnen. Damit ist jede Zahl gleich
 * wahrscheinlich - bei Modulo wären die kleinsten Zahlen bevorzugt.
 */
export const secureRandom: RandomSource = {
  integer: (maxExclusive: number) => randomInt(0, Math.max(1, Math.trunc(maxExclusive))),
  hex: (bytes: number) => randomBytes(bytes).toString('hex'),
};

/**
 * Zieht eine Teilnahme entsprechend ihrem Gewicht.
 *
 * Beim Festbetrag wiegt jede Teilnahme 1, alle haben also dieselbe Chance.
 * Beim Anteilsmodell wiegt eine Teilnahme so viel, wie sie gekostet hat - die
 * Chance entspricht damit dem Anteil am gesamten Einsatz.
 */
export function drawWeighted(
  tickets: readonly WeightedTicket[],
  random: RandomSource = secureRandom,
): DrawSelection | null {
  const eligible = tickets.filter((ticket) => ticket.weight > 0);
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, ticket) => sum + ticket.weight, 0);
  const ticket = random.integer(totalWeight);

  let cursor = 0;
  for (const candidate of eligible) {
    cursor += candidate.weight;
    if (ticket < cursor) {
      return { winner: candidate, ticket, totalWeight };
    }
  }

  // Unerreichbar, solange die Summe stimmt - aber lieber ein definierter
  // Rückfall als ein `undefined` weiter oben im Ablauf.
  const last = eligible[eligible.length - 1]!;
  return { winner: last, ticket, totalWeight };
}

/**
 * Eine Zufallsquelle, die sich nachrechnen laesst.
 *
 * ## Wofuer
 *
 * Die Elimination mischt die Kandidaten einmal und leitet daraus den
 * Turnierbaum und das Freilos ab. Wuerde dabei frischer Zufall gezogen,
 * koennte niemand hinterher pruefen, ob das Freilos wirklich gelost und
 * nicht vergeben wurde - «der Server sagt es» ist bei einer Auslosung keine
 * Auskunft.
 *
 * Deshalb wird je Runde **ein** Wert gezogen, festgehalten und sichtbar
 * gemacht; alles Weitere folgt daraus. Wer den Wert hat, kann die Mischung
 * nachbauen und bekommt dieselbe.
 *
 * ## Warum SHA-256 und kein kleiner Generator
 *
 * Ein Zeilengenerator waere schneller und hier voellig ausreichend. Er waere
 * aber auch vorhersagbar: wer zwei Ergebnisse sieht, kann den Zustand
 * zurueckrechnen und die naechste Mischung vorhersagen, **bevor** der Wert
 * veroeffentlicht ist. Ein Hash ueber Wert und Zaehler hat diese Eigenschaft
 * nicht, und der Unterschied kostet hier nichts.
 */
export function quelleAusSeed(seed: string): RandomSource {
  let zaehler = 0;

  /** Der naechste 48-Bit-Block aus dem Strom. */
  const naechste = (): number => {
    const block = createHash('sha256').update(`${seed}:${zaehler}`).digest();
    zaehler += 1;
    return block.readUIntBE(0, 6);
  };

  return {
    integer: (maxExclusive: number): number => {
      const grenze = Math.max(1, Math.trunc(maxExclusive));
      /*
       * Dieselbe Vorsicht wie bei `crypto.randomInt`: Werte oberhalb des
       * groessten passenden Vielfachen werden verworfen, statt mit Modulo
       * zusammengefaltet zu werden. Sonst waeren die kleinsten Zahlen
       * haeufiger - bei acht Kandidaten unmerklich, bei einer Auslosung
       * trotzdem falsch.
       */
      const spanne = 2 ** 48;
      const hoechste = spanne - (spanne % grenze);
      let wert = naechste();
      while (wert >= hoechste) {
        wert = naechste();
      }
      return wert % grenze;
    },
    hex: (bytes: number): string => {
      let ergebnis = '';
      while (ergebnis.length < bytes * 2) {
        ergebnis += createHash('sha256').update(`${seed}:h:${zaehler}`).digest('hex');
        zaehler += 1;
      }
      return ergebnis.slice(0, bytes * 2);
    },
  };
}

/**
 * Mischt eine Liste - Fisher-Yates, rueckwaerts.
 *
 * Die naive Variante («sortiere nach Zufallszahl») ist nicht
 * gleichverteilt; diese ist es, solange die Quelle es ist. Die Eingabe
 * bleibt unberuehrt.
 */
export function mische<T>(items: readonly T[], random: RandomSource): T[] {
  const liste = [...items];
  for (let index = liste.length - 1; index > 0; index -= 1) {
    const ziel = random.integer(index + 1);
    [liste[index], liste[ziel]] = [liste[ziel]!, liste[index]!];
  }
  return liste;
}
