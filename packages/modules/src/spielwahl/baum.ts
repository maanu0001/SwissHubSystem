/**
 * Der Turnierbaum - als reine Form, ohne Abhängigkeiten.
 *
 * ## Warum eine eigene Datei
 *
 * Weil der Browser ihn braucht. Die Bühne zeichnet den Baum und muss dafür
 * wissen, welches Duell gerade läuft - dieselbe Antwort, die auch der Server
 * gibt. Zwei Fassungen davon wären zwei Gelegenheiten, dass die Anzeige auf
 * ein anderes Duell zeigt als die Abstimmung.
 *
 * Diese Datei importiert deshalb **nichts**: kein Prisma, kein `node:crypto`,
 * keine Fehlerklassen. Nur so lässt sie sich in einer Client-Komponente
 * laden, ohne den halben Server mitzuziehen - `tests/unit/client-boundary`
 * prüft das.
 */

export interface Paarung {
  /**
   * Die Nummer dieses Duells **im ganzen Turnier**, nicht in seiner Stufe.
   *
   * Der Unterschied ist nicht kosmetisch: die Eindeutigkeit einer Stimme
   * hängt an ihr. Zählte jede Stufe wieder bei null, wäre die Stimme aus
   * Duell 0 der ersten Stufe dieselbe Zeile wie die aus Duell 0 der zweiten -
   * und die Stimmen des Achtelfinales entschieden das Halbfinale mit.
   */
  nr: number;
  /** Zwei Kandidaten - oder einer und `null`: dann ist es ein Freilos. */
  a: string;
  b: string | null;
  sieger: string | null;
  /** Wie der Sieger zustande kam. */
  art?: 'stimmen' | 'freilos' | 'los';
}

export interface Stufe {
  nummer: number;
  paarungen: Paarung[];
}

export interface Baum {
  stufen: Stufe[];
}

/** Liest den Baum aus dem JSON-Feld, mit einer Form, auf die man sich verlassen kann. */
export function leseBaum(wert: unknown): Baum {
  if (!wert || typeof wert !== 'object' || !Array.isArray((wert as Baum).stufen)) {
    return { stufen: [] };
  }
  return wert as Baum;
}

/** Das laufende Duell - gesucht über seine Nummer, nicht über die Position. */
export function aktuellesDuell(baum: Baum, nr: number): Paarung | undefined {
  const stufe = baum.stufen[baum.stufen.length - 1];
  return stufe?.paarungen.find((paarung) => paarung.nr === nr);
}

/** Die höchste vergebene Duellnummer - Ausgangspunkt für die nächste Stufe. */
export function hoechsteNr(baum: Baum): number {
  let hoechste = -1;
  for (const stufe of baum.stufen) {
    for (const paarung of stufe.paarungen) {
      hoechste = Math.max(hoechste, paarung.nr);
    }
  }
  return hoechste;
}
