import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_zeitsteuerung');

/**
 * Die Woche laeuft von selbst - und ueberlebt einen Neustart.
 *
 * ## Die zwei Fehler, die es hier zu vermeiden gilt
 *
 * **Zu wenig:** ein Bot, der zwei Stunden stand, eroeffnet keine Runde mehr
 * und schliesst keine ab. Die Woche faellt aus, und niemand merkt es vor
 * Montag.
 *
 * **Zu viel:** ein Bot, der jede Minute neu laeuft, kuendigt jede Minute
 * denselben Gewinner an. Nach einem Nachmittag hat der Kanal zweihundert
 * Nachrichten.
 *
 * Beide Faelle stehen unten, und beide werden nicht mit `setTimeout`
 * geprueft, sondern mit einer Uhr, die als Wert hereingereicht wird: die
 * Zeitsteuerung fragt die Datenbank, was faellig ist, nicht einen Zeitgeber,
 * der einen Neustart nicht ueberlebt.
 */
const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const CARLA = '100000000000000003';
const KANAL = '700000000000000010';

const actor = (discordId: string): { discordId: string; username: string } => ({
  discordId,
  username: `nutzer-${discordId.slice(-2)}`,
});

/** Mitte der Woche 2026-W39: Mittwoch, 23.09.2026. */
const MITTWOCH = new Date('2026-09-23T12:00:00Z');

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
      announceStart: true,
      announceVoting: true,
      announceWinner: true,
      announceApprovedClips: false,
      ...teile,
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
}

/** Ein freigegebener Clip in einer Runde. */
async function clipIn(
  competitionId: string,
  kennung: string,
  einreicher: string,
  eingereichtAm?: Date,
): Promise<string> {
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
    data: {
      competitionId,
      clipId: clip.id,
      submittedByDiscordId: einreicher,
      status: 'APPROVED',
      ...(eingereichtAm ? { submittedAt: eingereichtAm } : {}),
    },
  });
  return eintrag.id;
}

const stimme = (competitionId: string, entryId: string, waehler: string): Promise<unknown> =>
  prisma.clipVote.create({ data: { competitionId, entryId, voterDiscordId: waehler } });

describeWithDatabase('Runden entstehen und wechseln', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  it('legt die Runde der Woche an - und beim zweiten Lauf keine zweite', async () => {
    const erste = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const zweite = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);

    expect(zweite.id).toBe(erste.id);
    expect(await prisma.clipCompetition.count({ where: { guildId: GUILD } })).toBe(1);
    expect(erste.key).toBe('2026-W39');
  });

  it('legt auch bei zehn gleichzeitigen Laeufen genau eine an', async () => {
    /*
     * Zwei Bot-Instanzen, derselbe Minutentakt.
     *
     * Ohne die Eindeutigkeit auf (guildId, key) entstuenden zwei Runden
     * derselben Woche - mit zwei Einreichungslisten und zwei Gewinnern.
     */
    const runden = await Promise.all(
      Array.from({ length: 10 }, () => clips.holeOderErstelleRunde(GUILD, MITTWOCH)),
    );
    expect(new Set(runden.map((runde) => runde.id)).size).toBe(1);
    expect(await prisma.clipCompetition.count({ where: { guildId: GUILD } })).toBe(1);
  });

  it('schreibt die Regeln der Runde fest', async () => {
    await einstellungen({ votesPerMember: 5, allowSelfVote: true });
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);

    // Eine spaetere Aenderung darf die laufende Runde nicht umschreiben.
    await einstellungen({ votesPerMember: 1, allowSelfVote: false });
    const nachher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(nachher.votesPerMember).toBe(5);
    expect(nachher.allowSelfVote).toBe(true);
  });

  it('zaehlt die Rundennummer je Server hoch', async () => {
    const erste = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const zweite = await clips.holeOderErstelleRunde(GUILD, new Date('2026-09-30T12:00:00Z'));
    expect(zweite.number).toBe(erste.number + 1);
  });

  it('holt einen Ausfall nach: DRAFT → SUBMISSION → VOTING in einem Lauf', async () => {
    /*
     * Der Bot stand von Montag bis Samstag.
     *
     * Beim ersten Lauf danach ist sowohl die Eroeffnung als auch der Wechsel
     * zum Voting faellig. Ein Uebergang je Lauf hiesse: die Runde braucht
     * zwei Minuten, um aufzuholen - und drei Wechsel drei Minuten.
     */
    const runde = await clips.holeOderErstelleRunde(GUILD, new Date('2026-09-21T00:00:00Z'));
    await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'DRAFT' } });

    const ergebnis = await clips.fuehreUebergaengeAus(GUILD, new Date('2026-09-26T12:00:00Z'));
    expect(ergebnis.eroeffnet).toContain(runde.id);
    expect(ergebnis.zumVoting).toContain(runde.id);
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } })).status).toBe(
      'VOTING',
    );
  });

  it('wechselt nichts, solange die Zeit nicht um ist', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const ergebnis = await clips.fuehreUebergaengeAus(GUILD, MITTWOCH);

    expect(ergebnis.zumVoting).toHaveLength(0);
    expect(ergebnis.finalisiert).toHaveLength(0);
    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } })).status).toBe(
      'SUBMISSION',
    );
  });
});

describeWithDatabase('Runden abschliessen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  async function imVoting(): Promise<string> {
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'VOTING' } });
    return runde.id;
  }

  it('bestimmt den Gewinner nach Stimmen und schreibt alle Raenge fest', async () => {
    const competitionId = await imVoting();
    const a = await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);
    const b = await clipIn(competitionId, 'bbbbbbbbbbb', BEN);
    const c = await clipIn(competitionId, 'ccccccccccc', CARLA);

    await stimme(competitionId, b, ANNA);
    await stimme(competitionId, b, CARLA);
    await stimme(competitionId, a, BEN);

    expect(await clips.finalisiere(competitionId, { quelle: 'scheduler' })).toBe(true);

    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(runde.status).toBe('COMPLETED');
    expect(runde.winnerEntryId).toBe(b);

    const raenge = await prisma.clipCompetitionEntry.findMany({
      where: { competitionId },
      orderBy: { finalRank: 'asc' },
      select: { id: true, finalRank: true, finalVoteCount: true },
    });
    expect(raenge).toEqual([
      { id: b, finalRank: 1, finalVoteCount: 2 },
      { id: a, finalRank: 2, finalVoteCount: 1 },
      { id: c, finalRank: 3, finalVoteCount: 0 },
    ]);
  });

  it('entscheidet einen Gleichstand zugunsten der frueheren Einreichung', async () => {
    const competitionId = await imVoting();
    const frueh = await clipIn(competitionId, 'frueh111111', ANNA, new Date('2026-09-21T08:00:00Z'));
    const spaet = await clipIn(competitionId, 'spaet111111', BEN, new Date('2026-09-24T08:00:00Z'));

    await stimme(competitionId, frueh, CARLA);
    await stimme(competitionId, spaet, ANNA);

    await clips.finalisiere(competitionId, { quelle: 'scheduler' });
    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(runde.winnerEntryId).toBe(frueh);
  });

  it('kuert ohne eine einzige Stimme niemanden', async () => {
    /*
     * Eine Woche, in der niemand abgestimmt hat.
     *
     * Die frueheste Einreichung stuende trotzdem an erster Stelle der
     * Rangfolge. Sie zum «Clip of the Week» zu erklaeren und die Person
     * dafuer auf Discord zu erwaehnen, waere eine Auszeichnung, die niemand
     * vergeben hat.
     */
    const competitionId = await imVoting();
    await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);
    await clipIn(competitionId, 'bbbbbbbbbbb', BEN);

    await clips.finalisiere(competitionId, { quelle: 'scheduler' });

    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(runde.status).toBe('COMPLETED');
    expect(runde.winnerEntryId).toBeNull();
    // Die Raenge stehen trotzdem - die Runde ist abgeschlossen.
    expect(await prisma.clipCompetitionEntry.count({ where: { competitionId, finalRank: 1 } })).toBe(1);
  });

  it('schliesst nur einmal ab, auch bei fuenf gleichzeitigen Versuchen', async () => {
    const competitionId = await imVoting();
    const a = await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);
    await stimme(competitionId, a, BEN);

    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, () => clips.finalisiere(competitionId, { quelle: 'scheduler' })),
    );
    expect(ergebnisse.filter(Boolean)).toHaveLength(1);
  });

  it('beruehrt eine abgeschlossene Runde nicht mehr', async () => {
    const competitionId = await imVoting();
    const a = await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);
    await stimme(competitionId, a, BEN);
    await clips.finalisiere(competitionId, { quelle: 'scheduler' });

    const vorher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(await clips.finalisiere(competitionId, { quelle: 'manuell' })).toBe(false);
    const nachher = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(nachher.finalizedAt?.getTime()).toBe(vorher.finalizedAt?.getTime());
  });

  it('laesst eine abgebrochene Runde ohne Ergebnis', async () => {
    const competitionId = await imVoting();
    await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);

    expect(await clips.brichAb(competitionId, actor(ANNA), 'Testlauf')).toBe(true);
    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    expect(runde.status).toBe('CANCELLED');
    expect(runde.winnerEntryId).toBeNull();
    // Ein zweiter Abbruch findet nichts mehr.
    expect(await clips.brichAb(competitionId, actor(ANNA))).toBe(false);
  });

  it('nimmt entfernte Eintraege nicht in die Wertung', async () => {
    const competitionId = await imVoting();
    const drin = await clipIn(competitionId, 'aaaaaaaaaaa', ANNA);
    const raus = await clipIn(competitionId, 'bbbbbbbbbbb', BEN);

    await stimme(competitionId, raus, CARLA);
    await stimme(competitionId, raus, ANNA);
    await stimme(competitionId, drin, BEN);
    await clips.nimmAusRunde(raus, actor(CARLA), 'Regelverstoss');

    await clips.finalisiere(competitionId, { quelle: 'scheduler' });
    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });
    // Der entfernte Clip hatte mehr Stimmen - und gewinnt trotzdem nicht.
    expect(runde.winnerEntryId).toBe(drin);
  });
});

describeWithDatabase('Ankuendigungen gehen genau einmal heraus', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen({ announcementChannelId: KANAL });
  });

  /** Ein Gateway, das nur mitschreibt, was gesendet wurde. */
  function gateway(): { send: ReturnType<typeof vi.fn>; modul: Parameters<typeof clips.runClipsTick>[2] } {
    const send = vi.fn(async () => ({ id: `msg-${send.mock.calls.length}`, channelId: KANAL }));
    return { send, modul: { channels: { send } } as unknown as Parameters<typeof clips.runClipsTick>[2] };
  }

  it('kuendigt den Start an - und bei zehn weiteren Laeufen kein zweites Mal', async () => {
    const { send, modul } = gateway();

    for (let lauf = 0; lauf < 10; lauf += 1) {
      await clips.runClipsTick(GUILD, MITTWOCH, modul);
    }

    expect(send).toHaveBeenCalledTimes(1);
    const runde = await prisma.clipCompetition.findFirstOrThrow({ where: { guildId: GUILD } });
    expect(runde.startMessageId).toBe('msg-1');
    expect(runde.startChannelId).toBe(KANAL);
    expect(runde.startPostedAt).not.toBeNull();
  });

  it('versucht es erneut, wenn Discord nicht erreichbar war', async () => {
    /*
     * Der Platzhalter muss wieder weichen.
     *
     * Die Kennung der Nachricht ist das Gedaechtnis. Bliebe nach einem
     * gescheiterten Versuch ein Platzhalter stehen, waere die Runde fuer
     * immer als «angekuendigt» vermerkt - und die Ankuendigung kaeme nie.
     */
    const send = vi
      .fn<() => Promise<{ id: string; channelId: string }>>()
      .mockRejectedValueOnce(new Error('Discord antwortet nicht'))
      .mockResolvedValue({ id: 'msg-spaeter', channelId: KANAL });
    const modul = { channels: { send } } as unknown as Parameters<typeof clips.runClipsTick>[2];

    await clips.runClipsTick(GUILD, MITTWOCH, modul);
    expect(await prisma.clipCompetition.findFirstOrThrow({ where: { guildId: GUILD } })).toMatchObject({
      startMessageId: null,
    });

    await clips.runClipsTick(GUILD, MITTWOCH, modul);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.clipCompetition.findFirstOrThrow({ where: { guildId: GUILD } })).toMatchObject({
      startMessageId: 'msg-spaeter',
    });
  });

  it('schweigt, wenn kein Kanal eingetragen ist', async () => {
    await einstellungen({ announcementChannelId: null });
    const { send, modul } = gateway();

    await clips.runClipsTick(GUILD, MITTWOCH, modul);
    expect(send).not.toHaveBeenCalled();
    // Die Runde entsteht trotzdem - die Ankuendigung ist die Nebensache.
    expect(await prisma.clipCompetition.count({ where: { guildId: GUILD } })).toBe(1);
  });

  it('schweigt, wenn die Ankuendigung abgeschaltet ist', async () => {
    await einstellungen({ announcementChannelId: KANAL, announceStart: false });
    const { send, modul } = gateway();

    await clips.runClipsTick(GUILD, MITTWOCH, modul);
    expect(send).not.toHaveBeenCalled();
  });

  it('kuendigt kein Voting ohne einen einzigen freigegebenen Clip an', async () => {
    const { send, modul } = gateway();
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    await prisma.clipCompetition.update({
      where: { id: runde.id },
      data: { status: 'SUBMISSION', startMessageId: 'msg-start' },
    });

    await clips.runClipsTick(GUILD, new Date('2026-09-25T18:01:00Z'), modul);

    expect((await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } })).status).toBe(
      'VOTING',
    );
    // «0 Clips im Rennen» ist keine Einladung, sondern eine Verlegenheit.
    expect(send).not.toHaveBeenCalled();
  });

  it('kuendigt den Gewinner an - genau einmal', async () => {
    const { send, modul } = gateway();
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    await prisma.clipCompetition.update({
      where: { id: runde.id },
      data: { status: 'VOTING', startMessageId: 'msg-start', votingMessageId: 'msg-voting' },
    });
    const a = await clipIn(runde.id, 'aaaaaaaaaaa', ANNA);
    await stimme(runde.id, a, BEN);

    const nachEnde = new Date('2026-09-27T18:01:00Z');
    await clips.runClipsTick(GUILD, nachEnde, modul);
    await clips.runClipsTick(GUILD, nachEnde, modul);
    await clips.runClipsTick(GUILD, nachEnde, modul);

    expect(send).toHaveBeenCalledTimes(1);
    const inhalt = send.mock.calls[0]?.[1] as { content?: string; allowedMentions?: unknown };
    expect(inhalt.content).toContain(`<@${ANNA}>`);
    // Genau eine Erwaehnung - kein @everyone, keine Rolle.
    expect(inhalt.allowedMentions).toEqual({ parse: [], users: [ANNA] });
  });

  it('laedt nicht mehr zum Einreichen ein, wenn die Frist abgelaufen ist', async () => {
    /*
     * Eine Einladung gilt, solange man ihr folgen kann - keine Minute laenger.
     *
     * Der Lauf nach Ablauf schiebt die Runde ins Voting und kuendigt genau
     * das an; die versaeumte Einladung zum Einreichen wird nicht nachgereicht.
     */
    const { send, modul } = gateway();
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    await clipIn(runde.id, 'aaaaaaaaaaa', ANNA);

    await clips.runClipsTick(GUILD, new Date('2026-09-26T12:00:00Z'), modul);

    expect(send).toHaveBeenCalledTimes(1);
    const gesendet = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(gesendet.startMessageId).toBeNull();
    expect(gesendet.votingMessageId).not.toBeNull();
  });

  it('holt einen Gewinner nicht nach, der Wochen zurueckliegt', async () => {
    /*
     * Das Modul wird spaeter eingeschaltet - oder der Kanal erst spaeter
     * eingetragen. Ohne Frist kaemen alle verpassten Gewinner auf einmal.
     */
    const { send, modul } = gateway();
    const runde = await clips.holeOderErstelleRunde(GUILD, MITTWOCH);
    const a = await clipIn(runde.id, 'aaaaaaaaaaa', ANNA);
    await stimme(runde.id, a, BEN);
    await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'VOTING' } });
    await clips.finalisiere(runde.id, { quelle: 'scheduler' });
    // Der Abschluss liegt drei Wochen zurueck.
    await prisma.clipCompetition.update({
      where: { id: runde.id },
      data: { finalizedAt: new Date('2026-09-27T18:00:00Z') },
    });

    await clips.runClipsTick(GUILD, new Date('2026-10-18T12:00:00Z'), modul);

    const winner = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(winner.winnerMessageId).toBeNull();
    // Die Runde der neuen Woche entsteht - nur eine Ankuendigung zu ihr.
    expect(send.mock.calls.every((aufruf) => !JSON.stringify(aufruf[1]).includes('🏆'))).toBe(true);
  });
});
