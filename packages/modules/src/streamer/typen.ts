/**
 * Die laufzeitneutrale Aussenseite des Streamer Hubs.
 *
 * ## Warum es diese Datei gibt
 *
 * Die Oberflaeche braucht zwei Dinge: die Form der oeffentlichen Daten und die
 * Plattformliste. Beides ohne Prisma, ohne `fetch`, ohne `server-only` - sonst
 * zieht eine Client-Komponente den halben Server hinter sich her.
 *
 * `oeffentlich.ts` baut diese Formen und braucht dafuer die Datenbank. Die
 * **Formen selbst** brauchen sie nicht, und deshalb stehen sie hier. Dieselbe
 * Trennung wie `fragt/typen.ts`, und aus demselben Grund: was die Oberflaeche
 * importiert, soll nichts mitbringen.
 *
 * Geprueft wird das nicht von einem Kommentar, sondern von
 * `tests/unit/client-boundary.test.ts` - dort steht dieser Pfad in der Liste
 * der client-sicheren Einstiege, und der Test faellt um, sobald darueber etwas
 * Serverseitiges hereinkommt.
 */
export type { StreamerPlattformId, PlattformAngaben, BewerbungEingabe } from './plattform';
export {
  PLATTFORMEN,
  STREAMER_PLATTFORMEN,
  STREAMER_SPRACHEN,
  bewerbungSchema,
  erkenneKanal,
  hatKanal,
  kanalAdresse,
  embedAdresse,
  plattform,
  streamAdresse,
  vorschaubild,
  KanalEingabeFehler,
} from './plattform';

/** Wie die Inhaberschaft eines Kanals belegt ist - fuer die Darstellung. */
export type KanalBestaetigung = 'plattform' | 'team' | 'offen';

export interface OeffentlicherKanalDaten {
  plattform: 'TWITCH' | 'YOUTUBE';
  handle: string;
  anzeigename: string | null;
  adresse: string;
  bestaetigt: KanalBestaetigung;
}

export interface OeffentlicherStreamDaten {
  titel: string | null;
  spiel: string | null;
  vorschaubildUrl: string | null;
  zuschauer: number | null;
  sprache: string | null;
  gestartetAm: Date;
  streamUrl: string;
  plattform: 'TWITCH' | 'YOUTUBE';
  sessionId: string;
}

export interface OeffentlicherStreamerDaten {
  slug: string;
  discordId: string;
  name: string;
  beschreibung: string | null;
  avatarHash: string | null;
  bannerVerlauf: string;
  bannerBild: string | null;
  sprachen: string[];
  spiele: Array<{ id: string; name: string }>;
  kanaele: OeffentlicherKanalDaten[];
  live: OeffentlicherStreamDaten | null;
  letzterStreamAm: Date | null;
}
