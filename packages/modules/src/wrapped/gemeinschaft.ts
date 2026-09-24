import { prisma } from '@swisshub/database';
import { tagesSchluessel } from '../analytics/zeit';
import { monatsName, monateEines, type WrappedPeriode } from './perioden';

/**
 * Was der Server in einem Zeitraum getan hat.
 *
 * ## Die eine Regel
 *
 * **Jede Zahl hier kommt aus einer Tabelle, die jemand tatsaechlich
 * befuellt.** Nichts wird geschaetzt, nichts hochgerechnet, nichts aus
 * heutigen Werten zurueckgerechnet. Wo keine Zeile steht, gibt es keine
 * Zahl - und dann gibt es auch keine Folie.
 *
 * ## Woher die Zahlen kommen
 *
 *   Sprachzeit, Nachrichten,   `AnalyticsDaily` - Tageswerte je Server, in
 *   Zutritte, Mitgliederzahl   Zuercher Kalendertagen abgelegt
 *   aktive Mitglieder          `AnalyticsUserDaily` - eine Zeile je Person
 *                              und Tag, deshalb zaehlbar statt summierbar
 *   Turniere                   `Tournament` + `TournamentParticipant`
 *   Termine                    `CalendarEvent` + `CalendarRegistration`
 *   Clips                      `ClipCompetition` + `ClipCompetitionEntry`
 *   Spielauswahl               `SpielwahlRound.gewinner`
 *
 * ## Warum `AnalyticsDaily` und nicht die Rohdaten
 *
 * Weil dort bereits je Tag steht, was ein Durchgang ueber `AnalyticsVoiceSegment`
 * erst wieder ausrechnen muesste - bei einem Jahr waeren das Millionen
 * Abschnitte. Die Tageswerte entstehen ohnehin und sind dieselbe Wahrheit,
 * nur vorsortiert. Fuer die Jahresausgabe ist das der Unterschied zwischen
 * einer Abfrage und einer Minute Rechenzeit.
 */

/** Ein Tageswert, wie ihn die Statistik fuehrt. */
export interface Gemeinschaftstag {
  tag: string;
  messages: number;
  voiceSeconds: number;
  voiceSessions: number;
  joins: number;
  leaves: number;
  memberCount: number | null;
}

export interface Gemeinschaftszahlen {
  /** Tage mit einer Zeile in der Statistik - nicht die Laenge des Zeitraums. */
  tageMitDaten: number;
  messages: number;
  voiceSeconds: number;
  voiceSessions: number;
  joins: number;
  leaves: number;
  /** Mitgliederzahl am letzten Tag, an dem eine Aufnahme gelang. */
  mitgliederAmEnde: number | null;
  /** Mitgliederzahl am ersten Tag mit Aufnahme - fuer das Wachstum. */
  mitgliederAmAnfang: number | null;
  /** Verschiedene Personen mit mindestens einer Aktivitaet. */
  aktiveMitglieder: number;
  /** Der Tag mit der meisten Sprachzeit. */
  besterVoiceTag: { tag: string; voiceSeconds: number } | null;
  /** Der Tag mit den meisten Nachrichten. */
  besterNachrichtenTag: { tag: string; messages: number } | null;
  tage: Gemeinschaftstag[];
}

/** Die Tageswerte eines Zeitraums - eine Abfrage, sortiert. */
export async function ladeTage(guildId: string, periode: WrappedPeriode): Promise<Gemeinschaftstag[]> {
  /*
   * `AnalyticsDaily.day` ist ein reines Datum - der Zuercher Kalendertag.
   * Der Zeitraum ist genau so geschnitten (Zuercher Mitternacht bis Zuercher
   * Mitternacht), also sind seine Grenzen zugleich die Tagesschluessel.
   */
  const vonTag = new Date(`${tagesSchluessel(periode.start)}T00:00:00.000Z`);
  const bisTag = new Date(`${tagesSchluessel(periode.end)}T00:00:00.000Z`);

  const zeilen = await prisma.analyticsDaily.findMany({
    where: { guildId, day: { gte: vonTag, lt: bisTag } },
    orderBy: { day: 'asc' },
  });

  return zeilen.map((zeile) => ({
    tag: zeile.day.toISOString().slice(0, 10),
    messages: zeile.messages,
    voiceSeconds: zeile.voiceSeconds,
    voiceSessions: zeile.voiceSessions,
    joins: zeile.joins,
    leaves: zeile.leaves,
    memberCount: zeile.memberCount,
  }));
}

export async function ladeGemeinschaftszahlen(
  guildId: string,
  periode: WrappedPeriode,
): Promise<Gemeinschaftszahlen> {
  const tage = await ladeTage(guildId, periode);

  const vonTag = new Date(`${tagesSchluessel(periode.start)}T00:00:00.000Z`);
  const bisTag = new Date(`${tagesSchluessel(periode.end)}T00:00:00.000Z`);

  /*
   * Aktive Mitglieder sind keine Summe.
   *
   * Wer an dreissig Tagen etwas geschrieben hat, ist eine Person und nicht
   * dreissig. Deshalb `groupBy` ueber die Kennung statt `sum` ueber die
   * Tageswerte - genau dafuer liegt `AnalyticsUserDaily` je Person und Tag
   * vor.
   */
  const aktive = await prisma.analyticsUserDaily.groupBy({
    by: ['discordId'],
    where: {
      guildId,
      day: { gte: vonTag, lt: bisTag },
      OR: [{ messages: { gt: 0 } }, { voiceSeconds: { gt: 0 } }],
    },
  });

  const mitAufnahme = tage.filter((tag) => tag.memberCount !== null);
  const besterVoice = tage.reduce<Gemeinschaftstag | null>(
    (beste, tag) => (tag.voiceSeconds > (beste?.voiceSeconds ?? 0) ? tag : beste),
    null,
  );
  const besteNachrichten = tage.reduce<Gemeinschaftstag | null>(
    (beste, tag) => (tag.messages > (beste?.messages ?? 0) ? tag : beste),
    null,
  );

  const summe = (waehle: (tag: Gemeinschaftstag) => number): number =>
    tage.reduce((gesamt, tag) => gesamt + waehle(tag), 0);

  return {
    tageMitDaten: tage.length,
    messages: summe((tag) => tag.messages),
    voiceSeconds: summe((tag) => tag.voiceSeconds),
    voiceSessions: summe((tag) => tag.voiceSessions),
    joins: summe((tag) => tag.joins),
    leaves: summe((tag) => tag.leaves),
    mitgliederAmEnde: mitAufnahme.at(-1)?.memberCount ?? null,
    mitgliederAmAnfang: mitAufnahme[0]?.memberCount ?? null,
    aktiveMitglieder: aktive.length,
    besterVoiceTag: besterVoice ? { tag: besterVoice.tag, voiceSeconds: besterVoice.voiceSeconds } : null,
    besterNachrichtenTag: besteNachrichten
      ? { tag: besteNachrichten.tag, messages: besteNachrichten.messages }
      : null,
    tage,
  };
}

/**
 * Der bisherige Bestwert eines Tages - **vor** dem Zeitraum.
 *
 * Grundlage jeder Aussage der Form «neuer Rekord». Ohne diesen Wert gibt es
 * keine solche Aussage: «der beste Tag aller Zeiten» laesst sich nur
 * behaupten, wenn alle Zeiten auch vorliegen. `null` heisst deshalb nicht
 * «null Sekunden», sondern «kein Vergleich moeglich» - und die Story
 * entfaellt.
 */
export async function bisherigerTagesRekord(
  guildId: string,
  periode: WrappedPeriode,
): Promise<{ voiceSeconds: number; tage: number } | null> {
  const vonTag = new Date(`${tagesSchluessel(periode.start)}T00:00:00.000Z`);

  const [bestes, anzahl] = await Promise.all([
    prisma.analyticsDaily.findFirst({
      where: { guildId, day: { lt: vonTag } },
      orderBy: { voiceSeconds: 'desc' },
      select: { voiceSeconds: true },
    }),
    prisma.analyticsDaily.count({ where: { guildId, day: { lt: vonTag } } }),
  ]);

  return bestes ? { voiceSeconds: bestes.voiceSeconds, tage: anzahl } : null;
}

// --- Turniere ---------------------------------------------------------------

export interface TurnierErgebnis {
  id: string;
  slug: string;
  name: string;
  gameName: string;
  /** Der Sieger - Teamname oder Anzeigename, wie er im Turnier stand. */
  sieger: string | null;
  teilnehmer: number;
  matches: number;
}

/**
 * Die im Zeitraum abgeschlossenen Turniere.
 *
 * Nur `COMPLETED`: ein laufendes Turnier hat keinen Sieger, und ein
 * abgebrochenes hatte nie einen. Der Siegername kommt aus dem Turnier selbst
 * und wird spaeter in die Folie eingefroren - wer sein Team danach umbenennt,
 * aendert damit keine veroeffentlichte Ausgabe mehr.
 */
export async function ladeTurniere(guildId: string, periode: WrappedPeriode): Promise<TurnierErgebnis[]> {
  const turniere = await prisma.tournament.findMany({
    where: {
      guildId,
      status: 'COMPLETED',
      /*
       * `completedAt` und nicht `startsAt`: ein Turnier gehoert in den
       * Monat, in dem es entschieden wurde. Eines, das am 30. September
       * beginnt und am 2. Oktober endet, ist ein Oktober-Turnier - der
       * Sieger stand im Oktober fest.
       *
       * Faellt `completedAt` aus (aeltere Turniere), zaehlt der Start.
       */
      OR: [
        { completedAt: { gte: periode.start, lt: periode.end } },
        { completedAt: null, startsAt: { gte: periode.start, lt: periode.end } },
      ],
    },
    select: {
      id: true,
      slug: true,
      name: true,
      gameName: true,
      _count: { select: { participants: true, matches: true } },
      participants: {
        where: { placement: 1 },
        select: { username: true, team: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { startsAt: 'desc' },
    take: 20,
  });

  return turniere.map((turnier) => ({
    id: turnier.id,
    slug: turnier.slug,
    name: turnier.name,
    gameName: turnier.gameName,
    sieger: turnier.participants[0]?.team?.name ?? turnier.participants[0]?.username ?? null,
    teilnehmer: turnier._count.participants,
    matches: turnier._count.matches,
  }));
}

// --- Termine ----------------------------------------------------------------

export interface TerminBilanz {
  termine: number;
  /** Bestaetigte Anmeldungen - der Kalender erhebt kein Einchecken. */
  anmeldungen: number;
  groesster: { title: string; anmeldungen: number } | null;
}

export async function ladeTermine(guildId: string, periode: WrappedPeriode): Promise<TerminBilanz> {
  const termine = await prisma.calendarEvent.findMany({
    where: {
      guildId,
      // Ein Entwurf ist kein Termin, und ein abgesagter hat nicht
      // stattgefunden.
      status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
      startAt: { gte: periode.start, lt: periode.end },
    },
    select: {
      title: true,
      _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } },
    },
  });

  const anmeldungen = termine.reduce((summe, termin) => summe + termin._count.registrations, 0);
  const groesster = termine.reduce<(typeof termine)[number] | null>(
    (beste, termin) => (termin._count.registrations > (beste?._count.registrations ?? 0) ? termin : beste),
    null,
  );

  return {
    termine: termine.length,
    anmeldungen,
    groesster:
      groesster && groesster._count.registrations > 0
        ? { title: groesster.title, anmeldungen: groesster._count.registrations }
        : null,
  };
}

// --- Clip of the Week -------------------------------------------------------

export interface ClipSieger {
  titel: string;
  runde: number;
  stimmen: number;
  einreicher: string | null;
}

/**
 * Die im Zeitraum abgeschlossenen Clip-Runden mit ihrem Sieger.
 *
 * Der Name des Einreichers kommt aus dem Discord-Spiegel - derselbe Name,
 * den die Hall of Fame ohnehin zeigt. Ein Stapel fuer alle Runden, keine
 * Abfrage je Zeile.
 */
export async function ladeClipSieger(guildId: string, periode: WrappedPeriode): Promise<ClipSieger[]> {
  const runden = await prisma.clipCompetition.findMany({
    where: { guildId, status: 'COMPLETED', votingEndsAt: { gte: periode.start, lt: periode.end } },
    select: {
      number: true,
      entries: {
        where: { finalRank: 1 },
        select: {
          finalVoteCount: true,
          submittedByDiscordId: true,
          clip: { select: { title: true } },
        },
        take: 1,
      },
    },
    orderBy: { number: 'desc' },
    take: 12,
  });

  const kennungen = runden
    .map((runde) => runde.entries[0]?.submittedByDiscordId)
    .filter((kennung): kennung is string => typeof kennung === 'string');

  const namen = new Map<string, string>();
  if (kennungen.length > 0) {
    const spiegel = await prisma.discordMemberCache.findMany({
      where: { discordId: { in: [...new Set(kennungen)] } },
      select: { discordId: true, displayName: true },
    });
    for (const eintrag of spiegel) {
      namen.set(eintrag.discordId, eintrag.displayName);
    }
  }

  return runden
    .map((runde) => {
      const sieger = runde.entries[0];
      return sieger
        ? {
            titel: sieger.clip.title,
            runde: runde.number,
            stimmen: sieger.finalVoteCount ?? 0,
            einreicher: namen.get(sieger.submittedByDiscordId) ?? null,
          }
        : null;
    })
    .filter((eintrag): eintrag is ClipSieger => eintrag !== null);
}

// --- Spielauswahl -----------------------------------------------------------

export interface SpielWahlErgebnis {
  name: string;
  runden: number;
}

/**
 * Was «Was spielen wir?» im Zeitraum am haeufigsten ausgewaehlt hat.
 *
 * **Das ist kein «Game of the Month».** So etwas gibt es auf dem SwissHub
 * nicht - es gibt Auswahlrunden, in denen eine Gruppe sich auf ein Spiel
 * einigt. Gezaehlt wird, wie oft ein Spiel aus einer *abgeschlossenen* Runde
 * als Gewinner hervorging. Die Folie sagt das auch so; «Spiel des Monats» zu
 * schreiben waere eine Auszeichnung, die niemand vergeben hat.
 *
 * Der Name kommt aus `nameSnapshot` - dem Stand zum Zeitpunkt des
 * Vorschlags. Ein spaeter umbenanntes Spiel aendert damit keine alte
 * Ausgabe.
 */
export async function ladeSpielauswahl(
  guildId: string,
  periode: WrappedPeriode,
): Promise<SpielWahlErgebnis[]> {
  const runden = await prisma.spielwahlRound.findMany({
    where: {
      status: 'FERTIG',
      finishedAt: { gte: periode.start, lt: periode.end },
      session: { guildId },
      gewinnerCandidateId: { not: null },
    },
    select: { gewinner: { select: { nameSnapshot: true } } },
  });

  const jeSpiel = new Map<string, number>();
  for (const runde of runden) {
    const name = runde.gewinner?.nameSnapshot;
    if (name) {
      jeSpiel.set(name, (jeSpiel.get(name) ?? 0) + 1);
    }
  }

  return [...jeSpiel.entries()]
    .map(([name, anzahl]) => ({ name, runden: anzahl }))
    .sort((a, b) => b.runden - a.runden || a.name.localeCompare(b.name))
    .slice(0, 5);
}

// --- Jahresauswertung -------------------------------------------------------

export interface MonatsWert {
  monat: number;
  name: string;
  messages: number;
  voiceSeconds: number;
  aktiveMitglieder: number;
}

/**
 * Das Jahr nach Monaten.
 *
 * **Nicht aus zwoelf fertigen Monatsausgaben zusammengesetzt.** Es kann gut
 * sein, dass es die gar nicht gibt - oder dass eine davon redaktionell
 * verkuerzt wurde. Gerechnet wird ueber dieselben Tageswerte wie sonst auch,
 * nur nach Monaten gruppiert; die Summe der zwoelf Monate ergibt damit genau
 * die Jahreszahl.
 */
export async function ladeMonatsverlauf(guildId: string, jahr: number): Promise<MonatsWert[]> {
  const monate = monateEines(jahr);
  const vonTag = new Date(`${tagesSchluessel(monate[0]!.start)}T00:00:00.000Z`);
  const bisTag = new Date(`${tagesSchluessel(monate[11]!.end)}T00:00:00.000Z`);

  const [tage, personenTage] = await Promise.all([
    prisma.analyticsDaily.findMany({
      where: { guildId, day: { gte: vonTag, lt: bisTag } },
      select: { day: true, messages: true, voiceSeconds: true },
    }),
    prisma.analyticsUserDaily.findMany({
      where: {
        guildId,
        day: { gte: vonTag, lt: bisTag },
        OR: [{ messages: { gt: 0 } }, { voiceSeconds: { gt: 0 } }],
      },
      select: { day: true, discordId: true },
    }),
  ]);

  const werte = monate.map((monat) => ({
    monat: monat.monat as number,
    name: monatsName(monat.monat as number),
    messages: 0,
    voiceSeconds: 0,
    aktiveMitglieder: 0,
  }));
  const personen = monate.map(() => new Set<string>());

  // Der Monat steckt im Datum selbst - `AnalyticsDaily.day` ist bereits der
  // Zuercher Kalendertag, also genuegt der Monatsteil.
  const monatVon = (tag: Date): number => Number(tag.toISOString().slice(5, 7));

  for (const tag of tage) {
    const index = monatVon(tag.day) - 1;
    const wert = werte[index];
    if (wert) {
      wert.messages += tag.messages;
      wert.voiceSeconds += tag.voiceSeconds;
    }
  }
  for (const eintrag of personenTage) {
    personen[monatVon(eintrag.day) - 1]?.add(eintrag.discordId);
  }
  for (const [index, wert] of werte.entries()) {
    wert.aktiveMitglieder = personen[index]?.size ?? 0;
  }

  return werte;
}
