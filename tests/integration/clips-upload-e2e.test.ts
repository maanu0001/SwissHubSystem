import { mkdtempSync, statSync } from 'node:fs';
import { readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_upload');

/**
 * Hochgeladene Clips, von der Datei bis zur Hall of Fame.
 *
 * ## Warum dieser Test existiert
 *
 * Weil «der Upload hat funktioniert» drei verschiedene Dinge heissen kann und
 * nur eines davon zaehlt:
 *
 *   1. der Endpunkt hat mit 200 geantwortet
 *   2. eine Datei liegt auf der Platte
 *   3. **der Clip ist eingereicht, moderierbar, waehlbar und kann gewinnen**
 *
 * Geprueft wird das Dritte. Ein gespeichertes Video, das die Moderation nicht
 * sieht oder fuer das niemand stimmen kann, ist kein eingereichter Clip - es
 * ist belegter Speicherplatz.
 *
 * ## Warum mit echten Bytes
 *
 * `speichereVideo` erkennt den Container an der Signatur. Ein Test mit
 * `Buffer.from('video')` wuerde die Erkennung umgehen und damit genau die
 * Stelle nicht pruefen, die alles andere traegt. Die Dateien unten sind
 * deshalb echte MP4- und WebM-Koepfe.
 */

/*
 * Das Upload-Verzeichnis, bevor irgendetwas geladen wird.
 *
 * `branding/storage.ts` liest `SWISSHUB_UPLOAD_DIR` beim Laden in eine
 * Konstante - danach gesetzt, waere die Variable ohne Wirkung und der Test
 * schriebe in das echte Verzeichnis.
 */
const UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'swisshub-clips-'));
process.env.SWISSHUB_UPLOAD_DIR = UPLOAD_DIR;

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

/** Ein MP4-Kopf: Boxlaenge, `ftyp`, Marke, dann Fuellung. */
function mp4(marke = 'isom', bytes = 4096): Uint8Array {
  const datei = new Uint8Array(bytes);
  datei.set([0x00, 0x00, 0x00, 0x18], 0);
  datei.set(
    [...'ftyp'].map((zeichen) => zeichen.charCodeAt(0)),
    4,
  );
  datei.set(
    [...marke].map((zeichen) => zeichen.charCodeAt(0)),
    8,
  );
  return datei;
}

/** Ein WebM-Kopf: EBML-Signatur und `webm` als DocType. */
function webm(docType = 'webm', bytes = 4096): Uint8Array {
  const datei = new Uint8Array(bytes);
  datei.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  datei.set(
    [...docType].map((zeichen) => zeichen.charCodeAt(0)),
    24,
  );
  return datei;
}

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
      submissionsPerMember: 2,
      allowSelfVote: false,
      showVoteCounts: true,
      showClipsDuringSubmission: true,
      announcementChannelId: null,
      announceStart: false,
      announceVoting: false,
      announceWinner: false,
      announceApprovedClips: false,
      allowUploads: true,
      uploadMaxMb: 100,
      ...teile,
    },
    'test',
  );
}

async function offeneRunde(): Promise<string> {
  const runde = await clips.holeOderErstelleRunde(GUILD, JETZT);
  await prisma.clipCompetition.update({ where: { id: runde.id }, data: { status: 'SUBMISSION' } });
  return runde.id;
}

/** Speichern und einreichen - der Weg, den der Endpunkt nimmt. */
async function reicheDateiEin(
  wer: string,
  titel: string,
  daten: Uint8Array = mp4(),
  gemeldet: string | null = 'video/mp4',
): Promise<{ clipId: string; entryId: string; dateiname: string }> {
  const video = await clips.speichereVideo(daten, gemeldet, 100 * 1024 * 1024);
  const ergebnis = await clips.reicheEin(
    GUILD,
    actor(wer),
    { upload: { dateiname: video.dateiname, container: video.container }, titel },
    JETZT,
  );
  return { clipId: ergebnis.clipId, entryId: ergebnis.entryId, dateiname: video.dateiname };
}

describeWithDatabase('Clip-Uploads von Ende zu Ende', () => {
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

  it('macht aus einer MP4-Datei einen wartenden Clip', async () => {
    await offeneRunde();
    const { clipId, dateiname } = await reicheDateiEin(ANNA, 'Mein Ace');

    const clip = await prisma.clip.findUnique({ where: { id: clipId } });
    expect(clip?.status).toBe('PENDING');
    expect(clip?.sourceType).toBe('UPLOAD');
    expect(clip?.provider).toBe('upload');
    // Die Kennung ist der Dateiname - und die Adresse zeigt nach innen.
    expect(clip?.externalId).toBe(dateiname);
    expect(clip?.embedUrl).toBe(`/api/clips/datei/${dateiname}`);
    expect(clip?.canonicalUrl).toBe(`/api/clips/datei/${dateiname}`);
    expect(clip?.thumbnailUrl).toBeNull();

    // Und die Datei liegt wirklich da, mit den Rechten, die sie haben soll.
    const angaben = statSync(join(UPLOAD_DIR, dateiname));
    expect(angaben.size).toBe(4096);
    expect(angaben.mode & 0o777).toBe(0o640);
  });

  it('nimmt auch WebM an', async () => {
    await offeneRunde();
    const { clipId, dateiname } = await reicheDateiEin(ANNA, 'In WebM', webm(), 'video/webm');
    expect(dateiname.endsWith('.webm')).toBe(true);
    expect((await prisma.clip.findUnique({ where: { id: clipId } }))?.sourceType).toBe('UPLOAD');
  });

  it('traegt den ganzen Wettbewerb: Moderation, Abstimmung, Gewinner', async () => {
    const rundeId = await offeneRunde();
    const eigener = await reicheDateiEin(ANNA, 'Der Clip mit der Datei');
    // Ein Link daneben, damit der Vergleich echt ist: beide Arten in einer Runde.
    const perLink = await clips.reicheEin(
      GUILD,
      actor(BEN),
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titel: 'Der Clip mit dem Link' },
      JETZT,
    );

    // Moderation - beide Arten gehen denselben Weg.
    await clips.gibFrei(eigener.entryId, actor(MOD));
    await clips.gibFrei(perLink.entryId, actor(MOD));
    expect((await prisma.clipCompetitionEntry.findUnique({ where: { id: eigener.entryId } }))?.status).toBe(
      'APPROVED',
    );

    // Abstimmung - der Upload bekommt zwei Stimmen, der Link eine.
    await prisma.clipCompetition.update({ where: { id: rundeId }, data: { status: 'VOTING' } });
    await clips.stimmeAb(GUILD, actor(BEN), eigener.entryId);
    await clips.stimmeAb(GUILD, actor(MOD), eigener.entryId);
    await clips.stimmeAb(GUILD, actor(ANNA), perLink.entryId);

    // Finale.
    await prisma.clipCompetition.update({
      where: { id: rundeId },
      data: { votingEndsAt: new Date(JETZT.getTime() - 1000) },
    });
    await clips.fuehreUebergaengeAus(GUILD, JETZT);

    const runde = await prisma.clipCompetition.findUnique({ where: { id: rundeId } });
    expect(runde?.status).toBe('COMPLETED');
    // Der entscheidende Satz dieses Tests: eine hochgeladene Datei kann
    // gewinnen. Waere irgendwo im Weg ein Sonderfall fuer Anbieterclips,
    // stuende hier der Link.
    expect(runde?.winnerEntryId).toBe(eigener.entryId);
  });

  it('erscheint in der Hall of Fame', async () => {
    const rundeId = await offeneRunde();
    const eigener = await reicheDateiEin(ANNA, 'Siegerclip');
    await clips.gibFrei(eigener.entryId, actor(MOD));
    await prisma.clipCompetition.update({
      where: { id: rundeId },
      data: { status: 'VOTING' },
    });
    await clips.stimmeAb(GUILD, actor(BEN), eigener.entryId);
    await prisma.clipCompetition.update({
      where: { id: rundeId },
      data: { votingEndsAt: new Date(JETZT.getTime() - 1000) },
    });
    await clips.fuehreUebergaengeAus(GUILD, JETZT);

    const ruhmeshalle = await clips.hallOfFame(GUILD, 10);
    expect(ruhmeshalle).toHaveLength(1);
    expect(ruhmeshalle[0]?.gewinner?.titel).toBe('Siegerclip');
    expect(ruhmeshalle[0]?.gewinner?.provider).toBe('upload');
    // Die Karte in der Ruhmeshalle traegt die interne Adresse - der Spieler
    // dort braucht sie, um ein `<video>` statt eines Rahmens zu zeigen.
    expect(ruhmeshalle[0]?.gewinner?.canonicalUrl).toMatch(/^\/api\/clips\/datei\//u);
  });

  it('loescht die Datei, wenn die Moderation ablehnt', async () => {
    await offeneRunde();
    const { entryId, dateiname } = await reicheDateiEin(ANNA, 'Geht so nicht');
    expect(statSync(join(UPLOAD_DIR, dateiname)).size).toBeGreaterThan(0);

    await clips.lehneAb(entryId, actor(MOD), 'INAPPROPRIATE');

    /*
     * Der Kern: «unpassender Inhalt» ist der haeufigste Ablehnungsgrund. Ihn
     * auf der Platte zu behalten waere eine Kopie von genau dem, was die
     * Moderation entfernt hat.
     */
    await expect(stat(join(UPLOAD_DIR, dateiname))).rejects.toThrow();
  });

  it('behaelt die Datei, wenn nur die Teilnahme zurueckgezogen wird', async () => {
    /*
     * Die Gegenprobe. Aus der Runde genommen heisst nicht abgelehnt: der Clip
     * selbst bleibt gueltig und kann in einer spaeteren Runde antreten.
     */
    await offeneRunde();
    const { entryId, dateiname } = await reicheDateiEin(ANNA, 'Nur heraus');
    await clips.gibFrei(entryId, actor(MOD));
    await clips.nimmAusRunde(entryId, actor(MOD), 'Passt nicht in diese Runde');

    expect((await stat(join(UPLOAD_DIR, dateiname))).size).toBeGreaterThan(0);
  });

  it('lehnt ab, was kein Video ist - auch mit richtig klingendem Typ', async () => {
    const vorher = (await readdir(UPLOAD_DIR)).length;
    const html = new TextEncoder().encode('<html><body>ftypisom und sonst nichts</body></html>');

    await expect(clips.speichereVideo(html, 'video/mp4', 100 * 1024 * 1024)).rejects.toMatchObject({
      userMessage: expect.stringContaining('MP4 und WebM'),
    });

    /*
     * Und es ist nichts entstanden. Das ist der eigentliche Punkt: eine
     * abgelehnte Datei, die trotzdem geschrieben wurde, waere ein Weg, die
     * Platte zu fuellen, ohne je einen Clip einzureichen.
     */
    expect(await readdir(UPLOAD_DIR)).toHaveLength(vorher);
  });

  it('haelt die Grenze aus den Moduleinstellungen ein, nicht die aus dem Browser', async () => {
    const grenze = 8 * 1024;
    await expect(clips.speichereVideo(mp4('isom', grenze + 1), 'video/mp4', grenze)).rejects.toMatchObject({
      userMessage: expect.stringContaining('zu gross'),
    });
    // Genau auf der Grenze geht durch - eine Ablehnung bei exakt N waere ein
    // Zaehlfehler, den niemand melden wuerde.
    await expect(clips.speichereVideo(mp4('isom', grenze), 'video/mp4', grenze)).resolves.toBeTruthy();
  });

  it('schreibt nichts, wenn die Runde geschlossen ist', async () => {
    /*
     * Die Reihenfolge, auf der der ganze Schutz gegen volle Platten beruht:
     * erst fragen, dann lesen. Geprueft wird die Vorpruefung, die der
     * Endpunkt vor der Datei aufruft.
     */
    const rundeId = await offeneRunde();
    await prisma.clipCompetition.update({ where: { id: rundeId }, data: { status: 'VOTING' } });

    await expect(clips.pruefeEinreichungsfenster(GUILD, ANNA, JETZT)).rejects.toThrow(/geschlossen/u);
  });

  it('meldet das aufgebrauchte Kontingent, bevor eine Datei gelesen wird', async () => {
    await einstellungen({ submissionsPerMember: 1 });
    await offeneRunde();
    await reicheDateiEin(ANNA, 'Der eine');

    await expect(clips.pruefeEinreichungsfenster(GUILD, ANNA, JETZT)).rejects.toThrow(/bereits einen Clip/u);
  });

  it('raeumt Dateien weg, zu denen es keinen Clip gibt', async () => {
    await offeneRunde();
    const behalten = await reicheDateiEin(ANNA, 'Gehoert zu einem Clip');

    // Eine Datei wie nach einem Abbruch mitten im Upload: gespeichert, aber
    // nie eingereicht.
    const waise = await clips.speichereVideo(mp4(), 'video/mp4', 100 * 1024 * 1024);
    const alt = new Date(JETZT.getTime() - 3 * 60 * 60 * 1000);
    await utimes(join(UPLOAD_DIR, waise.dateiname), alt, alt);

    const geloescht = await clips.raeumeVerwaisteVideos(JETZT);

    expect(geloescht).toBe(1);
    await expect(stat(join(UPLOAD_DIR, waise.dateiname))).rejects.toThrow();
    // Und die Datei des echten Clips ist noch da.
    expect((await stat(join(UPLOAD_DIR, behalten.dateiname))).size).toBeGreaterThan(0);
  });

  it('laesst eine frische Datei in Ruhe', async () => {
    /*
     * Ohne Frist wuerde ein Durchgang, der mitten in einem laufenden Upload
     * faellt, die Datei unter der Einreichung wegziehen: geschrieben ist sie
     * da, der Clip steht noch nicht.
     */
    const frisch = await clips.speichereVideo(mp4(), 'video/mp4', 100 * 1024 * 1024);
    expect(await clips.raeumeVerwaisteVideos(new Date())).toBe(0);
    expect((await stat(join(UPLOAD_DIR, frisch.dateiname))).size).toBeGreaterThan(0);
  });

  it('ruehrt fremde Dateien im Upload-Verzeichnis nicht an', async () => {
    /*
     * Im Verzeichnis liegen auch Logos, Levelkarten und Profilbanner. Ein
     * Aufraeumen, das die mitnimmt, waere schlimmer als keines - und es faellt
     * erst auf, wenn das Logo weg ist.
     */
    const fremd = join(UPLOAD_DIR, 'logo-0123456789abcdef0123456789abcdef.png');
    await writeFile(fremd, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const alt = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await utimes(fremd, alt, alt);

    await clips.raeumeVerwaisteVideos(new Date());
    expect((await stat(fremd)).size).toBe(4);
  });
});
