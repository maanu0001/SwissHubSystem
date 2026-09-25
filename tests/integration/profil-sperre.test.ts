import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_sperre');

/**
 * Das oeffentliche Profil sperren.
 *
 * ## Was die Massnahme ist
 *
 * Eine Moderationsmassnahme wie Bann und Timeout - sie steht in derselben
 * Akte, laeuft durch dieselbe Rangfolgepruefung und braucht denselben
 * Pflichtgrund. Sie wirkt nur anders: nicht auf Discord, sondern auf die
 * oeffentliche Seite dieser Anwendung.
 *
 * ## Was hier geprueft wird
 *
 * Vor allem, **was danach nicht mehr geht**. Eine Sperre, die die Seite
 * abschaltet und die Vorschaukarte stehen laesst, ist keine Sperre: der
 * Inhalt reist als Vorschau weiter, ohne dass jemand die Seite oeffnet.
 */
const { prisma } = await import('@swisshub/database');
const { profile, moderation } = await import('@swisshub/modules');

const ANNA = '100000000000000001';
const MOD = '100000000000000009';
const MOD_ROLLE = '900000000000000503';

const P = moderation.MODERATION_PERMISSIONS;

/** Ein Moderator mit genau diesen Berechtigungen. */
function moderator(erlaubt: string[]) {
  return {
    discordId: MOD,
    username: 'moderatorin',
    roleIds: [MOD_ROLLE],
    isOwner: false,
    can: (permission: string) => erlaubt.includes(permission),
  };
}

const VOLL = moderator([P.profileLock, P.profileUnlock]);

/** Ein Discord-Zugang, der die Rangfolgepruefung bedienen kann. */
function attrappe() {
  return {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'anna',
        displayName: 'Anna',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: [],
        joinedAt: new Date('2021-03-01'),
        accountCreatedAt: new Date('2020-01-01'),
        boosting: false,
        timedOutUntil: null,
      })),
    },
    roles: {
      list: vi.fn(async () => [
        { id: MOD_ROLLE, name: 'Moderation', color: 0, position: 50, managed: false, permissions: '0' },
      ]),
    },
    guild: { get: vi.fn(async () => ({ id: '1', name: 'SwissHub', ownerId: '9' })) },
    bot: {
      identity: vi.fn(async () => ({ discordId: 'bot', username: 'SwissHub Bot' })),
      highestRolePosition: vi.fn(async () => 100),
    },
    channels: { send: vi.fn(async () => ({ id: 'm', channelId: 'c' })) },
  } as unknown as NonNullable<Parameters<typeof moderation.sperreOeffentlichesProfil>[1]>['gateway'];
}

async function oeffentlichesProfil(): Promise<void> {
  await prisma.discordMemberCache.create({
    data: {
      discordId: ANNA,
      username: 'anna',
      displayName: 'Anna',
      joinedAt: new Date('2021-03-01T00:00:00Z'),
      roleIds: [],
      isBot: false,
    },
  });
  await profile.speichereAllgemein(ANNA, {
    displayName: null,
    tagline: 'Spielt abends Valheim',
    bio: null,
    languages: [],
    platforms: [],
    playtimes: [],
    comms: [],
    playStyle: 'BOTH',
    availability: 'UNSET',
  });
  await profile.speicherePrivatsphaere(ANNA, {
    visibilityProfile: 'PUBLIC',
    visibilityGames: 'PUBLIC',
    visibilitySocials: 'PUBLIC',
    visibilityCareer: 'PUBLIC',
    visibilityActivity: 'PUBLIC',
    discoverable: true,
  });
  await prisma.memberProfile.update({ where: { discordId: ANNA }, data: { publicSlug: 'anna' } });
}

const sperren = (bis?: Date | null) =>
  moderation.sperreOeffentlichesProfil(
    { actor: VOLL, targetDiscordId: ANNA, reason: 'Anstoessiges Bannerbild', bis: bis ?? null },
    { gateway: attrappe() },
  );

describeWithDatabase('Oeffentliches Profil sperren', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "MemberSocialLink","MemberGameProfile","MemberShowcase","MemberProfile","DiscordMemberCache","ModerationAction","AuditLog" RESTART IDENTITY CASCADE',
    );
    await oeffentlichesProfil();
  });

  // --- Wirkung ------------------------------------------------------------

  it('zeigt das Profil vor der Sperre', async () => {
    const antwort = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(antwort.art).toBe('profil');
  });

  it('nimmt die oeffentliche Seite vom Netz', async () => {
    await sperren();
    const antwort = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(antwort.art).toBe('gesperrt');
  });

  it('liefert ueber den alten Weg gar keine Profildaten mehr', async () => {
    /*
     * `ladeOeffentlichesProfil` ist der Weg, den die Vorschaukarte und jeder
     * andere Aufrufer nehmen. Er muss `null` geben - nicht ein Profil mit
     * weniger Feldern, sondern nichts.
     */
    await sperren();
    expect(await profile.ladeOeffentlichesProfil('anna')).toBeNull();
  });

  it('nimmt dem Teilen-Knopf den Slug', async () => {
    expect(await profile.slugVon(ANNA)).toBe('anna');
    await sperren();
    expect(await profile.slugVon(ANNA)).toBeNull();
  });

  it('laesst die gespeicherten Daten unberuehrt', async () => {
    /*
     * Eine Sperre ist keine Loeschung. Wer sie aufhebt, soll dasselbe Profil
     * vorfinden - nicht eines, dem Felder fehlen.
     */
    await sperren();
    const zeile = await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(zeile.tagline).toBe('Spielt abends Valheim');
    expect(zeile.publicSlug).toBe('anna');
    expect(zeile.visibilityProfile).toBe('PUBLIC');
  });

  it('gibt die Seite nach dem Entsperren unveraendert zurueck', async () => {
    await sperren();
    await moderation.entsperreOeffentlichesProfil(
      { actor: VOLL, targetDiscordId: ANNA, reason: 'Bild entfernt' },
      { gateway: attrappe() },
    );
    const antwort = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(antwort.art).toBe('profil');
    if (antwort.art === 'profil') {
      expect(antwort.profil.angaben?.tagline).toBe('Spielt abends Valheim');
    }
  });

  it('unterscheidet eine Sperre von einer unbekannten Adresse', async () => {
    /*
     * Fuer eine unbekannte Adresse bleibt es bei «gibt es nicht» - sonst
     * liesse sich durch Ausprobieren herausfinden, wer ein Profil hat, das er
     * nicht zeigt.
     */
    await sperren();
    expect((await profile.ladeOeffentlichesProfilOderSperre('gibtesnicht')).art).toBe('keines');
  });

  it('behandelt ein nicht oeffentliches Profil weiterhin als nicht vorhanden', async () => {
    await profile.speicherePrivatsphaere(ANNA, {
      visibilityProfile: 'MEMBERS',
      visibilityGames: 'MEMBERS',
      visibilitySocials: 'MEMBERS',
      visibilityCareer: 'MEMBERS',
      visibilityActivity: 'MEMBERS',
      discoverable: true,
    });
    await sperren();
    expect((await profile.ladeOeffentlichesProfilOderSperre('anna')).art).toBe('keines');
  });

  // --- Akte und Protokoll -------------------------------------------------

  it('schreibt die Massnahme in die Akte', async () => {
    await sperren();
    const eintrag = await prisma.moderationAction.findFirstOrThrow({
      where: { type: 'PROFILE_LOCK', targetDiscordId: ANNA },
    });
    expect(eintrag.actorDiscordId).toBe(MOD);
    expect(eintrag.reason).toBe('Anstoessiges Bannerbild');
    expect(eintrag.status).toBe('COMPLETED');
  });

  it('haelt den Grund intern - er steht nicht im oeffentlichen Ergebnis', async () => {
    await sperren();
    const antwort = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(JSON.stringify(antwort)).not.toContain('Anstoessiges');
  });

  it('zeigt Staff den Sperrzustand mit Grund', async () => {
    await sperren();
    const stand = await moderation.profilSperrStand(ANNA);
    expect(stand.gesperrt).toBe(true);
    expect(stand.grund).toBe('Anstoessiges Bannerbild');
    expect(stand.vonDiscordId).toBe(MOD);
    expect(stand.bis).toBeNull();
  });

  // --- Berechtigungen -----------------------------------------------------

  it('laesst ohne Berechtigung nicht sperren', async () => {
    await expect(
      moderation.sperreOeffentlichesProfil(
        { actor: moderator([]), targetDiscordId: ANNA, reason: 'Weil ich kann' },
        { gateway: attrappe() },
      ),
    ).rejects.toThrow();
    expect((await moderation.profilSperrStand(ANNA)).gesperrt).toBe(false);
  });

  it('laesst mit Sperr-, aber ohne Entsperrberechtigung nicht entsperren', async () => {
    await sperren();
    await expect(
      moderation.entsperreOeffentlichesProfil(
        { actor: moderator([P.profileLock]), targetDiscordId: ANNA, reason: 'doch nicht' },
        { gateway: attrappe() },
      ),
    ).rejects.toThrow();
    expect((await moderation.profilSperrStand(ANNA)).gesperrt).toBe(true);
  });

  it('verlangt einen Grund', async () => {
    await expect(
      moderation.sperreOeffentlichesProfil(
        { actor: VOLL, targetDiscordId: ANNA, reason: 'x' },
        { gateway: attrappe() },
      ),
    ).rejects.toThrow();
  });

  it('weist das Entsperren eines nicht gesperrten Profils zurueck', async () => {
    await expect(
      moderation.entsperreOeffentlichesProfil(
        { actor: VOLL, targetDiscordId: ANNA, reason: 'ins Blaue' },
        { gateway: attrappe() },
      ),
    ).rejects.toThrow();
  });

  it('sperrt auch jemanden ohne Profilzeile', async () => {
    /*
     * Wer nie etwas eingetragen hat, hat keine Zeile - und genau den koennte
     * man sonst nicht sperren.
     */
    const OHNE = '100000000000000055';
    await prisma.discordMemberCache.create({
      data: {
        discordId: OHNE,
        username: 'ohne',
        displayName: 'Ohne',
        joinedAt: new Date('2022-01-01'),
        roleIds: [],
        isBot: false,
      },
    });
    await moderation.sperreOeffentlichesProfil(
      { actor: VOLL, targetDiscordId: OHNE, reason: 'Vorsichtshalber' },
      { gateway: attrappe() },
    );
    expect((await moderation.profilSperrStand(OHNE)).gesperrt).toBe(true);
  });

  // --- Befristung ---------------------------------------------------------

  it('weist ein Ende in der Vergangenheit zurueck', async () => {
    await expect(sperren(new Date(Date.now() - 1000))).rejects.toThrow();
  });

  it('hebt eine faellige Sperre selbst wieder auf', async () => {
    await sperren(new Date(Date.now() + 60_000));
    expect((await profile.ladeOeffentlichesProfilOderSperre('anna')).art).toBe('gesperrt');

    // Vor der Faelligkeit geschieht nichts.
    expect(await moderation.hebeFaelligeProfilsperrenAuf()).toBe(0);

    const spaeter = new Date(Date.now() + 120_000);
    expect(await moderation.hebeFaelligeProfilsperrenAuf(spaeter)).toBe(1);
    expect((await profile.ladeOeffentlichesProfilOderSperre('anna')).art).toBe('profil');
  });

  it('laesst eine unbefristete Sperre stehen', async () => {
    await sperren();
    expect(await moderation.hebeFaelligeProfilsperrenAuf(new Date(Date.now() + 3600_000))).toBe(0);
    expect((await moderation.profilSperrStand(ANNA)).gesperrt).toBe(true);
  });

  it('vermerkt die abgelaufene Sperre als Massnahme der Zeitsteuerung', async () => {
    await sperren(new Date(Date.now() + 60_000));
    await moderation.hebeFaelligeProfilsperrenAuf(new Date(Date.now() + 120_000));

    const eintrag = await prisma.moderationAction.findFirstOrThrow({
      where: { type: 'PROFILE_UNLOCK', targetDiscordId: ANNA },
    });
    // Ausdruecklich das System: der Moderator von damals hat gesperrt, nicht
    // aufgehoben.
    expect(eintrag.actorDiscordId).toBe('system');
    expect(eintrag.source).toBe('SYSTEM');
  });

  it('hebt eine faellige Sperre auch bei zwei Durchgaengen nur einmal auf', async () => {
    /*
     * Zwei Arbeiter, dieselbe faellige Zeile.
     *
     * Ohne die bedingte Schreiboperation wuerden beide sie aufheben und
     * beide einen Eintrag in die Akte schreiben - zweimal «Sperre
     * abgelaufen» fuer eine Sperre. Das faellt im Alltag niemandem auf und
     * ist trotzdem falsch, denn die Akte ist das, worauf man sich spaeter
     * beruft.
     */
    await sperren(new Date(Date.now() + 60_000));
    const spaeter = new Date(Date.now() + 120_000);

    const [a, b] = await Promise.all([
      moderation.hebeFaelligeProfilsperrenAuf(spaeter),
      moderation.hebeFaelligeProfilsperrenAuf(spaeter),
    ]);

    expect(a + b).toBe(1);
    expect(
      await prisma.moderationAction.count({ where: { type: 'PROFILE_UNLOCK', targetDiscordId: ANNA } }),
    ).toBe(1);
  });

  it('hebt nichts auf, was jemand inzwischen verlaengert hat', async () => {
    await sperren(new Date(Date.now() + 60_000));
    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { publicLockUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(await moderation.hebeFaelligeProfilsperrenAuf(new Date(Date.now() + 120_000))).toBe(0);
    expect((await moderation.profilSperrStand(ANNA)).gesperrt).toBe(true);
  });
});
