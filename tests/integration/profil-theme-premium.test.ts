import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_theme_premium');

/**
 * Premium-Themes gegen eine echte Datenbank.
 *
 * ## Warum das nicht im Unit-Test geht
 *
 * Die Frage «darf diese Person ein Premium-Theme aktivieren» ist eine
 * Abfrage: gibt es ein offenes Abonnement, und gewaehrt sein Zustand
 * gerade Ansprueche? Ein Test, der das mit einem Mock beantwortet, prueft
 * seinen eigenen Mock.
 *
 * ## Der Ablauf, der hier durchgespielt wird
 *
 * Ohne Premium waehlen (abgelehnt), mit Premium waehlen (gespeichert),
 * Premium laeuft aus (Wahl bleibt, wirkt nicht), Premium kehrt zurueck
 * (dieselbe Wahl wirkt wieder). Das ist die ganze Zusage - und sie haengt
 * daran, dass beim Ablaufen **nichts geloescht** wird.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const MITGLIED = '100000000000000001';

const eingabe = (premiumTheme: string | null) => ({
  theme: 'swisshub',
  accent: 'rot',
  bannerPreset: null,
  premiumTheme,
});

async function gibPremium(status: 'ACTIVE' | 'CANCEL_AT_PERIOD_END' | 'EXPIRED' | 'CANCELLED') {
  const produkt = await prisma.premiumProduct.upsert({
    where: { slug: 'test-premium' },
    create: {
      slug: 'test-premium',
      name: 'Test Premium',
      description: 'Für den Test',
      priceMinor: 500,
      entitlements: ['PREMIUM_ROLE'],
    },
    update: {},
  });
  const user = await prisma.user.upsert({
    where: { discordId: MITGLIED },
    create: { discordId: MITGLIED, username: 'testerin' },
    update: {},
  });

  const offen = status === 'ACTIVE' || status === 'CANCEL_AT_PERIOD_END';
  await prisma.premiumSubscription.deleteMany({ where: { userId: user.id } });
  await prisma.premiumSubscription.create({
    data: {
      userId: user.id,
      discordId: MITGLIED,
      productId: produkt.id,
      status,
      // Der Schluessel ist der Riegel in der Datenbank: nur ein offenes
      // Abonnement je Person. Ein beendetes traegt ihn nicht mehr.
      activeUserKey: offen ? user.id : null,
    },
  });
}

describeWithDatabase('Premium-Themes', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.memberProfile.deleteMany({});
    await prisma.premiumSubscription.deleteMany({});

    /*
     * Ohne Eintrag im Discord-Spiegel gibt es kein Profil - `ladeProfil`
     * gibt dann `null` zurueck, und zwar zu Recht: ohne Spiegel gibt es
     * keinen Namen. Die Tests unten lesen die Ansicht, also braucht es ihn.
     */
    await prisma.discordMemberCache.upsert({
      where: { discordId: MITGLIED },
      create: {
        discordId: MITGLIED,
        username: 'testerin',
        displayName: 'Testerin',
        searchText: 'testerin',
        joinedAt: new Date('2024-01-01T00:00:00Z'),
      },
      update: {},
    });
  });

  it('lehnt ein Premium-Theme ohne Abonnement ab', async () => {
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('crimson'))).rejects.toThrow();
    expect(await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } })).toBeNull();
  });

  it('lässt das Standarddesign ohne Abonnement zu', async () => {
    await profile.speichereGestaltung(MITGLIED, eingabe(null));
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBeNull();
  });

  it('speichert ein Premium-Theme mit aktivem Abonnement', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('prestige'));
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('prestige');
  });

  it('gewährt die Wahl auch in der Kündigungsfrist', async () => {
    // Gekündigt ist bezahlt bis zum Periodenende - dieselbe Regel wie bei
    // der Discord-Rolle. Wer hier abweicht, nimmt jemandem etwas weg, das
    // er noch bezahlt hat.
    await gibPremium('CANCEL_AT_PERIOD_END');
    await profile.speichereGestaltung(MITGLIED, eingabe('nebula'));
    expect((await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } }))?.premiumTheme).toBe(
      'nebula',
    );
  });

  it('behält die Wahl, wenn das Abonnement endet - zeigt sie aber nicht mehr', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('cyber'));

    await gibPremium('EXPIRED');

    // Die Spalte bleibt gefüllt. Sie zu leeren hiesse, jemandem seine
    // Entscheidung stillschweigend zu nehmen.
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('cyber');

    const ansicht = await profile.ladeProfil(MITGLIED, MITGLIED);
    expect(ansicht?.gestaltung.theme, 'Das Premium-Theme wirkt ohne Abonnement weiter').toBe('classic');
    expect(ansicht?.gestaltung.kulisse).toBe('pt-classic');
  });

  it('lässt dieselbe Wahl nach der Rückkehr wieder wirken', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('matrix'));
    await gibPremium('EXPIRED');
    expect((await profile.ladeProfil(MITGLIED, MITGLIED))?.gestaltung.theme).toBe('classic');

    await gibPremium('ACTIVE');
    const zurueck = await profile.ladeProfil(MITGLIED, MITGLIED);
    expect(zurueck?.gestaltung.theme, 'Die alte Wahl kommt nicht zurück').toBe('matrix');
    expect(zurueck?.gestaltung.kulisse).toBe('pt-matrix');
  });

  it('lässt ein abgelaufenes Abonnement das Theme nicht erneut setzen', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('aurora'));
    await gibPremium('EXPIRED');

    // Dasselbe Theme noch einmal speichern ist kein Wechsel - das bleibt
    // erlaubt, sonst könnte jemand seine übrigen Designfelder nicht mehr
    // ändern. Ein *anderes* Premium-Theme dagegen schon.
    await profile.speichereGestaltung(MITGLIED, eingabe('aurora'));
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();

    expect((await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } }))?.premiumTheme).toBe(
      'aurora',
    );
  });

  it('erlaubt den Rückweg auf das Standarddesign jederzeit', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('crimson'));
    await gibPremium('EXPIRED');

    await profile.speichereGestaltung(MITGLIED, eingabe(null));
    expect((await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } }))?.premiumTheme).toBe(
      null,
    );
  });

  it('protokolliert den Wechsel, aber nicht jede Farbänderung', async () => {
    await gibPremium('ACTIVE');
    await profile.speichereGestaltung(MITGLIED, eingabe('crimson'));
    await profile.speichereGestaltung(MITGLIED, { ...eingabe('crimson'), accent: 'gletscher' });

    const zeilen = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(zeilen.map((zeile) => zeile.action)).toEqual(['PROFILE_THEME_CHANGED']);
    expect(zeilen[0]?.targetDiscordId).toBe(MITGLIED);
    expect(JSON.stringify(zeilen[0]?.metadata)).toContain('crimson');
  });

  it('nimmt einen erfundenen Schlüssel gar nicht erst an', async () => {
    const geprueft = profile.gestaltungSchema.safeParse(eingabe('gibt-es-nicht'));
    expect(geprueft.success).toBe(false);
  });
});
