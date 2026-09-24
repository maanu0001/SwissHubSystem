import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_auszeichnungs_arten');

/**
 * Die verleihbaren Auszeichnungen verwalten.
 *
 * Was hier geprueft wird, ist im Kern eine Frage: kann jemand ueber diese
 * Verwaltung etwas anrichten, das er ueber das Verleihen nicht koennte?
 *
 *   - Eine gerechnete Auszeichnung von Hand erfinden - nein, der Schluessel
 *     wird abgewiesen.
 *   - Einem Mitglied stillschweigend eine Auszeichnung wegnehmen - nein,
 *     `entferneAuszeichnungsArt` verweigert das, solange sie jemand hat.
 *   - Ohne Berechtigung etwas aendern - nein, der Dienst prueft selbst.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const VERWALTER = { discordId: '100000000000000009', username: 'admin', can: (): boolean => true };
const OHNE_RECHT = { discordId: '100000000000000002', username: 'gast', can: (): boolean => false };

const EINGABE = {
  label: 'Turnierhelfer',
  beschreibung: 'Hat ein Turnier mit aufgebaut, ohne mitzuspielen.',
  symbol: 'HeartHandshake',
  stufe: 'silber',
  aktiv: true,
} as const;

describeWithDatabase('Auszeichnungen verwalten', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberAward.deleteMany({});
    await prisma.awardDefinition.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  it('legt eine an und bildet den Schluessel aus dem Namen', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    expect(art.key).toBe('turnierhelfer');
    expect(art.aktiv).toBe(true);
    expect(art.archiviert).toBe(false);

    expect((await profile.listeAuszeichnungsArten()).map((eintrag) => eintrag.key)).toEqual([
      'turnierhelfer',
    ]);
  });

  it('macht aus Umlauten und Leerzeichen einen brauchbaren Schluessel', () => {
    expect(profile.schluesselAus('Grösster Fan')).toBe('groesster-fan');
    expect(profile.schluesselAus('  Über-Flieger!  ')).toBe('ueber-flieger');
  });

  it('laesst denselben Schluessel kein zweites Mal zu', async () => {
    await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await expect(profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER)).rejects.toThrow();
    expect(await prisma.awardDefinition.count()).toBe(1);
  });

  it('weist ein Symbol ab, das die Oberflaeche nicht zeichnen kann', async () => {
    await expect(
      profile.erstelleAuszeichnungsArt({ ...EINGABE, symbol: 'GibtEsNicht' }, VERWALTER),
    ).rejects.toThrow();
    expect(await prisma.awardDefinition.count()).toBe(0);
  });

  it('benennt um, ohne den Schluessel zu verschieben', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await prisma.memberAward.create({
      data: { discordId: '100000000000000001', key: art.key, grantedByDiscordId: VERWALTER.discordId },
    });

    const geaendert = await profile.bearbeiteAuszeichnungsArt(
      art.id,
      { ...EINGABE, label: 'Aufbauhelfer', stufe: 'gold' },
      VERWALTER,
    );

    // Der Schluessel bleibt - sonst haette die Verleihung oben ihren Namen
    // verloren.
    expect(geaendert.key).toBe('turnierhelfer');
    expect(geaendert.label).toBe('Aufbauhelfer');
    expect(geaendert.stufe).toBe('gold');
    expect(await profile.verliehenAn('100000000000000001')).toEqual(['turnierhelfer']);
  });

  it('archiviert, holt zurueck - und beides ein zweites Mal folgenlos', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);

    expect(await profile.archiviereAuszeichnungsArt(art.id, VERWALTER)).toBe(true);
    expect(await profile.archiviereAuszeichnungsArt(art.id, VERWALTER)).toBe(false);
    expect(await profile.listeAuszeichnungsArten()).toEqual([]);

    expect(await profile.holeAuszeichnungsArtZurueck(art.id, VERWALTER)).toBe(true);
    expect(await profile.holeAuszeichnungsArtZurueck(art.id, VERWALTER)).toBe(false);

    // Zurueckgeholt heisst nicht «wieder im Angebot»: das Archivieren hat
    // sie abgeschaltet, und eingeschaltet wird sie bewusst.
    const zurueck = await profile.listeAuszeichnungsArten({ mitAbgeschalteten: true });
    expect(zurueck[0]?.aktiv).toBe(false);
    expect(zurueck[0]?.archiviert).toBe(false);
  });

  it('entfernt eine, die niemand hat', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await profile.entferneAuszeichnungsArt(art.id, VERWALTER);
    expect(await prisma.awardDefinition.count()).toBe(0);
  });

  it('entfernt keine, die jemand hat - und sagt, wie viele es sind', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await prisma.memberAward.createMany({
      data: [
        { discordId: '100000000000000001', key: art.key, grantedByDiscordId: VERWALTER.discordId },
        { discordId: '100000000000000003', key: art.key, grantedByDiscordId: VERWALTER.discordId },
      ],
    });

    await expect(profile.entferneAuszeichnungsArt(art.id, VERWALTER)).rejects.toThrow(/2 Mitglieder/u);
    expect(await prisma.awardDefinition.count()).toBe(1);
    expect(await prisma.memberAward.count()).toBe(2);
  });

  it('laesst ohne Berechtigung nichts zu', async () => {
    await expect(profile.erstelleAuszeichnungsArt({ ...EINGABE }, OHNE_RECHT)).rejects.toThrow();

    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await expect(
      profile.bearbeiteAuszeichnungsArt(art.id, { ...EINGABE, label: 'Anders' }, OHNE_RECHT),
    ).rejects.toThrow();
    await expect(profile.archiviereAuszeichnungsArt(art.id, OHNE_RECHT)).rejects.toThrow();
    await expect(profile.holeAuszeichnungsArtZurueck(art.id, OHNE_RECHT)).rejects.toThrow();
    await expect(profile.entferneAuszeichnungsArt(art.id, OHNE_RECHT)).rejects.toThrow();

    expect(await prisma.awardDefinition.count()).toBe(1);
    expect((await prisma.awardDefinition.findMany())[0]?.label).toBe('Turnierhelfer');
  });

  it('protokolliert jede Aenderung an der Liste', async () => {
    const art = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    await profile.bearbeiteAuszeichnungsArt(art.id, { ...EINGABE, label: 'Aufbauhelfer' }, VERWALTER);
    await profile.archiviereAuszeichnungsArt(art.id, VERWALTER);
    await profile.holeAuszeichnungsArtZurueck(art.id, VERWALTER);
    await profile.entferneAuszeichnungsArt(art.id, VERWALTER);

    const zeilen = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(zeilen.map((zeile) => zeile.action)).toEqual([
      'PROFILE_AWARD_TYPE_CREATED',
      'PROFILE_AWARD_TYPE_UPDATED',
      'PROFILE_AWARD_TYPE_ARCHIVED',
      'PROFILE_AWARD_TYPE_RESTORED',
      'PROFILE_AWARD_TYPE_DELETED',
    ]);
    expect(JSON.stringify(zeilen[1]?.metadata)).toContain('label');
  });

  it('zaehlt die Verleihungen je Art in einem Zug', async () => {
    const a = await profile.erstelleAuszeichnungsArt({ ...EINGABE }, VERWALTER);
    const b = await profile.erstelleAuszeichnungsArt({ ...EINGABE, label: 'Nachteule' }, VERWALTER);
    await prisma.memberAward.createMany({
      data: [
        { discordId: '100000000000000001', key: a.key, grantedByDiscordId: VERWALTER.discordId },
        { discordId: '100000000000000003', key: a.key, grantedByDiscordId: VERWALTER.discordId },
      ],
    });

    const mitZahlen = await profile.listeAuszeichnungsArtenMitZahlen();
    expect(mitZahlen.find((art) => art.key === a.key)?.verliehen).toBe(2);
    expect(mitZahlen.find((art) => art.key === b.key)?.verliehen).toBe(0);
  });

  it('legt die Erstausstattung nur in eine leere Tabelle', async () => {
    expect(await profile.legeErstausstattungAn()).toBe(profile.ERSTAUSSTATTUNG.length);
    expect(await profile.legeErstausstattungAn()).toBe(0);

    // Eine entfernte Art darf nicht beim naechsten Start wieder auftauchen.
    const art = (await profile.listeAuszeichnungsArten())[0]!;
    await profile.entferneAuszeichnungsArt(art.id, VERWALTER);
    expect(await profile.legeErstausstattungAn()).toBe(0);
    expect(await prisma.awardDefinition.count()).toBe(profile.ERSTAUSSTATTUNG.length - 1);
  });
});
