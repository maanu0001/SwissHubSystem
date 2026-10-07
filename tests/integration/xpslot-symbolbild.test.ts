import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_xpslot_symbolbild');

/*
 * Ein eigenes Upload-Verzeichnis, gesetzt vor dem Import.
 *
 * `UPLOAD_DIR` wird beim Laden des Moduls gelesen und zeigt sonst auf
 * `/var/lib/swisshub/uploads`. Hier lief der Test damit durch, auf dem
 * CI-Runner nicht: dort ist der Pfad nicht beschreibbar, und `mkdir` warf
 * EACCES. Der Fehlschlag lag also in der Umgebung des Tests und nicht in dem,
 * was er prueft - er haette auf jedem Rechner ohne diesen Pfad gescheitert.
 *
 * Dasselbe Vorgehen wie in `branding-upload.test.ts`: Verzeichnis anlegen,
 * Umgebungsvariable setzen, erst danach importieren.
 */
const uploadVerzeichnis = await mkdtemp(join(tmpdir(), 'swisshub-slotsymbol-'));
process.env.SWISSHUB_UPLOAD_DIR = uploadVerzeichnis;

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

/*
 * Und wieder weg damit.
 *
 * `process.env` gehoert dem Worker und nicht dieser Datei: bliebe die
 * Variable stehen, zeigte eine andere Testdatei im selben Worker auf ein
 * Verzeichnis, von dem sie nichts weiss.
 */
afterAll(() => {
  delete process.env.SWISSHUB_UPLOAD_DIR;
});

describeWithDatabase('XP-Slot: Symbolbild', () => {
  beforeAll(async () => {
    await pushSchema();
    // Legt Konfiguration und die acht Standardsymbole an.
    await level.xpslot.leseKonfiguration();
    /*
     * Und raeumt die Bildreferenzen ab.
     *
     * `pushSchema` bringt das Schema auf den Stand, nicht die Zeilen: das
     * Testschema behaelt die Daten des letzten Laufs. Der erste Test prueft
     * den Weg von «kein Bild» zu «eigenes Bild», und diese Vorbedingung war
     * beim zweiten Lauf nicht mehr wahr - das Bild stand noch vom ersten da.
     * Ein Test, der nur einmal gruen ist, prueft den Lauf und nicht den Code;
     * der Startzustand wird darum hergestellt und nicht angenommen.
     */
    await prisma.xpSlotSymbol.updateMany({ data: { imagePath: null, imageUrl: null } });
  });

  it('schreibt die Referenz und liest sie wieder', async () => {
    const S = level.xpslot;
    const vorher = await prisma.xpSlotSymbol.findUnique({ where: { key: 'eins' } });
    expect(vorher?.imagePath ?? null).toBeNull();

    await S.setzeSymbolbild({ quelle: 'upload', key: 'eins', bildPfad: BILD }, AKTEUR);

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
    await S.setzeSymbolbild({ quelle: 'upload', key: 'drei', bildPfad: BILD }, AKTEUR);
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
    await S.setzeSymbolbild({ quelle: 'upload', key: 'fuenf', bildPfad: BILD }, AKTEUR);
    await S.setzeSymbolbild({ quelle: 'upload', key: 'zehn', bildPfad: ZWEITES }, AKTEUR);

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
    await S.setzeSymbolbild({ quelle: 'upload', key: 'logo', bildPfad: BILD }, AKTEUR);
    await S.setzeSymbolbild({ quelle: 'standard', key: 'logo' }, AKTEUR);
    const logo = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'logo' } });
    expect(logo.imagePath).toBeNull();
    expect(logo.imageUrl).toBeNull();
  });

  it('vermerkt jede Änderung im Audit Log', async () => {
    const S = level.xpslot;
    await prisma.auditLog.deleteMany({});
    await S.setzeSymbolbild({ quelle: 'upload', key: 'wild', bildPfad: BILD }, AKTEUR);
    const eintraege = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
    expect(eintraege[0]?.actorDiscordId).toBe(AKTEUR.discordId);
    expect(JSON.stringify(eintraege[0]?.metadata ?? {})).toContain(BILD);
  });

  /*
   * Der zweite Teil desselben Fehlers.
   *
   * Der Upload speicherte seit der letzten Runde selbst - und das Bild
   * verschwand trotzdem weiter. Nachgemessen: zwei Oberflaechen bearbeiten
   * dieselbe Zeile, die Symbolkarte und die Premiumkarte, und beide schickten
   * den vollen Datensatz samt der Bildreferenz, die beim **Seitenaufbau**
   * gegolten hatte. Wer hochlud und danach irgendetwas anderes am Symbol
   * speicherte, schrieb den alten Stand zurueck. Schlimmer noch: weil
   * `speichereSymbol` die verdraengte Datei mitloeschte, war die frisch
   * hochgeladene PNG danach nicht bloss unverlinkt, sondern von der Platte
   * verschwunden.
   *
   * `speichereSymbol` kann das Bild jetzt nicht mehr anfassen. Diese Tests
   * halten das fest - der erste am Verweis, der zweite an der Datei.
   */
  it('verliert das Bild nicht, wenn danach die uebrigen Felder gespeichert werden', async () => {
    const S = level.xpslot;
    await S.setzeSymbolbild({ quelle: 'upload', key: 'premium', bildPfad: BILD }, AKTEUR);

    const stand = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'premium' } });

    // Genau das, was die Premiumkarte schickt: Gewicht und Tage aus dem
    // Formular, alles andere aus dem Stand von vorher.
    await S.speichereSymbol(
      {
        key: 'premium',
        name: stand.name,
        aktiv: stand.active,
        gewicht: stand.weight,
        glow: stand.glow,
        auszahlung3: stand.payout3Bp,
        auszahlung4: stand.payout4Bp,
        auszahlung5: stand.payout5Bp,
        premiumTage3: stand.premiumDays3,
        premiumTage4: stand.premiumDays4,
        premiumTage5: stand.premiumDays5,
      },
      AKTEUR,
    );

    const nachher = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'premium' } });
    expect(nachher.imagePath).toBe(BILD);

    // Und so, wie der Slot die Konfiguration liest - dieselbe Quelle wie die
    // Vorschau, es gibt keine zweite.
    const konfiguration = await S.leseKonfiguration();
    expect(konfiguration.symbole.find((eintrag) => eintrag.key === 'premium')?.imagePath).toBe(BILD);
  });

  it('laesst die hochgeladene Datei liegen, wenn die uebrigen Felder gespeichert werden', async () => {
    const S = level.xpslot;
    const ziel = S.symbolbildPfad(BILD);
    expect(ziel, 'der Dateiname muss dem Muster entsprechen').not.toBeNull();

    // Das Verzeichnis gehoert diesem Test - siehe oben.
    expect(ziel!.startsWith(uploadVerzeichnis)).toBe(true);
    await writeFile(ziel!, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await S.setzeSymbolbild({ quelle: 'upload', key: 'bonus', bildPfad: BILD }, AKTEUR);
    const stand = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'bonus' } });

    await S.speichereSymbol(
      {
        key: 'bonus',
        name: stand.name,
        aktiv: stand.active,
        gewicht: stand.weight,
        glow: stand.glow,
        auszahlung3: stand.payout3Bp,
        auszahlung4: stand.payout4Bp,
        auszahlung5: stand.payout5Bp,
        premiumTage3: stand.premiumDays3,
        premiumTage4: stand.premiumDays4,
        premiumTage5: stand.premiumDays5,
      },
      AKTEUR,
    );

    // Vorher wurde die Datei hier geloescht, weil das Speichern eine andere
    // Referenz verdraengte als die, die tatsaechlich in der Zeile stand.
    expect(existsSync(ziel!), 'die hochgeladene PNG muss liegen bleiben').toBe(true);
  });

  it('löscht die Adresse, wenn eine Datei hochgeladen wird', async () => {
    /*
     * Die stille Vorrangregel, die das behebt.
     *
     * Beide Quellen standen nebeneinander in der Zeile, und `quelle()`
     * entschied: die Datei zuerst. Wer bei einem Symbol mit Datei eine
     * Adresse eintrug, las «Bildadresse übernommen.» - und sah nichts. Der
     * Wert war gespeichert, nur nie sichtbar.
     */
    const S = level.xpslot;
    await S.setzeSymbolbild(
      { quelle: 'adresse', key: 'zehn', bildUrl: 'https://cdn.example.org/a.png' },
      AKTEUR,
    );
    await S.setzeSymbolbild({ quelle: 'upload', key: 'zehn', bildPfad: BILD }, AKTEUR);
    const zeile = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'zehn' } });
    expect(zeile.imagePath).toBe(BILD);
    expect(zeile.imageUrl, 'die Adresse darf nicht unsichtbar liegen bleiben').toBeNull();
  });

  it('löscht die Datei, wenn eine Adresse gesetzt wird', async () => {
    const S = level.xpslot;
    await S.setzeSymbolbild({ quelle: 'upload', key: 'fuenf', bildPfad: BILD }, AKTEUR);
    await S.setzeSymbolbild(
      { quelle: 'adresse', key: 'fuenf', bildUrl: 'https://cdn.example.org/b.png' },
      AKTEUR,
    );
    const zeile = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'fuenf' } });
    expect(zeile.imageUrl).toBe('https://cdn.example.org/b.png');
    expect(zeile.imagePath, 'die Datei darf die Adresse nicht weiter verdecken').toBeNull();
  });

  it('nimmt nur vollständige https-Adressen an', () => {
    // Vorher war das Feld eine beliebige Zeichenkette bis 1000 Zeichen. Eine
    // Adresse, die nie laedt, soll beim Eintragen auffallen - nicht als
    // leeres Feld im Spiel.
    const S = level.xpslot;
    for (const wert of ['nicht-mal-eine-adresse', 'http://unsicher.example/a.png', 'javascript:alert(1)']) {
      const ergebnis = S.symbolBildSchema.safeParse({ quelle: 'adresse', key: 'eins', bildUrl: wert });
      expect(ergebnis.success, wert).toBe(false);
    }
    expect(
      S.symbolBildSchema.safeParse({ quelle: 'adresse', key: 'eins', bildUrl: 'https://ok.example/a.png' })
        .success,
    ).toBe(true);
  });

  it('erkennt eine Referenz, deren Datei fehlt', async () => {
    /*
     * Der Fehler, den der Benutzer gemeldet hat: «die Symbole funktionieren
     * nicht mehr alle». Ein Symbol mit einer Referenz auf eine Datei, die es
     * nicht mehr gibt, blieb dauerhaft leer - die Ausliefer-Route antwortet
     * 404, und der Rueckfall auf das mitgelieferte Zeichen greift nur, wenn
     * **keine** Referenz da ist. Nachgestellt, indem eine Datei weggenommen
     * wurde.
     */
    const S = level.xpslot;
    const ziel = S.symbolbildPfad(ZWEITES);
    expect(ziel).not.toBeNull();
    await writeFile(ziel!, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const vorhanden = await S.fehlendeSymbolbilder([ZWEITES]);
    expect(vorhanden.has(ZWEITES), 'eine Datei, die da ist, fehlt nicht').toBe(false);

    await rm(ziel!, { force: true });
    const fehlend = await S.fehlendeSymbolbilder([ZWEITES, null, undefined]);
    expect(fehlend.has(ZWEITES), 'eine Datei, die weg ist, muss auffallen').toBe(true);
    expect(fehlend.size, 'null und undefined sind keine fehlenden Dateien').toBe(1);
  });

  it('zeigt im Spiel das Standardbild statt einer toten Referenz', async () => {
    const S = level.xpslot;
    // Die Datei zu `ZWEITES` ist im Test davor entfernt worden.
    await S.setzeSymbolbild({ quelle: 'upload', key: 'wild', bildPfad: ZWEITES }, AKTEUR);
    const ansicht = await S.slotAnsicht();
    const wild = ansicht.symbole.find((eintrag) => eintrag.key === 'wild');
    expect(wild, 'das Wild muss in der Ansicht stehen').toBeDefined();
    expect(wild?.bildPfad, 'eine tote Referenz darf nicht in die Ansicht').toBeNull();

    // In der Datenbank bleibt sie stehen - die Ansicht raeumt nicht auf.
    const zeile = await prisma.xpSlotSymbol.findUniqueOrThrow({ where: { key: 'wild' } });
    expect(zeile.imagePath).toBe(ZWEITES);
  });

  it('lehnt ein Symbol ab, das es nicht gibt', async () => {
    const S = level.xpslot;
    await expect(
      S.setzeSymbolbild({ quelle: 'upload', key: 'gibtesnicht', bildPfad: BILD }, AKTEUR),
    ).rejects.toThrow();
  });
});
