import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_streamer_vitrine');

/**
 * Die Vitrine eines Streamers: bis zu drei Clips und eine Zeile.
 *
 * ## Was hier geprüft wird
 *
 * Drei Dinge, und jedes davon ist eine Zusage:
 *
 *   1. **Nur ein freigegebener Streamer hat eine Vitrine.** Geprüft an beiden
 *      Enden - beim Schreiben und beim Lesen. Wer freigegeben war, seine
 *      Vitrine gefüllt hat und dann pausiert wird, zeigt sie nicht weiter.
 *   2. **Die Zeile ist Klartext.** Kein HTML, kein Markdown, keine Adresse.
 *      Sie geht auch nach Discord, und dort gilt React nicht.
 *   3. **Die Plätze sind Plätze.** Drei, jeder einzeln belegbar, und derselbe
 *      Clip steht nicht zweimal darin.
 *
 * ## Warum gegen eine Datenbank
 *
 * Weil zwei Eindeutigkeiten die eigentliche Arbeit machen - ein Platz je Profil
 * und ein Clip je Profil. Ob das Verschieben eines Clips von Platz 0 auf Platz
 * 1 ein Konflikt ist oder ein Umzug, zeigt kein Modultest.
 */
const { prisma } = await import('@swisshub/database');
const { streamer, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const LEA = '100000000000000001';
const BEN = '100000000000000002';
const HOST = 'swisshub.test';

/** Echte Clip-Adressen der drei zugelassenen Anbieter. */
const CLIPS = {
  twitch: 'https://www.twitch.tv/lea/clip/SchoenerMomentHier',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  medal: 'https://medal.tv/games/valheim/clips/12345/abcdEFGH',
};

async function einstellungen(): Promise<void> {
  await setModuleEnabled(streamer.STREAMER_MODULE_ID, true, 'test');
  await setModuleSettings(
    streamer.STREAMER_MODULE_ID,
    { oeffentlichAktiv: true, twitchAktiv: false, youtubeAktiv: false },
    'test',
  );
}

async function anlegen(
  discordId: string,
  name: string,
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED',
): Promise<string> {
  await prisma.discordMemberCache.create({
    data: { discordId, username: name.toLowerCase(), displayName: name },
  });
  await prisma.memberProfile.create({
    data: { discordId, displayName: name, publicSlug: name.toLowerCase(), visibilityProfile: 'PUBLIC' },
  });
  const profil = await prisma.streamerProfil.create({
    data: { discordId, status, sprachen: ['de'] },
  });
  await prisma.streamerKanal.create({
    data: {
      profilId: profil.id,
      plattform: 'TWITCH',
      externeId: `1000${discordId.slice(-2)}`,
      handle: `${name.toLowerCase()}_streamt`,
      verifikation: 'OAUTH',
      aktiv: true,
    },
  });
  return profil.id;
}

async function leeren(): Promise<void> {
  await prisma.streamerClip.deleteMany();
  await prisma.streamerSession.deleteMany();
  await prisma.streamerKanal.deleteMany();
  await prisma.streamerProfil.deleteMany();
  await prisma.memberProfile.deleteMany();
  await prisma.discordMemberCache.deleteMany();
}

describeWithDatabase('Streamer-Vitrine', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await einstellungen();
  });

  // --- Nur für Freigegebene -------------------------------------------------

  it('gehört nur einem freigegebenen Streamer', async () => {
    for (const status of ['DRAFT', 'PENDING', 'REJECTED', 'SUSPENDED'] as const) {
      await leeren();
      await anlegen(LEA, 'Lea', status);

      await expect(streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch), status).rejects.toThrow();
      await expect(streamer.setzeVitrineCaption(LEA, 'Dienstags um acht'), status).rejects.toThrow();
      await expect(streamer.entferneVitrineClip(LEA, 0), status).rejects.toThrow();
      expect(await streamer.ladeVitrine(LEA, HOST)).toEqual({ clips: [], caption: null });
    }
  });

  it('gehört niemandem, der kein Streamer-Profil hat', async () => {
    await expect(streamer.setzeVitrineClip(BEN, 0, CLIPS.twitch)).rejects.toThrow();
    expect(await streamer.ladeVitrine(BEN, HOST)).toEqual({ clips: [], caption: null });
  });

  it('verschwindet aus dem Blick, sobald der Streamer pausiert wird', async () => {
    /*
     * Der Fall, auf den es ankommt: gefüllt, solange es erlaubt war, und danach
     * nicht mehr sichtbar. Die Zeilen bleiben stehen - eine Pause ist keine
     * Löschung, und wer zurückkommt, hat seine Vitrine noch.
     */
    const profilId = await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch);
    await streamer.setzeVitrineCaption(LEA, 'Dienstags um acht');
    expect((await streamer.ladeVitrine(LEA, HOST)).clips).toHaveLength(1);

    await prisma.streamerProfil.update({ where: { id: profilId }, data: { status: 'SUSPENDED' } });

    expect(await streamer.ladeVitrine(LEA, HOST)).toEqual({ clips: [], caption: null });
    // Die Daten sind noch da.
    expect(await prisma.streamerClip.count({ where: { profilId } })).toBe(1);
  });

  // --- Die Clips ------------------------------------------------------------

  it('nimmt Links der drei zugelassenen Anbieter und normalisiert sie', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch, 'Der Wurf');
    await streamer.setzeVitrineClip(LEA, 1, CLIPS.youtube);
    await streamer.setzeVitrineClip(LEA, 2, CLIPS.medal);

    const vitrine = await streamer.ladeVitrine(LEA, HOST);
    expect(vitrine.clips.map((clip) => clip.provider)).toEqual(['twitch', 'youtube', 'medal']);
    expect(vitrine.clips[0]?.titel).toBe('Der Wurf');
    // Die Einbettungsadresse entsteht aus Anbieter und Kennung, nie aus der
    // Eingabe - und Twitch bekommt unseren Hostnamen als `parent`.
    expect(vitrine.clips[0]?.einbettungsUrl).toContain(`parent=${HOST}`);
    expect(vitrine.clips[1]?.einbettungsUrl).toContain('youtube-nocookie.com');
    for (const clip of vitrine.clips) {
      expect(clip.einbettungsUrl.startsWith('https://')).toBe(true);
    }
  });

  it('weist eine fremde Adresse ab', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    for (const boese of [
      'https://boese.example/clip/1',
      'javascript:alert(1)',
      'https://twitch.tv.boese.example/lea/clip/X',
      'clip-00000000000000000000000000000000.mp4',
      'nicht mal eine Adresse',
    ]) {
      await expect(streamer.setzeVitrineClip(LEA, 0, boese), boese).rejects.toThrow();
    }
    expect(await prisma.streamerClip.count()).toBe(0);
  });

  it('kennt genau drei Plätze', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    expect(streamer.MAX_VITRINE_CLIPS).toBe(3);
    await expect(streamer.setzeVitrineClip(LEA, 3, CLIPS.twitch)).rejects.toThrow();
    await expect(streamer.setzeVitrineClip(LEA, -1, CLIPS.twitch)).rejects.toThrow();
    await expect(streamer.setzeVitrineClip(LEA, 1.5, CLIPS.twitch)).rejects.toThrow();
    expect(await prisma.streamerClip.count()).toBe(0);
  });

  it('ersetzt den Inhalt eines Platzes, statt anzuhängen', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch);
    await streamer.setzeVitrineClip(LEA, 0, CLIPS.youtube);

    const vitrine = await streamer.ladeVitrine(LEA, HOST);
    expect(vitrine.clips).toHaveLength(1);
    expect(vitrine.clips[0]?.provider).toBe('youtube');
  });

  it('zieht einen Clip auf einen anderen Platz um, statt ihn zu verdoppeln', async () => {
    /*
     * Zwei Eindeutigkeiten greifen hier gleichzeitig: ein Platz je Profil und
     * ein Clip je Profil. Derselbe Clip auf einem zweiten Platz soll ein Umzug
     * sein - und nicht ein Konflikt, den die Oberflaeche erklaeren muesste.
     */
    await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch);
    await streamer.setzeVitrineClip(LEA, 2, CLIPS.twitch);

    const vitrine = await streamer.ladeVitrine(LEA, HOST);
    expect(vitrine.clips).toHaveLength(1);
    expect(vitrine.clips[0]?.position).toBe(2);
  });

  it('räumt einen Platz und bleibt dabei gelassen', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineClip(LEA, 1, CLIPS.twitch);

    await streamer.entferneVitrineClip(LEA, 1);
    expect((await streamer.ladeVitrine(LEA, HOST)).clips).toEqual([]);
    // Idempotent: ein leerer Platz bleibt leer, ohne zu werfen.
    await streamer.entferneVitrineClip(LEA, 1);
  });

  it('hält zwei Streamer auseinander', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await anlegen(BEN, 'Ben', 'APPROVED');

    // Derselbe Clip bei beiden - das ist erlaubt, die Eindeutigkeit gilt je Profil.
    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch);
    await streamer.setzeVitrineClip(BEN, 0, CLIPS.twitch);

    expect((await streamer.ladeVitrine(LEA, HOST)).clips).toHaveLength(1);
    expect((await streamer.ladeVitrine(BEN, HOST)).clips).toHaveLength(1);
  });

  // --- Die Zeile ------------------------------------------------------------

  it('nimmt eine Zeile aus Klartext samt Emoji', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    for (const gut of [
      'Dienstags um acht, Valheim mit der Crew',
      'Jeden Abend 🎮 – kommt vorbei!',
      'CS2, Rocket League & mehr (deutsch)',
    ]) {
      expect(await streamer.setzeVitrineCaption(LEA, gut), gut).toBe(gut);
    }
  });

  it('weist HTML, Markdown und Adressen ab', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineCaption(LEA, 'Harmlos');

    for (const boese of [
      '<script>alert(1)</script>',
      '<b>fett</b>',
      '**fett**',
      '__unterstrichen__',
      '`code`',
      '[Link](https://boese.example)',
      'schau auf https://boese.example',
      '||spoiler||',
      '~~durchgestrichen~~',
      '@everyone kommt',
    ]) {
      await expect(streamer.setzeVitrineCaption(LEA, boese), boese).rejects.toThrow();
    }

    // Und die alte Zeile steht unverändert.
    expect((await streamer.ladeVitrine(LEA, HOST)).caption).toBe('Harmlos');
  });

  it('weist eine zu lange Zeile ab', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await expect(
      streamer.setzeVitrineCaption(LEA, 'a'.repeat(streamer.MAX_CAPTION_LAENGE + 1)),
    ).rejects.toThrow();
    // Genau die Grenze geht.
    await expect(
      streamer.setzeVitrineCaption(LEA, 'a'.repeat(streamer.MAX_CAPTION_LAENGE)),
    ).resolves.toHaveLength(streamer.MAX_CAPTION_LAENGE);
  });

  it('löscht die Zeile mit einer leeren Eingabe', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineCaption(LEA, 'Dienstags');

    expect(await streamer.setzeVitrineCaption(LEA, '   ')).toBeNull();
    expect((await streamer.ladeVitrine(LEA, HOST)).caption).toBeNull();
    expect(await streamer.setzeVitrineCaption(LEA, null)).toBeNull();
  });

  // --- Im öffentlichen Profil -----------------------------------------------

  it('erscheint im Streaming-Abschnitt des einen öffentlichen Profils', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    await streamer.setzeVitrineClip(LEA, 0, CLIPS.twitch, 'Der Wurf');
    await streamer.setzeVitrineCaption(LEA, 'Dienstags um acht');

    const abschnitt = await streamer.ladeProfilStreaming(LEA, HOST);
    expect(abschnitt?.caption).toBe('Dienstags um acht');
    expect(abschnitt?.clips).toHaveLength(1);
    expect(abschnitt?.clips[0]?.titel).toBe('Der Wurf');
  });

  it('gibt den Profil-Slug für das Neuladen heraus - nur bei öffentlichem Profil', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    expect(await streamer.slugFuerProfil(LEA)).toBe('lea');

    await prisma.memberProfile.update({
      where: { discordId: LEA },
      data: { visibilityProfile: 'MEMBERS' },
    });
    expect(await streamer.slugFuerProfil(LEA)).toBeNull();
  });
});
