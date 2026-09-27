import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_2');

/**
 * Public Profile 2.0 - die Zusagen gegen eine echte Datenbank.
 *
 * ## Warum gegen eine echte und nicht gegen eine Nachbildung
 *
 * Weil die wichtigsten Vorkehrungen Bedingungen der Datenbank sind:
 *
 *  - `MemberProfileSlugAlias.slug @unique` - ein frueherer Slug bleibt belegt,
 *    und zwar gegen **alle** Profile. Ohne das koennte jemand anders `manu`
 *    uebernehmen, und ein Link in einer Twitch-Bio fuehrte auf ein fremdes
 *    Profil. Das ist der schlimmste Fall dieses Moduls, weil niemand ihn merkt.
 *  - `MemberProfileLink @@unique([profileId, url])` - derselbe Link nicht zweimal.
 *  - Die Sichtbarkeitsspalten mit ihren Vorgaben. Ob eine Migration etwas
 *    veroeffentlicht, das niemand freigegeben hat, laesst sich nur an einer
 *    Datenbank pruefen, die die Vorgaben tatsaechlich anwendet.
 *
 * ## Und die Gegenrichtung
 *
 * Das oeffentliche DTO wird **aufzaehlend** gebaut. Geprueft wird das hier so,
 * wie es sich pruefen laesst: die Zeilen bekommen absichtlich Werte in Spalten,
 * die niemand sehen darf, und danach wird das ausgelieferte Objekt als Text
 * durchsucht. Nicht Feld fuer Feld - eine Liste von Feldern, die man prueft,
 * vergisst das naechste.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const ANNA = '100000000000000001';
const BEN = '100000000000000002';
const MOD = '100000000000000009';

/** Woerter, die in keiner oeffentlichen Antwort vorkommen duerfen. */
const GEHEIM = {
  sperrgrund: 'GRUND-DER-SPERRE-XYZ',
  notiz: 'INTERNE-NOTIZ-XYZ',
};

const alsText = (wert: unknown): string =>
  JSON.stringify(wert, (_schluessel, inhalt) => (typeof inhalt === 'bigint' ? inhalt.toString() : inhalt));

async function mitglied(discordId: string, name: string): Promise<void> {
  await prisma.discordMemberCache.create({
    data: { discordId, username: name.toLowerCase(), displayName: name, joinedAt: new Date('2024-01-01') },
  });
}

/** Ein oeffentliches Profil mit Slug - und absichtlich gefuellten Innenspalten. */
async function oeffentlichesProfil(
  discordId: string,
  slug: string,
  teile: Record<string, unknown> = {},
): Promise<string> {
  const profil = await prisma.memberProfile.create({
    data: {
      discordId,
      publicSlug: slug,
      visibilityProfile: 'PUBLIC',
      displayName: slug,
      tagline: 'Spielt abends.',
      bio: 'Ein Satz über mich.',
      languages: ['de'],
      platforms: ['PC'],
      // Genau das darf nicht herauskommen.
      publicLockReason: GEHEIM.sperrgrund,
      ...teile,
    },
  });
  return profil.id;
}

describeWithDatabase('Public Profile 2.0: Adresse und Aliasse', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberProfileLink.deleteMany();
    await prisma.memberSocialLink.deleteMany();
    await prisma.memberProfileSlugAlias.deleteMany();
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await prisma.auditLog.deleteMany();
    await mitglied(ANNA, 'Anna');
    await mitglied(BEN, 'Ben');
  });

  it('legt beim Aendern einen Alias an und leitet den alten Link weiter', async () => {
    await oeffentlichesProfil(ANNA, 'anna');

    const ergebnis = await profile.aendereSlug(ANNA, 'anna-spielt');
    expect(ergebnis.slug).toBe('anna-spielt');

    // Die neue Adresse zeigt das Profil.
    const neu = await profile.ladeOeffentlichesProfilOderSperre('anna-spielt');
    expect(neu.art).toBe('profil');

    // Die alte leitet weiter - auf die neue, nicht auf irgendetwas.
    const alt = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(alt).toEqual({ art: 'umgezogen', slug: 'anna-spielt' });
  });

  it('haelt den alten Slug fuer immer belegt', async () => {
    /*
     * Der eigentliche Zweck der Alias-Tabelle. Waere `anna` wieder frei, koennte
     * Ben ihn nehmen - und jeder gedruckte QR-Code und jeder Link in einer Bio
     * fuehrte ab dann auf Bens Profil.
     */
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');

    await oeffentlichesProfil(BEN, 'ben');
    await expect(profile.aendereSlug(BEN, 'anna')).rejects.toThrow(/vergeben/u);

    const pruefung = await profile.pruefeSlugWunsch(BEN, 'anna');
    expect(pruefung.frei).toBe(false);
    // Und die Antwort sagt nicht, **wem** er gehoert.
    expect(alsText(pruefung)).not.toContain(ANNA);
    expect(alsText(pruefung)).not.toContain('anna-spielt');
  });

  it('laesst die eigene alte Adresse wieder zurueckholen', async () => {
    // Wer hin und her wechselt, soll nicht an seinem eigenen alten Namen
    // scheitern - und danach darf der Alias nicht auf sich selbst zeigen.
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');
    await profile.aendereSlug(ANNA, 'anna');

    const jetzt = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(jetzt.art).toBe('profil');
    const rueckweg = await profile.ladeOeffentlichesProfilOderSperre('anna-spielt');
    expect(rueckweg).toEqual({ art: 'umgezogen', slug: 'anna' });
  });

  it('leitet nicht weiter, wenn das Ziel nicht mehr oeffentlich ist', async () => {
    /*
     * Eine Weiterleitung auf eine Seite, die es nicht mehr gibt, waere eine
     * Auskunft darueber, dass dort einmal jemand war. Dieselbe 404 wie fuer jede
     * unbekannte Adresse.
     */
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');
    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { visibilityProfile: 'MEMBERS' },
    });

    expect(await profile.ladeOeffentlichesProfilOderSperre('anna')).toEqual({ art: 'keines' });
  });

  it('leitet nicht weiter, wenn das Ziel gesperrt ist', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');
    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { publicLockedAt: new Date(), publicLockedByDiscordId: MOD },
    });

    expect(await profile.ladeOeffentlichesProfilOderSperre('anna')).toEqual({ art: 'keines' });
    expect((await profile.ladeOeffentlichesProfilOderSperre('anna-spielt')).art).toBe('gesperrt');
  });

  it('laesst den laufenden Slug immer gewinnen', async () => {
    /*
     * Sonst koennte ein alter Alias eine aktuelle Adresse verdecken. Hier hat
     * Anna `anna` als Alias, und Ben heisst - hypothetisch - ebenso. Das kann
     * nicht passieren, weil der Alias belegt ist; der Test haelt fest, dass die
     * Reihenfolge der Abfragen trotzdem stimmt.
     */
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');
    // Von Hand, um den Fall zu erzwingen, den die Eindeutigkeit verhindert.
    await oeffentlichesProfil(BEN, 'ben-neu');
    await prisma.memberProfileSlugAlias.deleteMany({ where: { slug: 'ben-neu' } });
    await prisma.memberProfileSlugAlias.create({ data: { slug: 'ben-neu', discordId: ANNA } });

    const antwort = await profile.ladeOeffentlichesProfilOderSperre('ben-neu');
    expect(antwort.art).toBe('profil');
    if (antwort.art === 'profil') {
      expect(antwort.profil.identitaet.discordId).toBe(BEN);
    }
  });

  it('lehnt reservierte und ungueltige Wunschadressen ab', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    for (const wunsch of ['admin', 'api', 'swisshub', 'u', '-nope', 'a', 'Mit Leerzeichen']) {
      await expect(profile.aendereSlug(ANNA, wunsch), wunsch).rejects.toThrow();
    }
    // Und der Slug ist unveraendert.
    expect((await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } })).publicSlug).toBe(
      'anna',
    );
  });

  it('protokolliert die Aenderung mit alter und neuer Adresse', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    await profile.aendereSlug(ANNA, 'anna-spielt');

    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PROFILE_SLUG_CHANGED' },
    });
    expect(alsText(eintrag.metadata)).toContain('anna');
    expect(alsText(eintrag.metadata)).toContain('anna-spielt');
  });

  it('gibt einem Profil ohne oeffentliche Seite keine Adresse zu aendern', async () => {
    await prisma.memberProfile.create({ data: { discordId: ANNA, visibilityProfile: 'MEMBERS' } });
    await expect(profile.aendereSlug(ANNA, 'anna')).rejects.toThrow(/öffentlich/u);
  });
});

describeWithDatabase('Public Profile 2.0: was nach aussen geht', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberProfileLink.deleteMany();
    await prisma.memberSocialLink.deleteMany();
    await prisma.memberProfileSlugAlias.deleteMany();
    await prisma.memberNote.deleteMany();
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await mitglied(ANNA, 'Anna');
  });

  it('liefert keinen Sperrgrund und keine internen Spalten', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    const antwort = await profile.ladeOeffentlichesProfilOderSperre('anna');
    expect(antwort.art).toBe('profil');

    const text = alsText(antwort);
    expect(text).not.toContain(GEHEIM.sperrgrund);
    expect(text).not.toContain('publicLockReason');
    expect(text).not.toContain('publicLockedBy');
    expect(text).not.toContain('visibility');
  });

  it('sagt, ob die Seite indexiert werden darf - und aendert sich damit', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    const mit = await profile.ladeOeffentlichesProfil('anna');
    expect(mit?.indexierbar).toBe(true);

    await prisma.memberProfile.update({ where: { discordId: ANNA }, data: { publicIndexable: false } });
    const ohne = await profile.ladeOeffentlichesProfil('anna');
    /*
     * Die Seite gibt es weiterhin - «nicht indexiert» ist kein Zugriffsschutz.
     * Was sich aendert, ist nur diese Angabe, aus der die Seite ihr `noindex`
     * baut.
     */
    expect(ohne).not.toBeNull();
    expect(ohne?.indexierbar).toBe(false);
  });

  it('nimmt in die Sitemap nur auf, was ausdruecklich indexierbar ist', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    await mitglied(BEN, 'Ben');
    await oeffentlichesProfil(BEN, 'ben', { publicIndexable: false });

    const liste = await profile.indexierbareProfile(100);
    expect(liste.map((eintrag) => eintrag.slug)).toEqual(['anna']);
  });

  it('nimmt ein privates oder gesperrtes Profil nicht in die Sitemap auf', async () => {
    await oeffentlichesProfil(ANNA, 'anna');
    expect((await profile.indexierbareProfile(100)).map((e) => e.slug)).toEqual(['anna']);

    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { publicLockedAt: new Date() },
    });
    expect(await profile.indexierbareProfile(100)).toEqual([]);

    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { publicLockedAt: null, visibilityProfile: 'MEMBERS' },
    });
    expect(await profile.indexierbareProfile(100)).toEqual([]);
  });

  it('bereinigt die Abschnittsreihenfolge beim Ausliefern', async () => {
    /*
     * Die Spalte ist aelter als der naechste Stand des Codes. Ein entfernter
     * Abschnitt steht noch in tausend Profilen, ein neuer fehlt in allen -
     * beides darf die Seite nicht unvollstaendig machen.
     */
    await oeffentlichesProfil(ANNA, 'anna', {
      publicSections: ['links', 'gibtesnicht', 'links', 'gaming'],
    });
    const profil = await profile.ladeOeffentlichesProfil('anna');

    expect(profil?.abschnitte.slice(0, 2)).toEqual(['links', 'gaming']);
    expect(profil?.abschnitte).not.toContain('gibtesnicht');
    // Jeder Abschnitt genau einmal - und alle sind da.
    expect(new Set(profil?.abschnitte).size).toBe(profil?.abschnitte.length);
    expect(profil?.abschnitte).toContain('steckbrief');
  });

  it('zeigt keine Auszeichnung, die nicht erreicht ist - auch wenn sie ausgewaehlt war', async () => {
    /*
     * Die Spalte ist eine Wunschliste. Ein Schluessel, der nicht erreicht ist,
     * verschwindet beim Anzeigen - damit kann aus dieser Spalte nie eine
     * Auszeichnung entstehen, die es nicht gibt. §9 verbietet genau das.
     */
    await oeffentlichesProfil(ANNA, 'anna', {
      highlightAwards: ['turnier-sieger', 'gibtesnicht', 'clip-legende'],
    });
    const profil = await profile.ladeOeffentlichesProfil('anna');
    expect(profil?.hervorgehobene).toEqual([]);
  });

  it('haelt Turniererfolge zurueck, solange sie nicht freigegeben sind', async () => {
    // Vorgabe ist MEMBERS - Turniererfolge waren nie oeffentlich, und eine
    // Migration veroeffentlicht nichts, was niemand freigegeben hat.
    await oeffentlichesProfil(ANNA, 'anna');
    const vorgabe = await profile.ladeOeffentlichesProfil('anna');
    expect(vorgabe?.turniere).toBeUndefined();

    await prisma.memberProfile.update({
      where: { discordId: ANNA },
      data: { visibilityTournaments: 'PUBLIC' },
    });
    const frei = await profile.ladeOeffentlichesProfil('anna');
    expect(frei?.turniere).toBeDefined();
  });

  it('haelt Level und Auszeichnungen oeffentlich - so wie bisher', async () => {
    /*
     * §23: bestehende Sichtbarkeiten uebernehmen. Level und Auszeichnungen
     * standen schon vor Public Profile 2.0 auf jeder oeffentlichen Profilseite;
     * ihre neuen Spalten stehen deshalb auf PUBLIC. Sie auf MEMBERS zu setzen
     * waere keine Vorsicht, sondern eine stille Aenderung an Seiten, die Leute
     * geteilt haben.
     */
    await oeffentlichesProfil(ANNA, 'anna');
    const zeile = await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(zeile.visibilityLevel).toBe('PUBLIC');
    expect(zeile.visibilityAwards).toBe('PUBLIC');
    expect(zeile.visibilityStreaming).toBe('PUBLIC');
    expect(zeile.visibilityTournaments).toBe('MEMBERS');
    expect(zeile.publicIndexable).toBe(true);
  });

  it('liefert Links als fertige Knoepfe - verborgene nicht', async () => {
    const profilId = await oeffentlichesProfil(ANNA, 'anna', { visibilitySocials: 'PUBLIC' });
    await prisma.memberSocialLink.create({
      data: { profileId: profilId, platform: 'twitch', handle: 'anna', label: 'Mein Stream', featured: true },
    });
    await prisma.memberSocialLink.create({
      data: { profileId: profilId, platform: 'steam', handle: 'anna', hidden: true },
    });
    await prisma.memberProfileLink.create({
      data: { profileId: profilId, url: 'https://example.com/portfolio', label: 'Portfolio', sortOrder: 5 },
    });

    const profil = await profile.ladeOeffentlichesProfil('anna');
    const links = profil?.links ?? [];

    expect(links.map((eintrag) => eintrag.label)).toEqual(['Mein Stream', 'Portfolio']);
    expect(links[0]?.url).toBe('https://twitch.tv/anna');
    expect(links[0]?.hervorgehoben).toBe(true);
    // Selbst angegeben ist nicht verifiziert - an keiner der beiden Stellen.
    expect(links.every((eintrag) => eintrag.verifiziert === false)).toBe(true);
  });

  it('liefert keinen Link, dessen Adresse heute nicht mehr durchgeht', async () => {
    /*
     * Die Spalte ist aelter als der naechste Stand des Codes. Wird die Pruefung
     * strenger - oder stand dort je etwas, das sie nicht haette annehmen
     * duerfen -, verschwindet der Eintrag still, statt ausgeliefert zu werden.
     */
    const profilId = await oeffentlichesProfil(ANNA, 'anna', { visibilitySocials: 'PUBLIC' });
    await prisma.memberProfileLink.create({
      data: { profileId: profilId, url: 'javascript:alert(1)', label: 'Böse' },
    });
    await prisma.memberProfileLink.create({
      data: { profileId: profilId, url: 'https://example.com/gut', label: 'Gut', sortOrder: 1 },
    });

    const profil = await profile.ladeOeffentlichesProfil('anna');
    expect(profil?.links?.map((eintrag) => eintrag.label)).toEqual(['Gut']);
    expect(alsText(profil)).not.toContain('javascript:');
  });

  it('haelt die Links zurueck, wenn der Abschnitt nicht oeffentlich ist', async () => {
    // Vorgabe fuer `visibilitySocials` ist PRIVATE - wer nichts entschieden hat,
    // hat seine Konten nicht freigegeben.
    const profilId = await oeffentlichesProfil(ANNA, 'anna');
    await prisma.memberSocialLink.create({
      data: { profileId: profilId, platform: 'twitch', handle: 'anna' },
    });
    const profil = await profile.ladeOeffentlichesProfil('anna');
    expect(profil?.links).toBeUndefined();
    expect(alsText(profil)).not.toContain('twitch');
  });
});
