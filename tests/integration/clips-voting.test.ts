import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_voting');

/**
 * Das Stimmenkonto haelt auch dann, wenn alle gleichzeitig klicken.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Die ganze Vorkehrung besteht aus einer Eindeutigkeitsbedingung und einer
 * Zeilensperre. Beides gibt es in einer Nachbildung von Prisma nicht - ein
 * Test dagegen wuerde bestaetigen, dass die Nachbildung tut, was man ihr
 * beigebracht hat, und ueber die Datenbank nichts aussagen.
 *
 * ## Was hier tatsaechlich schiefgehen kann
 *
 * Zwei Faelle, und sie brauchen verschiedene Mittel:
 *
 *   - **Zweimal derselbe Clip** (Doppelklick): die Bedingung
 *     `(competitionId, entryId, voterDiscordId)` faengt ihn ab.
 *   - **Zwei verschiedene Clips mit der letzten freien Stimme**: davor
 *     schuetzt die Bedingung nicht, weil die Zeilen verschieden sind. Dort
 *     wirkt die Sperre auf der Runde.
 *
 * Beide werden unten mit echtem `Promise.all` ausgeloest, nicht
 * nacheinander.
 */
const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const WAEHLER = '100000000000000001';
const ANDERER = '100000000000000002';
const EINREICHER = '100000000000000003';

const actor = (discordId: string): { discordId: string; username: string } => ({
  discordId,
  username: `nutzer-${discordId.slice(-2)}`,
});

async function einstellungen(teile: Record<string, unknown> = {}): Promise<void> {
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
      announceStart: false,
      announceVoting: false,
      announceWinner: false,
      announceApprovedClips: false,
      ...teile,
    },
    'test',
  );
}

/** Eine Runde im Voting, mit `anzahl` freigegebenen Clips. */
async function rundeImVoting(
  anzahl: number,
  optionen: { allowSelfVote?: boolean; votesPerMember?: number } = {},
): Promise<{ competitionId: string; entryIds: string[] }> {
  const runde = await prisma.clipCompetition.create({
    data: {
      guildId: GUILD,
      key: '2026-W39',
      number: 39,
      status: 'VOTING',
      /*
       * Das Voting hat bereits begonnen und endet erst in ferner Zukunft.
       *
       * Absichtlich so weit auseinander: `stimmeAb` prueft ohne
       * ausdruecklichen Zeitpunkt gegen die echte Uhr, und ein Test, der nur
       * an einem bestimmten Tag gruen ist, sagt nichts ueber den Code.
       */
      submissionStartsAt: new Date('2020-01-06T00:00:00Z'),
      submissionEndsAt: new Date('2020-01-10T19:00:00Z'),
      votingStartsAt: new Date('2020-01-10T19:00:00Z'),
      votingEndsAt: new Date('2099-01-12T19:00:00Z'),
      votesPerMember: optionen.votesPerMember ?? 3,
      submissionsPerMember: 1,
      allowSelfVote: optionen.allowSelfVote ?? false,
      showVoteCounts: false,
    },
  });

  const entryIds: string[] = [];
  for (let index = 0; index < anzahl; index += 1) {
    const clip = await prisma.clip.create({
      data: {
        guildId: GUILD,
        submittedByDiscordId: EINREICHER,
        sourceType: 'YOUTUBE',
        provider: 'youtube',
        externalId: `clip${String(index).padStart(7, '0')}`,
        canonicalUrl: `https://www.youtube.com/watch?v=clip${index}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/clip${index}`,
        title: `Clip ${index}`,
        status: 'APPROVED',
      },
    });
    const eintrag = await prisma.clipCompetitionEntry.create({
      data: {
        competitionId: runde.id,
        clipId: clip.id,
        submittedByDiscordId: EINREICHER,
        status: 'APPROVED',
      },
    });
    entryIds.push(eintrag.id);
  }

  return { competitionId: runde.id, entryIds };
}

describeWithDatabase('Abstimmen unter Last', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipVote.deleteMany({});
    await prisma.clipCompetitionEntry.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.clip.deleteMany({});
    await einstellungen();
  });

  it('zaehlt fuenf gleichzeitige Stimmen auf denselben Clip als eine', async () => {
    const { entryIds } = await rundeImVoting(1);
    const [entryId] = entryIds;

    const ergebnisse = await Promise.allSettled(
      Array.from({ length: 5 }, () => clips.stimmeAb(GUILD, actor(WAEHLER), entryId!)),
    );

    const angenommen = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(angenommen).toHaveLength(1);
    expect(await prisma.clipVote.count({ where: { entryId } })).toBe(1);
  });

  it('haelt das Kontingent ein, wenn fuenf Stimmen gleichzeitig auf fuenf Clips gehen', async () => {
    /*
     * Der Fall, den die Eindeutigkeit **nicht** abfaengt.
     *
     * Fuenf verschiedene Clips sind fuenf verschiedene Zeilen - jede davon
     * ist fuer sich eindeutig. Ohne die Sperre auf der Runde zaehlten alle
     * fuenf Durchgaenge dasselbe «schon zwei von drei vergeben» und liessen
     * alle durch.
     */
    const { entryIds } = await rundeImVoting(5, { votesPerMember: 3 });

    const ergebnisse = await Promise.allSettled(
      entryIds.map((entryId) => clips.stimmeAb(GUILD, actor(WAEHLER), entryId)),
    );

    const angenommen = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(angenommen).toHaveLength(3);
    expect(await prisma.clipVote.count({ where: { voterDiscordId: WAEHLER } })).toBe(3);
  });

  it('laesst jede Person ihr eigenes Kontingent ausschoepfen', async () => {
    const { entryIds } = await rundeImVoting(3);

    await Promise.all([
      ...entryIds.map((entryId) => clips.stimmeAb(GUILD, actor(WAEHLER), entryId)),
      ...entryIds.map((entryId) => clips.stimmeAb(GUILD, actor(ANDERER), entryId)),
    ]);

    expect(await prisma.clipVote.count({ where: { voterDiscordId: WAEHLER } })).toBe(3);
    expect(await prisma.clipVote.count({ where: { voterDiscordId: ANDERER } })).toBe(3);
  });

  it('gibt die verbleibenden Stimmen zurueck', async () => {
    const { entryIds } = await rundeImVoting(3);
    expect((await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!)).verbleibend).toBe(2);
    expect((await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[1]!)).verbleibend).toBe(1);
    expect((await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[2]!)).verbleibend).toBe(0);
  });

  it('verschweigt die Stimmenzahl, solange sie verborgen sein soll', async () => {
    const { entryIds } = await rundeImVoting(1);
    const ergebnis = await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!);
    // `null` und nicht `0`: die Zahl verlaesst den Server gar nicht erst.
    expect(ergebnis.stimmen).toBeNull();
  });

  it('nennt die Stimmenzahl, wenn die Runde sie offenlegt', async () => {
    const { competitionId, entryIds } = await rundeImVoting(1);
    await prisma.clipCompetition.update({ where: { id: competitionId }, data: { showVoteCounts: true } });
    const ergebnis = await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!);
    expect(ergebnis.stimmen).toBe(1);
  });

  it('erlaubt das Zuruecknehmen und danach eine neue Stimme', async () => {
    const { entryIds } = await rundeImVoting(2, { votesPerMember: 1 });

    await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!);
    await expect(clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[1]!)).rejects.toThrow();

    const zurueck = await clips.nimmStimmeZurueck(GUILD, actor(WAEHLER), entryIds[0]!);
    expect(zurueck.verbleibend).toBe(1);

    await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[1]!);
    expect(await prisma.clipVote.count({ where: { voterDiscordId: WAEHLER } })).toBe(1);
  });
});

describeWithDatabase('Abstimmen: was der Server ablehnt', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipVote.deleteMany({});
    await prisma.clipCompetitionEntry.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.clip.deleteMany({});
    await einstellungen();
  });

  it('lehnt die Stimme fuer den eigenen Clip ab', async () => {
    const { entryIds } = await rundeImVoting(1);
    await expect(clips.stimmeAb(GUILD, actor(EINREICHER), entryIds[0]!)).rejects.toThrow(/eigenen Clip/u);
    expect(await prisma.clipVote.count({})).toBe(0);
  });

  it('erlaubt sie, wenn die Runde es ausdruecklich zulaesst', async () => {
    const { entryIds } = await rundeImVoting(1, { allowSelfVote: true });
    await expect(clips.stimmeAb(GUILD, actor(EINREICHER), entryIds[0]!)).resolves.toMatchObject({
      gesetzt: true,
    });
  });

  it('lehnt sie nach Ablauf des Votings ab - auch wenn der Status noch VOTING sagt', async () => {
    /*
     * Die Minute zwischen Ablauf und naechstem Durchgang der Zeitsteuerung.
     *
     * Der Status steht dann noch auf VOTING, und wer nur ihn prueft, nimmt
     * eine Stimme nach Ablauf an. Deshalb entscheidet zusaetzlich die Uhr.
     */
    const { competitionId, entryIds } = await rundeImVoting(1);
    await prisma.clipCompetition.update({
      where: { id: competitionId },
      data: { votingEndsAt: new Date('2020-01-12T19:00:00Z') },
    });

    await expect(
      clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!, new Date('2020-01-12T19:00:01Z')),
    ).rejects.toThrow(/beendet/u);
    expect(await prisma.clipVote.count({})).toBe(0);
  });

  it('lehnt sie vor Beginn des Votings ab', async () => {
    const { entryIds } = await rundeImVoting(1);
    await expect(
      clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!, new Date('2020-01-10T18:59:00Z')),
    ).rejects.toThrow(/noch nicht/u);
  });

  it('lehnt sie ab, solange die Einreichungen laufen', async () => {
    const { competitionId, entryIds } = await rundeImVoting(1);
    await prisma.clipCompetition.update({ where: { id: competitionId }, data: { status: 'SUBMISSION' } });
    await expect(clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!)).rejects.toThrow(/noch nicht/u);
  });

  it('lehnt sie fuer einen Clip ab, der nicht freigegeben ist', async () => {
    const { entryIds } = await rundeImVoting(1);
    await prisma.clipCompetitionEntry.update({
      where: { id: entryIds[0]! },
      data: { status: 'PENDING' },
    });
    await expect(clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!)).rejects.toThrow(
      /nicht zur Abstimmung/u,
    );
  });

  it('lehnt sie fuer einen Eintrag eines anderen Servers ab', async () => {
    const { entryIds } = await rundeImVoting(1);
    // Dieselbe Kennung, anderer Server: die Runde gehoert nicht dazu.
    await expect(clips.stimmeAb('000000000000000099', actor(WAEHLER), entryIds[0]!)).rejects.toThrow(
      /gibt es nicht/u,
    );
  });

  it('lehnt sie fuer eine erfundene Kennung ab', async () => {
    await rundeImVoting(1);
    await expect(clips.stimmeAb(GUILD, actor(WAEHLER), 'cl000000000000000000000000')).rejects.toThrow(
      /gibt es nicht/u,
    );
  });

  it('lehnt sie ab, wenn das Modul ausgeschaltet ist', async () => {
    const { entryIds } = await rundeImVoting(1);
    await setModuleEnabled(clips.CLIPS_MODULE_ID, false, 'test');
    await expect(clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!)).rejects.toThrow();
  });

  it('nimmt nach dem Ende keine Stimme mehr zurueck', async () => {
    const { competitionId, entryIds } = await rundeImVoting(1);
    await clips.stimmeAb(GUILD, actor(WAEHLER), entryIds[0]!);
    await prisma.clipCompetition.update({ where: { id: competitionId }, data: { status: 'COMPLETED' } });

    await expect(clips.nimmStimmeZurueck(GUILD, actor(WAEHLER), entryIds[0]!)).rejects.toThrow(/beendet/u);
    expect(await prisma.clipVote.count({})).toBe(1);
  });
});
