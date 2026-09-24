import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_auszeichnungen_verleihen');

/**
 * Verleihen, entziehen - und was sich nicht verleihen laesst.
 *
 * ## Die Trennung, die alles traegt
 *
 * Die meisten Auszeichnungen werden gerechnet: aus Turnieren, Clip-Siegen,
 * dem Level. Das ist Absicht - ein Turniersieg entsteht, indem jemand ein
 * Turnier gewinnt, und nicht, indem ein Admin einen Haken setzt.
 *
 * Verleihbar sind nur die, fuer die es keine Zahl gibt: «OG Member»,
 * «Community Legend». Seit diese Liste verwaltbar ist, sitzt der Riegel
 * eine Stufe frueher: `erstelleAuszeichnungsArt` weist jeden Schluessel ab,
 * den die gerechneten schon kennen. Der wichtigste Test hier prueft genau
 * das - koennte jemand eine Art mit dem Schluessel «turnier-sieg» anlegen,
 * liesse sich danach ein Sieg vergeben, den es nie gab.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const MITGLIED = '100000000000000001';
const ADMIN = { discordId: '100000000000000009', username: 'admin' };
/** Derselbe Akteur, aber mit der Berechtigung fuer die Verwaltung. */
const VERWALTER = { ...ADMIN, can: (): boolean => true };

describeWithDatabase('Auszeichnungen verleihen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberAward.deleteMany({});
    await prisma.awardDefinition.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await profile.legeErstausstattungAn();
    await prisma.auditLog.deleteMany({});
  });

  it('haelt verliehene und gerechnete Auszeichnungen strikt getrennt', async () => {
    const gerechnet = new Set(profile.bewerte(grundlage()).map((eintrag) => eintrag.key));
    for (const art of await profile.listeAuszeichnungsArten()) {
      expect(
        gerechnet.has(art.key),
        `«${art.key}» ist verleihbar UND wird gerechnet - damit liesse sich ein Erfolg von Hand setzen.`,
      ).toBe(false);
    }
  });

  it('laesst keine Art mit dem Schluessel einer gerechneten anlegen', async () => {
    // «Turniersieg» ergibt den Schluessel `turniersieg` - den gibt es nicht.
    // Gefaehrlich ist der Name, der genau trifft.
    await expect(
      profile.erstelleAuszeichnungsArt(
        {
          label: 'Turnier sieg',
          beschreibung: 'Ein Turnier gewonnen.',
          symbol: 'Trophy',
          stufe: 'gold',
          aktiv: true,
        },
        VERWALTER,
      ),
    ).rejects.toThrow();
    expect(await prisma.awardDefinition.count({ where: { key: 'turnier-sieg' } })).toBe(0);
  });

  it('verleiht und zeigt die Auszeichnung danach am Profil', async () => {
    const neu = await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'og-member' });
    expect(neu).toBe(true);
    expect(await profile.verliehenAn(MITGLIED)).toEqual(['og-member']);

    const arten = await profile.auszeichnungsArtenNach(['og-member']);
    const angezeigt = profile.ausVerleihungen(['og-member'], arten);
    expect(angezeigt[0]?.label).toBe('OG Member');
    expect(angezeigt[0]?.erreicht).toBe(true);
    expect(angezeigt[0]?.verliehen).toBe(true);
  });

  it('lehnt eine gerechnete Auszeichnung ab', async () => {
    // «Turniersieger» wird aus echten Turnieren gerechnet. Von Hand gibt es
    // sie nicht - und zwar nicht, weil eine Pruefung sie abfaengt, sondern
    // weil der Schluessel in keiner Definition steht.
    await expect(profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'turnier-sieg' })).rejects.toThrow();
    expect(await prisma.memberAward.count()).toBe(0);
  });

  it('lehnt einen erfundenen Schluessel ab', async () => {
    await expect(profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'gibt-es-nicht' })).rejects.toThrow();
    expect(await prisma.memberAward.count()).toBe(0);
  });

  it('verleiht dieselbe Auszeichnung nicht zweimal', async () => {
    expect(await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'helfer' })).toBe(true);
    expect(await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'helfer' })).toBe(false);
    expect(await prisma.memberAward.count()).toBe(1);
  });

  it('haelt auch bei gleichzeitigen Klicks genau eine Zeile', async () => {
    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, () => profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'bug-jaeger' })),
    );
    expect(ergebnisse.filter(Boolean)).toHaveLength(1);
    expect(await prisma.memberAward.count()).toBe(1);
  });

  it('entzieht wieder - und beim zweiten Mal ohne Fehler', async () => {
    await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'event-held' });
    expect(await profile.entziehe(ADMIN, MITGLIED, 'event-held')).toBe(true);
    expect(await profile.entziehe(ADMIN, MITGLIED, 'event-held')).toBe(false);
    expect(await profile.verliehenAn(MITGLIED)).toEqual([]);
  });

  it('protokolliert Verleihen und Entziehen mit Akteur und Ziel', async () => {
    await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'og-member', notiz: 'Seit Tag eins.' });
    await profile.entziehe(ADMIN, MITGLIED, 'og-member');

    const zeilen = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(zeilen.map((zeile) => zeile.action)).toEqual(['PROFILE_AWARD_GRANTED', 'PROFILE_AWARD_REVOKED']);
    expect(zeilen[0]?.actorDiscordId).toBe(ADMIN.discordId);
    expect(zeilen[0]?.targetDiscordId).toBe(MITGLIED);
    expect(zeilen[0]?.targetLabel).toBe('OG Member');
    expect(JSON.stringify(zeilen[0]?.metadata)).toContain('Seit Tag eins.');
  });

  it('protokolliert nichts beim blossen Nachschlagen', async () => {
    await profile.verliehenAn(MITGLIED);
    await profile.verleihungenVon(MITGLIED);
    // Lesen ist kein Vorgang - sonst stuende das Protokoll voller Zeilen,
    // die niemanden interessieren.
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('vergibt eine archivierte Art nicht mehr - laesst sie aber entziehen', async () => {
    await profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'helfer' });

    const art = (await profile.listeAuszeichnungsArten()).find((eintrag) => eintrag.key === 'helfer')!;
    expect(await profile.archiviereAuszeichnungsArt(art.id, VERWALTER)).toBe(true);

    // Wer sie hat, behaelt sie - und sie traegt weiterhin ihren Namen.
    expect(await profile.verliehenAn(MITGLIED)).toEqual(['helfer']);
    const arten = await profile.auszeichnungsArtenNach(['helfer']);
    expect(profile.ausVerleihungen(['helfer'], arten)[0]?.label).toBe('Gute Seele');

    // Neu vergeben geht nicht mehr.
    await prisma.memberAward.deleteMany({});
    await expect(profile.verleihe(ADMIN, { discordId: MITGLIED, key: 'helfer' })).rejects.toThrow();

    // Entziehen dagegen schon - sonst bliebe eine Auszeichnung fuer immer.
    await prisma.memberAward.create({
      data: { discordId: MITGLIED, key: 'helfer', grantedByDiscordId: ADMIN.discordId },
    });
    expect(await profile.entziehe(ADMIN, MITGLIED, 'helfer')).toBe(true);
  });
});

/** Eine Grundlage, aus der sich jede gerechnete Auszeichnung ergeben koennte. */
function grundlage(): Parameters<typeof profile.bewerte>[0] {
  return {
    beitrittAm: new Date('2015-01-01T00:00:00Z'),
    level: 99,
    hoechstlevel: true,
    turniere: { teilgenommen: 50, podeste: 20, siege: 10 },
    clips: { eingereicht: 50, treppchen: 20, siege: 10, erhalteneStimmen: 500 },
    events: 50,
    spielprofile: 10,
    boostet: true,
    jetzt: new Date('2026-01-01T00:00:00Z'),
  };
}
