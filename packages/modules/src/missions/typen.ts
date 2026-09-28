/**
 * Was eine Mission messen kann - und woher die Zahl kommt.
 *
 * ## Die Auswahl ist eine Pruefung, kein Wunschzettel
 *
 * Die Spezifikation schlug acht Missionstypen vor. Sechs stehen hier. Die
 * beiden fehlenden fehlen nicht aus Zeitnot, sondern weil es die Daten nicht
 * gibt, mit denen ein Fortschrittsbalken ehrlich waere:
 *
 * **Spielersuche benutzt** - das Modul Spielersuche wurde aus diesem
 * Repository entfernt; an seine Stelle trat die Spielwahl, die keine
 * Benutzung je Mitglied aufzeichnet. Es gibt keine Tabelle, die «Mitglied X
 * hat die Suche benutzt» kennt. Eine Mission darauf waere ein Balken, der
 * nie steigt.
 *
 * **Streamer-Aktivitaet** - Streams haengen an `StreamerKanal`, der an einem
 * `StreamerProfil` haengt. Eine Mission darauf koennte nur von den paar
 * verifizierten Kanalinhabern erfuellt werden; fuer alle anderen waere sie
 * unerreichbar, und eine Community-Mission, die 99 Prozent der Community
 * ausschliesst, ist keine. Ausserdem ist «Aktivitaet» dort nicht definiert:
 * eine Session ist ein Zeitraum, kein Ereignis, und ob eine Stunde Stream
 * eine zaehlt oder sechzig, liesse sich nur erfinden.
 *
 * ## Warum jeder Typ seine Quelle selbst mitbringt
 *
 * Die Messung steht neben dem Typ, nicht in einer zentralen Verzweigung.
 * Wer einen Typ hinzufuegt, muss die Quelle benennen - er kann sie nicht
 * vergessen, weil der Typ ohne sie nicht uebersetzt.
 */
import { prisma } from '@swisshub/database';
import { levelFromXp } from '../level/curve';

export type MissionTypKey =
  | 'VOICE_MINUTEN'
  | 'NACHRICHTEN'
  | 'CLIP_EINGEREICHT'
  | 'TURNIER_TEILNAHME'
  | 'PROFIL_VOLLSTAENDIG'
  | 'LEVEL_ERREICHT';

export interface MessFenster {
  guildId: string;
  von: Date;
  bis: Date;
}

export interface MissionTypDefinition {
  key: MissionTypKey;
  /** Wie der Typ im Dashboard heisst. Keine technische Kennung. */
  label: string;
  /** Die Einheit hinter der Zahl: «45 Minuten», «3 Clips». */
  einheit: string;
  /** Ein Satz fuer das Mitglied, ohne Fachsprache. */
  erklaerung: string;
  /** Woher die Zahl kommt - fuer das Team, nicht fuer das Mitglied. */
  quelle: string;
  /**
   * Zaehlt der Typ innerhalb des Zeitraums, oder gilt der Stand?
   *
   * `false` heisst: der Zeitraum entscheidet nur, wann die Mission laeuft,
   * nicht was gezaehlt wird. Ein Level, das jemand vorletzte Woche erreicht
   * hat, ist diese Woche immer noch erreicht.
   */
  imZeitraum: boolean;
  /** Eine sinnvolle Vorgabe fuer das Ziel, damit das Formular nicht leer ist. */
  zielVorschlag: number;
  /** Taugt der Typ fuer eine Community Challenge (eine Summe ueber alle)? */
  summierbar: boolean;
  /** Der Stand je Mitglied, als Karte discordId → Wert. */
  miss(fenster: MessFenster): Promise<Map<string, number>>;
}

/** Zaehlt eine Liste von Discord-IDs zu einer Karte zusammen. */
function haeufe(ids: Iterable<string>): Map<string, number> {
  const karte = new Map<string, number>();
  for (const id of ids) {
    karte.set(id, (karte.get(id) ?? 0) + 1);
  }
  return karte;
}

/**
 * Minuten im Sprachkanal.
 *
 * Aus `AnalyticsVoiceSegment`, nicht aus `LevelProfile.voiceMinutes`: das
 * Levelprofil traegt eine **Gesamtsumme** seit Anbeginn, aus der sich die
 * Woche nicht herausrechnen laesst. Die Segmente sind einzeln, mit Beginn
 * und Ende - genau das, was ein Zeitfenster braucht.
 *
 * Bots und die AFK-Ecke fallen heraus. Laufende Segmente (`leftAt` ist NULL)
 * ebenfalls: `seconds` steht erst beim Verlassen fest, und NULL heisst «laeuft
 * noch», nicht «null Sekunden». Wer gerade sitzt, sieht seinen Fortschritt
 * also beim naechsten Durchgang nach dem Verlassen - eine halbe Stunde
 * Verzoegerung ist der Preis dafuer, keine Zahl zu erfinden.
 */
const voiceMinuten: MissionTypDefinition = {
  key: 'VOICE_MINUTEN',
  label: 'Zeit im Sprachkanal',
  einheit: 'Minuten',
  erklaerung: 'Zeit, die du in dieser Zeit in einem Sprachkanal verbracht hast.',
  quelle: 'Sprachkanal-Segmente der Statistik',
  imZeitraum: true,
  zielVorschlag: 120,
  summierbar: true,
  async miss({ guildId, von, bis }) {
    const zeilen = await prisma.analyticsVoiceSegment.groupBy({
      by: ['discordId'],
      where: {
        guildId,
        isBot: false,
        isAfk: false,
        joinedAt: { gte: von, lt: bis },
        leftAt: { not: null },
        seconds: { not: null },
      },
      _sum: { seconds: true },
    });
    const karte = new Map<string, number>();
    for (const zeile of zeilen) {
      karte.set(zeile.discordId, Math.floor((zeile._sum.seconds ?? 0) / 60));
    }
    return karte;
  },
};

/**
 * Gueltige Nachrichten.
 *
 * Aus dem XP-Journal, nicht aus einem Nachrichtenspeicher. Das ist eine
 * bewusste Entscheidung und keine Verlegenheit:
 *
 * `DiscordMessageSnapshot` haelt den **letzten bekannten Stand** einer
 * Nachricht - es ist ein Spiegel fuer die Moderation, kein vollstaendiges
 * Journal, und was geloescht wurde, verschwindet daraus. Ein Fortschritt,
 * der sinkt, weil jemand aufgeraeumt hat, waere schlimmer als keiner.
 *
 * Das XP-Journal dagegen ist unveraenderlich, traegt je Buchung einen
 * Zeitstempel und ist auf `(discordId, createdAt)` indiziert. Und es zaehlt
 * bereits das, was hier gemeint ist: eine Buchung entsteht je Nachricht,
 * die den Spam-Abstand eingehalten hat. «Gueltige Nachricht» ist damit
 * nicht neu definiert, sondern uebernommen.
 */
const nachrichten: MissionTypDefinition = {
  key: 'NACHRICHTEN',
  label: 'Nachrichten',
  einheit: 'Nachrichten',
  erklaerung: 'Nachrichten, die du in dieser Zeit im Server geschrieben hast.',
  quelle: 'XP-Journal, Buchungen der Art Nachricht',
  imZeitraum: true,
  zielVorschlag: 50,
  summierbar: true,
  async miss({ von, bis }) {
    const zeilen = await prisma.xpTransaction.groupBy({
      by: ['discordId'],
      where: { source: 'MESSAGE', createdAt: { gte: von, lt: bis } },
      _count: { _all: true },
    });
    const karte = new Map<string, number>();
    for (const zeile of zeilen) {
      karte.set(zeile.discordId, zeile._count._all);
    }
    return karte;
  },
};

/**
 * Eingereichte Clips.
 *
 * Entfernte Einreichungen zaehlen nicht mit - sonst liesse sich die Mission
 * mit Clips erfuellen, die die Moderation wieder herausgenommen hat.
 */
const clipEingereicht: MissionTypDefinition = {
  key: 'CLIP_EINGEREICHT',
  label: 'Clips eingereicht',
  einheit: 'Clips',
  erklaerung: 'Clips, die du in dieser Zeit für Clip of the Week eingereicht hast.',
  quelle: 'Einreichungen bei Clip of the Week',
  imZeitraum: true,
  zielVorschlag: 1,
  summierbar: true,
  async miss({ von, bis }) {
    const zeilen = await prisma.clipCompetitionEntry.groupBy({
      by: ['submittedByDiscordId'],
      where: { submittedAt: { gte: von, lt: bis }, status: { not: 'REMOVED' } },
      _count: { _all: true },
    });
    const karte = new Map<string, number>();
    for (const zeile of zeilen) {
      karte.set(zeile.submittedByDiscordId, zeile._count._all);
    }
    return karte;
  },
};

/**
 * Turnierteilnahmen - solo wie im Team.
 *
 * Zwei Tabellen, weil Turniere zwei Formen kennen: bei SOLO haengt die
 * Teilnahme direkt am Mitglied, bei TEAM am Team, und das Mitglied steht in
 * dessen Aufstellung. Nur die erste zu fragen hiesse, jedem Teamspieler zu
 * sagen, er habe an nichts teilgenommen.
 *
 * Entfernte Teammitglieder bleiben im Verlauf stehen und zaehlen hier nicht -
 * `removedAt` ist gesetzt, wer die Mannschaft verlassen hat.
 */
const turnierTeilnahme: MissionTypDefinition = {
  key: 'TURNIER_TEILNAHME',
  label: 'Turnierteilnahmen',
  einheit: 'Turniere',
  erklaerung: 'Turniere, bei denen du in dieser Zeit angetreten bist - alleine oder im Team.',
  quelle: 'Turnierteilnehmer und Teamaufstellungen',
  imZeitraum: true,
  zielVorschlag: 1,
  summierbar: true,
  async miss({ von, bis }) {
    const [solo, team] = await Promise.all([
      prisma.tournamentParticipant.findMany({
        where: { discordId: { not: null }, createdAt: { gte: von, lt: bis } },
        select: { discordId: true },
      }),
      prisma.tournamentTeamMember.findMany({
        where: { removedAt: null, joinedAt: { gte: von, lt: bis } },
        select: { discordId: true },
      }),
    ]);
    return haeufe([
      ...solo.map((zeile) => zeile.discordId as string),
      ...team.map((zeile) => zeile.discordId),
    ]);
  },
};

/**
 * Wann ein Profil als ausgefuellt gilt.
 *
 * Vier Angaben, die ein Mitglied selbst setzt und die zusammen ein Profil
 * ausmachen, in dem jemand etwas ueber sein Gegenueber erfaehrt. Bewusst
 * keine Prozentzahl und kein Punktesystem: eine erfundene Skala haette eine
 * Genauigkeit vorgetaeuscht, die es nicht gibt.
 *
 * Die Felder sind die vorhandenen Spalten von `MemberProfile` - es wird
 * nichts zusaetzlich erhoben, um diese Mission zu ermoeglichen.
 */
export const PROFIL_PFLICHTFELDER = ['Kurzbeschreibung', 'Vorstellung', 'Sprachen', 'Plattformen'] as const;

const profilVollstaendig: MissionTypDefinition = {
  key: 'PROFIL_VOLLSTAENDIG',
  label: 'Profil ausgefüllt',
  einheit: 'erledigt',
  erklaerung: 'Kurzbeschreibung, Vorstellung, Sprachen und Plattformen im eigenen Profil ausgefüllt.',
  quelle: 'Mitgliederprofil',
  /*
   * Kein Zeitfenster. Ein ausgefuelltes Profil ist ein Zustand, kein
   * Ereignis - wer es letzten Monat ausgefuellt hat, hat es heute immer
   * noch, und eine Mission, die ihn zwaenge, es noch einmal zu tun, haette
   * nichts zu messen.
   */
  imZeitraum: false,
  zielVorschlag: 1,
  /*
   * Nicht summierbar: «200 ausgefuellte Profile als Server» klingt nach
   * einer Challenge, waere aber eine Zaehlung des Mitgliederbestands. Der
   * Fortschritt stiege auch dann, wenn in der Woche niemand etwas tut.
   */
  summierbar: false,
  async miss() {
    const zeilen = await prisma.memberProfile.findMany({
      where: {
        bio: { not: null },
        tagline: { not: null },
        NOT: [{ languages: { isEmpty: true } }, { platforms: { isEmpty: true } }],
      },
      select: { discordId: true, bio: true, tagline: true },
    });
    const karte = new Map<string, number>();
    for (const zeile of zeilen) {
      // `not: null` laesst den leeren String durch - der ist nicht ausgefuellt.
      if (zeile.bio?.trim() && zeile.tagline?.trim()) {
        karte.set(zeile.discordId, 1);
      }
    }
    return karte;
  },
};

/**
 * Ein Level erreicht.
 *
 * Gemessen wird das Level, nicht der Zuwachs: «erreiche Level 10» ist die
 * Mission, und wer schon dort ist, hat sie erfuellt. Das ist Absicht - eine
 * Mission, die nur belohnt, wer diese Woche aufgestiegen ist, benachteiligt
 * genau die Mitglieder, die am laengsten dabei sind.
 */
const levelErreicht: MissionTypDefinition = {
  key: 'LEVEL_ERREICHT',
  label: 'Level erreicht',
  einheit: 'Level',
  erklaerung: 'Dein aktuelles Level im Server.',
  quelle: 'Levelprofil',
  imZeitraum: false,
  zielVorschlag: 10,
  summierbar: false,
  async miss() {
    /*
     * Das Level steht nicht in der Tabelle - dort stehen XP. Gerechnet wird
     * es mit derselben Funktion wie ueberall sonst; eine eigene Formel hier
     * waere eine zweite Wahrheit ueber dasselbe Mitglied.
     */
    const zeilen = await prisma.levelProfile.findMany({ select: { discordId: true, xp: true } });
    const karte = new Map<string, number>();
    for (const zeile of zeilen) {
      karte.set(zeile.discordId, levelFromXp(zeile.xp));
    }
    return karte;
  },
};

const ALLE: MissionTypDefinition[] = [
  voiceMinuten,
  nachrichten,
  clipEingereicht,
  turnierTeilnahme,
  profilVollstaendig,
  levelErreicht,
];

const NACH_KEY = new Map(ALLE.map((eintrag) => [eintrag.key, eintrag]));

export function missionTypen(): MissionTypDefinition[] {
  return [...ALLE];
}

export function missionTyp(key: string): MissionTypDefinition | undefined {
  return NACH_KEY.get(key as MissionTypKey);
}

/** Die Typen, aus denen sich eine Community Challenge bilden laesst. */
export function challengeTypen(): MissionTypDefinition[] {
  return ALLE.filter((eintrag) => eintrag.summierbar);
}
