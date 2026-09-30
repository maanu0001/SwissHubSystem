import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import {
  GAMER_CARD_FORMATE,
  GAMER_CARD_FUSS_LUFT,
  GAMER_CARD_MASSE,
  gamerCardDateiname,
  gamerCardFussHoehe,
  hslFarbe,
  istGamerCardFormat,
  zeichneGamerCard,
  type GamerCardFormat,
} from '../../apps/web/src/modules/profile/gamer-card';
import { qrDatenUri, qrSvg } from '../../apps/web/src/modules/profile/qr';
import type { profile } from '@swisshub/modules';

/**
 * Die Gamer Card entsteht wirklich - und in der richtigen Groesse.
 *
 * ## Warum das nicht durch Ansehen zu pruefen ist
 *
 * Weil ein Export auf drei Weisen scheitert, und keine davon sieht man am Code:
 *
 *  - **Leere Datei.** Satori kennt nur einen Teil von CSS. Eine Eigenschaft,
 *    die jeder Browser versteht - `clip-path`, `text-transform`, ein
 *    `box-shadow` mit Streuung -, laesst das Rendern scheitern, und heraus kommt
 *    nichts. Die Vorschau im Editor sieht trotzdem gut aus: sie ist dieselbe
 *    Route, aber wenn die 500 antwortet, steht dort nur ein kaputtes Bild.
 *  - **Falsche Masse.** Instagram schneidet eine Story, die nicht 1080 x 1920
 *    ist. Das merkt man beim Hochladen, nicht vorher.
 *  - **Layout laeuft aus dem Bild.** Ein Name mit 32 Zeichen, ein Motto mit 80,
 *    vier Spiele mit langen Titeln - die Faelle, die niemand von Hand testet,
 *    weil der eigene Testname immer «Lea» heisst.
 *
 * Geprueft wird deshalb an den echten Bytes: der PNG-Kopf traegt Breite und
 * Hoehe, und eine Datei von null Bytes ist keine Datei.
 */

/** Breite und Hoehe aus dem IHDR-Block eines PNG. */
function pngMasse(bytes: Uint8Array): { breite: number; hoehe: number } {
  const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, wert] of signatur.entries()) {
    expect(bytes[index], `PNG-Signatur an Position ${index}`).toBe(wert);
  }
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
}

type Profil = profile.OeffentlichesProfil;

const VARIABLEN = {
  '--profil-flaeche': '354 24% 8%',
  '--profil-rand': '354 30% 18%',
  '--profil-akzent': '358 85% 58%',
  '--profil-akzent-gedaempft': '358 60% 14%',
};

function profil(teile: Partial<Profil> = {}): Profil {
  return {
    slug: 'lea',
    identitaet: {
      discordId: '100000000000000001',
      name: 'lea_streamt',
      profilname: 'Lea',
      avatarHash: null,
      mitgliedSeit: new Date('2024-03-01T00:00:00.000Z'),
      boostet: false,
    },
    gestaltung: {
      thema: 'nacht',
      akzent: 'rot',
      variablen: VARIABLEN,
      bannerBild: null,
      bannerVerlauf: 'linear-gradient(160deg, #2a070c 0%, #07070a 100%)',
      theme: 'crimson',
      kulisse: 'pt-crimson',
      buehne: {
        komposition: 'raster',
        kante: 'kantig',
        avatar: 'schild',
        muster: 'linien',
        schrift: 'technisch',
      },
    },
    angaben: {
      tagline: 'Feierabend-Valorant mit zu viel Gerede.',
      bio: null,
      sprachen: ['Deutsch', 'Englisch'],
      plattformen: ['PC', 'PlayStation'],
      spielzeiten: ['Wochentags abends'],
      absprache: ['Immer im Voice'],
      spielart: 'Beides',
      verfuegbarkeit: { key: 'LOOKING', label: 'Sucht Mitspieler' },
    },
    level: {
      level: 42,
      xp: 120_000,
      fortschritt: 0.4,
      naechstesLevelXp: 130_000,
      fehlendeXp: 10_000,
      hoechstlevel: false,
      rang: 7,
    },
    spiele: [
      {
        id: 'a',
        gameId: 'a',
        name: 'Valorant',
        kurz: 'VAL',
        cover: null,
        plattform: 'PC',
        notiz: null,
        favorit: true,
        archiviert: false,
        felder: [],
      },
      {
        id: 'b',
        gameId: 'b',
        name: 'Counter-Strike 2',
        kurz: 'CS2',
        cover: null,
        plattform: 'PC',
        notiz: null,
        favorit: false,
        archiviert: false,
        felder: [],
      },
    ],
    vitrine: [],
    auszeichnungen: [],
    hervorgehobene: [
      {
        key: 'og',
        label: 'OG Member',
        beschreibung: 'Von Anfang an dabei.',
        symbol: 'Medal',
        stufe: 'gold',
        erreicht: true,
        fortschritt: null,
        verliehen: true,
      },
      {
        key: 'turnier',
        label: 'Turniersieger',
        beschreibung: 'Ein Turnier gewonnen.',
        symbol: 'Trophy',
        stufe: 'gold',
        erreicht: true,
        fortschritt: null,
      },
    ],
    abschnitte: ['streaming', 'gaming', 'links'],
    indexierbar: true,
    ...teile,
  } as Profil;
}

async function rendere(
  format: GamerCardFormat,
  teile: Partial<Parameters<typeof zeichneGamerCard>[0]> = {},
): Promise<Uint8Array> {
  const mass = GAMER_CARD_MASSE[format];
  const bild = new ImageResponse(
    zeichneGamerCard({
      format,
      profil: profil(),
      adresse: 'https://system.swisshub.gg/u/lea',
      bildQuelle: null,
      bannerQuelle: null,
      qrQuelle: qrDatenUri('https://system.swisshub.gg/u/lea'),
      ...teile,
    }),
    { width: mass.breite, height: mass.hoehe },
  );
  return new Uint8Array(await bild.arrayBuffer());
}

describe('Gamer Card: Masse und Bytes', () => {
  it.each(GAMER_CARD_FORMATE)('zeichnet %s in genau den erwarteten Massen', async (format) => {
    const bytes = await rendere(format);
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(pngMasse(bytes)).toEqual(GAMER_CARD_MASSE[format]);
  });

  it('kennt drei Formate und sonst keines', () => {
    expect([...GAMER_CARD_FORMATE]).toEqual(['story', 'quadrat', 'feed']);
    expect(GAMER_CARD_MASSE.story).toEqual({ breite: 1080, hoehe: 1920 });
    expect(GAMER_CARD_MASSE.quadrat).toEqual({ breite: 1080, hoehe: 1080 });
    expect(GAMER_CARD_MASSE.feed).toEqual({ breite: 1080, hoehe: 1350 });
  });

  it('nimmt keine erfundene Formatangabe an', () => {
    // Das Format kommt aus einem Abfrageparameter - also von aussen.
    expect(istGamerCardFormat('story')).toBe(true);
    expect(istGamerCardFormat('1080x1080')).toBe(false);
    expect(istGamerCardFormat('../../etc/passwd')).toBe(false);
    expect(istGamerCardFormat('')).toBe(false);
  });

  it('zeichnet ohne QR-Code genauso', async () => {
    // `?qr=0` - wer den Code nicht will, bekommt trotzdem eine Karte.
    const bytes = await rendere('quadrat', { qrQuelle: null });
    expect(pngMasse(bytes)).toEqual(GAMER_CARD_MASSE.quadrat);
  });
});

describe('Gamer Card: Faelle, die niemand von Hand testet', () => {
  it('haelt einen langen Namen und ein langes Motto im Bild', async () => {
    /*
     * Die Grenzen des Datenmodells: `displayName` darf 32 Zeichen haben, die
     * Tagline 80. Beides gleichzeitig ist der Fall, an dem ein Layout bricht -
     * und beides kommt vor.
     */
    const bytes = await rendere('story', {
      profil: profil({
        identitaet: { ...profil().identitaet, profilname: 'D'.repeat(32) },
        angaben: { ...profil().angaben!, tagline: 'M'.repeat(80) },
        spiele: Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          gameId: String(index),
          name: `Ein Spiel mit ziemlich langem Namen ${index}`,
          kurz: 'X',
          cover: null,
          plattform: 'PC',
          notiz: null,
          favorit: false,
          archiviert: false,
          felder: [],
        })),
      }) as Profil,
    });
    expect(pngMasse(bytes)).toEqual(GAMER_CARD_MASSE.story);
  });

  it('zeichnet Umlaute und Unicode-Namen', async () => {
    for (const name of ['Jörg Müller', 'Céline', 'Лена', '日本のゲーマー', '🎮 Lea 🎮']) {
      const bytes = await rendere('quadrat', {
        profil: profil({ identitaet: { ...profil().identitaet, profilname: name } }) as Profil,
      });
      expect(pngMasse(bytes), name).toEqual(GAMER_CARD_MASSE.quadrat);
    }
  });

  it('zeichnet ein Profil ohne jedes Beiwerk', async () => {
    /*
     * Ein frisch oeffentlich gestelltes Profil: kein Motto, keine Spiele, kein
     * Level, keine Auszeichnungen, kein Bild. Die Karte muss trotzdem entstehen -
     * sonst waere der Export genau fuer die neuen Mitglieder unbenutzbar.
     */
    const bytes = await rendere('feed', {
      profil: {
        ...profil(),
        angaben: undefined,
        spiele: undefined,
        level: null,
        hervorgehobene: [],
      } as Profil,
    });
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(pngMasse(bytes)).toEqual(GAMER_CARD_MASSE.feed);
  });

  it('zeichnet jedes Theme, ohne dass eine Farbe verloren geht', async () => {
    /*
     * Die Farben kommen als HSL-Tripel aus der Registry und muessen fuer Satori
     * in `hsl(h, s%, l%)` uebersetzt werden. Ein Tripel, das nicht uebersetzt
     * wird, ergibt **keinen Fehler**, sondern schwarzen Text auf schwarzem
     * Grund. Deshalb wird hier jede Uebersetzung einzeln geprueft - und danach
     * jedes Theme gezeichnet.
     */
    expect(hslFarbe('358 85% 58%', '#000')).toBe('hsl(358, 85%, 58%)');
    expect(hslFarbe('0 0% 100%', '#000')).toBe('hsl(0, 0%, 100%)');
    // Was nicht nach einem Tripel aussieht, wird nicht geraten.
    expect(hslFarbe('red', '#abc')).toBe('#abc');
    expect(hslFarbe('358 85%', '#abc')).toBe('#abc');
    expect(hslFarbe('url(javascript:alert(1))', '#abc')).toBe('#abc');
    expect(hslFarbe(undefined, '#abc')).toBe('#abc');

    for (const theme of ['classic', 'crimson', 'aurora', 'cyber', 'matrix', 'nebula', 'prestige']) {
      const bytes = await rendere('quadrat', {
        profil: profil({
          gestaltung: { ...profil().gestaltung, theme },
        }) as Profil,
      });
      expect(pngMasse(bytes), theme).toEqual(GAMER_CARD_MASSE.quadrat);
    }
  });

  it('zeigt das Hoechstlevel als Prestige und nicht als Zahl mit Leiste', async () => {
    const bytes = await rendere('story', {
      profil: profil({
        level: { ...profil().level!, hoechstlevel: true, fortschritt: 1, fehlendeXp: 0 },
      }) as Profil,
    });
    expect(pngMasse(bytes)).toEqual(GAMER_CARD_MASSE.story);
  });

  it('baut einen Dateinamen, der sich auf jedem System speichern laesst', () => {
    expect(gamerCardDateiname('Lea', 'story')).toBe('swisshub-gamer-card-lea-story.png');
    // Pfadtrenner und Punkte verschwinden - der Name kommt aus einem Profil.
    expect(gamerCardDateiname('../../etc/passwd', 'feed')).toBe('swisshub-gamer-card-etc-passwd-feed.png');
    expect(gamerCardDateiname('🎮🎮', 'quadrat')).toBe('swisshub-gamer-card-profil-quadrat.png');
  });
});

describe('QR-Code', () => {
  it('baut ein SVG, das die Adresse enthaelt', () => {
    const svg = qrSvg('https://system.swisshub.gg/u/lea');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox');
    // Ein Pfad mit Modulen - ein SVG ohne Pfad waere ein weisses Quadrat.
    expect(svg).toContain('<path');
    expect(svg.length).toBeGreaterThan(2_000);
  });

  it('waechst mit der Laenge der Adresse, statt abzubrechen', () => {
    /*
     * Ein Slug darf 32 Zeichen haben, und die Adresse kommt davor. Der Encoder
     * waehlt die Version selbst (`typeNumber: 0`); eine feste Version waere bei
     * einem langen Slug ein Wurf mitten im Export.
     */
    const kurz = qrSvg('https://a.ch/u/ab');
    const lang = qrSvg(`https://system.swisshub.gg/u/${'a'.repeat(32)}`);
    expect(lang.length).toBeGreaterThan(kurz.length);
  });

  it('wird zu einem Daten-URI, den Satori laden kann', () => {
    const uri = qrDatenUri('https://system.swisshub.gg/u/lea');
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    // Base64 und nicht Prozentkodierung: der SVG-Inhalt enthaelt `#`, `<` und
    // `"`, und eine unvollstaendige Kodierung ergibt ein Bild, das still nicht
    // geladen wird.
    expect(uri).not.toContain('<svg');
  });

  it('nimmt Fehlerkorrektur Q, damit ein Ausdruck lesbar bleibt', () => {
    // Nicht am Ergebnis messbar, aber am Quelltext: `Q` verkraftet rund 25
    // Prozent Schaden, `M` rund 15. §13.4 verlangt Lesbarkeit auf Papier.
    const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/profile/qr.ts'), 'utf8');
    expect(quelle).toContain("qrcode(0, 'Q')");
  });
});

/**
 * Der untere Rand der Karte - an den Pixeln gemessen.
 *
 * ## Warum das kein Blick auf den Code leisten kann
 *
 * Die Karte ist eine Spalte: Kopfzone, Name, Kennzahlen, Spielliste, ein
 * Fuellfeld und ganz unten der Fussbalken mit Adresse und QR-Code. Passt der
 * Inhalt darueber nicht, gibt **das Fuellfeld** nach - es ist das einzige
 * Stueck mit `flexShrink`, und das ist Absicht: lieber weniger Luft als ein
 * Fussbalken, der aus der Karte laeuft.
 *
 * Genau daran ist der Fehler aber nicht zu sehen. Beim quadratischen Format
 * war die Karte vollstaendig - Balken da, Adresse da, QR-Code da - und trotzdem
 * falsch: der Plattform-Chip sass ohne einen Pixel Abstand auf der roten
 * Kante. Kein Mass war ueberschritten, keine Ausnahme flog, das PNG hatte die
 * richtige Groesse. Nur das Fuellfeld hatte seinen Abstand hergegeben.
 *
 * Deshalb wird hier das fertige Bild gelesen:
 *
 *  - **Wie hoch ist das Akzentband unten?** Genau `gamerCardFussHoehe`. Ist es
 *    null, ist der Fussbalken aus der Karte gelaufen; ist es groesser, hat
 *    etwas anderes die Farbe.
 *  - **Wie viele gleichfarbige Zeilen liegen darueber?** Mindestens
 *    `GAMER_CARD_FUSS_LUFT`. Weniger heisst: das Fuellfeld hat nachgegeben,
 *    und der Inhalt klebt am Balken.
 *
 * Gemessen wird am **vollsten** Profil, das es geben kann - Hoechstlevel, vier
 * Spiele, drei Auszeichnungen, drei Plattformen, langes Motto -, denn das ist
 * der Fall, der zuerst anstoesst. Ein duennes Profil bestuende jede dieser
 * Pruefungen auch mit einem zu knapp gerechneten Format.
 */
describe('Gamer Card: der untere Rand', () => {
  /** Ein Profil, das jede Zone der Karte bis an ihre Grenze fuellt. */
  const vollesProfil = (): Profil =>
    profil({
      identitaet: {
        discordId: '100000000000000002',
        name: 'maximiliane_von_hirzenbach',
        profilname: 'Maximiliane von Hirzenbach',
        avatarHash: null,
        mitgliedSeit: new Date('2023-01-01T00:00:00.000Z'),
        boostet: true,
      },
      level: {
        level: 50,
        xp: 900_000,
        fortschritt: 1,
        naechstesLevelXp: 900_000,
        fehlendeXp: 0,
        hoechstlevel: true,
        rang: 1,
      },
      spiele: ['Valorant', 'Counter-Strike 2', 'Lethal Company', 'Helldivers 2'].map((name, index) => ({
        id: `spiel-${index}`,
        gameId: `spiel-${index}`,
        name,
        kurz: name.slice(0, 3).toUpperCase(),
        cover: null,
        plattform: 'PC',
        notiz: null,
        favorit: index === 0,
        archiviert: false,
        felder: [],
      })),
      hervorgehobene: (['gold', 'silber', 'bronze'] as const).map((stufe, index) => ({
        key: `auszeichnung-${index}`,
        label: `Auszeichnung mit einem langen Namen ${index + 1}`,
        beschreibung: 'Eine Beschreibung, die ebenfalls nicht kurz ist.',
        symbol: 'Trophy',
        stufe,
        erreicht: true,
        fortschritt: null,
      })),
    } as Partial<Profil>);

  /**
   * Zeilenweise Farben aus dem PNG.
   *
   * `sharp` und nicht ein eigener Dekoder: das PNG aus `next/og` ist
   * komprimiert, und ein selbstgebauter Leser waere die zweite Stelle, an der
   * dieser Test falschliegen koennte.
   */
  async function farben(bytes: Uint8Array): Promise<{
    breite: number;
    hoehe: number;
    punkt: (x: number, y: number) => string;
  }> {
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
    return {
      breite: info.width,
      hoehe: info.height,
      punkt: (x, y) => {
        const start = (y * info.width + x) * info.channels;
        return `${data[start]},${data[start + 1]},${data[start + 2]}`;
      },
    };
  }

  /*
   * Gemessen wird an `x = 8`: links vom Polster, also dort, wo der Fussbalken
   * nur seine eigene Farbe traegt - kein QR-Code, kein Text. Und darueber
   * liegt an dieser Stelle die Flaeche der Karte, auf der die Chips sitzen.
   */
  const MESSSPALTE = 8;

  it.each(GAMER_CARD_FORMATE)(
    'setzt den Fussbalken in %s an die untere Kante - in voller Hoehe',
    async (format) => {
      const bild = await farben(await rendere(format, { profil: vollesProfil() }));
      const balkenFarbe = bild.punkt(MESSSPALTE, bild.hoehe - 1);

      let band = 0;
      for (let y = bild.hoehe - 1; y >= 0; y--) {
        if (bild.punkt(MESSSPALTE, y) !== balkenFarbe) {
          break;
        }
        band++;
      }

      expect(band, `Akzentband in ${format}`).toBe(gamerCardFussHoehe(format));
    },
  );

  it.each(GAMER_CARD_FORMATE)('laesst in %s Luft zwischen Inhalt und Fussbalken', async (format) => {
    const bild = await farben(await rendere(format, { profil: vollesProfil() }));
    const obenAmBalken = bild.hoehe - gamerCardFussHoehe(format);

    /*
     * Die Referenzfarbe kommt vom rechten Rand derselben Zeile. Die Chips
     * stehen links; rechts davon ist in jedem Fall Flaeche. Damit misst der
     * Test nicht gegen eine fest eingetragene Farbe, sondern gegen das, was
     * die Karte an dieser Stelle selbst zeigt - er ueberlebt einen
     * Themewechsel.
     */
    const flaeche = bild.punkt(bild.breite - MESSSPALTE, obenAmBalken - 1);

    let luft = 0;
    for (let y = obenAmBalken - 1; y >= 0; y--) {
      let gleich = true;
      for (let x = 0; x < bild.breite; x += 4) {
        if (bild.punkt(x, y) !== flaeche) {
          gleich = false;
          break;
        }
      }
      if (!gleich) {
        break;
      }
      luft++;
    }

    expect(luft, `Luft ueber dem Fussbalken in ${format}`).toBeGreaterThanOrEqual(GAMER_CARD_FUSS_LUFT);
  });
});
