import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { stunde, tagesSchluessel, zuercherTeile } from '../analytics/zeit';
import { bestimmeArchetyp } from './archetyp';
import { waehleHighlight } from './highlight';
import type {
  WrappedAktivitaet,
  WrappedClips,
  WrappedDaten,
  WrappedLevel,
  WrappedMessages,
  WrappedPerson,
  WrappedQuelle,
  WrappedQuellen,
  WrappedSpiele,
  WrappedVoice,
  WrappedVoiceMate,
  WrappedWettkampf,
} from './daten';

const log = createLogger('wrapped:resolver');

/**
 * Die eine Stelle, an der die Daten eines Rueckblicks entstehen.
 *
 * ## Warum genau eine Stelle
 *
 * Vierzehn Szenen koennten sich ihre Zahlen selbst holen. Dann haette die
 * Voice-Szene eine Vorstellung davon, was «Sprachzeit» ist, die Finale-Szene
 * eine zweite, und die Share Card eine dritte - und eine davon waere falsch.
 * Hier wird einmal gerechnet; die Szenen bekommen fertige Werte.
 *
 * ## Woher die Zahlen kommen
 *
 * Ausschliesslich aus den bestehenden Systemen. Dieses Modul misst nichts
 * selbst:
 *
 *   Sprachzeit    `AnalyticsVoiceSegment` - dieselben Abschnitte, dieselbe
 *                 AFK-Regel, dieselbe Fensterrechnung wie die Statistik
 *   Nachrichten   `AnalyticsUserDaily`
 *   Level         `XpTransaction` - das Journal, nicht der aktuelle Stand
 *   Clips         `ClipCompetitionEntry`
 *   Turniere      `TournamentParticipant`
 *   Termine       `CalendarRegistration`
 *   Spiele        `SpielwahlSupport`
 *
 * ## Was **nicht** hineingeht
 *
 * Nichts aus Moderation, Tickets, Jail, Verifikation, Entbannungsantraegen
 * oder Notizen. Ein Jahresrueckblick ist kein Fuehrungszeugnis. Und keine
 * Nachrichteninhalte: gezaehlt wird, nie gelesen.
 */

export interface WrappedZeitraum {
  start: Date;
  end: Date;
  year: number;
}

/** Was fuer alle Personen eines Laufs gleich ist - einmal geholt. */
export interface ResolverKontext {
  guildId: string;
  zeitraum: WrappedZeitraum;
  quellen: WrappedQuellen;
}

const iso = (wert: Date | null | undefined): string | null => wert?.toISOString() ?? null;

/** Anteil eines Zeitraums, der von `seit` an abgedeckt ist. */
function abdeckung(seit: Date | null, zeitraum: WrappedZeitraum): number {
  if (!seit || seit <= zeitraum.start) {
    return 1;
  }
  if (seit >= zeitraum.end) {
    return 0;
  }
  const gesamt = zeitraum.end.getTime() - zeitraum.start.getTime();
  return gesamt > 0 ? (zeitraum.end.getTime() - seit.getTime()) / gesamt : 0;
}

function quelle(seit: Date | null, zeitraum: WrappedZeitraum): WrappedQuelle {
  const anteil = abdeckung(seit, zeitraum);
  return {
    lage: anteil >= 0.999 ? 'vollstaendig' : anteil <= 0 ? 'fehlt' : 'teilweise',
    seit: anteil >= 0.999 ? null : iso(seit),
    abdeckung: Math.round(anteil * 1000) / 1000,
  };
}

/**
 * Wie gut die Datenlage im Zeitraum ist.
 *
 * Einmal je Kampagne, nicht je Person: ob Sprachzeit seit Maerz gemessen
 * wird, haengt am Server und nicht am Mitglied. Das Studio zeigt genau
 * diese Auskunft an, damit das Team weiss, welche Szenen seriös sind.
 */
export async function ermittleQuellen(guildId: string, zeitraum: WrappedZeitraum): Promise<WrappedQuellen> {
  const tracking = await prisma.analyticsTracking.findUnique({ where: { guildId } });

  /*
   * Fuer die uebrigen Quellen gibt es keine «gemessen seit»-Marke - sie
   * entstehen aus fachlichen Zeilen, die es entweder gibt oder nicht. Die
   * frueheste Zeile im Zeitraum ist deshalb kein Beleg fuer Vollstaendigkeit;
   * hier zaehlt allein, ob es ueberhaupt etwas gibt. Ohne eine einzige Zeile
   * ist die Quelle `fehlt` - und jede Szene, die daran haengt, entfaellt fuer
   * alle.
   */
  const spanne = { gte: zeitraum.start, lt: zeitraum.end };
  const [clips, events, turniere, spiele, xp] = await Promise.all([
    prisma.clipCompetition.count({ where: { guildId, votingEndsAt: spanne } }),
    prisma.calendarEvent.count({ where: { guildId, startAt: spanne } }),
    prisma.tournament.count({ where: { guildId, createdAt: spanne } }),
    prisma.spielwahlSupport.count({ where: { createdAt: spanne } }),
    prisma.xpTransaction.count({ where: { createdAt: spanne } }),
  ]);

  const vorhanden = (anzahl: number): WrappedQuelle => ({
    lage: anzahl > 0 ? 'vollstaendig' : 'fehlt',
    seit: null,
    abdeckung: anzahl > 0 ? 1 : 0,
  });

  return {
    voice: quelle(tracking?.voiceSince ?? null, zeitraum),
    messages: quelle(tracking?.messagesSince ?? null, zeitraum),
    level: vorhanden(xp),
    clips: vorhanden(clips),
    events: vorhanden(events),
    tournaments: vorhanden(turniere),
    games: vorhanden(spiele),
  };
}

// --- Sprachzeit -------------------------------------------------------------

interface Abschnitt {
  sessionId: string;
  channelId: string;
  channelName: string | null;
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * Die Sprachzeit einer Person, nach allen Richtungen aufgeteilt.
 *
 * Ein Durchgang ueber die Abschnitte - danach stehen Summe, Kanaele,
 * laengste Anwesenheit und die Stundenverteilung fest. Jeder Abschnitt wird
 * auf den Zeitraum beschnitten: wer am 31.12. um 23:00 betritt und am 1.1.
 * um 02:00 geht, bringt eine Stunde ins alte Jahr und zwei ins neue.
 */
function werteAbschnitteAus(abschnitte: Abschnitt[], zeitraum: WrappedZeitraum): Omit<WrappedVoice, 'mates'> {
  const kanal = new Map<string, { name: string | null; seconds: number }>();
  const sitzung = new Map<string, { seconds: number; beginn: Date }>();
  const hours = new Array<number>(24).fill(0);
  let seconds = 0;

  for (const abschnitt of abschnitte) {
    const von = Math.max(abschnitt.joinedAt.getTime(), zeitraum.start.getTime());
    const bis = Math.min((abschnitt.leftAt ?? zeitraum.end).getTime(), zeitraum.end.getTime());
    const dauer = Math.max(0, Math.round((bis - von) / 1000));
    if (dauer === 0) {
      continue;
    }
    seconds += dauer;

    const bisher = kanal.get(abschnitt.channelId);
    kanal.set(abschnitt.channelId, {
      // Der zuletzt gesehene Name gewinnt - ein umbenannter Kanal soll unter
      // seinem heutigen Namen erscheinen, nicht unter dem vom Januar.
      name: abschnitt.channelName ?? bisher?.name ?? null,
      seconds: (bisher?.seconds ?? 0) + dauer,
    });

    const sitzungsstand = sitzung.get(abschnitt.sessionId);
    sitzung.set(abschnitt.sessionId, {
      seconds: (sitzungsstand?.seconds ?? 0) + dauer,
      beginn: sitzungsstand ? sitzungsstand.beginn : new Date(von),
    });

    /*
     * Auf Stunden verteilen.
     *
     * Zuerich liegt auf vollen Stunden zu UTC - die Stundengrenzen decken
     * sich also. Gelaufen wird von Grenze zu Grenze, statt den Abschnitt
     * seiner Anfangsstunde zuzuschlagen: wer von 22:40 bis 00:20 dasitzt,
     * gehoert in drei Stunden, nicht in eine.
     */
    let zeiger = von;
    while (zeiger < bis) {
      const grenze = stunde(new Date(zeiger)).getTime() + 3600_000;
      const ende = Math.min(grenze, bis);
      const index = zuercherTeile(new Date(zeiger)).stunde;
      hours[index] = (hours[index] ?? 0) + Math.round((ende - zeiger) / 1000);
      zeiger = ende;
    }
  }

  let laengste = { seconds: 0, beginn: null as Date | null };
  for (const eintrag of sitzung.values()) {
    if (eintrag.seconds > laengste.seconds) {
      laengste = { seconds: eintrag.seconds, beginn: eintrag.beginn };
    }
  }

  const topChannels = [...kanal.entries()]
    .map(([channelId, wert]) => ({ channelId, name: wert.name, seconds: wert.seconds }))
    .sort((a, b) => b.seconds - a.seconds || a.channelId.localeCompare(b.channelId))
    .slice(0, 5);

  return {
    seconds,
    sessions: sitzung.size,
    longestSessionSeconds: laengste.seconds,
    longestSessionAt: iso(laengste.beginn),
    topChannels,
    hours,
  };
}

/**
 * Mit wem jemand im Sprachkanal sass.
 *
 * ## Wie gerechnet wird
 *
 * Zwei Abschnitte ueberschneiden sich, wenn sie denselben Kanal betreffen
 * und ihre Zeitraeume sich beruehren. Die Ueberschneidung ist die gemeinsame
 * Zeit. Das ist dieselbe Rechnung, die auch die Statistik fuer Fenster
 * anwendet - nur zwischen zwei Personen statt zwischen Abschnitt und
 * Zeitraum.
 *
 * ## Warum das Ergebnis grob ist
 *
 * Auf fuenf Minuten gerundet und auf die ersten Plaetze begrenzt. Eine
 * sekundengenaue Liste, wer wann mit wem wo war, waere ein Bewegungsprofil -
 * und zwar ueber Personen, die diesen Rueckblick gar nicht angefordert
 * haben. Fuer «ihr wart oft zusammen unterwegs» genuegt die Groessenordnung.
 *
 * Bots bleiben aussen vor: der Musikbot ist niemandes bester Kumpel.
 */
async function ermittleMates(
  guildId: string,
  discordId: string,
  zeitraum: WrappedZeitraum,
  limit = 6,
): Promise<WrappedVoiceMate[]> {
  const treffer = await prisma.$queryRaw<Array<{ discordId: string; seconds: bigint }>>`
    SELECT b."discordId" AS "discordId",
           SUM(
             EXTRACT(EPOCH FROM (
               LEAST(COALESCE(a."leftAt", ${zeitraum.end}), COALESCE(b."leftAt", ${zeitraum.end}), ${zeitraum.end})
               - GREATEST(a."joinedAt", b."joinedAt", ${zeitraum.start})
             ))
           )::bigint AS "seconds"
      FROM "AnalyticsVoiceSegment" a
      JOIN "AnalyticsVoiceSegment" b
        ON b."guildId" = a."guildId"
       AND b."channelId" = a."channelId"
       AND b."discordId" <> a."discordId"
       AND b."isBot" = false
       AND b."isAfk" = false
       AND b."joinedAt" < LEAST(COALESCE(a."leftAt", ${zeitraum.end}), ${zeitraum.end})
       AND COALESCE(b."leftAt", ${zeitraum.end}) > GREATEST(a."joinedAt", ${zeitraum.start})
     WHERE a."guildId" = ${guildId}
       AND a."discordId" = ${discordId}
       AND a."isAfk" = false
       AND a."joinedAt" < ${zeitraum.end}
       AND COALESCE(a."leftAt", ${zeitraum.end}) > ${zeitraum.start}
     GROUP BY b."discordId"
     ORDER BY "seconds" DESC
     LIMIT ${limit}
  `;

  if (treffer.length === 0) {
    return [];
  }

  const namen = await prisma.analyticsMemberProfile.findMany({
    where: { guildId, discordId: { in: treffer.map((eintrag) => eintrag.discordId) } },
    select: { discordId: true, username: true, displayName: true, avatarHash: true },
  });
  const nachId = new Map(namen.map((eintrag) => [eintrag.discordId, eintrag]));

  return treffer
    .map((eintrag) => {
      const person = nachId.get(eintrag.discordId);
      return {
        discordId: eintrag.discordId,
        username: person?.username ?? null,
        displayName: person?.displayName ?? null,
        avatarHash: person?.avatarHash ?? null,
        // Auf fuenf Minuten gerundet - siehe oben.
        sharedSecondsRounded: Math.round(Number(eintrag.seconds) / 300) * 300,
      };
    })
    .filter((eintrag) => eintrag.sharedSecondsRounded > 0);
}

// --- Die uebrigen Quellen ---------------------------------------------------

function werteTageAus(tage: Array<{ day: Date; messages: number; voiceSeconds: number }>): {
  messages: WrappedMessages;
  aktivitaet: WrappedAktivitaet;
} {
  let gesamt = 0;
  let mitNachrichten = 0;
  let besterTag: { day: string; messages: number } | null = null;

  const aktiveTage: string[] = [];
  const proMonat = new Array<number>(12).fill(0);
  const monatswerte = new Map<number, { messages: number; voiceSeconds: number }>();

  for (const eintrag of tage) {
    gesamt += eintrag.messages;
    if (eintrag.messages > 0) {
      mitNachrichten += 1;
      if (!besterTag || eintrag.messages > besterTag.messages) {
        besterTag = { day: tagesSchluessel(eintrag.day), messages: eintrag.messages };
      }
    }
    const aktiv = eintrag.messages > 0 || eintrag.voiceSeconds > 0;
    if (!aktiv) {
      continue;
    }
    const schluessel = tagesSchluessel(eintrag.day);
    aktiveTage.push(schluessel);
    const monat = Number(schluessel.slice(5, 7));
    proMonat[monat - 1] = (proMonat[monat - 1] ?? 0) + 1;
    const bisher = monatswerte.get(monat) ?? { messages: 0, voiceSeconds: 0 };
    monatswerte.set(monat, {
      messages: bisher.messages + eintrag.messages,
      voiceSeconds: bisher.voiceSeconds + eintrag.voiceSeconds,
    });
  }

  aktiveTage.sort();
  let longestStreak = 0;
  let laufend = 0;
  let vorheriger: string | null = null;
  for (const tag of aktiveTage) {
    /*
     * Aufeinanderfolgend heisst: der Vortag war auch aktiv.
     *
     * Gerechnet ueber den Kalendertag und nicht ueber 24 Stunden Abstand -
     * an den beiden Umstellungstagen im Jahr liegen zwischen zwei
     * Mitternachten 23 bzw. 25 Stunden, und eine Serie soll daran nicht
     * zerbrechen.
     */
    const anschluss = vorheriger !== null && istFolgetag(vorheriger, tag);
    laufend = anschluss ? laufend + 1 : 1;
    longestStreak = Math.max(longestStreak, laufend);
    vorheriger = tag;
  }

  let besterMonat: WrappedAktivitaet['bestMonth'] = null;
  for (const [monat, wert] of monatswerte) {
    const punkte = wert.messages + wert.voiceSeconds / 60;
    const bisherige = besterMonat ? besterMonat.messages + besterMonat.voiceSeconds / 60 : -1;
    if (punkte > bisherige) {
      besterMonat = { month: monat, messages: wert.messages, voiceSeconds: wert.voiceSeconds };
    }
  }

  return {
    messages: { total: gesamt, daysWithMessages: mitNachrichten, bestDay: besterTag },
    aktivitaet: {
      activeDays: aktiveTage.length,
      longestStreak,
      bestMonth: besterMonat,
      daysPerMonth: proMonat,
    },
  };
}

/** Ist `b` der Kalendertag direkt nach `a`? Beide als `YYYY-MM-DD`. */
function istFolgetag(a: string, b: string): boolean {
  const vorher = new Date(`${a}T12:00:00Z`);
  const folgt = new Date(vorher.getTime() + 24 * 3600_000);
  return folgt.toISOString().slice(0, 10) === b;
}

async function ermittleLevel(discordId: string, zeitraum: WrappedZeitraum): Promise<WrappedLevel | null> {
  const spanne = { gte: zeitraum.start, lt: zeitraum.end };
  const [erste, letzte, summe, tage] = await Promise.all([
    prisma.xpTransaction.findFirst({
      where: { discordId, createdAt: spanne },
      orderBy: { createdAt: 'asc' },
      select: { levelBefore: true },
    }),
    prisma.xpTransaction.findFirst({
      where: { discordId, createdAt: spanne },
      orderBy: { createdAt: 'desc' },
      select: { levelAfter: true },
    }),
    prisma.xpTransaction.aggregate({
      where: { discordId, createdAt: spanne, delta: { gt: 0 } },
      _sum: { delta: true },
    }),
    prisma.$queryRaw<Array<{ tag: string; xp: bigint }>>`
      SELECT to_char(("createdAt" AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD') AS "tag",
             SUM("delta")::bigint AS "xp"
        FROM "XpTransaction"
       WHERE "discordId" = ${discordId}
         AND "createdAt" >= ${zeitraum.start}
         AND "createdAt" < ${zeitraum.end}
         AND "delta" > 0
       GROUP BY 1
       ORDER BY "xp" DESC
       LIMIT 1
    `,
  ]);

  // Ohne eine einzige Buchung im Zeitraum gibt es nichts zu erzaehlen - und
  // «Level 0 → Level 0» waere die schlechteste Art, das zu sagen.
  if (!erste || !letzte) {
    return null;
  }

  const bester = tage[0];
  return {
    levelStart: erste.levelBefore,
    levelEnd: letzte.levelAfter,
    xpGained: summe._sum.delta ?? 0,
    bestDay: bester ? { day: bester.tag, xp: Number(bester.xp) } : null,
  };
}

async function ermittleClips(
  guildId: string,
  discordId: string,
  zeitraum: WrappedZeitraum,
): Promise<WrappedClips> {
  const eintraege = await prisma.clipCompetitionEntry.findMany({
    where: {
      submittedByDiscordId: discordId,
      competition: { guildId, votingEndsAt: { gte: zeitraum.start, lt: zeitraum.end } },
    },
    include: {
      clip: true,
      competition: { select: { key: true, number: true, status: true } },
    },
  });

  const freigegeben = eintraege.filter((eintrag) => eintrag.status === 'APPROVED');
  const siege = freigegeben.filter(
    (eintrag) => eintrag.finalRank === 1 && eintrag.competition.status === 'COMPLETED',
  );
  const stimmen = freigegeben.reduce((summe, eintrag) => summe + (eintrag.finalVoteCount ?? 0), 0);

  /*
   * Der erfolgreichste eigene Clip.
   *
   * Zuerst nach Platz, dann nach Stimmen: ein zweiter Platz mit acht Stimmen
   * ist in einer starken Woche mehr wert als ein Sieg mit dreien. Ohne
   * festgeschriebenes Ergebnis - die Runde laeuft noch - zaehlt der Clip
   * nicht als Bestleistung.
   */
  const bester = [...freigegeben]
    .filter((eintrag) => eintrag.finalRank !== null)
    .sort(
      (a, b) =>
        (a.finalRank ?? 99) - (b.finalRank ?? 99) ||
        (b.finalVoteCount ?? 0) - (a.finalVoteCount ?? 0) ||
        a.id.localeCompare(b.id),
    )[0];

  return {
    submitted: eintraege.length,
    approved: freigegeben.length,
    wins: siege.length,
    votesReceived: stimmen,
    best: bester
      ? {
          entryId: bester.id,
          clipId: bester.clipId,
          title: bester.clip.title,
          canonicalUrl: bester.clip.canonicalUrl,
          embedUrl: bester.clip.embedUrl,
          thumbnailUrl: bester.clip.thumbnailUrl,
          provider: bester.clip.provider,
          votes: bester.finalVoteCount ?? 0,
          rank: bester.finalRank,
          competitionKey: bester.competition.key,
          competitionNumber: bester.competition.number,
        }
      : null,
  };
}

async function ermittleWettkampf(
  guildId: string,
  discordId: string,
  zeitraum: WrappedZeitraum,
): Promise<WrappedWettkampf> {
  const spanne = { gte: zeitraum.start, lt: zeitraum.end };

  /*
   * Turnier: Teilnahme, nicht Anmeldung.
   *
   * `TournamentParticipant` entsteht erst, wenn jemand ins Teilnehmerfeld
   * aufgenommen wird - eine blosse Anmeldung auf der Warteliste steht in
   * `TournamentRegistration` und zaehlt hier nicht. Genau diesen Unterschied
   * kennt das Turniersystem, und er wird hier nicht eingeebnet.
   */
  const [teilnahmen, termine] = await Promise.all([
    prisma.tournamentParticipant.findMany({
      where: { discordId, tournament: { guildId, createdAt: spanne } },
      select: { placement: true, tournament: { select: { name: true } } },
    }),
    prisma.calendarRegistration.findMany({
      where: {
        discordId,
        status: 'CONFIRMED',
        // Nur Termine, die stattgefunden haben. Eine Anmeldung fuer einen
        // abgesagten Abend ist keine Teilnahme.
        event: { guildId, startAt: spanne, status: { in: ['COMPLETED', 'ONGOING'] } },
      },
      select: { event: { select: { title: true } } },
    }),
  ]);

  const plaetze = teilnahmen
    .map((eintrag) => eintrag.placement)
    .filter((platz): platz is number => platz !== null);

  return {
    tournamentsPlayed: teilnahmen.length,
    tournamentWins: plaetze.filter((platz) => platz === 1).length,
    bestPlacement: plaetze.length > 0 ? Math.min(...plaetze) : null,
    eventsAttended: termine.length,
    eventTitles: termine.slice(0, 5).map((eintrag) => eintrag.event.title),
    tournamentTitles: teilnahmen.slice(0, 5).map((eintrag) => eintrag.tournament.name),
  };
}

/**
 * Welche Spiele jemand dieses Jahr mitgetragen hat.
 *
 * ## Warum Unterstuetzungen und nicht Teilnahmen
 *
 * Wer einer Runde beitritt, ist bei allem dabei, was dort vorgeschlagen
 * wird - auch bei Spielen, die ihn nicht interessieren. Was jemand
 * ausdruecklich gewollt hat, steht in `SpielwahlSupport`: er hat es
 * vorgeschlagen oder mitgetragen. Das ist die Angabe, aus der sich ein
 * «deine Spiele» bauen laesst, ohne etwas zu behaupten.
 *
 * ## Warum der Schnappschuss
 *
 * `nameSnapshot` haelt fest, wie das Spiel hiess, als es vorgeschlagen
 * wurde. Ein Rueckblick auf ein Jahr soll die Namen dieses Jahres zeigen -
 * und nicht die, die der Katalog heute fuehrt. Freie Vorschlaege zaehlen
 * mit: sie haben denselben Abend bestimmt wie ein Katalogeintrag.
 */
async function ermittleSpiele(discordId: string, zeitraum: WrappedZeitraum): Promise<WrappedSpiele> {
  const getragen = await prisma.spielwahlSupport.findMany({
    where: {
      discordId,
      createdAt: { gte: zeitraum.start, lt: zeitraum.end },
    },
    select: { candidate: { select: { gameId: true, nameSnapshot: true, namensKey: true } } },
  });

  const zaehler = new Map<string, { gameId: string | null; name: string; sessions: number }>();
  for (const eintrag of getragen) {
    const kandidat = eintrag.candidate;
    // Ohne Kennung im Katalog haelt der normalisierte Name die Vorschlaege
    // zusammen - sonst waeren «Valheim» und «valheim » zwei Spiele.
    const schluessel = kandidat.gameId ?? `frei:${kandidat.namensKey}`;
    const bisher = zaehler.get(schluessel);
    zaehler.set(schluessel, {
      gameId: kandidat.gameId,
      name: kandidat.nameSnapshot,
      sessions: (bisher?.sessions ?? 0) + 1,
    });
  }

  return {
    top: [...zaehler.values()]
      .map((wert) => ({ gameId: wert.gameId ?? '', name: wert.name, sessions: wert.sessions }))
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
      .slice(0, 5),
    quelle: 'spielwahl',
  };
}

// --- Der Zusammenbau --------------------------------------------------------

/**
 * Alles, was ueber eine Person feststeht.
 *
 * Ein Aufruf, ein Ergebnis - und genau dieses Ergebnis wird spaeter
 * eingefroren. Die Vorschau im Studio ruft dieselbe Funktion auf; sie
 * schreibt nur nichts weg.
 */
export async function sammleDaten(kontext: ResolverKontext, discordId: string): Promise<WrappedDaten> {
  const { guildId, zeitraum } = kontext;

  const [profil, tage, abschnitte, level, clips, wettkampf, spiele, mates] = await Promise.all([
    prisma.analyticsMemberProfile.findUnique({
      where: { guildId_discordId: { guildId, discordId } },
      select: {
        username: true,
        displayName: true,
        avatarHash: true,
        joinedAt: true,
      },
    }),
    prisma.analyticsUserDaily.findMany({
      where: { guildId, discordId, day: { gte: zeitraum.start, lt: zeitraum.end } },
      select: { day: true, messages: true, voiceSeconds: true },
      orderBy: { day: 'asc' },
    }),
    prisma.analyticsVoiceSegment.findMany({
      where: {
        guildId,
        discordId,
        isAfk: false,
        joinedAt: { lt: zeitraum.end },
        OR: [{ leftAt: null }, { leftAt: { gt: zeitraum.start } }],
      },
      select: { sessionId: true, channelId: true, channelName: true, joinedAt: true, leftAt: true },
    }),
    ermittleLevel(discordId, zeitraum),
    ermittleClips(guildId, discordId, zeitraum),
    ermittleWettkampf(guildId, discordId, zeitraum),
    ermittleSpiele(discordId, zeitraum),
    ermittleMates(guildId, discordId, zeitraum),
  ]);

  const voiceOhneMates = werteAbschnitteAus(abschnitte, zeitraum);
  const voice: WrappedVoice = { ...voiceOhneMates, mates };
  const { messages, aktivitaet } = werteTageAus(tage);

  /*
   * Der Name - drei Quellen, in dieser Reihenfolge.
   *
   * **Analytics-Profil.** Der Stand zur letzten Aeusserung im Zeitraum, und
   * damit der richtige fuer einen Rueckblick: wer sich seither umbenannt
   * hat, hiess damals anders.
   *
   * **Discord-Spiegel.** Der Fallback, der frueher fehlte. Er kam hier
   * nicht vor, obwohl er die eine Tabelle ist, in der zu jedem aktuellen
   * Mitglied ein Name steht - und das hatte Folgen bis ganz nach draussen:
   * ohne Namen sagt der Rueckblick «Du» statt «Manuel», und die Share Card
   * laedt als `swisshub-wrapped-2025-mitglied.png` herunter. Betroffen ist
   * jeder, zu dem das Analytics-Profil (noch) keinen Namen mitgeschrieben
   * hat.
   *
   * **Level-Profil.** Bleibt als letzte Reserve: wer den Server verlassen
   * hat, steht im Spiegel nicht mehr, im Level-System aber schon.
   *
   * Nur der Name. `joinedAt` kommt weiterhin ausschliesslich aus dem
   * Analytics-Profil - dort heisst `null` ausdruecklich «vor Beginn der
   * Aufzeichnung dabei», und diese Aussage soll der Spiegel nicht
   * ueberschreiben.
   */
  const brauchtNamen = !profil?.displayName && !profil?.username;
  const [spiegel, levelProfil] = brauchtNamen
    ? await Promise.all([
        prisma.discordMemberCache.findUnique({
          where: { discordId },
          select: { username: true, displayName: true, avatarHash: true },
        }),
        prisma.levelProfile.findUnique({
          where: { discordId },
          select: { username: true, displayName: true, avatarHash: true },
        }),
      ])
    : [null, null];

  const person: WrappedPerson = {
    discordId,
    username: profil?.username ?? spiegel?.username ?? levelProfil?.username ?? null,
    displayName: profil?.displayName ?? spiegel?.displayName ?? levelProfil?.displayName ?? null,
    avatarHash: profil?.avatarHash ?? spiegel?.avatarHash ?? levelProfil?.avatarHash ?? null,
    joinedAt: iso(profil?.joinedAt ?? null),
    imZeitraumBeigetreten:
      profil?.joinedAt !== null &&
      profil?.joinedAt !== undefined &&
      profil.joinedAt >= zeitraum.start &&
      profil.joinedAt < zeitraum.end,
  };

  const teil: Omit<WrappedDaten, 'highlight' | 'archetyp'> = {
    version: 1,
    person,
    period: { start: zeitraum.start.toISOString(), end: zeitraum.end.toISOString(), year: zeitraum.year },
    voice,
    messages,
    level,
    clips,
    wettkampf,
    spiele,
    aktivitaet,
    quellen: kontext.quellen,
  };

  const daten: WrappedDaten = {
    ...teil,
    highlight: waehleHighlight(teil),
    archetyp: bestimmeArchetyp(teil),
  };

  log.debug('Wrapped-Daten gesammelt', {
    discordId,
    voiceSeconds: voice.seconds,
    messages: messages.total,
    activeDays: aktivitaet.activeDays,
  });
  return daten;
}
