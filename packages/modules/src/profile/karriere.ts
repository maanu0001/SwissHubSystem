/**
 * Die SwissHub-Karriere - eine Zeitleiste statt einer Protokolltabelle.
 *
 * ## Was hier hineindarf
 *
 * Nur Belegtes. Der Serverbeitritt steht im Discord-Spiegel, ein
 * Turnierergebnis im Turnier, ein Clip-Sieg in der abgeschlossenen Runde.
 * Was niemand erhoben hat, kommt nicht vor - lieber eine kurze Zeitleiste
 * als eine erfundene.
 *
 * Levelaufstiege fehlen bewusst: gespeichert ist der heutige XP-Stand, nicht
 * wann welche Schwelle fiel. Ein aus der Kurve zurueckgerechnetes Datum
 * waere geraten. Das erreichte Level steht deshalb als ein Eintrag «heute»
 * in der Leiste, nicht als Kette von Aufstiegen.
 *
 * ## Warum die Typen hier stehen
 *
 * Damit die Ansicht sie importieren kann, ohne Prisma mitzuziehen.
 * Zusammengetragen werden die Eintraege im Dienst.
 */

export type MeilensteinArt = 'beitritt' | 'turnier' | 'turnier-sieg' | 'clip-sieg' | 'event' | 'level';

export interface Meilenstein {
  /** Eindeutig innerhalb einer Zeitleiste - `art:refId` oder nur `art`. */
  key: string;
  art: MeilensteinArt;
  /** `null` heisst «ohne Datum» und landet am Ende, nicht am Anfang. */
  am: Date | null;
  titel: string;
  beschreibung: string | null;
  /** Name eines Lucide-Symbols. */
  symbol: string;
  /** Ziel innerhalb der Anwendung. */
  link: string | null;
  /** Hebt den Eintrag hervor - Siege, Hoechstlevel. */
  hervorgehoben: boolean;
}

/**
 * Neueste zuerst.
 *
 * Eintraege ohne Datum ganz ans Ende: sie nach vorne zu setzen hiesse zu
 * behaupten, sie seien von heute.
 */
export function sortiere(meilensteine: readonly Meilenstein[]): Meilenstein[] {
  return [...meilensteine].sort((a, b) => {
    if (a.am && b.am) {
      return b.am.getTime() - a.am.getTime();
    }
    if (a.am) {
      return -1;
    }
    if (b.am) {
      return 1;
    }
    return a.key.localeCompare(b.key);
  });
}
