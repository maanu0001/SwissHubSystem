/**
 * Aus Stimmen ein Ergebnis machen.
 *
 * Bewusst ohne Datenbank und ohne Discord: hier steht nur Rechnen. Das macht
 * jede Regel einzeln pruefbar - und die Regeln sind genau die, an denen eine
 * Abstimmung unglaubwuerdig wird, wenn man sie schleifen laesst.
 */

/** Eine Antwortmoeglichkeit mit ihrer Stimmenzahl. */
export interface StimmenZeile {
  optionId: string;
  label: string;
  position: number;
  stimmen: number;
}

/** Eine Antwortmoeglichkeit im fertigen Ergebnis. */
export interface ErgebnisZeile extends StimmenZeile {
  /**
   * Der Anteil in Prozent, ganzzahlig.
   *
   * Die Summe aller Zeilen ist genau 100 - siehe `verteileProzente`.
   */
  prozent: number;
  /** Liegt diese Antwort vorne? Bei Gleichstand gilt das fuer mehrere. */
  fuehrt: boolean;
}

export interface Ergebnis {
  zeilen: ErgebnisZeile[];
  /** Gueltige Stimmen insgesamt. */
  gesamt: number;
  /**
   * Die eine Gewinnerantwort - oder `null`.
   *
   * `null` bei null Stimmen **und** bei Gleichstand. Einen von zwei
   * gleichstarken Antworten zum Gewinner zu erklaeren - etwa den mit der
   * kleineren Position - waere eine Zahl, die das Ergebnis nicht hergibt.
   */
  gewinner: ErgebnisZeile | null;
  /** Bei Gleichstand an der Spitze: die beteiligten Antworten. */
  gleichstand: ErgebnisZeile[];
}

/**
 * Ganzzahlige Prozente, die sich zu 100 summieren.
 *
 * ## Warum nicht einfach runden
 *
 * Weil drei Antworten mit je einem Drittel der Stimmen dann 33 + 33 + 33 = 99
 * ergeben, und auf einer Grafik, die nur diese drei Zahlen zeigt, fehlt ein
 * Prozent ohne Erklaerung. Bei 1/6, 1/6 und 4/6 kommt umgekehrt 17 + 17 + 67 =
 * 101 heraus.
 *
 * ## Groesste Reste
 *
 * Jede Zeile bekommt ihren abgerundeten Anteil. Die Differenz zu 100 wird an
 * die Zeilen mit dem groessten abgeschnittenen Rest verteilt - eine Stimme
 * mehr geht dorthin, wo am meisten fehlte. Das ist das Verfahren, mit dem auch
 * Sitze in Parlamenten verteilt werden, und es hat die Eigenschaft, die hier
 * zaehlt: die Reihenfolge bleibt erhalten, und die Summe stimmt.
 *
 * Bei gleichem Rest entscheidet die kleinere Position - nicht der Zufall,
 * damit derselbe Export zweimal dasselbe ergibt.
 */
export function verteileProzente(stimmen: number[]): number[] {
  const gesamt = stimmen.reduce((summe, wert) => summe + wert, 0);
  if (gesamt === 0) {
    return stimmen.map(() => 0);
  }

  const genau = stimmen.map((wert) => (wert / gesamt) * 100);
  const abgerundet = genau.map((wert) => Math.floor(wert));
  const fehlend = 100 - abgerundet.reduce((summe, wert) => summe + wert, 0);

  /*
   * Nach Rest sortiert, bei Gleichheit nach Position.
   *
   * Die Indizes werden sortiert, nicht die Werte - die Reihenfolge der
   * Rueckgabe muss der der Eingabe entsprechen.
   */
  const nachRest = abgerundet
    .map((wert, index) => ({ index, rest: genau[index]! - wert }))
    .sort((links, rechts) => rechts.rest - links.rest || links.index - rechts.index);

  const ergebnis = [...abgerundet];
  for (let vergeben = 0; vergeben < fehlend; vergeben += 1) {
    const ziel = nachRest[vergeben % nachRest.length];
    if (ziel) {
      ergebnis[ziel.index] = (ergebnis[ziel.index] ?? 0) + 1;
    }
  }
  return ergebnis;
}

/**
 * Das Ergebnis einer Abstimmung.
 *
 * Die Zeilen kommen in der Reihenfolge zurueck, in der die Antworten im Embed
 * standen - nicht nach Stimmen sortiert. Das ist Absicht: die Ergebnisgrafik
 * soll dieselbe Reihenfolge zeigen wie die Frage, sonst sucht man beim
 * Vergleichen. Wer eine Rangliste braucht, sortiert selbst.
 */
export function berechneErgebnis(zeilen: StimmenZeile[]): Ergebnis {
  const sortiert = [...zeilen].sort((links, rechts) => links.position - rechts.position);
  const prozente = verteileProzente(sortiert.map((zeile) => zeile.stimmen));
  const gesamt = sortiert.reduce((summe, zeile) => summe + zeile.stimmen, 0);
  const hoechste = sortiert.reduce((max, zeile) => Math.max(max, zeile.stimmen), 0);

  const fertig: ErgebnisZeile[] = sortiert.map((zeile, index) => ({
    ...zeile,
    prozent: prozente[index] ?? 0,
    /*
     * Bei null Stimmen fuehrt niemand.
     *
     * Ohne diese Bedingung waere `stimmen === hoechste` fuer jede Zeile wahr -
     * alle haetten null - und die Grafik hoebe alle vier Antworten als Sieger
     * hervor.
     */
    fuehrt: gesamt > 0 && zeile.stimmen === hoechste,
  }));

  const vorne = fertig.filter((zeile) => zeile.fuehrt);

  return {
    zeilen: fertig,
    gesamt,
    // Genau eine vorne: das ist der Gewinner. Sonst keiner.
    gewinner: vorne.length === 1 ? vorne[0]! : null,
    gleichstand: vorne.length > 1 ? vorne : [],
  };
}

/**
 * Das festgeschriebene Ergebnis, wie es in `FragtAbstimmung.ergebnis` liegt.
 *
 * Eine eigene Form und nicht `Ergebnis` selbst: was in der Datenbank steht,
 * muss auch dann noch lesbar sein, wenn diese Datei sich aendert. Deshalb nur
 * Zahlen und Zeichenketten, kein berechnetes Feld - `fuehrt` und `gewinner`
 * lassen sich jederzeit wieder ausrechnen, und zwar aus genau denselben
 * Zahlen.
 */
export interface ErgebnisSnapshot {
  /** Die Fassung dieses Formats. Fuer den Fall, dass es sich einmal aendert. */
  version: 1;
  gesamt: number;
  zeilen: Array<{ optionId: string; label: string; position: number; stimmen: number }>;
  geschlossenAm: string;
}

export function zuSnapshot(ergebnis: Ergebnis, geschlossenAm: Date): ErgebnisSnapshot {
  return {
    version: 1,
    gesamt: ergebnis.gesamt,
    zeilen: ergebnis.zeilen.map((zeile) => ({
      optionId: zeile.optionId,
      label: zeile.label,
      position: zeile.position,
      stimmen: zeile.stimmen,
    })),
    geschlossenAm: geschlossenAm.toISOString(),
  };
}

/**
 * Ein gespeichertes Ergebnis zurueck in die gerechnete Form.
 *
 * Gibt `null`, wenn das JSON nicht die erwartete Form hat. Kein Werfen: ein
 * Ergebnis aus einer kuenftigen Fassung soll die Ergebnisliste nicht
 * unbenutzbar machen, sondern als «nicht darstellbar» erscheinen.
 */
export function ausSnapshot(rohdaten: unknown): Ergebnis | null {
  if (typeof rohdaten !== 'object' || rohdaten === null) {
    return null;
  }
  const kandidat = rohdaten as Partial<ErgebnisSnapshot>;
  if (kandidat.version !== 1 || !Array.isArray(kandidat.zeilen)) {
    return null;
  }
  const zeilen: StimmenZeile[] = [];
  for (const zeile of kandidat.zeilen) {
    if (
      typeof zeile?.optionId !== 'string' ||
      typeof zeile?.label !== 'string' ||
      typeof zeile?.position !== 'number' ||
      typeof zeile?.stimmen !== 'number'
    ) {
      return null;
    }
    zeilen.push(zeile);
  }
  return berechneErgebnis(zeilen);
}
