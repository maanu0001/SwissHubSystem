/**
 * Die Vitrine - drei Plaetze, auf die ein Mitglied stellt, worauf es stolz
 * ist.
 *
 * ## Warum ein Verweis und keine Abschrift
 *
 * Ein Vitrinenplatz speichert `kind` und `refId` - «Turnier X» -, nicht den
 * Turniernamen und das Cover. Eine Abschrift waere schnell und haette ab dann
 * zwei Wahrheiten: wird das Turnier umbenannt, steht im Profil weiter der
 * alte Name, und niemand merkt es. Dieselbe Ueberlegung wie bei der
 * Clip-Bilanz.
 *
 * ## Was passiert, wenn der Verweis ins Leere geht
 *
 * Nichts Sichtbares. Ein archiviertes Turnier, ein geloeschtes Spiel, eine
 * Auszeichnung, die es nicht mehr gibt: der Platz wird uebersprungen, die
 * uebrigen ruecken nicht nach, und es erscheint weder ein Fehler noch ein
 * leerer Rahmen mit «nicht verfuegbar». Ein Turniererfolg darf nicht
 * verschwinden, nur weil das Turnier archiviert wurde - deshalb liest der
 * Aufloeser auch archivierte Turniere; verschwinden tut ein Platz erst, wenn
 * die Sache wirklich weg ist.
 *
 * ## Warum die Registry hier steht und die Aufloeser woanders
 *
 * Diese Datei kennt keine Datenbank. Damit darf der Editor sie importieren,
 * ohne das halbe Backend in den Browser zu ziehen. Was ein Verweis
 * tatsaechlich bedeutet, loest `service.ts` auf - dort, wo Prisma ohnehin
 * schon ist.
 */

/** Drei Plaetze. Mehr waere eine Liste, und eine Liste ist keine Vitrine. */
export const SHOWCASE_PLAETZE = 3;

export interface ShowcaseArt {
  key: string;
  label: string;
  /** Ein Satz im Editor - was man hier hinstellt. */
  beschreibung: string;
  /** Name eines Lucide-Symbols. Die Ansicht schlaegt ihn in ihrer Karte nach. */
  symbol: string;
  /**
   * Braucht dieser Typ einen Verweis?
   *
   * «Level» nicht: das Level steht im XP-System und gehoert der Person, nicht
   * einem Datensatz. Alles andere zeigt auf etwas Bestimmtes.
   */
  brauchtVerweis: boolean;
}

const ARTEN: readonly ShowcaseArt[] = [
  {
    key: 'game',
    label: 'Lieblingsspiel',
    beschreibung: 'Ein Spiel aus deinem Profil - gross, mit Cover und deinen Angaben.',
    symbol: 'Gamepad2',
    brauchtVerweis: true,
  },
  {
    key: 'tournament',
    label: 'Turnier',
    beschreibung: 'Ein Turnier, an dem du teilgenommen hast - mit Platzierung, falls vorhanden.',
    symbol: 'Trophy',
    brauchtVerweis: true,
  },
  {
    key: 'achievement',
    label: 'Auszeichnung',
    beschreibung: 'Eine deiner Auszeichnungen.',
    symbol: 'Medal',
    brauchtVerweis: true,
  },
  {
    key: 'level',
    label: 'Level',
    beschreibung: 'Dein aktuelles Level und der Fortschritt zum nächsten.',
    symbol: 'Sparkles',
    brauchtVerweis: false,
  },
  {
    key: 'clip',
    label: 'Clip of the Week',
    beschreibung: 'Eine Runde, in der dein Clip vorne lag.',
    symbol: 'Clapperboard',
    brauchtVerweis: true,
  },
  {
    key: 'event',
    label: 'Event',
    beschreibung: 'Ein Event aus dem Kalender, für das du angemeldet warst.',
    symbol: 'CalendarDays',
    brauchtVerweis: true,
  },
  {
    key: 'social',
    label: 'Gaming-Konto',
    beschreibung: 'Eines deiner verknüpften Konten - gross und zum Anklicken.',
    symbol: 'Link2',
    brauchtVerweis: true,
  },
];

const NACH_KEY = new Map(ARTEN.map((a) => [a.key, a]));

export function alleShowcaseArten(): readonly ShowcaseArt[] {
  return ARTEN;
}

export function showcaseArt(key: string): ShowcaseArt | undefined {
  return NACH_KEY.get(key);
}

export function istShowcaseArt(key: string): boolean {
  return NACH_KEY.has(key);
}

/** Ein Platz ist gueltig, wenn Art und Verweis zusammenpassen. */
export function istGueltigerPlatz(slot: number, kind: string, refId: string | null): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SHOWCASE_PLAETZE) {
    return false;
  }
  const art = NACH_KEY.get(kind);
  if (!art) {
    return false;
  }
  return art.brauchtVerweis ? typeof refId === 'string' && refId.length > 0 : true;
}

/**
 * Was die Ansicht am Ende zeichnet.
 *
 * Bewusst flach und ohne Bezug auf Prisma-Typen: die Karte soll ein Turnier
 * und ein Spiel gleich darstellen koennen, ohne beide zu kennen.
 */
export interface ShowcaseKarte {
  slot: number;
  kind: string;
  symbol: string;
  /** Die Zeile darueber - «Turnier», «Auszeichnung». */
  art: string;
  titel: string;
  untertitel: string | null;
  /** Eine kurze, hervorgehobene Angabe: «1. Platz», «Level 42». */
  auszeichnung: string | null;
  /** Bildquelle, falls es eine gibt - Cover, Vorschaubild. */
  bild: string | null;
  /** Ziel innerhalb der Anwendung, nie nach aussen ausser bei `social`. */
  link: string | null;
}
