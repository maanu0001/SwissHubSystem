import { z } from 'zod';

/**
 * Die Mehrfachangaben eines Profils: Sprachen, Spielzeiten, Plattformen,
 * Absprache.
 *
 * ## Warum Listen und keine freien Felder
 *
 * «Abends» und «am Abend» und «meist nach 20 Uhr» meinen dasselbe und lassen
 * sich nicht gemeinsam filtern. Die Mitgliedersuche soll aber genau danach
 * suchen koennen. Deshalb Schluessel aus einer festen Liste - und dafuer
 * darueber ein freies Feld (`bio`), in dem alles stehen darf, was hier nicht
 * hineinpasst.
 *
 * Gespeichert wird der Schluessel, angezeigt das Label. Was die Liste nicht
 * mehr kennt, faellt beim Anzeigen weg statt einen Fehler zu werfen - eine
 * Angabe zu verlieren ist unangenehm, eine kaputte Profilseite schlimmer.
 */

export interface Auswahl {
  key: string;
  label: string;
}

/** Sprachen - die vier Landessprachen zuerst, dann was im Server vorkommt. */
export const SPRACHEN: readonly Auswahl[] = [
  { key: 'de', label: 'Deutsch' },
  { key: 'gsw', label: 'Schweizerdeutsch' },
  { key: 'fr', label: 'Französisch' },
  { key: 'it', label: 'Italienisch' },
  { key: 'rm', label: 'Rätoromanisch' },
  { key: 'en', label: 'Englisch' },
  { key: 'es', label: 'Spanisch' },
  { key: 'pt', label: 'Portugiesisch' },
  { key: 'sq', label: 'Albanisch' },
  { key: 'sr', label: 'Serbisch/Kroatisch/Bosnisch' },
  { key: 'tr', label: 'Türkisch' },
  { key: 'ta', label: 'Tamil' },
  { key: 'nl', label: 'Niederländisch' },
  { key: 'pl', label: 'Polnisch' },
  { key: 'ru', label: 'Russisch' },
];

/**
 * Spielzeiten - grob, absichtlich.
 *
 * Eine Uhrzeit auf die Viertelstunde genau waere eine Verpflichtung. Hier
 * geht es um «wann trifft man dich ungefaehr an».
 */
export const SPIELZEITEN: readonly Auswahl[] = [
  { key: 'wochentag-morgen', label: 'Wochentags morgens' },
  { key: 'wochentag-nachmittag', label: 'Wochentags nachmittags' },
  { key: 'wochentag-abend', label: 'Wochentags abends' },
  { key: 'wochentag-nacht', label: 'Wochentags spätnachts' },
  { key: 'wochenende-tag', label: 'Wochenende tagsüber' },
  { key: 'wochenende-abend', label: 'Wochenende abends' },
  { key: 'wochenende-nacht', label: 'Wochenende spätnachts' },
  { key: 'unregelmaessig', label: 'Unregelmässig' },
];

/**
 * Plattformen.
 *
 * Dieselben Namen wie im Spielekatalog (`games/schemas.ts`), damit «PC» im
 * Profil und «PC» beim Spiel dasselbe Wort bleiben und ein Filter beide
 * Seiten trifft. Bewusst nicht importiert: der Katalog fuehrt Plattformen
 * eines Spiels, hier steht, worauf jemand spielt - zwei Bedeutungen, die
 * heute uebereinstimmen und morgen auseinandergehen duerfen.
 */
export const PLATTFORMEN: readonly Auswahl[] = [
  { key: 'PC', label: 'PC' },
  { key: 'PlayStation', label: 'PlayStation' },
  { key: 'Xbox', label: 'Xbox' },
  { key: 'Nintendo Switch', label: 'Nintendo Switch' },
  { key: 'Mobile', label: 'Mobile' },
  { key: 'VR', label: 'VR' },
];

/** Wie jemand sich beim Spielen abspricht. */
export const ABSPRACHE: readonly Auswahl[] = [
  { key: 'voice-immer', label: 'Immer im Voice' },
  { key: 'voice-manchmal', label: 'Voice je nach Runde' },
  { key: 'voice-nie', label: 'Lieber ohne Voice' },
  { key: 'text', label: 'Text reicht mir' },
  { key: 'push-to-talk', label: 'Push-to-Talk' },
];

/** Spielart - entspricht dem Enum `PlayStyle` im Schema. */
export const SPIELART: readonly Auswahl[] = [
  { key: 'CASUAL', label: 'Casual' },
  { key: 'COMPETITIVE', label: 'Competitive' },
  { key: 'BOTH', label: 'Beides' },
];

/** Verfuegbarkeit - entspricht dem Enum `Availability` im Schema. */
export const VERFUEGBARKEIT: readonly Auswahl[] = [
  { key: 'UNSET', label: 'Keine Angabe' },
  { key: 'LOOKING', label: 'Sucht Mitspieler' },
  { key: 'OPEN', label: 'Offen für Anfragen' },
  { key: 'BUSY', label: 'Gerade wenig Zeit' },
];

function nachschlag(liste: readonly Auswahl[]): Map<string, string> {
  return new Map(liste.map((e) => [e.key, e.label]));
}

const LABELS = {
  sprachen: nachschlag(SPRACHEN),
  spielzeiten: nachschlag(SPIELZEITEN),
  plattformen: nachschlag(PLATTFORMEN),
  absprache: nachschlag(ABSPRACHE),
  spielart: nachschlag(SPIELART),
  verfuegbarkeit: nachschlag(VERFUEGBARKEIT),
} as const;

export type Angabenart = keyof typeof LABELS;

/** Ein einzelnes Label - oder `null`, wenn der Schluessel unbekannt ist. */
export function label(art: Angabenart, key: string): string | null {
  return LABELS[art].get(key) ?? null;
}

/**
 * Gespeicherte Schluessel zu Labels machen.
 *
 * Unbekanntes faellt weg, die Reihenfolge der Liste gewinnt ueber die
 * Reihenfolge der Speicherung: so stehen Sprachen immer in derselben
 * Ordnung, egal in welcher Reihenfolge sie angeklickt wurden.
 */
export function labels(art: Angabenart, keys: readonly string[]): string[] {
  const gesetzt = new Set(keys);
  const ergebnis: string[] = [];
  for (const [key, text] of LABELS[art]) {
    if (gesetzt.has(key)) {
      ergebnis.push(text);
    }
  }
  return ergebnis;
}

/**
 * Ein Zod-Schema fuer eine Mehrfachauswahl.
 *
 * Unbekannte Schluessel werden hier nicht stillschweigend entfernt, sondern
 * abgelehnt: beim Schreiben ist Schweigen die falsche Antwort - es sieht fuer
 * den Absender aus, als waere die Angabe gespeichert worden.
 */
export function mehrfachSchema(art: Angabenart, maxAnzahl: number): z.ZodType<string[]> {
  const erlaubt = LABELS[art];
  return z
    .array(z.string())
    .max(maxAnzahl, `Höchstens ${maxAnzahl} Einträge.`)
    .refine((werte) => werte.every((wert) => erlaubt.has(wert)), 'Diese Auswahl gibt es nicht.')
    .transform((werte) => [...new Set(werte)]);
}
