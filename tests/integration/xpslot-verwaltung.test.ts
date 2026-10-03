import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot_admin');

/**
 * Die Verwaltung des XP-Slots: Konfiguration, Events, Premium, Klaenge.
 *
 * ## Was hier geprueft wird
 *
 * Nicht ob ein Formular Felder hat, sondern ob die Entscheidungen greifen:
 * dass eine geaenderte Auszahlung die Quote verschiebt, dass ein Event nach
 * Ablauf von selbst nichts mehr tut, dass ein Premium-Gewinn ueber das
 * bestehende Premium-System geht und bei schon vorhandenem Premium
 * vorgemerkt bleibt, und dass jeder Eingriff im Protokoll steht.
 */
const { prisma } = await import('@swisshub/database');
const { level, premium, setModuleEnabled } = await import('@swisshub/modules');

const S = level.xpslot;
const TEAM = { discordId: '900000000000008099', username: 'teamler' };
const SPIELER = '900000000000008001';

async function leere(): Promise<void> {
  await prisma.xpSlotPremiumGrant.deleteMany();
  await prisma.xpSlotBonusRound.deleteMany();
  await prisma.xpSlotSpin.deleteMany();
  await prisma.xpSlotFreespinPackage.deleteMany();
  await prisma.xpSlotSession.deleteMany();
  await prisma.xpSlotDaily.deleteMany();
  await prisma.xpSlotEvent.deleteMany();
  await prisma.xpSlotSound.deleteMany();
  await prisma.xpSlotConfig.deleteMany();
  await prisma.xpSlotSoundPack.deleteMany();
  await prisma.xpSlotSymbol.deleteMany();
  await prisma.premiumSubscription.deleteMany();
  await prisma.premiumProduct.deleteMany();
  await prisma.user.deleteMany();
  await prisma.levelProfile.deleteMany();
  await prisma.auditLog.deleteMany();
}

/** Die Konfiguration als vollstaendige Eingabe - zum gezielten Abwandeln. */
async function eingabe(
  teil: Partial<Parameters<typeof S.speichereKonfig>[0]> = {},
): Promise<Parameters<typeof S.speichereKonfig>[0]> {
  const k = await S.leseKonfiguration();
  const w = k.wirksam;
  return {
    einsaetze: w.einsaetze,
    minEinsatz: w.minEinsatz,
    maxEinsatz: w.maxEinsatz,
    jackpotMultiplikator: w.jackpotMultiplikator,
    jackpotNurEcht: w.jackpotNurEcht,
    wildErsetztAlles: w.wildErsetztAlles,
    bonusAusloeser: w.bonusAusloeser,
    bonusFreispiele: w.bonusFreispiele,
    leiter1: w.leiter1,
    leiter2: w.leiter2,
    gambleChance1Bp: w.gambleChance1Bp,
    gambleChance2Bp: w.gambleChance2Bp,
    retriggerSpins: w.retriggerSpins,
    stickyWilds: w.stickyWilds,
    premiumAktiv: k.config.premiumEnabled,
    maxGewinnMultiplikator: w.maxGewinnMultiplikator,
    maxTagesverlust: w.maxTagesverlust,
    maxTagesgewinn: w.maxTagesgewinn,
    maxSpinsJeSitzung: w.maxSpinsJeSitzung,
    sitzungspauseSekunden: w.sitzungspauseSekunden,
    autoSpinZahlen: w.autoSpinZahlen,
    tierGross: w.tierGross,
    tierMega: w.tierMega,
    ...teil,
  };
}

describeWithDatabase('XP-Slot: Verwaltung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leere();
    await setModuleEnabled(level.LEVEL_MODULE_ID, true, 'test-xpslot-admin');
    await S.sorgeFuerKonfiguration();
  });

  // --- Grundstellung -------------------------------------------------------

  it('legt die Grundstellung samt acht Symbolen an', async () => {
    const konfig = await S.leseKonfiguration();
    expect(konfig.config.status).toBe('DISABLED');
    expect(konfig.symbole).toHaveLength(8);
    expect(konfig.symbole.map((zeile) => zeile.role).sort()).toEqual([
      'JACKPOT',
      'NORMAL',
      'NORMAL',
      'NORMAL',
      'NORMAL',
      'PREMIUM',
      'SCATTER',
      'WILD',
    ]);
  });

  it('ist idempotent - ein zweiter Aufruf ändert nichts', async () => {
    await S.sorgeFuerKonfiguration();
    await S.sorgeFuerKonfiguration();
    expect(await prisma.xpSlotConfig.count()).toBe(1);
    expect(await prisma.xpSlotSymbol.count()).toBe(8);
  });

  it('startet in der Zielspanne', async () => {
    const rtp = S.rtpVon(await S.leseKonfiguration());
    expect(S.rtpLage(rtp.rtp)).toBe('im_ziel');
  });

  it('ist abgeschaltet nicht spielbar', async () => {
    const zustand = S.istSpielbar(await S.leseKonfiguration());
    expect(zustand.ok).toBe(false);
    expect(zustand.grund).toContain('abgeschaltet');
  });

  // --- Status --------------------------------------------------------------

  it('setzt den Status und protokolliert ihn', async () => {
    await S.setzeStatus('ACTIVE', null, TEAM);
    expect(S.istSpielbar(await S.leseKonfiguration()).ok).toBe(true);

    await S.setzeStatus('MAINTENANCE', 'Kurz weg.', TEAM);
    const zustand = S.istSpielbar(await S.leseKonfiguration());
    expect(zustand.ok).toBe(false);
    expect(zustand.grund).toBe('Kurz weg.');

    const protokoll = await prisma.auditLog.findMany({ where: { action: 'XP_SLOT_STATUS_CHANGED' } });
    expect(protokoll).toHaveLength(2);
  });

  it('lässt sich nicht aktivieren, wenn kein Symbol ein Gewicht hat', async () => {
    await prisma.xpSlotSymbol.updateMany({ data: { weight: 0 } });
    await expect(S.setzeStatus('ACTIVE', null, TEAM)).rejects.toThrow(/nicht spielen/u);
  });

  // --- Konfiguration -------------------------------------------------------

  it('speichert Einsätze und Grenzen', async () => {
    const rtp = await S.speichereKonfig(
      await eingabe({ einsaetze: [5, 10, 20], minEinsatz: 5, maxEinsatz: 20, maxTagesverlust: 500 }),
      TEAM,
    );
    expect(rtp.rtp).toBeGreaterThan(0);

    const konfig = await S.leseKonfiguration();
    expect(konfig.wirksam.einsaetze).toEqual([5, 10, 20]);
    expect(konfig.wirksam.maxTagesverlust).toBe(500);
  });

  it('weist widersprüchliche Grenzen ab', async () => {
    await expect(S.speichereKonfig(await eingabe({ minEinsatz: 500, maxEinsatz: 10 }), TEAM)).rejects.toThrow(
      /kleinste Einsatz liegt über dem grössten/u,
    );

    await expect(
      S.speichereKonfig(await eingabe({ einsaetze: [1000], minEinsatz: 10, maxEinsatz: 100 }), TEAM),
    ).rejects.toThrow(/liesse sich nicht spielen/u);

    await expect(S.speichereKonfig(await eingabe({ tierGross: 30, tierMega: 10 }), TEAM)).rejects.toThrow(
      /Mega-Schwelle/u,
    );

    await expect(
      S.speichereKonfig(await eingabe({ bonusFreispiele: 12, leiter1: 10 }), TEAM),
    ).rejects.toThrow(/erste Risikostufe/u);
  });

  it('protokolliert jede Änderung an den Spielregeln', async () => {
    await S.speichereKonfig(await eingabe({ maxTagesgewinn: 1000 }), TEAM);
    const protokoll = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'XP_SLOT_CONFIG_UPDATED' },
    });
    expect(protokoll.actorDiscordId).toBe(TEAM.discordId);
    expect(protokoll.metadata).toMatchObject({ rtp: expect.any(Number) });
  });

  // --- Symbole und Paytable -----------------------------------------------

  it('ändert ein Symbol und meldet die neue Quote', async () => {
    const vorher = S.rtpVon(await S.leseKonfiguration()).rtp;
    const { rtp } = await S.speichereSymbol(
      {
        key: 'eins',
        name: 'Eins',
        aktiv: true,
        gewicht: 30,
        glow: false,
        bildPfad: null,
        bildUrl: null,
        auszahlung3: 5000,
        auszahlung4: 20_000,
        auszahlung5: 60_000,
        premiumTage3: 0,
        premiumTage4: 0,
        premiumTage5: 0,
      },
      TEAM,
    );
    expect(rtp.rtp).toBeGreaterThan(vorher);

    const protokoll = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'XP_SLOT_SYMBOL_UPDATED' },
    });
    expect(protokoll.targetLabel).toContain('eins');
  });

  it('ändert die Rolle eines Symbols nicht', async () => {
    await S.speichereSymbol(
      {
        key: 'wild',
        name: 'Joker',
        aktiv: true,
        gewicht: 7,
        glow: true,
        bildPfad: null,
        bildUrl: null,
        auszahlung3: 0,
        auszahlung4: 0,
        auszahlung5: 0,
        premiumTage3: 0,
        premiumTage4: 0,
        premiumTage5: 0,
      },
      TEAM,
    );
    const zeile = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'wild' } });
    expect(zeile.name).toBe('Joker');
    expect(zeile.role).toBe('WILD');
  });

  it('nimmt ein abgeschaltetes Symbol von den Walzen', async () => {
    await S.speichereSymbol(
      {
        key: 'zehn',
        name: '10',
        aktiv: false,
        gewicht: 11,
        glow: true,
        bildPfad: null,
        bildUrl: null,
        auszahlung3: 6500,
        auszahlung4: 26_500,
        auszahlung5: 106_000,
        premiumTage3: 0,
        premiumTage4: 0,
        premiumTage5: 0,
      },
      TEAM,
    );
    const konfig = await S.leseKonfiguration();
    const zehn = konfig.regeln.symbole.find((eintrag) => eintrag.key === 'zehn');
    expect(zehn?.gewicht).toBe(0);
    // Und es erscheint nicht in der Ansicht.
    const ansicht = await S.slotAnsicht(konfig);
    expect(ansicht.symbole.map((eintrag) => eintrag.key)).not.toContain('zehn');
  });

  it('speichert die Auszahlungstabelle samt Jackpot und verschiebt die Quote', async () => {
    const vorher = S.rtpVon(await S.leseKonfiguration());
    const konfig = await S.leseKonfiguration();
    const rtp = await S.speicherePaytable(
      {
        jackpotMultiplikator: 1000,
        zeilen: konfig.symbole.map((zeile) => ({
          key: zeile.key,
          auszahlung3: zeile.payout3Bp * 2,
          auszahlung4: zeile.payout4Bp * 2,
          auszahlung5: zeile.payout5Bp * 2,
          premiumTage3: zeile.premiumDays3,
          premiumTage4: zeile.premiumDays4,
          premiumTage5: zeile.premiumDays5,
        })),
      },
      TEAM,
    );
    expect(rtp.rtp).toBeGreaterThan(vorher.rtp);
    expect((await S.leseKonfiguration()).wirksam.jackpotMultiplikator).toBe(1000);

    const protokoll = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'XP_SLOT_PAYTABLE_UPDATED' },
    });
    expect(protokoll.metadata).toMatchObject({ jackpot: 1000 });
  });

  it('weist eine Auszahlungstabelle mit unbekanntem Symbol ab', async () => {
    await expect(
      S.speicherePaytable(
        {
          jackpotMultiplikator: 500,
          zeilen: [
            {
              key: 'erfunden',
              auszahlung3: 1,
              auszahlung4: 1,
              auszahlung5: 1,
              premiumTage3: 0,
              premiumTage4: 0,
              premiumTage5: 0,
            },
          ],
        },
        TEAM,
      ),
    ).rejects.toThrow(/gibt es nicht/u);
  });

  // --- Sound-Pakete --------------------------------------------------------

  it('legt ein Paket an, benennt es und löscht es', async () => {
    const paket = await S.legePaketAn('Standard', 'STANDARD', TEAM);
    await S.benennePaket(paket.id, 'Hausklang', 'SPECIAL', TEAM);
    const nachher = await prisma.xpSlotSoundPack.findUniqueOrThrow({ where: { id: paket.id } });
    expect(nachher.name).toBe('Hausklang');
    expect(nachher.kind).toBe('SPECIAL');

    await S.loeschePaket(paket.id, TEAM);
    expect(await prisma.xpSlotSoundPack.count()).toBe(0);

    const protokoll = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'XP_SLOT_SOUNDPACK' } },
    });
    expect(protokoll).toHaveLength(3);
  });

  it('löscht das aktive Paket nicht', async () => {
    const paket = await S.legePaketAn('Standard', 'STANDARD', TEAM);
    await S.speichereDesign(
      {
        hintergrundPfad: null,
        hintergrundUrl: null,
        logoPfad: null,
        logoUrl: null,
        akzentfarbe: '#83060a',
        overlay: 40,
        glow: 60,
        knopfStil: 'puls',
        soundPackId: paket.id,
      },
      TEAM,
    );
    await expect(S.loeschePaket(paket.id, TEAM)).rejects.toThrow(/aktive Sound-Paket/u);
  });

  it('weist einen unbekannten Klangslot ab', async () => {
    const paket = await S.legePaketAn('Standard', 'STANDARD', TEAM);
    await expect(
      S.setzeKlang(paket.id, 'erfunden', 'slotsound-' + 'a'.repeat(32) + '.mp3', TEAM),
    ).rejects.toThrow(/Klangslot/u);
  });

  it('gibt die Klänge eines Pakets für die Oberfläche heraus', async () => {
    const paket = await S.legePaketAn('Standard', 'STANDARD', TEAM);
    await prisma.xpSlotSound.create({
      data: {
        packId: paket.id,
        slot: 'jackpot',
        filePath: `slotsound-${'b'.repeat(32)}.mp3`,
        volume: 90,
        enabled: true,
      },
    });
    await prisma.xpSlotSound.create({
      data: {
        packId: paket.id,
        slot: 'reel_stop',
        filePath: `slotsound-${'c'.repeat(32)}.mp3`,
        enabled: false,
      },
    });

    const klaenge = await S.klaengeDesPakets(paket.id);
    // Nur der eingeschaltete - ein abgeschalteter Slot ist still.
    expect(klaenge).toHaveLength(1);
    expect(klaenge[0]).toMatchObject({ slot: 'jackpot', lautstaerke: 90, musik: false });
  });

  it('kommt ohne Paket aus - dann ist alles still', async () => {
    expect(await S.klaengeDesPakets(null)).toEqual([]);
  });

  // --- Eventmodus ----------------------------------------------------------

  it('überschreibt Werte nur, solange das Event läuft', async () => {
    const event = await S.legeEventAn(
      {
        name: 'Herbstfest',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: { jackpotMultiplikator: 2000, einsaetze: [50, 100] },
        symbolwerte: {},
      },
      TEAM,
    );

    // Noch nicht aktiv: die Grundstellung gilt.
    expect((await S.leseKonfiguration()).wirksam.jackpotMultiplikator).toBe(500);

    await S.aktiviereEvent(event.id, TEAM);
    const mitEvent = await S.leseKonfiguration();
    expect(mitEvent.wirksam.jackpotMultiplikator).toBe(2000);
    expect(mitEvent.wirksam.einsaetze).toEqual([50, 100]);
    expect(mitEvent.event?.name).toBe('Herbstfest');

    await S.beendeEvent(event.id, TEAM);
    const danach = await S.leseKonfiguration();
    // Automatisch zurueck - niemand musste etwas zuruecksetzen.
    expect(danach.wirksam.jackpotMultiplikator).toBe(500);
    expect(danach.event).toBeNull();
  });

  it('wirkt nach dem Enddatum nicht mehr und wird aufgeräumt', async () => {
    const event = await S.legeEventAn(
      {
        name: 'Kurz',
        beschreibung: null,
        von: null,
        bis: new Date(Date.now() + 60_000),
        soundPackId: null,
        ueberschreibungen: { jackpotMultiplikator: 3000 },
        symbolwerte: {},
      },
      TEAM,
    );
    await S.aktiviereEvent(event.id, TEAM);
    expect((await S.leseKonfiguration()).wirksam.jackpotMultiplikator).toBe(3000);

    await prisma.xpSlotEvent.update({
      where: { id: event.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    // Ohne jeden Aufraeumlauf: der Zeitraum entscheidet.
    expect((await S.leseKonfiguration()).wirksam.jackpotMultiplikator).toBe(500);

    expect(await S.beendeAbgelaufeneEvents()).toBe(1);
    const zeile = await prisma.xpSlotEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(zeile.active).toBe(false);
  });

  it('lässt immer höchstens ein Event laufen', async () => {
    const eins = await S.legeEventAn(
      {
        name: 'Eins',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: {},
      },
      TEAM,
    );
    const zwei = await S.legeEventAn(
      {
        name: 'Zwei',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: {},
      },
      TEAM,
    );

    await S.aktiviereEvent(eins.id, TEAM);
    await S.aktiviereEvent(zwei.id, TEAM);

    const aktive = await prisma.xpSlotEvent.findMany({ where: { active: true } });
    expect(aktive).toHaveLength(1);
    expect(aktive[0]?.id).toBe(zwei.id);
  });

  it('prüft vor der Aktivierung und blockiert nur, was nicht aufgeht', async () => {
    const kaputt = await S.legeEventAn(
      {
        name: 'Unmöglich',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        // Ein Bonus, der die Runde nie enden laesst.
        ueberschreibungen: { retriggerSpins: 25 },
        symbolwerte: { bonus: { gewicht: 200 } },
      },
      TEAM,
    );

    const pruefung = await S.pruefeEvent(kaputt.id);
    expect(pruefung.ok).toBe(false);
    expect(pruefung.fehler.join(' ')).toContain('nicht endet');
    await expect(S.aktiviereEvent(kaputt.id, TEAM)).rejects.toThrow(/nicht endet/u);
  });

  it('warnt bei einer Quote ausserhalb der Zielspanne, blockiert aber nicht', async () => {
    const grosszuegig = await S.legeEventAn(
      {
        name: 'Grosszügig',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: { eins: { auszahlung: [8000, 32_000, 104_000] } },
      },
      TEAM,
    );

    const pruefung = await S.pruefeEvent(grosszuegig.id);
    expect(pruefung.ok).toBe(true);
    expect(pruefung.warnungen.join(' ')).toMatch(/Zielspanne/u);
    await expect(S.aktiviereEvent(grosszuegig.id, TEAM)).resolves.toBeDefined();
  });

  it('blockiert Premium ohne Premium-Auszahlung', async () => {
    const event = await S.legeEventAn(
      {
        name: 'Premium ohne Tage',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: { premiumAktiv: true },
        symbolwerte: { premium: { premiumTage: [0, 0, 0] } },
      },
      TEAM,
    );

    const pruefung = await S.pruefeEvent(event.id);
    expect(pruefung.ok).toBe(false);
    expect(pruefung.fehler.join(' ')).toContain('keine Tage');
  });

  it('blockiert eine unbekannte Symbolkennung', async () => {
    const event = await S.legeEventAn(
      {
        name: 'Tippfehler',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: { eisn: { gewicht: 50 } },
      },
      TEAM,
    );
    const pruefung = await S.pruefeEvent(event.id);
    expect(pruefung.ok).toBe(false);
    expect(pruefung.fehler.join(' ')).toContain('eisn');
  });

  it('blockiert ein Bild, das diese Anwendung nie erzeugt hat', async () => {
    const event = await S.legeEventAn(
      {
        name: 'Fremdes Bild',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: { eins: { bildPfad: '../../etc/passwd' } },
      },
      TEAM,
    );
    const pruefung = await S.pruefeEvent(event.id);
    expect(pruefung.ok).toBe(false);
    expect(pruefung.fehler.join(' ')).toContain('Namen');
  });

  it('ignoriert Überschreibungen, die nicht zum Schema passen', async () => {
    const event = await prisma.xpSlotEvent.create({
      data: {
        name: 'Aus der Zukunft',
        active: true,
        // Ein Feld, das es nicht gibt - etwa aus einer neueren Fassung.
        overrides: { jackpotMultiplikatorNeu: 9999 },
      },
    });
    const konfig = await S.leseKonfiguration();
    expect(konfig.event?.id).toBe(event.id);
    // Die Grundstellung gilt - und nicht ein halbgarer Wert.
    expect(konfig.wirksam.jackpotMultiplikator).toBe(500);
  });

  it('schaltet Premium ohne Event nicht ein', async () => {
    await S.speichereKonfig(await eingabe({ premiumAktiv: true }), TEAM);
    const konfig = await S.leseKonfiguration();
    // Die Einstellung steht, wirkt aber nicht: so steht es im Konzept.
    expect(konfig.config.premiumEnabled).toBe(true);
    expect(konfig.wirksam.premiumAktiv).toBe(false);
    expect(konfig.regeln.premiumAktiv).toBe(false);
  });

  it('schaltet Premium mit laufendem Event ein', async () => {
    await S.speichereKonfig(await eingabe({ premiumAktiv: true }), TEAM);
    const event = await S.legeEventAn(
      {
        name: 'Premium-Woche',
        beschreibung: null,
        von: null,
        bis: null,
        soundPackId: null,
        ueberschreibungen: {},
        symbolwerte: {},
      },
      TEAM,
    );
    await S.aktiviereEvent(event.id, TEAM);

    const konfig = await S.leseKonfiguration();
    expect(konfig.wirksam.premiumAktiv).toBe(true);
    const premiumSymbol = konfig.regeln.symbole.find((eintrag) => eintrag.rolle === 'PREMIUM');
    expect(premiumSymbol?.gewicht).toBeGreaterThan(0);
  });

  // --- Premium-Gutschrift --------------------------------------------------

  it('schreibt einen Premium-Gewinn über das bestehende Premium-System gut', async () => {
    await premium.seedProducts();
    const benutzer = await prisma.user.create({
      data: { discordId: SPIELER, username: 'spielerin' },
    });

    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'PAID',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'premium'),
        lines: [],
        grossWin: 0,
        netWin: -100,
        premiumDays: 7,
        xpBefore: 1000,
        xpAfter: 900,
      },
    });
    await S.gutschreibePremium(spin);

    const gewinne = await S.premiumGewinne(SPIELER);
    expect(gewinne).toHaveLength(1);
    expect(gewinne[0]).toMatchObject({ tage: 7, zustand: 'CREDITED' });

    // Ein gewoehnliches Abonnement - kein zweiter Premium-Lebenszyklus.
    const abo = await prisma.premiumSubscription.findFirstOrThrow({
      where: { userId: benutzer.id },
    });
    expect(abo.status).toBe('ACTIVE');
    expect(abo.provider).toBe('xp-slot');
    expect(abo.currentPeriodEnd).not.toBeNull();

    const protokoll = await prisma.auditLog.findMany({
      where: { action: 'XP_SLOT_PREMIUM_GRANTED' },
    });
    expect(protokoll).toHaveLength(1);
  });

  it('merkt den Gewinn vor, wenn schon Premium läuft - und holt ihn nach', async () => {
    await premium.seedProducts();
    const benutzer = await prisma.user.create({
      data: { discordId: SPIELER, username: 'spielerin' },
    });
    // Ein bereits laufendes Abonnement.
    const produkt = await prisma.premiumProduct.findFirstOrThrow();
    const laufend = await prisma.premiumSubscription.create({
      data: {
        userId: benutzer.id,
        discordId: SPIELER,
        productId: produkt.id,
        status: 'ACTIVE',
        activeUserKey: benutzer.id,
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        provider: 'mock',
      },
    });

    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'PAID',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'premium'),
        lines: [],
        premiumDays: 3,
        xpBefore: 0,
        xpAfter: 0,
      },
    });
    await S.gutschreibePremium(spin);

    const vorgemerkt = await S.premiumGewinne(SPIELER);
    expect(vorgemerkt[0]).toMatchObject({ tage: 3, zustand: 'QUEUED' });
    // Kein zweites Abonnement.
    expect(await prisma.premiumSubscription.count()).toBe(1);

    // Das laufende Abonnement endet - der Merkzettel wird eingelöst.
    await prisma.premiumSubscription.update({
      where: { id: laufend.id },
      data: { status: 'EXPIRED', activeUserKey: null },
    });
    const nachgeholt = await S.holeVorgemerkteNach();
    expect(nachgeholt.gebucht).toBe(1);
    expect(nachgeholt.offen).toBe(0);
    expect((await S.premiumGewinne(SPIELER))[0]?.zustand).toBe('CREDITED');
  });

  it('schreibt aus einem Testlauf kein Premium gut', async () => {
    await premium.seedProducts();
    await prisma.user.create({ data: { discordId: SPIELER, username: 'spielerin' } });
    const spin = await prisma.xpSlotSpin.create({
      data: {
        discordId: SPIELER,
        kind: 'TEST',
        bet: 100,
        grid: Array.from({ length: 15 }, () => 'premium'),
        lines: [],
        premiumDays: 7,
        xpBefore: 0,
        xpAfter: 0,
      },
    });
    await S.gutschreibePremium(spin);
    expect(await prisma.xpSlotPremiumGrant.count()).toBe(0);
    expect(await prisma.premiumSubscription.count()).toBe(0);
  });

  // --- Ansicht -------------------------------------------------------------

  it('gibt der Oberfläche alles, was zur Entscheidung gehört', async () => {
    await S.setzeStatus('ACTIVE', null, TEAM);
    const ansicht = await S.slotAnsicht();
    expect(ansicht.spielbar).toBe(true);
    expect(ansicht.linien).toHaveLength(10);
    expect(ansicht.symbole.length).toBeGreaterThan(0);
    expect(ansicht.rtp).toBeGreaterThan(0.5);
    expect(ansicht.einsaetze.length).toBeGreaterThan(0);
    expect(ansicht.leiter).toHaveLength(2);
    expect(ansicht.maxGewinnMultiplikator).toBeGreaterThan(0);
  });

  it('nennt der Oberfläche den Grund, wenn nicht gespielt werden kann', async () => {
    await S.setzeStatus('MAINTENANCE', 'Wartung läuft.', TEAM);
    const ansicht = await S.slotAnsicht();
    expect(ansicht.spielbar).toBe(false);
    expect(ansicht.grund).toBe('Wartung läuft.');
  });

  it('schlägt den kleinsten Einsatz vor', async () => {
    await S.setzeStatus('ACTIVE', null, TEAM);
    const spieler = await S.spielerAnsicht(SPIELER);
    expect(spieler.einsatz).toBe(10);
    expect(spieler.xp).toBe(0);
  });

  it('schlägt bei offenen Freispielen deren festen Einsatz vor', async () => {
    await S.setzeStatus('ACTIVE', null, TEAM);
    const konfig = await S.leseKonfiguration();
    await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 3, einsatz: 250 },
      konfig.wirksam.einsaetze,
      TEAM,
    );
    const spieler = await S.spielerAnsicht(SPIELER);
    expect(spieler.freispieleOffen).toBe(3);
    expect(spieler.freispielEinsatz).toBe(250);
    expect(spieler.einsatz).toBe(250);
  });
});
