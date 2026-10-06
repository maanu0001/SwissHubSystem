import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_premium_vergabe');

/**
 * Die Premium-Vergabe gegen eine echte Datenbank (§55).
 *
 * ## Warum das nicht im Unit-Test geht
 *
 * Weil die interessanten Zusagen in der Datenbank liegen und nicht im Code:
 * der Teilindex `activeUserKey` laesst nur **ein** offenes Abonnement je
 * Benutzer zu, und die Vergabe laeuft in einer Transaktion mit `SELECT …
 * FOR UPDATE`. Beides lässt sich nicht nachbauen, ohne es nachzubauen - und
 * ein nachgebauter Index prueft den Nachbau.
 *
 * ## Was hier ausdruecklich nicht passiert
 *
 * Kein Discord-Aufruf, keine Zahlung. Die Vergabe schreibt Anspruch und
 * Protokoll; der Abgleich mit Discord ist ein eigener Schritt und gehoert
 * nicht in einen Test, der bei jedem Commit laeuft.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64');

const { prisma } = await import('@swisshub/database');
const { premium } = await import('@swisshub/modules');

const DISCORD = '200000000000000007';
const ACTOR = { discordId: '200000000000000001', username: 'adminin' };

async function produkt(slug: string, entitlements: Array<'PREMIUM_ROLE' | 'PREMIUM_STUEBLI_ROLE'>) {
  return prisma.premiumProduct.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: slug,
      description: 'Testangebot',
      priceMinor: 500,
      entitlements,
      active: true,
    },
  });
}

describeWithDatabase('Premium vergeben', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    /*
     * Das Testschema behaelt seine Zeilen zwischen Laeufen.
     *
     * `pushSchema` bringt das **Schema** auf den Stand, nicht die Daten. Ein
     * Test, der «noch keine Vergabe» voraussetzt, waere ohne dieses
     * Aufraeumen genau einmal gruen - beim ersten Lauf.
     */
    await prisma.premiumGrant.deleteMany();
    await prisma.premiumPayment.deleteMany();
    await prisma.premiumSubscription.deleteMany();
    await prisma.premiumProduct.deleteMany();
    await prisma.user.deleteMany({ where: { discordId: DISCORD } });

    await prisma.user.create({
      data: { discordId: DISCORD, username: 'beschenkte', globalName: 'Die Beschenkte' },
    });
  });

  it('legt Anspruch und Protokoll in einem Zug an', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    const ergebnis = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 30,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    expect(ergebnis.mode).toBe('NEW');
    expect(ergebnis.subscription.status).toBe('ACTIVE');
    expect(premium.grantsEntitlements(ergebnis.subscription.status)).toBe(true);

    const protokoll = await prisma.premiumGrant.findMany();
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]?.amount).toBe(30);
    expect(protokoll[0]?.grantedByUsername).toBe('adminin');
    // Die Vergabe hat keine Zahlung - und darf auch keine erfinden (§24).
    expect(await prisma.premiumPayment.count()).toBe(0);
  });

  it('verlängert, statt still zu überschreiben (§4, §5)', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    const erste = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 30,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });
    const ersteEnde = erste.subscription.currentPeriodEnd?.getTime() ?? 0;

    const zweite = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 30,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    expect(zweite.mode).toBe('EXTEND');
    const zweiteEnde = zweite.subscription.currentPeriodEnd?.getTime() ?? 0;
    // Rund dreissig Tage mehr - nicht dreissig Tage ab heute.
    const tage = (zweiteEnde - ersteEnde) / (24 * 60 * 60 * 1000);
    expect(tage).toBeGreaterThan(29);
    expect(tage).toBeLessThan(31);

    // Und: es gibt weiterhin **ein** Abonnement, nicht zwei.
    expect(await prisma.premiumSubscription.count()).toBe(1);
    expect(await prisma.premiumGrant.count()).toBe(2);
  });

  it('ersetzt nur, wenn Ersetzen gewählt wurde - und sagt, was verfällt', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 90,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    const vorschau = await premium.vorschauVergabe({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 7,
      unit: 'DAYS',
      modus: 'replace',
    });
    // Die Vorschau sagt es **vorher**: rund 90 Tage gehen verloren.
    expect(vorschau.verworfeneTage).toBeGreaterThan(85);

    const ersetzt = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 7,
      unit: 'DAYS',
      modus: 'replace',
      actor: ACTOR,
    });
    expect(ersetzt.mode).toBe('REPLACE');
    const restTage =
      ((ersetzt.subscription.currentPeriodEnd?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(restTage).toBeLessThan(8);
  });

  it('vergibt ein Bundle über dieselbe zentrale Logik (§6, §7)', async () => {
    // Ein Bundle ist ein Angebot mit mehreren Ansprüchen - kein zweites
    // System. Deshalb gibt es hier nichts Eigenes zu prüfen ausser dem,
    // dass beide Ansprüche ankommen.
    const bundle = await produkt('test-bundle', ['PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE']);
    const ergebnis = await premium.vergebePremium({
      discordId: DISCORD,
      productId: bundle.id,
      amount: 1,
      unit: 'MONTHS',
      modus: 'extend',
      actor: ACTOR,
    });
    expect(ergebnis.subscription.product.entitlements).toContain('PREMIUM_ROLE');
    expect(ergebnis.subscription.product.entitlements).toContain('PREMIUM_STUEBLI_ROLE');
  });

  it('widerruft sauber und löscht keine Historie (§10, §11)', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    const vergabe = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 30,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    const widerrufen = await premium.widerrufeVergabe(vergabe.grant.id, ACTOR, 'Testwiderruf');
    expect(widerrufen.status).toBe('REVOKED');
    expect(widerrufen.revokedReason).toBe('Testwiderruf');

    // Der Eintrag bleibt stehen - er wird als widerrufen markiert, nicht entfernt.
    expect(await prisma.premiumGrant.count()).toBe(1);

    // Und der Anspruch ist weg: kein offenes Abonnement mehr.
    const laufend = await prisma.premiumSubscription.findFirst({
      where: { user: { discordId: DISCORD }, activeUserKey: { not: null } },
    });
    expect(laufend).toBeNull();
  });

  it('zeigt eine abgelaufene Vergabe als abgelaufen, nicht als aktiv (§9)', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    const vergabe = await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 1,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    /*
     * Die Zeit vorstellen, statt zu warten.
     *
     * Das Ende wird direkt in die Vergangenheit gesetzt - genau der Zustand,
     * den der Ablaufjob vorfindet, bevor er aufraeumt. Geprueft wird, dass
     * die Historie ihn **so** ausweist und nicht als laufend: «aktiv» mit
     * einem Ende von gestern waere die Anzeige, die niemand glaubt.
     */
    await prisma.premiumGrant.update({
      where: { id: vergabe.grant.id },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });

    const historie = await premium.ladeHistorie({ discordId: DISCORD });
    /*
     * Der Zustand ist abgeleitet, kein Feld.
     *
     * Absichtlich: eine Spalte «abgelaufen» muesste jemand umschreiben, wenn
     * die Zeit vergeht - und zwischen dem Ablauf und diesem Lauf stuende dort
     * «aktiv». Aus `endsAt` gerechnet stimmt sie in jedem Moment.
     */
    expect(premium.grantZustand(historie[0]!)).toBe('EXPIRED');

    const nurAktive = await premium.ladeHistorie({ discordId: DISCORD, status: 'ACTIVE' });
    expect(nurAktive).toHaveLength(0);
  });

  it('weist eine Vergabe auf ein bezahltes Abonnement ab (§24)', async () => {
    const angebot = await produkt('test-premium', ['PREMIUM_ROLE']);
    await premium.vergebePremium({
      discordId: DISCORD,
      productId: angebot.id,
      amount: 30,
      unit: 'DAYS',
      modus: 'extend',
      actor: ACTOR,
    });

    // Aus dem Admin-Abo ein bezahltes machen - so, wie es nach einem echten
    // Checkout aussähe.
    await prisma.premiumSubscription.updateMany({
      where: { user: { discordId: DISCORD } },
      data: { providerSubscriptionId: 'sub_extern_123' },
    });

    await expect(
      premium.vergebePremium({
        discordId: DISCORD,
        productId: angebot.id,
        amount: 30,
        unit: 'DAYS',
        modus: 'extend',
        actor: ACTOR,
      }),
      /*
       * Warum das abgewiesen wird: an einem laufenden Abo beim
       * Zahlungsanbieter darf die Admin-Vergabe nicht herumschieben. Der
       * Anbieter wuesste nichts davon, und beim naechsten Webhook stuende
       * wieder sein Datum darin - die Vergabe waere lautlos weg.
       */
    ).rejects.toThrow();
  });
});
