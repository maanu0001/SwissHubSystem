import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import {
  SOCIAL_MASSE,
  folienDateiname,
  zeichneSocialFolie,
  STANDARD_MARKE,
  type FolienMarke,
  type SocialDaten,
  type SocialFormat,
} from '../../apps/web/src/modules/fragt/social-folie';
import { baueZip } from '../../packages/modules/src/wrapped/zip';
import type { fragt } from '@swisshub/modules';

/**
 * Die Grafiken entstehen wirklich - und in der richtigen Groesse.
 *
 * ## Warum das nicht durch Ansehen zu pruefen ist
 *
 * Weil ein Export auf drei Weisen scheitert, und keine davon sieht man am
 * Code:
 *
 *  - **Leere Datei.** Satori kennt nur einen Teil von CSS. Eine Eigenschaft,
 *    die der Browser versteht - `clip-path`, `text-transform`, `box-shadow` -
 *    laesst das Rendern scheitern, und heraus kommt nichts. Im Studio sieht die
 *    Vorschau trotzdem gut aus, weil die im Browser laeuft.
 *  - **Falsche Masse.** Instagram schneidet eine Story, die nicht 1080 x 1920
 *    ist. Das merkt man beim Hochladen.
 *  - **Layout laeuft aus dem Bild.** Eine Frage mit 180 Zeichen oder eine
 *    Antwort mit 60 - die Faelle, die niemand von Hand testet, weil die eigene
 *    Testfrage immer kurz ist.
 *
 * Geprueft wird deshalb an den echten Bytes: der PNG-Kopf traegt Breite und
 * Hoehe, und eine Datei von null Bytes ist keine Datei.
 */

/** Breite und Hoehe aus dem IHDR-Block eines PNG. */
function pngMasse(bytes: Uint8Array): { breite: number; hoehe: number } {
  // 0-7 Signatur, 8-11 Laenge, 12-15 'IHDR', dann zwei 32-Bit-Zahlen.
  const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, wert] of signatur.entries()) {
    expect(bytes[index], `PNG-Signatur an Position ${index}`).toBe(wert);
  }
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
}

async function rendere(
  art: fragt.FolienArt,
  format: SocialFormat,
  daten: SocialDaten,
  marke?: FolienMarke,
): Promise<Uint8Array> {
  const mass = SOCIAL_MASSE[format];
  const bild = new ImageResponse(zeichneSocialFolie({ art, format, daten, ...(marke ? { marke } : {}) }), {
    width: mass.breite,
    height: mass.hoehe,
  });
  return new Uint8Array(await bild.arrayBuffer());
}

/** Ein gewoehnliches Ergebnis: vier Antworten, ein klarer Gewinner. */
const NORMAL: SocialDaten = {
  frageText: 'Welches Game hat euch die meisten Spielstunden gekostet?',
  untertitel: 'Ehrliche Antworten, bitte.',
  ueberschrift: 'Welches Game hat euch die meisten Spielstunden gekostet?',
  cta: 'Was hättest du gewählt? Diskutiere mit uns auf Discord.',
  zeilen: [
    { label: 'Minecraft', prozent: 42, stimmen: 42, fuehrt: true },
    { label: 'Counter-Strike 2', prozent: 30, stimmen: 30, fuehrt: false },
    { label: 'League of Legends', prozent: 18, stimmen: 18, fuehrt: false },
    { label: 'World of Warcraft', prozent: 10, stimmen: 10, fuehrt: false },
  ],
  gesamt: 100,
  gewinner: { label: 'Minecraft', prozent: 42, stimmen: 42 },
  gleichstand: [],
  stimmenZeigen: true,
};

/** Zwei Antworten - der Fall, fuer den die Duell-Vorlage gebaut ist. */
const DUELL: SocialDaten = {
  frageText: 'Controller oder Maus & Tastatur?',
  untertitel: null,
  ueberschrift: 'Controller oder Maus & Tastatur?',
  cta: 'Und du? Sag es uns auf Discord.',
  zeilen: [
    { label: 'Controller', prozent: 37, stimmen: 22, fuehrt: false },
    { label: 'Maus & Tastatur', prozent: 63, stimmen: 37, fuehrt: true },
  ],
  gesamt: 59,
  gewinner: { label: 'Maus & Tastatur', prozent: 63, stimmen: 37 },
  gleichstand: [],
  stimmenZeigen: true,
};

const ALLE_ARTEN: fragt.FolienArt[] = ['frage', 'gewinner', 'verteilung', 'duell', 'cta'];
const ALLE_FORMATE: SocialFormat[] = ['story', 'feed', 'quadrat'];

describe('Grafikexport: Masse und Inhalt', () => {
  it.each(ALLE_FORMATE)('liefert fuer %s die exakten Instagram-Masse', async (format) => {
    const bytes = await rendere('gewinner', format, NORMAL);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE[format]);
  });

  it('nennt die drei Formate mit den Zahlen, die Instagram erwartet', () => {
    /*
     * Die Zahlen selbst, nicht nur ihre Gleichheit mit sich.
     *
     * Ein Test, der `SOCIAL_MASSE` gegen `SOCIAL_MASSE` prueft, waere immer
     * gruen - auch wenn jemand aus 1920 eine 1290 macht.
     */
    expect(SOCIAL_MASSE.story).toEqual({ breite: 1080, hoehe: 1920 });
    expect(SOCIAL_MASSE.feed).toEqual({ breite: 1080, hoehe: 1350 });
    expect(SOCIAL_MASSE.quadrat).toEqual({ breite: 1080, hoehe: 1080 });
  });

  it.each(ALLE_ARTEN)('rendert die Folie «%s» in allen drei Formaten', async (art) => {
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere(art, format, art === 'duell' ? DUELL : NORMAL);
      expect(bytes.byteLength, `${art}/${format} ist leer`).toBeGreaterThan(1000);
      expect(pngMasse(bytes), `${art}/${format}`).toEqual(SOCIAL_MASSE[format]);
    }
  });
});

describe('Grafikexport: die Faelle, die niemand von Hand testet', () => {
  it('haelt eine sehr lange Frage im Bild', async () => {
    const lang: SocialDaten = {
      ...NORMAL,
      frageText:
        'Welches Videospiel aus der Zeit zwischen 1998 und 2007 hat euch rückblickend am meisten geprägt, und zwar nicht wegen der Grafik, sondern wegen der Abende, die ihr damit verbracht habt?',
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'story', lang);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
      expect(pngMasse(bytes), art).toEqual(SOCIAL_MASSE.story);
    }
  });

  it('haelt sehr lange Antworten im Bild', async () => {
    const lang: SocialDaten = {
      ...NORMAL,
      zeilen: [
        { label: 'The Elder Scrolls V: Skyrim Special Edition', prozent: 51, stimmen: 51, fuehrt: true },
        { label: 'Counter-Strike: Global Offensive (jetzt CS2)', prozent: 29, stimmen: 29, fuehrt: false },
        {
          label: 'Sid Meiers Civilization VI mit allen Erweiterungen',
          prozent: 12,
          stimmen: 12,
          fuehrt: false,
        },
        { label: 'Euro Truck Simulator 2 - Scandinavia', prozent: 8, stimmen: 8, fuehrt: false },
      ],
      gewinner: { label: 'The Elder Scrolls V: Skyrim Special Edition', prozent: 51, stimmen: 51 },
    };
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere('verteilung', format, lang);
      expect(bytes.byteLength, format).toBeGreaterThan(1000);
      expect(pngMasse(bytes), format).toEqual(SOCIAL_MASSE[format]);
    }
  });

  it('rendert Umlaute und Akzente als Glyphen', async () => {
    /*
     * Satori braucht fuer jedes Zeichen eine Glyphe. Fehlt sie, bleibt die
     * Stelle leer - und «Spielstunden» mit Umlaut ist kein Sonderfall, sondern
     * der Alltag. Geprueft wird deshalb nicht nur, dass ein Bild entsteht,
     * sondern dass der Umlaut etwas veraendert: waere er eine Leerstelle, waere
     * das PNG byte-identisch mit dem ohne ihn.
     */
    const mitUmlaut = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: [
        { label: 'Münchhausen', prozent: 100, stimmen: 1, fuehrt: true },
        { label: 'B', prozent: 0, stimmen: 0, fuehrt: false },
      ],
      gesamt: 1,
      gewinner: { label: 'Münchhausen', prozent: 100, stimmen: 1 },
    });
    const ohneUmlaut = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: [
        { label: 'Munchhausen', prozent: 100, stimmen: 1, fuehrt: true },
        { label: 'B', prozent: 0, stimmen: 0, fuehrt: false },
      ],
      gesamt: 1,
      gewinner: { label: 'Munchhausen', prozent: 100, stimmen: 1 },
    });
    expect(mitUmlaut.byteLength).not.toBe(ohneUmlaut.byteLength);
  });

  it('bricht an einem Emoji nicht ab', async () => {
    /*
     * Die Zusage, die ueberall gilt - und die einzige, die hier gelten darf.
     *
     * ## Warum hier nicht steht, ob das Emoji zu sehen ist
     *
     * Weil das von der Umgebung abhaengt, und ich habe genau daran einen
     * Deployment-Lauf verloren.
     *
     * Gemessen in meinem Container: ein PNG mit «Minecraft 🎮🔥» war
     * **byte-identisch** mit einem ohne - keine Emoji-Schrift, also keine
     * Glyphe. Aus dieser Messung habe ich eine harte Zusicherung gemacht
     * (`expect(mit).toBe(ohne)`).
     *
     * Auf dem GitHub-Runner ist dasselbe PNG 2625 Bytes **groesser**: dort gibt
     * es eine Emoji-Schrift, und das Emoji wird gezeichnet. Der Test fiel um,
     * und mit ihm der Lauf 79.
     *
     * Beides ist richtig - fuer die jeweilige Maschine. Eine Zusage darf
     * deshalb nur das behaupten, was von den installierten Schriften
     * unabhaengig ist: **der Export scheitert nicht**. Ein Mitglied, das ein
     * Emoji in eine Antwort schreibt, bringt die Grafik nicht zu Fall - ob das
     * Emoji erscheint, entscheidet das Abbild, in dem gerendert wird.
     */
    const mit = await rendere('verteilung', 'quadrat', {
      ...NORMAL,
      zeilen: NORMAL.zeilen.map((zeile, index) =>
        index === 0 ? { ...zeile, label: `${zeile.label} 🎮🔥` } : zeile,
      ),
      gewinner: { label: `${NORMAL.gewinner!.label} 🎮🔥`, prozent: 42, stimmen: 42 },
    });
    expect(mit.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(mit)).toEqual(SOCIAL_MASSE.quadrat);
  });

  it('vertraegt Emojis in jeder Vorlage, ohne zu scheitern', async () => {
    const bunt: SocialDaten = {
      ...NORMAL,
      frageText: 'Wofür würdest du deine Grafikkarte verkaufen? 🎮',
      untertitel: 'Ganz ehrlich – für was?',
      zeilen: [
        { label: 'Für gar nichts 😤', prozent: 55, stimmen: 11, fuehrt: true },
        { label: 'Für ein Café in Zürich ☕', prozent: 45, stimmen: 9, fuehrt: false },
      ],
      gesamt: 20,
      gewinner: { label: 'Für gar nichts 😤', prozent: 55, stimmen: 11 },
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'feed', bunt);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
    }
  });

  it('zeichnet einen Gleichstand ohne Gewinner', async () => {
    const gleich: SocialDaten = {
      ...DUELL,
      zeilen: [
        { label: 'Controller', prozent: 50, stimmen: 20, fuehrt: true },
        { label: 'Maus & Tastatur', prozent: 50, stimmen: 20, fuehrt: true },
      ],
      gesamt: 40,
      // Kein Gewinner - genau das soll die Grafik sagen.
      gewinner: null,
      gleichstand: ['Controller', 'Maus & Tastatur'],
    };
    const bytes = await rendere('gewinner', 'story', gleich);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE.story);
  });

  it('zeichnet eine Abstimmung ohne eine einzige Stimme', async () => {
    const leer: SocialDaten = {
      ...NORMAL,
      zeilen: NORMAL.zeilen.map((zeile) => ({ ...zeile, prozent: 0, stimmen: 0, fuehrt: false })),
      gesamt: 0,
      gewinner: null,
      gleichstand: [],
    };
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'quadrat', leer);
      expect(bytes.byteLength, art).toBeGreaterThan(1000);
    }
  });

  it('nimmt fuenf Antworten in der Verteilung auf', async () => {
    // Die Obergrenze aus `FRAGETYPEN` - und der Fall, bei dem die letzte Zeile
    // aus dem Bild laufen wuerde, wenn die Zeilenhoehe nicht mitrechnet.
    const fuenf: SocialDaten = {
      ...NORMAL,
      zeilen: [
        { label: 'NieR: Automata', prozent: 31, stimmen: 31, fuehrt: true },
        { label: 'DOOM Eternal', prozent: 24, stimmen: 24, fuehrt: false },
        { label: 'Hollow Knight', prozent: 20, stimmen: 20, fuehrt: false },
        { label: 'The Witcher 3', prozent: 15, stimmen: 15, fuehrt: false },
        { label: 'Minecraft', prozent: 10, stimmen: 10, fuehrt: false },
      ],
      gewinner: { label: 'NieR: Automata', prozent: 31, stimmen: 31 },
    };
    for (const format of ALLE_FORMATE) {
      const bytes = await rendere('verteilung', format, fuenf);
      expect(pngMasse(bytes), format).toEqual(SOCIAL_MASSE[format]);
    }
  });

  it('faellt bei der Duell-Vorlage auf die Liste zurueck, wenn es mehr als zwei Antworten gibt', async () => {
    // Sonst blieben zwei Haelften leer. Geprueft wird, dass ueberhaupt ein
    // gueltiges Bild entsteht - die Vorlage entscheidet selbst.
    const bytes = await rendere('duell', 'story', NORMAL);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE.story);
  });
});

describe('Grafikexport: das Archiv', () => {
  it('packt vier Folien in ein ZIP, das die Dateien wieder hergibt', async () => {
    const folien: fragt.FolienArt[] = ['frage', 'gewinner', 'verteilung', 'cta'];
    const eintraege = [];
    for (const [index, art] of folien.entries()) {
      eintraege.push({
        name: folienDateiname(index, art, 'feed'),
        daten: await rendere(art, 'feed', NORMAL),
      });
    }

    const archiv = baueZip(eintraege);
    expect(archiv.byteLength).toBeGreaterThan(4000);
    // «PK\x03\x04» - die Signatur eines ZIP.
    expect([archiv[0], archiv[1], archiv[2], archiv[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Jeder Dateiname steht im Archiv, und die Nummerierung gibt die
    // Reihenfolge vor - beim Hochladen entscheidet sie, was zuerst zu sehen ist.
    const text = Buffer.from(archiv).toString('latin1');
    for (const eintrag of eintraege) {
      expect(text).toContain(eintrag.name);
    }
    expect(eintraege.map((eintrag) => eintrag.name)).toEqual([
      'swisshub-fragt-01-frage-feed.png',
      'swisshub-fragt-02-gewinner-feed.png',
      'swisshub-fragt-03-verteilung-feed.png',
      'swisshub-fragt-04-cta-feed.png',
    ]);
  });
});

/**
 * Die Stimmenzahl auf der Grafik - an oder aus.
 *
 * ## Was abschaltbar ist und was nicht
 *
 * Abschaltbar ist die **absolute** Zahl: «42 Stimmen». Bei 300 Stimmen traegt
 * sie, bei 12 lenkt sie vom Ergebnis ab, und das entscheidet, wer die Grafik
 * postet - nicht eine feste Regel.
 *
 * Nicht abschaltbar sind die **Prozente**. Sie sind die Aussage; eine Grafik
 * ohne sie waere keine Auswertung mehr, sondern eine Behauptung. Deshalb
 * kennt `SocialDaten` einen Schalter und keinen Wert: er laesst eine Zahl weg
 * oder nicht, und er kann keine setzen.
 *
 * ## Warum an den Bytes gemessen wird
 *
 * Weil ein Schalter, der im Zustand ankommt und nicht im Bild, genau so
 * aussieht wie einer, der wirkt. Zwei Renderlaeufe derselben Daten mit
 * verschiedenem Schalter muessen verschiedene Dateien ergeben - und bei
 * gleichem Schalter dieselbe, sonst misst der Test etwas anderes.
 */
describe('Grafikexport: Anzahl Stimmen ein- und ausblenden', () => {
  const ohneZahlen: SocialDaten = { ...NORMAL, stimmenZeigen: false };

  /**
   * Drei Folien tragen die absolute Zahl, zwei nicht.
   *
   * «Die Frage» ist absichtlich ohne Zahlen - sie stellt die Frage, sie
   * beantwortet sie nicht; wer im Feed darueber gleitet, soll weiterwischen
   * wollen. «Der Aufruf» traegt den Aufruf und sonst nichts.
   *
   * Beide Listen stehen hier, weil sonst nur die eine Haelfte geprueft waere:
   * ein Schalter, der zu viel abschaltet, faellt genauso auf wie einer, der
   * zu wenig tut.
   */
  const MIT_ZAHL: fragt.FolienArt[] = ['gewinner', 'verteilung', 'duell'];
  const OHNE_ZAHL: fragt.FolienArt[] = ['frage', 'cta'];

  it.each(MIT_ZAHL)('aendert die Folie %s sichtbar', async (art) => {
    const mit = await rendere(art, 'quadrat', NORMAL);
    const ohne = await rendere(art, 'quadrat', ohneZahlen);
    expect(Buffer.from(ohne).equals(Buffer.from(mit))).toBe(false);
  });

  it.each(OHNE_ZAHL)('laesst die Folie %s unberuehrt - sie traegt ohnehin keine Zahl', async (art) => {
    const mit = await rendere(art, 'quadrat', NORMAL);
    const ohne = await rendere(art, 'quadrat', ohneZahlen);
    expect(Buffer.from(ohne).equals(Buffer.from(mit))).toBe(true);
  });

  it('deckt mit beiden Listen alle Folienarten ab', () => {
    // Kommt eine Vorlage dazu, muss jemand entscheiden, in welche Liste sie
    // gehoert - und nicht vergessen, dass es die Frage gibt.
    expect([...MIT_ZAHL, ...OHNE_ZAHL].sort()).toEqual([...ALLE_ARTEN].sort());
  });

  it('nimmt auch der Folie ohne Gewinner die Zahl', async () => {
    // Gleichstand und null Stimmen bekommen eine eigene Folie, und sie trug
    // die Zahl in der Fusszeile mit.
    const gleich: SocialDaten = {
      ...NORMAL,
      gewinner: null,
      gleichstand: ['Minecraft', 'Counter-Strike 2'],
    };
    const mit = await rendere('gewinner', 'quadrat', gleich);
    const ohne = await rendere('gewinner', 'quadrat', { ...gleich, stimmenZeigen: false });
    expect(Buffer.from(ohne).equals(Buffer.from(mit))).toBe(false);
  });

  it('bleibt bei gleichem Schalter bei derselben Datei', async () => {
    // Die Gegenprobe: ohne sie wuerde der Test oben auch dann gruen, wenn das
    // Rendern schlicht nicht deterministisch waere.
    const einmal = await rendere('gewinner', 'quadrat', ohneZahlen);
    const nochmal = await rendere('gewinner', 'quadrat', ohneZahlen);
    expect(Buffer.from(einmal).equals(Buffer.from(nochmal))).toBe(true);
  });

  it.each(ALLE_FORMATE)('bleibt in %s bei den exakten Massen', async (format) => {
    // Eine weggelassene Zeile darf die Flaeche nicht verschieben.
    const bytes = await rendere('gewinner', format, ohneZahlen);
    expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE[format]);
  });

  it('zeichnet auch ohne Stimmenzahl jede Vorlage vollstaendig', async () => {
    for (const art of ALLE_ARTEN) {
      const bytes = await rendere(art, 'story', ohneZahlen);
      // Eine leere Datei waere ein gescheitertes Rendern - Satori liefert bei
      // einem Fehler kein Bild, sondern nichts.
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
  });

  it('kommt bei null Stimmen mit beiden Einstellungen zurecht', async () => {
    const leer: SocialDaten = {
      ...NORMAL,
      zeilen: NORMAL.zeilen.map((zeile) => ({ ...zeile, prozent: 0, stimmen: 0, fuehrt: false })),
      gesamt: 0,
      gewinner: null,
      gleichstand: [],
    };
    for (const stimmenZeigen of [true, false]) {
      const bytes = await rendere('verteilung', 'feed', { ...leer, stimmenZeigen });
      expect(pngMasse(bytes)).toEqual(SOCIAL_MASSE.feed);
    }
  });
});

describe('Der Schalter ist ein Schalter und kein Wert', () => {
  it('nimmt im Bearbeitungsschema keine Zahl entgegen', () => {
    /*
     * Die Zusage aus dem Modul: Zahlen kommen aus dem festgeschriebenen
     * Ergebnis, nie aus dem Entwurf. Ein Feld `stimmen` oder `prozent` im
     * Schema waere der Weg, sie doch zu setzen.
     */
    const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/fragt/actions.ts'), 'utf8');
    expect(quelle).toContain('stimmenZeigen: z.boolean().optional()');
    expect(quelle).not.toMatch(/\bstimmen:\s*z\.number/u);
    expect(quelle).not.toMatch(/\bprozent:\s*z\.number/u);
  });

  it('gibt die Vorgabe auf «anzeigen», damit bestehende Entwuerfe gleich bleiben', () => {
    const schema = readFileSync(join(process.cwd(), 'packages/database/prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('stimmenZeigen Boolean @default(true)');
  });
});

/**
 * Farbe, Zeichen und Zusatztext - und zwar auf **jeder** Folie.
 *
 * ## Warum die Vollstaendigkeit das Interessante ist
 *
 * Nicht «die Farbe kommt an» - das ist eine Zeile. Sondern: sie kommt auf allen
 * fuenf Folien an. Die Farbe stand vorher als Konstante im Modul und wurde an
 * neun Stellen benutzt; eine davon beim Umbau zu vergessen ergibt eine Grafik,
 * die zu 80 Prozent in Serverfarben ist und an einer Stelle rot bleibt. Das
 * sieht man erst, wenn es gepostet ist.
 *
 * Deshalb `it.each` ueber alle Arten - fuer Frage **und** Ergebnis, denn das
 * ist der Punkt der Einstellung: eine Frage in Serverfarben und ein Ergebnis in
 * SwissHub-Rot waeren zwei Accounts.
 *
 * ## Warum an den Bytes und nicht am Code
 *
 * Weil der Vergleich dann beweist, dass die Farbe im **Bild** anders ist, und
 * nicht nur, dass eine Variable weitergereicht wurde. Ein `marke` das
 * durchgereicht und nie benutzt wird, bestaende jede Code-Pruefung.
 */
describe('Grafikexport: die eingestellte Marke', () => {
  const daten = (art: fragt.FolienArt): SocialDaten => (art === 'duell' ? DUELL : NORMAL);

  const BLAU: FolienMarke = {
    akzent: '#1f3d8f',
    akzentHell: '#5b7ad4',
    logo: null,
    zusatztext: null,
  };

  it.each(ALLE_ARTEN)('faerbt die Folie %s sichtbar um', async (art) => {
    const standard = await rendere(art, 'quadrat', daten(art), STANDARD_MARKE);
    const blau = await rendere(art, 'quadrat', daten(art), BLAU);
    expect(Buffer.from(standard).equals(Buffer.from(blau))).toBe(false);
  });

  it.each(ALLE_ARTEN)('setzt den Zusatztext auf der Folie %s durch', async (art) => {
    const ohne = await rendere(art, 'quadrat', daten(art), STANDARD_MARKE);
    const mit = await rendere(art, 'quadrat', daten(art), {
      ...STANDARD_MARKE,
      zusatztext: 'Von der Gaming-Gemeinschaft entschieden',
    });
    expect(Buffer.from(ohne).equals(Buffer.from(mit))).toBe(false);
  });

  it.each(ALLE_ARTEN)('laesst die Folie %s auch ohne Zeichen entstehen', async (art) => {
    // «Kein Zeichen» ist eine Einstellung und kein Fehler: die Folie muss
    // trotzdem ein vollstaendiges PNG in den richtigen Massen ergeben.
    const bytes = await rendere(art, 'quadrat', daten(art), { ...STANDARD_MARKE, logo: 'keins' });
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(pngMasse(bytes)).toEqual({ breite: 1080, hoehe: 1080 });
  });

  it.each(ALLE_ARTEN)('zeichnet ein hochgeladenes Logo in die Folie %s', async (art) => {
    /*
     * Ein echtes PNG als data-URI.
     *
     * Satori laedt keine Adressen in diesem Test - die Bytes stehen in der
     * `src`. Genau so laeuft es im Betrieb: `readUpload` holt die Datei von der
     * Platte, der Export greift auf nichts im Netz zu.
     */
    const signet = await rendere(art, 'quadrat', daten(art), STANDARD_MARKE);
    const mitLogo = await rendere(art, 'quadrat', daten(art), {
      ...STANDARD_MARKE,
      logo: EIN_PNG,
    });
    expect(mitLogo.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(signet).equals(Buffer.from(mitLogo))).toBe(false);
  });

  it('ergibt ohne Marke dasselbe wie mit der Standardmarke', async () => {
    // Die Zusage hinter dem optionalen Feld: ein Aufrufer, der die Marke
    // vergisst, bekommt genau das Bild, das es vorher gab - und kein schwarzes.
    const ohne = await rendere('gewinner', 'quadrat', NORMAL);
    const standard = await rendere('gewinner', 'quadrat', NORMAL, STANDARD_MARKE);
    expect(Buffer.from(ohne).equals(Buffer.from(standard))).toBe(true);
  });
});

/**
 * Ein 2x2-PNG als data-URI - gross genug, dass Satori es zeichnet.
 *
 * Von Hand gebaut und nicht aus einer Datei: ein Test, der eine Beispieldatei
 * braucht, scheitert eines Tages daran, dass sie verschoben wurde.
 */
const EIN_PNG = (() => {
  const breite = 2;
  const hoehe = 2;
  const kopf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const crc = (daten: Buffer): Buffer => {
    let rest = 0xffffffff;
    for (const byte of daten) {
      rest ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        rest = rest & 1 ? (rest >>> 1) ^ 0xedb88320 : rest >>> 1;
      }
    }
    const aus = Buffer.alloc(4);
    aus.writeUInt32BE((rest ^ 0xffffffff) >>> 0);
    return aus;
  };

  const block = (typ: string, inhalt: Buffer): Buffer => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(inhalt.length);
    const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
    return Buffer.concat([laenge, koerper, crc(koerper)]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // 8 Bit je Kanal
  ihdr[9] = 2; // Echtfarben, kein Alpha
  // 10-12 bleiben 0: Deflate, Standardfilter, nicht interlaced.

  // Je Zeile ein Filterbyte und drei Bytes je Pixel - ein weisses Quadrat.
  const rohdaten = Buffer.concat(
    Array.from({ length: hoehe }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(breite * 3, 0xff)])),
  );
  return `data:image/png;base64,${Buffer.concat([
    kopf,
    block('IHDR', ihdr),
    block('IDAT', deflateSync(rohdaten)),
    block('IEND', Buffer.alloc(0)),
  ]).toString('base64')}`;
})();
