import { z } from 'zod';

/**
 * Was von aussen hereinkommt.
 *
 * Jeder schreibende Befehl traegt einen Idempotenzschluessel. Er kommt aus
 * dem Browser, nicht vom Server: nur der Aufrufer weiss, ob der zweite Klick
 * derselbe Klick war oder ein neuer Wille.
 */
export const befehlsSchluessel = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Ungültiger Befehlsschlüssel.');

export const sessionIdSchema = z
  .string()
  .trim()
  .regex(/^c[a-z0-9]{20,}$/u, 'Ungültige Kennung.');

/**
 * Der Wert im Einladungslink.
 *
 * 32 Hexzeichen - 128 Bit. Nicht zu raten, und ohne Zeichen, die in einer
 * Adresszeile, einer Discord-Nachricht oder beim Abtippen Aerger machen.
 */
export const einladungsSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{32}$/u, 'Ungültiger Einladungslink.');

/**
 * Ein Titel ausserhalb des Katalogs.
 *
 * Die Zeichenliste ist eine Erlaubnisliste und keine Verbotsliste: Buchstaben
 * (auch mit Zeichen darueber), Ziffern, Leerzeichen und die Satzzeichen, die
 * in Spieltiteln wirklich vorkommen. Damit ist alles ausgeschlossen, was wie
 * eine Adresse, ein Tag oder eine Steuersequenz aussieht - ohne dass jemand
 * raten muss, welche Angriffsform gerade modern ist.
 */
export const freierNameSchema = z
  .string()
  .trim()
  .min(2, 'Mindestens zwei Zeichen.')
  .max(60, 'Höchstens 60 Zeichen.')
  .regex(
    /^[\p{L}\p{N} .,'&:!?\-+#()]+$/u,
    'Nur Buchstaben, Ziffern und einfache Satzzeichen. Adressen sind hier nicht vorgesehen.',
  )
  // Ein Titel, der nur aus Satzzeichen besteht, ist kein Titel.
  .refine((wert) => /[\p{L}\p{N}]/u.test(wert), 'Der Titel braucht Buchstaben oder Ziffern.');

export const modusSchema = z.enum(['ROULETTE', 'VOTING', 'ELIMINATION']);
export const gleichstandSchema = z.enum(['STICHWAHL', 'ZUFALL']);

/**
 * Die Einstellungen einer Session.
 *
 * Alle optional: der Schnellstart schickt nichts davon mit und bekommt die
 * Vorgaben des Servers. Wer das Formular aufklappt, aendert einzelne Werte -
 * und nur die.
 */
export const sessionEinstellungenSchema = z.object({
  modus: modusSchema.optional(),
  vorschlaegeProPerson: z.coerce.number().int().min(1).max(10).optional(),
  maxTeilnehmer: z.coerce.number().int().min(2).max(50).optional(),
  freieVorschlaege: z.boolean().optional(),
  abstimmdauerSek: z.coerce.number().int().min(10).max(300).optional(),
  stimmenProPerson: z.coerce.number().int().min(1).max(5).optional(),
  geheimeStimmen: z.boolean().optional(),
  gleichstand: gleichstandSchema.optional(),
  rouletteGewichtet: z.boolean().optional(),
  beitrittWaehrendRunde: z.boolean().optional(),
  nachlosenErlaubt: z.boolean().optional(),
});

export type SessionEinstellungen = z.infer<typeof sessionEinstellungenSchema>;

export const kandidatSchema = z
  .object({
    gameId: z.string().trim().min(1).max(64).optional(),
    freierName: freierNameSchema.optional(),
  })
  .refine(
    (wert) => (wert.gameId ? 1 : 0) + (wert.freierName ? 1 : 0) === 1,
    'Entweder ein Spiel aus dem Katalog oder ein eigener Titel - nicht beides.',
  );

export type KandidatEingabe = z.infer<typeof kandidatSchema>;
