/**
 * Was ein Rueckblick ueber eine Person weiss.
 *
 * ## Warum das ein eigener Typ ist und kein Prisma-Ergebnis
 *
 * Diese Form wird als JSON eingefroren und Monate spaeter wieder gelesen.
 * Sie muss deshalb unabhaengig davon sein, wie die Daten gerade zustande
 * kommen: aendert sich morgen die Analytics-Tabelle, bleibt die Form hier
 * dieselbe, und ein Rueckblick von gestern laesst sich weiterhin anzeigen.
 *
 * ## Warum ueberall `null` statt `0` moeglich ist
 *
 * Es gibt einen Unterschied zwischen «null Stunden im Voice» und «dazu haben
 * wir keine Daten». Der erste Fall bedeutet: die Person war nicht da. Der
 * zweite: wir haben in diesem Zeitraum gar nicht gemessen. Eine Szene, die
 * beides gleich behandelt, erzaehlt frueher oder spaeter etwas Falsches -
 * deshalb ist «nicht erhoben» ein eigener Wert.
 */

/** Die Person, wie sie im Rueckblickjahr hiess. */
export interface WrappedPerson {
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  /** Beitritt, soweit das Ereignisprotokoll ihn gesehen hat. */
  joinedAt: string | null;
  /** War die Person zu Beginn des Zeitraums schon da? */
  imZeitraumBeigetreten: boolean;
}

export interface WrappedVoiceKanal {
  channelId: string;
  name: string | null;
  seconds: number;
}

export interface WrappedVoiceMate {
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  /**
   * Gemeinsame Zeit in Sekunden - **grob**, auf fuenf Minuten gerundet.
   *
   * Absichtlich unscharf: eine sekundengenaue Angabe darueber, wann zwei
   * Personen zusammen in einem Kanal waren, ist ein Bewegungsprofil. Fuer
   * «ihr wart oft zusammen unterwegs» genuegt die Groessenordnung.
   */
  sharedSecondsRounded: number;
}

export interface WrappedVoice {
  /** Gesamte Sprachzeit im Zeitraum, ohne AFK. */
  seconds: number;
  sessions: number;
  /** Die laengste zusammenhaengende Anwesenheit. */
  longestSessionSeconds: number;
  longestSessionAt: string | null;
  topChannels: WrappedVoiceKanal[];
  mates: WrappedVoiceMate[];
  /**
   * Sprachzeit je Stunde des Tages in Zuercher Zeit - 24 Werte, Sekunden.
   *
   * Grundlage der Prime Time. Aus den Abschnitten gerechnet und ueber die
   * Stundengrenzen verteilt: wer von 22:40 bis 00:20 dasitzt, faellt in drei
   * Stunden, nicht in eine.
   */
  hours: number[];
}

export interface WrappedMessages {
  total: number;
  /** Tage, an denen mindestens eine Nachricht kam. */
  daysWithMessages: number;
  /** Der Tag mit den meisten Nachrichten. */
  bestDay: { day: string; messages: number } | null;
}

export interface WrappedLevel {
  levelStart: number;
  levelEnd: number;
  xpGained: number;
  /** Der Tag mit dem groessten XP-Zuwachs. */
  bestDay: { day: string; xp: number } | null;
}

export interface WrappedClipHighlight {
  entryId: string;
  clipId: string;
  title: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  provider: string;
  votes: number;
  rank: number | null;
  competitionKey: string;
  competitionNumber: number;
}

export interface WrappedClips {
  submitted: number;
  approved: number;
  wins: number;
  votesReceived: number;
  /** Der erfolgreichste eigene Clip - Grundlage der Szene. */
  best: WrappedClipHighlight | null;
}

export interface WrappedWettkampf {
  tournamentsPlayed: number;
  tournamentWins: number;
  /** Bester Platz ueber alle Turniere - `1` ist der Sieg. */
  bestPlacement: number | null;
  eventsAttended: number;
  /** Die Namen der besuchten Termine, hoechstens eine Handvoll. */
  eventTitles: string[];
  tournamentTitles: string[];
}

export interface WrappedSpiel {
  gameId: string;
  name: string;
  /** Wie oft die Person dieses Spiel in einer Runde mitgetragen hat. */
  sessions: number;
}

export interface WrappedSpiele {
  /**
   * Die Spiele, nach Haeufigkeit.
   *
   * **Die Quelle sind die gemeinsamen Spielauswahlen**, nicht Discords
   * Aktivitaetsstatus: was jemand tatsaechlich gespielt hat, weiss dieses
   * System nicht. Gezaehlt wird, wofuer jemand in einer Runde gestimmt oder
   * was er vorgeschlagen hat. Die Szene sagt deshalb «am haeufigsten dabei»
   * und nicht «am meisten gespielt» - die Formulierung haengt an dieser
   * Einschraenkung.
   *
   * Bis zum Wegfall des Moduls war die Quelle die Spielersuche. Der
   * Bezeichner unten bleibt trotzdem stehen, weil er in eingefrorenen
   * Rueckblicken vergangener Jahre steht - dort war es die Spielersuche, und
   * das soll er weiterhin sagen.
   */
  top: WrappedSpiel[];
  quelle: 'spielersuche' | 'spielwahl';
}

export interface WrappedAktivitaet {
  /** Tage mit mindestens einer Aktivitaet - Nachricht oder Sprachzeit. */
  activeDays: number;
  /** Laengste Serie aufeinanderfolgender aktiver Tage. */
  longestStreak: number;
  /** Der aktivste Monat, `1`-`12`. */
  bestMonth: { month: number; messages: number; voiceSeconds: number } | null;
  /** Aktive Tage je Monat - zwoelf Werte, fuer die Darstellung. */
  daysPerMonth: number[];
}

/** Ein Fakt, den das System als bemerkenswert ausgewaehlt hat. */
export interface WrappedHighlight {
  key: string;
  /** Die Zahl, um die es geht - fuer die grosse Typografie. */
  value: string;
  label: string;
  detail: string | null;
}

export interface WrappedArchetyp {
  key: string;
  /** Die einzelnen Punktwerte - damit nachvollziehbar bleibt, warum. */
  scores: Record<string, number>;
}

/**
 * Wie verlaesslich eine Datenquelle im Zeitraum ist.
 *
 * `teilweise` heisst: die Messung begann mitten im Zeitraum. Ein Rueckblick
 * darf das nicht verschweigen - «4'821 Nachrichten in diesem Jahr» ist
 * falsch, wenn erst ab Juli gezaehlt wurde.
 */
export type WrappedQuellenLage = 'vollstaendig' | 'teilweise' | 'fehlt';

export interface WrappedQuelle {
  lage: WrappedQuellenLage;
  /** Ab wann gemessen wird, falls spaeter als der Zeitraumbeginn. */
  seit: string | null;
  /** Anteil des Zeitraums, der abgedeckt ist - 0 bis 1. */
  abdeckung: number;
}

export interface WrappedQuellen {
  voice: WrappedQuelle;
  messages: WrappedQuelle;
  level: WrappedQuelle;
  clips: WrappedQuelle;
  events: WrappedQuelle;
  tournaments: WrappedQuelle;
  games: WrappedQuelle;
}

/**
 * Die vollstaendigen Daten eines Rueckblicks.
 *
 * Genau das, was als `WrappedSnapshot.data` festgeschrieben wird.
 */
export interface WrappedDaten {
  /** Fassung des Aufbaus - erlaubt spaeter, aeltere Momentaufnahmen zu lesen. */
  version: 1;
  person: WrappedPerson;
  period: { start: string; end: string; year: number };
  voice: WrappedVoice;
  messages: WrappedMessages;
  level: WrappedLevel | null;
  clips: WrappedClips;
  wettkampf: WrappedWettkampf;
  spiele: WrappedSpiele;
  aktivitaet: WrappedAktivitaet;
  highlight: WrappedHighlight | null;
  archetyp: WrappedArchetyp;
  quellen: WrappedQuellen;
  /** Nur im Studio gesetzt: woher diese Daten stammen. */
  herkunft?: 'live' | 'fixture';
}
