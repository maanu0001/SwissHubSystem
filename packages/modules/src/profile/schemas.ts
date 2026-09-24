import { z } from 'zod';
import { ABSPRACHE, PLATTFORMEN, SPIELZEITEN, SPRACHEN, mehrfachSchema } from './angaben';
import { istAkzent, istBannervorlage, istThema } from './gestaltung';
import { SHOWCASE_PLAETZE, istShowcaseArt, showcaseArt } from './showcase';
import { socialPlattform } from './socials';
import { schemaFuer } from './spielfelder';

/**
 * Was ein Mitglied an seinem Profil aendern darf.
 *
 * ## Ein Schema je Abschnitt, nicht eines fuer alles
 *
 * Der Editor hat sechs Abschnitte, und jeder speichert fuer sich. Ein
 * gemeinsames Schema ueber alle Felder haette zur Folge, dass ein
 * gespeicherter Abschnitt Felder mitschickt, die er gar nicht anzeigt -
 * und dass ein fehlendes Feld die Angabe leert. Getrennte Schemas machen
 * aus «nicht geschickt» ein «nicht veraendert».
 *
 * ## Laengen
 *
 * Grosszuegig genug fuer einen Text, knapp genug, dass ein Profil eine
 * Seite bleibt. Die Obergrenzen stehen hier und nicht in der Datenbank:
 * Postgres wuerde bei einer Ueberschreitung abbrechen, hier entsteht
 * stattdessen eine Meldung, die jemand lesen kann.
 */

const MAX_SPRACHEN = 6;
const MAX_PLATTFORMEN = PLATTFORMEN.length;
const MAX_SPIELZEITEN = SPIELZEITEN.length;
const MAX_ABSPRACHE = 3;

/** Leere Eingabe heisst «nichts angegeben» und wird zu `null`. */
function optionalerText(max: number, feld: string) {
  return z
    .string()
    .trim()
    .max(max, `${feld}: höchstens ${max} Zeichen.`)
    .transform((wert) => (wert.length === 0 ? null : wert))
    .nullable()
    .default(null);
}

export const allgemeinSchema = z.object({
  /*
   * Ein zusaetzlicher Name, kein Ersatz.
   *
   * Der Discord-Name bleibt im Kopf immer sichtbar. Sonst koennte sich
   * jemand hier «SwissHub Admin» nennen und im fremden Profil als jemand
   * anders auftreten.
   */
  displayName: optionalerText(32, 'Profilname'),
  tagline: optionalerText(80, 'Motto'),
  bio: optionalerText(600, 'Über mich'),
  languages: mehrfachSchema('sprachen', MAX_SPRACHEN),
  platforms: mehrfachSchema('plattformen', MAX_PLATTFORMEN),
  playtimes: mehrfachSchema('spielzeiten', MAX_SPIELZEITEN),
  comms: mehrfachSchema('absprache', MAX_ABSPRACHE),
  playStyle: z.enum(['CASUAL', 'COMPETITIVE', 'BOTH']),
  availability: z.enum(['UNSET', 'LOOKING', 'OPEN', 'BUSY']),
});

export type AllgemeinEingabe = z.infer<typeof allgemeinSchema>;

export const gestaltungSchema = z.object({
  // Schluessel, keine Werte: siehe `gestaltung.ts`. Was die Registry nicht
  // kennt, wird hier abgelehnt statt still auf den Standard gesetzt - beim
  // Schreiben ist Schweigen die falsche Antwort.
  theme: z.string().refine(istThema, 'Dieses Thema gibt es nicht.'),
  accent: z.string().refine(istAkzent, 'Diese Akzentfarbe gibt es nicht.'),
  bannerPreset: z
    .string()
    .refine(istBannervorlage, 'Diese Bannervorlage gibt es nicht.')
    .nullable()
    .default(null),
});

export type GestaltungEingabe = z.infer<typeof gestaltungSchema>;

/**
 * Ein verknuepftes Konto.
 *
 * Gespeichert wird eine Kennung, nie eine Adresse - die Adresse baut
 * `socials.ts`. Geprueft wird hier gegen das Muster der jeweiligen
 * Plattform; ein `verified`-Feld gibt es in der Eingabe ueberhaupt nicht,
 * damit niemand es mitschicken kann.
 */
export const socialSchema = z
  .object({
    platform: z.string(),
    handle: z.string().trim().min(1, 'Bitte etwas eintragen.').max(64),
  })
  .superRefine((wert, ctx) => {
    const definition = socialPlattform(wert.platform);
    if (!definition) {
      ctx.addIssue({ code: 'custom', path: ['platform'], message: 'Diese Plattform gibt es nicht.' });
      return;
    }
    if (wert.handle.length > definition.maxLaenge || !definition.muster.test(wert.handle)) {
      ctx.addIssue({
        code: 'custom',
        path: ['handle'],
        message: `Das passt nicht zu einer ${definition.label}-Kennung.`,
      });
    }
  });

export const socialsSchema = z.object({
  eintraege: z
    .array(socialSchema)
    .max(12, 'Höchstens zwölf Konten.')
    .superRefine((liste, ctx) => {
      const gesehen = new Set<string>();
      for (const [index, eintrag] of liste.entries()) {
        if (gesehen.has(eintrag.platform)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'platform'],
            message: 'Diese Plattform steht schon in der Liste.',
          });
        }
        gesehen.add(eintrag.platform);
      }
    }),
});

export type SocialsEingabe = z.infer<typeof socialsSchema>;

/**
 * Ein Spielprofil.
 *
 * `fields` wird gegen die Registry des jeweiligen Spiels geprueft - und zwar
 * `strict()`: ein unbekanntes Feld fuehrt zur Ablehnung, nicht zum stillen
 * Speichern. Ohne das waere die Spalte ein Ablageplatz fuer beliebiges JSON,
 * und genau das soll sie nicht sein.
 *
 * Geprueft wird gegen den **Namen** des Spiels, den der Aufrufer aus dem
 * Katalog nachschlaegt - die Kennung unterscheidet sich je Installation,
 * der Name nicht.
 */
export function spielSchema(spielName: string) {
  return z.object({
    gameId: z.string().min(1),
    platform: z
      .string()
      .trim()
      .max(32)
      .transform((wert) => (wert.length === 0 ? null : wert))
      .nullable()
      .default(null),
    note: optionalerText(200, 'Notiz'),
    favorite: z.boolean().default(false),
    fields: schemaFuer(spielName),
  });
}

export type SpielEingabe = z.infer<ReturnType<typeof spielSchema>>;

/** Die Reihenfolge der Spiele - Kennungen, sonst nichts. */
export const spielReihenfolgeSchema = z.object({
  gameIds: z.array(z.string().min(1)).max(50, 'Höchstens 50 Spiele.'),
});

/**
 * Die Vitrine.
 *
 * Ein Platz je Nummer, hoechstens drei. Ob der Verweis auf etwas Lebendiges
 * zeigt, prueft der Dienst - hier waere es eine Datenbankabfrage im Schema.
 */
export const showcaseSchema = z.object({
  plaetze: z
    .array(
      z
        .object({
          slot: z
            .number()
            .int()
            .min(0)
            .max(SHOWCASE_PLAETZE - 1),
          kind: z.string().refine(istShowcaseArt, 'Diesen Vitrinen-Typ gibt es nicht.'),
          refId: z.string().trim().max(64).nullable().default(null),
        })
        .superRefine((wert, ctx) => {
          const art = showcaseArt(wert.kind);
          if (art?.brauchtVerweis && !wert.refId) {
            ctx.addIssue({ code: 'custom', path: ['refId'], message: 'Bitte etwas auswählen.' });
          }
        }),
    )
    .max(SHOWCASE_PLAETZE)
    .superRefine((liste, ctx) => {
      const gesehen = new Set<number>();
      for (const [index, platz] of liste.entries()) {
        if (gesehen.has(platz.slot)) {
          ctx.addIssue({ code: 'custom', path: [index, 'slot'], message: 'Dieser Platz ist doppelt.' });
        }
        gesehen.add(platz.slot);
      }
    }),
});

export type ShowcaseEingabe = z.infer<typeof showcaseSchema>;

const sichtbarkeit = z.enum(['PUBLIC', 'MEMBERS', 'PRIVATE']);

export const privatsphaereSchema = z.object({
  visibilityProfile: sichtbarkeit,
  visibilityGames: sichtbarkeit,
  visibilitySocials: sichtbarkeit,
  visibilityCareer: sichtbarkeit,
  visibilityActivity: sichtbarkeit,
  discoverable: z.boolean(),
});

export type PrivatsphaereEingabe = z.infer<typeof privatsphaereSchema>;

/** Die Suche in «Mitglieder entdecken». */
export const entdeckenSchema = z.object({
  suche: z.string().trim().max(80).default(''),
  gameId: z.string().trim().max(64).nullable().default(null),
  plattform: z
    .string()
    .refine((wert) => PLATTFORMEN.some((p) => p.key === wert), 'Diese Plattform gibt es nicht.')
    .nullable()
    .default(null),
  spielart: z.enum(['CASUAL', 'COMPETITIVE', 'BOTH']).nullable().default(null),
  sprache: z
    .string()
    .refine((wert) => SPRACHEN.some((s) => s.key === wert), 'Diese Sprache gibt es nicht.')
    .nullable()
    .default(null),
  spielzeit: z
    .string()
    .refine((wert) => SPIELZEITEN.some((s) => s.key === wert), 'Diese Spielzeit gibt es nicht.')
    .nullable()
    .default(null),
  absprache: z
    .string()
    .refine((wert) => ABSPRACHE.some((a) => a.key === wert), 'Diese Angabe gibt es nicht.')
    .nullable()
    .default(null),
  verfuegbarkeit: z.enum(['LOOKING', 'OPEN', 'BUSY']).nullable().default(null),
  seite: z.number().int().min(1).max(500).default(1),
});

export type EntdeckenEingabe = z.infer<typeof entdeckenSchema>;
