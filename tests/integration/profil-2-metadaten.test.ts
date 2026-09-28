import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_2_meta');

/**
 * Die tatsaechliche HTTP-Ausgabe der oeffentlichen Profiladressen.
 *
 * ## Warum das nicht schon durch die uebrigen Tests abgedeckt ist
 *
 * Weil bisher jeder Test die **Daten** prueft. Ob `baueOeffentlichesProfil`
 * ein Level ausliefert, sagt aber nichts darueber, ob am Ende ein Bild
 * herauskommt. Dazwischen liegt Satori, und Satori scheitert still: bei
 * `text-transform`, bei `clip-path`, bei einem `box-shadow` mit
 * Streuungsradius, bei einem Element ohne `display: flex`, bei `hsl()` in der
 * Leerzeichen-Schreibweise. Das Ergebnis ist dann kein Fehler, sondern eine
 * **leere oder halbe Datei** - genau das, was §13.3 verbietet.
 *
 * Deshalb wird hier auf die Bytes geschaut: PNG-Signatur, Breite und Hoehe aus
 * dem IHDR-Block, Dateigroesse. Ein 1080 x 1920 grosses Bild, das nur aus
 * Hintergrund besteht, waere winzig; ein gezeichnetes ist es nicht.
 *
 * ## Und die Gegenrichtung
 *
 * Dieselben Adressen mit einem privaten und einem gesperrten Profil. Ein
 * Bilddienst, der ohne Anmeldung laeuft, ist der bequemste Weg, private Daten
 * zu lesen - wenn er die Sichtbarkeit nicht mitprueft.
 */
const { NextRequest } = await import('next/server');
const { appBaseUrl, appUrl } = await import('@swisshub/config');
const { systemRoutes } = await import('@swisshub/shared');
const { qrSvg } = await import('@/modules/profile/qr');
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');
const { GET: kartenBild } = await import('@/app/u/[slug]/karte/route');
const { GET: gamerCard } = await import('@/app/api/profil/gamer-card/[slug]/route');
const { GET: qrBild } = await import('@/app/api/profil/qr/[slug]/route');
const { profilMetadaten } = await import('@/modules/profile/oe-metadaten');
const robots = (await import('@/app/robots')).default;
const sitemap = (await import('@/app/sitemap')).default;

const ANNA = '200000000000000001';
const BEN = '200000000000000002';
const CARLA = '200000000000000003';

const GEHEIMNIS = 'GRUND-DER-SPERRE-XYZ';

/** Die Masse, die §13.3 als «exakte Aufloesung» verlangt. */
const FORMATE = [
  { format: 'story', breite: 1080, hoehe: 1920 },
  { format: 'quadrat', breite: 1080, hoehe: 1080 },
  { format: 'feed', breite: 1080, hoehe: 1350 },
] as const;

/**
 * Breite und Hoehe aus dem PNG selbst.
 *
 * Ein PNG beginnt mit acht Signaturbytes, dann kommt der IHDR-Block: vier
 * Bytes Laenge, vier Bytes Typ, dann Breite und Hoehe als 32-Bit-Zahlen. Das
 * ist die einzige Stelle, an der die Aufloesung **im Bild** steht - ein
 * Content-Type-Header kann jeder setzen.
 */
function pngMasse(bytes: Uint8Array): { breite: number; hoehe: number } {
  const signatur = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signatur.entries()) {
    expect(bytes[index], `Byte ${index} ist keine PNG-Signatur`).toBe(byte);
  }
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('IHDR');
  return { breite: sicht.getUint32(16), hoehe: sicht.getUint32(20) };
}

async function bytes(antwort: Response): Promise<Uint8Array> {
  return new Uint8Array(await antwort.arrayBuffer());
}

/**
 * Eine Anfrage, wie Next sie an den Handler gibt.
 *
 * Die Bildrouten lesen `request.nextUrl.searchParams`. Ein gewoehnliches
 * `Request` hat das nicht - ein Test damit prueft also den Handler in einer
 * Form, in der er nie laeuft.
 */
const anfrage = (pfad: string): InstanceType<typeof NextRequest> =>
  new NextRequest(new URL(pfad, 'https://system.swisshub.gg'));

const params = (slug: string): { params: Promise<{ slug: string }> } => ({
  params: Promise.resolve({ slug }),
});

async function mitglied(discordId: string, name: string): Promise<void> {
  await prisma.discordMemberCache.create({
    data: {
      discordId,
      username: name.toLowerCase(),
      displayName: name,
      joinedAt: new Date('2024-01-01'),
    },
  });
}

describeWithDatabase('Public Profile 2.0: HTTP-Ausgabe der Metadaten und Bilder', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberProfileLink.deleteMany();
    await prisma.memberSocialLink.deleteMany();
    await prisma.memberProfileSlugAlias.deleteMany();
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await mitglied(ANNA, 'Anna');
    await mitglied(BEN, 'Ben');
    await mitglied(CARLA, 'Carla');

    await prisma.memberProfile.create({
      data: {
        discordId: ANNA,
        publicSlug: 'anna',
        visibilityProfile: 'PUBLIC',
        publicIndexable: true,
        displayName: 'Anna «Ännu» Müller',
        tagline: 'Sucht Mitspieler für Ranked.',
        bio: 'Ein Satz über mich.',
        languages: ['de', 'en'],
        platforms: ['PC'],
        publicLockReason: GEHEIMNIS,
      },
    });
    // Ben: oeffentlich, aber ausdruecklich nicht indexiert.
    await prisma.memberProfile.create({
      data: {
        discordId: BEN,
        publicSlug: 'ben',
        visibilityProfile: 'PUBLIC',
        publicIndexable: false,
        displayName: 'Ben',
      },
    });
    // Carla: privat.
    await prisma.memberProfile.create({
      data: { discordId: CARLA, publicSlug: 'carla', visibilityProfile: 'PRIVATE', displayName: 'Carla' },
    });
  });

  it('liefert die Vorschaukarte als echtes PNG in 1200 x 630', async () => {
    const antwort = await kartenBild(anfrage('/u/anna/karte'), params('anna'));
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get('content-type')).toContain('image/png');

    const daten = await bytes(antwort);
    expect(pngMasse(daten)).toEqual({ breite: 1200, hoehe: 630 });
    /*
     * Die Groessengrenze ist der eigentliche Test. Scheitert Satori an einer
     * einzelnen Eigenschaft, kommt ein Bild heraus, das nur aus Hintergrund
     * besteht - richtige Masse, richtiger Typ, und trotzdem leer. Eine
     * gezeichnete Karte mit Name, Zeile und Abzeichen liegt weit darueber.
     */
    expect(daten.byteLength).toBeGreaterThan(8000);
  }, 30_000);

  it('zeichnet die Gamer Card in allen drei Formaten mit exakter Aufloesung', async () => {
    for (const { format, breite, hoehe } of FORMATE) {
      const antwort = await gamerCard(
        anfrage(`/api/profil/gamer-card/anna?format=${format}`),
        params('anna'),
      );
      expect(antwort.status, format).toBe(200);
      expect(antwort.headers.get('content-type'), format).toContain('image/png');

      const daten = await bytes(antwort);
      expect(pngMasse(daten), format).toEqual({ breite, hoehe });
      expect(daten.byteLength, format).toBeGreaterThan(8000);

      // Im Browser anzeigen, nicht erzwungen herunterladen - der Dateiname
      // steht trotzdem darin, damit ein «Bild speichern» nicht `anna` heisst.
      const ablage = antwort.headers.get('content-disposition') ?? '';
      expect(ablage, format).toContain('inline');
      expect(ablage, format).toContain('.png');
    }
  }, 60_000);

  it('nimmt ein unbekanntes Format nicht an', async () => {
    const antwort = await gamerCard(
      anfrage('/api/profil/gamer-card/anna?format=../etc/passwd'),
      params('anna'),
    );
    expect(antwort.status).toBe(400);
  });

  it('liefert den QR-Code als SVG und auf Wunsch als Download', async () => {
    const anzeigen = await qrBild(anfrage('/api/profil/qr/anna'), params('anna'));
    expect(anzeigen.status).toBe(200);
    expect(anzeigen.headers.get('content-type')).toContain('image/svg+xml');

    const svg = await anzeigen.text();
    expect(svg).toMatch(/^<svg/u);
    expect(svg).toContain('</svg>');
    expect(svg.length).toBeGreaterThan(400);

    /*
     * Welche Adresse der Code traegt.
     *
     * Ohne Kamera laesst sich das nur vergleichen: derselbe Code, aus der
     * Adresse gebaut, die darin stehen soll. Stimmen die Muster ueberein,
     * kodiert er genau diese Zeichenkette - und damit ist auch belegt, dass
     * er **keinen** doppelten Schraegstrich enthaelt.
     *
     * Das war der eigentliche Schaden des Fehlers: `${appUrl()}/u/manu` ergab
     * `https://host//u/manu`, und diese Adresse stand in jedem QR-Code. Auf
     * einer gedruckten Karte ist das nicht mehr zu korrigieren.
     */
    const erwartet = qrSvg(appUrl(systemRoutes.oeffentlichesProfil('anna')));
    expect(svg).toBe(erwartet);
    expect(appUrl(systemRoutes.oeffentlichesProfil('anna')).split('//')).toHaveLength(2);

    /*
     * Und die Gegenrichtung: ein anderer Slug ergibt ein anderes Muster.
     * Ein Code, der fuer alle gleich aussieht, waere ein Code, der nichts
     * kodiert - und das faellt beim Ausdrucken niemandem auf.
     */
    await profile.aendereSlug(BEN, 'ben-der-lange-name');
    const andere = await qrBild(anfrage('/api/profil/qr/ben-der-lange-name'), params('ben-der-lange-name'));
    expect(await andere.text()).not.toBe(svg);

    const laden = await qrBild(anfrage('/api/profil/qr/anna?download=1'), params('anna'));
    expect(laden.headers.get('content-disposition')).toContain('attachment');
  });

  it('verweigert alle drei Bilder fuer ein privates Profil', async () => {
    /*
     * Der wichtigste Test dieser Datei. Die Bildrouten brauchen keine
     * Anmeldung - waere die Sichtbarkeit hier nicht geprueft, waere jedes
     * private Profil ueber sein Vorschaubild lesbar.
     */
    const karte = await kartenBild(anfrage('/u/carla/karte'), params('carla'));
    expect(karte.status).toBe(404);

    const card = await gamerCard(anfrage('/api/profil/gamer-card/carla'), params('carla'));
    expect(card.status).toBe(404);

    const qr = await qrBild(anfrage('/api/profil/qr/carla'), params('carla'));
    expect(qr.status).toBe(404);
  });

  it('verweigert alle drei Bilder fuer ein von der Moderation gesperrtes Profil', async () => {
    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { publicLockedAt: new Date(), publicLockReason: GEHEIMNIS },
    });

    const karte = await kartenBild(anfrage('/u/anna/karte'), params('anna'));
    expect(karte.status).toBe(404);
    const card = await gamerCard(anfrage('/api/profil/gamer-card/anna'), params('anna'));
    expect(card.status).toBe(404);
    const qr = await qrBild(anfrage('/api/profil/qr/anna'), params('anna'));
    expect(qr.status).toBe(404);
  });

  it('liefert absolute Adressen - der Grund, warum Discord nichts anzeigte', async () => {
    /*
     * Hier stand `url: '/u/manu'`, also eine **relative** Adresse. Next loest
     * die in den Metadaten gegen `metadataBase` auf; die war nirgends gesetzt,
     * also nahm Next `http://localhost:3000`. Im ausgelieferten HTML stand
     *
     *     <meta property="og:image" content="http://localhost:3123/u/manu/karte?v=…">
     *
     * - gemessen an einem laufenden Produktionsserver, mit dem Port, auf dem
     * er zufaellig lauschte. Discord holt diese Adresse, findet nichts, und
     * zeigt eine Vorschau ohne Bild.
     */
    const meta = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna'));
    const basis = appBaseUrl();

    expect(meta.metadataBase?.toString()).toContain(basis);
    expect(meta.alternates?.canonical).toBe(`${basis}/u/anna`);
    expect(meta.openGraph?.url).toBe(`${basis}/u/anna`);

    const bild = (meta.openGraph?.images as { url: string }[] | undefined)?.[0];
    expect(bild?.url.startsWith(`${basis}/u/anna/karte?v=`)).toBe(true);
    /*
     * Und keine zweite Herkunft.
     *
     * «Kein localhost» waere die naheliegende Pruefung und hier die falsche:
     * in der Testumgebung **ist** die eingestellte Adresse `localhost:3000`.
     * Der Fehler war nicht der Hostname, sondern dass Next einen eigenen
     * einsetzte statt des eingestellten. Geprueft wird deshalb, dass jede
     * absolute Adresse dieselbe Herkunft hat wie die Konfiguration.
     */
    const herkuenfte = new Set(
      [...JSON.stringify(meta).matchAll(/https?:\/\/[^"\\/]+/gu)].map((treffer) => treffer[0]),
    );
    expect([...herkuenfte]).toEqual([new URL(basis).origin]);
  });

  it('nennt Masse und Typ des Vorschaubildes', async () => {
    /*
     * Discord entscheidet an `og:image:width` und `og:image:height`, ob es
     * eine grosse Vorschau zeigt oder ein Bildchen neben dem Text. Ohne die
     * Angaben muss es das Bild erst laden und messen - und solange steht im
     * Kanal eine Vorschau ohne Bild.
     *
     * Die Masse stehen hier und in der Bildroute; dass sie zusammenpassen,
     * prueft der Test weiter oben, der Breite und Hoehe aus dem PNG liest.
     */
    const meta = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna'));
    const bild = (meta.openGraph?.images as { width?: number; height?: number; type?: string }[])[0];

    expect(bild?.width).toBe(1200);
    expect(bild?.height).toBe(630);
    expect(bild?.type).toBe('image/png');
    /*
     * `Twitter` ist in Nexts Typen eine Vereinigung mehrerer Kartenarten;
     * `card` steht nur auf einigen davon. Der Umweg ueber `JSON` prueft, was
     * tatsaechlich ausgeliefert wird - und darum geht es hier.
     */
    expect(JSON.stringify(meta.twitter)).toContain('"card":"summary_large_image"');
  });

  it('setzt die Metadaten der Seite mit Titel, Bild und kanonischer Adresse', async () => {
    const meta = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna'));
    const text = JSON.stringify(meta);

    expect(meta.title).toContain('Anna');
    expect(meta.alternates?.canonical).toContain('/u/anna');
    // Das Vorschaubild zeigt auf die eigene Route, nicht auf einen fremden Dienst.
    expect(text).toContain('/u/anna/karte');
    // Und es traegt einen Stand, damit Discord nach einer Aenderung neu holt.
    expect(text).toMatch(/karte\?v=/u);
    // Kein privates Feld in den Metadaten - sie stehen im Quelltext jeder Seite.
    expect(text).not.toContain(GEHEIMNIS);
    expect(text).not.toContain(ANNA);
  });

  it('erlaubt Suchmaschinen nur bei ausdruecklich indexierten Profilen', async () => {
    const offen = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna'));
    expect(offen.robots).toMatchObject({ index: true });

    const zu = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('ben'));
    expect(zu.robots).toMatchObject({ index: false });
    /*
     * `follow: true` bleibt auch beim nicht indexierten Profil: die Seite soll
     * nicht in Suchergebnissen stehen, aber ein Link darauf ist kein
     * Sackgassenlink. «Nicht indexiert» ist ohnehin kein Zugriffsschutz - wer
     * die Adresse hat, sieht die Seite. Genau so steht es auch im Editor.
     */
    expect(zu.robots).toMatchObject({ follow: true });
  });

  it('leitet die Metadaten eines umgezogenen Slugs nicht ins Leere', async () => {
    await profile.aendereSlug(ANNA, 'anna-spielt');
    const meta = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna'));
    // Kein Titel des falschen Profils, kein leerer Titel: die Seite selbst
    // antwortet mit einer dauerhaften Weiterleitung, die Metadaten bleiben
    // deshalb leer statt zu raten.
    expect(JSON.stringify(meta)).not.toContain(GEHEIMNIS);

    const neu = profilMetadaten(await profile.ladeOeffentlichesProfilOderSperre('anna-spielt'));
    expect(neu.alternates?.canonical).toContain('/u/anna-spielt');
  });

  it('gibt in robots.txt nur die oeffentlichen Bereiche frei', async () => {
    const regeln = robots();
    const text = JSON.stringify(regeln);
    expect(text).toContain('/u/');
    expect(regeln.sitemap).toBeDefined();
    // Nichts aus dem angemeldeten Bereich.
    expect(text).not.toContain('/system');
    expect(text).not.toContain('/api/');
  });

  it('nimmt in die Sitemap nur indexierte oeffentliche Profile', async () => {
    const eintraege = await sitemap();
    const adressen = eintraege.map((eintrag) => eintrag.url);

    expect(adressen.some((adresse) => adresse.endsWith('/u/anna'))).toBe(true);
    // Ben ist oeffentlich, aber nicht indexiert; Carla ist privat.
    expect(adressen.some((adresse) => adresse.endsWith('/u/ben'))).toBe(false);
    expect(adressen.some((adresse) => adresse.endsWith('/u/carla'))).toBe(false);
  });

  it('nimmt ein gesperrtes Profil sofort aus der Sitemap', async () => {
    await prisma.memberProfile.update({ where: { discordId: ANNA }, data: { publicLockedAt: new Date() } });
    const adressen = (await sitemap()).map((eintrag) => eintrag.url);
    expect(adressen.some((adresse) => adresse.endsWith('/u/anna'))).toBe(false);
  });
});
