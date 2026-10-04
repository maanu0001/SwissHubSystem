import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot');

/**
 * Ein Spin von der Anfrage bis zur Buchung.
 *
 * ## Warum das eine Datenbank braucht
 *
 * Weil genau die Dinge geprueft werden, die es ohne sie nicht gibt: die
 * Transaktion um Abbuchung, Ergebnis und Gutschrift, die Zeilensperre auf dem
 * Profil, der eindeutige Index gegen den zweiten Klick, der Verbrauch eines
 * Freispiels und die Tagesgrenzen. Die Spielregeln selbst stehen in
 * `tests/unit/xpslot-logik.test.ts` - dort ohne Datenbank, weil sie keine
 * brauchen.
 *
 * ## Warum die Zufallsquelle hereingegeben wird
 *
 * Ein Test, der auf einen Jackpot wartet, laeuft im Mittel 275 000 Spins. Mit
 * `quelleAusSeed` ist jeder Spin nachrechenbar, und ein erzwungener Jackpot
 * kommt ueber `testlauf` - denselben Weg, den die Verwaltung nimmt.
 */
const { prisma } = await import('@swisshub/database');
const { level, quelleAusSeed, setModuleEnabled } = await import('@swisshub/modules');
const { setDiscordGateway } = await import('@swisshub/discord');

const S = level.xpslot;

const SPIELER = '900000000000009001';
const ZWEITE = '900000000000009002';
const TEAM = { discordId: '900000000000009099', username: 'teamler' };

/** Die Nachrichten, die der Gewinn-Feed stellen wollte. */
const gestellt: Array<{ kanal: string; titel: string }> = [];

function attrappe(): void {
  setDiscordGateway({
    channels: {
      async send(kanal: string, inhalt: { embeds?: Array<{ title?: string }> }) {
        gestellt.push({ kanal, titel: inhalt.embeds?.[0]?.title ?? '' });
        return { id: 'nachricht' };
      },
      async list() {
        return [];
      },
    },
  } as never);
}

async function xpSetzen(discordId: string, xp: number): Promise<void> {
  await prisma.levelProfile.upsert({
    where: { discordId },
    create: { discordId, xp },
    update: { xp },
  });
}

const schluessel = (): string => `test-${Math.random().toString(36).slice(2, 14)}`;

async function aktiviere(): Promise<void> {
  await S.sorgeFuerKonfiguration();
  await S.setzeStatus('ACTIVE', null, TEAM);
}

/**
 * Der Zustand vor jedem Test.
 *
 * `pushSchema` bringt die **Form** der Tabellen auf den Stand, nicht ihren
 * Inhalt - `db push` leert nichts. Ohne das Leeren hier haetten die Zaehlungen
 * unten die Spins der vorherigen Tests mitgezaehlt, und eine geaenderte
 * Sitzungsgrenze haette jeden folgenden Test abgewiesen. Genau das passierte
 * beim ersten Lauf.
 *
 * Geleert wird auch `XpSlotConfig`: `sorgeFuerKonfiguration` legt sie dann mit
 * den Vorgaben neu an, und kein Test erbt die Grenzen eines anderen.
 */
async function leere(): Promise<void> {
  await prisma.xpSlotPremiumGrant.deleteMany();
  await prisma.xpSlotBonusRound.deleteMany();
  await prisma.xpSlotSpin.deleteMany();
  await prisma.xpSlotFreespinPackage.deleteMany();
  await prisma.xpSlotSession.deleteMany();
  await prisma.xpSlotDaily.deleteMany();
  await prisma.xpSlotSound.deleteMany();
  await prisma.xpSlotConfig.deleteMany();
  await prisma.xpSlotSoundPack.deleteMany();
  await prisma.xpSlotSymbol.deleteMany();
  await prisma.xpTransaction.deleteMany();
  await prisma.levelProfile.deleteMany();
  await prisma.auditLog.deleteMany();
}

describeWithDatabase('XP-Slot: Spin', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leere();
    gestellt.length = 0;
    attrappe();
    await setModuleEnabled(level.LEVEL_MODULE_ID, true, 'test-xpslot');
    await aktiviere();
    await xpSetzen(SPIELER, 100_000);
  });

  // --- Einsatz und XP ------------------------------------------------------

  it('bucht den Einsatz ab und den Gewinn gut', async () => {
    const vorher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('bucht-ab'),
    });

    const nachher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(nachher.xp).toBe(vorher.xp - 10 + ergebnis.gewinn);
    expect(ergebnis.xpVorher).toBe(vorher.xp);
    expect(ergebnis.xpNachher).toBe(nachher.xp);
  });

  it('schreibt die XP-Buchungen ins gemeinsame Journal', async () => {
    await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 25,
      schluessel: 'journal-schluessel-1',
      random: quelleAusSeed('journal'),
    });

    const buchungen = await prisma.xpTransaction.findMany({
      where: { discordId: SPIELER },
      orderBy: { createdAt: 'asc' },
    });
    // Mindestens der Einsatz - ein Gewinn kommt dazu, wenn einer fiel.
    expect(buchungen.some((zeile) => zeile.source === 'SLOT_STAKE' && zeile.delta === -25)).toBe(true);
    for (const zeile of buchungen) {
      expect(['SLOT_STAKE', 'SLOT_WIN']).toContain(zeile.source);
    }
  });

  it('weist einen Einsatz ab, den es nicht gibt - ohne stillschweigend abzuwerten', async () => {
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 37, schluessel: schluessel() })).rejects.toThrow(
      /nicht spielbar/u,
    );

    // Kein Spin, keine Buchung.
    expect(await prisma.xpSlotSpin.count({ where: { discordId: SPIELER } })).toBe(0);
    expect(await prisma.xpTransaction.count({ where: { discordId: SPIELER } })).toBe(0);
  });

  it('weist ab, wenn die XP nicht reichen - mit genau dieser Meldung', async () => {
    await xpSetzen(SPIELER, 5);
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: schluessel() })).rejects.toThrow(
      'Nicht genügend XP für diesen Einsatz.',
    );
    const profil = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(profil.xp).toBe(5);
  });

  it('weist ab, solange der Slot nicht aktiv ist', async () => {
    await S.setzeStatus('MAINTENANCE', 'Wir schrauben am Jackpot.', TEAM);
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: schluessel() })).rejects.toThrow(
      'Wir schrauben am Jackpot.',
    );
  });

  /*
   * Der Wartungsmodus sperrt die Mitglieder - und laesst die Verwaltung
   * spielen. Der Fall darueber zeigt die Sperre; dieser zeigt die Ausnahme,
   * und beide gehen durch dieselbe Pruefung in `dreheSpin`.
   *
   * Hier stand vorher ein Fall ueber `EVENT_ONLY`. Diesen Status gibt es
   * nicht mehr - der Eventmodus ist entfernt.
   */
  it('lässt die Verwaltung im Wartungsmodus spielen', async () => {
    await S.setzeStatus('MAINTENANCE', 'Wir schrauben am Jackpot.', TEAM);

    const spin = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      darfVerwalten: true,
    });
    expect(spin.spinId).toBeTruthy();

    // Dieselbe Person ohne die Berechtigung bleibt gesperrt: die Grenze
    // haengt am Recht und nicht an der Kennung.
    await expect(
      S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: schluessel(), darfVerwalten: false }),
    ).rejects.toThrow('Wir schrauben am Jackpot.');
  });

  // --- Der zweite Klick ----------------------------------------------------

  it('gibt bei demselben Schlüssel denselben Spin zurück', async () => {
    const eins = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: 'fester-schluessel-aa',
      random: quelleAusSeed('idem'),
    });
    const zwei = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: 'fester-schluessel-aa',
      random: quelleAusSeed('ganz-anders'),
    });

    expect(zwei.spinId).toBe(eins.spinId);
    expect(zwei.wiederholung).toBe(true);
    expect(zwei.grid).toEqual(eins.grid);
    expect(await prisma.xpSlotSpin.count({ where: { discordId: SPIELER } })).toBe(1);
  });

  it('dreht bei zehn gleichzeitigen Anfragen mit demselben Schlüssel genau einmal', async () => {
    const versuche = Array.from({ length: 10 }, () =>
      S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: 'gleichzeitig-bb',
        random: quelleAusSeed('parallel'),
      }).catch((fehler: unknown) => fehler),
    );
    const ergebnisse = await Promise.all(versuche);

    expect(await prisma.xpSlotSpin.count({ where: { discordId: SPIELER } })).toBe(1);
    const spins = ergebnisse.filter(
      (eintrag): eintrag is Awaited<ReturnType<typeof S.dreheSpin>> =>
        typeof eintrag === 'object' && eintrag !== null && 'spinId' in eintrag,
    );
    expect(spins.length).toBeGreaterThan(0);
    const kennungen = new Set(spins.map((eintrag) => eintrag.spinId));
    expect(kennungen.size).toBe(1);

    // Genau eine Einsatzbuchung - kein Spin auf Kredit.
    const einsaetze = await prisma.xpTransaction.count({
      where: { discordId: SPIELER, source: 'SLOT_STAKE' },
    });
    expect(einsaetze).toBe(1);
  });

  it('bucht bei verschiedenen Schlüsseln jeden Spin einzeln', async () => {
    await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('a'),
    });
    await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('b'),
    });
    expect(await prisma.xpSlotSpin.count({ where: { discordId: SPIELER } })).toBe(2);
  });

  it('gibt einen fremden Schlüssel nicht heraus', async () => {
    /*
     * Der eindeutige Index auf dem Schluessel ist global. Ohne eine Pruefung
     * auf die Person bekaeme jemand, der einen fremden Schluessel errät, das
     * Ergebnis einer fremden Person: Spielfeld, Gewinn und XP-Stand. Dass ein
     * zufaelliger Schluessel praktisch nie kollidiert, ist kein Schutz.
     */
    await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: 'fremder-schluessel-cc',
      random: quelleAusSeed('fremd'),
    });
    await xpSetzen(ZWEITE, 10_000);
    await expect(
      S.dreheSpin({ discordId: ZWEITE, einsatz: 10, schluessel: 'fremder-schluessel-cc' }),
    ).rejects.toThrow(/belegt/u);
    // Und die fremde Person hat nichts gespielt.
    expect(await prisma.xpSlotSpin.count({ where: { discordId: ZWEITE } })).toBe(0);
  });

  it('verlangt überhaupt einen Schlüssel', async () => {
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: 'kurz' })).rejects.toThrow(
      /Schlüssel/u,
    );
  });

  // --- Historie und Statistik ---------------------------------------------

  it('historisiert jeden Spin mit Ergebnis, Linien und XP-Stand', async () => {
    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 50,
      schluessel: schluessel(),
      random: quelleAusSeed('historie'),
    });

    const zeile = await prisma.xpSlotSpin.findUniqueOrThrow({ where: { id: ergebnis.spinId } });
    expect(zeile.grid).toHaveLength(15);
    expect(zeile.bet).toBe(50);
    expect(zeile.kind).toBe('PAID');
    expect(zeile.xpAfter).toBe(ergebnis.xpNachher);
    // Die Notiz haelt die Werte, die das Ergebnis bestimmt haben.
    expect(zeile.configNote).toMatchObject({ jackpotMultiplikator: expect.any(Number) });
  });

  it('zeigt den eigenen Verlauf und zählt in die Kennzahlen', async () => {
    for (let index = 0; index < 3; index += 1) {
      await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`verlauf-${index}`),
      });
    }

    const verlauf = await S.meinVerlauf(SPIELER);
    expect(verlauf).toHaveLength(3);

    const kennzahlen = await S.kennzahlen('alles');
    expect(kennzahlen.spins).toBe(3);
    expect(kennzahlen.bezahlteSpins).toBe(3);
    expect(kennzahlen.xpEin).toBe(30);
  });

  // --- Grenzen -------------------------------------------------------------

  it('setzt die Tagesverlustgrenze durch', async () => {
    const konfig = await S.leseKonfiguration();
    await S.speichereKonfig(
      {
        einsaetze: konfig.wirksam.einsaetze,
        minEinsatz: konfig.wirksam.minEinsatz,
        maxEinsatz: konfig.wirksam.maxEinsatz,
        jackpotMultiplikator: konfig.wirksam.jackpotMultiplikator,
        jackpotNurEcht: konfig.wirksam.jackpotNurEcht,
        wildErsetztAlles: konfig.wirksam.wildErsetztAlles,
        bonusAusloeser: konfig.wirksam.bonusAusloeser,
        bonusFreispiele: konfig.wirksam.bonusFreispiele,
        leiter1: konfig.wirksam.leiter1,
        leiter2: konfig.wirksam.leiter2,
        gambleChance1Bp: konfig.wirksam.gambleChance1Bp,
        gambleChance2Bp: konfig.wirksam.gambleChance2Bp,
        retriggerSpins: konfig.wirksam.retriggerSpins,
        stickyWilds: konfig.wirksam.stickyWilds,
        premiumAktiv: false,
        maxGewinnMultiplikator: konfig.wirksam.maxGewinnMultiplikator,
        maxTagesverlust: 20,
        maxTagesgewinn: 0,
        maxSpinsJeSitzung: 0,
        sitzungspauseSekunden: 0,
        autoSpinZahlen: konfig.wirksam.autoSpinZahlen,
        tierGross: konfig.wirksam.tierGross,
        tierMega: konfig.wirksam.tierMega,
      },
      TEAM,
    );

    // Verlieren, bis die Grenze greift. Jeder Spin kostet 10 XP; ein Gewinn
    // verschiebt die Grenze nach hinten, deshalb mit Obergrenze schleifen.
    let abgewiesen: string | null = null;
    for (let index = 0; index < 60 && abgewiesen === null; index += 1) {
      await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`grenze-${index}`),
      }).catch((fehler: unknown) => {
        abgewiesen = fehler instanceof Error ? fehler.message : 'unbekannt';
      });
    }
    expect(abgewiesen).toMatch(/Verlustgrenze/u);
  });

  it('setzt die Sitzungsgrenze durch und nennt die Pause', async () => {
    const konfig = await S.leseKonfiguration();
    const basis = {
      einsaetze: konfig.wirksam.einsaetze,
      minEinsatz: konfig.wirksam.minEinsatz,
      maxEinsatz: konfig.wirksam.maxEinsatz,
      jackpotMultiplikator: konfig.wirksam.jackpotMultiplikator,
      jackpotNurEcht: konfig.wirksam.jackpotNurEcht,
      wildErsetztAlles: konfig.wirksam.wildErsetztAlles,
      bonusAusloeser: konfig.wirksam.bonusAusloeser,
      bonusFreispiele: konfig.wirksam.bonusFreispiele,
      leiter1: konfig.wirksam.leiter1,
      leiter2: konfig.wirksam.leiter2,
      gambleChance1Bp: konfig.wirksam.gambleChance1Bp,
      gambleChance2Bp: konfig.wirksam.gambleChance2Bp,
      retriggerSpins: konfig.wirksam.retriggerSpins,
      stickyWilds: konfig.wirksam.stickyWilds,
      premiumAktiv: false,
      maxGewinnMultiplikator: konfig.wirksam.maxGewinnMultiplikator,
      maxTagesverlust: 0,
      maxTagesgewinn: 0,
      maxSpinsJeSitzung: 3,
      sitzungspauseSekunden: 600,
      autoSpinZahlen: konfig.wirksam.autoSpinZahlen,
      tierGross: konfig.wirksam.tierGross,
      tierMega: konfig.wirksam.tierMega,
    };
    await S.speichereKonfig(basis, TEAM);

    for (let index = 0; index < 3; index += 1) {
      await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`sitzung-${index}`),
      });
    }
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: schluessel() })).rejects.toThrow(
      /Pause/u,
    );
  });

  // --- Freispielpakete -----------------------------------------------------

  it('gewährt ein Paket und spielt es vor den bezahlten Spins', async () => {
    const konfig = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 2, einsatz: 25, grund: 'Dankeschön' },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    expect(paket.offen).toBe(2);

    const vorher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      // Der gewuenschte Einsatz ist egal: das Paket bestimmt ihn.
      einsatz: 500,
      schluessel: schluessel(),
      random: quelleAusSeed('freispiel-1'),
    });

    expect(ergebnis.art).toBe('FREESPIN_PACKAGE');
    expect(ergebnis.einsatz).toBe(25);
    const nachher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    // Kein Abzug - nur der Gewinn.
    expect(nachher.xp).toBe(vorher.xp + ergebnis.gewinn);
    expect(ergebnis.freispieleOffen).toBe(1);
  });

  it('bucht kein Freispiel als Einsatz in die Tagesbilanz', async () => {
    const konfig = await S.leseKonfiguration();
    await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 1, einsatz: 100 },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('tagesbilanz'),
    });

    const tag = await prisma.xpSlotDaily.findFirstOrThrow({ where: { discordId: SPIELER } });
    expect(tag.staked).toBe(0);
    expect(tag.spins).toBe(1);
  });

  it('verbraucht ein Paket vollständig und setzt es auf USED', async () => {
    const konfig = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 2, einsatz: 10 },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    for (let index = 0; index < 2; index += 1) {
      await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`verbrauch-${index}`),
      });
    }
    const zeile = await prisma.xpSlotFreespinPackage.findUniqueOrThrow({ where: { id: paket.id } });
    expect(zeile.remaining).toBe(0);
    expect(zeile.used).toBe(2);
    expect(zeile.status).toBe('USED');
  });

  it('nimmt das Paket mit der nächsten Frist zuerst', async () => {
    const konfig = await S.leseKonfiguration();
    const spaeter = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 1, einsatz: 100, laeuftAb: new Date(Date.now() + 90 * 86_400_000) },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    const bald = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 1, einsatz: 25, laeuftAb: new Date(Date.now() + 86_400_000) },
      konfig.wirksam.einsaetze,
      TEAM,
    );

    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('reihenfolge'),
    });
    expect(ergebnis.einsatz).toBe(25);
    const baldZeile = await prisma.xpSlotFreespinPackage.findUniqueOrThrow({ where: { id: bald.id } });
    const spaeterZeile = await prisma.xpSlotFreespinPackage.findUniqueOrThrow({
      where: { id: spaeter.id },
    });
    expect(baldZeile.remaining).toBe(0);
    expect(spaeterZeile.remaining).toBe(1);
  });

  it('spielt ein abgelaufenes Paket nicht', async () => {
    const konfig = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 1, einsatz: 25, laeuftAb: new Date(Date.now() + 60_000) },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    // Die Frist nach hinten in die Vergangenheit setzen - so, wie sie nach
    // einer Woche dasteht.
    await prisma.xpSlotFreespinPackage.update({
      where: { id: paket.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('abgelaufen'),
    });
    expect(ergebnis.art).toBe('PAID');

    expect(await S.markiereAbgelaufene()).toBe(1);
    const zeile = await prisma.xpSlotFreespinPackage.findUniqueOrThrow({ where: { id: paket.id } });
    expect(zeile.status).toBe('EXPIRED');
  });

  it('entzieht offene Freispiele und holt keine Gewinne zurück', async () => {
    const konfig = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 3, einsatz: 10 },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    const gespielt = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('entzug'),
    });
    const nachSpin = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });

    await S.entzieheFreispiele(paket.id, TEAM);
    const zeile = await prisma.xpSlotFreespinPackage.findUniqueOrThrow({ where: { id: paket.id } });
    expect(zeile.status).toBe('REVOKED');
    expect(zeile.remaining).toBe(0);

    const danach = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(danach.xp).toBe(nachSpin.xp);
    expect(gespielt.art).toBe('FREESPIN_PACKAGE');
  });

  it('weist ein Paket mit einem nicht spielbaren Einsatz ab', async () => {
    const konfig = await S.leseKonfiguration();
    await expect(
      S.gewaehreFreispiele({ discordId: SPIELER, anzahl: 1, einsatz: 42 }, konfig.wirksam.einsaetze, TEAM),
    ).rejects.toThrow(/nicht spielbar/u);
  });

  it('protokolliert Gewähren und Entziehen', async () => {
    const konfig = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 5, einsatz: 10 },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    await S.entzieheFreispiele(paket.id, TEAM);

    const protokoll = await prisma.auditLog.findMany({
      where: { action: { in: ['XP_SLOT_FREESPINS_GRANTED', 'XP_SLOT_FREESPINS_REVOKED'] } },
    });
    expect(protokoll).toHaveLength(2);
    expect(protokoll.every((zeile) => zeile.actorDiscordId === TEAM.discordId)).toBe(true);
  });

  // --- Bonusrunde ----------------------------------------------------------

  it('eröffnet nach einem Bonus eine Runde mit offener Entscheidung', async () => {
    const runde = await bonusAusloesen();
    expect(runde.stufe).toBe('LADDER_1');
    expect(runde.offen).toBe(0);
    expect(runde.wahl?.nehmen).toBe(8);
    expect(runde.wahl?.riskierenAuf).toBe(12);
  });

  it('lässt nicht weiterspielen, solange die Entscheidung offen ist', async () => {
    await bonusAusloesen();
    await expect(S.dreheSpin({ discordId: SPIELER, einsatz: 10, schluessel: schluessel() })).rejects.toThrow(
      /Entscheide zuerst/u,
    );
  });

  it('gibt beim Nehmen die garantierten Freispiele', async () => {
    const runde = await bonusAusloesen();
    const { bonus } = await S.nimmFreispiele(SPIELER, runde.id);
    expect(bonus.stufe).toBe('SPINS');
    expect(bonus.zugesagt).toBe(8);
    expect(bonus.offen).toBe(8);
  });

  it('spielt die Freispiele ohne XP-Abzug und mit festem Einsatz', async () => {
    const runde = await bonusAusloesen();
    await S.nimmFreispiele(SPIELER, runde.id);
    const vorher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });

    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 500,
      schluessel: schluessel(),
      random: quelleAusSeed('bonus-spin'),
    });
    expect(ergebnis.art).toBe('BONUS_ROUND');
    expect(ergebnis.einsatz).toBe(runde.einsatz);

    const nachher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(nachher.xp).toBe(vorher.xp + ergebnis.gewinn);
  });

  it('lässt gewonnene Wilds für die ganze Runde stehen', async () => {
    const runde = await bonusAusloesen();
    await S.nimmFreispiele(SPIELER, runde.id);

    let stickyVorher = 0;
    for (let index = 0; index < 4; index += 1) {
      const ergebnis = await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`sticky-${index}`),
      });
      const jetzt = ergebnis.bonus?.stickyZellen.length ?? 0;
      // Nie weniger als vorher: ein festsitzendes Wild bleibt.
      expect(jetzt).toBeGreaterThanOrEqual(stickyVorher);
      stickyVorher = jetzt;
      for (const zelle of ergebnis.bonus?.stickyZellen ?? []) {
        expect(ergebnis.grid[zelle]).toBe('wild');
      }
    }
    expect(stickyVorher).toBeGreaterThan(0);
  });

  it('hält jede geklebte Position über die ganze Runde - und dreht den Rest neu', async () => {
    const runde = await bonusAusloesen();
    await S.nimmFreispiele(SPIELER, runde.id);

    /*
     * Die genaue Zusage, Freispiel fuer Freispiel.
     *
     * Der Fall darueber prueft, dass die Zahl der geklebten Zellen nicht
     * sinkt. Das ist die halbe Aussage: sie liesse auch zu, dass ein Wild
     * woanders neu entsteht und das alte zufaellig wieder faellt. Hier wird
     * jede einzelne Position verfolgt - und zusaetzlich, dass der Rest der
     * Walze wirklich neu gezogen wird. Beides zusammen ist die Anforderung:
     * «diese Position wird NICHT neu gezogen, alle anderen drehen neu».
     */
    const geklebt = new Set<number>();
    let vorigesFeld: string[] | null = null;
    let irgendwoAnders = false;

    for (let index = 0; index < 5; index += 1) {
      const ergebnis = await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`klebt-${index}`),
      });
      if (ergebnis.art !== 'BONUS_ROUND') {
        break;
      }

      // Jede Position, die beim letzten Mal klebte, traegt wieder das Wild.
      for (const zelle of geklebt) {
        expect(ergebnis.grid[zelle], `Zelle ${zelle} im Freispiel ${index + 1}`).toBe('wild');
      }

      // Der Rest dreht: irgendeine nicht geklebte Zelle muss sich im Lauf der
      // Runde einmal geaendert haben. Alles andere waere ein stehendes Bild.
      if (vorigesFeld) {
        for (let zelle = 0; zelle < ergebnis.grid.length; zelle += 1) {
          if (!geklebt.has(zelle) && ergebnis.grid[zelle] !== vorigesFeld[zelle]) {
            irgendwoAnders = true;
          }
        }
      }

      for (const zelle of ergebnis.bonus?.stickyZellen ?? []) {
        geklebt.add(zelle);
      }
      vorigesFeld = ergebnis.grid;
    }

    expect(geklebt.size).toBeGreaterThan(0);
    expect(irgendwoAnders).toBe(true);

    // Und in der Datenbank steht genau das, was die Runde gesehen hat - die
    // Positionen liegen serverseitig und nicht in der Animation.
    const zeile = await prisma.xpSlotBonusRound.findUniqueOrThrow({ where: { id: runde.id } });
    for (const zelle of zeile.stickyCells) {
      expect(geklebt.has(zelle)).toBe(true);
    }
  });

  it('beendet die Runde, wenn das letzte Freispiel gespielt ist', async () => {
    const runde = await bonusAusloesen();
    await S.nimmFreispiele(SPIELER, runde.id);

    let letzte: Awaited<ReturnType<typeof S.dreheSpin>> | null = null;
    for (let index = 0; index < 40; index += 1) {
      letzte = await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`ende-${index}`),
      });
      if (letzte.art !== 'BONUS_ROUND') {
        break;
      }
    }
    const zeile = await prisma.xpSlotBonusRound.findUniqueOrThrow({ where: { id: runde.id } });
    expect(['FINISHED', 'SPINS']).toContain(zeile.stage);
    if (zeile.stage === 'FINISHED') {
      expect(zeile.remaining).toBe(0);
      expect(zeile.finishedAt).not.toBeNull();
    }
  });

  it('bringt einen gewonnenen Risikoschritt auf die nächste Stufe', async () => {
    const runde = await bonusAusloesen();
    // Eine Quelle, die immer 0 liefert: jeder Wurf unter der Chance, also
    // gewonnen. Der Wurf fallt auf dem Server, nicht im Browser.
    const immerGewinn = { integer: () => 0, hex: () => '00' };
    const { bonus, gewonnen } = await S.riskiere(SPIELER, runde.id, immerGewinn);
    expect(gewonnen).toBe(true);
    expect(bonus.stufe).toBe('LADDER_2');
    expect(bonus.wahl?.nehmen).toBe(12);
    expect(bonus.wahl?.riskierenAuf).toBe(16);
  });

  it('kostet ein verlorener Risikoschritt die ganze Runde', async () => {
    const runde = await bonusAusloesen();
    // Immer der grooesste Wurf: nie unter der Chance, also verloren.
    const immerVerlust = { integer: (max: number) => max - 1, hex: () => '00' };
    const { bonus, gewonnen } = await S.riskiere(SPIELER, runde.id, immerVerlust);
    expect(gewonnen).toBe(false);
    expect(bonus.stufe).toBe('LOST');
    expect(bonus.offen).toBe(0);
    expect(bonus.zugesagt).toBe(0);

    // Und es gibt kein Freispiel.
    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('nach-verlust'),
    });
    expect(ergebnis.art).toBe('PAID');
  });

  it('startet nach zwei gewonnenen Schritten mit sechzehn Freispielen', async () => {
    const runde = await bonusAusloesen();
    const immerGewinn = { integer: () => 0, hex: () => '00' };
    const erste = await S.riskiere(SPIELER, runde.id, immerGewinn);
    const zweite = await S.riskiere(SPIELER, erste.bonus.id, immerGewinn);
    expect(zweite.bonus.stufe).toBe('SPINS');
    expect(zweite.bonus.offen).toBe(16);
  });

  it('nennt die erreichte Freispielzahl - nie null nach einem Gewinn', async () => {
    /*
     * Der Fehler, den das abdeckt: die Meldung sagte «0 Freispiele», obwohl
     * gerade zwoelf gewonnen waren.
     *
     * Die Oberflaeche las die Zahl aus `bonus.offen`. Nach einem gewonnenen
     * Wurf auf der ersten Stufe steht die Runde aber auf `LADDER_2` - es gibt
     * wieder eine Wahl -, und offene Freispiele hat sie erst, wenn jemand
     * sie nimmt. `freispiele` ist die erreichte Stufe und kommt aus
     * derselben Rechnung, die den Wurf bewertet hat.
     */
    const immerGewinn = { integer: () => 0, hex: () => '00' };
    const immerVerlust = { integer: (max: number) => max - 1, hex: () => '00' };

    /*
     * Der verlorene Fall zuerst: er beendet die Runde, und danach ist Platz
     * fuer die naechste. Andersherum laeuft nach zwei Gewinnen eine Runde
     * mit sechzehn Freispielen - und solange die steht, loest kein Scatter
     * eine neue aus.
     */
    const verloren = await S.riskiere(SPIELER, (await bonusAusloesen()).id, immerVerlust);
    expect(verloren.gewonnen).toBe(false);
    expect(verloren.freispiele).toBe(0);

    const erste = await S.riskiere(SPIELER, (await bonusAusloesen()).id, immerGewinn);
    expect(erste.gewonnen).toBe(true);
    expect(erste.bonus.stufe).toBe('LADDER_2');
    // Genau hier stand vorher die Null.
    expect(erste.bonus.offen).toBe(0);
    expect(erste.freispiele).toBe(12);

    const zweite = await S.riskiere(SPIELER, erste.bonus.id, immerGewinn);
    expect(zweite.freispiele).toBe(16);
    expect(zweite.bonus.offen).toBe(16);
  });

  it('lässt keine Entscheidung über eine fremde Runde zu', async () => {
    const runde = await bonusAusloesen();
    await expect(S.nimmFreispiele(ZWEITE, runde.id)).rejects.toThrow(/gibt es nicht/u);
    await expect(S.riskiere(ZWEITE, runde.id)).rejects.toThrow(/gibt es nicht/u);
  });

  it('lässt dieselbe Entscheidung nicht zweimal treffen', async () => {
    const runde = await bonusAusloesen();
    await S.nimmFreispiele(SPIELER, runde.id);
    await expect(S.nimmFreispiele(SPIELER, runde.id)).rejects.toThrow(/keine Entscheidung/u);
  });

  // --- Testmodus -----------------------------------------------------------

  it('bucht im Testmodus nichts und zählt nirgends mit', async () => {
    const vorher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    const { ergebnis } = await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'jackpot' });

    expect(ergebnis.jackpot).toBe(true);
    expect(ergebnis.gewinn).toBeGreaterThan(0);

    const nachher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(nachher.xp).toBe(vorher.xp);
    expect(await prisma.xpTransaction.count({ where: { discordId: SPIELER } })).toBe(0);
    expect(await prisma.xpSlotBonusRound.count()).toBe(0);
    expect(await prisma.xpSlotDaily.count()).toBe(0);

    const kennzahlen = await S.kennzahlen('alles');
    expect(kennzahlen.spins).toBe(0);
    expect(await S.meinVerlauf(SPIELER)).toHaveLength(0);
  });

  it('erzwingt im Testmodus Bonus, Premium und Sweat', async () => {
    const bonus = await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'bonus' });
    expect(bonus.ergebnis.bonusAusgeloest).toBe(true);
    // Und trotzdem keine Bonusrunde - ein Testlauf hat keine Folgen.
    expect(await prisma.xpSlotBonusRound.count()).toBe(0);

    const sweat = await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'sweat' });
    expect(sweat.ergebnis.bonusAusgeloest).toBe(false);
    expect(sweat.ergebnis.sweatAbWalze).not.toBeNull();

    const mega = await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'mega' });
    expect(mega.ergebnis.gewinn).toBeGreaterThan(0);
  });

  it('zeigt Testläufe nur, wenn man sie ausdrücklich einschliesst', async () => {
    await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'jackpot' });
    expect((await S.verlauf({})).gesamt).toBe(0);
    expect((await S.verlauf({ mitTestlaeufen: true })).gesamt).toBe(1);
  });

  it('meldet einen Testlauf nicht im Gewinn-Feed', async () => {
    await S.speichereFeed(
      { kanalId: '900000000000000777', bigWin: true, jackpot: true, premium: true },
      TEAM,
    );
    await S.testlauf({ discordId: SPIELER, einsatz: 10, fall: 'jackpot' });
    expect(gestellt).toHaveLength(0);
  });

  // --- Gewinn-Feed ---------------------------------------------------------

  it('meldet einen echten Jackpot im eingestellten Kanal', async () => {
    await S.speichereFeed(
      { kanalId: '900000000000000777', bigWin: false, jackpot: true, premium: true },
      TEAM,
    );

    /*
     * Ein echter Jackpot waere in einem Test nicht zu erreichen. Also wird
     * der Spin geschrieben und `meldeGewinn` gerufen - dieselbe Funktion, die
     * `dreheSpin` nach der Transaktion ruft.
     */
    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'PAID',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'logo'),
        lines: [],
        grossWin: 50_000,
        netWin: 49_900,
        jackpot: true,
        xpBefore: 100_000,
        xpAfter: 149_900,
      },
    });
    await S.meldeGewinn(spin, await S.leseKonfiguration());

    expect(gestellt).toHaveLength(1);
    expect(gestellt[0]?.kanal).toBe('900000000000000777');
    expect(gestellt[0]?.titel).toContain('JACKPOT');
  });

  it('meldet keinen gewöhnlichen Gewinn', async () => {
    await S.speichereFeed(
      { kanalId: '900000000000000777', bigWin: true, jackpot: true, premium: true },
      TEAM,
    );
    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'PAID',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'a'),
        lines: [],
        grossWin: 150,
        netWin: 50,
        xpBefore: 100_000,
        xpAfter: 100_050,
      },
    });
    await S.meldeGewinn(spin, await S.leseKonfiguration());
    expect(gestellt).toHaveLength(0);
  });

  it('meldet nichts ohne eingestellten Kanal', async () => {
    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'PAID',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'logo'),
        lines: [],
        grossWin: 50_000,
        netWin: 49_900,
        jackpot: true,
        xpBefore: 0,
        xpAfter: 50_000,
      },
    });
    await S.meldeGewinn(spin, await S.leseKonfiguration());
    expect(gestellt).toHaveLength(0);
  });

  // --- Auszeichnungen ------------------------------------------------------

  it('liefert die Grundlage für die Auszeichnungen - ohne Testläufe', async () => {
    for (let index = 0; index < 4; index += 1) {
      await S.dreheSpin({
        discordId: SPIELER,
        einsatz: 10,
        schluessel: schluessel(),
        random: quelleAusSeed(`award-${index}`),
      });
    }
    await S.testlauf({ discordId: SPIELER, einsatz: 500, fall: 'jackpot' });

    const grundlage = await S.slotGrundlage(SPIELER);
    expect(grundlage.spins).toBe(4);
    expect(grundlage.einsatzGesamt).toBe(40);
    // Der erzwungene Jackpot aus dem Testlauf darf nicht mitzaehlen.
    expect(grundlage.jackpots).toBe(0);
  });

  /**
   * Loest einen Bonus aus, ohne auf den Zufall zu warten.
   *
   * Dafuer wird das Bonussymbol fuer einen Moment zum einzigen Symbol auf den
   * Walzen - dann ist jeder Spin ein Bonus. Danach wird die Konfiguration
   * wieder hergestellt, damit die Freispiele danach gewoehnlich laufen.
   */
  async function bonusAusloesen(): Promise<NonNullable<Awaited<ReturnType<typeof S.dreheSpin>>['bonus']>> {
    const vorher = await prisma.xpSlotSymbol.findMany();
    await prisma.xpSlotSymbol.updateMany({
      where: { key: { not: 'bonus' } },
      data: { weight: 0 },
    });

    const ergebnis = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: 10,
      schluessel: schluessel(),
      random: quelleAusSeed('bonus-ausloesen'),
    });

    for (const zeile of vorher) {
      await prisma.xpSlotSymbol.update({ where: { key: zeile.key }, data: { weight: zeile.weight } });
    }

    expect(ergebnis.bonusAusgeloest).toBe(true);
    expect(ergebnis.bonus).not.toBeNull();
    return ergebnis.bonus!;
  }
});
