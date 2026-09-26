import type { FragtFragetyp } from '@swisshub/database';

/**
 * Was die vier Fragetypen unterscheidet.
 *
 * ## Warum das eine Tabelle ist und keine Fallunterscheidung
 *
 * Weil sonst an jeder Stelle, die eine Frage anfasst, dieselbe Kette aus
 * `if (typ === …)` stuende: im Formular, bei der Pruefung, im Embed, in der
 * Vorlagenauswahl des Content Studios. Vier Stellen mit derselben Regel sind
 * vier Stellen, an denen sie irgendwann verschieden lautet.
 *
 * Hier steht sie einmal. Ein fuenfter Fragetyp - etwa Freitext - braucht dann
 * einen Eintrag und keine Suche durch das Modul.
 */
export interface FragetypAngaben {
  typ: FragtFragetyp;
  label: string;
  beschreibung: string;
  /** Wie viele Antwortmoeglichkeiten mindestens. */
  minOptionen: number;
  /** Wie viele hoechstens. */
  maxOptionen: number;
  /**
   * Feste Antworten, die das Formular vorgibt.
   *
   * Nur bei Hot Take: dort ist die Frage eine Aussage, und die Antworten sind
   * immer dieselben. Sie frei zu lassen hiesse, dass jede zweite Hot-Take-Frage
   * «Ja / Nein» statt «Stimme zu / Stimme nicht zu» sagt - und die
   * Ergebnisgrafiken waeren nicht mehr vergleichbar.
   */
  festeOptionen?: readonly string[];
  /**
   * Welche Vorlage im Content Studio zuerst vorgeschlagen wird.
   *
   * Ein Entweder-oder gehoert auf die Duell-Vorlage; alles mit mehr als zwei
   * Antworten sieht dort lachhaft aus.
   */
  vorlage: 'winner' | 'results' | 'duel';
}

export const FRAGETYPEN: readonly FragetypAngaben[] = [
  {
    typ: 'ENTWEDER_ODER',
    label: 'Entweder-oder',
    beschreibung: 'Zwei Möglichkeiten, eine Entscheidung. «Controller oder Maus & Tastatur?»',
    minOptionen: 2,
    maxOptionen: 2,
    vorlage: 'duel',
  },
  {
    typ: 'UMFRAGE',
    label: 'Klassische Umfrage',
    beschreibung: 'Zwei bis vier Antworten. «Welches Game verdient ein Remake?»',
    minOptionen: 2,
    maxOptionen: 4,
    vorlage: 'results',
  },
  {
    typ: 'FAVORIT',
    label: 'Community-Favorit',
    beschreibung: 'Mehrere Kandidaten treten gegeneinander an. «Welcher Soundtrack ist der beste?»',
    minOptionen: 3,
    /*
     * Fuenf, nicht mehr.
     *
     * Discord erlaubt fuenf Buttons je Reihe. Mehr Antworten hiessen eine
     * zweite Reihe - und auf einem Telefon ist eine Frage mit acht Knoepfen
     * keine Frage mehr, sondern eine Liste.
     */
    maxOptionen: 5,
    vorlage: 'results',
  },
  {
    typ: 'HOT_TAKE',
    label: 'Hot Take',
    beschreibung: 'Eine Aussage, über die abgestimmt wird. «Singleplayer ist besser als Multiplayer.»',
    minOptionen: 2,
    maxOptionen: 2,
    festeOptionen: ['Stimme zu', 'Stimme nicht zu'],
    vorlage: 'duel',
  },
] as const;

export function fragetyp(typ: FragtFragetyp): FragetypAngaben {
  const angaben = FRAGETYPEN.find((eintrag) => eintrag.typ === typ);
  if (!angaben) {
    // Kann nur passieren, wenn dem Enum ein Wert ohne Eintrag hinzugefuegt
    // wurde. Ein klarer Fehler ist besser als eine Frage ohne Regeln.
    throw new Error(`Fragetyp ${typ} hat keine Angaben in FRAGETYPEN.`);
  }
  return angaben;
}

/**
 * Die Kategorien, aus denen die automatische Auswahl abwechselt.
 *
 * Als Vorschlagsliste, nicht als Zwang: die Kategorie ist ein Freitextfeld,
 * damit sich niemand an eine Liste halten muss, die wir uns heute ausdenken.
 * Die Automatik nutzt sie nur, um nicht dreimal hintereinander nach Soundtracks
 * zu fragen.
 */
export const KATEGORIE_VORSCHLAEGE = [
  'Games',
  'Hardware',
  'Community',
  'Nostalgie',
  'Meinung',
  'SwissHub',
] as const;
