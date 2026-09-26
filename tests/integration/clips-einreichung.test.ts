import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_einreichung');

/**
 * Einreichen und moderieren.
 *
 * Geprueft wird das, was ein Wettbewerb aushalten muss, wenn jemand ihn
 * gewinnen will: derselbe Clip mehrfach, mehr Clips als erlaubt, eine
 * Einreichung nach Ablauf - und die Frage, ob eine abgelehnte Einreichung
 * spurlos verschwindet oder der Person erklaert wird.
 */
const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const MOD = '100000000000000009';

const actor = (discordId: string): { discordId: string; username: string } => ({
  discordId,
  username: `nutzer-${discordId.slice(-2)}`,
});

const JETZT = new Date('2026-09-23T12:00:00Z');

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

/** Eine offene Runde fuer die Woche um `JETZT`. */
async function offeneRunde(): Promise<string> {
  const runde = await clips.holeOderErstelleRunde(GUILD, JETZT);
  await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'SUBMISSION' } });
  return runde.id;
}

const CLIP_A = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CLIP_B = 'https://clips.twitch.tv/SpicyCloudyTortoise';

describeWithDatabase('Clips einreichen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipVote.deleteMany({});
    await prisma.clipReport.deleteMany({});
    await prisma.clipCompetitionEntry.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.clip.deleteMany({});
    await einstellungen();
  });

  it('nimmt einen Clip an und stellt ihn auf «wartet»', async () => {
    await offeneRunde();
    const ergebnis = await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Mein Ace' }, JETZT);

    const clip = await prisma.clip.findUnique({ where: { id: ergebnis.clipId } });
    expect(clip?.status).toBe('PENDING');
    expect(clip?.provider).toBe('youtube');
    expect(clip?.externalId).toBe('dQw4w9WgXcQ');
    // Die Einbettungsadresse entsteht aus der Kennung, nicht aus der Eingabe.
    expect(clip?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('haelt das Einreichungslimit ein', async () => {
    await offeneRunde();
    await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Erster' }, JETZT);

    await expect(
      clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_B, titel: 'Zweiter' }, JETZT),
    ).rejects.toThrow(/bereits einen Clip/u);
    expect(await prisma.clipCompetitionEntry.count({ where: { submittedByDiscordId: ANNA } })).toBe(1);
  });

  it('laesst mehr zu, wenn die Runde es vorsieht', async () => {
    await einstellungen({ submissionsPerMember: 2 });
    await offeneRunde();

    await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Erster' }, JETZT);
    await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_B, titel: 'Zweiter' }, JETZT);
    expect(await prisma.clipCompetitionEntry.count({ where: { submittedByDiscordId: ANNA } })).toBe(2);
  });

  it('erkennt denselben Clip unter einer anderen Adresse', async () => {
    /*
     * Der naheliegende Weg, das Limit zu umgehen: dieselbe Aufnahme ein
     * zweites Mal ueber die Kurzadresse. `erkenneClip()` zieht beide auf
     * dieselbe Kennung zusammen, und die Eindeutigkeit auf
     * (guildId, provider, externalId) macht daraus einen Clip.
     */
    await einstellungen({ submissionsPerMember: 3 });
    await offeneRunde();

    await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Erster' }, JETZT);
    await expect(
      clips.reicheEin(GUILD, actor(ANNA), { url: 'https://youtu.be/dQw4w9WgXcQ', titel: 'Nochmal' }, JETZT),
    ).rejects.toThrow(/bereits eingereicht/u);

    expect(await prisma.clip.count({})).toBe(1);
  });

  it('lehnt auch die Einreichung desselben Clips durch eine andere Person ab', async () => {
    await offeneRunde();
    await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Erster' }, JETZT);

    await expect(
      clips.reicheEin(GUILD, actor(BEN), { url: CLIP_A, titel: 'Auch schön' }, JETZT),
    ).rejects.toThrow(/bereits eingereicht/u);
  });

  it('lehnt eine Adresse ab, die kein Clip ist', async () => {
    await offeneRunde();
    await expect(
      clips.reicheEin(GUILD, actor(ANNA), { url: 'https://angreifer.example/clip', titel: 'Test' }, JETZT),
    ).rejects.toThrow(/Twitch, YouTube und Medal/u);
    expect(await prisma.clip.count({})).toBe(0);
  });

  it('lehnt sie nach Ablauf ab - auch wenn der Status noch SUBMISSION sagt', async () => {
    const competitionId = await offeneRunde();
    const runde = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: competitionId } });

    await expect(
      clips.reicheEin(
        GUILD,
        actor(ANNA),
        { url: CLIP_A, titel: 'Zu spät' },
        new Date(runde.submissionEndsAt.getTime() + 1000),
      ),
    ).rejects.toThrow(/geschlossen/u);
  });

  it('lehnt sie waehrend des Votings ab', async () => {
    const competitionId = await offeneRunde();
    await prisma.clipCompetition.update({ where: { id: competitionId }, data: { status: 'VOTING' } });

    await expect(
      clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Zu spät' }, JETZT),
    ).rejects.toThrow(/bereits abgestimmt/u);
  });

  it('verlangt einen Titel', async () => {
    await offeneRunde();
    await expect(clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: '  a ' }, JETZT)).rejects.toThrow(
      /Titel/u,
    );
  });
});

describeWithDatabase('Clips moderieren', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipVote.deleteMany({});
    await prisma.clipReport.deleteMany({});
    await prisma.clipCompetitionEntry.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.clip.deleteMany({});
    await einstellungen();
  });

  async function eingereicht(): Promise<{ clipId: string; entryId: string }> {
    await offeneRunde();
    return clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Mein Ace' }, JETZT);
  }

  it('gibt frei und stellt Eintrag wie Clip auf APPROVED', async () => {
    const { clipId, entryId } = await eingereicht();
    await clips.gibFrei(entryId, actor(MOD));

    expect((await prisma.clipCompetitionEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe(
      'APPROVED',
    );
    expect((await prisma.clip.findUniqueOrThrow({ where: { id: clipId } })).status).toBe('APPROVED');
  });

  it('ist beim zweiten Freigeben still statt laut', async () => {
    const { entryId } = await eingereicht();
    await clips.gibFrei(entryId, actor(MOD));
    // Zwei Moderatoren, ein Clip: der zweite Klick darf keinen Fehler zeigen.
    await expect(clips.gibFrei(entryId, actor(MOD))).resolves.toBeUndefined();
  });

  it('haelt den Ablehnungsgrund fest - die Person soll ihn sehen', async () => {
    const { clipId, entryId } = await eingereicht();
    await clips.lehneAb(entryId, actor(MOD), 'NO_GAMING', 'Bitte etwas mit Gaming-Bezug.');

    const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
    expect(clip.status).toBe('REJECTED');
    expect(clip.rejectionReason).toBe('NO_GAMING');
    expect(clip.rejectionNote).toBe('Bitte etwas mit Gaming-Bezug.');

    const eigene = await clips.eigeneEinreichungen(
      (await prisma.clipCompetitionEntry.findUniqueOrThrow({ where: { id: entryId } })).competitionId,
      ANNA,
    );
    expect(eigene[0]).toMatchObject({ status: 'REJECTED', notiz: 'Bitte etwas mit Gaming-Bezug.' });
  });

  it('verlangt bei «Sonstiges» eine Begruendung', async () => {
    const { entryId } = await eingereicht();
    await expect(clips.lehneAb(entryId, actor(MOD), 'OTHER')).rejects.toThrow(/begründen/u);
  });

  it('lehnt einen erfundenen Ablehnungsgrund ab', async () => {
    const { entryId } = await eingereicht();
    await expect(
      // Ein Grund, den die Oberflaeche nie anbietet - aber ein Aufruf, der
      // sie umgeht, koennte ihn schicken.
      clips.lehneAb(entryId, actor(MOD), 'ERFUNDEN' as 'OTHER', 'Text'),
    ).rejects.toThrow(/Grund/u);
  });

  it('laesst eine erneute Einreichung nach Ablehnung wieder auf «wartet»', async () => {
    /*
     * Eine Ablehnung ist kein Bann fuer den Clip.
     *
     * Wer den Titel korrigiert oder den falschen Ausschnitt ersetzt, soll es
     * erneut versuchen koennen - die Moderation entscheidet dann neu, statt
     * dass die alte Ablehnung fuer immer klebt.
     */
    const { clipId, entryId } = await eingereicht();
    await clips.lehneAb(entryId, actor(MOD), 'BROKEN');

    const erneut = await clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Neuer Anlauf' }, JETZT);
    expect(erneut.clipId).toBe(clipId);

    const clip = await prisma.clip.findUniqueOrThrow({ where: { id: clipId } });
    expect(clip.status).toBe('PENDING');
    expect(clip.rejectionReason).toBeNull();
  });

  it('laesst einen aus der Runde genommenen Clip nicht zurueckkehren', async () => {
    /*
     * Die Gegenprobe zum vorigen Fall.
     *
     * Eine Ablehnung heisst «so nicht» - ein Entfernen heisst «nicht in
     * dieser Runde». Waere auch das durch erneutes Einreichen aufhebbar,
     * koennte man jede Entscheidung der Moderation mit einem Klick umkehren.
     */
    const { entryId } = await eingereicht();
    await clips.gibFrei(entryId, actor(MOD));
    await clips.nimmAusRunde(entryId, actor(MOD), 'Regelverstoss');

    await expect(
      clips.reicheEin(GUILD, actor(ANNA), { url: CLIP_A, titel: 'Nochmal' }, JETZT),
    ).rejects.toThrow(/aus der laufenden Runde genommen/u);
    expect((await prisma.clipCompetitionEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe(
      'REMOVED',
    );
  });

  it('nimmt einen Clip aus der Runde, ohne ihn zu loeschen', async () => {
    const { clipId, entryId } = await eingereicht();
    await clips.gibFrei(entryId, actor(MOD));
    await clips.nimmAusRunde(entryId, actor(MOD), 'Doppelt eingereicht');

    expect((await prisma.clipCompetitionEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe(
      'REMOVED',
    );
    // Der Clip selbst bleibt - er ist eine Sache fuer sich.
    expect(await prisma.clip.findUnique({ where: { id: clipId } })).not.toBeNull();
  });

  it('stellt einen freigegebenen Clip nur vor, wenn das eingeschaltet ist', async () => {
    /*
     * Die Einstellung heisst «jeden freigegebenen Clip einzeln posten» und
     * steht standardmaessig aus. Eine Einstellung, die nichts tut, ist
     * schlimmer als keine - deshalb steht hier beides: aus schweigt, ein
     * sendet.
     */
    const send = vi.fn<
      (kanalId: string, inhalt: { allowedMentions?: unknown }) => Promise<{ id: string; channelId: string }>
    >(async () => ({ id: 'msg-1', channelId: '700000000000000010' }));
    const modul = { channels: { send } } as unknown as Parameters<typeof clips.gibFrei>[2];

    const aus = await eingereicht();
    await clips.gibFrei(aus.entryId, actor(MOD), modul);
    expect(send).not.toHaveBeenCalled();

    await einstellungen({ announcementChannelId: '700000000000000010', announceApprovedClips: true });
    const an = await clips.reicheEin(GUILD, actor(BEN), { url: CLIP_B, titel: 'Zweiter Clip' }, JETZT);
    await clips.gibFrei(an.entryId, actor(MOD), modul);

    expect(send).toHaveBeenCalledTimes(1);
    const inhalt = send.mock.calls[0]?.[1];
    // Dreissig Clips duerfen nicht dreissig Erwaehnungen bedeuten.
    expect(inhalt?.allowedMentions).toEqual({ parse: [] });

    // Ein zweiter Klick auf «Freigeben» postet nicht noch einmal.
    await clips.gibFrei(an.entryId, actor(MOD), modul);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('zaehlt jede Person nur einmal als Meldung', async () => {
    const { clipId } = await eingereicht();
    await clips.melde(clipId, actor(BEN), 'INAPPROPRIATE');
    await clips.melde(clipId, actor(BEN), 'HARASSMENT');
    await clips.melde(clipId, actor(ANNA), 'RIGHTS');

    expect(await prisma.clipReport.count({ where: { clipId } })).toBe(2);
  });

  it('schliesst Meldungen ab, ohne sie zu loeschen', async () => {
    const { clipId } = await eingereicht();
    await clips.melde(clipId, actor(BEN), 'INAPPROPRIATE');

    expect(await clips.erledigeMeldungen(clipId, actor(MOD))).toBe(1);
    const meldung = await prisma.clipReport.findFirstOrThrow({ where: { clipId } });
    expect(meldung.resolvedAt).not.toBeNull();
    expect(meldung.resolvedByDiscordId).toBe(MOD);
    // Ein zweiter Durchgang findet nichts mehr offen.
    expect(await clips.erledigeMeldungen(clipId, actor(MOD))).toBe(0);
  });
});
