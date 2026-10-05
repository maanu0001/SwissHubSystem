import { beforeAll, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot_symbolbild');

/**
 * Ein eigenes Symbolbild bleibt eigen.
 *
 * ## Der Fehler, den dieser Test festnagelt
 *
 * Hochgeladene Symbol-PNGs kamen nicht an: Upload erfolgreich, Vorschau neu,
 * nach dem Neuladen wieder das alte Bild. Nachgemessen lag die Datei im
 * Upload-Verzeichnis und der Auslieferungspfad stimmte - verloren ging die
 * **Referenz**, weil sie nur im Formularzustand des Browsers stand und erst
 * ein zweiter Klick auf «Speichern» sie in die Datenbank schrieb.
 *
 * Der Upload speichert jetzt selbst, über `setzeSymbolbild`. Dieser Test
 * prüft die Stufe, die damals nie erreicht wurde: schreiben, neu lesen, und
 * zwar ohne die übrigen Felder des Symbols anzufassen.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const AKTEUR = { discordId: '100000000000000071', username: 'symboltest' };
const BILD = 'slotsymbol-00112233445566778899aabbccddeeff.png';
const ZWEITES = 'slotsymbol-ffeeddccbbaa99887766554433221100.png';

describeWithDatabase('XP-Slot: Symbolbild', () => {
  beforeAll(async () => {
    await pushSchema();
    // Legt Konfiguration und die acht Standardsymbole an.
    await level.xpslot.leseKonfiguration();
  });

  it('schreibt die Referenz und liest sie wieder', async () => {
    const S = level.xpslot;
    const vorher = await prisma.xpSlotSymbol.findUnique({ where: { key: 'eins' } });
    expect(vorher?.imagePath ?? null).toBeNull();

    await S.setzeSymbolbild({ key: 'eins', bildPfad: BILD, bildUrl: null }, AKTEUR);

    // Frisch aus der Datenbank - nicht der Rückgabewert.
    const nachher = await prisma.xpSlotSymbol.findUnique({ where: { key: 'eins' } });
    expect(nachher?.imagePath).toBe(BILD);

    // Und so, wie die Spielansicht es liest.
    const konfiguration = await S.leseKonfiguration();
    expect(konfiguration.symbole.find((eintrag) => eintrag.key === 'eins')?.imagePath).toBe(BILD);
  });

  it('lässt Gewicht, Name und Auszahlungen unberührt', async () => {
    const S = level.xpslot;
    const vorher = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'drei' } });
    await S.setzeSymbolbild({ key: 'drei', bildPfad: BILD, bildUrl: null }, AKTEUR);
    const nachher = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'drei' } });

    expect(nachher.name).toBe(vorher.name);
    expect(nachher.weight).toBe(vorher.weight);
    expect(nachher.active).toBe(vorher.active);
    expect([nachher.payout3Bp, nachher.payout4Bp, nachher.payout5Bp]).toEqual([
      vorher.payout3Bp,
      vorher.payout4Bp,
      vorher.payout5Bp,
    ]);
  });

  it('hält mehrere Symbole unabhängig', async () => {
    const S = level.xpslot;
    await S.setzeSymbolbild({ key: 'fuenf', bildPfad: BILD, bildUrl: null }, AKTEUR);
    await S.setzeSymbolbild({ key: 'zehn', bildPfad: ZWEITES, bildUrl: null }, AKTEUR);

    const fuenf = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'fuenf' } });
    const zehn = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'zehn' } });
    expect(fuenf.imagePath).toBe(BILD);
    expect(zehn.imagePath).toBe(ZWEITES);
  });

  it('setzt auf Standard zurück, indem es die Referenz löscht', async () => {
    /*
     * Zurücksetzen kopiert nichts: das mitgelieferte Symbol liegt im
     * Auslieferungsverzeichnis und gilt immer dann, wenn in der Datenbank
     * nichts steht.
     */
    const S = level.xpslot;
    await S.setzeSymbolbild({ key: 'logo', bildPfad: BILD, bildUrl: null }, AKTEUR);
    await S.setzeSymbolbild({ key: 'logo', bildPfad: null, bildUrl: null }, AKTEUR);
    const logo = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'logo' } });
    expect(logo.imagePath).toBeNull();
    expect(logo.imageUrl).toBeNull();
  });

  it('vermerkt jede Änderung im Audit Log', async () => {
    const S = level.xpslot;
    await prisma.auditLog.deleteMany({});
    await S.setzeSymbolbild({ key: 'wild', bildPfad: BILD, bildUrl: null }, AKTEUR);
    const eintraege = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
    expect(eintraege[0]?.actorDiscordId).toBe(AKTEUR.discordId);
    expect(JSON.stringify(eintraege[0]?.metadata ?? {})).toContain(BILD);
  });

  it('lehnt ein Symbol ab, das es nicht gibt', async () => {
    const S = level.xpslot;
    await expect(
      S.setzeSymbolbild({ key: 'gibtesnicht', bildPfad: BILD, bildUrl: null }, AKTEUR),
    ).rejects.toThrow();
  });
});
