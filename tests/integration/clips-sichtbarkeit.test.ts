import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_sichtbarkeit');

/**
 * Was der Server herausgibt - und was nicht.
 *
 * ## Warum das mehr ist als eine Anzeigefrage
 *
 * «Stimmen waehrend des Votings verbergen» ist die Vorgabe, weil sichtbare
 * Zwischenstaende die Stimmen zum Fuehrenden ziehen. Diese Wirkung tritt
 * schon dann ein, wenn die Zahl **irgendwo** ablesbar ist - in der
 * Netzwerkanzeige des Browsers genuegt.
 *
 * Verborgen heisst deshalb: die Zahl verlaesst den Server nicht. Diese Datei
 * prueft genau das, und zwar an der Stelle, an der die Oberflaeche ihre
 * Daten holt.
 */
const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const CARLA = '100000000000000003';

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
      announceStart: false,
      announceVoting: false,
      announceWinner: false,
      announceApprovedClips: false,
    },
    'test',
  );
}

async function runde(status: 'SUBMISSION' | 'VOTING' | 'COMPLETED', showVoteCounts = false): Promise<string> {
  const eintrag = await prisma.clipCompetition.create({
    data: {
      guildId: GUILD,
      key: '2026-W39',
      number: 39,
      status,
      submissionStartsAt: new Date('2020-01-06T00:00:00Z'),
      submissionEndsAt: new Date('2020-01-10T19:00:00Z'),
      votingStartsAt: new Date('2020-01-10T19:00:00Z'),
      votingEndsAt: new Date('2099-01-12T19:00:00Z'),
      votesPerMember: 3,
      submissionsPerMember: 1,
      allowSelfVote: false,
      showVoteCounts,
    },
  });
  return eintrag.id;
}

async function clipMitStimmen(
  competitionId: string,
  kennung: string,
  einreicher: string,
  waehler: string[],
  status: 'PENDING' | 'APPROVED' = 'APPROVED',
): Promise<string> {
  const clip = await prisma.clip.create({
    data: {
      guildId: GUILD,
      submittedByDiscordId: einreicher,
      sourceType: 'YOUTUBE',
      provider: 'youtube',
      externalId: kennung,
      canonicalUrl: `https://www.youtube.com/watch?v=${kennung}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${kennung}`,
      title: `Clip ${kennung}`,
      gameName: kennung.startsWith('a') ? 'Valorant' : 'CS2',
      status: status === 'APPROVED' ? 'APPROVED' : 'PENDING',
    },
  });
  const eintrag = await prisma.clipCompetitionEntry.create({
    data: { competitionId, clipId: clip.id, submittedByDiscordId: einreicher, status },
  });
  for (const person of waehler) {
    await prisma.clipVote.create({
      data: { competitionId, entryId: eintrag.id, voterDiscordId: person },
    });
  }
  return eintrag.id;
}

describeWithDatabase('Stimmen bleiben verborgen, solange sie es sollen', () => {
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

  it('gibt waehrend des Votings keine Stimmenzahl heraus', async () => {
    const competitionId = await runde('VOTING');
    await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, [BEN, CARLA]);

    const galerie = await clips.galerie({ competitionId, betrachterDiscordId: BEN });
    expect(galerie.karten[0]?.stimmen).toBeNull();
    // Die eigene Stimme darf man sehen - sie ist die eigene.
    expect(galerie.karten[0]?.eigeneStimme).toBe(true);
  });

  it('gibt sie heraus, wenn die Runde es vorsieht', async () => {
    const competitionId = await runde('VOTING', true);
    await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, [BEN, CARLA]);

    const galerie = await clips.galerie({ competitionId, betrachterDiscordId: BEN });
    expect(galerie.karten[0]?.stimmen).toBe(2);
  });

  it('gibt sie nach dem Abschluss immer heraus', async () => {
    const competitionId = await runde('COMPLETED');
    const entryId = await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, [BEN, CARLA]);
    await prisma.clipCompetitionEntry.update({
      where: { id: entryId },
      data: { finalRank: 1, finalVoteCount: 2 },
    });

    const galerie = await clips.galerie({ competitionId, betrachterDiscordId: BEN });
    expect(galerie.karten[0]?.stimmen).toBe(2);
    expect(galerie.karten[0]?.rang).toBe(1);
  });

  it('sortiert nicht nach Stimmen, wenn sie verborgen sind', async () => {
    /*
     * Die Reihenfolge waere sonst die Zahl.
     *
     * Wer nach «meiste Stimmen» sortiert und die Liste von oben liest, kennt
     * den Zwischenstand auch ohne Zahlen. Der Wunsch faellt deshalb still auf
     * «neueste» zurueck, statt eine Fehlermeldung zu zeigen.
     */
    const competitionId = await runde('VOTING');
    /*
     * Der Clip mit den meisten Stimmen ist absichtlich der **aeltere**.
     *
     * Nur so unterscheiden sich die beiden Reihenfolgen: nach «neueste»
     * steht er hinten, nach «meiste Stimmen» vorne. Waeren beide gleich,
     * ginge der Test auch dann durch, wenn die Sortierung heimlich doch
     * nach Stimmen ginge.
     */
    const viel = await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, [BEN, CARLA]);
    const wenig = await clipMitStimmen(competitionId, 'bbbbbbbbbbb', BEN, []);

    const verborgen = await clips.galerie({ competitionId, sortierung: 'stimmen' });
    expect(verborgen.karten.map((karte) => karte.entryId)).toEqual([wenig, viel]);

    // Dieselbe Runde mit offenen Zahlen sortiert sehr wohl nach Stimmen.
    await prisma.clipCompetition.update({ where: { id: competitionId }, data: { showVoteCounts: true } });
    const offen = await clips.galerie({ competitionId, sortierung: 'stimmen' });
    expect(offen.karten.map((karte) => karte.entryId)).toEqual([viel, wenig]);
  });

  it('zeigt nur freigegebene Clips', async () => {
    const competitionId = await runde('VOTING');
    await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, [], 'APPROVED');
    await clipMitStimmen(competitionId, 'bbbbbbbbbbb', BEN, [], 'PENDING');

    const galerie = await clips.galerie({ competitionId });
    expect(galerie.karten).toHaveLength(1);
    expect(galerie.gesamt).toBe(1);
  });

  it('filtert nach Spiel', async () => {
    const competitionId = await runde('VOTING');
    await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, []);
    await clipMitStimmen(competitionId, 'bbbbbbbbbbb', BEN, []);

    expect(await clips.spieleDerRunde(competitionId)).toEqual(['CS2', 'Valorant']);
    const nurCs = await clips.galerie({ competitionId, spiel: 'CS2' });
    expect(nurCs.karten).toHaveLength(1);
    expect(nurCs.karten[0]?.spiel).toBe('CS2');
  });

  it('markiert den eigenen Clip, aber nicht den fremden', async () => {
    const competitionId = await runde('VOTING');
    await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, []);

    const ausSicht = await clips.galerie({ competitionId, betrachterDiscordId: ANNA });
    expect(ausSicht.karten[0]?.eigenerClip).toBe(true);

    const fremd = await clips.galerie({ competitionId, betrachterDiscordId: BEN });
    expect(fremd.karten[0]?.eigenerClip).toBe(false);
  });

  it('zaehlt die Bilanz nur aus abgeschlossenen Runden', async () => {
    /*
     * Ein Profil, das vorlaeufige Raenge zeigt, luege jeden Montag.
     *
     * Solange die Runde laeuft, gibt es keinen Platz - nur einen
     * Zwischenstand, und der gehoert nicht ins Profil.
     */
    const laufend = await runde('VOTING');
    const entryId = await clipMitStimmen(laufend, 'aaaaaaaaaaa', ANNA, [BEN, CARLA]);

    const vorher = await clips.bilanz(GUILD, ANNA);
    expect(vorher).toMatchObject({ siege: 0, treppchen: 0, eingereicht: 1, erhalteneStimmen: 0 });

    await prisma.clipCompetition.update({ where: { id: laufend }, data: { status: 'COMPLETED' } });
    await prisma.clipCompetitionEntry.update({
      where: { id: entryId },
      data: { finalRank: 1, finalVoteCount: 2 },
    });

    const nachher = await clips.bilanz(GUILD, ANNA);
    expect(nachher).toMatchObject({ siege: 1, treppchen: 1, eingereicht: 1, erhalteneStimmen: 2 });
    expect(nachher.letzterSieg).toMatchObject({ key: '2026-W39', nummer: 39 });
  });

  it('zieht einen zufaelligen Clip, ohne denselben zweimal zu liefern', async () => {
    const competitionId = await runde('VOTING');
    const a = await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, []);
    const b = await clipMitStimmen(competitionId, 'bbbbbbbbbbb', BEN, []);

    const naechster = await clips.zufaelligerClip(competitionId, CARLA, a);
    expect(naechster?.entryId).toBe(b);
  });

  it('liefert bei einem einzigen Clip auch dann etwas, wenn er ausgeschlossen wurde', async () => {
    // Sonst staende der Knopf «Nächster Clip» bei einer Runde mit einem Clip
    // vor einer leeren Antwort.
    const competitionId = await runde('VOTING');
    const a = await clipMitStimmen(competitionId, 'aaaaaaaaaaa', ANNA, []);
    expect((await clips.zufaelligerClip(competitionId, CARLA, a))?.entryId).toBe(a);
  });
});
