import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_statusabzeichen');

/**
 * Was Clips und SwissHub fragt tatsaechlich melden.
 *
 * ## Warum das nicht die Registry prueft
 *
 * Die Registry hat ihren eigenen Test (`tests/unit/modul-statusabzeichen.test.ts`):
 * dass ein gemeldeter Zustand ankommt, dass `null` kein Abzeichen ergibt, dass
 * ein Fehler die anderen nicht mitnimmt.
 *
 * Hier geht es um die Antworten selbst - und zwar genau deshalb, weil der Weg
 * darueber jeden Fehler verschluckt. Eine Abfrage, die wirft, ergibt «kein
 * Abzeichen», und das sieht aus wie «gerade laeuft nichts». Ein kaputter
 * Zustandsgeber waere also unsichtbar. Dieser Test ist die Stelle, an der er
 * auffaellt.
 */
const { prisma } = await import('@swisshub/database');
const { clips, fragt, getModuleStatusBadge, setModuleEnabled } = await import('@swisshub/modules');

/** Dieselbe Kennung, die `resolveGuildId` aus der Testumgebung liefert. */
const GUILD = process.env.DISCORD_GUILD_ID ?? '100000000000000002';

describeWithDatabase('Statusabzeichen: Clip of the Week', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipVote.deleteMany({});
    await prisma.clipCompetitionEntry.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.clip.deleteMany({});
    await setModuleEnabled(clips.CLIPS_MODULE_ID, true, 'test');
  });

  it('meldet nichts, solange keine Runde laeuft', async () => {
    expect(await getModuleStatusBadge(clips.CLIPS_MODULE_ID)).toBeNull();
  });

  it('meldet «Einreichung», solange Clips geschickt werden duerfen', async () => {
    await clips.holeOderErstelleRunde(GUILD, new Date('2026-03-02T10:00:00Z'));

    const abzeichen = await getModuleStatusBadge(clips.CLIPS_MODULE_ID);
    expect(abzeichen?.label).toBe('Einreichung');
    expect(abzeichen?.variant).toBe('akzent');
  });

  it('meldet «Voting» und lauter, sobald abgestimmt wird', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, new Date('2026-03-02T10:00:00Z'));
    await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'VOTING' } });

    const abzeichen = await getModuleStatusBadge(clips.CLIPS_MODULE_ID);
    expect(abzeichen?.label).toBe('Voting');
    // Lauter als die Einreichung: eine Abstimmung laesst sich nicht nachholen.
    expect(abzeichen?.variant).toBe('dringend');
    expect(abzeichen?.priority).toBeGreaterThan(10);
  });

  it.each(['DRAFT', 'FINALIZING', 'COMPLETED', 'CANCELLED'] as const)(
    'meldet nichts bei %s - da ist nichts zu tun',
    async (status) => {
      const runde = await clips.holeOderErstelleRunde(GUILD, new Date('2026-03-02T10:00:00Z'));
      await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status } });

      expect(await getModuleStatusBadge(clips.CLIPS_MODULE_ID)).toBeNull();
    },
  );
});

describeWithDatabase('Statusabzeichen: SwissHub fragt', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.fragtStimme.deleteMany({});
    await prisma.fragtAbstimmung.deleteMany({});
    await prisma.fragtFrage.deleteMany({});
    await setModuleEnabled(fragt.FRAGT_MODULE_ID, true, 'test');
  });

  async function frageMitAbstimmung(status: 'ACTIVE' | 'CLOSED'): Promise<void> {
    const frage = await prisma.fragtFrage.create({
      data: {
        guildId: GUILD,
        text: 'Controller oder Maus?',
        typ: 'ENTWEDER_ODER',
        kategorie: 'gaming',
        status: 'ACTIVE',
      },
    });
    await prisma.fragtAbstimmung.create({
      data: {
        guildId: GUILD,
        frageId: frage.id,
        status,
        frageText: frage.text,
        typ: frage.typ,
        channelId: '200000000000000001',
        opensAt: new Date('2026-03-02T10:00:00Z'),
        closesAt: new Date('2026-03-03T10:00:00Z'),
        ...(status === 'CLOSED' ? { closedAt: new Date('2026-03-03T10:00:00Z') } : {}),
      },
    });
  }

  it('meldet nichts, solange keine Frage draussen ist', async () => {
    expect(await getModuleStatusBadge(fragt.FRAGT_MODULE_ID)).toBeNull();
  });

  it('meldet «Frage offen», solange abgestimmt wird', async () => {
    await frageMitAbstimmung('ACTIVE');

    const abzeichen = await getModuleStatusBadge(fragt.FRAGT_MODULE_ID);
    expect(abzeichen?.label).toBe('Frage offen');
    expect(abzeichen?.variant).toBe('akzent');
  });

  it('meldet nichts mehr, wenn die Abstimmung geschlossen ist', async () => {
    await frageMitAbstimmung('CLOSED');

    expect(await getModuleStatusBadge(fragt.FRAGT_MODULE_ID)).toBeNull();
  });
});
