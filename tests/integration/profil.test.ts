import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil');

/**
 * Mitgliederprofile gegen eine echte Datenbank.
 *
 * Geprueft wird hier, was sich ohne Postgres nicht zeigen laesst: dass die
 * Privatsphaere im **Dienst** durchgesetzt wird und nicht in der Oberflaeche,
 * dass ein toter Vitrinenverweis einen Platz ueberspringt statt einen Fehler
 * zu werfen, und dass «Mitglieder entdecken» ueber den vollstaendigen
 * Bestand sucht - nicht ueber die gerade geladene Seite.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const ANNA = '900000000000000031';
const BEN = '900000000000000032';

async function leeren(): Promise<void> {
  await prisma.memberShowcase.deleteMany({});
  await prisma.memberSocialLink.deleteMany({});
  await prisma.memberGameProfile.deleteMany({});
  await prisma.memberProfile.deleteMany({});
  await prisma.clipCompetitionEntry.deleteMany({});
  await prisma.calendarRegistration.deleteMany({});
  await prisma.game.deleteMany({});
  await prisma.levelProfile.deleteMany({});
  await prisma.discordMemberCache.deleteMany({});
}

async function spiegle(
  discordId: string,
  name: string,
  teile: { joinedAt?: Date; boosting?: boolean; isBot?: boolean; leftAt?: Date } = {},
): Promise<void> {
  await prisma.discordMemberCache.create({
    data: {
      discordId,
      username: name,
      displayName: name,
      searchText: name.toLowerCase(),
      joinedAt: teile.joinedAt ?? new Date('2022-01-01T00:00:00Z'),
      boosting: teile.boosting ?? false,
      isBot: teile.isBot ?? false,
      leftAt: teile.leftAt ?? null,
    },
  });
}

async function spiel(name: string): Promise<string> {
  const eintrag = await prisma.game.create({
    data: { name, nameKey: name.toLowerCase() },
  });
  return eintrag.id;
}

describeWithDatabase('Mitgliederprofile', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leeren();
    await spiegle(ANNA, 'anna');
    await spiegle(BEN, 'ben');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- Lesen und Schreiben -------------------------------------------------

  it('zeigt ein Profil ohne gespeicherte Zeile - und legt dabei keine an', async () => {
    const ansicht = await profile.ladeProfil(ANNA, ANNA);

    expect(ansicht?.identitaet.discordName).toBe('anna');
    expect(ansicht?.eigenes).toBe(true);
    expect(ansicht?.spiele).toEqual([]);
    // Ansehen schreibt nichts: bei mehreren tausend Mitgliedern waere die
    // Tabelle sonst voll mit leeren Zeilen.
    expect(await prisma.memberProfile.count()).toBe(0);
  });

  it('gibt es fuer eine Kennung ohne Spiegeleintrag nicht', async () => {
    expect(await profile.ladeProfil('900000000000000099', ANNA)).toBeNull();
  });

  it('zeigt kein Profil fuer einen Bot', async () => {
    await spiegle('900000000000000040', 'botti', { isBot: true });
    expect(await profile.ladeProfil('900000000000000040', ANNA)).toBeNull();
  });

  it('bleibt lesbar, wenn jemand den Server verlassen hat - und sagt es', async () => {
    await prisma.discordMemberCache.update({
      where: { discordId: BEN },
      data: { leftAt: new Date() },
    });
    const ansicht = await profile.ladeProfil(BEN, ANNA);
    expect(ansicht?.identitaet.verlassen).toBe(true);
  });

  it('speichert die allgemeinen Angaben und legt die Zeile dabei an', async () => {
    await profile.speichereAllgemein(ANNA, {
      displayName: 'Anna aus Bern',
      tagline: 'Immer für eine Runde zu haben',
      bio: 'Text',
      languages: ['de', 'en'],
      platforms: ['PC'],
      playtimes: ['wochenende-abend'],
      comms: ['voice-immer'],
      playStyle: 'COMPETITIVE',
      availability: 'LOOKING',
    });

    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.identitaet.profilname).toBe('Anna aus Bern');
    // Der Discord-Name bleibt der Discord-Name.
    expect(ansicht?.identitaet.discordName).toBe('anna');
    expect(ansicht?.angaben?.sprachen).toEqual(['Deutsch', 'Englisch']);
    expect(ansicht?.angaben?.verfuegbarkeit.label).toBe('Sucht Mitspieler');
  });

  // --- Privatsphaere -------------------------------------------------------

  it('laedt fuer andere nicht, was auf privat steht', async () => {
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: 'Geheim',
      bio: null,
      languages: ['de'],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    await profile.speicherePrivatsphaere(ANNA, {
      visibilityProfile: 'PRIVATE',
      visibilityGames: 'PRIVATE',
      visibilitySocials: 'PRIVATE',
      visibilityCareer: 'PRIVATE',
      visibilityActivity: 'PRIVATE',
      discoverable: false,
    });

    const fremd = await profile.ladeProfil(ANNA, BEN);
    expect(fremd?.angaben).toBeUndefined();
    expect(fremd?.spiele).toBeUndefined();
    expect(fremd?.socials).toBeUndefined();
    // Nicht nur ausgeblendet - im Ergebnis steht der Text nirgends.
    expect(JSON.stringify(fremd)).not.toContain('Geheim');

    // Vor sich selbst verbirgt man nichts.
    const eigen = await profile.ladeProfil(ANNA, ANNA);
    expect(eigen?.angaben?.tagline).toBe('Geheim');
  });

  it('gibt niemals Moderations-, Ticket- oder Jaildaten heraus', async () => {
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: null,
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });

    const ansicht = await profile.ladeProfil(ANNA, BEN);
    const felder = Object.keys(ansicht ?? {});
    for (const verboten of ['jail', 'moderation', 'tickets', 'notes', 'appeals', 'roles', 'token']) {
      expect(felder.some((feld) => feld.toLowerCase().includes(verboten))).toBe(false);
    }
    // Und auch nicht tief verschachtelt.
    const roh = JSON.stringify(ansicht).toLowerCase();
    for (const verboten of ['jail', 'moderationnote', 'ticket', 'accesstoken', 'refreshtoken']) {
      expect(roh).not.toContain(verboten);
    }
  });

  it('aendert ausschliesslich das Profil, dessen Kennung hereingereicht wurde', async () => {
    await profile.speichereAllgemein(BEN, {
      displayName: 'Ben',
      tagline: null,
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    await profile.speichereAllgemein(ANNA, {
      displayName: 'Anna',
      tagline: null,
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });

    const ben = await prisma.memberProfile.findUnique({ where: { discordId: BEN } });
    expect(ben?.displayName).toBe('Ben');
  });

  // --- Spiele --------------------------------------------------------------

  it('nimmt nur Spiele aus dem zentralen Katalog', async () => {
    await expect(profile.speichereSpiel(ANNA, { gameId: 'gibtsnicht' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('nimmt kein archiviertes Spiel mehr an', async () => {
    const id = await spiel('Altes Spiel');
    await prisma.game.update({ where: { id }, data: { archivedAt: new Date() } });
    await expect(profile.speichereSpiel(ANNA, { gameId: id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('speichert spielabhaengige Felder und lehnt unbekannte ab', async () => {
    const id = await spiel('VALORANT');

    await profile.speichereSpiel(ANNA, {
      gameId: id,
      platform: 'PC',
      fields: { rang: 'Diamond', rolle: 'Duelist' },
    });

    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.spiele?.[0]?.felder.map((feld) => feld.wert)).toEqual(['Diamond', 'Duelist']);

    await expect(profile.speichereSpiel(ANNA, { gameId: id, fields: { erfunden: 'x' } })).rejects.toThrow();
  });

  it('behaelt ein Spiel lesbar, das spaeter archiviert wird', async () => {
    const id = await spiel('CS2');
    await profile.speichereSpiel(ANNA, { gameId: id, fields: {} });
    await prisma.game.update({ where: { id }, data: { archivedAt: new Date() } });

    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.spiele?.[0]?.archiviert).toBe(true);
    expect(ansicht?.spiele?.[0]?.name).toBe('CS2');
  });

  it('ordnet die Spiele nach der gewaehlten Reihenfolge', async () => {
    const a = await spiel('Alpha');
    const b = await spiel('Beta');
    await profile.speichereSpiel(ANNA, { gameId: a });
    await profile.speichereSpiel(ANNA, { gameId: b });

    await profile.ordneSpiele(ANNA, [b, a]);
    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.spiele?.map((s) => s.name)).toEqual(['Beta', 'Alpha']);
  });

  it('ruehrt beim Ordnen kein fremdes Spielprofil an', async () => {
    const a = await spiel('Alpha');
    await profile.speichereSpiel(ANNA, { gameId: a });
    await profile.speichereSpiel(BEN, { gameId: a });

    const vorher = await prisma.memberGameProfile.findFirst({
      where: { profile: { discordId: BEN } },
    });
    await profile.ordneSpiele(ANNA, [a]);
    const nachher = await prisma.memberGameProfile.findFirst({
      where: { profile: { discordId: BEN } },
    });
    expect(nachher?.updatedAt.getTime()).toBe(vorher?.updatedAt.getTime());
  });

  it('entfernt ein Spiel und bleibt beim zweiten Versuch still', async () => {
    const a = await spiel('Alpha');
    await profile.speichereSpiel(ANNA, { gameId: a });
    await profile.entferneSpiel(ANNA, a);
    await expect(profile.entferneSpiel(ANNA, a)).resolves.toBeUndefined();
  });

  // --- Vitrine -------------------------------------------------------------

  it('ueberspringt einen Vitrinenplatz, dessen Verweis ins Leere geht', async () => {
    const a = await spiel('Alpha');
    await profile.speichereSpiel(ANNA, { gameId: a });
    await profile.speichereShowcase(ANNA, {
      plaetze: [
        { slot: 0, kind: 'game', refId: a },
        { slot: 1, kind: 'level', refId: null },
      ],
    });

    expect((await profile.ladeProfil(ANNA, ANNA))?.vitrine).toHaveLength(1);

    // Das Spiel faellt weg - der Platz verschwindet, ohne dass etwas bricht.
    await profile.entferneSpiel(ANNA, a);
    const nachher = await profile.ladeProfil(ANNA, ANNA);
    expect(nachher?.vitrine.map((karte) => karte.kind)).toEqual([]);
    // Beide gespeicherten Plaetze bleiben stehen - sie koennten wieder
    // gueltig werden. Uebersprungen wird beim Anzeigen, nicht geloescht.
    expect(await prisma.memberShowcase.count()).toBe(2);
  });

  it('nimmt keinen Verweis an, der einem anderen gehoert', async () => {
    const a = await spiel('Alpha');
    await profile.speichereSpiel(BEN, { gameId: a });

    await expect(
      profile.speichereShowcase(ANNA, { plaetze: [{ slot: 0, kind: 'game', refId: a }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lehnt eine manipulierte Vitrinenkennung ab', async () => {
    await expect(
      profile.speichereShowcase(ANNA, {
        plaetze: [{ slot: 0, kind: 'tournament', refId: 'fremde-kennung' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  // --- Socials -------------------------------------------------------------

  it('speichert Kennungen und zeigt sie nie als verifiziert', async () => {
    await profile.speichereSocials(ANNA, {
      eintraege: [{ platform: 'twitch', handle: 'swisshub' }],
    });

    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.socials?.[0]?.adresse).toBe('https://twitch.tv/swisshub');
    expect(ansicht?.socials?.[0]?.verifiziert).toBe(false);
    expect(await prisma.memberSocialLink.findFirst({})).toMatchObject({ verified: false });
  });

  it('ersetzt die Liste, statt sie zu ergaenzen', async () => {
    await profile.speichereSocials(ANNA, {
      eintraege: [
        { platform: 'twitch', handle: 'eins' },
        { platform: 'steam', handle: 'zwei' },
      ],
    });
    await profile.speichereSocials(ANNA, { eintraege: [{ platform: 'twitch', handle: 'eins' }] });

    expect(await prisma.memberSocialLink.count()).toBe(1);
  });

  it('laesst eine Kennung weg, die spaeter nicht mehr zum Muster passt', async () => {
    await profile.speichereSocials(ANNA, {
      eintraege: [{ platform: 'twitch', handle: 'swisshub' }],
    });
    // Direkt in der Datenbank veraendert - so wie es nach einer Migration
    // oder einem Eingriff aussehen koennte.
    await prisma.memberSocialLink.updateMany({
      data: { handle: 'https://boese.example.com' },
    });

    const ansicht = await profile.ladeProfil(ANNA, ANNA);
    expect(ansicht?.socials).toEqual([]);
  });

  // --- Mitglieder entdecken ------------------------------------------------

  it('sucht ueber den vollstaendigen Bestand, nicht ueber eine Seite', async () => {
    // 60 Mitglieder, die gesuchte Person ganz hinten im Alphabet.
    for (let i = 0; i < 60; i += 1) {
      await spiegle(`90000000000000${(100 + i).toString()}`, `mitglied${i}`);
    }
    await spiegle('900000000000000500', 'zuletzt');

    const seite = await profile.entdecke(profile.entdeckenSchema.parse({ suche: 'zuletzt' }));
    expect(seite.gesamt).toBe(1);
    expect(seite.karten[0]?.discordName).toBe('zuletzt');
  });

  it('teilt serverseitig in Seiten', async () => {
    for (let i = 0; i < 30; i += 1) {
      await spiegle(`90000000000000${(200 + i).toString()}`, `person${i}`);
    }

    const erste = await profile.entdecke(profile.entdeckenSchema.parse({}));
    const zweite = await profile.entdecke(profile.entdeckenSchema.parse({ seite: 2 }));

    expect(erste.karten).toHaveLength(profile.SEITENGROESSE);
    expect(zweite.karten.length).toBeGreaterThan(0);
    expect(erste.gesamt).toBe(32);
    // Keine Karte zweimal.
    const alle = [...erste.karten, ...zweite.karten].map((karte) => karte.discordId);
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('kombiniert Filter', async () => {
    const id = await spiel('Alpha');
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: null,
      bio: null,
      languages: ['fr'],
      platforms: ['PC'],
      playtimes: ['wochenende-abend'],
      comms: [],
      playStyle: 'COMPETITIVE',
      availability: 'LOOKING',
    });
    await profile.speichereSpiel(ANNA, { gameId: id });

    const treffer = await profile.entdecke(
      profile.entdeckenSchema.parse({
        sprache: 'fr',
        plattform: 'PC',
        spielart: 'COMPETITIVE',
        verfuegbarkeit: 'LOOKING',
        gameId: id,
      }),
    );
    expect(treffer.karten.map((karte) => karte.discordName)).toEqual(['anna']);

    const daneben = await profile.entdecke(profile.entdeckenSchema.parse({ sprache: 'it', plattform: 'PC' }));
    expect(daneben.gesamt).toBe(0);
  });

  it('findet Competitive-Spieler auch, wenn sie «Beides» angegeben haben', async () => {
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: null,
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });

    const treffer = await profile.entdecke(profile.entdeckenSchema.parse({ spielart: 'COMPETITIVE' }));
    expect(treffer.karten.map((karte) => karte.discordName)).toEqual(['anna']);
  });

  it('zeigt weder Bots noch Ausgetretene noch Abgemeldete', async () => {
    await spiegle('900000000000000041', 'botti', { isBot: true });
    await spiegle('900000000000000042', 'weg', { leftAt: new Date() });
    await profile.speicherePrivatsphaere(BEN, {
      visibilityProfile: 'MEMBERS',
      visibilityGames: 'MEMBERS',
      visibilitySocials: 'PRIVATE',
      visibilityCareer: 'MEMBERS',
      visibilityActivity: 'MEMBERS',
      discoverable: false,
    });

    const alle = await profile.entdecke(profile.entdeckenSchema.parse({}));
    expect(alle.karten.map((karte) => karte.discordName)).toEqual(['anna']);
  });

  it('nimmt ein privates Profil aus der Entdeckung - sonst verriete der Filter es', async () => {
    await profile.speichereAllgemein(BEN, {
      displayName: null,
      tagline: null,
      bio: null,
      languages: ['it'],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    await profile.speicherePrivatsphaere(BEN, {
      visibilityProfile: 'PRIVATE',
      visibilityGames: 'MEMBERS',
      visibilitySocials: 'PRIVATE',
      visibilityCareer: 'MEMBERS',
      visibilityActivity: 'MEMBERS',
      discoverable: true,
    });

    const treffer = await profile.entdecke(profile.entdeckenSchema.parse({ sprache: 'it' }));
    expect(treffer.gesamt).toBe(0);
  });

  it('zaehlt genauso, wie es auflistet', async () => {
    for (let i = 0; i < 5; i += 1) {
      await spiegle(`90000000000000${(300 + i).toString()}`, `such${i}`);
    }
    const seite = await profile.entdecke(profile.entdeckenSchema.parse({ suche: 'such' }));
    expect(seite.gesamt).toBe(seite.karten.length);
  });

  // --- Editor --------------------------------------------------------------

  it('bietet im Editor nur Spiele an, die noch nicht im Profil stehen', async () => {
    const a = await spiel('Alpha');
    await spiel('Beta');
    await profile.speichereSpiel(ANNA, { gameId: a });

    const daten = await profile.ladeEditor(ANNA);
    expect(daten.spiele.map((s) => s.name)).toEqual(['Alpha']);
    expect(daten.katalog.map((s) => s.name)).toEqual(['Beta']);
  });

  it('liefert den Editor auch fuer ein Profil, das es noch nicht gibt', async () => {
    const daten = await profile.ladeEditor(BEN);
    expect(daten.allgemein.playStyle).toBe('BOTH');
    expect(daten.privatsphaere.discoverable).toBe(true);
    expect(await prisma.memberProfile.count()).toBe(0);
  });
});
