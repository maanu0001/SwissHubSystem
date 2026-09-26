import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_wrapped_e2e');

/**
 * Die Erhebung von Anfang bis Ende, gegen eine echte Datenbank.
 *
 * ## Weshalb dieser Test zusaetzlich zu `wrapped-ausgabe.test.ts` existiert
 *
 * Der dortige Test belegt, dass keine Zahl erfunden wird, wo keine Daten
 * sind - die wichtigere Haelfte. Er belegt nicht die andere: dass bei
 * **vorhandenen** Daten wirklich alle dazu passenden Folien entstehen, mit
 * den gesaeten Zahlen darin.
 *
 * Genau diese Luecke hat mehrere Runden gekostet. «Es werden keine Daten
 * erhoben» liess sich nicht widerlegen, weil kein Test einen vollstaendig
 * gefuellten Zeitraum durchgerechnet hat. Ein erfolgreicher Aufruf ohne
 * gelesene Daten ist kein Beleg; hier wird deshalb auf die Zahlen geprueft
 * und nicht auf den Rueckgabewert.
 *
 * Gesaet wird ein Monat mit allem: Sprachzeit, Nachrichten, einem
 * entschiedenen Turnier, einem Termin mit Anmeldungen, einer abgeschlossenen
 * Clip-Runde, einer fertigen Auswahlrunde und einem freigegebenen Moment.
 */
const { prisma } = await import('@swisshub/database');
const { wrapped } = await import('@swisshub/modules');

const GUILD = '000000000000000009';
const MONAT = '2026-08';
const NACHHER = new Date('2026-10-01T12:00:00Z');
const periode = () => wrapped.periodeVon('MONTHLY', MONAT)!;

/** Sprachzeit und Nachrichten fuer jeden Tag des Monats. */
async function saeeTageswerte(voiceSekundenJeTag: number, nachrichtenJeTag: number): Promise<void> {
  const tage: Array<{ guildId: string; day: Date; messages: number; voiceSeconds: number }> = [];
  const personen: Array<{
    guildId: string;
    discordId: string;
    day: Date;
    messages: number;
    voiceSeconds: number;
  }> = [];

  for (let tag = 1; tag <= 31; tag += 1) {
    const day = new Date(`${MONAT}-${String(tag).padStart(2, '0')}T00:00:00.000Z`);
    tage.push({ guildId: GUILD, day, messages: nachrichtenJeTag, voiceSeconds: voiceSekundenJeTag });
    // Fuenf Personen je Tag - damit «aktive Mitglieder» nicht null ist.
    for (let i = 0; i < 5; i += 1) {
      personen.push({
        guildId: GUILD,
        discordId: `90000000000000${String(200 + i).padStart(4, '0')}`,
        day,
        messages: Math.round(nachrichtenJeTag / 5),
        voiceSeconds: Math.round(voiceSekundenJeTag / 5),
      });
    }
  }
  await prisma.analyticsDaily.createMany({ data: tage, skipDuplicates: true });
  await prisma.analyticsUserDaily.createMany({ data: personen, skipDuplicates: true });
}

async function saeeTurnier(): Promise<void> {
  const turnier = await prisma.tournament.create({
    data: {
      guildId: GUILD,
      slug: 'sommercup',
      name: 'Sommercup',
      gameName: 'Valorant',
      status: 'COMPLETED',
      createdByDiscordId: '900000000000000301',
      // Entschieden IM Monat, aber angelegt davor - genau der Fall, an dem
      // die Datenlage-Tafel frueher «nicht erhoben» behauptete.
      createdAt: new Date('2026-06-01T10:00:00Z'),
      startsAt: new Date(`${MONAT}-10T18:00:00Z`),
      completedAt: new Date(`${MONAT}-20T21:00:00Z`),
    },
  });
  await prisma.tournamentParticipant.createMany({
    data: [
      { tournamentId: turnier.id, discordId: '900000000000000301', username: 'siegerin', placement: 1 },
      { tournamentId: turnier.id, discordId: '900000000000000302', username: 'zweiter', placement: 2 },
    ],
  });
}

async function saeeTermin(): Promise<void> {
  const termin = await prisma.calendarEvent.create({
    data: {
      guildId: GUILD,
      slug: 'community-abend',
      title: 'Community-Abend',
      description: 'Ein Abend zusammen.',
      status: 'COMPLETED',
      startAt: new Date(`${MONAT}-15T19:00:00Z`),
      createdByDiscordId: '900000000000000301',
    },
  });
  await prisma.calendarRegistration.createMany({
    data: [
      { eventId: termin.id, discordId: '900000000000000301', status: 'CONFIRMED' },
      { eventId: termin.id, discordId: '900000000000000302', status: 'CONFIRMED' },
      { eventId: termin.id, discordId: '900000000000000303', status: 'CONFIRMED' },
    ],
  });
}

async function saeeClipRunde(): Promise<void> {
  const runde = await prisma.clipCompetition.create({
    data: {
      guildId: GUILD,
      key: `${MONAT}-w1`,
      number: 7,
      status: 'COMPLETED',
      submissionStartsAt: new Date(`${MONAT}-01T00:00:00Z`),
      submissionEndsAt: new Date(`${MONAT}-07T00:00:00Z`),
      votingStartsAt: new Date(`${MONAT}-07T00:00:00Z`),
      votingEndsAt: new Date(`${MONAT}-14T00:00:00Z`),
    },
  });
  const clip = await prisma.clip.create({
    data: {
      guildId: GUILD,
      title: 'Der Ace im letzten Zug',
      provider: 'youtube',
      sourceType: 'YOUTUBE',
      externalId: 'abc123',
      canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
      embedUrl: 'https://www.youtube.com/embed/abc123',
      submittedByDiscordId: '900000000000000301',
    },
  });
  await prisma.clipCompetitionEntry.create({
    data: {
      competitionId: runde.id,
      clipId: clip.id,
      submittedByDiscordId: '900000000000000301',
      finalRank: 1,
      finalVoteCount: 42,
    },
  });
}

async function saeeMoment(): Promise<void> {
  await prisma.wrappedMoment.create({
    data: {
      guildId: GUILD,
      title: 'Der Abend, an dem alle blieben',
      description: 'Bis vier Uhr morgens im Voice.',
      happenedAt: new Date(`${MONAT}-22T23:00:00Z`),
      priority: 10,
      includeMonthly: true,
      includeYearly: true,
    },
  });
}

async function leeren(): Promise<void> {
  await prisma.wrappedSlide.deleteMany({});
  await prisma.wrappedEdition.deleteMany({});
  await prisma.wrappedMoment.deleteMany({});
  await prisma.clipCompetitionEntry.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.clipCompetition.deleteMany({});
  await prisma.calendarRegistration.deleteMany({});
  await prisma.calendarEvent.deleteMany({});
  await prisma.tournamentParticipant.deleteMany({});
  await prisma.tournament.deleteMany({});
  await prisma.analyticsUserDaily.deleteMany({});
  await prisma.analyticsDaily.deleteMany({});
  await prisma.analyticsTracking.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

describeWithDatabase('Wrapped-Erhebung von Anfang bis Ende', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await prisma.analyticsTracking.create({
      data: {
        guildId: GUILD,
        voiceSince: new Date('2025-01-01T00:00:00Z'),
        messagesSince: new Date('2025-01-01T00:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('liest bei vollstaendigen Daten wirklich Zahlen und schreibt sie in die Folien', async () => {
    await saeeTageswerte(7200, 500);
    await saeeTurnier();
    await saeeTermin();
    await saeeClipRunde();
    await saeeMoment();

    // 1. Erhebung ausloesen.
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, periode(), { jetzt: NACHHER });
    expect(ergebnis.neu).toBe(true);

    // 2. Snapshot wirklich gespeichert - nicht nur ein erfolgreicher Aufruf.
    const ausgabe = await wrapped.ladeAusgabe(ergebnis.editionId);
    expect(ausgabe).not.toBeNull();
    expect(ausgabe!.generatedAt).toBeInstanceOf(Date);

    const schluessel = ausgabe!.folien.map((folie) => folie.storyKey);

    // 3. Die Folien, zu denen es Daten gibt, sind da.
    expect(schluessel).toContain('voice_total');
    expect(schluessel).toContain('tournament_winner');
    expect(schluessel).toContain('event_overview');
    expect(schluessel).toContain('clip_winner');
    expect(schluessel).toContain('community_moment');
    expect(schluessel).toContain('community');
    expect(schluessel).toContain('intro');
    expect(schluessel).toContain('outro');

    /*
     * `messages` ist der lehrreiche Fall.
     *
     * Ein Monat fasst acht Folien. Sind mehr Stories aussagekraeftig als
     * Platz da ist, verliert eine das Ranking - hier die Nachrichtenzahl.
     * Das ist kein fehlender Datensatz, und genau diese Unterscheidung war
     * vorher nicht sichtbar: die Diagnose muss «kein_platz» sagen UND die
     * gelesene Rohzahl nennen. Steht dort 0, waeren die Daten nicht gelesen
     * worden - und das ist der Vorwurf, um den es geht.
     */
    if (!schluessel.includes('messages')) {
      const grund = ausgabe!.gruende.find((g) => g.storyKey === 'messages');
      expect(grund?.lage).toBe('kein_platz');
      expect(grund?.rohdaten).toBe(15_500);
    }

    // 4. Und sie tragen die gesaeten Zahlen, nicht Platzhalter.
    //    31 Tage x 7200 s = 223'200 s = 62 Stunden.
    const voice = ausgabe!.folien.find((folie) => folie.storyKey === 'voice_total');
    expect(JSON.stringify(voice?.daten)).toContain('62');

    //    Der Turniersieger steht namentlich drin.
    const turnier = ausgabe!.folien.find((folie) => folie.storyKey === 'tournament_winner');
    expect(JSON.stringify(turnier?.daten)).toContain('siegerin');
    expect(JSON.stringify(turnier?.daten)).toContain('Sommercup');

    //    Der Clip-Titel und die Stimmenzahl.
    const clip = ausgabe!.folien.find((folie) => folie.storyKey === 'clip_winner');
    expect(JSON.stringify(clip?.daten)).toContain('Der Ace im letzten Zug');

    //    Der Moment.
    const moment = ausgabe!.folien.find((folie) => folie.storyKey === 'community_moment');
    expect(JSON.stringify(moment?.daten)).toContain('Der Abend, an dem alle blieben');
  });

  it('zaehlt ein im Zeitraum entschiedenes Turnier als vorhanden, auch wenn es davor angelegt wurde', async () => {
    /*
     * Der Fall, an dem die Datenlage-Tafel log.
     *
     * Sie zaehlte Turniere nach `createdAt`. Das Turnier hier wurde im Juni
     * angelegt und im August entschieden - die Tafel meldete «nicht erhoben»,
     * waehrend die Folie entstand. Beide muessen dasselbe sagen.
     */
    await saeeTurnier();

    const quellen = await wrapped.ermittleQuellen(GUILD, {
      start: periode().start,
      end: periode().end,
      year: periode().jahr,
    });
    expect(quellen.tournaments.lage).toBe('vollstaendig');
  });

  it('haelt einen Entwurf und eine abgesagte Runde aus der Datenlage heraus', async () => {
    /*
     * Die Gegenrichtung: ohne Statusfilter zaehlte die Tafel einen
     * Terminentwurf und eine abgebrochene Clip-Runde mit, meldete
     * «vollstaendig», und die Story fand danach nichts.
     */
    await prisma.calendarEvent.create({
      data: {
        guildId: GUILD,
        slug: 'nur-ein-entwurf',
        title: 'Entwurf',
        description: 'Noch nicht veröffentlicht.',
        status: 'DRAFT',
        startAt: new Date(`${MONAT}-12T19:00:00Z`),
        createdByDiscordId: '900000000000000301',
      },
    });
    await prisma.clipCompetition.create({
      data: {
        guildId: GUILD,
        key: `${MONAT}-abgesagt`,
        number: 8,
        status: 'CANCELLED',
        submissionStartsAt: new Date(`${MONAT}-01T00:00:00Z`),
        submissionEndsAt: new Date(`${MONAT}-07T00:00:00Z`),
        votingStartsAt: new Date(`${MONAT}-07T00:00:00Z`),
        votingEndsAt: new Date(`${MONAT}-14T00:00:00Z`),
      },
    });

    const quellen = await wrapped.ermittleQuellen(GUILD, {
      start: periode().start,
      end: periode().end,
      year: periode().jahr,
    });
    expect(quellen.events.lage).toBe('fehlt');
    expect(quellen.clips.lage).toBe('fehlt');
  });

  it('nennt zu jeder entfallenen Folie Zustaendigkeit, Rohdaten und ob Neuerheben hilft', async () => {
    // Nichts gesaet: alles ausser Eroeffnung und Abschluss entfaellt.
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, periode(), { jetzt: NACHHER });
    const ausgabe = await wrapped.ladeAusgabe(ergebnis.editionId);

    expect(ausgabe!.gruende.length).toBeGreaterThan(0);
    for (const grund of ausgabe!.gruende) {
      // Wer zustaendig ist.
      expect(grund.provider, `${grund.storyKey} ohne Provider`).toBeTruthy();
      // Ob Rohdaten lagen - 0 ist eine Antwort, undefined ist keine.
      expect(grund.rohdaten, `${grund.storyKey} ohne Rohdatenzahl`).not.toBeUndefined();
      // Und die Frage, die vorher offen blieb.
      expect(grund.neuErhebenHilft, `${grund.storyKey} ohne Erhebungsrat`).toBe(false);
      expect(grund.wasHilft, `${grund.storyKey} ohne Hinweis`).toMatch(/erneutes Erheben/u);
    }
  });

  it('gilt auch mit wenigen Folien als erhoben und nicht als gescheitert', async () => {
    /*
     * Eine Ausgabe mit zwei Folien ist eine gueltige Ausgabe. Sie darf nicht
     * als Fehlzustand erscheinen - sonst sucht jemand einen Defekt, wo die
     * Wahrheit steht: in diesem Zeitraum gab es wenig zu erzaehlen.
     */
    const ergebnis = await wrapped.erzeugeAusgabe(GUILD, periode(), { jetzt: NACHHER });
    const ausgabe = await wrapped.ladeAusgabe(ergebnis.editionId);

    expect(ausgabe!.folien.length).toBeLessThan(5);
    expect(ausgabe!.generatedAt).toBeInstanceOf(Date);
    expect(ausgabe!.failureReason).toBeNull();
  });
});
