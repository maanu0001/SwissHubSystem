import { z } from 'zod';

/**
 * Was ein Spiel im Katalog sein darf.
 *
 * ## Wenig Pflicht, viel Moeglichkeit
 *
 * Verbindlich ist genau ein Feld: der Name. Alles andere - Kurzform, Cover,
 * Plattformen, Genre, Beschreibung, uebliche Gruppengroesse - hilft, wenn es
 * da ist, und fehlt sonst. Ein Katalog, der fuer jeden Eintrag sieben Angaben
 * verlangt, wird nicht gepflegt, und ein nicht gepflegter Katalog ist
 * schlimmer als ein duenner.
 */

/** Plattformen als freie Liste - eine neue Konsole soll keine Migration brauchen. */
export const PLATTFORMEN = [
  'PC',
  'PlayStation',
  'Xbox',
  'Nintendo Switch',
  'Mobile',
  'VR',
  'Browser',
] as const;

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Der Name braucht mindestens zwei Zeichen.')
  .max(80, 'Der Name ist zu lang (maximal 80 Zeichen).');

/**
 * Eine Adresse fuer das Cover - oder nichts.
 *
 * Nur `https:`. Eine `javascript:`- oder `data:`-Adresse stuende sonst in
 * einem `src`-Attribut, und dort bedeutet sie etwas anderes als «Bild».
 */
const coverUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((wert) => wert === '' || /^https:\/\/\S+$/u.test(wert), {
    message: 'Bitte eine vollständige https-Adresse angeben.',
  })
  .transform((wert) => (wert === '' ? null : wert))
  .nullable()
  .default(null);

export const gameEingabeSchema = z.object({
  name: nameSchema,
  shortName: z
    .string()
    .trim()
    .max(32, 'Die Kurzform ist zu lang (maximal 32 Zeichen).')
    .transform((wert) => (wert === '' ? null : wert))
    .nullable()
    .default(null),
  description: z
    .string()
    .trim()
    .max(500, 'Die Beschreibung ist zu lang (maximal 500 Zeichen).')
    .transform((wert) => (wert === '' ? null : wert))
    .nullable()
    .default(null),
  genre: z
    .string()
    .trim()
    .max(40)
    .transform((wert) => (wert === '' ? null : wert))
    .nullable()
    .default(null),
  /*
   * Gegen eine Liste und nicht frei: die Plattform ist ein Filter, und ein
   * Filter funktioniert nur, solange «PC» nicht auch «pc» und «PC / Steam»
   * heisst.
   */
  platforms: z.array(z.enum(PLATTFORMEN)).max(PLATTFORMEN.length).default([]),
  coverUrl: coverUrlSchema,
  maxPlayers: z.coerce.number().int().min(1).max(100).nullable().default(null),
  enabled: z.boolean().default(true),
});

export type GameEingabe = z.infer<typeof gameEingabeSchema>;

export const gameAnlegenSchema = gameEingabeSchema;

export const gameBearbeitenSchema = gameEingabeSchema.extend({
  gameId: z.string().cuid('Ungültige Spiel-ID'),
});

export type GameBearbeitenEingabe = z.infer<typeof gameBearbeitenSchema>;

export const gameIdSchema = z.object({ gameId: z.string().cuid('Ungültige Spiel-ID') });
