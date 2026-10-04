import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot_geschenke');

/**
 * Geschenkte Freispiele und geschenkte Bonusspiele.
 *
 * ## Was hier geprueft wird
 *
 * Die Zusagen, die eine Oberflaeche nicht halten kann, weil sie den Zustand
 * nicht besitzt:
 *
 *  - Die Ankuendigung kommt **einmal**. Nicht einmal je Browser, nicht
 *    einmal je Neuladen - einmal. Darum steht der Haken in der Zeile.
 *  - Der Gewinn eines Pakets wird **im Paket** gezaehlt und nicht aus der
 *    Slot-Historie geschaetzt. «Du hast mit deinen Freispielen 4'250 XP
 *    gewonnen» ist eine Behauptung ueber genau diese zehn Spins; eine Summe
 *    ueber alles waere eine andere Zahl, und niemand koennte den Unterschied
 *    sehen.
 *  - Nach dem letzten Freispiel kommt der Abschluss, und danach kostet ein
 *    Spin wieder XP.
 *  - Ein geschenktes Bonusspiel startet **dieselbe** Bonusrunde wie ein
 *    Scatter-Treffer: erste Leiterstufe, nehmen oder riskieren. Keine zweite
 *    Bonuslogik.
 *  - Mehr als ein offenes Bonusgeschenk je Person gibt es nicht.
 *
 * ## Warum die Zufallsquelle hereingegeben wird
 *
 * Damit jeder Spin nachrechenbar ist. Was hier zaehlt, ist nicht **ob**
 * gewonnen wurde, sondern dass die gezaehlte Summe zu den gespielten Spins
 * passt - und das prueft der Test, indem er mitzaehlt.
 */
const { prisma } = await import('@swisshub/database');
const { level, quelleAusSeed, setModuleEnabled } = await import('@swisshub/modules');
const { setDiscordGateway } = await import('@swisshub/discord');

const S = level.xpslot;

const SPIELER = '900000000000011001';
const TEAM = { discordId: '900000000000011099', username: 'teamler' };

function attrappe(): void {
  setDiscordGateway({
    channels: {
      async send() {
        return { id: 'nachricht' };
      },
      async list() {
        return [];
      },
    },
  } as never);
}

const schluessel = (): string => `geschenk-${Math.random().toString(36).slice(2, 14)}`;

async function leere(): Promise<void> {
  await prisma.xpSlotPremiumGrant.deleteMany();
  await prisma.xpSlotBonusRound.deleteMany();
  await prisma.xpSlotBonusGrant.deleteMany();
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

/** Die spielbaren Einsaetze der aktuellen Konfiguration. */
async function einsaetze(): Promise<number[]> {
  return [...(await S.leseKonfiguration()).wirksam.einsaetze];
}

describeWithDatabase('XP-Slot: Geschenke', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await leere();
    attrappe();
    await setModuleEnabled(level.LEVEL_MODULE_ID, true, 'test-geschenke');
    await S.sorgeFuerKonfiguration();
    await S.setzeStatus('ACTIVE', null, TEAM);
    await prisma.levelProfile.upsert({
      where: { discordId: SPIELER },
      create: { discordId: SPIELER, xp: 200_000 },
      update: { xp: 200_000 },
    });
  });

  // --- Geschenkte Freispiele ----------------------------------------------

  it('kündigt ein geschenktes Paket genau einmal an', async () => {
    const [einsatz] = await einsaetze();
    await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 10, einsatz: einsatz!, laeuftAb: null, grund: 'Community Event' },
      await einsaetze(),
      TEAM,
    );

    const erste = await S.offeneFreispielMeldung(SPIELER);
    expect(erste).not.toBeNull();
    expect(erste?.anzahl).toBe(10);
    expect(erste?.einsatz).toBe(einsatz);
    expect(erste?.grund).toBe('Community Event');

    await S.merkeFreispielMeldung(SPIELER, erste!.paketId, 'intro');
    expect(await S.offeneFreispielMeldung(SPIELER)).toBeNull();

    // Und ein zweiter Haken aendert nichts - das ist der Doppelklick.
    await S.merkeFreispielMeldung(SPIELER, erste!.paketId, 'intro');
    expect(await S.offeneFreispielMeldung(SPIELER)).toBeNull();
  });

  it('zählt den Gewinn im Paket und nicht über die ganze Historie', async () => {
    const [einsatz] = await einsaetze();
    const alle = await einsaetze();
    /*
     * Erst ein bezahlter Spin - er darf in der Paketsumme **nicht**
     * auftauchen. Genau das wäre der Fehler, den eine Summe über die
     * Slot-Historie machen würde.
     */
    const bezahlt = await S.dreheSpin({
      discordId: SPIELER,
      einsatz: einsatz!,
      schluessel: schluessel(),
      random: quelleAusSeed('bezahlt'),
    });

    await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 3, einsatz: einsatz!, laeuftAb: null, grund: null },
      alle,
      TEAM,
    );

    let ausFreispielen = 0;
    for (let runde = 0; runde < 3; runde += 1) {
      const spin = await S.dreheSpin({
        discordId: SPIELER,
        einsatz: einsatz!,
        schluessel: schluessel(),
        random: quelleAusSeed(`frei-${runde}`),
      });
      expect(spin.art).toBe('FREESPIN_PACKAGE');
      ausFreispielen += spin.gewinn;
    }

    const paket = await prisma.xpSlotFreespinPackage.findFirstOrThrow({
      where: { discordId: SPIELER },
    });
    expect(paket.packageWin).toBe(ausFreispielen);
    expect(paket.remaining).toBe(0);
    // Der bezahlte Spin steht nicht darin - ausser er war ohnehin null.
    if (bezahlt.gewinn > 0) {
      expect(paket.packageWin).not.toBe(ausFreispielen + bezahlt.gewinn);
    }
  });

  it('meldet den Abschluss mit der Paketsumme - und dann kostet es wieder XP', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    await S.gewaehreFreispiele(
      { discordId: SPIELER, anzahl: 2, einsatz, laeuftAb: null, grund: 'Dankeschön' },
      alle,
      TEAM,
    );

    let summe = 0;
    for (let runde = 0; runde < 2; runde += 1) {
      const spin = await S.dreheSpin({
        discordId: SPIELER,
        einsatz,
        schluessel: schluessel(),
        random: quelleAusSeed(`abschluss-${runde}`),
      });
      summe += spin.gewinn;
    }

    const abschluss = await S.offenerFreispielAbschluss(SPIELER);
    expect(abschluss).not.toBeNull();
    expect(abschluss?.gespielt).toBe(2);
    expect(abschluss?.gewinn).toBe(summe);
    expect(abschluss?.einsatz).toBe(einsatz);
    expect(abschluss?.grund).toBe('Dankeschön');

    // Einmal: nach dem Haken ist er weg.
    await S.merkeFreispielMeldung(SPIELER, abschluss!.paketId, 'abschluss');
    expect(await S.offenerFreispielAbschluss(SPIELER)).toBeNull();

    // Und der nächste Spin ist wieder ein bezahlter.
    const vorher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    const danach = await S.dreheSpin({
      discordId: SPIELER,
      einsatz,
      schluessel: schluessel(),
      random: quelleAusSeed('wieder-bezahlt'),
    });
    expect(danach.art).toBe('PAID');
    const nachher = await prisma.levelProfile.findUniqueOrThrow({ where: { discordId: SPIELER } });
    expect(nachher.xp).toBe(vorher.xp - einsatz + danach.gewinn);
  });

  // --- Geschenktes Bonusspiel ---------------------------------------------

  it('kündigt ein Bonusgeschenk an und startet daraus die gewöhnliche Bonusrunde', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    await S.schenkeBonus(
      { discordId: SPIELER, einsatz, laeuftAb: null, grund: 'Community Event' },
      alle,
      TEAM,
    );

    const intro = await S.offeneBonusMeldung(SPIELER);
    expect(intro).not.toBeNull();
    expect(intro?.einsatz).toBe(einsatz);
    expect(intro?.grund).toBe('Community Event');
    // Die Zahl im Text kommt aus der Leiter und nicht aus dem Browser.
    expect(intro?.freispiele).toBeGreaterThan(0);

    const { bonus } = await S.starteGeschenktenBonus(SPIELER, intro!.grantId);
    // Dieselbe Runde wie nach einem Scatter-Treffer: erste Leiterstufe.
    expect(bonus.stufe).toBe('LADDER_1');
    expect(bonus.einsatz).toBe(einsatz);

    // Die Ankündigung kommt nicht wieder.
    expect(await S.offeneBonusMeldung(SPIELER)).toBeNull();

    const runde = await prisma.xpSlotBonusRound.findFirstOrThrow({ where: { discordId: SPIELER } });
    expect(runde.grantId).not.toBeNull();
    // Kein erfundener Spin in der Historie, nur weil die Spalte sonst leer wäre.
    expect(runde.triggerSpinId).toBeNull();
    expect(await prisma.xpSlotSpin.count({ where: { discordId: SPIELER } })).toBe(0);
  });

  it('lässt kein zweites offenes Bonusgeschenk zu', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    await S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM);

    await expect(
      S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM),
    ).rejects.toThrow(/noch ein geschenktes Bonusspiel offen/u);

    // Auch während es läuft nicht - mit der anderen Begründung.
    const intro = await S.offeneBonusMeldung(SPIELER);
    await S.starteGeschenktenBonus(SPIELER, intro!.grantId);
    await expect(
      S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM),
    ).rejects.toThrow(/spielt gerade/u);

    expect(await prisma.xpSlotBonusGrant.count({ where: { discordId: SPIELER } })).toBe(1);
  });

  it('spielt ein geschenktes Bonusspiel durch und meldet den Abschluss mit der Rundensumme', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    await S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM);
    const intro = await S.offeneBonusMeldung(SPIELER);
    await S.starteGeschenktenBonus(SPIELER, intro!.grantId);

    const runde = await prisma.xpSlotBonusRound.findFirstOrThrow({ where: { discordId: SPIELER } });
    const { bonus } = await S.nimmFreispiele(SPIELER, runde.id);
    expect(bonus.stufe).toBe('SPINS');
    const zugesagt = bonus.offen;
    expect(zugesagt).toBeGreaterThan(0);

    let summe = 0;
    let letzter: Awaited<ReturnType<typeof S.dreheSpin>> | null = null;
    for (let gespielt = 0; gespielt < zugesagt + 20; gespielt += 1) {
      const offen = await prisma.xpSlotBonusRound.findUniqueOrThrow({ where: { id: runde.id } });
      if (offen.finishedAt !== null) {
        break;
      }
      letzter = await S.dreheSpin({
        discordId: SPIELER,
        einsatz,
        schluessel: schluessel(),
        random: quelleAusSeed(`bonus-${gespielt}`),
      });
      expect(letzter.art).toBe('BONUS_ROUND');
      summe += letzter.gewinn;
    }

    const fertig = await prisma.xpSlotBonusRound.findUniqueOrThrow({ where: { id: runde.id } });
    expect(fertig.finishedAt).not.toBeNull();
    // Serverseitig gezählt, über die ganze Runde - nicht im Browser summiert.
    expect(fertig.totalWin).toBe(summe);
    expect(fertig.played).toBe(fertig.awarded);

    // Der Spin, der die Runde beendet, bringt die Abschlusswerte gleich mit.
    expect(letzter?.bonusEnde).not.toBeNull();
    expect(letzter?.bonusEnde?.gewinn).toBe(summe);
    expect(letzter?.bonusEnde?.geschenkt).toBe(true);
    expect(letzter?.bonusEnde?.verloren).toBe(false);

    // Und er steht auch noch offen, falls jemand neu lädt.
    const offen = await S.offenerBonusAbschluss(SPIELER);
    expect(offen?.rundeId).toBe(runde.id);
    await S.merkeBonusAbschluss(SPIELER, runde.id);
    expect(await S.offenerBonusAbschluss(SPIELER)).toBeNull();

    // Das Geschenk ist durch: ein neues ist jetzt erlaubt.
    const zeile = await prisma.xpSlotBonusGrant.findFirstOrThrow({ where: { discordId: SPIELER } });
    expect(zeile.status).toBe('FINISHED');
    await expect(
      S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM),
    ).resolves.toBeTruthy();
  });

  it('entzieht ein angekündigtes Bonusgeschenk und schreibt es ins Audit', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    const geschenk = await S.schenkeBonus(
      { discordId: SPIELER, einsatz, laeuftAb: null, grund: null },
      alle,
      TEAM,
    );
    await S.entzieheBonus(geschenk.id, TEAM);

    expect(await S.offeneBonusMeldung(SPIELER)).toBeNull();
    const zeile = await prisma.xpSlotBonusGrant.findUniqueOrThrow({ where: { id: geschenk.id } });
    expect(zeile.status).toBe('REVOKED');

    const eintraege = await prisma.auditLog.findMany({ where: { module: 'level' } });
    const aktionen = eintraege.map((eintrag) => eintrag.action);
    expect(aktionen).toContain('XP_SLOT_BONUS_GRANTED');
    expect(aktionen).toContain('XP_SLOT_BONUS_REVOKED');
  });

  it('lässt ein abgelaufenes Bonusgeschenk nicht mehr starten', async () => {
    const alle = await einsaetze();
    const einsatz = alle[0]!;
    const geschenk = await S.schenkeBonus(
      { discordId: SPIELER, einsatz, laeuftAb: new Date(Date.now() + 60_000), grund: null },
      alle,
      TEAM,
    );

    // Die Frist nachträglich in die Vergangenheit setzen - das Ablaufen
    // selbst lässt sich nicht herbeiwarten.
    await prisma.xpSlotBonusGrant.update({
      where: { id: geschenk.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await S.offeneBonusMeldung(SPIELER)).toBeNull();
    await expect(S.starteGeschenktenBonus(SPIELER, geschenk.id)).rejects.toThrow();

    /*
     * Und es blockiert kein neues - auch bevor die Pflege gelaufen ist.
     *
     * Die Frist zaehlt, nicht der Status. Stuende hier eine Sperre, haette
     * eine Person mit einem abgelaufenen Geschenk nie wieder eines bekommen,
     * bis irgendwann ein Hintergrundlauf den Status umgestellt hat.
     */
    await expect(
      S.schenkeBonus({ discordId: SPIELER, einsatz, laeuftAb: null, grund: null }, alle, TEAM),
    ).resolves.toBeTruthy();

    await S.markiereAbgelaufeneGeschenke();
    const zeile = await prisma.xpSlotBonusGrant.findUniqueOrThrow({ where: { id: geschenk.id } });
    expect(zeile.status).toBe('EXPIRED');
  });
});
