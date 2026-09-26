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
const { level: levelModul, profile } = await import('@swisshub/modules');
const { xpForLevel } = levelModul;
/*
 * Die Rollenkonfiguration haelt einen kurzen Zwischenspeicher (15 Sekunden).
 * Produktiv verwirft ihn die Einstellungsseite bei jeder Aenderung; im Test
 * tut das dieser Aufruf. Ohne ihn pruefte der Test die Konfiguration von
 * vorhin - und waere damit wertlos.
 */
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

const MITGLIED = '100000000000000001';
/** Die Rolle, an der im Berechtigungstest die Theme-Freigabe haengt. */
const TEAM_ROLLE = '900000000000000777';

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

/**
 * Die Theme-Berechtigung an eine Rolle haengen - und dem Mitglied die Rolle.
 *
 * Derselbe Weg wie produktiv: ein Eintrag in `RolePermission` und die Rolle
 * im Discord-Spiegel. Kein Mock der Berechtigungspruefung - sonst pruefte
 * der Test seinen eigenen Mock statt der Engine.
 */
/**
 * Ein Level setzen - ueber XP, nicht ueber ein Levelfeld.
 *
 * `LevelProfile` speichert XP; das Level entsteht aus der Kurve. Eine
 * Testhilfe, die ein Level direkt schriebe, pruefte eine Groesse, die es in
 * der Datenbank nicht gibt.
 */
async function setzeLevel(level: number): Promise<void> {
  await prisma.levelProfile.upsert({
    where: { discordId: MITGLIED },
    create: { discordId: MITGLIED, xp: xpForLevel(level) },
    update: { xp: xpForLevel(level) },
  });
}

async function gibThemeBerechtigung(): Promise<void> {
  await prisma.managedRole.upsert({
    where: { discordRoleId: TEAM_ROLLE },
    create: { discordRoleId: TEAM_ROLLE, label: 'Team' },
    update: {},
  });
  await prisma.rolePermission.create({
    data: {
      discordRoleId: TEAM_ROLLE,
      permission: 'members.profile.themes.premium',
      effect: 'ALLOW',
    },
  });
  await prisma.discordMemberCache.update({
    where: { discordId: MITGLIED },
    data: { roleIds: [TEAM_ROLLE] },
  });
  invalidateRoleConfiguration();
}

describeWithDatabase('Premium-Themes', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.memberProfile.deleteMany({});
    await prisma.premiumSubscription.deleteMany({});
    await prisma.rolePermission.deleteMany({});
    await prisma.managedRole.deleteMany({});
    await prisma.levelProfile.deleteMany({});
    invalidateRoleConfiguration();

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
    await profile.speichereGestaltung(MITGLIED, eingabe('aurora'));
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('aurora');
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
    // Ein ANDERES Premium-Design ist ein Wechsel - und der wird abgelehnt.
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('crimson'))).rejects.toThrow();

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

  // --- Die Berechtigung fuer Admins und Moderatoren ------------------------

  it('laesst ein Premium-Design auch ohne Abonnement zu, wenn die Berechtigung erteilt ist', async () => {
    /*
     * Die zentrale Regel lautet «aktives Premium ODER Berechtigung».
     * Hier ist das zweite Bein dran - und zwar ueber die echte
     * Berechtigungs-Engine, nicht ueber eine Ausnahme fuer einen
     * Rollennamen. Rollennamen aendern sich; Berechtigungen nicht.
     */
    await gibThemeBerechtigung();
    await profile.speichereGestaltung(MITGLIED, eingabe('nebula'));

    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('nebula');

    const ansicht = await profile.ladeProfil(MITGLIED, 'jemand-anderes');
    expect(ansicht?.gestaltung.theme).toBe('nebula');
  });

  it('zeigt die Herkunft des Rechts - Abonnement vor Berechtigung', async () => {
    expect(await profile.themeZugang(MITGLIED)).toBe('keiner');

    await gibThemeBerechtigung();
    expect(await profile.themeZugang(MITGLIED)).toBe('berechtigung');

    // Wer beides hat, soll «premium» lesen: er hat dafuer bezahlt.
    await gibPremium('ACTIVE');
    expect(await profile.themeZugang(MITGLIED)).toBe('premium');
  });

  it('oeffnet dem Berechtigten die Galerie im Editor', async () => {
    await gibThemeBerechtigung();
    const editor = await profile.ladeEditor(MITGLIED);
    expect(editor.gestaltung.darfPremium).toBe(true);
  });

  it('faellt auf das Standarddesign zurueck, wenn die Berechtigung entzogen wird', async () => {
    await gibThemeBerechtigung();
    await profile.speichereGestaltung(MITGLIED, eingabe('matrix'));
    expect((await profile.ladeProfil(MITGLIED, 'wer-auch-immer'))?.gestaltung.theme).toBe('matrix');

    // Die Rolle verliert die Berechtigung.
    await prisma.rolePermission.deleteMany({});
    invalidateRoleConfiguration();

    const ansicht = await profile.ladeProfil(MITGLIED, 'wer-auch-immer');
    expect(ansicht?.gestaltung.theme).toBe('classic');
    // Die Wahl bleibt gespeichert - genau wie beim Ablauf eines Abonnements.
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('matrix');
  });

  it('gibt einem Mitglied ohne diese Berechtigung keine Premium-Designs', async () => {
    /*
     * Eine andere Berechtigung derselben Rolle darf nicht aus Versehen
     * mitziehen - geprueft wird genau `members.profile.themes.premium`.
     */
    await prisma.managedRole.upsert({
      where: { discordRoleId: TEAM_ROLLE },
      create: { discordRoleId: TEAM_ROLLE, label: 'Team' },
      update: {},
    });
    await prisma.rolePermission.create({
      data: { discordRoleId: TEAM_ROLLE, permission: 'members.view', effect: 'ALLOW' },
    });
    await prisma.discordMemberCache.update({
      where: { discordId: MITGLIED },
      data: { roleIds: [TEAM_ROLLE] },
    });
    invalidateRoleConfiguration();

    expect(await profile.themeZugang(MITGLIED)).toBe('keiner');
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('cyber'))).rejects.toThrow();
  });

  it('gibt mit der Theme-Berechtigung keine weiteren Premium-Vorteile', async () => {
    /*
     * Die Abgrenzung, um die es geht: die Berechtigung oeffnet die Designs
     * und sonst nichts. Der Premium-Anspruch selbst - der, an dem die
     * Discord-Rolle und alles Weitere haengt - bleibt unberuehrt.
     */
    const { premium } = await import('@swisshub/modules');
    await gibThemeBerechtigung();

    expect(await premium.hatAnspruch(MITGLIED, 'PREMIUM_ROLE')).toBe(false);
    expect((await premium.aktiveAnsprueche(MITGLIED)).size).toBe(0);
  });

  // --- Prestige: erspielt, nicht gekauft ----------------------------------

  /**
   * Die acht Faelle aus der Anforderung, gegen die echte Datenbank.
   *
   * Prestige ist das einzige Design, das an einer erspielten Groesse haengt.
   * Genau deshalb sind hier die Umgehungsversuche wichtiger als der
   * Normalfall: ein Abonnement, eine Adminrolle und eine Moderationsrolle
   * duerfen nichts bewirken, und ein manipulierter Request schon gar nichts.
   */

  it('Prestige: Level 30 ist gesperrt', async () => {
    await setzeLevel(30);
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();
    expect(await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } })).toBeNull();
  });

  it('Prestige: Level 31 ist freigeschaltet', async () => {
    await setzeLevel(31);
    await profile.speichereGestaltung(MITGLIED, eingabe('prestige'));
    const zeile = await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } });
    expect(zeile?.premiumTheme).toBe('prestige');
  });

  it('Prestige: Premium ohne Level bleibt gesperrt', async () => {
    // Der wichtigste Fall. Bezahlen hilft hier nicht.
    await gibPremium('ACTIVE');
    await setzeLevel(30);
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();
  });

  it('Prestige: die allgemeine Theme-Berechtigung umgeht die Voraussetzung nicht', async () => {
    /*
     * `members.profile.themes.premium` oeffnet alle Premium-Designs - und
     * genau das ist der Grund, weshalb Prestige kein Premium-Design ist.
     * Admins und Moderatoren haengen an dieser Berechtigung.
     */
    await gibThemeBerechtigung();
    await setzeLevel(30);
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();

    // Gegenprobe: dieselbe Berechtigung oeffnet ein echtes Premium-Design.
    await profile.speichereGestaltung(MITGLIED, eingabe('aurora'));
    expect((await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } }))?.premiumTheme).toBe(
      'aurora',
    );
  });

  it('Prestige: Premium UND Berechtigung zusammen reichen nicht', async () => {
    await gibPremium('ACTIVE');
    await gibThemeBerechtigung();
    await setzeLevel(30);
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();
  });

  it('Prestige: ohne Levelprofil gilt Level 0', async () => {
    // Kein Eintrag in `LevelProfile` - wer nie XP gesammelt hat, hat kein
    // Level, und `0` ist die ehrliche Antwort darauf.
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toThrow();
  });

  it('Prestige: verlorenes Level nimmt die Wirkung, behaelt aber die Wahl', async () => {
    await setzeLevel(35);
    await profile.speichereGestaltung(MITGLIED, eingabe('prestige'));

    // XP-Verfall unter die Grenze.
    await setzeLevel(29);
    const ansicht = await profile.ladeProfil(MITGLIED, MITGLIED);
    expect(ansicht?.gestaltung.theme).toBe('classic');

    // Die Wahl steht weiterhin in der Datenbank.
    expect((await prisma.memberProfile.findUnique({ where: { discordId: MITGLIED } }))?.premiumTheme).toBe(
      'prestige',
    );
  });

  it('Prestige: wiedererlangtes Level laesst dieselbe Wahl wieder wirken', async () => {
    await setzeLevel(35);
    await profile.speichereGestaltung(MITGLIED, eingabe('prestige'));
    await setzeLevel(29);
    expect((await profile.ladeProfil(MITGLIED, MITGLIED))?.gestaltung.theme).toBe('classic');

    await setzeLevel(31);
    expect((await profile.ladeProfil(MITGLIED, MITGLIED))?.gestaltung.theme).toBe('prestige');
  });

  it('Prestige: die Fehlermeldung nennt das Level, nicht ein Abonnement', async () => {
    /*
     * «Es laesst sich mit einem aktiven Premium auswaehlen» waere hier eine
     * Falschauskunft - wer auf Level 12 steht, soll nicht nach einem
     * Abonnement suchen, das nichts aendert.
     */
    await setzeLevel(12);
    // Geprueft wird die Meldung fuer die Person, nicht die interne Notiz.
    await expect(profile.speichereGestaltung(MITGLIED, eingabe('prestige'))).rejects.toMatchObject({
      userMessage: expect.stringContaining('Level 31'),
    });
  });
});
