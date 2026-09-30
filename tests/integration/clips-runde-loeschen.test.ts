import { mkdtempSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_loeschen');

/**
 * Eine vergangene Runde loeschen - und die mildere Variante daneben.
 *
 * ## Warum das eine echte Datenbank braucht
 *
 * Weil die Loeschung nichts nachbaut, was die Datenbank ohnehin tut. Die
 * Einreichungen, Stimmen und die Belohnung haengen mit `onDelete: Cascade` an
 * der Runde; dass danach wirklich nichts uebrig ist, zeigt keine Attrappe,
 * sondern nur Postgres. Dasselbe gilt fuer `winnerEntryId`: ein Verweis auf
 * eine Zeile, die im selben Zug faellt, ist genau die Art Detail, die in
 * einem nachgebauten Client funktioniert und in der Datenbank nicht.
 *
 * ## Und warum mit einem echten Upload-Verzeichnis
 *
 * Weil die eigentliche Regel nicht «loesche die Datei» heisst, sondern «nur
 * unreferenzierte Medien physisch entfernen». Ob sie eingehalten wird, sieht
 * man an zwei Dateien nebeneinander: eine verschwindet, die andere bleibt
 * liegen, weil ihr Clip noch in einer zweiten Runde antritt.
 */
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'swisshub-loeschen-'));
process.env.SWISSHUB_UPLOAD_DIR = UPLOAD_DIR;

const { prisma } = await import('@swisshub/database');
const { clips, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const MOD = { discordId: '100000000000000009', username: 'nina.mod' };

/** Mittwoch in 2026-W39. */
const WOCHE_39 = new Date('2026-09-23T12:00:00Z');
/** Mittwoch in 2026-W40. */
const WOCHE_40 = new Date('2026-09-30T12:00:00Z');

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

async function leeren(): Promise<void> {
  await prisma.clipVote.deleteMany({});
  await prisma.clipReport.deleteMany({});
  await prisma.clipCompetitionReward.deleteMany({});
  await prisma.clipCompetitionEntry.deleteMany({});
  await prisma.clipCompetition.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

/** Ein MP4-Kopf mit echter `ftyp`-Signatur. */
function mp4(): Uint8Array {
  const datei = new Uint8Array(2048);
  datei.set([0x00, 0x00, 0x00, 0x18], 0);
  datei.set(
    [...'ftyp'].map((zeichen) => zeichen.charCodeAt(0)),
    4,
  );
  datei.set(
    [...'isom'].map((zeichen) => zeichen.charCodeAt(0)),
    8,
  );
  return datei;
}

const liegtDa = async (dateiname: string): Promise<boolean> => {
  try {
    await access(join(UPLOAD_DIR, dateiname));
    return true;
  } catch {
    return false;
  }
};

/** Ein freigegebener Clip mit Teilnahme an einer Runde. */
async function clipIn(
  competitionId: string,
  kennung: string,
  einreicher: string,
): Promise<{ clipId: string; entryId: string }> {
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
      status: 'APPROVED',
    },
  });
  const eintrag = await prisma.clipCompetitionEntry.create({
    data: { competitionId, clipId: clip.id, submittedByDiscordId: einreicher, status: 'APPROVED' },
  });
  return { clipId: clip.id, entryId: eintrag.id };
}

/** Eine abgeschlossene Runde mit zwei Clips, Stimmen und Gewinner. */
async function entschiedeneRunde(jetzt = WOCHE_39): Promise<{
  id: string;
  key: string;
  gewinnerEintrag: string;
  clips: string[];
}> {
  const runde = await clips.holeOderErstelleRunde(GUILD, jetzt);
  const a = await clipIn(runde.id, `a-${runde.key}`, ANNA);
  const b = await clipIn(runde.id, `b-${runde.key}`, BEN);

  await prisma.clipVote.createMany({
    data: [
      { competitionId: runde.id, entryId: a.entryId, voterDiscordId: BEN },
      { competitionId: runde.id, entryId: a.entryId, voterDiscordId: MOD.discordId },
      { competitionId: runde.id, entryId: b.entryId, voterDiscordId: ANNA },
    ],
  });
  await prisma.clipCompetition.update({
    where: { id: runde.id },
    data: { status: 'COMPLETED', finalizedAt: jetzt, winnerEntryId: a.entryId },
  });
  await prisma.clipCompetitionEntry.update({
    where: { id: a.entryId },
    data: { finalRank: 1, finalVoteCount: 2 },
  });
  await prisma.clipCompetitionEntry.update({
    where: { id: b.entryId },
    data: { finalRank: 2, finalVoteCount: 1 },
  });

  return { id: runde.id, key: runde.key, gewinnerEintrag: a.entryId, clips: [a.clipId, b.clipId] };
}

describeWithDatabase('Vergangene Clip-Runden löschen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  it('nimmt Einreichungen, Stimmen und Belohnung mit - und lässt nichts Verwaistes zurück', async () => {
    const runde = await entschiedeneRunde();
    await prisma.clipCompetitionReward.create({
      data: { competitionId: runde.id, winnerDiscordId: ANNA, kind: 'XP', xpAmount: 500 },
    });

    const ergebnis = await clips.loescheRunde(runde.id, runde.key, MOD, 'Testrunde');

    expect(ergebnis.einreichungen).toBe(2);
    expect(ergebnis.stimmen).toBe(3);
    expect(await prisma.clipCompetition.count()).toBe(0);
    expect(await prisma.clipCompetitionEntry.count()).toBe(0);
    expect(await prisma.clipVote.count()).toBe(0);
    expect(await prisma.clipCompetitionReward.count()).toBe(0);
  });

  it('löscht Clips, die danach in keiner Runde mehr vorkommen', async () => {
    const runde = await entschiedeneRunde();

    const ergebnis = await clips.loescheRunde(runde.id, runde.key, MOD);

    expect(ergebnis.clipsGeloescht).toBe(2);
    expect(await prisma.clip.count()).toBe(0);
  });

  it('lässt einen Clip stehen, der in einer zweiten Runde antritt', async () => {
    const erste = await clips.holeOderErstelleRunde(GUILD, WOCHE_39);
    const zweite = await clips.holeOderErstelleRunde(GUILD, WOCHE_40);
    const geteilt = await clipIn(erste.id, 'geteilt', ANNA);
    await prisma.clipCompetitionEntry.create({
      data: { competitionId: zweite.id, clipId: geteilt.clipId, submittedByDiscordId: ANNA },
    });
    await prisma.clipCompetition.update({ where: { id: erste.id }, data: { status: 'COMPLETED' } });

    const ergebnis = await clips.loescheRunde(erste.id, erste.key, MOD);

    expect(ergebnis.clipsGeloescht).toBe(0);
    expect(await prisma.clip.findUnique({ where: { id: geteilt.clipId } })).not.toBeNull();
  });

  it('entfernt die Datei eines Uploads nur, wenn nichts mehr auf sie zeigt', async () => {
    const einsam = await clips.speichereVideo(mp4(), 'video/mp4', 100 * 1024 * 1024);
    const geteilt = await clips.speichereVideo(mp4(), 'video/mp4', 100 * 1024 * 1024);

    const erste = await clips.holeOderErstelleRunde(GUILD, WOCHE_39);
    const zweite = await clips.holeOderErstelleRunde(GUILD, WOCHE_40);

    for (const [datei, auchInZweiter] of [
      [einsam.dateiname, false],
      [geteilt.dateiname, true],
    ] as const) {
      const clip = await prisma.clip.create({
        data: {
          guildId: GUILD,
          submittedByDiscordId: ANNA,
          sourceType: 'UPLOAD',
          provider: 'upload',
          externalId: datei,
          canonicalUrl: `/api/clips/datei/${datei}`,
          embedUrl: `/api/clips/datei/${datei}`,
          title: datei,
          status: 'APPROVED',
        },
      });
      await prisma.clipCompetitionEntry.create({
        data: { competitionId: erste.id, clipId: clip.id, submittedByDiscordId: ANNA, status: 'APPROVED' },
      });
      if (auchInZweiter) {
        await prisma.clipCompetitionEntry.create({
          data: { competitionId: zweite.id, clipId: clip.id, submittedByDiscordId: ANNA },
        });
      }
    }
    await prisma.clipCompetition.update({ where: { id: erste.id }, data: { status: 'COMPLETED' } });

    expect(await liegtDa(einsam.dateiname)).toBe(true);
    expect(await liegtDa(geteilt.dateiname)).toBe(true);

    const ergebnis = await clips.loescheRunde(erste.id, erste.key, MOD);

    expect(ergebnis.dateienGeloescht).toBe(1);
    expect(await liegtDa(einsam.dateiname)).toBe(false);
    // Der Clip lebt in Runde 40 weiter - seine Datei gehoert ihm noch.
    expect(await liegtDa(geteilt.dateiname)).toBe(true);
  });

  it('weist eine laufende Runde ab', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, WOCHE_39);
    await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'VOTING' } });

    await expect(clips.loescheRunde(runde.id, runde.key, MOD)).rejects.toThrow();
    expect(await prisma.clipCompetition.count()).toBe(1);
  });

  it('weist eine falsche Bestätigung ab, ohne etwas anzufassen', async () => {
    const runde = await entschiedeneRunde();

    await expect(clips.loescheRunde(runde.id, '2026-W01', MOD)).rejects.toThrow();

    expect(await prisma.clipCompetition.count()).toBe(1);
    expect(await prisma.clipCompetitionEntry.count()).toBe(2);
    expect(await prisma.clipVote.count()).toBe(3);
  });

  it('schreibt genau einen Protokolleintrag mit den Zahlen der Runde', async () => {
    const runde = await entschiedeneRunde();

    await clips.loescheRunde(runde.id, runde.key, MOD, 'Rechteproblem');

    const eintraege = await prisma.auditLog.findMany({ where: { action: 'CLIP_COMPETITION_DELETED' } });
    expect(eintraege).toHaveLength(1);
    const metadaten = eintraege[0]!.metadata as Record<string, unknown>;
    expect(metadaten.key).toBe(runde.key);
    expect(metadaten.einreichungen).toBe(2);
    expect(metadaten.stimmen).toBe(3);
    expect(metadaten.grund).toBe('Rechteproblem');
  });
});

describeWithDatabase('Hall-of-Fame-Einträge ausblenden', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  it('nimmt die Runde aus Liste und Zählung, lässt aber Stimmen und Ränge stehen', async () => {
    const runde = await entschiedeneRunde();
    expect(await clips.hallOfFameAnzahl(GUILD)).toBe(1);

    expect(await clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD, 'Nicht mehr tragbar')).toBe(true);

    expect(await clips.hallOfFameAnzahl(GUILD)).toBe(0);
    expect(await clips.hallOfFame(GUILD)).toEqual([]);
    // Die Runde selbst und alles daran ist unveraendert.
    expect(await prisma.clipCompetitionEntry.count()).toBe(2);
    expect(await prisma.clipVote.count()).toBe(3);
    const gespeichert = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(gespeichert.status).toBe('COMPLETED');
    expect(gespeichert.winnerEntryId).toBe(runde.gewinnerEintrag);
    expect(gespeichert.hallOfFameHiddenByDiscordId).toBe(MOD.discordId);
    expect(gespeichert.hallOfFameHiddenReason).toBe('Nicht mehr tragbar');
  });

  it('ändert die Bilanz eines Mitglieds nicht', async () => {
    const runde = await entschiedeneRunde();
    const vorher = await clips.bilanz(GUILD, ANNA);

    await clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD);

    expect(await clips.bilanz(GUILD, ANNA)).toEqual(vorher);
    expect(vorher.siege).toBe(1);
  });

  it('holt die Runde zurück und räumt den Vermerk ab', async () => {
    const runde = await entschiedeneRunde();
    await clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD, 'Irrtum');

    expect(await clips.setzeHallOfFameSichtbarkeit(runde.id, false, MOD)).toBe(true);

    expect(await clips.hallOfFameAnzahl(GUILD)).toBe(1);
    const gespeichert = await prisma.clipCompetition.findUniqueOrThrow({ where: { id: runde.id } });
    expect(gespeichert.hallOfFameHiddenAt).toBeNull();
    expect(gespeichert.hallOfFameHiddenByDiscordId).toBeNull();
    expect(gespeichert.hallOfFameHiddenReason).toBeNull();
  });

  it('meldet den zweiten gleichlautenden Aufruf als wirkungslos', async () => {
    const runde = await entschiedeneRunde();

    expect(await clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD)).toBe(true);
    expect(await clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD)).toBe(false);

    // Und schreibt dafuer auch keinen zweiten Protokolleintrag.
    expect(await prisma.auditLog.count({ where: { action: 'CLIP_HALLOFFAME_HIDDEN' } })).toBe(1);
  });

  it('weist eine Runde ab, die gar nicht abgeschlossen ist', async () => {
    const runde = await clips.holeOderErstelleRunde(GUILD, WOCHE_39);

    await expect(clips.setzeHallOfFameSichtbarkeit(runde.id, true, MOD)).rejects.toThrow();
  });
});
