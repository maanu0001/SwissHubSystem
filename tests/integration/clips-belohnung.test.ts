import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_clips_belohnung');

/**
 * Der Gewinner bekommt genau einmal etwas.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Die ganze Vorkehrung ist eine Eindeutigkeitsbedingung auf
 * `ClipCompetitionReward.competitionId`. Gegen eine Nachbildung getestet
 * bestaetigte dieser Test, dass die Nachbildung tut, was man ihr beigebracht
 * hat - und ueber die Datenbank sagte er nichts. Die beiden
 * Gleichzeitigkeitsfaelle unten laufen deshalb mit echtem `Promise.all`.
 *
 * ## Was hier schiefgehen kann
 *
 * - Der Abschluss laeuft zweimal: der Genesungszweig in `finalisiere` gibt
 *   eine steckengebliebene Runde nach fuenf Minuten wieder frei.
 * - Zwei Durchgaenge laufen gleichzeitig - dann lesen beide «noch keine
 *   Belohnung», bevor einer schreibt.
 * - Jemand hat bereits Premium: dann darf keine zweite Woche entstehen.
 */
const { prisma } = await import('@swisshub/database');
const { clips, premium } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const GEWINNER = '100000000000000001';

async function benutzerAnlegen(discordId: string): Promise<string> {
  const benutzer = await prisma.user.create({
    data: { discordId, username: `nutzer-${discordId.slice(-2)}`, appRole: 'USER' },
  });
  return benutzer.id;
}

async function produktAnlegen(): Promise<void> {
  await prisma.premiumProduct.create({
    data: {
      slug: 'premium',
      name: 'SwissHub Premium',
      description: 'Test',
      priceMinor: 500,
      currency: 'CHF',
      active: true,
      entitlements: [],
      features: [],
    },
  });
}

async function runde(nummer = 39): Promise<string> {
  const eintrag = await prisma.clipCompetition.create({
    data: {
      guildId: GUILD,
      key: `2026-W${nummer}`,
      number: nummer,
      status: 'COMPLETED',
      submissionStartsAt: new Date('2026-01-05T00:00:00Z'),
      submissionEndsAt: new Date('2026-01-09T19:00:00Z'),
      votingStartsAt: new Date('2026-01-09T19:00:00Z'),
      votingEndsAt: new Date('2026-01-11T19:00:00Z'),
    },
  });
  return eintrag.id;
}

const EINSTELLUNGEN = { winnerRewardXp: 1000 };

describeWithDatabase('Belohnung des Clip-Gewinners', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.clipCompetitionReward.deleteMany({});
    await prisma.clipCompetition.deleteMany({});
    await prisma.xpTransaction.deleteMany({});
    await prisma.levelProfile.deleteMany({});
    await prisma.premiumSubscription.deleteMany({});
    await prisma.premiumProduct.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('gibt einem Gewinner ohne Premium sieben Tage Premium', async () => {
    await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const competitionId = await runde();
    const jetzt = new Date('2026-01-12T12:00:00Z');

    const ergebnis = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
      jetzt,
    });

    expect(ergebnis.art).toBe('PREMIUM');
    expect(ergebnis.schonVergeben).toBe(false);

    const abo = await prisma.premiumSubscription.findFirstOrThrow({ where: { discordId: GEWINNER } });
    expect(abo.status).toBe('ACTIVE');
    expect(abo.provider).toBe('clip-of-the-week');
    // Genau sieben Tage - nicht sechs, nicht acht.
    expect(abo.currentPeriodEnd?.getTime()).toBe(jetzt.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Keine XP nebenher.
    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('laeuft nach sieben Tagen ueber den bestehenden Ablaufpfad ab', async () => {
    await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const competitionId = await runde();
    const jetzt = new Date('2026-01-12T12:00:00Z');

    await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
      jetzt,
    });

    // Am sechsten Tag laeuft es noch.
    const frueh = await premium.findExpiredSubscriptions(new Date('2026-01-18T12:00:00Z'));
    expect(frueh).toHaveLength(0);

    // Am achten ist es faellig - ohne dass die Belohnung einen eigenen
    // Ablaufpfad mitgebracht haette.
    const spaet = await premium.findExpiredSubscriptions(new Date('2026-01-20T12:00:00Z'));
    expect(spaet).toHaveLength(1);
  });

  it('gibt XP statt einer zweiten Woche, wenn Premium bereits laeuft', async () => {
    const userId = await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const produkt = await prisma.premiumProduct.findFirstOrThrow();
    await prisma.premiumSubscription.create({
      data: {
        userId,
        discordId: GEWINNER,
        productId: produkt.id,
        status: 'ACTIVE',
        activeUserKey: userId,
        currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      },
    });
    const competitionId = await runde();

    const ergebnis = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
    });

    expect(ergebnis.art).toBe('XP');
    expect(ergebnis.xp).toBe(1000);

    // Genau ein Abonnement - keine zweite Woche danebengelegt.
    expect(await prisma.premiumSubscription.count()).toBe(1);

    // Die XP stehen im zentralen Journal, mit nachvollziehbarem Grund.
    const buchung = await prisma.xpTransaction.findFirstOrThrow({ where: { discordId: GEWINNER } });
    expect(buchung.delta).toBe(1000);
    expect(buchung.reason).toBe('Clip der Woche gewonnen');
    expect(buchung.idempotencyKey).toBe(`clip-winner:${competitionId}`);
  });

  it('nimmt die eingestellte XP-Menge und nicht eine feste Zahl', async () => {
    const userId = await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const produkt = await prisma.premiumProduct.findFirstOrThrow();
    await prisma.premiumSubscription.create({
      data: {
        userId,
        discordId: GEWINNER,
        productId: produkt.id,
        status: 'ACTIVE',
        activeUserKey: userId,
        currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      },
    });
    const competitionId = await runde();

    const ergebnis = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: { winnerRewardXp: 250 },
    });

    expect(ergebnis.xp).toBe(250);
  });

  it('vergibt nichts, wenn der Ersatz auf 0 steht - und sagt warum', async () => {
    const userId = await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const produkt = await prisma.premiumProduct.findFirstOrThrow();
    await prisma.premiumSubscription.create({
      data: {
        userId,
        discordId: GEWINNER,
        productId: produkt.id,
        status: 'ACTIVE',
        activeUserKey: userId,
        currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      },
    });
    const competitionId = await runde();

    const ergebnis = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: { winnerRewardXp: 0 },
    });

    expect(ergebnis.art).toBe('NONE');
    expect(ergebnis.grund).toContain('0');
    expect(await prisma.xpTransaction.count()).toBe(0);
    // Die Zeile steht trotzdem - sonst versuchte es der naechste Lauf erneut.
    expect(await prisma.clipCompetitionReward.count()).toBe(1);
  });

  it('vergibt beim zweiten Abschluss derselben Runde nichts mehr', async () => {
    await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const competitionId = await runde();

    const erster = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
    });
    const zweiter = await clips.belohneGewinner({
      competitionId,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
    });

    expect(erster.schonVergeben).toBe(false);
    expect(zweiter.schonVergeben).toBe(true);
    expect(await prisma.premiumSubscription.count()).toBe(1);
    expect(await prisma.clipCompetitionReward.count()).toBe(1);
  });

  it('vergibt auch bei fuenf gleichzeitigen Durchgaengen genau einmal', async () => {
    await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const competitionId = await runde();

    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, () =>
        clips.belohneGewinner({
          competitionId,
          rundenLabel: 'Clip of the Week #39',
          winnerDiscordId: GEWINNER,
          einstellungen: EINSTELLUNGEN,
        }),
      ),
    );

    // Genau einer hat vergeben, vier sind auf die Zeile gelaufen.
    expect(ergebnisse.filter((eintrag) => !eintrag.schonVergeben)).toHaveLength(1);
    expect(await prisma.clipCompetitionReward.count()).toBe(1);
    expect(await prisma.premiumSubscription.count()).toBe(1);
  });

  it('haelt die Belohnungen zweier Runden auseinander', async () => {
    await benutzerAnlegen(GEWINNER);
    await produktAnlegen();
    const ersteRunde = await runde(39);
    const zweiteRunde = await runde(40);

    const eins = await clips.belohneGewinner({
      competitionId: ersteRunde,
      rundenLabel: 'Clip of the Week #39',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
    });
    const zwei = await clips.belohneGewinner({
      competitionId: zweiteRunde,
      rundenLabel: 'Clip of the Week #40',
      winnerDiscordId: GEWINNER,
      einstellungen: EINSTELLUNGEN,
    });

    // Beide Runden haben eine eigene Belohnung - die Eindeutigkeit gilt je
    // Runde und nicht je Person.
    expect(eins.schonVergeben).toBe(false);
    expect(zwei.schonVergeben).toBe(false);
    expect(await prisma.clipCompetitionReward.count()).toBe(2);

    // Die zweite konnte kein Premium sein: die erste laeuft noch.
    expect(eins.art).toBe('PREMIUM');
    expect(zwei.art).toBe('XP');
  });
});
