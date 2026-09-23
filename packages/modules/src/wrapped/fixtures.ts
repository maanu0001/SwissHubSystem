import { bestimmeArchetyp } from './archetyp';
import { waehleHighlight } from './highlight';
import type { WrappedDaten, WrappedQuellen } from './daten';

/**
 * Erfundene Personen - ausdruecklich erfunden.
 *
 * ## Wozu
 *
 * Eine Oberflaeche, die nur mit den Daten des eigenen Kontos getestet wird,
 * ist fuer genau ein Konto gebaut. Was passiert bei 9'999 Stunden? Bei einem
 * Anzeigenamen mit 32 Zeichen? Bei jemandem, der im Dezember beigetreten ist
 * und drei Nachrichten geschrieben hat? Diese Faelle muss man herstellen
 * koennen, ohne auf sie zu warten.
 *
 * ## Warum zentral und nicht in den Komponenten
 *
 * Weil dieselben Personen in der Vorschau, in der Share-Card-Vorschau und in
 * den Tests gebraucht werden. Drei Kopien waeren drei Wahrheiten - und die
 * Tests liefen dann gegen andere Daten als die Vorschau.
 *
 * ## Was sie nicht sind
 *
 * Keine echten Mitglieder. Die Kennungen sind offensichtlich erfunden, die
 * Namen auch. Nichts davon darf je in eine Momentaufnahme geraten: jede
 * Fixture traegt `herkunft: 'fixture'`, und die Erzeugung der
 * Momentaufnahmen ruft diese Datei gar nicht erst auf.
 */

export interface WrappedPersona {
  key: string;
  label: string;
  beschreibung: string;
  bauen(jahr: number): WrappedDaten;
}

const VOLLSTAENDIG: WrappedQuellen = {
  voice: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  messages: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  level: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  clips: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  events: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  tournaments: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
  games: { lage: 'vollstaendig', seit: null, abdeckung: 1 },
};

/**
 * Eine Stundenverteilung mit Schwerpunkt.
 *
 * Kein Zufall: eine Vorschau, die bei jedem Aufruf anders aussieht, taugt
 * nicht zum Vergleichen. Die Kurve faellt zu beiden Seiten des Schwerpunkts
 * ab und laeuft ueber Mitternacht herum - sonst haette ein Nachtmensch um
 * 00 Uhr einen Bruch statt eines Uebergangs.
 */
function stundenKurve(schwerpunkt: number, gesamt: number): number[] {
  const gewichte = Array.from({ length: 24 }, (_, stunde) => {
    const abstand = Math.min(Math.abs(stunde - schwerpunkt), 24 - Math.abs(stunde - schwerpunkt));
    return Math.max(0, 1 - abstand / 6) ** 2;
  });
  const summe = gewichte.reduce((a, b) => a + b, 0);
  return gewichte.map((wert) => Math.round((wert / summe) * gesamt));
}

const mate = (nummer: number, name: string, stunden: number): WrappedDaten['voice']['mates'][number] => ({
  discordId: `9000000000000000${String(nummer).padStart(2, '0')}`,
  username: name.toLowerCase().replace(/\s+/gu, ''),
  displayName: name,
  avatarHash: null,
  sharedSecondsRounded: stunden * 3600,
});

interface Rohdaten {
  displayName: string;
  username: string;
  joinedAt: string | null;
  imZeitraumBeigetreten?: boolean;
  voiceSeconds: number;
  voiceSessions: number;
  longestSessionSeconds: number;
  schwerpunkt: number;
  kanaele: Array<[string, number]>;
  mates: Array<[string, number]>;
  messages: number;
  daysWithMessages: number;
  bestMessageDay: number;
  level: { start: number; ende: number; xp: number; bestDayXp: number } | null;
  clips: { submitted: number; approved: number; wins: number; votes: number; titel?: string };
  turniere: number;
  turnierSiege: number;
  events: number;
  spiele: Array<[string, number]>;
  activeDays: number;
  longestStreak: number;
  quellen?: WrappedQuellen;
}

/** Aus rohen Zahlen eine vollstaendige, in sich stimmige Datenform bauen. */
function baue(roh: Rohdaten, jahr: number): WrappedDaten {
  const tagImJahr = (versatz: number): string =>
    `${jahr}-${String(Math.min(12, 1 + Math.floor(versatz / 30))).padStart(2, '0')}-${String(
      1 + (versatz % 28),
    ).padStart(2, '0')}`;

  const teil: Omit<WrappedDaten, 'highlight' | 'archetyp'> = {
    version: 1,
    person: {
      discordId: '900000000000000001',
      username: roh.username,
      displayName: roh.displayName,
      avatarHash: null,
      joinedAt: roh.joinedAt,
      imZeitraumBeigetreten: roh.imZeitraumBeigetreten ?? false,
    },
    period: {
      start: `${jahr}-01-01T00:00:00.000Z`,
      end: `${jahr + 1}-01-01T00:00:00.000Z`,
      year: jahr,
    },
    voice: {
      seconds: roh.voiceSeconds,
      sessions: roh.voiceSessions,
      longestSessionSeconds: roh.longestSessionSeconds,
      longestSessionAt: roh.longestSessionSeconds > 0 ? `${jahr}-07-13T20:15:00.000Z` : null,
      topChannels: roh.kanaele.map(([name, sekunden], index) => ({
        channelId: `70000000000000000${index}`,
        name,
        seconds: sekunden,
      })),
      mates: roh.mates.map(([name, stunden], index) => mate(index + 1, name, stunden)),
      hours: stundenKurve(roh.schwerpunkt, roh.voiceSeconds),
    },
    messages: {
      total: roh.messages,
      daysWithMessages: roh.daysWithMessages,
      bestDay: roh.bestMessageDay > 0 ? { day: tagImJahr(112), messages: roh.bestMessageDay } : null,
    },
    level: roh.level
      ? {
          levelStart: roh.level.start,
          levelEnd: roh.level.ende,
          xpGained: roh.level.xp,
          bestDay: roh.level.bestDayXp > 0 ? { day: tagImJahr(203), xp: roh.level.bestDayXp } : null,
        }
      : null,
    clips: {
      submitted: roh.clips.submitted,
      approved: roh.clips.approved,
      wins: roh.clips.wins,
      votesReceived: roh.clips.votes,
      best:
        roh.clips.approved > 0
          ? {
              entryId: 'fixture-entry',
              clipId: 'fixture-clip',
              title: roh.clips.titel ?? 'Der eine Moment, der alles gerettet hat',
              canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
              thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
              provider: 'youtube',
              votes: Math.max(1, roh.clips.votes),
              rank: roh.clips.wins > 0 ? 1 : 2,
              competitionKey: `${jahr}-W28`,
              competitionNumber: 28,
            }
          : null,
    },
    wettkampf: {
      tournamentsPlayed: roh.turniere,
      tournamentWins: roh.turnierSiege,
      bestPlacement: roh.turniere > 0 ? (roh.turnierSiege > 0 ? 1 : 3) : null,
      eventsAttended: roh.events,
      eventTitles: roh.events > 0 ? ['GameNight Februar', 'Community Abend'] : [],
      tournamentTitles: roh.turniere > 0 ? ['SwissHub Winter Cup'] : [],
    },
    spiele: {
      top: roh.spiele.map(([name, sessions], index) => ({
        gameId: `game-${index}`,
        name,
        sessions,
      })),
      quelle: 'spielersuche',
    },
    aktivitaet: {
      activeDays: roh.activeDays,
      longestStreak: roh.longestStreak,
      bestMonth:
        roh.activeDays > 0
          ? {
              month: 7,
              messages: Math.round(roh.messages / 8),
              voiceSeconds: Math.round(roh.voiceSeconds / 7),
            }
          : null,
      daysPerMonth: Array.from({ length: 12 }, (_, index) =>
        Math.min(28, Math.round((roh.activeDays / 12) * (1 + (index % 3 === 0 ? 0.35 : -0.15)))),
      ),
    },
    quellen: roh.quellen ?? VOLLSTAENDIG,
  };

  return {
    ...teil,
    highlight: waehleHighlight(teil),
    archetyp: bestimmeArchetyp(teil),
    herkunft: 'fixture',
  };
}

const h = (stunden: number): number => Math.round(stunden * 3600);

export const WRAPPED_PERSONAS: readonly WrappedPersona[] = [
  {
    key: 'allrounder',
    label: 'Allrounder',
    beschreibung: 'Viel Voice, viele Nachrichten, Level, Spiele, Events und ein Clip-Sieg. Alle Szenen.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Manuel',
          username: 'manuel',
          joinedAt: `${jahr - 2}-03-14T18:00:00.000Z`,
          voiceSeconds: h(187),
          voiceSessions: 412,
          longestSessionSeconds: h(7.5),
          schwerpunkt: 21,
          kanaele: [
            ['Gaming 1', h(94)],
            ['Chill', h(41)],
            ['Talk 3', h(28)],
            ['Gaming 2', h(16)],
            ['AFK-nah', h(8)],
          ],
          mates: [
            ['Livia', 63],
            ['Noah', 41],
            ['Jael', 28],
            ['Timo', 19],
            ['Ramon', 11],
          ],
          messages: 4821,
          daysWithMessages: 244,
          bestMessageDay: 187,
          level: { start: 12, ende: 38, xp: 18420, bestDayXp: 1240 },
          clips: { submitted: 9, approved: 7, wins: 2, votes: 31 },
          turniere: 4,
          turnierSiege: 1,
          events: 6,
          spiele: [
            ['Counter-Strike 2', 38],
            ['Valorant', 21],
            ['Rocket League', 9],
          ],
          activeDays: 286,
          longestStreak: 41,
        },
        jahr,
      ),
  },
  {
    key: 'voice',
    label: 'Voice-Mensch',
    beschreibung: 'Sehr viel Sprachzeit, kaum Chat. Prüft, ob die Chat-Szenen sauber entfallen.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Livia',
          username: 'livia',
          joinedAt: `${jahr - 1}-01-02T10:00:00.000Z`,
          voiceSeconds: h(612),
          voiceSessions: 890,
          longestSessionSeconds: h(13.2),
          schwerpunkt: 23,
          kanaele: [
            ['Chill', h(402)],
            ['Gaming 1', h(151)],
            ['Talk 1', h(59)],
          ],
          mates: [
            ['Manuel', 188],
            ['Noah', 97],
            ['Timo', 44],
          ],
          messages: 38,
          daysWithMessages: 19,
          bestMessageDay: 6,
          level: { start: 20, ende: 47, xp: 26400, bestDayXp: 980 },
          clips: { submitted: 0, approved: 0, wins: 0, votes: 0 },
          turniere: 0,
          turnierSiege: 0,
          events: 1,
          spiele: [['Counter-Strike 2', 12]],
          activeDays: 311,
          longestStreak: 94,
        },
        jahr,
      ),
  },
  {
    key: 'chat',
    label: 'Chat-Mensch',
    beschreibung: 'Viele Nachrichten, fast kein Voice. Voice-, Mates- und Prime-Time-Szenen entfallen.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Jael',
          username: 'jael',
          joinedAt: `${jahr - 3}-09-08T12:00:00.000Z`,
          voiceSeconds: h(1.2),
          voiceSessions: 4,
          longestSessionSeconds: h(0.7),
          schwerpunkt: 19,
          kanaele: [['Talk 1', h(1.2)]],
          mates: [],
          messages: 9140,
          daysWithMessages: 301,
          bestMessageDay: 412,
          level: { start: 31, ende: 44, xp: 14100, bestDayXp: 860 },
          clips: { submitted: 1, approved: 1, wins: 0, votes: 4 },
          turniere: 0,
          turnierSiege: 0,
          events: 2,
          spiele: [],
          activeDays: 303,
          longestStreak: 62,
        },
        jahr,
      ),
  },
  {
    key: 'competitive',
    label: 'Competitive',
    beschreibung: 'Turniere, Events und ein Turniersieg. Prüft die Wettkampf-Szene und das Highlight.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Ramon',
          username: 'ramon',
          joinedAt: `${jahr - 1}-06-21T16:30:00.000Z`,
          voiceSeconds: h(96),
          voiceSessions: 188,
          longestSessionSeconds: h(5.1),
          schwerpunkt: 20,
          kanaele: [
            ['Turnier-Voice', h(54)],
            ['Gaming 2', h(31)],
          ],
          mates: [
            ['Timo', 38],
            ['Noah', 22],
          ],
          messages: 1204,
          daysWithMessages: 140,
          bestMessageDay: 64,
          level: { start: 8, ende: 22, xp: 9200, bestDayXp: 1560 },
          clips: { submitted: 3, approved: 2, wins: 1, votes: 18, titel: 'Clutch im Finale' },
          turniere: 9,
          turnierSiege: 2,
          events: 11,
          spiele: [
            ['Valorant', 44],
            ['Counter-Strike 2', 17],
          ],
          activeDays: 201,
          longestStreak: 28,
        },
        jahr,
      ),
  },
  {
    key: 'neu',
    label: 'Neu dabei',
    beschreibung: 'Im November beigetreten. Kurze Geschichte, anderer Intro-Text.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Noah',
          username: 'noah',
          joinedAt: `${jahr}-11-04T19:20:00.000Z`,
          imZeitraumBeigetreten: true,
          voiceSeconds: h(21),
          voiceSessions: 33,
          longestSessionSeconds: h(3.4),
          schwerpunkt: 22,
          kanaele: [
            ['Gaming 1', h(14)],
            ['Chill', h(7)],
          ],
          mates: [
            ['Manuel', 9],
            ['Livia', 6],
          ],
          messages: 214,
          daysWithMessages: 31,
          bestMessageDay: 28,
          level: { start: 0, ende: 7, xp: 2100, bestDayXp: 420 },
          clips: { submitted: 0, approved: 0, wins: 0, votes: 0 },
          turniere: 0,
          turnierSiege: 0,
          events: 1,
          spiele: [['Rocket League', 5]],
          activeDays: 38,
          longestStreak: 12,
        },
        jahr,
      ),
  },
  {
    key: 'minimal',
    label: 'Kaum Daten',
    beschreibung: 'Fast nichts. Prüft, dass nur Intro, Typ und Finale übrig bleiben - ohne Nullen.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Stiller Beobachter',
          username: 'lurker',
          joinedAt: `${jahr - 1}-02-11T08:00:00.000Z`,
          voiceSeconds: h(0.3),
          voiceSessions: 2,
          longestSessionSeconds: h(0.2),
          schwerpunkt: 15,
          kanaele: [['Chill', h(0.3)]],
          mates: [],
          messages: 11,
          daysWithMessages: 6,
          bestMessageDay: 4,
          level: null,
          clips: { submitted: 0, approved: 0, wins: 0, votes: 0 },
          turniere: 0,
          turnierSiege: 0,
          events: 0,
          spiele: [],
          activeDays: 7,
          longestStreak: 2,
        },
        jahr,
      ),
  },
  {
    key: 'extrem',
    label: 'Extremwerte',
    beschreibung:
      'Absurd grosse Zahlen und ein sehr langer Name. Prüft Umbrüche, Zifferngruppen und Layout-Stabilität.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Maximilian-Alexander von Rüttimann',
          username: 'maximilianalexandervonruettimann',
          joinedAt: `${jahr - 6}-01-01T00:00:00.000Z`,
          voiceSeconds: h(9999),
          voiceSessions: 12480,
          longestSessionSeconds: h(38),
          schwerpunkt: 3,
          kanaele: [
            ['Ein aussergewöhnlich langer Kanalname für den Test', h(6120)],
            ['Gaming 1', h(2400)],
            ['Chill', h(1479)],
          ],
          mates: [
            ['Eine Person mit sehr langem Anzeigenamen', 3120],
            ['Livia', 2011],
            ['Noah', 1888],
            ['Jael', 1204],
            ['Timo', 980],
            ['Ramon', 640],
          ],
          messages: 999999,
          daysWithMessages: 365,
          bestMessageDay: 9812,
          level: { start: 1, ende: 999, xp: 9876543, bestDayXp: 120400 },
          clips: {
            submitted: 148,
            approved: 140,
            wins: 37,
            votes: 4210,
            titel: 'Ein Clip mit einem wirklich ausserordentlich langen Titel, der umbrechen muss',
          },
          turniere: 96,
          turnierSiege: 41,
          events: 212,
          spiele: [
            ['Counter-Strike 2', 980],
            ['Valorant', 612],
            ['Ein Spiel mit sehr langem Namen zum Testen', 410],
          ],
          activeDays: 366,
          longestStreak: 366,
        },
        jahr,
      ),
  },
  {
    key: 'luecken',
    label: 'Lückenhafte Datenlage',
    beschreibung:
      'Nachrichten erst seit Juli gemessen, keine Clips und keine Events auf dem Server. Prüft die Quellenhinweise.',
    bauen: (jahr) =>
      baue(
        {
          displayName: 'Timo',
          username: 'timo',
          joinedAt: `${jahr - 2}-05-05T14:00:00.000Z`,
          voiceSeconds: h(74),
          voiceSessions: 141,
          longestSessionSeconds: h(4.6),
          schwerpunkt: 18,
          kanaele: [
            ['Gaming 1', h(52)],
            ['Talk 2', h(22)],
          ],
          mates: [
            ['Ramon', 30],
            ['Manuel', 18],
          ],
          messages: 640,
          daysWithMessages: 88,
          bestMessageDay: 41,
          level: { start: 15, ende: 24, xp: 6400, bestDayXp: 510 },
          clips: { submitted: 0, approved: 0, wins: 0, votes: 0 },
          turniere: 0,
          turnierSiege: 0,
          events: 0,
          spiele: [['Rocket League', 7]],
          activeDays: 156,
          longestStreak: 19,
          quellen: {
            ...VOLLSTAENDIG,
            messages: { lage: 'teilweise', seit: `${jahr}-07-01T00:00:00.000Z`, abdeckung: 0.5 },
            clips: { lage: 'fehlt', seit: null, abdeckung: 0 },
            events: { lage: 'fehlt', seit: null, abdeckung: 0 },
            tournaments: { lage: 'fehlt', seit: null, abdeckung: 0 },
          },
        },
        jahr,
      ),
  },
] as const;

export const PERSONA_NACH_KEY = new Map(WRAPPED_PERSONAS.map((persona) => [persona.key, persona]));

/**
 * Einzelne Werte einer Fixture ueberschreiben.
 *
 * Damit laesst sich gezielt testen, was sonst schwer herzustellen ist -
 * «wie sieht 187h aus, wenn der Rest gleich bleibt». Nur die Zahlen, die
 * die Gestaltung tatsaechlich belasten; alles Abgeleitete wird danach neu
 * bestimmt, damit die Daten in sich stimmig bleiben.
 */
export interface FixtureUeberschreibung {
  voiceSeconds?: number;
  messages?: number;
  levelStart?: number;
  levelEnd?: number;
  clipWins?: number;
  activeDays?: number;
  primeTimeStunde?: number;
  displayName?: string;
}

export function ueberschreibe(daten: WrappedDaten, werte: FixtureUeberschreibung): WrappedDaten {
  const voiceSeconds = werte.voiceSeconds ?? daten.voice.seconds;
  const teil: Omit<WrappedDaten, 'highlight' | 'archetyp'> = {
    ...daten,
    person: { ...daten.person, displayName: werte.displayName ?? daten.person.displayName },
    voice: {
      ...daten.voice,
      seconds: voiceSeconds,
      hours:
        werte.primeTimeStunde !== undefined
          ? stundenKurve(werte.primeTimeStunde, voiceSeconds)
          : // Die Kurve mitskalieren, sonst passte die Verteilung nicht mehr
            // zur Summe - und die Prime Time zeigte auf eine leere Stunde.
            skaliere(daten.voice.hours, voiceSeconds),
      topChannels: daten.voice.topChannels.map((kanal, index) =>
        index === 0 ? { ...kanal, seconds: Math.round(voiceSeconds * 0.5) } : kanal,
      ),
    },
    messages: { ...daten.messages, total: werte.messages ?? daten.messages.total },
    level: daten.level
      ? {
          ...daten.level,
          levelStart: werte.levelStart ?? daten.level.levelStart,
          levelEnd: werte.levelEnd ?? daten.level.levelEnd,
        }
      : null,
    clips: {
      ...daten.clips,
      wins: werte.clipWins ?? daten.clips.wins,
      approved: Math.max(daten.clips.approved, werte.clipWins ?? 0),
    },
    aktivitaet: { ...daten.aktivitaet, activeDays: werte.activeDays ?? daten.aktivitaet.activeDays },
  };

  return { ...teil, highlight: waehleHighlight(teil), archetyp: bestimmeArchetyp(teil), herkunft: 'fixture' };
}

function skaliere(hours: number[], gesamt: number): number[] {
  const summe = hours.reduce((a, b) => a + b, 0);
  if (summe <= 0) {
    return hours;
  }
  return hours.map((wert) => Math.round((wert / summe) * gesamt));
}
