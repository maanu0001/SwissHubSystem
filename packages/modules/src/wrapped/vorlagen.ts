import { z } from 'zod';

/**
 * Wie eine Folie aussieht.
 *
 * ## Warum Vorlagen und nicht je Statistik ein eigenes Bild
 *
 * «Turniersieger» und «meistgewaehltes Spiel» sind dieselbe Aussage: eine
 * Kategorie, ein Name, eine Zahl. Haette jede Statistik ihr eigenes Layout,
 * gaebe es davon zwei Fassungen - und die zweite saehe beim naechsten
 * Redesign anders aus als die erste.
 *
 * Ein Story-Provider liefert deshalb **Daten in der Form einer Vorlage**,
 * nicht ein Bild. Welche Vorlage, sagt er selbst.
 *
 * ## Warum die Daten ein Schema haben
 *
 * `snapshotData` ist eine JSON-Spalte, und eine JSON-Spalte ohne Schema ist
 * ein Ablageplatz. Beim Schreiben wie beim Lesen geht sie deshalb durch
 * `strict()`: ein unbekanntes Feld faellt durch, statt still gespeichert zu
 * werden und beim Zeichnen zu fehlen.
 *
 * ## Warum nur wenig auf einer Folie steht
 *
 * Eine Folie wird auf einem Telefon in ein bis zwei Sekunden gelesen oder
 * gar nicht. Zwanzig kleine Zahlen darauf sind zwanzig ungelesene Zahlen.
 * Die Vorlagen unten erlauben deshalb wenig - und das ist ihre Aufgabe.
 */

export const WRAPPED_VORLAGEN = [
  'INTRO',
  'HERO_NUMBER',
  'TWO_STAT',
  'WINNER',
  'RANKING',
  'IMAGE_MOMENT',
  'MONTH_OVERVIEW',
  'OUTRO',
] as const;

export type WrappedVorlage = (typeof WRAPPED_VORLAGEN)[number];

/** Eine Zahl mit ihrer Beschriftung - der Baustein fast aller Vorlagen. */
const kennzahl = z
  .object({
    /** Fertig formatiert: «2'846». Die Formatierung gehoert zur Erhebung. */
    wert: z.string().min(1).max(24),
    label: z.string().min(1).max(40),
  })
  .strict();

export const VORLAGEN_SCHEMA = {
  /** Die Eroeffnung: Marke, Zeitraum, ein Satz. */
  INTRO: z
    .object({
      periode: z.string().min(1).max(40),
      jahr: z.number().int(),
    })
    .strict(),

  /** Eine grosse Zahl, sonst nichts. Die staerkste Folie des Systems. */
  HERO_NUMBER: z
    .object({
      wert: z.string().min(1).max(24),
      label: z.string().min(1).max(40),
      /** Eine einzelne Zeile darunter - «mehr als 118 Tage». */
      zusatz: z.string().max(80).nullable(),
    })
    .strict(),

  /** Zwei Zahlen nebeneinander. Mehr als zwei waeren eine Tabelle. */
  TWO_STAT: z
    .object({
      links: kennzahl,
      rechts: kennzahl,
    })
    .strict(),

  /** Ein Sieger: Kategorie klein, Name gross, eine Zahl daneben. */
  WINNER: z
    .object({
      kategorie: z.string().min(1).max(40),
      name: z.string().min(1).max(80),
      untertitel: z.string().max(80).nullable(),
      kennzahl: kennzahl.nullable(),
    })
    .strict(),

  /** Eine kurze Rangliste - hoechstens fuenf Zeilen. */
  RANKING: z
    .object({
      kategorie: z.string().min(1).max(40),
      eintraege: z
        .array(z.object({ name: z.string().min(1).max(60), wert: z.string().min(1).max(24) }).strict())
        .min(1)
        .max(5),
    })
    .strict(),

  /** Ein Bild und ein Satz. Die einzige Folie mit einem Foto. */
  IMAGE_MOMENT: z
    .object({
      titel: z.string().min(1).max(80),
      text: z.string().max(200).nullable(),
      /** Adresse des Bildes - aus der Upload-Route, nie eine fremde. */
      bild: z.string().max(300).nullable(),
      datum: z.string().max(40).nullable(),
    })
    .strict(),

  /** Der Verlauf ueber zwoelf Monate - nur in der Jahresausgabe. */
  MONTH_OVERVIEW: z
    .object({
      kategorie: z.string().min(1).max(40),
      einheit: z.string().min(1).max(24),
      monate: z
        .array(
          z
            .object({
              name: z.string().min(1).max(12),
              wert: z.number().nonnegative(),
              anzeige: z.string().min(1).max(16),
            })
            .strict(),
        )
        .length(12),
      /** Der staerkste Monat - nur gesetzt, wenn alle zwoelf Werte vorliegen. */
      bester: z.string().max(20).nullable(),
    })
    .strict(),

  /** Der Abschluss: Dank, Marke, Adresse. */
  OUTRO: z
    .object({
      periode: z.string().min(1).max(40),
    })
    .strict(),
} as const satisfies Record<WrappedVorlage, z.ZodType>;

export type VorlagenDaten<T extends WrappedVorlage> = z.infer<(typeof VORLAGEN_SCHEMA)[T]>;

/**
 * Der redaktionelle Teil - und nur der.
 *
 * Ueberschrift und Begleitsatz. Keine Zahl, kein Name, keine Kennzahl: was
 * erhoben wurde, steht in `snapshotData` und ist von hier aus nicht
 * erreichbar. Ein Tippfehler im Begleitsatz kann deshalb keine Statistik
 * verfaelschen.
 */
export const editorialSchema = z
  .object({
    ueberschrift: z.string().trim().max(60),
    text: z.string().trim().max(200),
  })
  .strict();

export type WrappedEditorial = z.infer<typeof editorialSchema>;

export function istVorlage(key: string): key is WrappedVorlage {
  return (WRAPPED_VORLAGEN as readonly string[]).includes(key);
}

/**
 * Gespeicherte Folien-Daten pruefen.
 *
 * Auch beim **Lesen**, nicht nur beim Schreiben: die Spalte ist aelter als
 * der naechste Stand des Codes, und was daraus kommt, landet in einem Bild,
 * das jemand veroeffentlicht. Passt es nicht, wird die Folie uebersprungen -
 * eine halb gezeichnete Folie waere schlimmer als eine fehlende.
 */
export function lieseVorlagenDaten(
  templateKey: string,
  daten: unknown,
): { vorlage: WrappedVorlage; daten: unknown } | null {
  if (!istVorlage(templateKey)) {
    return null;
  }
  const geprueft = VORLAGEN_SCHEMA[templateKey].safeParse(daten);
  return geprueft.success ? { vorlage: templateKey, daten: geprueft.data } : null;
}

/**
 * Gestaltungsvarianten.
 *
 * Damit nicht jeder Monat exakt gleich aussieht - aber nicht zufaellig: die
 * Variante steht in der Ausgabe und aendert sich beim erneuten Zeichnen
 * nicht. Gewaehlt wird sie deterministisch aus dem Zeitraumschluessel, also
 * bekommt derselbe Monat immer dieselbe.
 */
export const WRAPPED_VARIANTEN = ['kante', 'raster', 'bogen'] as const;
export type WrappedVariante = (typeof WRAPPED_VARIANTEN)[number];

export function varianteFuer(periodKey: string): WrappedVariante {
  // Quersumme der Zeichen - klein, stabil und ohne Abhaengigkeit.
  let summe = 0;
  for (const zeichen of periodKey) {
    summe += zeichen.codePointAt(0) ?? 0;
  }
  return WRAPPED_VARIANTEN[summe % WRAPPED_VARIANTEN.length] as WrappedVariante;
}

export function istVariante(key: string): key is WrappedVariante {
  return (WRAPPED_VARIANTEN as readonly string[]).includes(key);
}
