import { prisma } from '@swisshub/database';
import type { StreamerPlattform } from '@swisshub/database';
import { bannervorlage } from '../profile/gestaltung';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { STREAMER_MODULE_ID, type StreamerSettings } from './config';
import { kanalAdresse, streamAdresse, vorschaubild } from './plattform';
import type { OeffentlicherKanalDaten, OeffentlicherStreamDaten, OeffentlicherStreamerDaten } from './typen';

/**
 * Was ohne Anmeldung herausgeht - und nur das.
 *
 * ## Die eine Stelle
 *
 * Alles, was `/streamer` und `/streamer/<slug>` ausliefern, kommt hier durch.
 * Dieselbe Regel wie beim oeffentlichen Profil (`profile/oeffentlich.ts`):
 * gebaut wird **aufzaehlend**, nicht abziehend. Es entsteht ein neues Objekt
 * aus benannten Feldern, statt aus einem vollen Datensatz etwas zu loeschen.
 *
 * Der Unterschied zaehlt beim naechsten Feld, das jemand dem Streamer-Profil
 * hinzufuegt - abziehend waere es sofort oeffentlich, und niemand haette es
 * entschieden.
 *
 * ## Was hier nicht vorkommt
 *
 * Kein Ablehnungsgrund, kein Pausierungsgrund, kein `entschiedenVon`, kein
 * `letzterFehler` der Plattformabfrage, keine interne Kennung eines Kanals,
 * keine E-Mail, keine Rollen, kein Level, keine Moderationsdaten. Sie kommen
 * nicht vor, weil die Abfragen unten sie nicht laden - hier wird nichts
 * herausgefiltert, was vorher da war.
 *
 * Die **Discord-Kennung** ist die eine Ausnahme, und sie ist keine: ohne sie
 * gaebe es kein Avatarbild, denn Discords CDN adressiert danach. Genau so
 * haelt es das oeffentliche Profil.
 *
 * ## Und was mit nicht freigegebenen Streamern passiert
 *
 * Sie existieren fuer diese Datei nicht. `status: 'APPROVED'` steht in jeder
 * Abfrage - eine Bewerbung in Pruefung, eine abgelehnte und eine pausierte
 * sind oeffentlich nicht unterscheidbar von «gibt es nicht».
 */

/*
 * Die Formen stehen in `typen.ts` - laufzeitneutral, damit die Oberflaeche sie
 * importieren kann, ohne Prisma mitzubringen. Hier sind sie nur unter dem Namen
 * verfuegbar, unter dem dieses Modul sie benutzt.
 */
export type OeffentlicherKanal = OeffentlicherKanalDaten;
export type OeffentlicherStream = OeffentlicherStreamDaten;
export type OeffentlicherStreamer = OeffentlicherStreamerDaten;

const bestaetigung = (verifikation: string): OeffentlicherKanal['bestaetigt'] =>
  verifikation === 'OAUTH' ? 'plattform' : verifikation === 'MANUELL' ? 'team' : 'offen';

/**
 * Die Auswahl, die jede oeffentliche Abfrage benutzt.
 *
 * Als Konstante, damit es sie genau einmal gibt. Zwei Abfragen mit
 * handgeschriebenen `select`-Bloecken waeren zwei Allowlists, und die zweite
 * bekaeme irgendwann ein Feld, das die erste nicht hat.
 */
const AUSWAHL = {
  discordId: true,
  beschreibung: true,
  sprachen: true,
  kanaele: {
    where: { aktiv: true },
    select: {
      plattform: true,
      handle: true,
      anzeigename: true,
      verifikation: true,
    },
    orderBy: { plattform: 'asc' },
  },
} as const;

/** Der Zusatz, der nicht am Streamer-Profil haengt: Name, Bild, Spiele, Slug. */
interface Beiwerk {
  slug: string | null;
  name: string;
  avatarHash: string | null;
  bannerPfad: string | null;
  bannerVorlage: string | null;
  spiele: Array<{ id: string; name: string }>;
}

/**
 * Name, Bild, Banner und Spiele - aus dem Mitgliedsprofil.
 *
 * **Hier wird nichts kopiert.** Das ist der Kern der Aufgabenstellung: ein
 * Streamer-Profil hat keinen eigenen Namen und kein eigenes Banner, sondern
 * liest beides dort, wo es ohnehin steht. Wer sein Profilbanner aendert, hat
 * es damit auch auf der Streamer-Seite geaendert.
 *
 * Gebuendelt fuer alle Streamer auf einmal: eine Abfrage je Streamer waere bei
 * zwanzig Streamern zwanzig Abfragen fuer eine Uebersichtsseite.
 */
async function ladeBeiwerk(discordIds: readonly string[]): Promise<Map<string, Beiwerk>> {
  if (discordIds.length === 0) {
    return new Map();
  }
  const [profile, mitglieder] = await Promise.all([
    prisma.memberProfile.findMany({
      where: { discordId: { in: [...discordIds] } },
      select: {
        discordId: true,
        displayName: true,
        publicSlug: true,
        bannerPath: true,
        bannerPreset: true,
        visibilityProfile: true,
        visibilityGames: true,
        games: {
          where: { favorite: true },
          select: { game: { select: { id: true, name: true } } },
          take: 6,
        },
      },
    }),
    prisma.discordMemberCache.findMany({
      where: { discordId: { in: [...discordIds] } },
      select: { discordId: true, displayName: true, username: true, avatarHash: true },
    }),
  ]);

  const nachId = new Map(mitglieder.map((eintrag) => [eintrag.discordId, eintrag]));
  const ergebnis = new Map<string, Beiwerk>();

  for (const profil of profile) {
    const mitglied = nachId.get(profil.discordId);
    ergebnis.set(profil.discordId, {
      slug: profil.publicSlug,
      name:
        profil.displayName?.trim() ||
        mitglied?.displayName?.trim() ||
        mitglied?.username?.trim() ||
        'SwissHub-Mitglied',
      avatarHash: mitglied?.avatarHash ?? null,
      /*
       * Das Banner nur, wenn das Profil oeffentlich steht. Ein Streamer, der
       * sein Profil privat haelt, hat damit nicht gesagt, dass sein Banner auf
       * einer oeffentlichen Seite erscheinen darf - die Bewerbung als Streamer
       * ist eine Zustimmung zur Streamer-Seite, nicht zum ganzen Profil.
       */
      bannerPfad: profil.visibilityProfile === 'PUBLIC' ? profil.bannerPath : null,
      bannerVorlage: profil.visibilityProfile === 'PUBLIC' ? profil.bannerPreset : null,
      /*
       * Die Spiele nur, wenn die Person sie oeffentlich zeigt. Dieselbe
       * Entscheidung wie im Profil, und sie wird hier nicht ueberstimmt.
       */
      spiele:
        profil.visibilityGames === 'PUBLIC'
          ? profil.games.map((eintrag) => ({ id: eintrag.game.id, name: eintrag.game.name }))
          : [],
    });
  }

  // Wer kein Mitgliedsprofil hat, bekommt trotzdem einen Namen - sonst faellt
  // er aus der Liste, obwohl er freigegeben ist.
  for (const discordId of discordIds) {
    if (!ergebnis.has(discordId)) {
      const mitglied = nachId.get(discordId);
      ergebnis.set(discordId, {
        slug: null,
        name: mitglied?.displayName?.trim() || mitglied?.username?.trim() || 'SwissHub-Mitglied',
        avatarHash: mitglied?.avatarHash ?? null,
        bannerPfad: null,
        bannerVorlage: null,
        spiele: [],
      });
    }
  }

  return ergebnis;
}

interface RohKanal {
  plattform: StreamerPlattform;
  handle: string;
  anzeigename: string | null;
  verifikation: string;
}

interface RohProfil {
  discordId: string;
  beschreibung: string | null;
  sprachen: string[];
  kanaele: RohKanal[];
}

function baue(
  profil: RohProfil,
  beiwerk: Beiwerk,
  live: OeffentlicherStream | null,
  letzterStreamAm: Date | null,
): OeffentlicherStreamer | null {
  /*
   * Ohne Slug keine oeffentliche Seite.
   *
   * Der Slug entsteht, wenn jemand sein Profil oeffentlich stellt. Fehlt er,
   * gibt es keine stabile Adresse - und eine Karte, die auf nichts verweist,
   * gehoert nicht in eine Uebersicht.
   */
  if (!beiwerk.slug) {
    return null;
  }
  return {
    slug: beiwerk.slug,
    discordId: profil.discordId,
    name: beiwerk.name,
    beschreibung: profil.beschreibung,
    avatarHash: beiwerk.avatarHash,
    bannerVerlauf: bannervorlage(beiwerk.bannerVorlage).verlauf,
    /*
     * **Nicht** `bannerQuelle` aus dem Profildienst.
     *
     * Die zeigt auf `/api/profil/<id>/banner`, und die Route verlangt eine
     * Mitgliedschaft - richtig fuer ein Profil, falsch hier: ein anonymer
     * Besucher bekaeme eine 401 und saehe eine Seite mit Verlauf statt Banner,
     * ohne dass jemand wuesste, warum.
     *
     * `/api/streamer/banner/<slug>` ist die enge Oeffnung dafuer: sie liefert
     * ausschliesslich Banner freigegebener Streamer mit aktivem Kanal. Der
     * Zeitstempel im Parameter bricht den Zwischenspeicher, wenn jemand sein
     * Banner wechselt.
     */
    bannerBild: beiwerk.bannerPfad
      ? `/api/streamer/banner/${encodeURIComponent(beiwerk.slug)}?v=${beiwerk.bannerPfad.slice(-12)}`
      : null,
    sprachen: profil.sprachen,
    spiele: beiwerk.spiele,
    kanaele: profil.kanaele.map((kanal) => ({
      plattform: kanal.plattform,
      handle: kanal.handle,
      anzeigename: kanal.anzeigename,
      adresse: kanalAdresse(kanal.plattform, kanal.handle),
      bestaetigt: bestaetigung(kanal.verifikation),
    })),
    live,
    letzterStreamAm,
  };
}

export interface OeffentlicheListe {
  live: OeffentlicherStreamer[];
  offline: OeffentlicherStreamer[];
  /** Die Filterwerte, die in den Daten wirklich vorkommen. */
  filter: {
    spiele: Array<{ id: string; name: string }>;
    plattformen: StreamerPlattform[];
    sprachen: string[];
  };
}

export interface ListenFilter {
  suche?: string;
  spielId?: string;
  plattform?: StreamerPlattform;
  sprache?: string;
  nurLive?: boolean;
}

/**
 * Die oeffentliche Streamerliste.
 *
 * Live zuerst, und zwar nicht durch Sortierung, sondern als eigene Liste: die
 * Seite zeigt zwei Abschnitte, und eine gemischte Liste mit einem Flag muesste
 * sie erst wieder auseinandernehmen.
 *
 * Gefiltert wird **nach** dem Bauen. Der Grund ist unbequem, aber richtig: die
 * Spiele und der Name stehen im Mitgliedsprofil und sind bereits durch die
 * Sichtbarkeitsregeln gegangen. Ein Filter in SQL ueber `MemberProfile.games`
 * wuerde auch Streamer finden, deren Spiele privat sind - und sie damit
 * verraten.
 */
export async function ladeOeffentlicheListe(filter: ListenFilter = {}): Promise<OeffentlicheListe> {
  const profile = await prisma.streamerProfil.findMany({
    where: {
      status: 'APPROVED',
      // Ein Streamer ohne aktiven Kanal hat nichts zu zeigen.
      kanaele: { some: { aktiv: true } },
    },
    select: AUSWAHL,
  });

  const discordIds = profile.map((profil) => profil.discordId);
  const beiwerk = await ladeBeiwerk(discordIds);

  /*
   * Die laufenden Sessions - eine Abfrage fuer alle.
   *
   * `beendetAm: null` ist die Definition von «jetzt live». Sie steht hier
   * genau einmal; die Uebersicht und die Detailseite lesen dieselbe.
   */
  const laufende = await prisma.streamerSession.findMany({
    where: { beendetAm: null, kanal: { profil: { status: 'APPROVED' } } },
    select: {
      externeSessionId: true,
      titel: true,
      spiel: true,
      vorschaubildUrl: true,
      zuschauer: true,
      sprache: true,
      gestartetAm: true,
      streamUrl: true,
      kanal: { select: { plattform: true, handle: true, profil: { select: { discordId: true } } } },
    },
    orderBy: { gestartetAm: 'desc' },
  });

  const liveNachDiscordId = new Map<string, OeffentlicherStream>();
  for (const session of laufende) {
    const discordId = session.kanal.profil.discordId;
    if (liveNachDiscordId.has(discordId)) {
      // Zwei laufende Streams derselben Person - der neuere gewinnt.
      continue;
    }
    liveNachDiscordId.set(discordId, {
      titel: session.titel,
      spiel: session.spiel,
      vorschaubildUrl: vorschaubild(session.vorschaubildUrl, 640, 360),
      zuschauer: session.zuschauer,
      sprache: session.sprache,
      gestartetAm: session.gestartetAm,
      streamUrl:
        session.streamUrl ??
        streamAdresse(session.kanal.plattform, session.kanal.handle, session.externeSessionId),
      plattform: session.kanal.plattform,
      sessionId: session.externeSessionId,
    });
  }

  /*
   * Der letzte beobachtete Stream - nur, was wir wirklich gesehen haben.
   *
   * Es gibt keinen «letzten Stream» fuer einen Kanal, der vor der Einrichtung
   * dieses Moduls gestreamt hat. Dann bleibt das Feld leer, und die Seite
   * schreibt nichts hin. Eine geratene Angabe waere eine erfundene
   * Aktivitaetsangabe.
   */
  const letzte = await prisma.streamerSession.groupBy({
    by: ['kanalId'],
    where: { kanal: { profil: { status: 'APPROVED' } } },
    _max: { gestartetAm: true },
  });
  const kanalBesitzer = await prisma.streamerKanal.findMany({
    where: { id: { in: letzte.map((eintrag) => eintrag.kanalId) } },
    select: { id: true, profil: { select: { discordId: true } } },
  });
  const besitzerNachKanal = new Map(kanalBesitzer.map((eintrag) => [eintrag.id, eintrag.profil.discordId]));
  const letzterNachDiscordId = new Map<string, Date>();
  for (const eintrag of letzte) {
    const discordId = besitzerNachKanal.get(eintrag.kanalId);
    const zeit = eintrag._max.gestartetAm;
    if (!discordId || !zeit) {
      continue;
    }
    const bisher = letzterNachDiscordId.get(discordId);
    if (!bisher || zeit > bisher) {
      letzterNachDiscordId.set(discordId, zeit);
    }
  }

  const alle: OeffentlicherStreamer[] = [];
  for (const profil of profile) {
    const zusatz = beiwerk.get(profil.discordId);
    if (!zusatz) {
      continue;
    }
    const eintrag = baue(
      profil,
      zusatz,
      liveNachDiscordId.get(profil.discordId) ?? null,
      letzterNachDiscordId.get(profil.discordId) ?? null,
    );
    if (eintrag) {
      alle.push(eintrag);
    }
  }

  // --- Filter ----------------------------------------------------------------
  const suche = (filter.suche ?? '').trim().toLowerCase();
  const passt = (streamer: OeffentlicherStreamer): boolean => {
    if (suche !== '') {
      const heuhaufen = [
        streamer.name,
        ...streamer.kanaele.map((kanal) => kanal.handle),
        ...streamer.kanaele.map((kanal) => kanal.anzeigename ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!heuhaufen.includes(suche)) {
        return false;
      }
    }
    if (filter.spielId && !streamer.spiele.some((spiel) => spiel.id === filter.spielId)) {
      return false;
    }
    if (filter.plattform && !streamer.kanaele.some((kanal) => kanal.plattform === filter.plattform)) {
      return false;
    }
    if (filter.sprache && !streamer.sprachen.includes(filter.sprache)) {
      return false;
    }
    if (filter.nurLive && !streamer.live) {
      return false;
    }
    return true;
  };

  const gefiltert = alle.filter(passt);

  /*
   * Die Filterwerte entstehen aus **allen** Streamern, nicht aus den
   * gefilterten. Sonst verschwaende der Filter, mit dem man gerade gefiltert
   * hat, seine eigenen Alternativen - und man koennte nicht mehr zurueck.
   *
   * Und sie entstehen aus den Daten: ein Spiel, das niemand streamt, steht
   * nicht in der Auswahl. Ein leerer Filter ist eine Sackgasse mit Ankuendigung.
   */
  const spieleNachId = new Map<string, { id: string; name: string }>();
  const plattformen = new Set<StreamerPlattform>();
  const sprachen = new Set<string>();
  for (const streamer of alle) {
    for (const spiel of streamer.spiele) {
      spieleNachId.set(spiel.id, spiel);
    }
    for (const kanal of streamer.kanaele) {
      plattformen.add(kanal.plattform);
    }
    for (const sprache of streamer.sprachen) {
      sprachen.add(sprache);
    }
  }

  return {
    // Live zuerst, darunter nach Zuschauerzahl - und wo die fehlt, nach Start.
    live: gefiltert
      .filter((streamer) => streamer.live !== null)
      .sort((a, b) => (b.live?.zuschauer ?? 0) - (a.live?.zuschauer ?? 0)),
    offline: gefiltert
      .filter((streamer) => streamer.live === null)
      .sort((a, b) => {
        // Wer zuletzt gestreamt hat, steht oben; wer nie, zuunterst.
        const links = a.letzterStreamAm?.getTime() ?? 0;
        const rechts = b.letzterStreamAm?.getTime() ?? 0;
        return rechts - links || a.name.localeCompare(b.name, 'de');
      }),
    filter: {
      spiele: [...spieleNachId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
      plattformen: [...plattformen].sort(),
      sprachen: [...sprachen].sort(),
    },
  };
}

/**
 * Darf ueberhaupt etwas ohne Anmeldung herausgehen?
 *
 * Zwei Schalter, eine Antwort:
 *
 *   - **Modul aus.** Dann gibt es den Streamer Hub nicht, und zwar auch nicht
 *     seine oeffentlichen Seiten. Die Seitenleiste blendet interne Seiten eines
 *     ausgeschalteten Moduls aus; `/streamer` liegt ausserhalb von `(app)` und
 *     wuerde ohne diese Pruefung weiterlaufen.
 *   - **`oeffentlichAktiv` aus.** Solange das Team Bewerbungen sammelt, soll es
 *     die Seite noch nicht geben.
 *
 * An einer Stelle, weil sonst die dritte oeffentliche Ansicht die Pruefung
 * vergisst - und das faellt niemandem auf, denn die Seite funktioniert dann.
 */
export async function oeffentlichErlaubt(): Promise<boolean> {
  if (!(await isModuleEnabled(STREAMER_MODULE_ID))) {
    return false;
  }
  const einstellungen = await getModuleSettings<StreamerSettings>(STREAMER_MODULE_ID);
  return einstellungen.oeffentlichAktiv;
}

/** Ein einzelner Streamer, ueber den Slug seines oeffentlichen Profils. */
export async function ladeOeffentlichenStreamer(slug: string): Promise<OeffentlicherStreamer | null> {
  const profil = await prisma.memberProfile.findUnique({
    where: { publicSlug: slug },
    select: { discordId: true },
  });
  if (!profil) {
    return null;
  }
  const streamer = await prisma.streamerProfil.findFirst({
    where: { discordId: profil.discordId, status: 'APPROVED', kanaele: { some: { aktiv: true } } },
    select: AUSWAHL,
  });
  if (!streamer) {
    return null;
  }
  /*
   * Ueber die Liste und nicht mit einer eigenen Abfrage.
   *
   * Bewusst: die Detailseite zeigt dieselben Angaben wie die Karte in der
   * Uebersicht, und zwar garantiert dieselben. Eine zweite Abfrage waere eine
   * zweite Allowlist, und die erste Abweichung faende niemand - sie saehe aus
   * wie ein Darstellungsunterschied.
   *
   * Der Preis sind einige Abfragen mehr je Seitenaufruf. Bei der Groesse einer
   * Community-Streamerliste ist das der guenstigere Handel; ab mehreren hundert
   * Streamern waere es Zeit fuer eine eigene Abfrage - dann aber gebaut aus
   * `AUSWAHL` und `baue`, nicht daneben.
   */
  const liste = await ladeOeffentlicheListe();
  return [...liste.live, ...liste.offline].find((eintrag) => eintrag.slug === slug) ?? null;
}

/**
 * Der Streaming-Abschnitt fuer das bestehende oeffentliche Profil.
 *
 * Bewusst klein: das Profil bekommt einen Abschnitt, keine zweite Seite. Es
 * behaelt sein Theme, seine Reihenfolge und seine Bauteile - hier kommen nur
 * Daten dazu.
 */
export interface ProfilStreaming {
  kanaele: OeffentlicherKanal[];
  live: OeffentlicherStream | null;
  sprachen: string[];
  /** Die Adresse der Streamer-Seite, falls es sie gibt. */
  streamerSeite: string | null;
}

export async function ladeProfilStreaming(
  discordId: string,
  slug: string | null,
): Promise<ProfilStreaming | null> {
  /*
   * Derselbe Schalter wie `/streamer`.
   *
   * Sonst haette ein ausgeschalteter Streamer Hub noch einen oeffentlichen
   * Auftritt - im Mitgliedsprofil, mit einem Link auf eine Seite, die 404
   * antwortet.
   */
  if (!(await oeffentlichErlaubt())) {
    return null;
  }

  const streamer = await prisma.streamerProfil.findFirst({
    where: { discordId, status: 'APPROVED', kanaele: { some: { aktiv: true } } },
    select: AUSWAHL,
  });
  if (!streamer) {
    return null;
  }
  const session = await prisma.streamerSession.findFirst({
    where: { beendetAm: null, kanal: { profil: { discordId } } },
    select: {
      externeSessionId: true,
      titel: true,
      spiel: true,
      vorschaubildUrl: true,
      zuschauer: true,
      sprache: true,
      gestartetAm: true,
      streamUrl: true,
      kanal: { select: { plattform: true, handle: true } },
    },
    orderBy: { gestartetAm: 'desc' },
  });

  return {
    kanaele: streamer.kanaele.map((kanal) => ({
      plattform: kanal.plattform,
      handle: kanal.handle,
      anzeigename: kanal.anzeigename,
      adresse: kanalAdresse(kanal.plattform, kanal.handle),
      bestaetigt: bestaetigung(kanal.verifikation),
    })),
    live: session
      ? {
          titel: session.titel,
          spiel: session.spiel,
          vorschaubildUrl: vorschaubild(session.vorschaubildUrl, 640, 360),
          zuschauer: session.zuschauer,
          sprache: session.sprache,
          gestartetAm: session.gestartetAm,
          streamUrl:
            session.streamUrl ??
            streamAdresse(session.kanal.plattform, session.kanal.handle, session.externeSessionId),
          plattform: session.kanal.plattform,
          sessionId: session.externeSessionId,
        }
      : null,
    sprachen: streamer.sprachen,
    streamerSeite: slug ? `/streamer/${encodeURIComponent(slug)}` : null,
  };
}
