import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_levelkarte_textfarbe');

/**
 * Die gespeicherte Textfarbe der eigenen Levelkarte.
 *
 * Die Regeln - was eine gueltige Farbe ist, wie sie normalisiert wird, wann
 * gewarnt wird - stehen in `tests/unit/levelkarte.test.ts`. Hier geht es um
 * das, was nur eine echte Datenbank zeigt: dass die Spalte additiv ist, dass
 * eine Karte ohne Farbe unveraendert weiterlaeuft, dass ein Profil auch dann
 * entsteht, wenn es noch keines gab, und dass das Zuruecksetzen wirklich
 * zuruecksetzt statt Weiss zu speichern.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const ANNA = '900000000000000011';
const BEN = '900000000000000012';

const actor = { discordId: ANNA, username: 'anna' };

/** Jemand, der die Berechtigung fuer die eigene Karte hat. */
const berechtigt = (discordId: string) => ({ discordId, can: () => true });
const unberechtigt = (discordId: string) => ({ discordId, can: () => false });

describeWithDatabase('Textfarbe der eigenen Levelkarte', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.xpTransaction.deleteMany();
    await prisma.levelProfile.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('legt ein Profil an, wenn es noch keines gibt', async () => {
    // Wer noch nie XP gesammelt hat, soll trotzdem eine Farbe waehlen koennen.
    expect(await prisma.levelProfile.findUnique({ where: { discordId: ANNA } })).toBeNull();

    await level.setCustomCardTextColor(berechtigt(ANNA), actor, '#ff9f1c');

    expect(await level.readCustomCardTextColor(ANNA)).toBe('#FF9F1C');
  });

  it('normalisiert beim Speichern', async () => {
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, ' f0a ');
    expect(await level.readCustomCardTextColor(ANNA)).toBe('#FF00AA');
  });

  it('weist zurück, was keine Farbe ist', async () => {
    await expect(level.setCustomCardTextColor(berechtigt(ANNA), actor, 'url(#x)')).rejects.toThrow();
    expect(await level.readCustomCardTextColor(ANNA)).toBeNull();
  });

  it('verlangt die Berechtigung', async () => {
    await expect(level.setCustomCardTextColor(unberechtigt(ANNA), actor, '#FF9F1C')).rejects.toThrow();
    expect(await level.readCustomCardTextColor(ANNA)).toBeNull();
  });

  it('setzt auf die Standardfarbe zurück statt Weiss zu speichern', async () => {
    /*
     * Der Unterschied ist nicht akademisch: «Weiss gewaehlt» und «nichts
     * gewaehlt» sehen auf der normalen Karte gleich aus, im Hoechstlevel
     * aber nicht - dort ist die Voreinstellung Gold.
     */
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, '#39FF14');
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, null);

    expect(await level.readCustomCardTextColor(ANNA)).toBeNull();
    const profil = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(profil.customCardTextColor).toBeNull();
  });

  it('schreibt jede Änderung ins Protokoll', async () => {
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, '#39FF14');
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, null);

    const eintraege = await prisma.auditLog.findMany({
      where: { action: 'LEVEL_CUSTOM_CARD_CHANGED' },
      orderBy: { sequence: 'asc' },
    });
    expect(eintraege).toHaveLength(2);
    expect(eintraege[0]?.metadata).toMatchObject({ textfarbe: '#39FF14' });
    expect(eintraege[1]?.metadata).toMatchObject({ zurueckgesetzt: true });
  });

  it('wirkt nur auf die eigene Karte', async () => {
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, '#39FF14');
    expect(await level.readCustomCardTextColor(BEN)).toBeNull();
  });

  it('bleibt beim Entfernen des Hintergrundbilds bestehen', async () => {
    /*
     * Farbe und Bild sind zwei Einstellungen. Wer sein Bild wieder entfernt,
     * soll nicht ueberrascht feststellen, dass auch seine Schriftfarbe weg
     * ist.
     */
    await prisma.levelProfile.upsert({
      where: { discordId: ANNA },
      create: { discordId: ANNA, customCardPath: 'usercard-x.png' },
      update: { customCardPath: 'usercard-x.png' },
    });
    await level.setCustomCardTextColor(berechtigt(ANNA), actor, '#39FF14');

    await level.clearCustomCard(berechtigt(ANNA), actor, ANNA);

    expect(await level.readCustomCardTextColor(ANNA)).toBe('#39FF14');
    const profil = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(profil.customCardPath).toBeNull();
  });

  it('lässt eine Karte ohne Farbe unverändert', async () => {
    /*
     * Der Zustand nach der Migration: jede bestehende Karte hat NULL in der
     * neuen Spalte. Sie muss danach genau so aussehen wie davor.
     */
    await prisma.levelProfile.create({
      data: { discordId: BEN, xp: 12_600, customCardPath: 'usercard-alt.png' },
    });

    expect(await level.readCustomCardTextColor(BEN)).toBeNull();
    const svg = level.renderLevelCardSvg({
      displayName: 'Ben',
      xp: 12_600,
      rank: 3,
      textColor: await level.readCustomCardTextColor(BEN),
    });
    expect(svg).toContain(`fill="${level.STANDARD_TEXTFARBE}"`);
  });

  it('räumt eine ungültige Altlast beim Lesen weg', async () => {
    // Direkt in die Spalte geschrieben - so, wie es nie passieren soll. Was
    // hier herauskommt, geht in ein SVG-Attribut.
    await prisma.levelProfile.create({
      data: { discordId: BEN, customCardTextColor: 'url(#boese)' },
    });

    expect(await level.readCustomCardTextColor(BEN)).toBeNull();
  });
});
