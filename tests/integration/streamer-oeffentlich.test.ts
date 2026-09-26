import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_streamer_oeffentlich');

/**
 * Was ohne Anmeldung herausgeht - und was nicht.
 *
 * ## Warum das gegen eine Datenbank geprueft wird
 *
 * Weil die Zusage aus §15 eine Aussage ueber echte Zeilen ist: das
 * Streamer-Profil hat Spalten, die niemand sehen darf - ein Ablehnungsgrund,
 * ein Pausierungsgrund, wer entschieden hat, der letzte Fehler einer
 * Plattformabfrage. Ein Test gegen eine Nachbildung koennte nur bestaetigen,
 * dass die Nachbildung diese Spalten nicht hat.
 *
 * Geprueft wird deshalb so: die Zeilen bekommen **absichtlich** Werte in genau
 * diesen Spalten, und danach wird das ausgelieferte Objekt als Text durchsucht.
 * Nicht Feld fuer Feld - eine Liste von Feldern, die man prueft, vergisst das
 * naechste. Ein Text, in dem ein Wort nicht vorkommen darf, vergisst nichts.
 *
 * ## Und die Gegenrichtung
 *
 * Ein nicht freigegebener Streamer existiert oeffentlich nicht. Dieselbe
 * Antwort fuer «gibt es nicht», «in Pruefung», «abgelehnt» und «pausiert» -
 * sonst liessen sich Adressen durchprobieren, um zu erfahren, wer sich beworben
 * hat.
 */
const { prisma } = await import('@swisshub/database');
const { streamer, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const LEA = '100000000000000001';
const BEN = '100000000000000002';
const MOD = '100000000000000009';

/** Woerter, die in keiner oeffentlichen Antwort vorkommen duerfen. */
const GEHEIM = {
  ablehnung: 'GRUND-DER-ABLEHNUNG-XYZ',
  pausierung: 'GRUND-DER-PAUSIERUNG-XYZ',
  fehler: 'LETZTER-API-FEHLER-XYZ',
};

async function einstellungen(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(streamer.STREAMER_MODULE_ID, true, 'test');
  await setModuleSettings(
    streamer.STREAMER_MODULE_ID,
    { oeffentlichAktiv: true, twitchAktiv: false, youtubeAktiv: false, ...teile },
    'test',
  );
}

async function anlegen(
  discordId: string,
  name: string,
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED',
  oeffentlich = true,
): Promise<{ profilId: string; kanalId: string }> {
  await prisma.discordMemberCache.create({
    data: { discordId, username: name.toLowerCase(), displayName: name },
  });
  await prisma.memberProfile.create({
    data: {
      discordId,
      displayName: name,
      publicSlug: name.toLowerCase(),
      visibilityProfile: oeffentlich ? 'PUBLIC' : 'MEMBERS',
    },
  });
  const profil = await prisma.streamerProfil.create({
    data: {
      discordId,
      status,
      sprachen: ['de'],
      beschreibung: `${name} streamt abends.`,
      ankuendigungAktiv: true,
      // Absichtlich gesetzt: genau das darf nicht herauskommen.
      ablehnungsGrund: GEHEIM.ablehnung,
      pausierungsGrund: GEHEIM.pausierung,
      entschiedenVon: MOD,
      entschiedenAm: new Date(),
    },
  });
  const kanal = await prisma.streamerKanal.create({
    data: {
      profilId: profil.id,
      plattform: 'TWITCH',
      externeId: `1000${discordId.slice(-2)}`,
      handle: `${name.toLowerCase()}_streamt`,
      anzeigename: name,
      verifikation: 'OAUTH',
      aktiv: true,
      letzterFehler: GEHEIM.fehler,
      letzterFehlerAm: new Date(),
    },
  });
  return { profilId: profil.id, kanalId: kanal.id };
}

/** Das ausgelieferte Objekt als Text - fuer die Suche nach dem, was fehlen muss. */
const alsText = (wert: unknown): string =>
  JSON.stringify(wert, (_schluessel, inhalt) => (typeof inhalt === 'bigint' ? inhalt.toString() : inhalt));

describeWithDatabase('Streamer Hub: oeffentliche Daten', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.streamerSpotlight.deleteMany();
    // Auch der Spielkatalog: sonst bliebe die Zeile aus dem vorigen Lauf stehen
    // und der Test waere beim zweiten Mal rot.
    await prisma.memberGameProfile.deleteMany();
    await prisma.game.deleteMany();
    await prisma.streamerAnkuendigung.deleteMany();
    await prisma.streamerSession.deleteMany();
    await prisma.streamerKanal.deleteMany();
    await prisma.streamerProfil.deleteMany();
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await einstellungen();
  });

  it('liefert keine Moderationsdaten und keinen Plattformfehler nach aussen', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');

    const liste = alsText(await streamer.ladeOeffentlicheListe());
    const einzeln = alsText(await streamer.ladeOeffentlichenStreamer('lea'));
    const imProfil = alsText(await streamer.ladeProfilStreaming(LEA, 'lea'));

    for (const [name, text] of [
      ['Uebersicht', liste],
      ['Streamer-Seite', einzeln],
      ['Profilabschnitt', imProfil],
    ] as const) {
      expect(text, `${name}: Ablehnungsgrund`).not.toContain(GEHEIM.ablehnung);
      expect(text, `${name}: Pausierungsgrund`).not.toContain(GEHEIM.pausierung);
      expect(text, `${name}: letzter Plattformfehler`).not.toContain(GEHEIM.fehler);
      // Wer entschieden hat, ist eine interne Angabe - und eine Discord-ID.
      expect(text, `${name}: entschiedenVon`).not.toContain(MOD);
      // Keine internen Kennungen von Kanaelen oder Profilen.
      expect(text, `${name}: interne Felder`).not.toContain('profilId');
      expect(text, `${name}: Verifikationswert`).not.toContain('OAUTH');
    }
  });

  it('gibt die Discord-Kennung heraus, weil das Avatarbild daran haengt', async () => {
    /*
     * Die eine Ausnahme, und sie ist keine: Discords CDN adressiert Avatare
     * nach der Kennung. Ohne sie gaebe es kein Bild. Genau so haelt es das
     * oeffentliche Mitgliedsprofil - und diese Erwartung steht hier, damit
     * niemand sie fuer ein Versehen haelt und sie entfernt.
     */
    await anlegen(LEA, 'Lea', 'APPROVED');
    const eintrag = await streamer.ladeOeffentlichenStreamer('lea');
    expect(eintrag?.discordId).toBe(LEA);
  });

  it('antwortet fuer jeden nicht freigegebenen Streamer gleich', async () => {
    await anlegen(LEA, 'Lea', 'PENDING');
    await anlegen(BEN, 'Ben', 'SUSPENDED');

    expect(await streamer.ladeOeffentlichenStreamer('lea')).toBeNull();
    expect(await streamer.ladeOeffentlichenStreamer('ben')).toBeNull();
    // Und dieselbe Antwort fuer eine Adresse, die es nie gab.
    expect(await streamer.ladeOeffentlichenStreamer('gibt-es-nicht')).toBeNull();

    const liste = await streamer.ladeOeffentlicheListe();
    expect([...liste.live, ...liste.offline]).toHaveLength(0);
  });

  it('zeigt einen Streamer ohne aktiven Kanal nicht', async () => {
    // Er hat nichts zu zeigen - und eine Karte ohne Kanal ist eine Karte ohne
    // Grund, sie anzuklicken.
    const { kanalId } = await anlegen(LEA, 'Lea', 'APPROVED');
    await prisma.streamerKanal.update({ where: { id: kanalId }, data: { aktiv: false } });

    expect(await streamer.ladeOeffentlichenStreamer('lea')).toBeNull();
    const liste = await streamer.ladeOeffentlicheListe();
    expect([...liste.live, ...liste.offline]).toHaveLength(0);
  });

  it('trennt live und offline statt nur zu sortieren', async () => {
    /*
     * Wer die Seite oeffnet, soll in der ersten Bildschirmhoehe sehen, ob
     * gerade jemand streamt. Eine gemischte Liste mit einem kleinen Abzeichen
     * beantwortet diese Frage nicht.
     */
    const lea = await anlegen(LEA, 'Lea', 'APPROVED');
    await anlegen(BEN, 'Ben', 'APPROVED');
    await prisma.streamerSession.create({
      data: {
        kanalId: lea.kanalId,
        externeSessionId: 'stream-1',
        titel: 'Feierabend',
        gestartetAm: new Date(),
        zuletztGesehenAm: new Date(),
      },
    });

    const liste = await streamer.ladeOeffentlicheListe();
    expect(liste.live.map((eintrag) => eintrag.slug)).toEqual(['lea']);
    expect(liste.offline.map((eintrag) => eintrag.slug)).toEqual(['ben']);
  });

  it('baut die Filterlisten aus allen Streamern, nicht aus den gefilterten', async () => {
    /*
     * Sonst verschwindet die Auswahl, mit der man gefiltert hat: wer «en»
     * waehlt, sieht danach nur noch «en» in der Liste und kommt nicht zurueck.
     */
    const lea = await anlegen(LEA, 'Lea', 'APPROVED');
    const ben = await anlegen(BEN, 'Ben', 'APPROVED');
    await prisma.streamerProfil.update({ where: { id: lea.profilId }, data: { sprachen: ['de'] } });
    await prisma.streamerProfil.update({ where: { id: ben.profilId }, data: { sprachen: ['en'] } });

    const gefiltert = await streamer.ladeOeffentlicheListe({ sprache: 'en' });
    expect([...gefiltert.live, ...gefiltert.offline].map((eintrag) => eintrag.slug)).toEqual(['ben']);
    expect(gefiltert.filter.sprachen.sort()).toEqual(['de', 'en']);
  });

  it('haelt einen Streamer aus dem Profilabschnitt, wenn das Modul aus ist', async () => {
    /*
     * Derselbe Schalter fuer alle drei oeffentlichen Ansichten. Sonst haette ein
     * abgeschalteter Streamer Hub noch einen oeffentlichen Auftritt - im
     * Mitgliedsprofil, mit einem Link auf eine Seite, die 404 antwortet.
     */
    await anlegen(LEA, 'Lea', 'APPROVED');
    expect(await streamer.oeffentlichErlaubt()).toBe(true);
    expect(await streamer.ladeProfilStreaming(LEA, 'lea')).not.toBeNull();

    await einstellungen({ oeffentlichAktiv: false });
    expect(await streamer.oeffentlichErlaubt()).toBe(false);
    expect(await streamer.ladeProfilStreaming(LEA, 'lea')).toBeNull();

    await einstellungen({ oeffentlichAktiv: true });
    await setModuleEnabled(streamer.STREAMER_MODULE_ID, false, 'test');
    expect(await streamer.oeffentlichErlaubt()).toBe(false);
    expect(await streamer.ladeProfilStreaming(LEA, 'lea')).toBeNull();
  });

  it('verlinkt die Streamer-Seite im Profilabschnitt nur mit einem Slug', async () => {
    await anlegen(LEA, 'Lea', 'APPROVED');
    const mit = await streamer.ladeProfilStreaming(LEA, 'lea');
    expect(mit?.streamerSeite).toBe('/streamer/lea');
    // Ohne Slug kein Knopf - er fuehrte auf eine 404.
    const ohne = await streamer.ladeProfilStreaming(LEA, null);
    expect(ohne?.streamerSeite).toBeNull();
  });

  it('haelt Banner und Spiele zurueck, wenn das Mitgliedsprofil nicht oeffentlich ist', async () => {
    /*
     * Die Bewerbung als Streamer ist eine Zustimmung zur **Streamer-Seite**,
     * nicht zum ganzen Profil. Wer sein Profil privat haelt, hat damit nicht
     * gesagt, dass sein Banner auf einer oeffentlichen Seite erscheinen darf -
     * und seine Lieblingsspiele stehen unter einer eigenen Sichtbarkeit.
     *
     * Was bleibt, hat er selbst fuer die Bewerbung geschrieben: Beschreibung,
     * Sprachen, Kanaele. Dazu Name und Avatar, die im Server ohnehin jeder
     * sieht.
     */
    const spiel = await prisma.game.create({ data: { name: 'Valorant', nameKey: 'valorant' } });

    await anlegen(LEA, 'Lea', 'APPROVED', false);
    const mitgliedsprofil = await prisma.memberProfile.update({
      where: { discordId: LEA },
      data: { bannerPath: 'banner/lea.webp', bannerPreset: 'rot' },
    });
    await prisma.memberGameProfile.create({
      data: { profileId: mitgliedsprofil.id, gameId: spiel.id, favorite: true },
    });

    const eintrag = await streamer.ladeOeffentlichenStreamer('lea');
    expect(eintrag).not.toBeNull();
    expect(eintrag?.bannerBild).toBeNull();
    expect(eintrag?.spiele).toEqual([]);
    // Und was zur Bewerbung gehoert, ist da.
    expect(eintrag?.beschreibung).toBe('Lea streamt abends.');
    expect(eintrag?.kanaele).toHaveLength(1);
  });

  it('baut ohne oeffentliche Adresse keinen Spotlight', async () => {
    /*
     * §11 und §15 zusammen: die Grafik entsteht aus den oeffentlichen Daten.
     * Ohne `publicSlug` gibt es keine stabile Adresse und damit keine
     * oeffentliche Sicht - dann entsteht keine Grafik, und schon gar nicht eine
     * aus den internen Daten.
     */
    const { profilId } = await anlegen(LEA, 'Lea', 'APPROVED');
    await prisma.memberProfile.update({ where: { discordId: LEA }, data: { publicSlug: null } });

    await expect(streamer.erstelleSpotlight(profilId, MOD)).rejects.toThrow(/öffentliche Seite/u);
    expect(await prisma.streamerSpotlight.count()).toBe(0);
  });

  it('erlaubt einen Spotlight nur fuer einen freigegebenen Streamer', async () => {
    const { profilId } = await anlegen(LEA, 'Lea', 'PENDING');
    await expect(streamer.erstelleSpotlight(profilId, MOD)).rejects.toThrow(/freigegebener/u);
  });

  it('friert einen veroeffentlichten Spotlight ein', async () => {
    /*
     * Sonst zeigte die Nachricht auf Discord einen anderen Text als den, der im
     * Studio steht - und niemand koennte nachvollziehen, was gesendet wurde.
     */
    const { profilId } = await anlegen(LEA, 'Lea', 'APPROVED');
    const entwurf = await streamer.erstelleSpotlight(profilId, MOD);
    await streamer.bearbeiteSpotlight(entwurf.id, { ueberschrift: 'Neu' });

    await prisma.streamerSpotlight.update({
      where: { id: entwurf.id },
      data: { status: 'VEROEFFENTLICHT', veroeffentlichtAm: new Date(), discordMessageId: 'msg-1' },
    });
    await expect(streamer.bearbeiteSpotlight(entwurf.id, { ueberschrift: 'Doch anders' })).rejects.toThrow(
      /veröffentlicht/u,
    );
    const unveraendert = await prisma.streamerSpotlight.findUniqueOrThrow({ where: { id: entwurf.id } });
    expect(unveraendert.ueberschrift).toBe('Neu');
  });

  it('nennt im Spotlight keinen Namen und keine Spiele - die kommen aus dem Profil', async () => {
    /*
     * Der Entwurf traegt nur Text. Name, Spiele und Kanal stehen in der
     * Datenbank an einer Stelle: im Streamer-Profil. Eine Kopie im Entwurf
     * waere ein Name, der nach einer Umbenennung veraltet auf einer Grafik
     * steht, die jemand Wochen spaeter exportiert.
     */
    const { profilId } = await anlegen(LEA, 'Lea', 'APPROVED');
    const entwurf = await streamer.erstelleSpotlight(profilId, MOD);
    const spalten = Object.keys(entwurf);
    expect(spalten).not.toContain('name');
    expect(spalten).not.toContain('anzeigename');
    expect(spalten).not.toContain('spiele');
    expect(spalten).not.toContain('kanal');

    const daten = await streamer.holeSpotlightDaten(entwurf.id);
    // Die Anzeigedaten kommen zur Laufzeit dazu - aus der oeffentlichen Sicht.
    expect(daten?.streamer.name).toBe('Lea');
    expect(daten?.streamer.spiele).toEqual([]);
  });
});
