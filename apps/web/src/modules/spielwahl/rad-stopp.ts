/**
 * Wo das Rad stehen bleibt.
 *
 * ## Das Problem, das diese Datei loest
 *
 * Vorher rechnete das Rad seinen Endwinkel als `(losPunkt + 0.5) / losGesamt`
 * - die **Mitte** des gezogenen Loses. Ohne Gewichtung hat jedes Spiel genau
 * ein Los, also war das die Mitte des Gewinnerfeldes, und zwar jedes Mal. Der
 * Zeiger stand nach jeder Ziehung exakt auf der Kante des Covers, millimeter-
 * genau, bei zwanzig Ziehungen zwanzigmal gleich. Das sieht nicht nach
 * Glueck aus, sondern nach einer Maschine, die vorher weiss, wohin sie will -
 * und genau diesen Verdacht soll ein Gluecksrad nicht erzeugen.
 *
 * ## Was sich aendert und was ausdruecklich nicht
 *
 * **Der Gewinner aendert sich nicht.** Er wird auf dem Server gezogen, steht
 * in der Datenbank, bevor sich etwas bewegt, und wird hier nicht angefasst.
 * Was hier entsteht, ist eine **Stelle innerhalb des gezogenen Loses** - der
 * Zeiger landet irgendwo in seinem Feld statt immer in dessen Mitte. Das Feld
 * bleibt dasselbe.
 *
 * Das ist der Unterschied, auf den es ankommt: es waere unredlich, den
 * Gewinner vorher zu bestimmen, das Rad sichtbar in einem anderen Segment
 * anzuhalten und dann trotzdem den vorher bestimmten Gewinner zu verkuenden.
 * Genau das passiert hier nicht - der Zeiger steht am Ende auf dem Spiel, das
 * gewonnen hat, und der Abstand zum Rand ist gross genug, dass es nicht
 * zweideutig ist.
 *
 * ## Warum aus dem Seed und nicht aus `Math.random`
 *
 * Weil alle Zuschauer dasselbe sehen muessen. Zwei Bildschirme, die beide
 * `Math.random` fragen, halten an verschiedenen Stellen an - und einer davon
 * unter einem fremden Cover. Der Seed der Runde steht ohnehin in der
 * Datenbank (fuer die Nachvollziehbarkeit der Ziehung) und geht ohnehin an
 * den Browser; aus ihm folgt die Stelle eindeutig, auf jedem Geraet und auch
 * fuer den, der mitten im Lauf dazukommt.
 *
 * Dass es eine **Darstellungsgroesse** ist und keine Ziehung, ist auch der
 * Grund, warum hier kein SHA-256 steht: dieser Wert entscheidet nichts, er
 * muss nur gleich verteilt und ueberall gleich sein. Ein kleiner Mischer
 * genuegt - und er laeuft im Browser ohne `node:crypto`.
 */

/**
 * Ein Wert in `[0, 1)` aus einer Zeichenkette - immer derselbe.
 *
 * FNV-1a, danach ein Bitmischer. Das eine sorgt dafuer, dass jedes Zeichen
 * eingeht, das andere dafuer, dass sich benachbarte Seeds nicht aehnlich
 * verhalten - ohne den Mischer lagen zwei Seeds, die sich nur im letzten
 * Zeichen unterscheiden, dicht beieinander, und aufeinanderfolgende Runden
 * haetten aehnlich ausgesehen.
 *
 * `strom` waehlt eine unabhaengige Folge: 0 fuer die Stelle im Feld, 1 fuer
 * die Zahl der Umdrehungen. Zwei Werte aus derselben Folge zu nehmen hiesse,
 * beides aneinander zu koppeln.
 */
export function streuung(seed: string, strom = 0): number {
  let hash = 0x811c9dc5 ^ (strom * 0x9e3779b1);
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    // FNV-Primzahl, als Verschiebungen - `Math.imul` haelt das Ergebnis in
    // 32 Bit, statt es in eine Gleitkommazahl laufen zu lassen.
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x21f0aaad);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x735a2d97);
  hash ^= hash >>> 15;
  // `>>> 0` macht aus der vorzeichenbehafteten 32-Bit-Zahl eine positive.
  return (hash >>> 0) / 0x1_0000_0000;
}

/**
 * Wie weit der Zeiger vom Rand des Feldes wegbleibt - als Anteil des Loses.
 *
 * Ohne diesen Abstand landete das Rad gelegentlich auf der Trennlinie
 * zwischen zwei Feldern. Es waere nicht falsch - das Los ist gezogen, das
 * Ergebnis steht -, aber es sieht aus wie ein Streitfall, und ein Gluecksrad,
 * bei dem man diskutieren kann, wo es steht, hat seinen Zweck verfehlt.
 *
 * 0.12 laesst bei zwei Feldern gut zwanzig Grad Luft und bei zwanzig Feldern
 * noch zwei - in beiden Faellen sichtbar innerhalb des Feldes.
 */
export const RAND_ABSTAND = 0.12;

/** Die wenigsten Umdrehungen, damit der Lauf nicht kurz wirkt. */
export const UMDREHUNGEN_MIN = 7;
/** Wie viele Umdrehungen hoechstens dazukommen - 7, 8 oder 9. */
export const UMDREHUNGEN_SPANNE = 3;

export interface RadStopp {
  /** Der Endwinkel in Grad, inklusive der vollen Umdrehungen. */
  grad: number;
  /** Wie viele volle Umdrehungen es wurden. */
  umdrehungen: number;
  /**
   * Wo der Zeiger auf der Gewichtsachse landet, `0 <= anteil < 1`.
   *
   * Herausgegeben, damit ein Test nachrechnen kann, dass die Stelle im Feld
   * des Gewinners liegt - und nicht nur, dass irgendein Winkel herauskommt.
   */
  anteil: number;
}

/**
 * Der Endwinkel einer Ziehung.
 *
 * `losPunkt` und `losGesamt` kommen vom Server und werden nicht verhandelt.
 * Was diese Funktion beitraegt, ist die Stelle **innerhalb** des Loses und
 * die Zahl der Umdrehungen.
 */
export function radStopp(runde: {
  seed: string;
  losPunkt: number | null;
  losGesamt: number | null;
}): RadStopp {
  const umdrehungen = UMDREHUNGEN_MIN + Math.floor(streuung(runde.seed, 1) * UMDREHUNGEN_SPANNE);

  if (!runde.losGesamt || runde.losGesamt <= 0) {
    // Keine Ziehung zum Anzeigen - dann dreht das Rad und steht wieder oben.
    return { grad: umdrehungen * 360, umdrehungen, anteil: 0 };
  }

  const versatz = RAND_ABSTAND + streuung(runde.seed, 0) * (1 - 2 * RAND_ABSTAND);
  const anteil = ((runde.losPunkt ?? 0) + versatz) / runde.losGesamt;

  /*
   * Das Rad dreht im Uhrzeigersinn, der Zeiger steht oben.
   *
   * Ein Feld, das bei 0.25 der Achse beginnt, liegt im Bild bei 90 Grad; um
   * es unter den Zeiger zu holen, muss das Rad 360 - 90 Grad weiterdrehen.
   * Daher die Subtraktion, und daher die vollen Umdrehungen davor.
   */
  return { grad: umdrehungen * 360 + (360 - anteil * 360), umdrehungen, anteil };
}
