import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_reaktivierung');

/**
 * Eine abgebrochene Runde zurueckholen.
 *
 * Die Regel - wer darf, wann, und als was - steht in
 * `tests/unit/clips-reaktivierung.test.ts`. Hier geht es um das, was nur eine
 * echte Datenbank zeigt: dass der Wechsel atomar ist, dass ein zweiter Aufruf
 * nichts Zweites anrichtet, und dass danach keine doppelten Runden, Stimmen
 * oder Gewinner entstehen.
 */
const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const MOD = { discordId: '100000000000000002', username: 'nina.mod' };
const ANNA = '100000000000000001';
const BEN = '100000000000000003';

/** Mittwoch, 23.09.2026, 14:00 Zuercher Zeit - mitten in der Woche 2026-W39. */
const MITTWOCH = new Date('2026-09-23T12:00:00Z');
/** Samstag derselben Woche - das Voting laeuft. */
const SAMSTAG = new Date('2026-09-26T12:00:00Z');
/** Montag der Folgewoche. */
const NAECHSTE_WOCHE = new Date('2026-09-28T06:00:00Z');

async function einstellungen(): Promise<void> {
  await setModuleEnabled(clips.CLIPS_MODULE_ID, true, 'test');
  await setModuleSettings(
    clips.CLIPS_MODULE_ID,
    {
      submissionStartDay: 1,
      submissionStartHour: 0,
      submissionStartMinute: 0,
      submissionEndDay: 5,
      submissionEndHour: 20,
      submissionEndMinute: 0,
      votingEndDay: 7,
      votingEndHour: 20,
      votingEndMinute: 0,
      autoCreateWeekly: true,
      votesPerMember: 3,
      submissionsPerMember: 1,
      allowSelfVote: false,
      showVoteCounts: false,
      showClipsDuringSubmission: true,
      announcementChannelId: null,
      announceStart: true,
      announceVoting: true,
      announceWinner: true,
      announceApprovedClips: false,
    },
    'test',
  );
}

async function leeren(): Promise<void> {
  await prisma.clipVote.deleteMany({});
  await prisma.clipReport.deleteMany({});
  await prisma.clipCompetitionEntry.deleteMany({});
  await prisma.clipCompetition.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

/** Ein freigegebener Clip in einer Runde. */
async function clipIn(competitionId: string, kennung: string, einreicher: string): Promise<string> {
  const clip = await prisma.clip.create({
    data: {
      guildId: GUILD,
      submittedByDiscordId: einreicher,
      submittedByUsername: `nutzer-${einreicher.slice(-2)}`,
      sourceType: 'YOUTUBE',
      provider: 'youtube',
      externalId: kennung,
      canonicalUrl: `https://www.youtube.com/watch?v=${kennung}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${kennung}`,
      title: `Clip ${kennung}`,
      status: 'APPROVED',
    },
  });
  const eintrag = await prisma.clipCompetitionEntry.create({
    data: { competitionId, clipId: clip.id, submittedByDiscordId: einreicher, status: 'APPROVED' },
  });
  return eintrag.id;
}

const protokoll = (aktion: string): Promise<number> => prisma.auditLog.count({ where: { action: aktion } });

describeWithDatabase('Abgebrochene Runde wieder aktivieren', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  async function abgebrocheneRunde(jetzt = MITTWOCH): Promise<string> {
    const runde = await clips.holeOderErstelleRunde(GUILD, jetzt);
    expect(await clips.brichAb(runde.id, MOD, 'Versehen')).toBe(true);
    return runde.id;
  }

  it('bringt die Runde in die Phase zurück, die laut Zeitplan gilt', async () => {
    const id = await abgebrocheneRunde();

    const ergebnis = await clips.reaktiviere(id, MOD, MITTWOCH);

    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.ok && ergebnis.ziel).toBe('SUBMISSION');

    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id } });
    expect(runde.status).toBe('SUBMISSION');
    // Der Abbruchvermerk ist weg - er stimmt nicht mehr.
    expect(runde.cancelledAt).toBeNull();
    expect(runde.cancelledByDiscordId).toBeNull();
  });

  it('verschiebt die ursprünglichen Fristen nicht', async () => {
    const id = await abgebrocheneRunde();
    const vorher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id } });

    await clips.reaktiviere(id, MOD, SAMSTAG);

    const nachher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id } });
    expect(nachher.status).toBe('VOTING');
    expect(nachher.key).toBe(vorher.key);
    expect(nachher.submissionStartsAt).toEqual(vorher.submissionStartsAt);
    expect(nachher.submissionEndsAt).toEqual(vorher.submissionEndsAt);
    expect(nachher.votingStartsAt).toEqual(vorher.votingStartsAt);
    expect(nachher.votingEndsAt).toEqual(vorher.votingEndsAt);
    expect(nachher.number).toBe(vorher.number);
  });

  it('schreibt genau einen Protokolleintrag', async () => {
    const id = await abgebrocheneRunde();
    await clips.reaktiviere(id, MOD, MITTWOCH);

    expect(await protokoll('CLIP_COMPETITION_REOPENED')).toBe(1);
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CLIP_COMPETITION_REOPENED' },
    });
    expect(eintrag.actorDiscordId).toBe(MOD.discordId);
    // Der Abbruch geht nicht verloren, nur weil die Spalte geleert wurde.
    expect(eintrag.metadata).toMatchObject({ ziel: 'SUBMISSION', abgebrochenVon: MOD.discordId });
  });

  it('tut beim zweiten Aufruf nichts und schreibt nichts', async () => {
    const id = await abgebrocheneRunde();

    expect((await clips.reaktiviere(id, MOD, MITTWOCH)).ok).toBe(true);
    const zweiter = await clips.reaktiviere(id, MOD, MITTWOCH);

    expect(zweiter.ok).toBe(false);
    expect(zweiter.ok === false && zweiter.hindernis).toBe('NICHT_ABGEBROCHEN');
    expect(await protokoll('CLIP_COMPETITION_REOPENED')).toBe(1);
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id } })).status).toBe('SUBMISSION');
  });

  it('lässt bei gleichzeitigen Aufrufen genau einen durch', async () => {
    /*
     * Zwei Tabs, derselbe Knopf. Ohne bedingtes `updateMany` kaemen beide
     * durch - und im Protokoll staende zweimal dieselbe Wiederaufnahme.
     */
    const id = await abgebrocheneRunde();

    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, () => clips.reaktiviere(id, MOD, MITTWOCH)),
    );

    expect(ergebnisse.filter((e) => e.ok)).toHaveLength(1);
    expect(await protokoll('CLIP_COMPETITION_REOPENED')).toBe(1);
  });

  it('weigert sich in der Folgewoche', async () => {
    const id = await abgebrocheneRunde();

    const ergebnis = await clips.reaktiviere(id, MOD, NAECHSTE_WOCHE);

    expect(ergebnis.ok === false && ergebnis.hindernis).toBe('ANDERE_WOCHE');
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    expect(await protokoll('CLIP_COMPETITION_REOPENED')).toBe(0);
  });

  it('weigert sich, wenn alle Fristen der Woche abgelaufen sind', async () => {
    const id = await abgebrocheneRunde();
    // Sonntag 20:30 Zürich: noch dieselbe Woche, das Voting ist vorbei.
    const ergebnis = await clips.reaktiviere(id, MOD, new Date('2026-09-27T18:30:00Z'));

    expect(ergebnis.ok === false && ergebnis.hindernis).toBe('FRISTEN_ABGELAUFEN');
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
  });

  it('öffnet eine abgeschlossene Runde nicht', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const eintrag = await clipIn(runde.id, 'clip-aaa', ANNA);
    await prisma.clipVote.create({
      data: { competitionId: runde.id, entryId: eintrag, voterDiscordId: BEN },
    });
    // Durch die Phasen bis zum Abschluss - so wie der Scheduler es täte.
    await clips.fuehreUebergaengeAus(GUILD, SAMSTAG);
    expect(
      await clips.finalisiere(runde.id, { quelle: 'scheduler', jetzt: new Date('2026-09-27T18:30:00Z') }),
    ).toBe(true);

    const ergebnis = await clips.reaktiviere(runde.id, MOD, new Date('2026-09-27T19:00:00Z'));

    expect(ergebnis.ok === false && ergebnis.hindernis).toBe('NICHT_ABGEBROCHEN');
    const nachher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(nachher.status).toBe('COMPLETED');
    expect(nachher.winnerEntryId).toBe(eintrag);
  });

  it('erzeugt keine zweite Runde für dieselbe Woche', async () => {
    const id = await abgebrocheneRunde();
    await clips.reaktiviere(id, MOD, MITTWOCH);

    // Der Wochenjob läuft weiter, während die Runde wieder offen ist.
    const nochmal = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);

    expect(nochmal.id).toBe(id);
    expect(await prisma.clipCompetition.count({ where: { guildId: GUILD } })).toBe(1);
  });

  it('behält Clips und Stimmen und zählt sie nicht doppelt', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const eintrag = await clipIn(runde.id, 'clip-bbb', ANNA);
    await prisma.clipVote.create({
      data: { competitionId: runde.id, entryId: eintrag, voterDiscordId: BEN },
    });
    await clips.brichAb(runde.id, MOD, null);

    await clips.reaktiviere(runde.id, MOD, MITTWOCH);

    expect(await prisma.clipCompetitionEntry.count({ where: { competitionId: runde.id } })).toBe(1);
    expect(await prisma.clipVote.count({ where: { competitionId: runde.id } })).toBe(1);
  });

  it('läuft danach wieder durch die gewohnten Übergänge', async () => {
    /*
     * Die eigentliche Zusage: zurueckgeholt heisst nicht «in einem
     * Sonderzustand», sondern «wieder im normalen Lauf». Der Scheduler
     * bewegt die Runde anschliessend ohne Zutun weiter - nach demselben
     * Zeitplan, den sie immer hatte.
     */
    const id = await abgebrocheneRunde();
    const eintrag = await clipIn(id, 'clip-ccc', ANNA);
    await clips.reaktiviere(id, MOD, MITTWOCH);

    await clips.fuehreUebergaengeAus(GUILD, SAMSTAG);
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id } })).status).toBe('VOTING');

    await prisma.clipVote.create({ data: { competitionId: id, entryId: eintrag, voterDiscordId: BEN } });
    await clips.fuehreUebergaengeAus(GUILD, new Date('2026-09-27T18:30:00Z'));

    const nachher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id } });
    expect(nachher.status).toBe('COMPLETED');
    expect(nachher.winnerEntryId).toBe(eintrag);
    expect(await protokoll('CLIP_COMPETITION_FINALIZED')).toBe(1);
  });

  it('kündigt nichts ein zweites Mal an', async () => {
    /*
     * Wurde der Start bereits angekuendigt, steht die Nachrichtenkennung in
     * der Zeile. Die Wiederaufnahme loescht sie nicht - sonst gaebe es zu
     * derselben Runde einen zweiten Aufruf im Kanal.
     */
    const id = await abgebrocheneRunde();
    await prisma.clipCompetition.update({
      where: { id },
      data: { startMessageId: '800000000000000001', startChannelId: '700000000000000010' },
    });

    await clips.reaktiviere(id, MOD, MITTWOCH);

    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id } });
    expect(runde.startMessageId).toBe('800000000000000001');
  });
});
