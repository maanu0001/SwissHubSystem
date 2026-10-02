import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_fragt_export_marke');

/**
 * Was aus den Einstellungen in die Grafik gelangt - und was nicht.
 *
 * ## Warum das gegen eine echte Datenbank laeuft
 *
 * Weil der Weg selbst gepruefert werden soll: Formular → `ModuleState.settings`
 * (eine Json-Spalte) → Zod → `folienMarke` → Komponente. Jede Station kann
 * etwas durchlassen, und eine Attrappe auf halber Strecke wuerde genau die
 * Station ueberspringen, an der es schiefgeht.
 *
 * ## Was das Wichtigste ist
 *
 * Dass eine **unsinnige** Farbe die Standardfarbe ergibt und keine Grafik mit
 * einem fremden Verweis darin. Der Wert landet in einem `style`-Attribut einer
 * Komponente, die der Server zu einem PNG rendert; `red; background-image:
 * url(…)` waere dort ein Abruf einer fremden Adresse durch unseren Server.
 *
 * Die Zod-Pruefung am Schema ist die erste Verteidigung, `normalisiereFarbe` in
 * `folienMarke` die zweite. Geprueft werden beide, und zwar getrennt: wenn eine
 * davon wegfaellt, soll ein Test rot werden und nicht «es geht noch».
 */
const { prisma } = await import('@swisshub/database');
const { fragt, setModuleSettings, getModuleSettings } = await import('@swisshub/modules');
const { folienMarke } = await import('../../apps/web/src/modules/fragt/marke');
const { STANDARD_AKZENT, STANDARD_AKZENT_HELL } =
  await import('../../apps/web/src/modules/fragt/social-folie');
const { clearRevisionCaches } = await import('@swisshub/database');

/** Die Einstellungen setzen, wie es die Oberflaeche tun wuerde. */
async function stelleEin(werte: Record<string, unknown>): Promise<void> {
  const jetzige = await getModuleSettings<Record<string, unknown>>(fragt.FRAGT_MODULE_ID);
  await setModuleSettings(fragt.FRAGT_MODULE_ID, { ...jetzige, ...werte }, 'test');
  clearRevisionCaches();
}

describeWithDatabase('SwissHub fragt: die Marke der Grafiken', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    await prisma.moduleState.deleteMany({});
    clearRevisionCaches();
  });

  it('nimmt ohne Einstellung die SwissHub-Farben, das Signet und keinen Zusatztext', async () => {
    const marke = await folienMarke();
    expect(marke).toEqual({
      akzent: STANDARD_AKZENT,
      akzentHell: STANDARD_AKZENT_HELL,
      logo: null,
      zusatztext: null,
    });
  });

  it('uebernimmt eine eingestellte Farbe und leitet den hellen Ton ab', async () => {
    await stelleEin({ exportAkzentfarbe: '#1f3d8f' });

    const marke = await folienMarke();
    expect(marke.akzent).toBe('#1f3d8f');
    // Abgeleitet, nicht die Standardfarbe - und heller als die Ausgangsfarbe.
    expect(marke.akzentHell).not.toBe(STANDARD_AKZENT_HELL);
    expect(marke.akzentHell).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('normalisiert Kurzform und rgb() auf #rrggbb', async () => {
    await stelleEin({ exportAkzentfarbe: 'rgb(31, 61, 143)' });
    expect((await folienMarke()).akzent).toBe('#1f3d8f');

    await stelleEin({ exportAkzentfarbe: '#F0A' });
    expect((await folienMarke()).akzent).toBe('#ff00aa');
  });

  it('behaelt bei der Standardfarbe den von Hand gewaehlten hellen Ton', async () => {
    await stelleEin({ exportAkzentfarbe: '#83060a' });

    const marke = await folienMarke();
    expect(marke.akzent).toBe(STANDARD_AKZENT);
    // Nicht die Rechnung: `#b81219` ist abgestimmt und soll nicht um eine
    // Nuance verfehlt werden.
    expect(marke.akzentHell).toBe(STANDARD_AKZENT_HELL);
  });

  it('weist eine unsinnige Farbe schon im Schema ab', async () => {
    // Erste Verteidigung: das Feld laesst sich gar nicht so speichern.
    await expect(
      stelleEin({ exportAkzentfarbe: 'red; background-image: url(https://example.invalid/a.png)' }),
    ).rejects.toThrow();
  });

  it('nimmt die Standardfarbe, falls doch etwas Unsinniges in der Spalte steht', async () => {
    /*
     * Zweite Verteidigung, und sie ist noetig.
     *
     * Die Json-Spalte laesst sich auch anders beschreiben als durch das
     * Formular - ein Restore, ein Skript, eine aeltere Fassung des Schemas.
     * `folienMarke` darf sich darauf nicht verlassen, dass vor ihr schon jemand
     * geprueft hat.
     */
    await prisma.moduleState.upsert({
      where: { moduleId: fragt.FRAGT_MODULE_ID },
      create: {
        moduleId: fragt.FRAGT_MODULE_ID,
        enabled: true,
        settings: { exportAkzentfarbe: 'url(https://example.invalid/a.png)' },
      },
      update: { settings: { exportAkzentfarbe: 'url(https://example.invalid/a.png)' } },
    });
    clearRevisionCaches();

    const marke = await folienMarke();
    expect(marke.akzent).toBe(STANDARD_AKZENT);
    expect(marke.akzent).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('uebernimmt einen Zusatztext und bereinigt ihn', async () => {
    await stelleEin({ exportAkzentfarbe: '', exportZusatztext: '  Von der Gemeinschaft  ' });

    expect((await folienMarke()).zusatztext).toBe('Von der Gemeinschaft');
  });

  it('liest einen leeren Zusatztext als «Standardsatz» und nicht als leere Zeile', async () => {
    await stelleEin({ exportZusatztext: '   ' });

    expect((await folienMarke()).zusatztext).toBeNull();
  });

  it('kuerzt einen zu langen Zusatztext im Schema, statt ihn zu zeichnen', async () => {
    await expect(stelleEin({ exportZusatztext: 'x'.repeat(200) })).rejects.toThrow();
  });

  it('meldet «keins», wenn kein Zeichen gewuenscht ist', async () => {
    await stelleEin({ exportLogo: 'keins' });

    expect((await folienMarke()).logo).toBe('keins');
  });

  it('faellt auf das Signet zurueck, wenn das Serverlogo gewuenscht aber keines da ist', async () => {
    await stelleEin({ exportLogo: 'serverlogo' });

    // Eine leere Stelle waere eine Grafik, der man nicht ansieht, dass etwas
    // fehlt - das Signet ist die brauchbare Antwort.
    expect((await folienMarke()).logo).toBeNull();
  });

  it('kennt genau drei Zeichen-Einstellungen und keine vierte', async () => {
    // Kein freier Pfad: ein manipulierter Logopfad kann nicht entstehen, weil
    // es keinen gibt.
    await expect(stelleEin({ exportLogo: '../../etc/passwd' })).rejects.toThrow();
    await expect(stelleEin({ exportLogo: 'https://example.invalid/logo.png' })).rejects.toThrow();
  });
});

/**
 * Farbe, Zeichen und Zusatztext **je Export** - bis in die PNG-Bytes.
 *
 * ## Warum diese Gruppe so gründlich ist
 *
 * Weil die Aufgabe zweimal als erledigt gemeldet wurde und zweimal nicht
 * funktional war. Beide Male war die Umsetzung an der falschen Stelle: die drei
 * Werte waren **Moduleinstellungen** (die Gruppe darüber prüft sie), aber
 * verlangt waren sie **im Content Studio, je Export**. Es gab keine Spalte am
 * Entwurf, kein Feld im Studio und kein Attribut in der Ansicht - aus Sicht des
 * Nutzers ist die Funktion dort also nie erschienen.
 *
 * Ein Test, der nur `folienMarke(entwurf)` prüft, hätte das nicht gefangen:
 * eine DTO-Prüfung ist grün, solange die Werte irgendwo ankommen. Deshalb geht
 * diese Gruppe den ganzen Weg und liest am Ende **die Pixel des erzeugten
 * PNG**:
 *
 *     bearbeiteEntwurf → Spalte → folienMarke(entwurf) → Komponente →
 *     Satori → PNG → Bildpunkt
 *
 * Wenn die Farbe im Bild steht, steht sie im Export. Das ist keine Vermutung
 * mehr.
 *
 * ## Und für Frage *und* Ergebnis
 *
 * Es ist **eine** Marke je Export, nicht eine je Folie: ein Carousel, dessen
 * erste Folie anders aussieht als die zweite, ist kein Carousel. Geprüft wird
 * deshalb dieselbe Farbe auf der Frage-Folie und auf der Gewinner-Folie.
 */
const { fragt: fragtModul } = await import('@swisshub/modules');
const { ImageResponse } = await import('next/og');
const { inflateSync } = await import('node:zlib');
const { SOCIAL_MASSE, zeichneSocialFolie } = await import('../../apps/web/src/modules/fragt/social-folie');
import type { SocialDaten, SocialFormat } from '../../apps/web/src/modules/fragt/social-folie';
import type { FolienArt } from '../../packages/modules/src/fragt/entwurf';

/**
 * Die Bildpunkte eines PNG - entpackt und entfiltert.
 *
 * Satori/resvg liefert RGBA mit acht Bit je Kanal, nicht verschachtelt. Was
 * hier passiert, ist genau das Minimum, um an die Farben zu kommen:
 *
 *  1. Die `IDAT`-Blöcke aneinanderhängen (ein PNG darf sie aufteilen).
 *  2. Mit zlib entpacken.
 *  3. Die Zeilenfilter rückrechnen. Jede Zeile beginnt mit einem Filterbyte;
 *     ohne diesen Schritt liest man Differenzen statt Farben, und eine
 *     gesuchte Farbe wäre dann fast nie zu finden - auch wenn sie im Bild ist.
 *
 * Keine Bibliothek dafür: eine Abhängigkeit, die nur ein Test braucht, ist
 * eine Abhängigkeit zu viel, und die drei Schritte sind im PNG-Standard
 * festgeschrieben und ändern sich nicht.
 */
function pngFarben(bytes: Uint8Array): Set<string> {
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const breite = sicht.getUint32(16);
  const hoehe = sicht.getUint32(20);
  const bitTiefe = sicht.getUint8(24);
  const farbtyp = sicht.getUint8(25);
  // Nur der Fall, den resvg erzeugt. Alles andere wäre stillschweigend falsch.
  expect(bitTiefe, 'Bittiefe').toBe(8);
  expect(farbtyp, 'Farbtyp (6 = RGBA)').toBe(6);

  const teile: Uint8Array[] = [];
  let stelle = 8;
  while (stelle + 8 <= bytes.byteLength) {
    const laenge = sicht.getUint32(stelle);
    const typ = String.fromCharCode(...bytes.subarray(stelle + 4, stelle + 8));
    if (typ === 'IDAT') {
      teile.push(bytes.subarray(stelle + 8, stelle + 8 + laenge));
    }
    if (typ === 'IEND') {
      break;
    }
    stelle += 12 + laenge;
  }
  expect(teile.length, 'IDAT-Blöcke').toBeGreaterThan(0);

  const roh = new Uint8Array(inflateSync(Buffer.concat(teile.map((teil) => Buffer.from(teil)))));
  const kanaele = 4;
  const zeilenBytes = breite * kanaele;
  const bild = new Uint8Array(hoehe * zeilenBytes);

  for (let zeile = 0; zeile < hoehe; zeile += 1) {
    const filter = roh[zeile * (zeilenBytes + 1)]!;
    const quelle = zeile * (zeilenBytes + 1) + 1;
    const ziel = zeile * zeilenBytes;
    for (let index = 0; index < zeilenBytes; index += 1) {
      const wert = roh[quelle + index]!;
      const links = index >= kanaele ? bild[ziel + index - kanaele]! : 0;
      const oben = zeile > 0 ? bild[ziel - zeilenBytes + index]! : 0;
      const obenLinks = zeile > 0 && index >= kanaele ? bild[ziel - zeilenBytes + index - kanaele]! : 0;

      let davor = 0;
      if (filter === 1) {
        davor = links;
      } else if (filter === 2) {
        davor = oben;
      } else if (filter === 3) {
        davor = Math.floor((links + oben) / 2);
      } else if (filter === 4) {
        // Paeth - der Vorhersager des Standards, Buchstabe für Buchstabe.
        const schaetzung = links + oben - obenLinks;
        const abstandLinks = Math.abs(schaetzung - links);
        const abstandOben = Math.abs(schaetzung - oben);
        const abstandEcke = Math.abs(schaetzung - obenLinks);
        davor =
          abstandLinks <= abstandOben && abstandLinks <= abstandEcke
            ? links
            : abstandOben <= abstandEcke
              ? oben
              : obenLinks;
      }
      bild[ziel + index] = (wert + davor) & 0xff;
    }
  }

  const farben = new Set<string>();
  for (let index = 0; index < bild.length; index += kanaele) {
    const rot = bild[index]!;
    const gruen = bild[index + 1]!;
    const blau = bild[index + 2]!;
    farben.add(
      `#${rot.toString(16).padStart(2, '0')}${gruen.toString(16).padStart(2, '0')}${blau.toString(16).padStart(2, '0')}`,
    );
  }
  return farben;
}

/** Ein Ergebnis, wie es nach dem Schliessen im Schnappschuss steht. */
const ERGEBNIS: SocialDaten = {
  frageText: 'Welches Game spielt ihr am Freitag?',
  untertitel: 'Drei Antworten, eine davon gewinnt.',
  ueberschrift: 'Welches Game spielt ihr am Freitag?',
  cta: 'Sag es uns auf Discord.',
  zeilen: [
    { label: 'Deep Rock Galactic', prozent: 55, stimmen: 11, fuehrt: true },
    { label: 'Counter-Strike 2', prozent: 30, stimmen: 6, fuehrt: false },
    { label: 'Lethal Company', prozent: 15, stimmen: 3, fuehrt: false },
  ],
  gesamt: 20,
  gewinner: { label: 'Deep Rock Galactic', prozent: 55, stimmen: 11 },
  gleichstand: [],
  stimmenZeigen: true,
};

/** Eine Folie wirklich rendern - dieselbe Komponente wie die Export-Route. */
async function rendereFolie(
  art: FolienArt,
  marke: Awaited<ReturnType<typeof folienMarke>>,
  format: SocialFormat = 'quadrat',
): Promise<Uint8Array> {
  const mass = SOCIAL_MASSE[format];
  const bild = new ImageResponse(zeichneSocialFolie({ art, format, daten: ERGEBNIS, marke }), {
    width: mass.breite,
    height: mass.hoehe,
  });
  return new Uint8Array(await bild.arrayBuffer());
}

/**
 * Einen Entwurf mit Abstimmung und Frage anlegen - der echte Weg.
 *
 * Alle Pflichtfelder, auch die, die für diese Tests nichts bedeuten
 * (`channelId`, `opensAt`): eine Zeile, die das Schema so nicht erlauben
 * würde, wäre eine Testgrundlage, die es im Betrieb nicht gibt.
 */
async function legeEntwurfAn(): Promise<string> {
  const frage = await prisma.fragtFrage.create({
    data: {
      guildId: '000000000000000001',
      text: ERGEBNIS.frageText,
      kategorie: 'Gaming',
      typ: 'UMFRAGE',
      status: 'ARCHIVED',
      tags: [],
      optionen: {
        create: [
          { label: 'Deep Rock Galactic', position: 0 },
          { label: 'Counter-Strike 2', position: 1 },
          { label: 'Lethal Company', position: 2 },
        ],
      },
    },
  });

  /*
   * Die Optionen danach lesen und nicht aus dem `create` nehmen.
   *
   * `include` an einem `create` funktioniert, der Rückgabetyp trägt die
   * Relation hier aber nicht - und ein `as`-Zusatz an dieser Stelle wäre eine
   * Behauptung über Prisma statt einer Abfrage.
   */
  const optionen = await prisma.fragtOption.findMany({
    where: { frageId: frage.id },
    orderBy: { position: 'asc' },
  });

  const abstimmung = await prisma.fragtAbstimmung.create({
    data: {
      guildId: frage.guildId,
      frageId: frage.id,
      frageText: frage.text,
      typ: frage.typ,
      status: 'CLOSED',
      channelId: '000000000000000099',
      opensAt: new Date(Date.now() - 86_400_000),
      closesAt: new Date(Date.now() - 3_600_000),
      closedAt: new Date(Date.now() - 3_600_000),
      finalVotes: 20,
      /*
       * Der Schnappschuss in genau der Form, die `ausSnapshot` liest -
       * `version: 1` und Zeilen mit `optionId`. Ein Ergebnis in einer anderen
       * Form würde dort als «nicht darstellbar» gelten, und die Tests liefen
       * an einem Entwurf, den das Studio nicht öffnen könnte.
       */
      ergebnis: {
        version: 1,
        zeilen: [
          { optionId: optionen[0]!.id, label: 'Deep Rock Galactic', position: 0, stimmen: 11 },
          { optionId: optionen[1]!.id, label: 'Counter-Strike 2', position: 1, stimmen: 6 },
          { optionId: optionen[2]!.id, label: 'Lethal Company', position: 2, stimmen: 3 },
        ],
      },
    },
  });

  const entwurf = await prisma.fragtEntwurf.create({
    data: {
      abstimmungId: abstimmung.id,
      status: 'OFFEN',
      vorlage: 'winner',
      format: 'quadrat',
      ueberschrift: ERGEBNIS.ueberschrift,
      untertitel: ERGEBNIS.untertitel,
      cta: ERGEBNIS.cta,
      folien: [
        { art: 'frage', aktiv: true, position: 0 },
        { art: 'gewinner', aktiv: true, position: 1 },
      ],
    },
  });
  return entwurf.id;
}

describeWithDatabase('SwissHub fragt: die Marke je Export', () => {
  beforeAll(async () => {
    await pushSchema();
  });

  beforeEach(async () => {
    // Von unten nach oben: `onDelete: Cascade` haengt an der Frage, aber
    // `deleteMany` loest keine Fremdschluessel in dieser Richtung auf.
    await prisma.fragtStimme.deleteMany({});
    await prisma.fragtEntwurf.deleteMany({});
    await prisma.fragtAbstimmung.deleteMany({});
    await prisma.fragtOption.deleteMany({});
    await prisma.fragtFrage.deleteMany({});
    await prisma.moduleState.deleteMany({});
    clearRevisionCaches();
  });

  it('speichert alle drei Werte am Entwurf', async () => {
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, {
      exportAkzentfarbe: '#1f8f3d',
      exportLogo: 'keins',
      exportZusatztext: 'Freitagsrunde',
    });

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    expect(zeile.exportAkzentfarbe).toBe('#1f8f3d');
    expect(zeile.exportLogo).toBe('keins');
    expect(zeile.exportZusatztext).toBe('Freitagsrunde');
  });

  it('lässt den Entwurf über die Moduleinstellung gewinnen', async () => {
    await stelleEin({ exportAkzentfarbe: '#1f3d8f', exportZusatztext: 'Serverweit' });
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, {
      exportAkzentfarbe: '#8f1f3d',
      exportZusatztext: 'Nur dieser Export',
    });

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    const marke = await folienMarke(zeile);
    expect(marke.akzent).toBe('#8f1f3d');
    expect(marke.zusatztext).toBe('Nur dieser Export');
  });

  it('fällt ohne eigene Angabe auf die Moduleinstellung zurück', async () => {
    await stelleEin({ exportAkzentfarbe: '#1f3d8f', exportZusatztext: 'Serverweit', exportLogo: 'keins' });
    const entwurfId = await legeEntwurfAn();

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    expect(zeile.exportAkzentfarbe).toBeNull();

    const marke = await folienMarke(zeile);
    expect(marke.akzent).toBe('#1f3d8f');
    expect(marke.zusatztext).toBe('Serverweit');
    expect(marke.logo).toBe('keins');
  });

  it('unterscheidet «keine eigene Angabe» von «ausdrücklich leer»', async () => {
    /*
     * Der Fehler, den `||` statt `??` machen würde.
     *
     * Wer den Zusatztext leert, will keine Fusszeile. Mit `||` fiele der leere
     * Text auf die Moduleinstellung zurück - und der Nutzer sähe seinen
     * gelöschten Text wieder auftauchen, ohne dass er etwas falsch gemacht
     * hätte.
     */
    await stelleEin({ exportZusatztext: 'Serverweit' });
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, { exportZusatztext: '' });

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    expect(zeile.exportZusatztext).toBe('');
    expect((await folienMarke(zeile)).zusatztext).toBeNull();
  });

  it('setzt mit null auf die Moduleinstellung zurück', async () => {
    await stelleEin({ exportAkzentfarbe: '#1f3d8f' });
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: '#8f1f3d' });
    await fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: null });

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    expect(zeile.exportAkzentfarbe).toBeNull();
    expect((await folienMarke(zeile)).akzent).toBe('#1f3d8f');
  });

  it('prüft Farbe, Zeichen und Text beim Schreiben', async () => {
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, {
      // Unsinn wird zu `null` und damit zur Moduleinstellung - nicht zu einem
      // Wert, der in ein `style`-Attribut gelangt.
      exportAkzentfarbe: 'red; background-image: url(https://example.invalid/a.png)',
      exportLogo: '../../etc/passwd' as never,
      exportZusatztext: '  Mit Rand  ',
    });

    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    expect(zeile.exportAkzentfarbe).toBeNull();
    expect(zeile.exportLogo).toBeNull();
    expect(zeile.exportZusatztext).toBe('Mit Rand');
  });

  it('normalisiert Kurzform und rgb() auch am Entwurf', async () => {
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: '#F0A' });
    expect(
      (await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } })).exportAkzentfarbe,
    ).toBe('#ff00aa');

    await fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: 'rgb(31, 143, 61)' });
    expect(
      (await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } })).exportAkzentfarbe,
    ).toBe('#1f8f3d');
  });

  it('ändert nichts an einem Entwurf, der abgeschlossen ist', async () => {
    const entwurfId = await legeEntwurfAn();
    await prisma.fragtEntwurf.update({ where: { id: entwurfId }, data: { status: 'FINALISIERT' } });

    await expect(fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: '#8f1f3d' })).rejects.toThrow();
  });

  it('zeichnet die Farbe des Entwurfs in die PNG-Bytes - auf Frage und Ergebnis', async () => {
    /*
     * **Der Test, der die Aufgabe entscheidet.**
     *
     * Nicht «der Wert kommt in der Marke an», sondern «die Farbe ist im
     * fertigen Bild». Geprüft auf **beiden** Folienarten, weil es eine Marke je
     * Export ist und nicht eine je Folie.
     */
    const entwurfId = await legeEntwurfAn();
    await fragtModul.bearbeiteEntwurf(entwurfId, { exportAkzentfarbe: '#1f8f3d' });
    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    const marke = await folienMarke(zeile);
    expect(marke.akzent).toBe('#1f8f3d');
    // Der helle Ton ist abgeleitet, nicht eingestellt - und beide erscheinen
    // im Bild, je nach Folie.
    expect(marke.akzentHell).toMatch(/^#[0-9a-f]{6}$/u);
    expect(marke.akzentHell).not.toBe(STANDARD_AKZENT_HELL);

    /*
     * Welcher der beiden Töne auf welcher Folie steht, ist eine Frage der
     * Komposition: die Frage-Folie trägt den hellen als Markierungsbalken,
     * die Aufruf-Folie den vollen als Fläche. Beide sind aus der gewählten
     * Farbe gerechnet, also beweist jeder von ihnen dasselbe.
     *
     * Die Gegenprobe ist der eigentliche Nachweis: **keiner** der beiden
     * Standardtöne darf im Bild sein. Wäre die Wahl im Studio verloren
     * gegangen - der Zustand, der zweimal ausgeliefert wurde -, stünde dort
     * das SwissHub-Rot.
     */
    for (const art of ['frage', 'gewinner', 'cta'] as const) {
      const bytes = await rendereFolie(art, marke);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
      const farben = pngFarben(bytes);

      expect(
        farben.has(marke.akzent) || farben.has(marke.akzentHell),
        `${art}: weder die gewählte Farbe noch ihr heller Ton steht im Bild`,
      ).toBe(true);
      expect(farben.has(STANDARD_AKZENT), `${art}: die Standardfarbe steht noch im Bild`).toBe(false);
      expect(farben.has(STANDARD_AKZENT_HELL), `${art}: der helle Standardton steht noch im Bild`).toBe(
        false,
      );
    }

    /*
     * Und einmal ganz genau: die Aufruf-Folie zeichnet `marke.akzent` als
     * volle Fläche. Dort muss der Wert aus der Spalte Pixel für Pixel
     * wiederzufinden sein - keine Ableitung, keine Deckkraft, kein Verlauf.
     */
    const aufruf = pngFarben(await rendereFolie('cta', marke));
    expect(aufruf.has('#1f8f3d'), 'die gewählte Farbe fehlt als Fläche').toBe(true);
  }, 60_000);

  it('zeichnet den Zusatztext des Entwurfs mit - nachweisbar an den Bytes', async () => {
    /*
     * Text in einem PNG ist nicht lesbar, ohne ihn zu erkennen. Nachweisbar
     * ist er trotzdem: zwei Exporte, die sich **nur** im Zusatztext
     * unterscheiden, dürfen nicht dasselbe Bild ergeben. Wären sie identisch,
     * wäre der Text nirgends gezeichnet worden - genau der Zustand, der
     * zweimal ausgeliefert wurde.
     */
    const entwurfId = await legeEntwurfAn();

    await fragtModul.bearbeiteEntwurf(entwurfId, { exportZusatztext: 'Freitagsrunde' });
    const eins = await rendereFolie(
      'cta',
      await folienMarke(await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } })),
    );

    await fragtModul.bearbeiteEntwurf(entwurfId, { exportZusatztext: 'Samstagsrunde im Wohnzimmer' });
    const zwei = await rendereFolie(
      'cta',
      await folienMarke(await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } })),
    );

    expect(Buffer.from(eins).equals(Buffer.from(zwei))).toBe(false);
  }, 60_000);

  it('lässt das Zeichen weg, wenn der Entwurf es sagt', async () => {
    const entwurfId = await legeEntwurfAn();

    await fragtModul.bearbeiteEntwurf(entwurfId, { exportLogo: 'signet' });
    const mitSignet = await rendereFolie(
      'frage',
      await folienMarke(await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } })),
    );

    await fragtModul.bearbeiteEntwurf(entwurfId, { exportLogo: 'keins' });
    const zeile = await prisma.fragtEntwurf.findUniqueOrThrow({ where: { id: entwurfId } });
    const ohne = await folienMarke(zeile);
    expect(ohne.logo).toBe('keins');

    const ohneZeichen = await rendereFolie('frage', ohne);
    // Dieselbe Begründung wie beim Zusatztext: wäre das Zeichen ohnehin nie
    // gezeichnet worden, wären beide Bilder gleich.
    expect(Buffer.from(mitSignet).equals(Buffer.from(ohneZeichen))).toBe(false);
  }, 60_000);
});
