/**
 * Der gemeinsame Stand der Live-Kacheln - ohne React, damit er prüfbar ist.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil der Fehler, den diese Datei verhindert, in einer Komponente steckte und
 * dort nicht zu prüfen war: die Testumgebung dieses Projekts ist `node`, und
 * `tests/**` liest nur `.ts`. Eine Zusage, die sich nur am Quelltext prüfen
 * lässt, ist eine halbe Zusage - sie hält, bis jemand die Zeile umformuliert.
 *
 * Hier steht deshalb das Verhalten, und die Komponente daneben ist nur noch
 * die Verdrahtung mit React: abonnieren, Takt geben, abrufen.
 *
 * ## Der Fehler, um den es geht
 *
 * Die Statistikseite wechselt den Zeitraum mit `router.push` - eine weiche
 * Navigation. Der Server rendert die Kacheln mit den neuen Zahlen, die
 * Komponente bleibt dabei aber montiert, und dieser Speicher überlebt
 * ebenfalls. Stand darin noch die Antwort des **vorigen** Zeitraums, gewann
 * sie gegen den frisch gerenderten Serverwert:
 *
 *     const quelle = stand?.[feld] ?? { sekunden: basisSekunden, wachsend };
 *
 * Wer von 30 Tagen auf 1 Tag wechselte, sah weiter die 30-Tage-Sprachzeit -
 * bis zum nächsten Abgleich, also bis zu dreissig Sekunden lang. Wer die
 * Knöpfe durchklickte, bekam jedes Mal den Wert der vorigen Auswahl und las
 * das als «die Zahl ändert sich nicht».
 *
 * Ein Zwischenspeicher, dessen Schlüssel den Zeitraum nicht enthält, ist genau
 * dieser Fehler - ob er nun auf dem Server liegt oder im Browser. Deshalb
 * trägt jeder Stand hier die Abfrage, zu der er gehört, und `standFuer`
 * antwortet nur, wenn beide übereinstimmen.
 */

export interface LiveStand {
  /** Serverzeit des Standes, als Millisekunden. */
  asOf: number;
  zeitraum: { sekunden: number; wachsend: number };
  heute: { sekunden: number; wachsend: number };
  imSprachkanal: number;
  aktive: number;
  sitzungen: number;
}

/**
 * Was die Kacheln lesen.
 *
 * `folge` zählt bei jedem Abgleich **und** bei jedem Takt hoch. Ohne sie bliebe
 * die Momentaufnahme identisch, React zeichnete nicht neu, und die Zahl stünde
 * still, obwohl die Zeit läuft.
 */
export interface Momentaufnahme {
  folge: number;
  stand: LiveStand | null;
  /** Die Abfrage, zu der `stand` gehört - `null`, solange keiner da ist. */
  schluessel: string | null;
}

export interface LiveSpeicher {
  /** Die aktuelle Momentaufnahme - die Lesefunktion für `useSyncExternalStore`. */
  lies(): Momentaufnahme;
  /** Der Stand, aber nur wenn er zu dieser Abfrage gehört. Sonst `null`. */
  standFuer(abfrage: string): LiveStand | null;
  /** Die Abfrage, die gerade gelten soll. */
  gewuenschteAbfrage(): string;
  /** Wie viele Kacheln gerade zuhören. */
  zuhoererZahl(): number;
  abonniere(ruf: () => void): () => void;
  /**
   * Den Zeitraum wechseln. Liefert `true`, wenn es wirklich einer war -
   * dann lohnt sich ein Abruf.
   */
  setzeAbfrage(abfrage: string): boolean;
  /**
   * Einen abgerufenen Stand übernehmen. Liefert `false`, wenn er verworfen
   * wurde, weil er zu einer anderen Abfrage gehört.
   */
  uebernimm(stand: LiveStand, fuer: string): boolean;
  /** Neu zeichnen lassen, ohne neue Daten - der Takt zwischen zwei Abgleichen. */
  schlag(): void;
  /** Wächst gerade etwas? Vor der ersten Antwort gilt «ja». */
  waechst(): boolean;
}

export function erzeugeLiveSpeicher(): LiveSpeicher {
  let aktuell: Momentaufnahme = { folge: 0, stand: null, schluessel: null };
  let gewuenscht = '';
  const zuhoerer = new Set<() => void>();

  function melde(stand: LiveStand | null, schluessel: string | null): void {
    aktuell = { folge: aktuell.folge + 1, stand, schluessel };
    for (const ruf of zuhoerer) {
      ruf();
    }
  }

  return {
    lies: () => aktuell,

    standFuer: (abfrage) => (aktuell.schluessel === abfrage ? aktuell.stand : null),

    gewuenschteAbfrage: () => gewuenscht,

    zuhoererZahl: () => zuhoerer.size,

    abonniere(ruf) {
      zuhoerer.add(ruf);
      return () => {
        zuhoerer.delete(ruf);
      };
    },

    setzeAbfrage(abfrage) {
      if (gewuenscht === abfrage) {
        return false;
      }
      gewuenscht = abfrage;
      /*
       * Den bisherigen Stand verwerfen und nicht behalten, bis der neue da
       * ist: er beantwortet eine andere Frage. Was in der Lücke steht, hat
       * der Server gerade mitgerendert und ist richtig.
       */
      melde(null, null);
      return true;
    },

    uebernimm(stand, fuer) {
      /*
       * Eine Antwort von gestern verwerfen.
       *
       * Wer schnell zwischen den Zeiträumen klickt, hat mehrere Anfragen
       * unterwegs, und sie kommen nicht zwingend der Reihe nach zurück. Ohne
       * diese Prüfung überschriebe die langsamere die richtige - und zwar
       * unbemerkt, weil beide Antworten für sich genommen gültig aussehen.
       */
      if (fuer !== gewuenscht) {
        return false;
      }
      melde(stand, fuer);
      return true;
    },

    schlag() {
      melde(aktuell.stand, aktuell.schluessel);
    },

    waechst() {
      const stand = aktuell.stand;
      // Vor der ersten Antwort gilt, was der Server mitgegeben hat - und das
      // kann wachsen. Lieber einmal zu viel gezählt als eine Kachel, die steht.
      return stand ? stand.zeitraum.wachsend > 0 || stand.heute.wachsend > 0 : true;
    },
  };
}

/** Ein Abonnement für alle Kacheln - sonst holten fünf Karten fünfmal dasselbe. */
export const liveSpeicher = erzeugeLiveSpeicher();
